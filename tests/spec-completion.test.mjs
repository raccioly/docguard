import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { completeSpec, normalizeExternalDeliveryStatus, planSpecCompletion } from '../cli/commands/specs.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';

/**
 * @req docguard.document-lifecycle#FR-016
 * @req docguard.document-lifecycle#FR-017
 * @req docguard.document-lifecycle#FR-020
 */

const passingGuard = { status: 'PASS', errors: 0, warnings: 0 };

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t, { checked = true, implementation = true, test = true, tasks = true, persistenceModel = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-complete-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  write(dir, 'specs/001-feature/spec.md', '# Feature\n\n**Spec ID**: `acme.feature`\n\n- **FR-001**: The system MUST work.\n');
  if (tasks) write(dir, 'specs/001-feature/tasks.md', `# Tasks\n\n- [${checked ? 'x' : ' '}] T001 Build.\n`);
  write(dir, 'packages/api/src/feature.js', `${implementation ? '/** @implements acme.feature#FR-001 */\n' : ''}export const feature = true;\n`);
  write(dir, 'packages/api/tests/feature.test.js', `${test ? '/** @req acme.feature#FR-001 */\n' : ''}test("feature", () => {});\n`);
  write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  write(dir, 'CHANGELOG.md', '# Changelog\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'initial']);
  const registry = projectSpecRegistry(dir).registry;
  registry.specs[0].reviewed.lifecycle.approval = 'approved';
  registry.specs[0].reviewed.lifecycle.delivery = 'implemented';
  registry.specs[0].reviewed.lifecycle.persistenceModel = persistenceModel;
  registry.specs[0].reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
  write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'registry']);
  return dir;
}

