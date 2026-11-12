import { mkFinding, resultFromFindings } from '../findings.mjs';
import { scanDocumentLifecycle } from '../scanners/document-lifecycle.mjs';
import { contractFields } from '../shared-result-contract.mjs';

/**
 * Whether Document-Lifecycle's kind of check belongs to the project: it reads
 * the Markdown files Git tracks, so it applies to a Git repository that tracks
 * at least one. Unreadable Git metadata is undecided and counts as applying.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const { scanned, coverage } = scanDocumentLifecycle(projectDir, config);
  if (coverage.status === 'unavailable' && coverage.reason === 'not-git') return { applies: false, evidence: 'not a git repository, so there is no list of tracked Markdown files to review for retirement' };
  if (coverage.status === 'unavailable') return { applies: true, evidence: `Git could not list the tracked files (${coverage.error}), so whether the project tracks Markdown is undecided` };
  return scanned > 0
    ? { applies: true, evidence: `Git tracks ${scanned} Markdown file(s)` }
    : { applies: false, evidence: 'Git tracks no Markdown file whose lifecycle status could be read' };
}

function lifecycleContract(projectDir, config, performed, found) {
  return contractFields({
    performed, found, ran: `reviewed the lifecycle of ${performed} tracked Markdown file(s)`,
    decide: () => applies(projectDir, config),
    empty: (decision) => decision.applies
      ? { emptyCause: 'needs-content', note: `Document-Lifecycle could not list the tracked files (${decision.evidence}), so it reviewed no document.`, howToConfigure: 'Restore read access to the repository\'s Git metadata and rerun `docguard guard`; Document-Lifecycle lists the Markdown files Git tracks.' }
      : { note: 'Document-Lifecycle found no tracked Markdown file to review (it needs a Git repository that tracks at least one), so no document was a retirement candidate.', howToConfigure: 'Nothing to configure unless the project tracks documents in Git: then Document-Lifecycle reviews their lifecycle status and completed task lists.' },
  });
}

/**
 * Finds terminal lifecycle declarations and specs whose task list is complete.
 * Both remain review signals; `retire --write` still requires explicit paths.
 */
export function validateDocumentLifecycle(projectDir, config = {}) {
  const { scanned, candidates, coverage } = scanDocumentLifecycle(projectDir, config);
  if (coverage.status === 'unavailable' && coverage.reason === 'not-git') {
    return { ...resultFromFindings([], { passed: 0, total: 0, applicable: false }), ...lifecycleContract(projectDir, config, 0, false) };
  }
  const findings = candidates.map(candidate => mkFinding({
    code: candidate.code,
    validator: 'documentLifecycle',
    severity: 'warn',
    confidence: candidate.confidence === 'high' ? 'high' : 'low',
    message: candidate.code === 'DLC001'
      ? `${candidate.path} declares terminal lifecycle status "${candidate.status}" but remains in active AI context.`
      : candidate.code === 'DLC004'
        ? `${candidate.path} is recorded as retired but remains in the working tree.`
        : `${candidate.path} has ${candidate.reason}`,
    location: candidate.path,
    suggestion: {
      kind: 'review',
      text: 'Confirm shipped outcomes are represented in current docs, then archive the explicit path.',
      command: `docguard retire --write --path ${candidate.path} --reason "<why this is no longer current>"`,
    },
  }));
  if (coverage.gap) {
    // docguard.verdict-contract#FR-004: a recorded gap, not a finding.
    return { ...resultFromFindings(findings, { passed: Math.max(0, scanned - candidates.length), total: scanned }), applicability: { status: 'partial', reason: `Document lifecycle could not list tracked files: ${coverage.error}` }, ...lifecycleContract(projectDir, config, scanned, findings.length > 0) };
  }
  if (coverage.status !== 'complete') {
    findings.push(mkFinding({
      code: 'DLC003',
      validator: 'documentLifecycle',
      severity: 'warn',
      confidence: 'high',
      message: coverage.status === 'unavailable'
        ? `Document lifecycle coverage is unavailable: ${coverage.error}`
        : `Document lifecycle coverage is partial; ${coverage.unreadable.length} tracked Markdown file(s) could not be read.`,
      location: coverage.unreadable[0] || null,
      suggestion: {
        kind: 'review',
        text: 'Restore readable Git/document access and rerun guard; an incomplete scan cannot prove lifecycle hygiene.',
      },
    }));
  }
  return {
    ...resultFromFindings(findings, {
      passed: Math.max(0, scanned - candidates.length),
      total: scanned + (coverage.status === 'unavailable' ? 1 : 0),
      applicable: scanned > 0 || coverage.status !== 'complete',
    }),
    ...lifecycleContract(projectDir, config, scanned, findings.length > 0),
  };
}
