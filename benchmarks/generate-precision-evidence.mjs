#!/usr/bin/env node

/**
 * Regenerates the shipped per-code benchmark evidence from the reviewed
 * baseline. `benchmarks/` is not part of the published package, so the evidence
 * DocGuard quotes at runtime has to live under `cli/` as a generated module.
 * A test compares the committed module against this projection, so drift fails
 * the suite instead of shipping a stale number.
 *
 * @implements docguard.precision-evidence-loop#FR-019
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBaseline } from './lib/baseline.mjs';
import { derivePrecisionEvidence } from './lib/precision-evidence.mjs';
import { safeWrite } from '../cli/writers/generate-io.mjs';

export const EVIDENCE_MODULE_PATH = 'cli/precision-evidence-data.mjs';

export function renderEvidenceModule(evidence) {
  return `/**
 * GENERATED FILE — do not edit.
 * Regenerate with: npm run generate:precision-evidence
 * Source: benchmarks/baseline.json (reviewed precision benchmark).
 *
 * Every ratio here is benchmark precision on labelled, deliberately balanced
 * cases. It is not the probability that a finding in a user's repository is
 * real, and a code absent from \`byCode\` has no benchmark evidence at all.
 */

export const PRECISION_EVIDENCE = Object.freeze(${JSON.stringify(evidence, null, 2)});
`;
}

export function evidenceProjection(baselinePath = 'benchmarks/baseline.json') {
  return derivePrecisionEvidence(loadBaseline(baselinePath));
}

export function committedEvidenceModule(modulePath = EVIDENCE_MODULE_PATH) {
  return readFileSync(resolve(modulePath), 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('generate-precision-evidence.mjs')) {
  try {
    const rendered = renderEvidenceModule(evidenceProjection());
    safeWrite(resolve(EVIDENCE_MODULE_PATH), rendered);
    console.log(`Wrote ${EVIDENCE_MODULE_PATH}`);
  } catch (error) {
    console.error(`Failed to generate precision evidence: ${error.message}`);
    process.exitCode = 1;
  }
}
