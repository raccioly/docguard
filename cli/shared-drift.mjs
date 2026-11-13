/**
 * What Drift reads for `// DRIFT:` comments, shared by the Drift validator and
 * the freshness check that counts added DRIFT lines (FRS005), so both count the
 * same lines. Validators do not import each other (tests/validator-isolation).
 */
import { extname } from 'node:path';
import { DEFAULT_IGNORE_DIRS } from './shared-ignore.mjs';

export const DRIFT_CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.swift', '.kt',
  '.rb', '.php', '.cs', '.c', '.cpp', '.h',
]);

// The shared build-output and package-cache set, plus `cli`: DocGuard's own source contains `DRIFT:` in regex patterns.
export const DRIFT_IGNORE_DIRS = new Set([...DEFAULT_IGNORE_DIRS, 'cli']);

// v0.15 hotfix: test files commonly contain literal `// DRIFT:` inside string
// fixtures (e.g. `'// DRIFT: a-drift\n'`). Reading the test as source would
// treat the string as a real drift comment, so test files are skipped unless
// the user opts in — same pattern TODO-Tracking uses.
const TEST_PATH = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^.]+$/;
export const DRIFT_COMMENT = /(?:\/\/|#|\/\*|\-\-)\s*DRIFT:\s*(.+)/i;

/** Whether Drift reads this file (repository-relative) for DRIFT comments. */
export function isDriftSourceFile(rel, config) {
  if (!DRIFT_CODE_EXTENSIONS.has(extname(rel))) return false;
  return config?.drift?.includeTestFiles === true || !TEST_PATH.test(rel);
}

/**
 * Whether a full Drift run reads this repository-relative path: a source file
 * outside the directories it skips. Freshness counts added DRIFT lines (FRS005)
 * with this rule and DRIFT_COMMENT, so it counts what Drift would log.
 * @implements docguard.calibrated-finding-channels#FR-022
 */
export function driftReadsPath(rel, config) {
  const dirs = String(rel).split('/').slice(0, -1);
  return !dirs.some(d => DRIFT_IGNORE_DIRS.has(d)) && isDriftSourceFile(rel, config);
}
