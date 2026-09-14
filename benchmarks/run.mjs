#!/usr/bin/env node

/** @implements docguard.precision-evidence-loop#FR-006 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBenchmark } from './lib/runner.mjs';
import { compareBenchmarkCores, compareRuntimeObservations } from './lib/compare.mjs';
import { safeWrite } from '../cli/writers/generate-io.mjs';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

try {
  const split = valueAfter('--split');
  if (split && !['development', 'evaluation'].includes(split)) throw new Error('--split must be development or evaluation.');
  const result = runBenchmark({
    manifestPath: resolve(valueAfter('--manifest') || 'benchmarks/corpus.json'),
    includeExternal: args.includes('--external'),
    keep: args.includes('--keep'),
    split,
  });
  const baselinePath = valueAfter('--baseline');
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'));
    result.comparison = {
      core: compareBenchmarkCores(baseline.core, result.core),
      runtime: compareRuntimeObservations(baseline.observations, result.observations),
    };
  }
  const writeBaselinePath = valueAfter('--write-baseline');
  if (writeBaselinePath) {
    const target = resolve(writeBaselinePath);
    if (existsSync(target) && !args.includes('--replace-baseline')) {
      throw new Error('Baseline already exists; pass --replace-baseline after review to replace it.');
    }
    safeWrite(target, `${JSON.stringify({
      schemaVersion: 1,
      review: {
        status: 'candidate',
        methodology: 'Labels were authored from pinned source and seeded mutations before DocGuard output was reviewed.',
        limitations: 'Finite scoped cases do not establish exhaustive documentation or detector correctness.',
      },
      core: result.core,
      observations: result.observations,
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.core.cases.some(item => item.status === 'FAIL') || result.comparison?.core.status === 'FAIL') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
}
