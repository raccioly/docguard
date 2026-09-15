/**
 * Manage and preflight the deterministic spec lifecycle registry.
 * @implements docguard.document-lifecycle#FR-016
 * @implements docguard.document-lifecycle#FR-017
 * @implements docguard.document-lifecycle#FR-020
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeWrite } from '../writers/generate-io.mjs';
import { commitFileTransaction } from '../writers/file-transaction.mjs';
import { appendImplementationOutcome } from '../writers/spec-outcomes.mjs';
import { serializeLifecycleContext } from '../scanners/lifecycle-context.mjs';
import { buildReconciliationPlan } from '../scanners/reconciliation.mjs';
import { preflightSpec, projectSpecRegistry, readSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';
import { runGuardInternal } from './guard.mjs';

const CONTEXT_PATH = '.docguard/current-context.json';
const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;

export function normalizeExternalDeliveryStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  return new Map([
    ['planned', 'planned'], ['in_progress', 'in_progress'], ['started', 'in_progress'],
    ['implemented', 'implemented'], ['complete', 'implemented'], ['completed', 'implemented'], ['done', 'implemented'],
    ['verified', 'verified'], ['validated', 'verified'], ['released', 'released'], ['shipped', 'released'],
  ]).get(normalized) || null;
}

function headRevision(projectDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function trackedDirty(projectDir) {
  try {
    return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], {
      cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return 'git-unavailable'; }
}

function archiveReadiness(spec, targetVerified = false) {
  if (!spec) return { status: 'BLOCKED', reason: 'Spec identity is unresolved.' };
  const model = spec.reviewed.lifecycle.persistenceModel;
  const delivery = targetVerified ? 'verified' : spec.reviewed.lifecycle.delivery;
  if (model === 'living') return { status: 'KEEP_CURRENT', reason: 'Living specs remain in active context after verification.' };
  if (!model) return { status: 'REVIEW', reason: 'Choose a persistence model before retiring the verified spec.' };
  if (delivery !== 'verified' && delivery !== 'released') return { status: 'BLOCKED', reason: 'Spec must be verified before retirement.' };
  if (model === 'flow_forward' && !spec.reviewed.relations.supersededBy.length) {
    return { status: 'BLOCKED', reason: 'Flow-forward retirement requires a reviewed successor.' };
  }
  return { status: 'READY', reason: 'Run the reviewed spec retirement flow after the verified state is committed and retained.' };
}

function completionTransition(spec) {
  if (spec?.reviewed.lifecycle.persistenceModel === 'living'
    && ['verified', 'released'].includes(spec.reviewed.lifecycle.delivery)) {
    return `${spec.reviewed.lifecycle.delivery}→${spec.reviewed.lifecycle.delivery}`;
  }
  return spec?.reviewed.lifecycle.delivery === 'in_progress'
    ? 'in_progress→implemented→verified'
    : 'implemented→verified';
}

export function planSpecCompletion(projectDir, config, flags, options = {}) {
  const projection = projectSpecRegistry(projectDir, config);
  const loaded = readSpecRegistry(projectDir);
  const revision = headRevision(projectDir);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const blockers = [...projection.issues];
  if (!flags.id) blockers.push({ code: 'SPC001', message: 'Completion requires --id <spec-id>.' });
  if (!loaded.exists || loaded.error || !projection.current) blockers.push({ code: 'SPC001', message: 'Committed registry must be current before completion.' });
  if (!spec) blockers.push({ code: 'SPC001', message: `Unknown spec ID: ${flags.id || '<missing>'}.` });
  if (!revision) blockers.push({ code: 'SPC001', message: 'Completion requires a resolvable Git HEAD.' });
  if (trackedDirty(projectDir)) blockers.push({ code: 'SPC001', message: 'Completion requires a clean tracked working tree at the recorded revision.' });

  let reconcile = null;
  if (spec) {
    const maintenance = ['verified', 'released'].includes(spec.reviewed.lifecycle.delivery)
      && spec.reviewed.lifecycle.persistenceModel === 'living';
    if (spec.reviewed.lifecycle.approval !== 'approved') blockers.push({ code: 'SPC002', message: 'Only an approved spec can become verified.' });
    if (!['in_progress', 'implemented'].includes(spec.reviewed.lifecycle.delivery) && !maintenance) {
      blockers.push({ code: 'SPC002', message: `Expected delivery=in_progress, implemented, or verified with persistenceModel=living; found ${spec.reviewed.lifecycle.delivery}/${spec.reviewed.lifecycle.persistenceModel || 'unset'}.` });
    }
    const tasks = spec.observed.taskCompletion;
    const hasTaskLedger = spec.observed.artifacts.some(artifact => /(?:^|\/)tasks\.md$/i.test(artifact.path));
    if (hasTaskLedger && (!tasks.total || tasks.checked !== tasks.total)) {
      blockers.push({ code: 'SPC003', message: `All declared tasks must be checked (${tasks.checked}/${tasks.total}).` });
    } else if (!hasTaskLedger && spec.reviewed.lifecycle.persistenceModel !== 'living') {
      blockers.push({
        code: 'SPC003',
        message: 'Completion requires a task ledger unless the approved spec is a living verification contract with qualified evidence for every requirement.',
      });
    }
    if (spec.observed.implementationEvidence.length === 0) blockers.push({ code: 'SPC004', message: 'At least one qualified source implementation annotation is required.' });
    if (spec.observed.testEvidence.length === 0) blockers.push({ code: 'SPC004', message: 'At least one qualified test annotation is required.' });
    const covered = new Set([...spec.observed.implementationEvidence, ...spec.observed.testEvidence].map(item => item.requirementId));
    const missing = spec.intent.requirements
      .map(identity => identity.slice(identity.lastIndexOf('#') + 1))
      .filter(id => !covered.has(id));
    if (missing.length) blockers.push({ code: 'SPC004', message: `Qualified implementation or test evidence is missing for: ${missing.join(', ')}.` });
    if (spec.reviewed.scope.canonicalDocs.length === 0) blockers.push({ code: 'SPC005', message: 'Completion requires at least one reviewed affected canonical document.' });
    for (const path of spec.reviewed.scope.canonicalDocs) {
      if (!existsSync(resolve(projectDir, path))) blockers.push({ code: 'SPC005', message: `Affected canonical document is missing: ${path}.` });
    }
    const since = flags.since || spec.reviewed.reconciliation.lastReviewedRevision;
    if (!since) blockers.push({ code: 'SPC006', message: 'Completion requires --since <review-baseline> for the first reconciliation.' });
    else {
      reconcile = buildReconciliationPlan(projectDir, config, since);
      if (reconcile.status === 'UNSUPPORTED' || reconcile.status === 'BLOCKED') blockers.push({ code: 'SPC006', message: 'Reconciliation coverage is unsupported or blocked.' });
      const unresolved = reconcile.classifications.filter(item => item.disposition === 'unsupported_or_ambiguous');
      if (unresolved.length) blockers.push({ code: 'SPC006', message: `Unresolved changed files: ${unresolved.map(item => item.path).join(', ')}.` });
      if (maintenance) {
        const reviewable = reconcile.classifications.filter(item =>
          item.specs.includes(spec.specId)
          && ['source', 'test', 'canonical_doc', 'decision'].includes(item.kind));
        if (revision === spec.reviewed.reconciliation.lastReviewedRevision || reviewable.length === 0) {
          blockers.push({ code: 'SPC006', message: 'Living-spec maintenance requires a new linked source, test, canonical-document, or decision change since the last reviewed revision.' });
        }
      }
    }
  }
  const guard = options.guardResult || runGuardInternal(projectDir, config);
  if ((guard.errors || 0) > 0) blockers.push({ code: 'SPC007', message: `Guard has ${guard.errors} error(s).` });
  return {
    status: blockers.length ? 'BLOCKED' : 'READY',
    specId: flags.id || null,
    revision,
    transition: completionTransition(spec),
    blockers,
    reconciliation: reconcile,
    evidence: spec ? [...new Set([
      ...spec.observed.implementationEvidence.map(item => item.file),
      ...spec.observed.testEvidence.map(item => item.file),
      ...spec.reviewed.scope.canonicalDocs,
    ])].sort() : [],
    context: CONTEXT_PATH,
    archiveReadiness: archiveReadiness(spec, true),
    guard: { status: guard.status, errors: guard.errors, warnings: guard.warnings },
  };
}

export function completeSpec(projectDir, config, flags, options = {}) {
  const plan = planSpecCompletion(projectDir, config, flags, options);
  if (plan.status !== 'READY') return { command: 'complete', ...plan, applied: false };
  if (!flags.write) return { command: 'complete', ...plan, applied: false };
  const reason = String(flags.reason || '').replace(/\s+/g, ' ').trim();
  if (!reason || reason.length > 500) throw new Error('Completion --write requires --reason with 1-500 characters.');
  const projection = projectSpecRegistry(projectDir, config);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const specPath = resolve(projectDir, spec.path);
  const successor = flags.successor
    ? projection.registry.specs.find(entry => entry.specId === flags.successor) : null;
  if (flags.successor && (!successor || successor.reviewed.lifecycle.context !== 'current'
    || successor.reviewed.lifecycle.approval !== 'approved')) {
    throw new Error('Completion successor must be an approved current spec ID.');
  }
  const deviations = [...new Set(flags.deviations || [])]
    .map(item => String(item).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (deviations.length > 20 || deviations.some(item => item.length > 500)) {
    throw new Error('Completion accepts at most 20 deviations of 1-500 characters.');
  }
  const outcome = {
    revision: plan.revision,
    reason,
    evidence: plan.evidence,
    deviations,
    successor: flags.successor || null,
  };
  const specContent = appendImplementationOutcome(readFileSync(specPath, 'utf8'), outcome);
  if (spec.reviewed.lifecycle.delivery !== 'released') spec.reviewed.lifecycle.delivery = 'verified';
  spec.reviewed.reconciliation.lastReviewedRevision = plan.revision;
  spec.reviewed.reconciliation.outcomes = [...spec.reviewed.reconciliation.outcomes, outcome].slice(-20);
  const artifact = spec.observed.artifacts.find(item => item.path === spec.path);
  if (artifact) artifact.digest = digest(specContent);
  projection.registry.schemaVersion = 2;
  const registryContent = `${JSON.stringify(projection.registry, null, 2)}\n`;
  const contextContent = serializeLifecycleContext(projectDir, projection.registry, plan.revision);
  commitFileTransaction([
    { path: specPath, content: specContent },
    { path: resolve(projectDir, SPEC_REGISTRY_PATH), content: registryContent },
    { path: resolve(projectDir, CONTEXT_PATH), content: contextContent },
  ], {
    validate: () => {
      const next = projectSpecRegistry(projectDir, config);
      if (next.issues.length || !next.current) throw new Error('completed registry does not match the resulting repository');
      const context = JSON.parse(readFileSync(resolve(projectDir, CONTEXT_PATH), 'utf8'));
      if (context.generatedFrom !== plan.revision) throw new Error('active context revision mismatch');
    },
  });
  return { command: 'complete', ...plan, status: 'VERIFIED', applied: true, outcome };
}

function printIssues(issues) {
  for (const issue of issues) console.log(`  ${issue.code} ${issue.path}: ${issue.message}`);
}

function printResult(result) {
  if (result.command === 'complete') {
    console.log(`Spec completion: ${result.status}`);
    console.log(`${result.specId || '<missing>'}: ${result.transition}`);
    if (result.blockers?.length) printIssues(result.blockers.map(issue => ({ path: result.specId || SPEC_REGISTRY_PATH, ...issue })));
    return;
  }
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
  if (result.differences?.length) {
    console.log('Differences:');
    for (const difference of result.differences) {
      console.log(`  ${difference.path}: ${difference.message}`);
    }
  }
  if (result.issues.length) printIssues(result.issues);
}

export function runSpecs(projectDir, config, flags = {}) {
  try {
    const action = flags.args?.[0] || null;
    if (action && !['preflight', 'complete'].includes(action)) throw new Error(`Unknown specs action: ${action}`);
    if (flags.check && flags.write) throw new Error('Use either --check or --write, not both.');

    if (action === 'preflight') {
      if (flags.write) throw new Error('Specs preflight is read-only.');
      const result = { command: 'preflight', ...preflightSpec(projectDir, config, flags.path || null) };
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    if (action === 'complete') {
      const result = completeSpec(projectDir, config, flags);
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
      differences: projection.differences,
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
