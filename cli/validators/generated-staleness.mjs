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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';

import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { getSection } from '../writers/sections.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

/**
 * v0.18-P1 fast-path: cheap pre-flight to detect whether ANY canonical doc
 * has a `<!-- docguard:section ... source=code -->` marker OR a `status:
 * draft` frontmatter. If neither exists anywhere, this validator has
 * nothing to do — skip the expensive buildMemoryPlan call (~400ms on
 * mid-sized repos, was 26-33% of total guard validator time).
 *
 * Returns { hasMarkers, hasDrafts }.
 */
function _quickScan(projectDir) {
  const out = { hasMarkers: false, hasDrafts: false };
  const candidateDirs = [
    resolve(projectDir, 'docs-canonical'),
    projectDir, // for README.md, AGENTS.md, etc.
  ];
  // We only need a single match in any file to know the validator has work.
  // Short-circuit aggressively: stop the moment we find either signal.
  for (const dir of candidateDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      // Skip very large files quickly — for canonical docs, > 200 KB is unusual
      // and almost certainly not the marker-heavy file we're looking for.
      let stat;
      try { stat = statSync(join(dir, entry)); } catch { continue; }
      if (!stat.isFile()) continue;
      if (stat.size > 200_000) continue;
      let content;
      try { content = readFileSync(join(dir, entry), 'utf-8'); } catch { continue; }
      if (!out.hasMarkers && /<!--\s*docguard:section\s+[^>]*source=code/i.test(content)) {
        out.hasMarkers = true;
      }
      if (!out.hasDrafts && /(?:^---\s*\n[\s\S]*?\bstatus:\s*draft\b[\s\S]*?\n---|<!--\s*status:\s*draft\s*-->)/im.test(content)) {
        out.hasDrafts = true;
      }
      if (out.hasMarkers && out.hasDrafts) return out;
    }
  }
  return out;
}

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
  //
  // v0.29: migrated to structured findings (GST001–GST002). Messages are
  // byte-identical to the legacy strings; the N/A early returns keep the
  // legacy shape, and `fixes` is preserved for the fix applier.
  const result = { errors: [], warnings: [], passed: 0, total: 0, fixes: [] };
  const findings = [];

  // v0.18-P1: cheap pre-flight. If no canonical doc has a source=code marker
  // AND no doc is in status:draft, this validator has nothing to do — skip
  // the expensive buildMemoryPlan call. Generated-Staleness used to be
  // 26-33% of total validator time on projects with NO markers, all
  // wasted. The fast-path scans markdown files for the marker substring
  // only — no parsing, no tree walk.
  const quick = _quickScan(projectDir);
  if (!quick.hasMarkers && !quick.hasDrafts) {
    return { ...result, applicable: false, note: 'no docguard:section markers and no status:draft docs' };
  }

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
          findings.push(mkFinding({
            code: 'GST001',
            validator: 'generatedStaleness',
            severity: 'warn',
            message: `${basename(doc.path)} has been in \`status: draft\` for ${Math.floor(ageDays)} days. ` +
              `Promote to status:current or remove. Run \`/docguard.fix --doc ${basename(doc.path)}\` to draft the prose.`,
            location: doc.path,
            suggestion: { kind: 'review', text: 'Draft the prose and promote to status:current, or delete the forgotten skeleton', command: `/docguard.fix --doc ${basename(doc.path)}` },
          }));
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

      // B5 (field report): a `pinned` attribute on the section's open marker
      //   <!-- docguard:section id=… source=code pinned="reason" -->
      // marks the section as intentionally hand-maintained — the scanner
      // mislabeled this surface (e.g. a scanner/tool repo whose source contains
      // framework-like strings; see F1). Exempt it from staleness and count it
      // as a pass, mirroring the docguard:quality opt-out marker. This is the
      // escape hatch from the "stale forever / sync --write reverts it" trap.
      if (onDisk.attrs?.pinned !== undefined) {
        result.passed++;
        continue;
      }

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

      findings.push(mkFinding({
        code: 'GST002',
        validator: 'generatedStaleness',
        severity: 'warn',
        message: `${basename(doc.path)} → section "${sec.id}" is stale${hint}. Run \`docguard sync --write\` to refresh code-truth sections. ` +
          `If this section is intentionally hand-maintained (the scanner mislabeled it), pin it: ` +
          `add \`pinned="reason"\` to its \`<!-- docguard:section id=${sec.id} … -->\` marker.`,
        location: doc.path,
        suggestion: { kind: 'fix', text: 'Refresh the code-truth section (or pin it if it is intentionally hand-maintained)', command: 'docguard sync --write' },
      }));
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

  return { ...resultFromFindings(findings, { passed: result.passed, total: result.total }), fixes: result.fixes };
}
