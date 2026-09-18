// @req docs-canonical/REQUIREMENTS.md#FR-018
/**
 * Downstream field report — the pre-commit hook could block a project that had
 * never adopted DocGuard, and the installer could destroy a user's backup.
 *
 * The hook lives in the common `.git/hooks` and is shared by every linked
 * worktree; `.docguard.json` is a branch-local tracked file. During adoption the
 * two cannot be consistent, so a hook installed on one branch governed branches
 * that had no config, where guard exited 1 and the hook blocked the commit.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const git = (args, cwd) => execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
const run = (args, cwd) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 60000 });

describe('uninitialised projects are not blocked', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-failopen-'));
    git('init -q .', dir);
    writeFileSync(join(dir, 'README.md'), '# p\n');
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('guard exits 3 (not initialised), not 1, when there is no .docguard.json', () => {
    assert.equal(existsSync(join(dir, '.docguard.json')), false, 'precondition');
    assert.equal(run(['guard'], dir).status, 3,
      'a project that never adopted DocGuard must be distinguishable from one that failed its checks');
  });

  it('still exits 1 for real failures once the project IS initialised', () => {
    writeFileSync(join(dir, '.docguard.json'), '{"projectName":"p"}');
    assert.equal(run(['guard'], dir).status, 1,
      'an adopted project with blocking findings must keep failing — the fail-open must not weaken a real gate');
  });

  it('the generated hook lets the commit through when the config is absent', () => {
    const hook = run(['hooks', '--type', 'pre-commit'], dir);
    assert.equal(hook.status ?? 0, 0, hook.stderr);
    const script = readFileSync(join(dir, '.git/hooks/pre-commit'), 'utf-8');
    assert.match(script, /\.docguard\.json/, 'hook must check for the config before enforcing');
    assert.match(script, /exit 0/, 'hook must exit 0 when the project is not initialised');
    assert.match(script, /EXIT_CODE.*-eq 3|"\$EXIT_CODE" -eq 3/s, 'hook must treat exit 3 as not-adopted');
  });
});

describe('the installer never destroys a user backup', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-bak-'));
    git('init -q .', dir);
    writeFileSync(join(dir, 'README.md'), '# p\n');
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('writes no .bak when re-installing a byte-identical managed hook', () => {
    run(['hooks', '--type', 'pre-commit'], dir);
    run(['hooks', '--type', 'pre-commit'], dir);
    assert.equal(existsSync(join(dir, '.git/hooks/pre-commit.bak')), false,
      'an identical rewrite must not consume the single backup slot');
  });

  it('preserves an existing foreign .bak instead of replacing it', () => {
    // TestGuard found this gap: forcing `if (prior !== content)` to false left
    // every other test green, because the identical-content guard returned
    // first and the branch was never reached. Reaching it needs the live hook
    // to DIFFER from both the backup and the incoming content.
    const hookPath = join(dir, '.git/hooks/pre-commit');
    mkdirSync(join(dir, '.git/hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho "ORIGINAL A"\n');
    chmodSync(hookPath, 0o755);
    run(['hooks', '--type', 'pre-commit', '--force'], dir);   // .bak := A

    // The live hook now diverges from both the backup and what we will write.
    writeFileSync(hookPath, '#!/bin/sh\necho "EDITED B"\n');
    run(['hooks', '--type', 'pre-commit', '--force'], dir);   // must not lose A

    const names = execSync('ls .git/hooks', { cwd: dir, encoding: 'utf-8' })
      .split('\n').filter(n => n.includes('.bak'));
    const bodies = names.map(n => readFileSync(join(dir, '.git/hooks', n), 'utf-8'));
    assert.ok(bodies.some(b => b.includes('ORIGINAL A')),
      `the pre-existing backup must survive; backups: ${names}`);
    assert.ok(bodies.some(b => b.includes('EDITED B')),
      `the replaced hook must also be recoverable; backups: ${names}`);
  });

  it('keeps the user original recoverable across two --force installs', () => {
    const hookPath = join(dir, '.git/hooks/pre-commit');
    mkdirSync(join(dir, '.git/hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho "USER ORIGINAL"\n');
    chmodSync(hookPath, 0o755);

    run(['hooks', '--type', 'pre-commit', '--force'], dir);
    run(['hooks', '--type', 'pre-commit', '--force'], dir);

    const backups = execSync('ls .git/hooks', { cwd: dir, encoding: 'utf-8' })
      .split('\n').filter(n => n.includes('.bak'));
    const preserved = backups.some(b =>
      readFileSync(join(dir, '.git/hooks', b), 'utf-8').includes('USER ORIGINAL'));
    assert.ok(preserved,
      `the user's original hook is not in version control; losing it is unrecoverable. backups: ${backups}`);
  });
});
