/**
 * Field report #1 (Issue C) + bucket-4 #11:
 *   - `init --profile starter` is "minimal, for side projects" and must NOT
 *     drop the heavy Spec Kit framework scaffold (.specify/). It still installs
 *     DocGuard's own canonical docs + lightweight agent skills/commands.
 *   - DocGuard slash commands install to `.agent/commands/`, not the root
 *     `commands/` (namespace pollution + the trace mis-scan root cause).
 *
 * Deterministic regardless of whether the `specify` CLI is present: the starter
 * gate skips spec-kit either way, and command install is a plain file copy.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function runInit(dir, args) {
  return spawnSync('node', [CLI, 'init', ...args], { cwd: dir, encoding: 'utf-8' });
}

describe('starter profile is minimal (no heavy spec-kit scaffold) + commands at .agent/commands', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('skips the .specify/ framework scaffold and installs commands under .agent/', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-starter-'));
    execSync('git init -q', { cwd: dir });

    const r = runInit(dir, ['--profile', 'starter', '--skip-prompts', '--quiet']);
    assert.match(r.stdout, /Spec Kit framework scaffold skipped/,
      'starter must announce it skips the spec-kit scaffold');

    assert.ok(!existsSync(join(dir, '.specify')),
      'starter must NOT create the heavy .specify/ framework scaffold');
    assert.ok(!existsSync(join(dir, 'commands')),
      'command docs must NOT land at the repo root (namespace pollution)');
    assert.ok(existsSync(join(dir, '.agent', 'commands', 'docguard.guard.md')),
      'DocGuard slash commands install under .agent/commands/');

    // The lightweight DocGuard agent value still arrives.
    assert.ok(existsSync(join(dir, '.agent', 'skills')),
      'DocGuard skills still install for starter');
    assert.ok(existsSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md')),
      'starter still scaffolds its canonical docs');
  });
});
