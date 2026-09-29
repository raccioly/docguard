/**
 * Spec-first change gate — `docguard specs require`.
 *
 * @req docguard.spec-first-gate#FR-001
 * @req docguard.spec-first-gate#FR-002
 * @req docguard.spec-first-gate#FR-003
 * @req docguard.spec-first-gate#FR-004
 * @req docguard.spec-first-gate#FR-005
 * @req docguard.spec-first-gate#FR-006
 * @req docguard.spec-first-gate#FR-007
 * @req docguard.spec-first-gate#SC-002
 * @req docguard.spec-first-gate#SC-003
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { classifySpecFirst } from '../cli/scanners/spec-first.mjs';

const CLI = resolve('cli/docguard.mjs');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

function write(dir, rel, content) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

function commit(dir, message) {
  git(dir, 'add', '-A');
  const r = git(dir, 'commit', '-q', '-m', message);
  assert.equal(r.status, 0, r.stderr);
}

function repo({ config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-first-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  write(dir, '.docguard.json', JSON.stringify({ projectName: 't', ...(config ? { specFirst: config } : {}) }));
  write(dir, 'specs/001-feature/spec.md', '# Feature\n\n**Spec ID**: `acme.feature`\n');
  write(dir, 'cli/a.mjs', 'export const a = 1;\n');
  commit(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'topic');
  return dir;
}

function check(dir, { body, since = 'main' } = {}) {
  const args = [CLI, 'specs', 'require', '--since', since, '--format', 'json'];
  if (body !== undefined) {
    write(dir, '.pr-body.txt', body);
    args.push('--message-file', '.pr-body.txt');
  }
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
  return { status: r.status, json: JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))) };
}

describe('docguard specs require', () => {
  let dir;
  beforeEach(() => { dir = repo({ config: { paths: ['cli/**'] } }); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('passes a change that touches no governed path', () => {
    write(dir, 'README.md', '# hi\n');
    commit(dir, 'docs');
    const { status, json } = check(dir);
    assert.equal(json.status, 'not-governed');
    assert.equal(status, 0);
  });

  it('fails a governed change that names no spec (exit 1)', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'tweak');
    const { status, json } = check(dir);
    assert.equal(json.status, 'uncovered');
    assert.deepEqual(json.governed, ['cli/a.mjs']);
    assert.equal(status, 1);
  });

  it('passes when the description names an existing spec path', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'tweak');
    const { status, json } = check(dir, { body: 'Implements specs/001-feature.' });
    assert.equal(json.status, 'covered');
    assert.equal(json.references[0].spec, 'specs/001-feature');
    assert.equal(status, 0);
  });

  it('passes when a commit message names the Spec ID', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'feat: part of acme.feature');
    assert.equal(check(dir).json.status, 'covered');
  });

  it('passes when the change edits the spec it implements', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    write(dir, 'specs/001-feature/tasks.md', '- [x] T001 done\n');
    commit(dir, 'tweak');
    assert.equal(check(dir).json.status, 'covered');
  });

  it('never accepts a reference to a spec that does not exist', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'tweak');
    const { status, json } = check(dir, { body: 'See specs/999-imaginary' });
    assert.equal(json.status, 'uncovered');
    assert.deepEqual(json.unresolved, ['specs/999-imaginary']);
    assert.equal(status, 1);
  });

  it('accepts a declared exemption with an allowed kind and a reason', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'tweak');
    const { status, json } = check(dir, { body: 'Spec-Exempt: typo — fix a misspelled flag name in help text' });
    assert.equal(json.status, 'exempt');
    assert.deepEqual(json.exemption, { kind: 'typo', reason: 'fix a misspelled flag name in help text' });
    assert.equal(status, 0);
  });

  it('rejects an exemption with an unknown kind or a short reason', () => {
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'tweak');
    const { json } = check(dir, { body: 'Spec-Exempt: vibes — because I said so\nSpec-Exempt: typo - x' });
    assert.equal(json.status, 'uncovered');
    assert.deepEqual(json.invalidExemptions.map(e => e.problem), ['unknown kind', 'reason shorter than 10 characters']);
  });

  it('is inconclusive (exit 2), never a pass, for an unknown base ref', () => {
    const { status, json } = check(dir, { since: 'no-such-ref' });
    assert.equal(json.status, 'inconclusive');
    assert.equal(status, 2);
  });

  it('counts a deleted governed file as changed', () => {
    git(dir, 'rm', '-q', 'cli/a.mjs');
    commit(dir, 'remove');
    assert.deepEqual(check(dir).json.governed, ['cli/a.mjs']);
  });
});

describe('default governed set (no specFirst config)', () => {
  it('governs code but not Markdown, specs/ or tests', () => {
    const inventory = { dirs: new Set(), ids: new Map() };
    const result = classifySpecFirst({
      paths: ['README.md', 'specs/001-x/spec.md', 'tests/a.test.mjs', 'src/app.test.ts', 'pkg/x_test.go', 'test_mod.py', 'src/app.ts'],
      text: '',
      config: {},
      inventory,
    });
    assert.deepEqual(result.governed, ['src/app.ts']);
    assert.equal(result.status, 'uncovered');
  });

  it('honours configured exemption kinds', () => {
    const result = classifySpecFirst({
      paths: ['src/app.ts'],
      text: 'Spec-Exempt: hotfix — production outage rollback',
      config: { specFirst: { exemptKinds: ['hotfix'] } },
      inventory: { dirs: new Set(), ids: new Map() },
    });
    assert.equal(result.status, 'exempt');
  });
});

/**
 * @req docguard.spec-first-gate#FR-008
 * @req docguard.spec-first-gate#FR-009
 * @req docguard.spec-first-gate#FR-010
 * @req docguard.spec-first-gate#SC-001
 */
