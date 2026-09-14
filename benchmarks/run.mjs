#!/usr/bin/env node

import { resolve } from 'node:path';
import { runBenchmark } from './lib/runner.mjs';

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
  console.log(JSON.stringify(result, null, 2));
  if (result.core.cases.some(item => item.status === 'FAIL')) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'ERROR', error: error.message }, null, 2));
  process.exitCode = 1;
}
