/**
 * v0.31.0 feat 6 — `verify` change-aware staging: when --since is given, the
 * agent task list carries a structured (activity-labeled) diff and flags claims
 * about just-changed code. Backward compatible without --since.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
function git(dir, ...a) { spawnSync('git', a, { cwd: dir, encoding: 'utf-8' }); }

describe('verify --since change context (feat 6)', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-vcc-'));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t.co'); git(dir, 'config', 'user.name', 'T');
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.0' }));
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }));
    writeFileSync(join(dir, 'src', 'limits.ts'), 'export const MAX_RETRIES = 3;\n');
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'),
      '# Architecture\nThe system retries up to 3 times. See `src/limits.ts`.\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'src', 'limits.ts'), 'export const MAX_RETRIES = 5;\n'); // changed!
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'bump retries');
  });
  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('attaches an activity-labeled changeContext with --since', () => {
    const r = spawnSync('node', [CLI, 'verify', '--semantic', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const j = JSON.parse(r.stdout);
    assert.ok(j.changeContext, 'changeContext should be present with --since');
    assert.ok(j.changeContext.changedFiles.includes('src/limits.ts'));
    const act = j.changeContext.activities.find(a => a.file === 'src/limits.ts');
    assert.ok(act && act.activities.length > 0, 'limits.ts should have activities');
    assert.ok(act.activities.some(a => a.type === 'replace' || a.type === 'delete'),
      `expected a replace/delete activity for the MAX_RETRIES change; got ${JSON.stringify(act.activities)}`);
  });

  it('omits changeContext without --since (backward compatible)', () => {
    const r = spawnSync('node', [CLI, 'verify', '--semantic', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const j = JSON.parse(r.stdout);
    assert.equal(j.changeContext, undefined);
    assert.ok(j.tasks.every(t => t.aboutChangedCode === undefined));
  });
});
