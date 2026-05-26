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

import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { getSection } from '../writers/sections.mjs';

export function validateGeneratedStaleness(projectDir, config = {}) {
  const result = { errors: [], warnings: [], passed: 0, total: 0 };

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

  for (const doc of plan.docs) {
    const fullPath = resolve(projectDir, doc.path);
    if (!existsSync(fullPath)) continue;
    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

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
    }
  }

  if (!anySourceCodeSection) {
    return { ...result, applicable: false };
  }

  return result;
}
