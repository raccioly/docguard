/**
 * Drift Validator — Every // DRIFT: comment must have a DRIFT-LOG.md entry
 *
 * v0.29: migrated to structured findings (DRF001–DRF002). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 *
 * What it reads lives in cli/shared-drift.mjs, so FRS005 counts the same lines.
 * @implements docguard.calibrated-finding-channels#FR-022
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { relPosix, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { DRIFT_COMMENT, DRIFT_IGNORE_DIRS, isDriftSourceFile } from '../shared-drift.mjs';

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
// the DRIFT_IGNORE_DIRS set (cli/shared-drift.mjs) stays drift-specific because its entries are intentional
// per-validator variance (e.g. 'cli' — DocGuard's own source has DRIFT: in
// regex patterns).
function walkDir(dir, callback) {
  sharedWalkFiles(dir, callback, { ignoreDirs: DRIFT_IGNORE_DIRS });
}
