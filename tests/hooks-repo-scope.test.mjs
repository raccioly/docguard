/**
 * Git hooks stay inside the repository (specs/065-hooks-repo-scope).
 *
 * Every case runs against a temporary global (or system) Git configuration
 * through GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM — never the contributor's own.
 *
 * @req docguard.hooks-repo-scope#FR-001
 * @req docguard.hooks-repo-scope#FR-002
 * @req docguard.hooks-repo-scope#FR-003
 * @req docguard.hooks-repo-scope#FR-004
 * @req docguard.hooks-repo-scope#FR-005
 * @req docguard.hooks-repo-scope#FR-006
 * @req docguard.hooks-repo-scope#SC-001
 * @req docguard.hooks-repo-scope#SC-002
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveHooksTarget } from '../cli/shared-git.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

let base;
let emptyGlobal;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'dg-065-')));
  emptyGlobal = join(base, 'empty.gitconfig');
  writeFileSync(emptyGlobal, '');
});
afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); base = null; });

// The configuration every process in a case sees: an isolated global file, no
// system file unless the case provides one, plus any extra variables.
function gitEnv({ global = emptyGlobal, system = null, extra = {} } = {}) {
  const env = { ...process.env, NO_COLOR: '1', GIT_CONFIG_GLOBAL: global, ...extra };
  delete env.GIT_CONFIG_COUNT;
  if (system) { env.GIT_CONFIG_SYSTEM = system; delete env.GIT_CONFIG_NOSYSTEM; } else env.GIT_CONFIG_NOSYSTEM = '1';
  return { ...env, ...extra };
}

// Fixture git: isolated configuration, hooks and signing off.
function git(args, cwd) {
  const r = spawnSync('git', [...FIXTURE_GIT, ...args],
    { cwd, encoding: 'utf8', env: gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function repo(name = 'repo') {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 't@t'], dir);
  git(['config', 'user.name', 't'], dir);
  writeFileSync(join(dir, 'README.md'), '# p\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'p' }, null, 2) + '\n');
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
  return dir;
}

function cli(args, cwd, envOpts) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: gitEnv(envOpts), timeout: 60000 });
}

function sharedHooks(content = null) {
  const dir = join(base, 'shared-hooks');
  mkdirSync(dir, { recursive: true });
  if (content !== null) { writeFileSync(join(dir, 'pre-commit'), content); chmodSync(join(dir, 'pre-commit'), 0o755); }
  return dir;
}

function configFile(name, hooksPath) {
  const file = join(base, name);
  writeFileSync(file, `[core]\n\thooksPath = ${hooksPath}\n`);
  return file;
}

// In-process calls see the given global configuration and no system one.
function withGitConfig(global, fn) {
  const keep = { g: process.env.GIT_CONFIG_GLOBAL, n: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = global;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try { return fn(); } finally {
    if (keep.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = keep.g;
    if (keep.n === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = keep.n;
  }
}

const listing = dir => (existsSync(dir) ? readdirSync(dir).sort() : []);
const repoHooks = dir => listing(join(dir, '.git', 'hooks')).filter(n => !n.endsWith('.sample'));

describe('a shared hooks folder is never written (FR-001)', () => {
  it('a global core.hooksPath: install writes nothing and exits 1', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['hooks'], dir, { global: configFile('global.gitconfig', shared) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), [], 'nothing written to the shared folder');
    assert.deepEqual(repoHooks(dir), [], 'nothing written where Git would not run it');
    assert.match(r.stdout + r.stderr, /core\.hooksPath/);
    assert.match(r.stdout + r.stderr, /global/);
    assert.ok((r.stdout + r.stderr).includes(shared), 'names the folder');
  });

  it('--force leaves the user\'s own global hook and writes no backup', () => {
    const dir = repo();
    const shared = sharedHooks('#!/bin/sh\necho "USER GLOBAL"\n');
    const r = cli(['hooks', '--type', 'pre-commit', '--force'], dir, { global: configFile('global.gitconfig', shared) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), ['pre-commit']);
    assert.equal(readFileSync(join(shared, 'pre-commit'), 'utf8'), '#!/bin/sh\necho "USER GLOBAL"\n');
  });

  it('--auto-fix is refused the same way', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['hooks', '--type', 'pre-commit', '--auto-fix'], dir, { global: configFile('global.gitconfig', shared) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), []);
  });

  it('--remove leaves a DocGuard hook in the shared folder and prints how to remove it', () => {
    // A real managed hook, installed into a repository that owns its folder.
    const donor = repo('donor');
    assert.equal(cli(['hooks', '--type', 'pre-commit'], donor).status, 0);
    const managed = readFileSync(join(donor, '.git', 'hooks', 'pre-commit'), 'utf8');

    const dir = repo();
    const shared = sharedHooks(managed);
    const r = cli(['hooks', '--remove'], dir, { global: configFile('global.gitconfig', shared) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(readFileSync(join(shared, 'pre-commit'), 'utf8'), managed, 'the shared hook is untouched');
    assert.ok((r.stdout + r.stderr).includes(`rm ${join(shared, 'pre-commit')}`), r.stdout);
  });

  it('a system core.hooksPath is refused', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['hooks'], dir, { system: configFile('system.gitconfig', shared) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), []);
    assert.match(r.stdout + r.stderr, /system/);
  });

  it('a command-line core.hooksPath is refused', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['hooks'], dir, { extra: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: shared } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), []);
  });

  it('a repo-local core.hooksPath outside the repository is refused', () => {
    const dir = repo();
    const shared = sharedHooks();
    git(['config', '--local', 'core.hooksPath', shared], dir);
    const r = cli(['hooks'], dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listing(shared), []);
    assert.match(r.stdout + r.stderr, /outside/);
  });

  it('resolveHooksTarget reports the scope and ownership', () => {
    const dir = repo();
    const shared = sharedHooks();
    const t = withGitConfig(configFile('global.gitconfig', shared), () => resolveHooksTarget(dir));
    assert.equal(t.owned, false);
    assert.equal(t.scope, 'global');
    assert.equal(t.dir, shared);
  });
});

describe('--list stays read-only and names a shared folder (FR-002)', () => {
  it('lists, exits 0 and writes nothing', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['hooks', '--list'], dir, { global: configFile('global.gitconfig', shared) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pre-commit/);
    assert.match(r.stdout, /shared/i);
    assert.deepEqual(listing(shared), []);
  });
});

describe('repository-owned folders behave as before (FR-003)', () => {
  it('a repo-local core.hooksPath inside the repository receives the hooks', () => {
    const dir = repo();
    git(['config', '--local', 'core.hooksPath', '.githooks'], dir);
    const r = cli(['hooks', '--type', 'pre-commit'], dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(dir, '.githooks', 'pre-commit')));
    const t = withGitConfig(emptyGlobal, () => resolveHooksTarget(dir));
    assert.equal(t.owned, true);
    assert.equal(t.scope, 'local');
  });

  it('a linked worktree installs into the repository\'s common hooks folder', () => {
    const dir = repo();
    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', '-b', 'side', wt], dir);
    const r = cli(['hooks', '--type', 'pre-commit'], wt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(dir, '.git', 'hooks', 'pre-commit')));
  });

  it('no core.hooksPath: .git/hooks, owned', () => {
    const dir = repo();
    const t = withGitConfig(emptyGlobal, () => resolveHooksTarget(dir));
    assert.equal(t.owned, true);
    assert.equal(t.dir, join(dir, '.git', 'hooks'));
  });
});

describe('setup uses the same rule (FR-004)', () => {
  it('in a linked worktree it sees the hook Git runs', () => {
    const dir = repo();
    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', '-b', 'side', wt], dir);
    assert.equal(cli(['hooks', '--type', 'pre-commit'], dir).status, 0);
    const r = cli(['setup', '--skip-prompts'], wt);
    assert.match(r.stdout, /pre-commit hook.*docguard/i, r.stdout);
    assert.doesNotMatch(r.stdout, /not a git repo/i);
  });

  it('with a global core.hooksPath it says the folder is shared and installs nothing', () => {
    const dir = repo();
    const shared = sharedHooks();
    const r = cli(['setup', '--skip-prompts'], dir, { global: configFile('global.gitconfig', shared) });
    assert.match(r.stdout, /shared/i, r.stdout);
    assert.deepEqual(listing(shared), []);
  });
});

function legacyProject() {
  const dir = repo();
  // A pre-0.4 config so the schema migration has work to do.
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ project: 'legacy', profile: 'starter' }, null, 2));
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'legacy config'], dir);
  return dir;
}

function ghStub(exitCode) {
  const bin = join(base, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node\nprocess.exit(${exitCode});\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  return `${bin}:${process.env.PATH}`;
}

const branches = dir => git(['branch', '--format=%(refname:short)'], dir).trim().split('\n');
const current = dir => git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim();
const status = dir => git(['status', '--porcelain'], dir).trim();

describe('a failed upgrade pull request rolls back (FR-005)', () => {
  it('a failing commit returns to the starting branch with the config restored', () => {
    const dir = legacyProject();
    const before = readFileSync(join(dir, '.docguard.json'), 'utf8');
    const signing = join(base, 'signing.gitconfig');
    writeFileSync(signing, '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n');
    const r = cli(['upgrade', '--apply', '--schema-only', '--pr'], dir, { global: signing, extra: { PATH: ghStub(0) } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(current(dir), 'main');
    assert.deepEqual(branches(dir), ['main'], 'the new branch is deleted');
    assert.equal(readFileSync(join(dir, '.docguard.json'), 'utf8'), before);
    assert.equal(status(dir), '');
  });

  it('a failing push returns to the starting branch and deletes the unpushed branch', () => {
    const dir = legacyProject();   // no remote: the push fails
    const before = readFileSync(join(dir, '.docguard.json'), 'utf8');
    const r = cli(['upgrade', '--apply', '--schema-only', '--pr'], dir, { extra: { PATH: ghStub(0) } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(current(dir), 'main');
    assert.deepEqual(branches(dir), ['main']);
    assert.equal(readFileSync(join(dir, '.docguard.json'), 'utf8'), before);
    assert.equal(status(dir), '');
  });

  it('a failing gh pr create returns to the starting branch and names the pushed branch', () => {
    const dir = legacyProject();
    const bare = join(base, 'remote.git');
    mkdirSync(bare);
    git(['init', '--bare', '-q'], bare);
    git(['remote', 'add', 'origin', bare], dir);
    const r = cli(['upgrade', '--apply', '--schema-only', '--pr'], dir, { extra: { PATH: ghStub(1) } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(current(dir), 'main');
    const pushed = git(['ls-remote', '--heads', bare], dir).match(/refs\/heads\/(docguard\/upgrade-schema-\S+)/);
    assert.ok(pushed, 'the branch was pushed');
    assert.ok((r.stdout + r.stderr).includes(pushed[1]), 'the pushed branch is named');
    assert.equal(status(dir), '');
  });
});

describe('the suite never writes the contributor\'s global hooks (FR-006)', () => {
  it('hook-installing tests isolate the global configuration', () => {
    for (const file of ['tests/hook-fail-open.test.mjs', 'tests/hooks.test.mjs', 'tests/hooks-contract.test.mjs', 'tests/field-report-followups.test.mjs']) {
      assert.match(readFileSync(file, 'utf8'), /GIT_CONFIG_GLOBAL/, `${file} isolates the global Git configuration`);
    }
  });
});
