/**
 * Doc-Dependency validator: a reviewed doc section whose covered code changed.
 *
 * Spec: specs/030-doc-dependency-lock (docguard.doc-dependency-lock).
 * Opt-in: a project with no `covers=` declaration and no lock is not
 * applicable, so its guard output is unchanged (FR-007).
 *
 * @implements docguard.doc-dependency-lock#FR-004
 * @implements docguard.doc-dependency-lock#FR-007
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { docLockStatus, DOC_LOCK_PATH, revisionResolves } from '../scanners/doc-deps.mjs';

const MAX_FINDINGS = 25;
const PARSER_TIER = { ast: 'js-ast', 'python-ast': 'py-ast' };

export function validateDocDependency(projectDir, config = {}) {
  const status = docLockStatus(projectDir, config);
  if (!status.anyCovered && !status.lockExists) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const findings = [];
  if (status.lockError) {
    findings.push(mkFinding({
      code: 'DLK005', validator: 'docDependency', severity: 'error', confidence: 'high', disposition: 'act',
      message: status.lockError, location: DOC_LOCK_PATH,
      suggestion: { kind: 'review', text: 'Restore the lock from git, or delete it and accept each covered section again' },
    }));
    return resultFromFindings(findings, { passed: 0, total: 1, applicable: true });
  }
  const accept = key => `docguard review --accept ${key} --reason "<what you checked>"`;
  let unverifiable = 0;
  for (const section of status.sections) {
    if (section.state === 'unverifiable') { unverifiable++; continue; }
    if (section.state === 'changed') {
      for (const dep of section.deps.filter(d => d.state === 'changed')) {
        const rev = section.entry?.reviewedRevision;
        const diff = rev && revisionResolves(projectDir, rev) ? `git diff ${rev.slice(0, 12)} -- ${dep.path}` : `open ${dep.path}`;
        findings.push(mkFinding({
          code: 'DLK001', validator: 'docDependency', severity: 'warn', confidence: 'high', disposition: 'escalate',
          parserTier: PARSER_TIER[dep.tier] || 'not-applicable',
          message: `${section.key} describes ${dep.ref}, which changed since the section was reviewed (${section.entry.reviewedAt}, ${dep.tier} fingerprint)`,
          location: { file: section.doc, line: section.line },
          suggestion: { kind: 'review', text: `Review the change (${diff}); update the prose if needed, then run \`${accept(section.key)}\``, command: diff },
        }));
      }
    } else if (section.state === 'missing-dependency') {
      for (const dep of section.deps.filter(d => d.state === 'missing')) {
        findings.push(mkFinding({
          code: 'DLK002', validator: 'docDependency', severity: 'warn', confidence: 'high', disposition: 'escalate',
          message: `${section.key} covers ${dep.ref}, which does not resolve: ${dep.reason}`,
          location: { file: section.doc, line: section.line },
          suggestion: { kind: 'review', text: 'Name what the section now describes in covers=, update the prose, and accept the review again' },
        }));
      }
    } else if (section.state === 'unaccepted') {
      const why = !section.entry ? 'has no accepted review'
        : `changed its covers= since the review (${[...section.deps.filter(d => d.state === 'unlocked').map(d => `+${d.ref}`), ...section.droppedRefs.map(r => `-${r}`)].join(', ')})`;
      findings.push(mkFinding({
        code: 'DLK003', validator: 'docDependency', severity: 'warn', confidence: 'high', disposition: 'escalate',
        message: `${section.key} ${why}`,
        location: { file: section.doc, line: section.line },
        suggestion: { kind: 'review', text: `Read the section against the code, then run \`${accept(section.key)}\``, command: accept(section.key) },
      }));
    }
  }
  for (const orphan of status.orphans) {
    findings.push(mkFinding({
      code: 'DLK004', validator: 'docDependency', severity: 'warn', confidence: 'high', disposition: 'act',
      message: `${orphan.key} is in ${DOC_LOCK_PATH} but no such section declares covers=`,
      location: DOC_LOCK_PATH,
      suggestion: { kind: 'fix', text: 'Run `docguard review --prune`', command: 'docguard review --prune' },
    }));
  }
  const total = Math.max(1, status.sections.length + status.orphans.length);
  const shown = findings.slice(0, MAX_FINDINGS);
  const result = resultFromFindings(shown, { passed: Math.max(0, total - findings.length - unverifiable), total, applicable: true });
  return unverifiable
    ? { ...result, applicability: { status: 'partial', reason: `${unverifiable} covered section(s) could not be compared at their recorded fingerprint tier (a parser is unavailable here)` } }
    : result;
}
