import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

import { validateFreshness } from '../cli/validators/freshness.mjs';

const runGit = (args, cwd) => {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
};

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
});
