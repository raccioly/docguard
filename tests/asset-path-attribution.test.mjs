/**
 * Reviewed asset paths (specs/039-asset-path-attribution): files a spec owns
 * that cannot name it are attributed by an exact, reviewed list, never by
 * inference, and a stale entry is reported.
 *
 * @req docguard.asset-path-attribution#FR-001
 * @req docguard.asset-path-attribution#FR-002
 * @req docguard.asset-path-attribution#FR-003
 * @req docguard.asset-path-attribution#FR-004
 * @req docguard.asset-path-attribution#FR-005
 * @req docguard.asset-path-attribution#SC-001
 * @req docguard.asset-path-attribution#SC-002
 * @req docguard.asset-path-attribution#SC-003
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assetPathCovers, projectSpecRegistry } from '../cli/scanners/spec-registry.mjs';
import { buildReconciliationPlan } from '../cli/scanners/reconciliation.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

/** A Spec Kit project with one spec, a frozen directory and an ordinary source file. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'asset-paths-'));
  temps.push(dir);
  const write = (rel, content) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); };
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'gc.auto', '0');
  write('.docguard.json', JSON.stringify({ projectName: 'acme' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  write('specs/001-alpha/spec.md', '# Feature Specification: Alpha\n\n**Spec ID**: `acme.alpha`\n\n## Requirements\n\n- **FR-001**: Alpha works.\n');
  write('bench/sample/a.mjs', 'export const a = 1;\n');
  write('bench/sample-two/c.mjs', 'export const c = 1;\n');
  write('src/b.mjs', 'export const b = 1;\n');
  spawnSync(process.execPath, [CLI, 'specs', '--write'], { cwd: dir, encoding: 'utf8' });
  git('add', '-A'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const registryPath = join(dir, '.docguard-specs.json');
  const setScope = scope => {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    Object.assign(registry.specs.find(s => s.specId === 'acme.alpha').reviewed.scope, scope);
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  };
  const commit = msg => { git('add', '-A'); git('commit', '-qm', msg); };
  return { dir, base, write, setScope, commit, registryPath };
}
const issuesOf = dir => projectSpecRegistry(dir).issues.filter(i => i.code === 'SPR003').map(i => i.message).join('\n');
const scopeOf = dir => projectSpecRegistry(dir).registry.specs.find(s => s.specId === 'acme.alpha').reviewed.scope;
const find = (plan, path) => plan.classifications.find(item => item.path === path);

describe('assetPaths is an exact, reviewed list (FR-001, SC-003)', () => {
  it('a directory entry ends in "/", any other entry is one file', () => {
    assert.equal(assetPathCovers('bench/sample/', 'bench/sample/a.mjs'), true);
    assert.equal(assetPathCovers('bench/sample/', 'bench/sample/deep/x.mjs'), true);
    assert.equal(assetPathCovers('bench/sample/', 'bench/sample-two/c.mjs'), false, 'a prefix is not a directory');
    assert.equal(assetPathCovers('bench/sample/a.mjs', 'bench/sample/a.mjs'), true);
    assert.equal(assetPathCovers('bench/sample/a.mjs', 'bench/sample/a.mjs.bak'), false);
    assert.equal(assetPathCovers('bench/sample', 'bench/sample/a.mjs'), false, 'without "/" it names a file');
  });

  it('keeps entries sorted and unique', () => {
    const { dir, setScope } = project();
    setScope({ assetPaths: ['src/b.mjs', 'bench/sample/', 'src/b.mjs'] });
    assert.equal(issuesOf(dir), '');
    assert.deepEqual(scopeOf(dir).assetPaths, ['bench/sample/', 'src/b.mjs']);
  });

  for (const [label, bad] of [['absolute', '/etc/passwd'], ['traversal', '../outside/'], ['.local', '.local/notes.md'], ['wildcard', 'bench/*/'], ['globstar', 'bench/**']]) {
    it(`rejects a ${label} entry`, () => {
      const { dir, setScope } = project();
      setScope({ assetPaths: [bad] });
      assert.match(issuesOf(dir), /assetPaths/);
    });
  }

  it('a registry without assetPaths serializes as before (FR-004, SC-002)', () => {
    const { dir, registryPath } = project();
    const before = readFileSync(registryPath, 'utf8');
    spawnSync(process.execPath, [CLI, 'specs', '--write'], { cwd: dir, encoding: 'utf8' });
    assert.equal(readFileSync(registryPath, 'utf8'), before);
    assert.equal('assetPaths' in scopeOf(dir), false);
  });
});

describe('reconciliation links a covered file to its owner (FR-002)', () => {
  it('an unannotated file under an asset path is linked; one outside stays unsupported', () => {
    const { dir, base, write, setScope, commit } = project();
    setScope({ assetPaths: ['bench/sample/'] });
    commit('own the frozen sample');
    const since = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    write('bench/sample/a.mjs', 'export const a = 2;\n');
    write('bench/sample-two/c.mjs', 'export const c = 2;\n');
    write('src/b.mjs', 'export const b = 2;\n');
    commit('change all three');
    const plan = buildReconciliationPlan(dir, {}, since);
    assert.deepEqual(find(plan, 'bench/sample/a.mjs').specs, ['acme.alpha']);
    assert.notEqual(find(plan, 'bench/sample/a.mjs').disposition, 'unsupported_or_ambiguous');
    assert.equal(find(plan, 'bench/sample-two/c.mjs').disposition, 'unsupported_or_ambiguous', 'a sibling with a shared prefix is not covered');
    assert.equal(find(plan, 'src/b.mjs').disposition, 'unsupported_or_ambiguous');
    assert.ok(base);
  });
});

describe('a stale entry is reported, not trusted (FR-003)', () => {
  it('SPR009 names the spec and every entry that covers no tracked file', () => {
    const { dir, setScope, commit } = project();
    setScope({ assetPaths: ['bench/sample/', 'bench/gone/', 'src/missing.mjs'] });
    commit('stale entries');
    const spr009 = validateSpecRegistry(dir, {}).findings.filter(f => f.code === 'SPR009');
    assert.deepEqual(spr009.map(f => f.message).sort(), [
      'acme.alpha lists asset path bench/gone/, which covers no tracked file',
      'acme.alpha lists asset path src/missing.mjs, which covers no tracked file',
    ]);
    assert.ok(spr009.every(f => f.disposition === 'act' && f.severity === 'warn'));
  });

  it('an untracked file does not satisfy an entry inside git', () => {
    const { dir, setScope, write, commit } = project();
    setScope({ assetPaths: ['bench/new/'] });
    commit('entry first');
    write('bench/new/x.mjs', 'export const x = 1;\n');
    assert.equal(validateSpecRegistry(dir, {}).findings.filter(f => f.code === 'SPR009').length, 1);
  });

  it('outside git, a file on disk satisfies the entry', () => {
    const { dir, setScope } = project();
    setScope({ assetPaths: ['bench/sample/', 'bench/gone/'] });
    const plain = mkdtempSync(join(tmpdir(), 'asset-paths-nogit-'));
    temps.push(plain);
    cpSync(dir, plain, { recursive: true, filter: src => !src.split(/[\\/]/).includes('.git') });
    const spr009 = validateSpecRegistry(plain, {}).findings.filter(f => f.code === 'SPR009');
    assert.deepEqual(spr009.map(f => f.message), ['acme.alpha lists asset path bench/gone/, which covers no file']);
  });
});

describe('this repository: spec 036 owns its frozen benchmark assets (FR-005, SC-001)', () => {
  const REPO = resolve('.');
  const registry = JSON.parse(readFileSync(join(REPO, '.docguard-specs.json'), 'utf8'));
  const symbolMap = registry.specs.find(s => s.specId === 'docguard.symbol-map');
  const budget = registry.specs.find(s => s.specId === 'docguard.agent-instruction-budget');

  it('lists the ledger-service fixture and the three ledger evaluators and references', () => {
    assert.deepEqual(symbolMap.reviewed.scope.assetPaths, [
      'benchmarks/agent-context/fixtures/ledger-service/',
      'benchmarks/agent-context/hidden/ledger-late-fee/',
      'benchmarks/agent-context/hidden/ledger-redaction/',
      'benchmarks/agent-context/hidden/ledger-rounding/',
      'benchmarks/agent-context/reference/ledger-late-fee/',
      'benchmarks/agent-context/reference/ledger-redaction/',
      'benchmarks/agent-context/reference/ledger-rounding/',
    ]);
  });

  it('017\'s maintenance plan resolves every benchmark file; without the list it would not', { skip: !budget?.reviewed?.reconciliation?.lastReviewedRevision }, () => {
    const since = budget.reviewed.reconciliation.lastReviewedRevision;
    const unresolved = plan => plan.classifications
      .filter(item => item.disposition === 'unsupported_or_ambiguous' && item.path?.startsWith('benchmarks/agent-context/'))
      .map(item => item.path);
    assert.deepEqual(unresolved(buildReconciliationPlan(REPO, {}, since)), []);
    // Reproduce the block on a copy whose registry lacks the list.
    const copy = mkdtempSync(join(tmpdir(), 'asset-paths-repo-'));
    temps.push(copy);
    spawnSync('git', ['clone', '-q', '--no-hardlinks', REPO, copy]);
    spawnSync('git', ['checkout', '-q', spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim()], { cwd: copy });
    const stripped = JSON.parse(readFileSync(join(REPO, '.docguard-specs.json'), 'utf8'));
    delete stripped.specs.find(s => s.specId === 'docguard.symbol-map').reviewed.scope.assetPaths;
    writeFileSync(join(copy, '.docguard-specs.json'), `${JSON.stringify(stripped, null, 2)}\n`);
    assert.ok(unresolved(buildReconciliationPlan(copy, {}, since)).length > 0, 'the block reproduces without the reviewed list');
  });
});