describe('spec-first wiring in CI and the GitHub Action', () => {
  const files = ['.github/workflows/ci.yml', 'action.yml'];
  for (const file of files) {
    it(`${file} passes the PR body only through an env value`, async () => {
      const { readFileSync } = await import('node:fs');
      const lines = readFileSync(resolve(file), 'utf8').split('\n');
      const uses = lines.filter(l => l.includes('github.event.pull_request.body'));
      assert.ok(uses.length > 0, `${file} must wire the PR body`);
      for (const line of uses) assert.match(line, /^\s*PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}\s*$/);
      assert.ok(lines.some(l => l.includes('specs require --since')), `${file} must run specs require`);
    });
  }

  it('AGENTS.md states the rule, both formats and the command', async () => {
    const { readFileSync } = await import('node:fs');
    const agents = readFileSync(resolve('AGENTS.md'), 'utf8');
    assert.match(agents, /Spec-first \(Constitution X\)/);
    assert.match(agents, /Spec-Exempt: <release\|deps\|typo\|test-only> — <reason>/);
    assert.match(agents, /docguard specs require --since/);
  });

  it('this repository governs cli/** and the release workflow declares its exemption', async () => {
    const { readFileSync } = await import('node:fs');
    assert.deepEqual(JSON.parse(readFileSync(resolve('.docguard.json'), 'utf8')).specFirst.paths, ['cli/**']);
    assert.match(readFileSync(resolve('.github/workflows/scheduled-release.yml'), 'utf8'), /Spec-Exempt: release — \S/);
  });
});

/**
 * @req docguard.spec-first-gate#SC-004
 */
describe('replay over this repository\'s own history', () => {
  it('classifies each of the last 10 commits without an inconclusive result', async () => {
    const { execFileSync } = await import('node:child_process');
    const { specInventory } = await import('../cli/scanners/spec-first.mjs');
    const g = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
    let commits;
    try { commits = g('log', '--format=%H', '-11').split('\n'); } catch { return; }
    if (commits.length < 11) return; // shallow clone: nothing to replay
    const inventory = specInventory(process.cwd());
    for (const c of commits.slice(0, 10)) {
      const paths = g('diff', '--name-only', `${c}^`, c).split('\n').filter(Boolean);
      const r = classifySpecFirst({ paths, text: g('log', '-1', '--format=%B', c), config: { specFirst: { paths: ['cli/**'] } }, inventory });
      assert.ok(['covered', 'exempt', 'not-governed', 'uncovered'].includes(r.status), `${c}: ${r.status}`);
    }
  });
});
