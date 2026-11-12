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
import { contractFields } from '../shared-result-contract.mjs';
import { canonicalDocPaths, explainPaddedEmpty, firstProductSource, sample } from '../shared-project-evidence.mjs';

const MAX_FINDINGS = 25;
const PARSER_TIER = { ast: 'js-ast', 'python-ast': 'py-ast' };

/**
 * Does this kind of check belong to the project? It does when the project has
 * canonical documents and source code: the documents can then say which code
 * they describe. Writing `covers=` is the declaration the validator asks for
 * (specs/097-strict-by-default FR-006); no tool can infer what a section describes.
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const docs = canonicalDocPaths(projectDir, config);
  if (docs.length === 0) return { applies: false, evidence: 'the project has no canonical document (docs-canonical/ or a mapped document role) that could name the code it describes', docs };
  const source = firstProductSource(projectDir, config);
  if (!source) return { applies: false, evidence: `${docs.length} canonical document(s) (${sample(docs)}) but no source file for a section to cover`, docs };
  return { applies: true, evidence: `${docs.length} canonical document(s) (${sample(docs)}) and source code (${source}) that a section can declare it covers`, docs, source };
}

function declareHow(d) {
  const doc = d.docs?.[0] || 'docs-canonical/ARCHITECTURE.md';
  const code = d.source || 'src/<file>';
  return `Mark a section of a canonical document with the code it describes, for example in ${doc}: \`<!-- docguard:section id=<id> source=human covers="${code}[#symbol]" -->\` … \`<!-- /docguard:section -->\`, then record that you read it against the code with \`docguard review --accept ${doc}#<id> --reason "<what you checked>"\`. \`docguard review --suggest ${doc}\` proposes covers= at low confidence: check each one. A covers= you did not read is the pass that checks nothing.`;
}
const NO_DOC_OR_SOURCE = 'Nothing to configure unless the project has canonical documents (docs-canonical/) and source code: a `covers=` marker names the code a section describes.';

export function validateDocDependency(projectDir, config = {}) {
  const status = docLockStatus(projectDir, config);
  if (!status.anyCovered && !status.lockExists) {
    return {
      ...resultFromFindings([], { passed: 0, total: 0, applicable: false }),
      ...contractFields({
        performed: 0,
        decide: () => applies(projectDir, config),
        empty: d => (d.applies
          ? { emptyCause: 'needs-declaration', note: `Doc-Dependency found no covers= declaration to compare: ${d.evidence}, but no section declares what it covers and there is no ${DOC_LOCK_PATH}.`, howToConfigure: declareHow(d) }
          : { emptyCause: 'nothing-of-this-kind', note: `Doc-Dependency has no section to compare: ${d.evidence}.`, howToConfigure: NO_DOC_OR_SOURCE }),
      }),
    };
  }
  const findings = [];
  if (status.lockError) {
    findings.push(mkFinding({
      code: 'DLK005', validator: 'docDependency', severity: 'error', confidence: 'high', disposition: 'act',
      message: status.lockError, location: DOC_LOCK_PATH,
      suggestion: { kind: 'review', text: 'Restore the lock from git, or delete it and accept each covered section again' },
    }));
    return { ...resultFromFindings(findings, { passed: 0, total: 1, applicable: true }), performed: 0, applies: { applies: true, evidence: `${DOC_LOCK_PATH} could not be read, so no section was compared` } };
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
  const compared = status.sections.length + status.orphans.length;
  const total = Math.max(1, compared);
  const shown = findings.slice(0, MAX_FINDINGS);
  // `total` is padded to 1 so a lock with no covered section prints 1 check, not 0/0;
  // that pad is not a check. `performed` is the sections and orphans compared, so a
  // lock that covers nothing is `empty`, not `pass` (specs/097-strict-by-default FR-004).
  const result = { ...resultFromFindings(shown, { passed: Math.max(0, total - findings.length - unverifiable), total, applicable: true }), performed: compared };
  const contract = explainPaddedEmpty(contractFields({
    performed: compared,
    found: shown.length > 0,
    ran: `${status.sections.length} covered section(s) and ${status.orphans.length} orphaned lock entr(ies) compared`,
    decide: () => applies(projectDir, config),
    empty: d => (d.applies
      ? { emptyCause: 'needs-declaration', note: `Doc-Dependency has a ${DOC_LOCK_PATH} but it covers no section: ${d.evidence}, and no section declares covers=.`, howToConfigure: declareHow(d) }
      : { emptyCause: 'nothing-of-this-kind', note: `Doc-Dependency has a ${DOC_LOCK_PATH} but nothing to compare: ${d.evidence}.`, howToConfigure: NO_DOC_OR_SOURCE }),
  }));
  return unverifiable
    ? { ...result, ...contract, applicability: { status: 'partial', reason: `${unverifiable} covered section(s) could not be compared at their recorded fingerprint tier (a parser is unavailable here, or a different python3 serializes the code differently)` } }
    : { ...result, ...contract };
}
