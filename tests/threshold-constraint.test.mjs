/**
 * Data-derived thresholds must be fitted against a strictly proper scoring rule.
 *
 * Today nothing in DocGuard tunes a threshold from observed data: every value
 * below is hand-set from literature or judgement. That is exactly why this
 * constraint is recorded now — it is cheap to state before anyone builds the
 * thing it forbids, and expensive to retrofit afterwards.
 *
 * The failure mode it guards against is specific. Given a pile of feedback
 * labels, the natural objectives are "maximise accuracy/F1" or "minimise
 * reported false positives". Both are maximised by a detector that abstains
 * more often, or that asserts high confidence on whatever it still emits.
 * Neither penalises a confidently wrong label. Brier and logarithmic scores
 * do, and only a strictly proper rule does.
 *
 * This test pins the pointer comment at each site, so a contributor who
 * changes a threshold reads the constraint before choosing an objective.
 *
 * @implements docguard.calibrated-finding-channels#FR-019
 * @req docguard.calibrated-finding-channels#FR-018
 * @req docguard.calibrated-finding-channels#FR-019
 * @req FR-020 — data-derived thresholds bound to a strictly proper scoring rule
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = 'docguard.calibrated-finding-channels#FR-018';

// Every hand-set numeric threshold that a future contributor might be tempted
// to fit from feedback data. Adding a threshold means adding it here.
const SITES = [
  { file: 'cli/validators/freshness.mjs', anchor: 'const REVIEW_THRESHOLD_DAYS' },
  { file: 'cli/validators/freshness.mjs', anchor: 'const WARNING_THRESHOLD_COMMITS' },
  { file: 'cli/validators/doc-quality.mjs', anchor: 'const THRESHOLDS = {' },
  { file: 'cli/scanners/task-context.mjs', anchor: 'const SCORE_THRESHOLD' },
  { file: 'cli/validators/cross-reference.mjs', anchor: 'const MIN_SUBSTRING' },
  { file: 'benchmarks/lib/precision-evidence.mjs', anchor: 'const DEFAULT_MIN_N' },
];

/** The 12 lines above an anchor — enough for a comment block, tight enough to be local. */
function preamble(file, anchor) {
  const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
  const at = lines.findIndex(l => l.includes(anchor));
  assert.notEqual(at, -1, `${file}: anchor "${anchor}" has moved — update SITES in this test`);
  return lines.slice(Math.max(0, at - 12), at).join('\n');
}

describe('data-derived thresholds (FR-018/FR-019)', () => {
  // @req docs-canonical/REQUIREMENTS.md#FR-020 — a data-derived threshold is bound to a strictly proper scoring rule
  for (const { file, anchor } of SITES) {
    test(`${file} — ${anchor} carries the scoring-rule constraint`, () => {
      assert.match(preamble(file, anchor), new RegExp(REFERENCE.replace(/[.#]/g, '\\$&')),
        `${file}: the threshold at "${anchor}" must reference ${REFERENCE} so a contributor `
        + 'who fits it from data reads the required objective first');
    });
  }

  test('the specification states the required objective and forbids the tempting ones', () => {
    const spec = readFileSync(resolve(ROOT, 'specs/013-calibrated-finding-channels/spec.md'), 'utf8');
    assert.match(spec, /strictly proper scoring rule \(Brier or\s*\n?\s*logarithmic\)/,
      'FR-018 must name the required family');
    assert.match(spec, /accuracy, F1, and raw false-positive counts\s*\n?\s*MUST NOT be used/i,
      'FR-018 must name the objectives that are forbidden, not only the one required');
  });

  test('no threshold site has silently started fitting from data', () => {
    // A cheap tripwire: if a fitting vocabulary ever appears next to a
    // threshold, this test forces the author to justify it here.
    const FITTING = /\b(fit(ted)?|optimi[sz]e[ds]?|tuned|calibrated)\s+(from|on|against)\s+(feedback|labels?|data|observations?)\b/i;
    for (const { file } of new Map(SITES.map(s => [s.file, s])).values()) {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      const hit = src.split('\n').find(l => FITTING.test(l) && !l.includes(REFERENCE));
      assert.equal(hit, undefined,
        `${file}: a value appears to be fitted from data without referencing ${REFERENCE}:\n  ${hit}`);
    }
  });
});
