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

  // ── v0.31.0 blast radius (feat 1) ──

  it('SC-S11-007: flags an agent-instruction file that references changed code', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/auth.ts': 'export function login(){}\n',
      'AGENTS.md': '# Agent rules\nAuth lives in `src/auth.ts` — never bypass it.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/auth.ts'), 'export function login(){ /* changed */ }\n');
    commit(dir, 'change auth');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const agents = data.affectedDocs.find(d => d.doc === 'AGENTS.md');
    assert.ok(agents, 'AGENTS.md should be flagged as affected by the code change');
    assert.equal(agents.isAgentFile, true);
  });

  it('SC-S11-008: doc→doc blast radius flags docs (incl agent files) that reference a changed doc', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nThe system.\n',
      'docs-canonical/SECURITY.md': '# Security\nSee ARCHITECTURE.md for the layer map.\n',
      'AGENTS.md': '# Agent rules\nFollow docs-canonical/ARCHITECTURE.md.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\nThe system, revised.\n');
    commit(dir, 'revise architecture');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const edge = data.blastRadius.find(b => b.changedDoc.endsWith('ARCHITECTURE.md'));
    assert.ok(edge, `expected a blast-radius edge for ARCHITECTURE.md; got ${JSON.stringify(data.blastRadius)}`);
    const deps = edge.dependents.map(d => d.doc);
    assert.ok(deps.includes('SECURITY.md'), 'SECURITY.md references ARCHITECTURE.md → dependent');
    assert.ok(deps.includes('AGENTS.md'), 'AGENTS.md references ARCHITECTURE.md → dependent');
    assert.equal(edge.dependents.find(d => d.doc === 'AGENTS.md').isAgentFile, true);
  });

  it('blast radius does NOT fire from non-canonical .md (CHANGELOG/README/.wolf)', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nSee CHANGELOG.md for history.\n',
      'CHANGELOG.md': '# Changelog\n- init\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n- init\n- more\n');
    commit(dir, 'update changelog');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.equal(data.blastRadius.length, 0,
      'a CHANGELOG.md change must not blast-radius the docs that merely mention it');
  });

  // ── indirect impact via reverse import graph (SC-S11-009) ──

  it('SC-S11-009: flags docs about an IMPORTER of the changed file (indirect)', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/db.mjs': 'export function query(){}\n',
      'src/api.mjs': "import { query } from './db.mjs';\nexport function handler(){ return query(); }\n",
      // The doc describes api.mjs ONLY — db.mjs itself is undocumented.
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nRequests flow through `src/api.mjs`.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/db.mjs'), 'export function query(){ /* changed */ }\n');
    commit(dir, 'change db');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.ok(Array.isArray(data.indirectDocs), 'indirectDocs must be in the JSON payload');
    const hit = data.indirectDocs.find(d => d.doc === 'ARCHITECTURE.md');
    assert.ok(hit, `ARCHITECTURE.md should be indirect-affected; got ${JSON.stringify(data.indirectDocs)}`);
    assert.ok(hit.chains.some(ch => ch.via === 'src/api.mjs' && ch.changed === 'src/db.mjs' && ch.hops === 1),
      `chain should explain api.mjs imports db.mjs; got ${JSON.stringify(hit.chains)}`);
  });

  it('SC-S11-009: a doc DIRECTLY affected by the same change is not repeated as indirect', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/db.mjs': 'export function query(){}\n',
      'src/api.mjs': "import { query } from './db.mjs';\nexport function handler(){ return query(); }\n",
      // Doc references BOTH files — the direct hit must win.
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n`src/api.mjs` calls `src/db.mjs`.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/db.mjs'), 'export function query(){ /* changed */ }\n');
    commit(dir, 'change db');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.ok(data.affectedDocs.some(d => d.doc === 'ARCHITECTURE.md'), 'direct hit expected');
    assert.ok(!data.indirectDocs.some(d => d.doc === 'ARCHITECTURE.md'),
      'doc must not appear as indirect when directly affected by the same change');
  });

  it('SC-S11-009: --no-indirect disables the import-graph analysis', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/db.mjs': 'export function query(){}\n',
      'src/api.mjs': "import { query } from './db.mjs';\n",
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nSee `src/api.mjs`.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'src/db.mjs'), 'export function query(){ /* changed */ }\n');
    commit(dir, 'change db');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json', '--no-indirect'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    assert.equal(data.indirectDocs.length, 0, 'no indirect analysis with --no-indirect');
  });

  // ── impact --prs: cross-PR doc-conflict analysis ──

  it('computeDocConflicts: two PRs touching files that impact the same doc are a conflict pair', async () => {
    const { computeDocConflicts } = await import('../cli/commands/impact.mjs');
    const docsIndex = new Map([
      ['ARCHITECTURE.md', ['Requests flow through `src/api.mjs` and `src/db.mjs`.']],
      ['SECURITY.md', ['Auth lives in `src/auth.mjs`.']],
    ]);
    const prs = [
      { number: 1, title: 'api tweak', files: ['src/api.mjs'] },
      { number: 2, title: 'db tweak', files: ['src/db.mjs'] },
      { number: 3, title: 'auth tweak', files: ['src/auth.mjs'] },
      { number: 4, title: 'doc edit', files: ['docs-canonical/SECURITY.md'] },
    ];
    const { prImpacts, conflicts } = computeDocConflicts(prs, docsIndex);
    assert.deepEqual(prImpacts.find(p => p.number === 1).docs, ['ARCHITECTURE.md']);
    // #1 and #2 collide on ARCHITECTURE.md; #3 (code) and #4 (direct doc edit) collide on SECURITY.md.
    assert.ok(conflicts.some(cf => cf.prs.join(',') === '1,2' && cf.docs.includes('ARCHITECTURE.md')),
      JSON.stringify(conflicts));
    assert.ok(conflicts.some(cf => cf.prs.join(',') === '3,4' && cf.docs.includes('SECURITY.md')),
      'a direct canonical-doc edit must conflict with a code PR impacting the same doc');
    assert.ok(!conflicts.some(cf => cf.prs.includes(1) && cf.prs.includes(3)), 'no false pair');
  });

  it('impact --prs degrades gracefully when gh is unavailable', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    const r = spawnSync(process.execPath, [CLI, 'impact', '--prs', '--format', 'json'], {
      cwd: dir, encoding: 'utf-8',
      env: { ...process.env, PATH: '/nonexistent-bin' }, // no gh on PATH; node spawned by absolute path
    });
    // With PATH stripped, git itself is also unavailable — either guard
    // (not-a-git-repo or gh-not-installed) must answer with a graceful JSON
    // error payload, never a crash.
    const data = JSON.parse(r.stdout);
    assert.ok(data.error, `expected a graceful error payload; got ${r.stdout}`);
    assert.ok(!r.stderr.includes('Error:'), `no stack trace expected; got ${r.stderr}`);
  });

  it('blast radius sees Obsidian wikilink dependents ([[ARCHITECTURE]])', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nThe system.\n',
      'docs-canonical/SECURITY.md': '# Security\nSee [[ARCHITECTURE#Layers|the layer map]].\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\nRevised.\n');
    commit(dir, 'revise architecture');
    const r = spawnSync('node', [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const edge = data.blastRadius.find(b => b.changedDoc.endsWith('ARCHITECTURE.md'));
    assert.ok(edge, `expected a wikilink blast-radius edge; got ${JSON.stringify(data.blastRadius)}`);
    assert.ok(edge.dependents.some(d => d.doc === 'SECURITY.md'),
      'SECURITY.md references the changed doc only via [[ARCHITECTURE#…]] and must be flagged');
  });
});
