/** Manage and preflight the deterministic spec lifecycle registry. */

import { resolve } from 'node:path';
import { safeWrite } from '../writers/generate-io.mjs';
import { preflightSpec, projectSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';

function printIssues(issues) {
  for (const issue of issues) console.log(`  ${issue.code} ${issue.path}: ${issue.message}`);
}

function printResult(result) {
  if (result.command === 'preflight') {
    console.log(`Spec preflight: ${result.status}`);
    console.log(`Current specs: ${result.briefing.length}`);
    for (const spec of result.briefing) {
      console.log(`  ${spec.specId} — ${spec.approval}/${spec.delivery}; tasks ${spec.taskCompletion.checked}/${spec.taskCompletion.total}; test evidence ${spec.testEvidence}`);
    }
    if (result.blockers.length) {
      console.log('Blockers:');
      printIssues(result.blockers);
    }
    if (result.overlaps.length) {
      console.log('Review-only semantic overlap:');
      for (const overlap of result.overlaps) console.log(`  ${(overlap.similarity * 100).toFixed(0)}% ${overlap.specId} (${overlap.path})`);
    }
    return;
  }
  console.log(`Spec registry: ${result.status}`);
  console.log(`Registry: ${SPEC_REGISTRY_PATH}`);
  console.log(`Specs: ${result.specs}; tombstones: ${result.tombstones}`);
  if (result.issues.length) printIssues(result.issues);
}

export function runSpecs(projectDir, config, flags = {}) {
  try {
    const action = flags.args?.[0] || null;
    if (action && action !== 'preflight') throw new Error(`Unknown specs action: ${action}`);
    if (flags.check && flags.write) throw new Error('Use either --check or --write, not both.');

    if (action === 'preflight') {
      if (flags.write) throw new Error('Specs preflight is read-only.');
      const result = { command: 'preflight', ...preflightSpec(projectDir, config, flags.path || null) };
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    const projection = projectSpecRegistry(projectDir, config);
    if (flags.write && projection.issues.length > 0) {
      throw new Error(`Registry refresh refused: ${projection.issues.map(issue => issue.message).join(' ')}`);
    }
    let status = projection.current ? 'CURRENT' : projection.exists ? 'STALE' : 'MISSING';
    if (flags.write && !projection.current) {
      safeWrite(resolve(projectDir, SPEC_REGISTRY_PATH), projection.serialized);
      status = 'WRITTEN';
    }
    const result = {
      command: 'specs',
      status,
      registry: SPEC_REGISTRY_PATH,
      specs: projection.registry.specs.length,
      tombstones: projection.registry.tombstones.length,
      issues: projection.issues,
    };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else printResult(result);
    if (flags.check && (status !== 'CURRENT' || result.issues.length > 0)) process.exitCode = 2;
    return result;
  } catch (error) {
    const result = { command: 'specs', status: 'ERROR', error: error.message };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return result;
  }
}
