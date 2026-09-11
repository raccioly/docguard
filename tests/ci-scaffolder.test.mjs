import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const template = readFileSync(new URL('../templates/ci/github-actions.yml', import.meta.url), 'utf8');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

describe('init CI scaffolder', () => {
  let dir, outside, target;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-ci-scaffold-'));
    outside = mkdtempSync(join(tmpdir(), 'dg-ci-outside-'));
    target = join(dir, '.github/workflows/docguard.yml');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', version: '9.8.7' }));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  const init = (...args) => run('init', '--skip-prompts', '--no-spec-kit', '--profile', 'starter', '--with', 'ci', ...args);
  const success = result => assert.equal(result.status, 0, result.stderr + result.stdout);

  it('creates the real workflow verbatim with the shipped version, not the consumer version', () => {
    success(init());
    const actual = readFileSync(target, 'utf8');
    assert.equal(actual, template);
    assert.ok(actual.includes(`docguard-cli@${version}`));
    assert.ok(!actual.includes('docguard-cli@9.8.7'));
    assert.ok(actual.includes('${{ env.DOCGUARD_REPORT }}'));
    assert.equal(existsSync(join(dir, '.docguard/history.jsonl')), false);
  });

  it('preserves an existing workflow on repeated init without creating a backup', () => {
    success(init());
    writeFileSync(target, '# Hand-maintained workflow\n');
    success(init());
    assert.equal(readFileSync(target, 'utf8'), '# Hand-maintained workflow\n');
    assert.equal(existsSync(target + '.bak'), false);
  });

  it('honors explicit CI scaffolding after smart init of an existing codebase', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/index.mjs'), 'export const value = 1;\n');
    const result = run('init', '--no-spec-kit', '--with', 'ci');
    success(result);
    assert.match(result.stdout, /Smart Mode/);
    assert.equal(readFileSync(target, 'utf8'), template);
  });

  for (const original of ['# Existing workflow\n', '']) {
    it(`backs up and replaces an ${original ? 'existing' : 'empty'} workflow with explicit force`, () => {
      mkdirSync(join(dir, '.github/workflows'), { recursive: true });
      writeFileSync(target, original);
      success(init('--force'));
      assert.equal(readFileSync(target, 'utf8'), template);
      assert.equal(readFileSync(target + '.bak', 'utf8'), original);
    });
  }

  for (const component of ['.github', '.github/workflows', '.github/workflows/docguard.yml', '.github/workflows/docguard.yml.bak']) {
    it(`refuses a symlink at ${component} even with force`, () => {
      const path = join(dir, component);
      mkdirSync(join(path, '..'), { recursive: true });
      const external = component.endsWith('.yml') || component.endsWith('.bak') ? join(outside, 'sentinel') : outside;
      if (external !== outside) writeFileSync(external, 'untouched');
      symlinkSync(external, path);
      const result = init('--force');
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /Unsafe CI scaffold path/);
      if (external !== outside) assert.equal(readFileSync(external, 'utf8'), 'untouched');
      else assert.deepEqual(readdirSync(outside), []);
    });
  }

  it('refuses dangling workflow symlinks', () => {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    const external = join(outside, 'missing');
    symlinkSync(external, target);
    const result = init('--force');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe CI scaffold path/);
    assert.equal(existsSync(external), false);
  });

  it('keeps stacked scaffolders ordered and continues after CI creation', () => {
    const result = run('init', '--skip-prompts', '--no-spec-kit', '--profile', 'starter', '--with', 'badge,ci,llms');
    success(result);
    assert.ok(result.stdout.indexOf('── badge ──') < result.stdout.indexOf('── ci ──'));
    assert.ok(result.stdout.indexOf('── ci ──') < result.stdout.indexOf('── llms ──'));
    assert.equal(readFileSync(target, 'utf8'), template);
    assert.equal(existsSync(join(dir, 'llms.txt')), true);
  });

  it('stops later scaffolders after an unsafe CI destination', () => {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    mkdirSync(target);
    const result = run('init', '--skip-prompts', '--no-spec-kit', '--profile', 'starter', '--with', 'ci,llms');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe CI scaffold path/);
    assert.ok(!result.stdout.includes('── llms ──'));
    assert.equal(existsSync(join(dir, 'llms.txt')), false);
  });

  it('leaves standalone CI as a machine-readable gate without scaffolding', () => {
    const result = run('ci', '--no-history', '--format', 'json');
    const output = JSON.parse(result.stdout);
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(output.status));
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(join(dir, '.docguard/history.jsonl')), false);
    assert.ok(!result.stdout.includes('Scaffolders:'));
  });
});
