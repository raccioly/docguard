#!/usr/bin/env node

/** @implements docguard.precision-evidence-loop#FR-006 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBenchmark } from './lib/runner.mjs';
import { compareBenchmarkCores, compareRuntimeObservations } from './lib/compare.mjs';
import { benchmarkProvenance, buildBaselineEnvelope, loadBaseline } from './lib/baseline.mjs';
import { safeWrite } from '../cli/writers/generate-io.mjs';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

try {
  const split = valueAfter('--split');
  if (split && !['development', 'evaluation'].includes(split)) throw new Error('--split must be development or evaluation.');
  // Validate the reviewed baseline before spending minutes on a run it cannot be compared with.
  const baselinePath = valueAfter('--baseline');
  const baseline = baselinePath ? loadBaseline(baselinePath) : null;
  const writeBaselinePath = valueAfter('--write-baseline');
  if (writeBaselinePath && existsSync(resolve(writeBaselinePath)) && !args.includes('--replace-baseline')) {
    throw new Error('Baseline already exists; pass --replace-baseline after review to replace it.');
  }
  const result = runBenchmark({
    manifestPath: resolve(valueAfter('--manifest') || 'benchmarks/corpus.json'),
    includeExternal: args.includes('--external'),
    keep: args.includes('--keep'),
    split,
  });
  // Every report says what its ratios are, whether or not it is persisted.
  result.provenance = benchmarkProvenance(result.core);
  if (baseline) {
    result.comparison = {
      baseline: { review: baseline.review, tool: baseline.core.tool },
      core: compareBenchmarkCores(baseline.core, result.core, { selectedIds: result.selection.caseIds }),
      runtime: compareRuntimeObservations(baseline.observations, result.observations),
    };
  }
  if (writeBaselinePath) {
    const envelope = buildBaselineEnvelope({ core: result.core, observations: result.observations });
    safeWrite(resolve(writeBaselinePath), `${JSON.stringify(envelope, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.core.cases.some(item => item.status === 'FAIL') || result.comparison?.core.status === 'FAIL') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
}
