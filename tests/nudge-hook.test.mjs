/**
 * Agent nudge hook — `docguard hooks --claude` + `docguard nudge-hook`.
 *
 * The install path must be merge-safe and idempotent on .claude/settings.json;
 * the runtime must nudge only for canonical docs / doc-referenced code, be
 * throttled, keep stdout machine-clean, and never exit non-zero.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-nudge-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function runNudge(dir, payload) {
  return spawnSync('node', [CLI, 'nudge-hook', '--dir', dir], {
    encoding: 'utf-8',
    input: JSON.stringify(payload),
  });
}

const BASE = {
  '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
  'docs-canonical/ARCHITECTURE.md': '# Arch\nRequests flow through `api.mjs`.\n',
  'src/api.mjs': 'export const x = 1;\n',
  'src/orphan.mjs': 'export const y = 2;\n',
};

describe('docguard hooks --claude — settings.json install', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('installs the PostToolUse entry and preserves existing settings', () => {
    dir = makeRepo({
      ...BASE,
      '.claude/settings.json': JSON.stringify({
        permissions: { allow: ['Bash(ls*)'] },
        hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] },
      }),
    });
    const r = spawnSync('node', [CLI, 'hooks', '--claude', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf-8'));
    assert.deepEqual(s.permissions, { allow: ['Bash(ls*)'] }, 'existing keys preserved');
    assert.equal(s.hooks.PostToolUse.length, 2, 'existing hook group preserved, ours added');
    assert.ok(s.hooks.PostToolUse.some(g => g.hooks?.some(h => h.command?.includes('docguard nudge-hook'))));
  });

  it('is idempotent — a second install adds nothing', () => {
    dir = makeRepo(BASE);
    spawnSync('node', [CLI, 'hooks', '--claude', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    spawnSync('node', [CLI, 'hooks', '--claude', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    const s = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf-8'));
    assert.equal(s.hooks.PostToolUse.length, 1);
  });

  it('--remove deletes only our entry', () => {
    dir = makeRepo({
      ...BASE,
      '.claude/settings.json': JSON.stringify({
        hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }] },
      }),
    });
    spawnSync('node', [CLI, 'hooks', '--claude', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    spawnSync('node', [CLI, 'hooks', '--claude', '--remove', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    const s = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf-8'));
    assert.equal(s.hooks.PostToolUse.length, 1);
    assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'echo other');
  });

  it('refuses to touch an unparseable settings.json', () => {
    dir = makeRepo({ ...BASE, '.claude/settings.json': '{broken' });
    const r = spawnSync('node', [CLI, 'hooks', '--claude', '--dir', dir, '--quiet'], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.equal(readFileSync(join(dir, '.claude/settings.json'), 'utf-8'), '{broken', 'file untouched');
  });
});

describe('docguard nudge-hook — runtime', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('nudges toward guard --changed-only after a canonical-doc edit (clean JSON stdout)', () => {
    dir = makeRepo(BASE);
    const r = runNudge(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'docs-canonical/ARCHITECTURE.md') } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout); // throws if any banner byte leaked
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /guard --changed-only/);
  });

  it('nudges toward impact when edited code is referenced by docs', () => {
    dir = makeRepo(BASE);
    const r = runNudge(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/api.mjs') } });
    const out = JSON.parse(r.stdout);
    assert.match(out.reason, /docguard impact/);
    assert.match(out.reason, /ARCHITECTURE\.md/);
  });

  it('stays SILENT for code no doc references, and for files outside the project', () => {
    dir = makeRepo(BASE);
    const a = runNudge(dir, { tool_name: 'Edit', tool_input: { file_path: join(dir, 'src/orphan.mjs') } });
    assert.equal(a.stdout.trim(), '', `orphan file must not nudge; got: ${a.stdout}`);
    const b = runNudge(dir, { tool_name: 'Edit', tool_input: { file_path: '/etc/hosts' } });
    assert.equal(b.stdout.trim(), '');
    assert.equal(b.status, 0);
  });

  it('throttles: the second edit of the same file within 30 min is silent', () => {
    dir = makeRepo(BASE);
    const payload = { tool_name: 'Edit', tool_input: { file_path: join(dir, 'docs-canonical/ARCHITECTURE.md') } };
    const first = runNudge(dir, payload);
    assert.ok(first.stdout.includes('decision'), 'first edit nudges');
    const second = runNudge(dir, payload);
    assert.equal(second.stdout.trim(), '', 'second edit within throttle window is silent');
    assert.ok(existsSync(join(dir, '.docguard/nudge-state.json')), 'throttle state persisted');
  });

  it('never crashes on malformed stdin (exit 0, no output)', () => {
    dir = makeRepo(BASE);
    const r = spawnSync('node', [CLI, 'nudge-hook', '--dir', dir], { encoding: 'utf-8', input: 'not json' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });
});
