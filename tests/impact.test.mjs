/**
 * S-11 — `docguard impact` command.
 *
 * @req SC-S11-001 — reports per-file → doc mappings
 * @req SC-S11-002 — files with no doc references are listed as orphaned
 * @req SC-S11-003 — --format json emits parseable structured output
 * @req SC-S11-004 — non-code files (.md, .json, etc.) are filtered from impact
 * @req SC-S11-005 — exits 1 when not in a git repo
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-impact-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function gitInit(dir) {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
}

function commit(dir, msg) {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg], { cwd: dir });
}

describe('docguard impact', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('exits 1 when not in a git repo', () => {
    dir = makeRepo({ 'package.json': '{}' });
    const r = spawnSync('node', [CLI, 'impact'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 1);
  });

  it('reports per-file → doc mappings for changed code files', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/routes/users.ts': 'export const x = 1;',
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\nSee `src/routes/users.ts` for user routes.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    // Modify the route file
    writeFileSync(join(dir, 'src/routes/users.ts'), 'export const x = 2;');
    commit(dir, 'change route');

    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1'],
      { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /ARCHITECTURE\.md/);
    assert.match(r.stdout, /code file\(s\) changed/);
  });

  it('lists orphaned files (no doc references)', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/lib/utils.ts': 'export const x = 1;',
      'docs-canonical/ARCHITECTURE.md': '# A\nNo mention of utils anywhere.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/lib/utils.ts'), 'export const x = 2;');
    commit(dir, 'change utils');

    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1'],
      { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /No canonical doc/i,
      'orphaned file should be highlighted');
  });

  it('--format json emits parseable structured output', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/index.ts': 'x',
      'docs-canonical/ARCHITECTURE.md': '# A\nSee `src/index.ts`.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/index.ts'), 'y');
    commit(dir, 'change');

    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'],
      { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.equal(data.since, 'HEAD~1');
    assert.ok(Array.isArray(data.changedFiles));
    assert.ok(Array.isArray(data.affectedDocs));
    assert.equal(data.changedFiles[0], 'src/index.ts');
  });

  it('skips non-code files (.md, .json) from impact analysis', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# A\nstub.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    // Modify only a markdown doc and the package.json — no code
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nUpdated.\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
    commit(dir, 'docs + bump');

    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'],
      { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.equal(data.changedFiles.length, 0,
      'non-code files should not appear in changedFiles');
    assert.ok(data.ignoredFiles.length > 0, 'ignored files should be reported separately');
  });
});
