/**
 * A sandboxed worktree (git metadata hidden) must report what it could not
 * check, never a clean "no matches".
 *
 * @req docguard.unreadable-git-metadata#FR-001
 * @req docguard.unreadable-git-metadata#FR-002
 * @req docguard.unreadable-git-metadata#FR-003
 * @req docguard.unreadable-git-metadata#FR-004
 * @req docguard.unreadable-git-metadata#FR-005
 * @req docguard.unreadable-git-metadata#SC-001
 * @req docguard.unreadable-git-metadata#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { gitMetadataStatus } from '../cli/shared-git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const FILES = {
  '.docguard.json': JSON.stringify({ projectName: 't' }),
  'AGENTS.md': '# Agents\n\nUse `computeTotals` for sums.\n',
  'src/a.mjs': 'export function computeTotals() { return 1; }\n',
  'specs/001-x/spec.md': '# X\n\n**Spec ID**: `t.x`\n\n- **FR-001**: Work.\n',
  'specs/001-x/tasks.md': '# Tasks\n\n## Phase 1\n\n- [x] T001 update `src/a.mjs`\n',
};

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

/** A linked worktree whose `.git` points at a gitdir the "sandbox" does not expose. */
function sandboxedWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-git-'));
  dirs.push(root);
  const main = join(root, 'main');
  mkdirSync(main);
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git(main, 'init', '-q'); git(main, 'config', 'user.email', 't@t'); git(main, 'config', 'user.name', 't');
  write(main, FILES);
  git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'base');
  const wt = join(root, 'wt');
  git(main, 'worktree', 'add', '-q', '--detach', wt);
  assert.match(readFileSync(join(wt, '.git'), 'utf8'), /^gitdir: /);
  writeFileSync(join(wt, '.git'), 'gitdir: /nonexistent/sandbox/hidden/worktrees/wt\n');
  return wt;
}

function coverage(dir) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const byName = new Map(j.checkCoverage.limitations.map(l => [l.name, l]));
  return { j, byName };
}

describe('git metadata states', () => {
  it('distinguishes ok, absent and unreadable', () => {
    assert.equal(gitMetadataStatus(process.cwd()).status, 'ok');
    const plain = mkdtempSync(join(tmpdir(), 'no-git-'));
    dirs.push(plain);
    // tmpdir itself must not sit inside a repository for this to be "absent".
    if (gitMetadataStatus(tmpdir()).status === 'absent') assert.equal(gitMetadataStatus(plain).status, 'absent');
    const wt = sandboxedWorktree();
    const state = gitMetadataStatus(wt);
    assert.equal(state.status, 'unreadable');
    assert.match(state.reason, /not a git repository/);
  });
});

describe('a sandboxed worktree reports what it could not check (SC-001)', () => {
  it('marks the history validators missing-prerequisite and Spec-Kit partial', () => {
    const { byName } = coverage(sandboxedWorktree());
    for (const name of ['Freshness', 'Diff-Suspicion', 'Reference-Existence']) {
      const l = byName.get(name);
      assert.equal(l?.status, 'missing-prerequisite', `${name}: ${JSON.stringify(l)}`);
      assert.match(l.reason, /Git metadata is present but unreadable/);
      assert.match(l.reason, /ai-jail: --worktree/);
    }
    const spk = byName.get('Spec-Kit');
    assert.equal(spk?.status, 'partial');
    assert.match(spk.reason, /SPK010/);
  });
});

describe('a project without git is unchanged (SC-002)', () => {
  it('keeps the history validators as no-matches when no .git exists anywhere', { skip: gitMetadataStatus(tmpdir()).status !== 'absent' && 'tmpdir is inside a repository' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-git-project-'));
    dirs.push(dir);
    write(dir, FILES);
    const { byName } = coverage(dir);
    for (const name of ['Freshness', 'Diff-Suspicion', 'Reference-Existence']) {
      assert.notEqual(byName.get(name)?.status, 'missing-prerequisite', name);
    }
  });
});

/** @req docguard.unreadable-git-metadata#FR-006 */
describe('agent sandbox documentation', () => {
  it('ENVIRONMENT.md says what a sandbox must expose and how DocGuard degrades', () => {
    const env = readFileSync(resolve('docs-canonical/ENVIRONMENT.md'), 'utf8');
    const section = env.slice(env.indexOf('## Running inside an agent sandbox'));
    assert.ok(section.startsWith('## Running inside an agent sandbox'));
    assert.match(section, /--worktree/);
    assert.match(section, /missing-prerequisite/);
  });
});
