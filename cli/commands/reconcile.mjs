/**
 * Review code/spec changes before any documentation intent is changed.
 * @implements docguard.document-lifecycle#FR-010
 * @implements docguard.document-lifecycle#FR-012
 */

import { buildReconciliationPlan } from '../scanners/reconciliation.mjs';
import { runSync } from './sync.mjs';

function printPlan(result, flags = {}) {
  console.log(`Reconciliation: ${result.status}`);
  console.log(`Revision: ${result.baseRevision || 'unknown'} → ${result.revision || 'unknown'}`);
  if (result.range) console.log(`Range: ${result.range.commitCount ?? 'unknown'} commit(s), ${result.range.changedFileCount} changed file(s)`);
  if (result.coverage?.status !== 'complete') {
    console.log(`Coverage: ${result.coverage.status} — ${result.coverage.reason}`);
  }
  const maximum = flags.verbose ? result.classifications.length : 20;
  for (const item of result.classifications.slice(0, maximum)) {
    console.log(`  [${item.confidence}] ${item.path || item.kind}: ${item.disposition}`);
  }
  const elided = result.classifications.length - maximum;
  if (elided > 0) console.log(`  … ${elided} more classification(s); rerun with --verbose to list all.`);
  if (result.writes.length) console.log(`Mechanical write available: ${result.writes[0].command}`);
}

export function runReconcile(projectDir, config, flags = {}) {
  try {
    if (flags.write && flags.check) throw new Error('Use either --check or --write, not both.');
    const plan = buildReconciliationPlan(projectDir, config, flags.since);
    let mechanical = null;
    if (flags.write) {
      if (plan.status === 'UNSUPPORTED' || plan.status === 'BLOCKED') {
        throw new Error('Reconciliation write refused because evidence coverage is incomplete or the registry is invalid.');
      }
      mechanical = runSync(projectDir, config, { ...flags, write: true, silent: true });
    }
    const result = { command: 'reconcile', ...plan, applied: Boolean(flags.write), mechanical };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else printPlan(result, flags);
    if (flags.check && !['READY'].includes(result.status)) process.exitCode = 2;
    return result;
  } catch (error) {
    const result = { command: 'reconcile', status: 'ERROR', error: error.message };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return result;
  }
}
