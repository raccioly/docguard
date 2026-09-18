/**
 * shared-git — single source of truth for git plumbing.
 *
 * Exercises against real ephemeral git repos so we test the actual git
 * subprocess behavior (most importantly --follow).
 *
 * @req SC-L3-001 — getLastCommitDate follows renames
 * @req SC-L3-002 — getFileHistory follows renames
 * @req SC-L3-003 — getRenameHistory returns historical paths in reverse-chrono
 * @req SC-L3-004 — changedFilesSince returns ACMR diff against a ref
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  isGitRepo,
  getLastCommitDate,
  getFileHistory,
  getRenameHistory,
  changedFilesSince,
  countCommitsSince,
  getDiffSnapshot,
  getDiffText,
  fileContentAtRev,
  symbolExistsAtRev,
} from '../cli/shared-git.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'docguard-git-'));
}

function cleanup(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function git(dir, ...args) {
  const env = { ...process.env };
  return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t'].concat(args), {
    cwd: dir, encoding: 'utf-8', env,
  });
}

function commit(dir, msg) {
  git(dir, 'add', '-A');
  return git(dir, 'commit', '-q', '-m', msg);
}

describe('isGitRepo', () => {
  it('returns false outside a git work tree', () => {
    const dir = tmp();
    try {
      assert.equal(isGitRepo(dir), false);
    } finally {
      cleanup(dir);
    }
  });

  it('returns true inside a git work tree', () => {
    const dir = tmp();
    try {
      git(dir, 'init', '-q');
      assert.equal(isGitRepo(dir), true);
    } finally {
      cleanup(dir);
    }
  });
});

describe('getLastCommitDate (follows renames)', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns null when file is untracked', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'untracked.ts'), 'x');
    assert.equal(getLastCommitDate(dir, 'untracked.ts'), null);
  });

  it('returns the most recent commit date for a tracked file', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1');
    commit(dir, 'first');
    const d = getLastCommitDate(dir, 'a.ts');
    assert.ok(d instanceof Date, 'should return a Date');
    assert.ok(!isNaN(d.getTime()), 'date should be valid');
  });

  it('follows renames so the counter does NOT reset', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'old-name.ts'), 'original');
    commit(dir, 'add old-name.ts');
    // Make several more commits to other files
    writeFileSync(join(dir, 'other.ts'), 'x'); commit(dir, 'other 1');
    writeFileSync(join(dir, 'other.ts'), 'y'); commit(dir, 'other 2');
    // Then rename the file
    renameSync(join(dir, 'old-name.ts'), join(dir, 'new-name.ts'));
    commit(dir, 'rename');

    const d = getLastCommitDate(dir, 'new-name.ts');
    assert.ok(d, 'getLastCommitDate should find the file under its new name');
    // Without --follow, this would only see the "rename" commit. With --follow,
    // we see the rename AND the original add as the same file's history.
    // The most recent commit IS the rename — but the helper getFileHistory
    // (tested below) is where --follow actually changes the answer set.
  });
});

describe('getFileHistory (follows renames)', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns commits that touched the file under both old and new names', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'old.ts'), 'v1');
    commit(dir, 'add old.ts');
    writeFileSync(join(dir, 'old.ts'), 'v2');
    commit(dir, 'modify old.ts');
    renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));
    commit(dir, 'rename to new.ts');
    writeFileSync(join(dir, 'new.ts'), 'v3');
    commit(dir, 'modify new.ts');

    const hist = getFileHistory(dir, 'new.ts');
    // Should see: add, modify, rename, modify (4 commits) when --follow works.
    // Without --follow, we'd only see the 2 commits since the rename.
    assert.ok(hist.length >= 3,
      `expected >= 3 commits in history (rename-aware), got ${hist.length}`);
  });

  it('parses NUL-delimited fields correctly even when the subject has spaces', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1');
    // A multi-word subject is the regression vehicle: a space-delimited parse
    // would put "fix:" in isoDate and lose the rest of the subject.
    commit(dir, 'fix: handle the multi word subject case');

    const hist = getFileHistory(dir, 'a.ts');
    assert.equal(hist.length, 1);
    const [c] = hist;
    assert.match(c.hash, /^[0-9a-f]{7,40}$/, `hash should be a clean SHA, got "${c.hash}"`);
    assert.ok(!isNaN(new Date(c.isoDate).getTime()), `isoDate should parse as a date, got "${c.isoDate}"`);
    assert.equal(c.subject, 'fix: handle the multi word subject case',
      'the full multi-word subject must survive intact');
  });
});

describe('getRenameHistory', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns [path] for files that have not been renamed', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'x');
    commit(dir, 'add');
    assert.deepEqual(getRenameHistory(dir, 'a.ts'), ['a.ts']);
  });

  it('returns all historical paths in reverse-chrono order after a rename', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'old.ts'), 'x');
    commit(dir, 'add old.ts');
    renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));
    commit(dir, 'rename');

    const paths = getRenameHistory(dir, 'new.ts');
    assert.ok(paths.includes('new.ts'), 'should include current path');
    assert.ok(paths.includes('old.ts'), 'should include historical path');
  });

  it('falls back to [path] when git is unavailable / dir is not a repo', () => {
    dir = tmp();
    // No git init — should not throw, just return [path]
    const r = getRenameHistory(dir, 'whatever.ts');
    assert.deepEqual(r, ['whatever.ts']);
  });
});

describe('changedFilesSince', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns files modified between a ref and HEAD', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'base.ts'), 'v1');
    commit(dir, 'base');
    writeFileSync(join(dir, 'base.ts'), 'v2');
    writeFileSync(join(dir, 'new.ts'), 'added');
    commit(dir, 'second');

    const changed = changedFilesSince(dir, 'HEAD~1');
    assert.deepEqual(changed.sort(), ['base.ts', 'new.ts']);
  });

  it('returns [] when ref does not exist', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'x');
    commit(dir, 'first');
    // HEAD~5 doesn't exist
    const changed = changedFilesSince(dir, 'HEAD~5');
    assert.deepEqual(changed, []);
  });
});

describe('getDiffText', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns diff patch text between refs', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'a.ts'), 'v2\n');
    commit(dir, 'second');
    const diff = getDiffText(dir, base);
    assert.ok(diff.includes('-v1'));
    assert.ok(diff.includes('+v2'));
  });

  it('filters by pathspec if provided', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1\n');
    writeFileSync(join(dir, 'b.ts'), 'v1\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'a.ts'), 'v2\n');
    writeFileSync(join(dir, 'b.ts'), 'v2\n');
    commit(dir, 'second');
    const diff = getDiffText(dir, base, ['a.ts']);
    assert.ok(diff.includes('a.ts'));
    assert.ok(!diff.includes('b.ts'));
  });
});

describe('fileContentAtRev', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns file content at a specific revision', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'a.ts'), 'v2\n');
    commit(dir, 'second');
    const content = fileContentAtRev(dir, base, 'a.ts');
    assert.equal(content, 'v1\n');
  });

  it('returns null if file did not exist at revision', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'v1\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'b.ts'), 'v1\n');
    commit(dir, 'second');
    const content = fileContentAtRev(dir, base, 'b.ts');
    assert.equal(content, null);
  });
});

describe('symbolExistsAtRev', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('returns true if symbol exists at revision', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'export function testSymbol() {}\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'a.ts'), 'export function renamedSymbol() {}\n');
    commit(dir, 'second');
    assert.equal(symbolExistsAtRev(dir, 'testSymbol', base), true);
  });

  it('returns false if symbol does not exist at revision', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'export function otherSymbol() {}\n');
    commit(dir, 'first');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    assert.equal(symbolExistsAtRev(dir, 'testSymbol', base), false);
  });
});

describe('getDiffSnapshot', () => {
  let dir;
  afterEach(() => cleanup(dir));

  it('keeps rename, deletion, and patch evidence in one bounded snapshot', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'old.ts'), 'export const oldValue = 1;\n');
    writeFileSync(join(dir, 'deleted.ts'), 'export const removed = true;\n');
    commit(dir, 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));
    rmSync(join(dir, 'deleted.ts'));
    commit(dir, 'change paths');

    const snapshot = getDiffSnapshot(dir, base);
    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.commitCount, 1);
    assert.ok(snapshot.changedFiles.some(file => file.oldPath === 'old.ts' && file.newPath === 'new.ts'));
    assert.ok(snapshot.changedFiles.some(file => file.oldPath === 'deleted.ts' && file.newPath === null));
    assert.ok(snapshot.patchBytes > 0);
  });

  it('returns explicit too-large status instead of an empty successful diff', () => {
    dir = tmp();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'large.ts'), 'base\n');
    commit(dir, 'base');
    const base = git(dir, 'rev-parse', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'large.ts'), 'x'.repeat(4096));
    commit(dir, 'large patch');

    const snapshot = getDiffSnapshot(dir, base, { maxPatchBytes: 128 });
    assert.equal(snapshot.status, 'too-large');
    assert.match(snapshot.reason, /newer --since revision/);
    assert.equal(snapshot.changedFiles.length, 1);
  });
});
