/**
 * Guard adapter for evidence-scoped verification.
 * @implements docguard.evidence-scoped-verification#FR-010
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateEvidence } from '../evidence/evaluate.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { extractSemanticClaims } from '../scanners/semantic-claims.mjs';
import { contractFields } from '../shared-result-contract.mjs';

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

/**
 * Does this kind of check belong to the project? Only a project that declared a
 * manifest (`.docguard-evidence.json`).
 *
 * This is one of two declared-only validators (the other is Doc-Ownership), by
 * the coordinator's decision on spec 097 FR-006. The manifest supports four
 * source adapters, so a claim such as "30 days" with no file behind it cannot be
 * declared; a red that cannot always be resolved is what the strict default must
 * not produce. Guard's semantic-claims line keeps reporting how many documented
 * claims are unverified.
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const claims = extractSemanticClaims(projectDir, config);
  if (!existsSync(resolve(projectDir, '.docguard-evidence.json'))) {
    return { applies: false, evidence: `no .docguard-evidence.json manifest is declared${claims.length ? `; the ${claims.length} documented claim(s) with a unit or an enumerated list remain reported by guard's semantic-claims line` : ''}`, first: claims[0] };
  }
  return { applies: true, evidence: '.docguard-evidence.json is declared', first: claims[0] };
}

const MANIFEST_HOW = (d) => `Write ${'.docguard-evidence.json'} with one declaration per claim you want backed. Each ties a sentence in a document (target.document, target.heading, target.statement with one {{value}} slot) to the file that proves it (source: a json-pointer into a JSON file, a collection-count over a glob, a python-literal-count, or a saved oasdiff or buf report) and a predicate (equals, set-equals, count-equals or no-findings). ${d.first ? `Start from the claim at ${d.first.doc}:${d.first.line}; ` : ''}The schema is schemas/docguard-evidence.schema.json, and \`docguard verify --evidence\` runs the declarations. A claim with no file behind it cannot be declared: leave it out.`;

export function validateEvidence(projectDir, config = {}) {
  const evaluation = evaluateEvidence(projectDir, config);
  if (!evaluation.exists) {
    return {
      ...resultFromFindings([], { applicable: false }), evidence: evaluation,
      ...contractFields({
        performed: 0,
        decide: () => applies(projectDir, config),
        empty: d => ({ emptyCause: 'nothing-of-this-kind', note: `Evidence has no manifest to verify: ${d.evidence}.`, howToConfigure: `Nothing to configure until you declare a manifest: .docguard-evidence.json ties a statement in a document to the file that proves it (json-pointer, collection-count, python-literal-count, or a saved oasdiff or buf report). ${MANIFEST_HOW(d)}` }),
      }),
    };
  }
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
  const performed = evaluation.results.length;
  return {
    ...resultFromFindings(findings, { passed, total: passed + findings.length, applicable: true }), evidence: evaluation,
    ...contractFields({
      performed,
      found: findings.length > 0,
      ran: `${performed} evidence declaration(s) evaluated against their sources`,
      decide: () => applies(projectDir, config),
      // A valid manifest declares at least one declaration, so this is a manifest the strict loader refused.
      empty: d => ({ emptyCause: 'needs-content', note: 'Evidence read .docguard-evidence.json and evaluated no declaration.', howToConfigure: `Add at least one declaration to .docguard-evidence.json. ${MANIFEST_HOW(d)}` }),
    }),
  };
}
