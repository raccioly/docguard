/**
 * Adoption Baseline — `.docguard.baseline.json` (repo root, COMMITTED).
 *
 * The brownfield-adoption pattern (ESLint/semgrep-style): a legacy repo
 * freezes its existing findings once (`guard --update-baseline`), commits the
 * file, and from then on guard/ci gate only NEW drift. Suppressed findings
 * are counted and displayed — never silently hidden — and the baseline is a
 * reviewable diff in every PR that updates it.
 *
 * Root, not `.docguard/`: the state dir is gitignored, and a baseline only
 * works if the whole team and CI share it.
 *
 * Fingerprints are content-addressed, not line-addressed: `code | location
 * path (line numbers stripped) | message with digit-runs normalized to #`.
 * Line numbers churn on every edit and messages embed volatile counts
 * ("21 commits since…") — both would rot the baseline in a week.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BASELINE_FILE = '.docguard.baseline.json';

/** Stable fingerprint for one finding. */
export function fingerprintFinding(f) {
  const code = f.code || 'UNCODED';
  const path = typeof f.location === 'string' ? f.location.replace(/:\d+$/, '') : '';
  const msg = String(f.message || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${code}|${path}|${msg}`).digest('hex').slice(0, 16);
}

/**
 * Load the committed baseline as a Map of fingerprint → allowed occurrence
 * count, or null when the project has none (the common case — zero overhead).
 *
 * Occurrence counts matter (review finding H2): two findings with the same
 * code + file + message shape — e.g. two hardcoded passwords in one file —
 * share a fingerprint. A count-less set would let one frozen instance
 * suppress every FUTURE instance of that class in that file, a
 * security-relevant false negative. With counts, freezing 1 suppresses 1;
 * a second appearance surfaces and gates.
 */
export function loadBaseline(projectDir) {
  const p = resolve(projectDir, BASELINE_FILE);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (!data || typeof data.fingerprints !== 'object' || data.fingerprints === null) return null;
    const map = new Map();
    for (const [fp, n] of Object.entries(data.fingerprints)) {
      const count = Number.isInteger(n) && n > 0 ? n : 0;
      if (count > 0) map.set(fp, count);
    }
    return map.size > 0 ? map : null;
  } catch {
    // A malformed baseline must not silently un-gate CI: treat as absent so
    // every finding surfaces (fail-open on visibility, fail-closed on hiding).
    return null;
  }
}

/**
 * Write the baseline from the current findings: fingerprint → occurrence
 * count, keys sorted so the committed file diffs cleanly. Returns the number
 * of distinct fingerprints.
 */
export function saveBaseline(projectDir, findings) {
  const counts = {};
  for (const f of findings) {
    const fp = fingerprintFinding(f);
    counts[fp] = (counts[fp] || 0) + 1;
  }
  const fingerprints = Object.fromEntries(Object.keys(counts).sort().map(k => [k, counts[k]]));
  const doc = {
    _comment: 'DocGuard adoption baseline — existing findings frozen at adoption time (fingerprint → occurrence count). Guard suppresses up to that many instances of each and gates everything new. Regenerate with: docguard guard --update-baseline',
    version: 2,
    generatedAt: new Date().toISOString(),
    count: Object.keys(fingerprints).length,
    fingerprints,
  };
  writeFileSync(resolve(projectDir, BASELINE_FILE), JSON.stringify(doc, null, 2) + '\n');
  return Object.keys(fingerprints).length;
}
