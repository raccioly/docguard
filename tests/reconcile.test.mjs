import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildReconciliationPlan } from '../cli/scanners/reconciliation.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';

/**
 * @req docguard.document-lifecycle#FR-010
 * @req docguard.document-lifecycle#FR-011
 * @req docguard.document-lifecycle#FR-012
 * @req docguard.document-lifecycle#SC-006
 */

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-reconcile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'standard' }));
  write(dir, 'specs/001-auth/spec.md', '# Auth\n\n**Spec ID**: `acme.auth`\n\n- **FR-001**: Login MUST reject invalid credentials.\n');
  write(dir, 'specs/001-auth/tasks.md', '# Tasks\n\n- [x] T001 Implement login.\n');
  write(dir, 'src/auth.js', '/** @implements acme.auth#FR-001 */\nexport function login(ok) { return ok; }\n');
  write(dir, 'tests/auth.test.js', '/** @req acme.auth#FR-001 */\ntest("login", () => {});\n');
  write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'initial']);
  const registry = projectSpecRegistry(dir).registry;
  registry.specs[0].reviewed.lifecycle.approval = 'approved';
  registry.specs[0].reviewed.lifecycle.delivery = 'implemented';
  registry.specs[0].reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
  write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'registry']);
  return { dir, base: git(dir, ['rev-parse', 'HEAD']) };
}

function commit(dir, message) {
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', message]);
}

describe('Reconciliation review graph', () => {
  it('separates a possible code regression from a reviewed intentional change', t => {
    const { dir, base } = fixture(t);
    write(dir, 'src/auth.js', '/** @implements acme.auth#FR-001 */\nexport function login(ok) { return true; }\n');
    commit(dir, 'code only');
    let plan = buildReconciliationPlan(dir, {}, base);
    assert.equal(plan.classifications.find(item => item.path === 'src/auth.js').disposition, 'possible_implementation_regression');

    write(dir, 'specs/001-auth/spec.md', '# Auth\n\n**Spec ID**: `acme.auth`\n\n- **FR-001**: Login MUST allow the reviewed fallback.\n');
    commit(dir, 'reviewed intent');
    plan = buildReconciliationPlan(dir, {}, base);
    assert.equal(plan.classifications.find(item => item.path === 'src/auth.js').disposition, 'intentional_behavior_change_review');
  });

  it('keeps unrelated and unsupported changes distinct', t => {
    const { dir, base } = fixture(t);
    write(dir, 'README.md', '# Fixture\n');
    write(dir, 'src/unmapped.js', 'export const value = 1;\n');
    commit(dir, 'mixed changes');
    const plan = buildReconciliationPlan(dir, {}, base);
    assert.equal(plan.classifications.find(item => item.path === 'README.md').disposition, 'unrelated_change');
    assert.equal(plan.classifications.find(item => item.path === 'src/unmapped.js').disposition, 'unsupported_or_ambiguous');
  });

  it('reports mechanical scope without converting unsupported code into intent', t => {
    const { dir, base } = fixture(t);
    write(dir, 'src/config.js', 'export const timeout = process.env.TIMEOUT;\n');
    commit(dir, 'config source');
    const plan = buildReconciliationPlan(dir, {}, base);
    assert.ok(plan.classifications.some(item => item.disposition === 'mechanical_fact_refresh'));
    assert.equal(plan.classifications.find(item => item.path === 'src/config.js').evidenceClass, 'unsupported');
  });

  it('is byte-for-byte read-only and emits the same JSON graph through the CLI', t => {
    const { dir, base } = fixture(t);
    write(dir, 'README.md', '# Fixture\n');
    commit(dir, 'readme');
    const before = git(dir, ['status', '--porcelain=v1', '-uall']);
    const result = spawnSync(process.execPath, [CLI, 'reconcile', '--dir', dir, '--since', base, '--format', 'json'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.nodes.some(node => node.id === 'change:README.md'));
    assert.equal(git(dir, ['status', '--porcelain=v1', '-uall']), before);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# Fixture\n');
  });

  it('fails closed with explicit unsupported coverage for an invalid ref', t => {
    const { dir } = fixture(t);
    const plan = buildReconciliationPlan(dir, {}, 'missing-ref');
    assert.equal(plan.status, 'UNSUPPORTED');
    assert.equal(plan.coverage.status, 'unsupported');
  });
});
