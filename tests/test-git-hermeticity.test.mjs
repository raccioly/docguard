/**
 * The suite does not depend on the machine's git config
 * (specs/066-test-git-hermeticity).
 *
 * A global `core.hooksPath` whose hooks fail, mandatory signing through a gpg
 * that fails, and `init.defaultBranch=trunk` turned 189 tests red, and let
 * others pass against fixtures that were never committed. Fixture git now goes
 * through `tests/helpers/git.mjs`. These tests prove the helper neutralises
 * that config, that a failed fixture step is loud, and that no test spawns git
 * around the helper. The CI `hermeticity` job runs the whole suite under the
 * same config.
 *
 * @req docguard.test-git-hermeticity#FR-001
 * @req docguard.test-git-hermeticity#FR-002
 * @req docguard.test-git-hermeticity#FR-003
 * @req docguard.test-git-hermeticity#FR-004
 * @req docguard.test-git-hermeticity#FR-006
 * @req docguard.test-git-hermeticity#FR-007
 * @req docguard.test-git-hermeticity#SC-001
 * @req docguard.test-git-hermeticity#SC-002
 * @req docguard.test-git-hermeticity#SC-003
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { FIXTURE_GIT_SHELL, HOSTILE_HOOKS, fixtureGit, hostileGitEnv } from './helpers/git.mjs';

const ROOT = resolve('.');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const identity = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];

/** A hostile machine and an empty repository initialised on it with the fixture options. */
function hostileRepo() {
  const root = mkdtempSync(join(tmpdir(), 'dg-hostile-'));
  temps.push(root);
  const machine = hostileGitEnv(join(root, 'machine'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  fixtureGit(repo, ['init', '-q', '-b', 'main'], { env: machine.env });
  return { ...machine, repo };
}

describe('fixture git neutralises a hostile global config (FR-001)', () => {
  it('commits through failing global hooks and mandatory signing, running neither', () => {
    const { env, fired, repo } = hostileRepo();
    fixtureGit(repo, [...identity, 'commit', '-q', '--allow-empty', '-m', 'fixture'], { env });
    assert.deepEqual(fired(), []);
    assert.equal(fixtureGit(repo, ['log', '--format=%G?', '-1'], { env }).trim(), 'N', 'the commit is unsigned');
  });

  it('works through the shell form too', () => {
    const { env, fired, repo } = hostileRepo();
    execSync(`git ${FIXTURE_GIT_SHELL} -c user.name=f -c user.email=f@example.invalid commit -q --allow-empty -m fixture`, { cwd: repo, env, stdio: 'pipe' });
    assert.deepEqual(fired(), []);
  });

  it('is needed: the same commit without the options fails on that machine', () => {
    const { env, fired, repo } = hostileRepo();
    // fixture-git-exempt: the control proves the hostile config bites without the options.
    const r = spawnSync('git', [...identity, 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: repo, env, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.ok(fired().includes('pre-commit'), 'the global pre-commit hook ran');
  });
});

describe('a fixture states its branch instead of inheriting one (FR-003)', () => {
  it('a repository initialised without -b takes the machine\'s default; -b main pins it', () => {
    const { env, repo } = hostileRepo();
    assert.equal(fixtureGit(repo, ['symbolic-ref', '--short', 'HEAD'], { env }).trim(), 'main');
    const unpinned = join(repo, 'unpinned');
    mkdirSync(unpinned);
    fixtureGit(unpinned, ['init', '-q'], { env });
    assert.equal(fixtureGit(unpinned, ['symbolic-ref', '--short', 'HEAD'], { env }).trim(), 'trunk');
  });
});

describe('a failed fixture step fails the test loudly (FR-002)', () => {
  it('throws with git\'s own error instead of returning a result nobody reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-fixture-fail-'));
    temps.push(dir);
    assert.throws(() => fixtureGit(dir, ['rev-parse', '--verify', 'HEAD']), /fixture git rev-parse --verify HEAD exited \d+ in .*: fatal: /s);
  });
});

/** Every `git` spawn in a test file that bypasses the fixture options. */
function bypasses(text) {
  const found = [];
  const lines = text.split('\n');
  const exempt = index => lines.slice(Math.max(0, index - 2), index + 1).some(line => line.includes('fixture-git-exempt:'));
  const lineOf = offset => text.slice(0, offset).split('\n').length - 1;
  for (const m of text.matchAll(/\b(?:spawnSync|execFileSync|execFile|spawn)\(\s*'git'\s*,\s*/g)) {
    if (!text.startsWith('[...FIXTURE_GIT', m.index + m[0].length) && !exempt(lineOf(m.index))) found.push(lineOf(m.index) + 1);
  }
  for (const m of text.matchAll(/\b(?:execSync|exec)\(\s*['"`]git\s+/g)) {
    if (!text.startsWith('${FIXTURE_GIT_SHELL}', m.index + m[0].length) && !exempt(lineOf(m.index))) found.push(lineOf(m.index) + 1);
  }
  return found;
}

describe('no test spawns git around the helper (FR-004)', () => {
  it('finds a bypass and honours an exemption that gives a reason', () => {
    // fixture-git-exempt: sample source text, not a call.
    assert.deepEqual(bypasses("spawnSync('git', ['init'], {});\nexecSync('git init -q');"), [1, 2]);
    assert.deepEqual(bypasses("spawnSync('git', [...FIXTURE_GIT, 'init']);\nexecSync(`git ${FIXTURE_GIT_SHELL} init`);"), []);
    assert.deepEqual(bypasses("// fixture-git-exempt: control\nspawnSync('git', ['commit']);"), []);
  });

  it('every test file routes its git calls through tests/helpers/git.mjs', () => {
    const files = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(mjs|js)$/.test(entry.name)) files.push(path);
      }
    };
    walk(join(ROOT, 'tests'));
    const offenders = files.flatMap(file => bypasses(readFileSync(file, 'utf8')).map(line => `${relative(ROOT, file)}:${line}`));
    assert.deepEqual(offenders, []);
  });
});

describe('CI runs the suite on a hostile machine (FR-006)', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  hermeticity:'), ci.indexOf('\n  spec-first:'));

  it('builds the hostile config, proves it bites, then runs npm test under it', () => {
    assert.ok(job.startsWith('\n  hermeticity:'), 'ci.yml has a hermeticity job');
    for (const hook of HOSTILE_HOOKS) assert.ok(job.includes(hook), `the ${hook} hook fails`);
    for (const setting of ['gpgsign = true', 'program = /usr/bin/false', 'defaultBranch = trunk', 'GIT_CONFIG_GLOBAL=']) {
      assert.ok(job.includes(setting), setting);
    }
    const proof = job.indexOf('name: Prove the config is hostile');
    const run = job.indexOf('name: Run tests under the hostile config');
    assert.ok(proof > 0 && run > proof, 'the proof step runs before the suite');
    assert.match(job.slice(run), /run: npm test/);
  });

  it('pins every action to a full commit SHA and never runs on pull_request_target', () => {
    const uses = [...job.matchAll(/uses: (\S+)/g)].map(m => m[1]);
    assert.ok(uses.length >= 2);
    for (const action of uses) assert.match(action, /@[0-9a-f]{40}$/, action);
    assert.doesNotMatch(ci, /pull_request_target/);
  });
});

describe('the rule is written where contributors read it (FR-007)', () => {
  it('CONTRIBUTING.md and TEST-SPEC.md name the helper, the exemption and the CI job', () => {
    for (const doc of ['CONTRIBUTING.md', 'docs-canonical/TEST-SPEC.md']) {
      const text = readFileSync(join(ROOT, doc), 'utf8');
      for (const term of ['tests/helpers/git.mjs', 'FIXTURE_GIT', 'fixtureGit', 'fixture-git-exempt:', 'hermeticity', 'git init -b']) {
        assert.ok(text.includes(term), `${doc} mentions ${term}`);
      }
    }
  });
});