describe('Spec completion transaction', () => {
  it('normalizes common extension statuses without weakening registry enums', () => {
    assert.equal(normalizeExternalDeliveryStatus('completed'), 'implemented');
    assert.equal(normalizeExternalDeliveryStatus('validated'), 'verified');
    assert.equal(normalizeExternalDeliveryStatus('something else'), null);
  });

  it('moves implemented to verified, records a bounded outcome, and refreshes active context', t => {
    const dir = fixture(t);
    const revision = git(dir, ['rev-parse', 'HEAD']);
    const result = completeSpec(dir, {}, {
      id: 'acme.feature', since: revision, write: true, reason: 'Reviewed implementation and evidence.',
    }, { guardResult: passingGuard });
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.archiveReadiness.status, 'REVIEW');
    const registry = JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
    assert.equal(registry.schemaVersion, 2);
    assert.equal(registry.specs[0].reviewed.lifecycle.delivery, 'verified');
    assert.equal(registry.specs[0].reviewed.reconciliation.lastReviewedRevision, revision);
    assert.equal(registry.specs[0].reviewed.reconciliation.outcomes.length, 1);
    assert.match(readFileSync(join(dir, 'specs/001-feature/spec.md'), 'utf8'), /Implementation Outcomes/);
    const context = JSON.parse(readFileSync(join(dir, '.docguard/current-context.json'), 'utf8'));
    assert.equal(context.generatedFrom, revision);
    assert.deepEqual(context.specs.map(spec => spec.specId), ['acme.feature']);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('keeps living specs current and requires a successor for flow-forward retirement', t => {
    const dir = fixture(t);
    let registry = JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
    registry.specs[0].reviewed.lifecycle.persistenceModel = 'living';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'living policy']);
    let result = planSpecCompletion(dir, {}, { id: 'acme.feature', since: 'HEAD' }, { guardResult: passingGuard });
    assert.equal(result.archiveReadiness.status, 'KEEP_CURRENT');

    registry = JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
    registry.specs[0].reviewed.lifecycle.persistenceModel = 'flow_forward';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'flow-forward policy']);
    result = planSpecCompletion(dir, {}, { id: 'acme.feature', since: 'HEAD' }, { guardResult: passingGuard });
    assert.equal(result.archiveReadiness.status, 'BLOCKED');
    assert.match(result.archiveReadiness.reason, /successor/);
  });

  it('records reviewed maintenance for verified living specs and rejects empty repeats', t => {
    const dir = fixture(t);
    let registry = JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
    registry.specs[0].reviewed.lifecycle.persistenceModel = 'living';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'living policy']);
    const initialRevision = git(dir, ['rev-parse', 'HEAD']);
    assert.equal(completeSpec(dir, {}, {
      id: 'acme.feature', since: initialRevision, write: true, reason: 'Initial review.',
    }, { guardResult: passingGuard }).status, 'VERIFIED');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'initial outcome']);

    write(dir, 'packages/api/src/feature.js', '/** @implements acme.feature#FR-001 */\nexport const feature = false;\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'maintain feature']);
    const maintenanceRevision = git(dir, ['rev-parse', 'HEAD']);
    const plan = planSpecCompletion(dir, {}, { id: 'acme.feature' }, { guardResult: passingGuard });
    assert.equal(plan.status, 'READY');
    assert.equal(plan.transition, 'verified→verified');
    assert.equal(completeSpec(dir, {}, {
      id: 'acme.feature', write: true, reason: 'Reviewed living-spec maintenance.',
    }, { guardResult: passingGuard }).status, 'VERIFIED');
    registry = JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
    assert.equal(registry.specs[0].reviewed.reconciliation.lastReviewedRevision, maintenanceRevision);
    assert.equal(registry.specs[0].reviewed.reconciliation.outcomes.length, 2);
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'maintenance outcome']);

    const duplicate = planSpecCompletion(dir, {}, { id: 'acme.feature' }, { guardResult: passingGuard });
    assert.equal(duplicate.status, 'BLOCKED');
    assert.ok(duplicate.blockers.some(issue => issue.code === 'SPC006' && /new linked/.test(issue.message)));
  });

  it('blocks checked-task false assurance when qualified evidence is absent', t => {
    const dir = fixture(t, { implementation: false, test: false });
    const result = planSpecCompletion(dir, {}, {
      id: 'acme.feature', since: git(dir, ['rev-parse', 'HEAD']),
    }, { guardResult: passingGuard });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(issue => issue.code === 'SPC004'));
    assert.equal(existsSync(join(dir, '.docguard/current-context.json')), false);
  });

  it('accepts an evidence-complete living spec without manufacturing a stale task ledger', t => {
    const living = fixture(t, { tasks: false, persistenceModel: 'living' });
    const livingResult = planSpecCompletion(living, {}, {
      id: 'acme.feature', since: 'HEAD',
    }, { guardResult: passingGuard });
    assert.equal(livingResult.status, 'READY');
    assert.ok(!livingResult.blockers.some(issue => issue.code === 'SPC003'));

    const flowBack = fixture(t, { tasks: false, persistenceModel: 'flow_back' });
    const flowBackResult = planSpecCompletion(flowBack, {}, {
      id: 'acme.feature', since: 'HEAD',
    }, { guardResult: passingGuard });
    assert.equal(flowBackResult.status, 'BLOCKED');
    assert.ok(flowBackResult.blockers.some(issue => issue.code === 'SPC003' && /task ledger/.test(issue.message)));
  });

  it('requires both implementation and test evidence in a monorepo', t => {
    const dir = fixture(t, { test: false });
    const result = planSpecCompletion(dir, {}, {
      id: 'acme.feature', since: 'HEAD',
    }, { guardResult: passingGuard });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(issue => /qualified test annotation/.test(issue.message)));
    assert.ok(!result.blockers.some(issue => /source implementation annotation/.test(issue.message)));
  });

  it('blocks incomplete tasks and dirty tracked evidence', t => {
    const dir = fixture(t, { checked: false });
    write(dir, 'packages/api/src/feature.js', 'export const feature = false;\n');
    const result = planSpecCompletion(dir, {}, {
      id: 'acme.feature', since: 'HEAD',
    }, { guardResult: passingGuard });
    assert.ok(result.blockers.some(issue => issue.code === 'SPC001' && /clean tracked/.test(issue.message)));
    assert.ok(result.blockers.some(issue => issue.code === 'SPC003'));
  });
});
