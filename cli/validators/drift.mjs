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
import { contractFields } from '../shared-result-contract.mjs';

const NO_DRIFT_COMMENT = { applies: false, evidence: 'no source file Drift reads carries a // DRIFT: comment' };

/**
 * Whether Drift's kind of check belongs to the project: it applies when a
 * source file the validator reads carries a `// DRIFT:` comment, wherever in
 * the tree (a `--changed-only` run still asks about the whole project). A
 * project with no such comment has nothing to reconcile with a drift log; it
 * does not apply, and the missing log is not the reason.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  let found = null;
  walkDir(projectDir, (filePath) => {
    if (found || !isDriftSourceFile(relPosix(projectDir, filePath), config)) return;
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }
    if (!content.includes('DRIFT:')) return;
    if (content.split('\n').some(line => DRIFT_COMMENT.test(line))) found = relPosix(projectDir, filePath);
  });
  return found
    ? { applies: true, evidence: `${found} carries a // DRIFT: comment` }
    : NO_DRIFT_COMMENT;
}

/** The result-contract fields of a Drift result. */
function driftContract(projectDir, config, performed, found, known = null) {
  return contractFields({
    performed, found, ran: `reconciled ${performed} // DRIFT: comment(s) with the drift log`,
    decide: () => known || applies(projectDir, config),
    empty: (decision) => decision.applies
      ? { emptyCause: 'needs-content', note: 'Drift read the changed files and none of them carries a // DRIFT: comment to reconcile with the drift log.', howToConfigure: 'Nothing to fix: this run read only the changed files. A full `docguard guard` reconciles every // DRIFT: comment with DRIFT-LOG.md.' }
      : { note: 'Drift found no // DRIFT: comment in the source files it reads, so there is no deviation to reconcile with a drift log.', howToConfigure: 'Nothing to configure unless the project deviates from its canonical docs: then mark the deviation in code with `// DRIFT: <reason>` and record it in DRIFT-LOG.md.' },
  });
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
      // A full walk found no comment, which is the answer applies() would walk the tree again to give.
      ...driftContract(projectDir, config, 0, false, Array.isArray(config.changedFiles) && config.changedFiles.length > 0 ? null : NO_DRIFT_COMMENT),
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
    return { name: 'drift', ...resultFromFindings(findings, { passed: 0, total: driftComments.length }), ...driftContract(projectDir, config, driftComments.length, true) };
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

  return { name: 'drift', ...resultFromFindings(findings, { passed, total }), ...driftContract(projectDir, config, total, findings.length > 0) };
}

// v0.29 consolidation: traversal delegates to the shared canonical walker;
// the DRIFT_IGNORE_DIRS set (cli/shared-drift.mjs) stays drift-specific because its entries are intentional
// per-validator variance (e.g. 'cli' — DocGuard's own source has DRIFT: in
// regex patterns).
function walkDir(dir, callback) {
  sharedWalkFiles(dir, callback, { ignoreDirs: DRIFT_IGNORE_DIRS });
}
