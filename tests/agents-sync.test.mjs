import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
}

const MARKER_RE = /docguard:agents-sync source=AGENTS\.md hash=([0-9a-f]{16})/;

describe('agents --sync / --check (v0.29)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-agentsync-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'sync-fixture', version: '1.0.0' }));
    writeFileSync(join(tmpDir, '.docguard.json'), JSON.stringify({ profile: 'starter', projectName: 'sync-fixture' }));
    writeFileSync(join(tmpDir, 'AGENTS.md'), '# Agent Rules\n\n## Rules\n\n- rule one\n');
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('--sync generates the family with markers and matching hashes', () => {
    const res = run(['agents', '--sync'], tmpDir);
    assert.equal(res.status, 0, res.stderr + res.stdout);

    const claude = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const copilot = readFileSync(join(tmpDir, '.github', 'copilot-instructions.md'), 'utf-8');
    const cursor = readFileSync(join(tmpDir, '.cursor', 'rules', 'cdd.mdc'), 'utf-8');
    const mClaude = claude.match(MARKER_RE);
    const mCopilot = copilot.match(MARKER_RE);
    const mCursor = cursor.match(MARKER_RE);
    assert.ok(mClaude && mCopilot && mCursor, 'all text variants carry the marker');
    assert.equal(mClaude[1], mCopilot[1], 'same source hash everywhere');
    assert.ok(cursor.startsWith('---\n'), 'mdc frontmatter must stay the first bytes');

    // JSON target carries the marker as a field, not a comment.
    const gemini = JSON.parse(readFileSync(join(tmpDir, '.gemini', 'settings.json'), 'utf-8'));
    assert.equal(gemini._docguardSync.hash, mClaude[1]);
  });

  it('--check exits 0 when fresh, 2 after AGENTS.md changes, 0 again after resync', () => {
    assert.equal(run(['agents', '--sync'], tmpDir).status, 0);
    assert.equal(run(['agents', '--check'], tmpDir).status, 0, 'fresh family must pass');

    writeFileSync(join(tmpDir, 'AGENTS.md'), '# Agent Rules\n\n## Rules\n\n- rule one\n- rule TWO (changed)\n');
    const stale = run(['agents', '--check'], tmpDir);
    assert.equal(stale.status, 2, `stale family must exit 2; stdout: ${stale.stdout}`);
    assert.ok(stale.stdout.includes('stale'), stale.stdout);

    assert.equal(run(['agents', '--sync'], tmpDir).status, 0);
    assert.equal(run(['agents', '--check'], tmpDir).status, 0, 'resync must restore green');
  });

  it('--sync updates a stale marked file (unlike the default skip-if-exists mode)', () => {
    assert.equal(run(['agents', '--sync'], tmpDir).status, 0);
    const before = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');

    writeFileSync(join(tmpDir, 'AGENTS.md'), '# Agent Rules\n\n## Rules\n\n- a brand new rule\n');
    assert.equal(run(['agents', '--sync'], tmpDir).status, 0);
    const after = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.notEqual(before, after, 'marked file must be regenerated');
    assert.ok(after.includes('a brand new rule'));
  });

  it('--sync never overwrites a hand-written (unmarked) file without --force', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# My hand-written Claude instructions\n\nPrecious content.\n');
    const res = run(['agents', '--sync'], tmpDir);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('without a sync marker'), res.stdout);
    const claude = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(claude.includes('Precious content.'), 'hand-written file must be untouched');

    // --force explicitly adopts it.
    assert.equal(run(['agents', '--sync', '--force'], tmpDir).status, 0);
    const adopted = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(MARKER_RE.test(adopted), '--force adopts the file into the synced family');
  });

  it('--check treats unmarked/absent files as unmanaged, not stale', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# Hand-written, no marker\n');
    const res = run(['agents', '--check'], tmpDir);
    assert.equal(res.status, 0, `unmanaged files must not fail the gate; stdout: ${res.stdout}`);
    assert.ok(res.stdout.includes('unmanaged'));
  });

  it('default mode (no flags) keeps legacy skip-if-exists behavior', () => {
    assert.equal(run(['agents'], tmpDir).status, 0);
    const first = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    const res = run(['agents'], tmpDir);
    assert.equal(res.status, 0);
    assert.ok(res.stdout.includes('exists, use --force'), 'legacy skip message expected');
    assert.equal(readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8'), first, 'no rewrite without --force');
  });
});
