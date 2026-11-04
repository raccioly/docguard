/**
 * Drift Validator — Every // DRIFT: comment must have a DRIFT-LOG.md entry
 *
 * v0.29: migrated to structured findings (DRF001–DRF002). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { relPosix, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.swift', '.kt',
  '.rb', '.php', '.cs', '.c', '.cpp', '.h',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'cli', // Exclude DocGuard's own source (contains DRIFT: in regex patterns)
]);

// v0.15 hotfix: test files commonly contain literal `// DRIFT:` inside string
// fixtures (e.g. `'// DRIFT: a-drift\n'`). Reading the test as source would
// treat the string as a real drift comment, so test files are skipped unless
// the user opts in — same pattern TODO-Tracking uses.
const TEST_PATH = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^.]+$/;
export const DRIFT_COMMENT = /(?:\/\/|#|\/\*|\-\-)\s*DRIFT:\s*(.+)/i;

/** Whether Drift reads this file (repository-relative) for DRIFT comments. */
function isDriftSourceFile(rel, config) {
  if (!CODE_EXTENSIONS.has(extname(rel))) return false;
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
  return !dirs.some(d => IGNORE_DIRS.has(d)) && isDriftSourceFile(rel, config);
}

export function validateDrift(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // v0.15-P3: when config.changedFiles is set (--changed-only mode), only
  // visit the listed paths. Drift comments in unchanged files are still in
  // git so they'll be caught by a full guard run; pre-commit hooks care
  // about NEW drift comments in this commit.
  const scanFile = (filePath) => {
    if (!isDriftSourceFile(relPosix(projectDir, filePath), config)) return;
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }
    if (!content.includes('DRIFT:')) return;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const match = line.match(DRIFT_COMMENT);
      if (match) {
        driftComments.push({
          file: relPosix(projectDir, filePath),
          line: i + 1,
          comment: match[1].trim(),
        });
      }
    });
  };

  const driftComments = [];
  if (Array.isArray(config.changedFiles) && config.changedFiles.length > 0) {
    for (const rel of config.changedFiles) {
      scanFile(resolve(projectDir, rel));
    }
  } else {
    walkDir(projectDir, scanFile);
  }

  if (driftComments.length === 0) {
    // No // DRIFT: comments to reconcile — not applicable (NOT a pass).
    return {
      name: 'drift',
      ...resultFromFindings([], { passed: 0, total: 0 }),
      note: 'no // DRIFT: comments in code',
    };
  }

  // Read DRIFT-LOG.md
  const driftLogPath = resolve(projectDir, config.requiredFiles.driftLog);
  if (!existsSync(driftLogPath)) {
    for (const dc of driftComments) {
      findings.push(mkFinding({
        code: 'DRF001',
        validator: 'drift',
        severity: 'error',
        message: `${dc.file}:${dc.line} has DRIFT comment but DRIFT-LOG.md doesn't exist`,
        location: `${dc.file}:${dc.line}`,
        suggestion: { kind: 'fix', text: 'Create the drift log, then record this deviation in it', command: 'docguard init' },
      }));
    }
    return { name: 'drift', ...resultFromFindings(findings, { passed: 0, total: driftComments.length }) };
  }

  const driftLogContent = readFileSync(driftLogPath, 'utf-8');

  // Check each drift comment has a matching entry in DRIFT-LOG.md
  for (const dc of driftComments) {
    total++;
    // Check if the file is mentioned in DRIFT-LOG.md
    if (driftLogContent.includes(dc.file)) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'DRF002',
        validator: 'drift',
        severity: 'error',
        message: `${dc.file}:${dc.line} — DRIFT comment not logged in DRIFT-LOG.md`,
        location: `${dc.file}:${dc.line}`,
        suggestion: { kind: 'fix', text: 'Add an entry for this file to DRIFT-LOG.md explaining the deviation' },
      }));
    }
  }

  return { name: 'drift', ...resultFromFindings(findings, { passed, total }) };
}

// v0.29 consolidation: traversal delegates to the shared canonical walker;
// the IGNORE_DIRS set above stays local because its entries are intentional
// per-validator variance (e.g. 'cli' — DocGuard's own source has DRIFT: in
// regex patterns).
function walkDir(dir, callback) {
  sharedWalkFiles(dir, callback, { ignoreDirs: IGNORE_DIRS });
}
