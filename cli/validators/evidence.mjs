/**
 * Guard adapter for evidence-scoped verification.
 * @implements docguard.evidence-scoped-verification#FR-010
 */

import { evaluateEvidence } from '../evidence/evaluate.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const stateFinding = {
  contradicted: {
    code: 'EVD002', severity: 'error',
    suggestion: { kind: 'review', text: 'Review approved intent and the current source, then correct the regressed side.' },
  },
  stale: {
    code: 'EVD003', severity: 'warn',
    suggestion: { kind: 'fix', text: 'Regenerate the saved upstream report and refresh its declared input hashes.', command: 'docguard verify --evidence' },
  },
  inconclusive: {
    code: 'EVD004', severity: 'warn',
    suggestion: { kind: 'fix', text: 'Restore safe, unique evidence or narrow the declaration.', command: 'docguard verify --evidence' },
  },
  unsupported: {
    code: 'EVD005', severity: 'warn',
    suggestion: { kind: 'report', text: 'Contribute a synthetic failing fixture and neighboring valid control before expanding the adapter.' },
  },
};

export function validateEvidence(projectDir, config = {}) {
  const evaluation = evaluateEvidence(projectDir, config);
  if (!evaluation.exists) return { ...resultFromFindings([], { applicable: false }), evidence: evaluation };
  const findings = [];
  for (const error of evaluation.errors) {
    findings.push(mkFinding({
      code: 'EVD001', validator: 'evidence', severity: 'error', confidence: 'high',
      message: error.declarationId ? `${error.declarationId}: ${error.message}` : error.message,
      location: '.docguard-evidence.json',
      suggestion: { kind: 'fix', text: 'Repair the strict manifest contract, then rerun evidence verification.', command: 'docguard verify --evidence' },
      reportable: false,
    }));
  }
  for (const result of evaluation.results) {
    const contract = stateFinding[result.state];
    if (!contract) continue;
    findings.push(mkFinding({
      ...contract, validator: 'evidence', confidence: 'high',
      message: `${result.declarationId}: ${result.message} (${result.reasonCode})`,
      location: result.location, reportable: false,
    }));
  }
  const passed = evaluation.summary['verified-within-scope'] || 0;
  return { ...resultFromFindings(findings, { passed, total: passed + findings.length, applicable: true }), evidence: evaluation };
}
