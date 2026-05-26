/**
 * Generated-Doc Staleness Validator — M-1 / S-7
 *
 * Re-runs the memory-plan scanner and compares each `source=code` section's
 * expected body against what's actually committed in the canonical docs.
 * Flags sections where the doc says one thing but the scanner produces
 * another — that's drift, and it means either:
 *   (a) Code changed and `docguard sync --write` hasn't been run, OR
 *   (b) Someone hand-edited a code-truth section (which shouldn't happen —
 *       human prose belongs in source=human sections).
 *
 * Why this matters: K-1's auto-fix Action runs `fix --write` (mechanical
 * fixes) but doesn't run `sync --write` (memory refresh). Projects that
 * skip the nightly sync recipe accumulate hidden drift in source=code
 * sections. This validator surfaces it as a warning so CI can catch it.
 *
 * Cheap: just diffs in-memory strings; no extra git or filesystem walk
 * beyond what memory-plan already does.
 *
 * @req SC-M1-001 — flag source=code sections whose body differs from scanner output
 * @req SC-M1-002 — no warning when sections match
 * @req SC-M1-003 — N/A when no canonical docs exist
 * @req SC-M1-004 — N/A when no source=code sections present in any doc
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { getSection } from '../writers/sections.mjs';

/**
 * S-7: how long a generated doc may sit in `status: draft` before we warn.
 * 14 days is the v0.13.1 default — long enough to absorb a typical sprint,
 * short enough to surface forgotten skeletons before they rot.
 */
const DRAFT_STALENESS_DAYS = 14;

/**
 * Parse the frontmatter `status:` field from a markdown doc.
 * Returns the trimmed value or null. Tolerant of either YAML-style
 * fences (`---`) or HTML-comment-style (`<!-- status: draft -->`) markers.
 */
function extractDocStatus(content) {
  if (!content) return null;
  // YAML frontmatter: --- ... ---
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const sm = fmMatch[1].match(/^\s*status:\s*(\S+)\s*$/m);
    if (sm) return sm[1].toLowerCase();
  }
  // Inline `<!-- status: draft -->` marker (common in docguard:generated docs).
  const inline = content.match(/<!--\s*status:\s*(\w+)\s*-->/i);
  if (inline) return inline[1].toLowerCase();
  return null;
}

export function validateGeneratedStaleness(projectDir, config = {}) {
  // v0.14-P3: also emit a `fixes` array. Each fix is structured so
  // `applyMechanicalFixes` can consume it via the new regenerate-section
  // applier. Lets `fix --write` actually CLOSE the loop on drift instead
  // of just warning. No AI needed — the scanner already knows the right body.
  const result = { errors: [], warnings: [], passed: 0, total: 0, fixes: [] };

  // Build the canonical memory plan (what the docs SHOULD contain). If this
  // fails or produces no docs, the validator is N/A.
  let plan;
  try {
    plan = buildMemoryPlan(projectDir, config);
  } catch {
    return { ...result, applicable: false };
  }
  if (!plan || !Array.isArray(plan.docs) || plan.docs.length === 0) {
    return { ...result, applicable: false };
  }

  // Walk each doc's source=code sections and compare against on-disk content.
  let anySourceCodeSection = false;
  const draftThresholdDays = (config.draftStalenessDays != null)
    ? Number(config.draftStalenessDays)
    : DRAFT_STALENESS_DAYS;

  for (const doc of plan.docs) {
    const fullPath = resolve(projectDir, doc.path);
    if (!existsSync(fullPath)) continue;
    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // S-7: a docguard:generated doc with frontmatter `status: draft` that
    // hasn't been updated in N days is probably a forgotten skeleton.
    // Counted as a check (so total reflects it) and warned when stale.
    const status = extractDocStatus(content);
    if (status === 'draft') {
      result.total++;
      try {
        const mtime = statSync(fullPath).mtime;
        const ageDays = (Date.now() - mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > draftThresholdDays) {
          result.warnings.push(
            `${basename(doc.path)} has been in \`status: draft\` for ${Math.floor(ageDays)} days. ` +
            `Promote to status:current or remove. Run \`/docguard.fix --doc ${basename(doc.path)}\` to draft the prose.`
          );
        } else {
          result.passed++;
        }
      } catch {
        // Couldn't stat the file — skip the staleness check, don't count it.
        result.total--;
      }
    }

    for (const sec of doc.sections) {
      if (sec.source !== 'code') continue;
      anySourceCodeSection = true;

      const onDisk = getSection(content, sec.id);
      // If the section isn't present in the doc at all, that's a Structure /
      // Doc Sections concern — not ours. Skip without counting.
      if (!onDisk) continue;

      result.total++;
      const expected = String(sec.body || '').trim();
      const actual = String(onDisk.body || '').trim();

      if (expected === actual) {
        result.passed++;
        continue;
      }

      // Compute a short diff hint — first changed line — so the warning is
      // actionable without dumping the whole section.
      const exp = expected.split('\n');
      const act = actual.split('\n');
      let firstDiff = -1;
      for (let i = 0; i < Math.max(exp.length, act.length); i++) {
        if (exp[i] !== act[i]) { firstDiff = i; break; }
      }
      const hint = firstDiff >= 0
        ? ` (first drift at line ${firstDiff + 1} of section: "${(act[firstDiff] || '').slice(0, 60)}…" vs scanner: "${(exp[firstDiff] || '').slice(0, 60)}…")`
        : '';

      result.warnings.push(
        `${basename(doc.path)} → section "${sec.id}" is stale${hint}. Run \`docguard sync --write\` to refresh code-truth sections.`
      );
      // v0.14-P3: structured fix so `docguard fix --write` can fix this
      // mechanically (no AI needed — scanner already produced the right body).
      result.fixes.push({
        type: 'regenerate-section',
        doc: doc.path,
        sectionId: sec.id,
        body: sec.body,
        summary: `${basename(doc.path)} § ${sec.id} regenerated from scanner`,
      });
    }
  }

  // S-7: even when no source=code sections exist, a draft-status check
  // counts the validator as applicable. Only return N/A when we genuinely
  // had nothing to evaluate.
  if (!anySourceCodeSection && result.total === 0) {
    return { ...result, applicable: false };
  }

  return result;
}
