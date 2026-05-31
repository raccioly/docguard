import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { validateFreshness, readLastReviewedDate } from '../cli/validators/freshness.mjs';

const runGit = (args, cwd) => {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
};

describe('readLastReviewedDate — future dates cannot mask staleness', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fresh-review-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reads a valid past-dated header', () => {
    const f = join(dir, 'A.md');
    writeFileSync(f, '<!-- docguard:last-reviewed 2024-01-15 -->\n# A');
    const d = readLastReviewedDate(f);
    assert.ok(d instanceof Date && !isNaN(d.getTime()));
    assert.equal(d.toISOString().slice(0, 10), '2024-01-15');
  });

  it('ignores a future-dated header (returns null → falls back to git date)', () => {
    const f = join(dir, 'B.md');
    writeFileSync(f, '<!-- docguard:last-reviewed 2099-01-01 -->\n# B');
    assert.equal(readLastReviewedDate(f), null,
      'a future review date must be rejected so it cannot mark a stale doc fresh forever');
  });

  it('returns null when no header is present', () => {
    const f = join(dir, 'C.md');
    writeFileSync(f, '# C\n\nNo header here.');
    assert.equal(readLastReviewedDate(f), null);
  });
});

describe('Freshness Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-freshness-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips when the directory is not a git repository', () => {
    const results = validateFreshness(tmpDir, {});
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'skip');
    assert.match(results[0].message, /Not a git repository/);
  });

  it('skips when the repository has fewer than 3 commits', () => {
    runGit('init', tmpDir);
    runGit('config user.name "Test"', tmpDir);
    runGit('config user.email "test@example.com"', tmpDir);

    writeFileSync(join(tmpDir, 'test1.js'), 'const a = 1;');
    runGit('add test1.js', tmpDir);
    runGit('commit -m "commit 1"', tmpDir);

    const results = validateFreshness(tmpDir, {});
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'skip');
    assert.match(results[0].message, /needs ≥3 commits/);
  });

  it('warns when doc files are untracked in git', () => {
    runGit('init', tmpDir);
    runGit('config user.name "Test"', tmpDir);
    runGit('config user.email "test@example.com"', tmpDir);

    // Create 3 commits to pass the commit count check
    for (let i = 1; i <= 3; i++) {
      writeFileSync(join(tmpDir, `test${i}.js`), `const a = ${i};`);
      runGit(`add test${i}.js`, tmpDir);
      runGit(`commit -m "commit ${i}"`, tmpDir);
    }

    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');

    const results = validateFreshness(tmpDir, {});

    const archResult = results.find(r => r.message.includes('ARCHITECTURE.md'));
    assert.ok(archResult);
    assert.strictEqual(archResult.status, 'warn');
    assert.match(archResult.message, /exists but is not yet committed to git/);
  });

  it('passes when a doc file is tracked and fresh', () => {
    runGit('init', tmpDir);
    runGit('config user.name "Test"', tmpDir);
    runGit('config user.email "test@example.com"', tmpDir);

    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');
    runGit('add docs-canonical/ARCHITECTURE.md', tmpDir);
    runGit('commit -m "add arch"', tmpDir);

    for (let i = 1; i <= 2; i++) {
      writeFileSync(join(tmpDir, `test${i}.js`), `const a = ${i};`);
      runGit(`add test${i}.js`, tmpDir);
      runGit(`commit -m "commit ${i}"`, tmpDir);
    }

    const results = validateFreshness(tmpDir, {});

    const archResult = results.find(r => r.message.includes('ARCHITECTURE.md'));
    assert.ok(archResult);
    assert.strictEqual(archResult.status, 'pass');
    assert.match(archResult.message, /is fresh/);
  });

  it('warns when a doc file is stale (>10 code commits since doc update)', () => {
    runGit('init', tmpDir);
    runGit('config user.name "Test"', tmpDir);
    runGit('config user.email "test@example.com"', tmpDir);

    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');
    runGit('add docs-canonical/ARCHITECTURE.md', tmpDir);
    runGit('commit -m "add arch"', tmpDir);

    // Create a base file to modify later
    writeFileSync(join(tmpDir, `test-mod.js`), `const a = 0;`);
    runGit(`add test-mod.js`, tmpDir);
    runGit(`commit -m "initial file"`, tmpDir);

    // Make 11 code commits
    for (let i = 1; i <= 11; i++) {
      writeFileSync(join(tmpDir, `test-mod.js`), `const a = ${i};`);
      runGit(`add test-mod.js`, tmpDir);
      runGit(`commit -m "commit ${i}"`, tmpDir);
    }

    const results = validateFreshness(tmpDir, {});

    const archResult = results.find(r => r.message.includes('ARCHITECTURE.md'));
    assert.ok(archResult);
    assert.strictEqual(archResult.status, 'warn');
    assert.match(archResult.message, /code commits since last doc update/);
  });

  it('warns when a doc file is stale (>30 days since latest code commit)', () => {
    runGit('init', tmpDir);
    runGit('config user.name "Test"', tmpDir);
    runGit('config user.email "test@example.com"', tmpDir);

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40); // 40 days ago
    const oldDateStr = oldDate.toISOString();

    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Arch');
    runGit('add docs-canonical/ARCHITECTURE.md', tmpDir);

    execSync(`git commit -m "add arch" --date="${oldDateStr}"`, {
      cwd: tmpDir,
      env: { ...process.env, GIT_COMMITTER_DATE: oldDateStr }
    });

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1); // 1 day ago
    const recentDateStr = recentDate.toISOString();

    for (let i = 1; i <= 2; i++) {
      writeFileSync(join(tmpDir, `test${i}.js`), `const a = ${i};`);
      runGit(`add test${i}.js`, tmpDir);
      execSync(`git commit -m "commit ${i}" --date="${recentDateStr}"`, {
        cwd: tmpDir,
        env: { ...process.env, GIT_COMMITTER_DATE: recentDateStr }
      });
    }

    const results = validateFreshness(tmpDir, {});

    const archResult = results.find(r => r.message.includes('ARCHITECTURE.md'));
    assert.ok(archResult);
    assert.strictEqual(archResult.status, 'warn');
    assert.match(archResult.message, /last updated \d+ days before latest code change/);
  });

  // Regression for the v0.20.0 field-test bug: the `<!-- docguard:last-reviewed
  // YYYY-MM-DD -->` header was injected into every generated template and
  // referenced in the freshness fix-suggestion text, but `validateFreshness()`
  // never actually read it — only `git log` was consulted. So updating the
  // header (the explicit "I reviewed this and it's still accurate" signal)
  // had zero effect on the check. These tests pin both the override path
  // and the git-log fallback path.
  describe('docguard:last-reviewed header', () => {
    function commitOldCode(dir) {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);
      const iso = oldDate.toISOString();
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(dir, `code${i}.js`), `const a = ${i};`);
        runGit(`add code${i}.js`, dir);
        execSync(`git commit -m "code ${i}" --date="${iso}"`, {
          cwd: dir,
          env: { ...process.env, GIT_COMMITTER_DATE: iso },
        });
      }
    }

    it('a today-dated header suppresses the stale-doc warning', () => {
      runGit('init', tmpDir);
      runGit('config user.name "Test"', tmpDir);
      runGit('config user.email "test@example.com"', tmpDir);
      commitOldCode(tmpDir);

      // Doc committed 100 days ago, but the header was just stamped today.
      const oldIso = new Date();
      oldIso.setDate(oldIso.getDate() - 100);
      const today = new Date().toISOString().slice(0, 10);
      const docsDir = join(tmpDir, 'docs-canonical');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(
        join(docsDir, 'ARCHITECTURE.md'),
        `<!-- docguard:last-reviewed ${today} -->\n# Arch\n`
      );
      runGit('add docs-canonical/ARCHITECTURE.md', tmpDir);
      const oldIsoStr = oldIso.toISOString();
      execSync(`git commit -m "doc" --date="${oldIsoStr}"`, {
        cwd: tmpDir,
        env: { ...process.env, GIT_COMMITTER_DATE: oldIsoStr },
      });

      const results = validateFreshness(tmpDir, {});
      const arch = results.find(r => r.message.includes('ARCHITECTURE.md'));
      assert.ok(arch, 'ARCHITECTURE.md should appear in results');
      assert.strictEqual(arch.status, 'pass',
        `expected pass (header is fresh) but got ${arch.status}: ${arch.message}`);
    });

    it('a stale-dated header does NOT suppress the warning', () => {
      runGit('init', tmpDir);
      runGit('config user.name "Test"', tmpDir);
      runGit('config user.email "test@example.com"', tmpDir);
      commitOldCode(tmpDir);

      const docsDir = join(tmpDir, 'docs-canonical');
      mkdirSync(docsDir, { recursive: true });
      // Header date is 200 days old → should still trigger staleness.
      writeFileSync(
        join(docsDir, 'ARCHITECTURE.md'),
        '<!-- docguard:last-reviewed 2020-01-01 -->\n# Arch\n'
      );
      runGit('add docs-canonical/ARCHITECTURE.md', tmpDir);
      runGit('commit -m "doc"', tmpDir);

      const results = validateFreshness(tmpDir, {});
      const arch = results.find(r => r.message.includes('ARCHITECTURE.md'));
      assert.ok(arch);
      assert.strictEqual(arch.status, 'warn',
        'stale header date must not mask a real freshness warning');
    });
  });
});
