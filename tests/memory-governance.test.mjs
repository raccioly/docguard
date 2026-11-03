/**
 * Agent memory stays true, is fed verified facts, and is consolidated without
 * guessing (specs/091-memory-governance).
 *
 * @req docguard.memory-governance#FR-001
 * @req docguard.memory-governance#FR-002
 * @req docguard.memory-governance#FR-003
 * @req docguard.memory-governance#FR-004
 * @req docguard.memory-governance#FR-005
 * @req docguard.memory-governance#SC-001
 * @req docguard.memory-governance#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAidlc } from '../cli/validators/aidlc.mjs';
import { ABSENCE_CLAIM_CODES, codeDefaultLevel } from '../cli/findings.mjs';

const CLI = resolve('cli/docguard.mjs');
const SPACE = 'aidlc/spaces/default';

function project(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-mem-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
}
const codes = r => r.findings.map(f => `${f.code} ${f.message}`);
function snapshot(dir) {
  const out = {};
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out[p] = readFileSync(p, 'utf8'); } };
  walk(dir);
  return out;
}

describe('US1 — memory that names what is gone', () => {
  it('reports rules and CodeKB entries naming deleted paths or unused env vars', t => {
    const dir = project(t, {
      [`${SPACE}/memory/project.md`]: '# Project\n\n- Auth lives in `src/legacy/auth.ts`.\n- Login is `src/auth/login.ts`.\n- Read `DATABASE_URL` for the pool.\n- Read `API_TOKEN` for the client.\n\n```\n`src/example/only.ts`\n```\n- See `https://example.com/a/b`.\n',
      [`${SPACE}/codekb/app/architecture.md`]: '# Architecture\n\nRouter: `src/old-router.ts`; login `src/auth/login.ts`.\n',
      'src/auth/login.ts': 'export const t = process.env.API_TOKEN;\n',
    });
    const c = codes(validateAidlc(dir));
    const mem1 = c.filter(x => x.startsWith('MEM001'));
    assert.equal(mem1.length, 2);
    assert.ok(mem1.some(x => /project\.md:3 .*`src\/legacy\/auth\.ts`, which no longer exists/.test(x)));
    assert.ok(mem1.some(x => /`DATABASE_URL`, which no code or env example uses/.test(x)));
    const mem2 = c.filter(x => x.startsWith('MEM002'));
    assert.equal(mem2.length, 1);
    assert.match(mem2[0], /architecture\.md:3 .*`src\/old-router\.ts`/);
  });

  it('ships advisory absence claims', () => {
    for (const code of ['MEM001', 'MEM002']) { assert.equal(codeDefaultLevel(code), 'info'); assert.ok(ABSENCE_CLAIM_CODES.has(code)); }
  });
});

describe('US2 — feed AI-DLC verified facts', () => {
  const files = {
    [`${SPACE}/memory/project.md`]: '# Project\n',
    'docs-canonical/ENVIRONMENT.md': '# Environment\n\n## Environment Variables\n\n| Variable | Purpose |\n|---|---|\n| `API_TOKEN` | client |\n| `GHOST_VAR` | gone |\n',
    'src/app.js': 'export const t = process.env.API_TOKEN;\n',
    '.docguard.json': JSON.stringify({ projectName: 'm' }),
  };
  it('prints a dry run without --write and writes nothing', t => {
    const dir = project(t, files);
    const before = snapshot(dir);
    const r = spawnSync(process.execPath, [CLI, 'memory', '--export', 'aidlc'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /# DocGuard canonical memory/);
    assert.deepEqual(snapshot(dir), before);
  });
  it('--write writes only the knowledge digest, with matched facts only, and leaves memory layers alone', t => {
    const dir = project(t, files);
    const layer = readFileSync(join(dir, SPACE, 'memory/project.md'), 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'memory', '--export', 'aidlc', '--write'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const digest = readFileSync(join(dir, SPACE, 'knowledge/docguard/canonical-memory.md'), 'utf8');
    assert.match(digest, /API_TOKEN/);
    assert.doesNotMatch(digest, /GHOST_VAR/, 'a fact that did not match code is not fed');
    assert.match(r.stdout, /aidlc engine knowledge onboard/);
    assert.equal(readFileSync(join(dir, SPACE, 'memory/project.md'), 'utf8'), layer);
  });
  it('an unknown space exits 1 and names the spaces that exist', t => {
    const dir = project(t, files);
    const r = spawnSync(process.execPath, [CLI, 'memory', '--export', 'aidlc', '--space', 'nope'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Spaces: default/);
  });
});

describe('US3 — consolidation without guessing', () => {
  it('groups normalized duplicates with every source, flags stale references, writes nothing', t => {
    const dir = project(t, {
      [`${SPACE}/intents/261101-a/construction/u1/code-generation/memory.md`]: '## Interpretations\n\n- Use the repository pattern for persistence\n- Keep `src/gone.ts` as the adapter\n',
      [`${SPACE}/intents/261102-b/inception/requirements/memory.md`]: '## Tradeoffs\n\n*   use the  Repository pattern for persistence\n',
      [`${SPACE}/memory/project.md`]: '# Project\n',
    });
    const before = snapshot(dir);
    const r = spawnSync(process.execPath, [CLI, 'memory', '--consolidate', 'aidlc', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    const repo = report.entries.find(e => /repository pattern/i.test(e.text));
    assert.equal(repo.occurrences.length, 2);
    const stale = report.entries.find(e => e.references.includes('src/gone.ts'));
    assert.equal(stale.stale, true);
    assert.deepEqual(snapshot(dir), before, 'nothing written, memory layers untouched');
  });
});
