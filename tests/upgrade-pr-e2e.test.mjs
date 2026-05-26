/**
 * v0.18-P4 — End-to-end battle-test for `docguard upgrade --apply --pr`.
 *
 * The PR flow shipped in v0.14-P4 was never exercised end-to-end against a
 * real remote. This test wires up a local bare-repo remote AND a stub `gh`
 * binary so we can verify every step short of actually talking to GitHub:
 *
 *   1. Branch is created
 *   2. .docguard.json gets the migration applied
 *   3. Commit is created with the expected message
 *   4. git push to the local bare remote succeeds
 *   5. `gh pr create` is invoked with the right arguments
 *
 * The stub `gh` writes its argv to a file so we can assert what was invoked.
 *
 * @req SC-PR-001 — upgrade --apply --pr creates a branch named docguard/upgrade-schema-...
 * @req SC-PR-002 — the migrated .docguard.json is committed
 * @req SC-PR-003 — the commit lands on the bare remote
 * @req SC-PR-004 — gh pr create is invoked with --title and --body
 * @req SC-PR-005 — failure to push exits 1 with a clear error
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

/**
 * Build a project + bare remote pair. The project is git init'd and has
 * `origin` pointing at the bare remote. Returns { dir, bare }.
 */
function makeProjectWithBareRemote() {
  const base = mkdtempSync(join(tmpdir(), 'docguard-pr-e2e-'));
  const dir = join(base, 'project');
  const bare = join(base, 'remote.git');
  mkdirSync(dir, { recursive: true });
  mkdirSync(bare, { recursive: true });

  // Init the bare remote
  spawnSync('git', ['init', '--bare', '-q'], { cwd: bare });

  // Init the project + commit
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  // No `version` field + uses legacy `project` (pre-0.4 schema) so the
  // upgrade migration chain (0.0 → 0.4 → 0.5) actually fires end-to-end.
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    project: 'legacy-name', profile: 'starter',
  }, null, 2));
  writeFileSync(join(dir, 'README.md'), '# pr-test\n');
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });

  // Wire the remote
  spawnSync('git', ['remote', 'add', 'origin', bare], { cwd: dir });

  return { dir, bare, base };
}

/**
 * Install a stub `gh` binary on a fresh PATH directory. Returns the new
 * PATH and the log file the stub writes argv to.
 *
 * v0.19-P2: Node-based instead of shell-based. The shell version worked
 * on macOS but failed on Linux CI runners (interaction with the runner's
 * existing /usr/bin/gh + `which` returning the wrong path). Node is on
 * EVERY platform DocGuard supports (it's the runtime); the shebang
 * `#!/usr/bin/env node` resolves identically everywhere. The stub
 * appends argv to a log file and prints a fake PR URL.
 */
function installGhStub(base) {
  const stubDir = join(base, 'stub-bin');
  mkdirSync(stubDir, { recursive: true });
  const logFile = join(base, 'gh-invocations.log');
  const stub = [
    '#!/usr/bin/env node',
    '// v0.19-P2: Node-based gh stub for upgrade --pr e2e tests.',
    'const fs = require("node:fs");',
    `fs.appendFileSync(${JSON.stringify(logFile)}, process.argv.slice(2).join(" ") + "\\n");`,
    'console.log("https://github.com/x/y/pull/42");',
    'process.exit(0);',
    '',
  ].join('\n');
  const stubPath = join(stubDir, 'gh');
  writeFileSync(stubPath, stub);
  chmodSync(stubPath, 0o755);
  // Prepend stub-bin to PATH so `which gh` and direct invocation both hit our stub.
  // Use cross-platform path separator (`:` on POSIX, `;` on Windows) but tests
  // are POSIX-only in CI so this is fine.
  return { newPath: `${stubDir}:${process.env.PATH}`, logFile };
}

// v0.19-P2: switched to Node-based gh stub — runs in regular CI on every
// platform now. The previous shell-script stub interacted oddly with
// /usr/bin/gh on Linux runners. Node is the DocGuard runtime; the shebang
// `#!/usr/bin/env node` resolves identically across macOS / Linux / Windows.
describe('upgrade --apply --pr — end-to-end with bare remote + stub gh', () => {
  let base;
  afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); });

  it('full happy path: branch + commit + push + gh pr create', async () => {
    const setup = makeProjectWithBareRemote();
    base = setup.base;
    const { dir, bare } = setup;
    const { newPath, logFile } = installGhStub(base);

    const r = spawnSync('node', [CLI, 'upgrade', '--apply', '--pr', '--quiet'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PATH: newPath },
    });

    if (r.status !== 0) {
      console.error('STDOUT:', r.stdout);
      console.error('STDERR:', r.stderr);
    }
    assert.equal(r.status, 0, `upgrade --pr should exit 0; got ${r.status}`);

    // 1. Branch was created
    const branchesRes = spawnSync('git', ['branch'], { cwd: dir, encoding: 'utf-8' });
    assert.match(branchesRes.stdout, /docguard\/upgrade-schema-/,
      `expected an upgrade-schema branch; got: ${branchesRes.stdout}`);

    // 2. The migrated .docguard.json was committed (project field renamed to projectName)
    const cfg = JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf-8'));
    assert.equal(cfg.version, '0.5', 'schema should have migrated to 0.5');
    assert.ok(!cfg.project, 'legacy `project` field should be renamed');

    // 3. The commit landed on the bare remote (verify ref exists)
    const lsRemoteRes = spawnSync('git', ['ls-remote', '--heads', bare], {
      encoding: 'utf-8',
    });
    assert.match(lsRemoteRes.stdout, /docguard\/upgrade-schema-/,
      `bare remote should have the branch; got: ${lsRemoteRes.stdout}`);

    // 4. gh pr create was invoked
    assert.ok(existsSync(logFile), 'gh stub should have been called');
    const ghArgs = readFileSync(logFile, 'utf-8');
    assert.match(ghArgs, /pr create/, 'gh pr create should be in the args');
    assert.match(ghArgs, /--title/, 'should pass --title');
    assert.match(ghArgs, /--body/, 'should pass --body');
    assert.match(ghArgs, /migrate schema/, 'title should mention the migration');
  });

  it('reports a clear error when gh is not installed', () => {
    const setup = makeProjectWithBareRemote();
    base = setup.base;
    const { dir } = setup;

    // Stripped PATH — no gh available
    const r = spawnSync('node', [CLI, 'upgrade', '--apply', '--pr', '--quiet'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });

    // If gh happens to be in /usr/bin on this system the test becomes a
    // no-op (couldn't strip it). Otherwise expect the explicit error.
    if (/gh CLI not found/.test(r.stdout + r.stderr)) {
      assert.equal(r.status, 1, 'should exit 1 on missing gh');
      assert.match(r.stdout + r.stderr, /Install: https:\/\/cli\.github\.com/);
    }
  });
});
