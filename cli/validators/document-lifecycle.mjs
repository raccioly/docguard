import { mkFinding, resultFromFindings } from '../findings.mjs';
import { scanDocumentLifecycle } from '../scanners/document-lifecycle.mjs';

/**
 * Finds terminal lifecycle declarations and specs whose task list is complete.
 * Both remain review signals; `retire --write` still requires explicit paths.
 */
export function validateDocumentLifecycle(projectDir, config = {}) {
  const { scanned, candidates, coverage } = scanDocumentLifecycle(projectDir, config);
  if (coverage.status === 'unavailable' && coverage.reason === 'not-git') {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
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
  return resultFromFindings(findings, {
    passed: Math.max(0, scanned - candidates.length),
    total: scanned + (coverage.status === 'unavailable' ? 1 : 0),
    applicable: scanned > 0 || coverage.status !== 'complete',
  });
}
