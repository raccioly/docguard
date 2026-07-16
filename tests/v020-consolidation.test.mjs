/**
 * v0.20 — Surface consolidation tests.
 *
 * Verifies the SURFACE-AUDIT §6.2 cleanup: standalone scaffolders are folded
 * into `init --with <name>`, `setup` → `init --wizard`, `impact` → `diff
 * --since`, and the 10 cute aliases are dropped (only `audit → guard`
 * remains). Every deprecation alias keeps working through v0.20.x; the
 * router prints a yellow warning so users know to migrate.
 *
 * @req SC-V020-001 — `init --with badge` dispatches the badge scaffolder
 * @req SC-V020-002 — `init --with agents,hooks,ci` dispatches all three in order
 * @req SC-V020-003 — `init --with unknown` errors clearly
 * @req SC-V020-004 — `init --wizard` dispatches to runSetup
 * @req SC-V020-005 — standalone `badge` still works + emits deprecation warning
 * @req SC-V020-006 — `setup` still works + emits deprecation warning
 * @req SC-V020-007 — `impact` still works + emits deprecation warning, routes to diff --since
 * @req SC-V020-008 — dropped aliases (`gen`, `repair`, `dx`, etc.) error with hint
 * @req SC-V020-009 — `audit → guard` continues to work without deprecation warning
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-v020-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'v020-test', version: '0.0.1' }));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('v0.20 — init --with <name> dispatcher', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  it('init --with badge dispatches the badge scaffolder', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--with', 'badge'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `exit 0; got ${r.status}\n${r.stderr}`);
    assert.match(r.stdout, /Scaffolders:/);
    assert.match(r.stdout, /── badge ──/);
    // Badge command's output signature — it prints a shields.io URL
    assert.match(r.stdout, /img\.shields\.io/);
  });

  it('init --with agents,hooks dispatches both in order', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--with', 'agents,hooks'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `exit 0; got ${r.status}\n${r.stderr}`);
    assert.match(r.stdout, /── agents ──/);
    assert.match(r.stdout, /── hooks ──/);
    // Order: agents should appear before hooks in output
    assert.ok(r.stdout.indexOf('── agents ──') < r.stdout.indexOf('── hooks ──'),
      'agents header should appear before hooks header');
  });

  it('init --with unknown errors with a clear message', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--with', 'nonexistent'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.notEqual(r.status, 0, 'should error on unknown --with target');
    assert.match(r.stderr + r.stdout, /Unknown --with target/);
    assert.match(r.stderr + r.stdout, /nonexistent/);
    // Should list valid options (order: agents, hooks, ci, badge, llms, publish)
    assert.match(r.stderr + r.stdout, /Valid:.*agents.*badge/);
  });

  it('init --with accepts every documented scaffolder name', () => {
    // Smoke-only: verify each name is recognized (doesn't error). Some
    // scaffolders (ci, publish) need extra config; we just check the
    // dispatcher recognizes them and doesn't error with "Unknown".
    const names = ['agents', 'hooks', 'ci', 'badge', 'llms', 'publish'];
    for (const name of names) {
      dir = makeFixture();
      const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--with', name], {
        cwd: dir,
        encoding: 'utf-8',
      });
      // Pass = dispatcher recognized the name (output contains the header).
      // Non-zero exit OK if the scaffolder itself needs config we didn't provide.
      assert.match(r.stdout, new RegExp(`── ${name} ──`),
        `expected dispatcher to recognize "${name}"; got: ${r.stdout.slice(0, 400)}`);
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });
});

describe('v0.20 — deprecation aliases (keep working + emit warning)', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  // Each [command, expectedReplacement] pair. The command must still exit 0
  // (or at least dispatch its underlying runner) and emit a deprecation warning
  // to stderr that mentions the v0.20 replacement.
  // v0.33: `ci` is NOT in this list anymore — it was un-deprecated. The v0.20
  // routing sent the pipeline gate through runInit, which scaffolded missing
  // docs into the CI workspace and printed init chrome into --format json.
  // A gate must be read-only and machine-clean, so `ci` dispatches directly
  // again (see the dedicated test below).
  const DEPRECATED_PAIRS = [
    ['setup', 'init --wizard'],
    ['agents', 'init --with agents'],
    ['hooks', 'init --with hooks'],
    ['badge', 'init --with badge'],
    ['llms', 'init --with llms'],
    ['publish', 'init --with publish'],
    ['impact', 'diff --since'],
  ];

  for (const [cmd, replacement] of DEPRECATED_PAIRS) {
    it(`\`${cmd}\` still dispatches + warns to use \`${replacement}\``, () => {
      dir = makeFixture();
      const r = spawnSync('node', [CLI, cmd, '--skip-prompts'], {
        cwd: dir,
        encoding: 'utf-8',
      });
      // Warning content (severity may vary by command — some exit non-zero
      // due to missing config; we just verify the warning was emitted).
      const combined = r.stderr + r.stdout;
      assert.match(combined, /Deprecated since v0\.20/,
        `${cmd}: expected deprecation warning; got: ${combined.slice(0, 300)}`);
      assert.match(combined, new RegExp(replacement.replace(/[.*]/g, '.')),
        `${cmd}: expected hint to mention "${replacement}"; got: ${combined.slice(0, 300)}`);
    });
  }

  it('`ci` dispatches directly — no deprecation warning, no init scaffolding (v0.33)', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'ci', '--no-history'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.ok(!(r.stderr + r.stdout).includes('Deprecated since'),
      'ci must not warn — it is a first-class command again');
    assert.ok(!(r.stderr + r.stdout).includes('DocGuard Init'),
      'ci must not route through init');
  });

  it('--quiet suppresses the deprecation warning', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'badge', '--quiet'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    assert.ok(!/Deprecated since/.test(r.stderr + r.stdout),
      `--quiet should suppress deprecation warning; got: ${(r.stderr + r.stdout).slice(0, 300)}`);
  });
});

describe('v0.20 — dropped aliases (error with hint)', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  // The 10 cute aliases that were removed in v0.20 per SURFACE-AUDIT §6.2.4.
  // `audit` is intentionally NOT in this list — it's the one permanent alias.
  const DROPPED = [
    ['onboard', /setup|init --wizard/],
    ['gen',     /generate/],
    ['badges',  /badge|init --with badge/],
    ['pipeline', /\bci\b|init --with ci/],
    ['repair',  /\bfix\b/],
    ['dx',      /diagnose/],
    ['pub',     /publish|init --with publish/],
    ['traceability', /\btrace\b/],
    ['help-warning', /explain/],
    ['update',  /upgrade/],
  ];

  for (const [cmd, expectedHint] of DROPPED) {
    it(`\`${cmd}\` errors with a hint pointing to the canonical command`, () => {
      dir = makeFixture();
      const r = spawnSync('node', [CLI, cmd], {
        cwd: dir,
        encoding: 'utf-8',
      });
      assert.notEqual(r.status, 0, `${cmd}: should exit non-zero`);
      const combined = r.stderr + r.stdout;
      assert.match(combined, /Unknown command/,
        `${cmd}: should say "Unknown command"; got: ${combined.slice(0, 300)}`);
      assert.match(combined, /alias was removed in v0\.20/,
        `${cmd}: should mention v0.20 removal; got: ${combined.slice(0, 300)}`);
      assert.match(combined, expectedHint,
        `${cmd}: hint should match ${expectedHint}; got: ${combined.slice(0, 300)}`);
    });
  }

  it('`audit` is the one permanent alias — still routes to guard silently', () => {
    dir = makeFixture();
    const r = spawnSync('node', [CLI, 'audit', '--quiet'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    // Should NOT print "Unknown command" or "alias was removed"
    const combined = r.stderr + r.stdout;
    assert.ok(!/Unknown command|alias was removed/.test(combined),
      `audit should be silent permanent alias; got: ${combined.slice(0, 300)}`);
    // Should run the guard output signature
    assert.match(combined, /Guard|validators?|passed/,
      `audit should dispatch to guard; got: ${combined.slice(0, 300)}`);
  });
});
