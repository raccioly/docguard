/**
 * FRS002 ranked and capped in guard's text output (specs/097-strict-by-default
 * T028b, ported from spec 096). Identical repository-wide "review due" lines
 * train a reader to skip them, so text shows the three most stale and says how
 * many more there are and how to list them. JSON keeps every finding, so the
 * exit code, the totals and the baseline fingerprints do not move.
 *
 * @req docguard.strict-by-default#FR-014
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { rankFrs002 } from '../cli/commands/guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const DOCS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];

let dir;
before(() => {
  dir = makeTempDir('docguard-frs002-');
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  let day = 1;
  const commit = (files, msg) => {
    for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
    fixtureGit(dir, ['add', '-A']);
    const date = `2026-01-${String(day++).padStart(2, '0')}T12:00:00Z`;
    fixtureGit(dir, ['commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  };
  // Only Freshness matters here; `standard` keeps the other validators out of the exit code.
  const validators = { freshness: true, structure: false, docSections: false, docsSync: false, drift: false, changelog: false, testSpec: false, environment: false, security: false, architecture: false, traceability: false, docsDiff: false, apiSurface: false, metadataSync: false, docsCoverage: false, docQuality: false, todoTracking: false, schemaSync: false, specKit: false, documentLifecycle: false };
  commit({ '.docguard.json': JSON.stringify({ projectName: 'frs002-cap', version: '0.6', enforcement: 'standard', requiredFiles: { canonical: DOCS.map(d => `docs-canonical/${d}.md`), agentFile: [] }, validators }, null, 2), 'src/a.mjs': 'export const a = 0;\n' }, 'init');
  // Each document is written two code commits after the previous one, so ALPHA is the most stale.
  let n = 0;
  for (const d of DOCS) {
    commit({ [`docs-canonical/${d}.md`]: `# ${d}\n\nDescribes src/a.mjs.\n` }, `doc ${d}`);
    for (let i = 0; i < 2; i++) commit({ 'src/a.mjs': `export const a = ${++n};\n` }, `code ${n}`);
  }
  for (let i = 0; i < 9; i++) commit({ 'src/a.mjs': `export const a = ${++n};\n` }, `code ${n}`);
});
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
const frs002Lines = out => out.split('\n').filter(l => /\[FRS002\] docs-canonical\//.test(l));

describe('T028b: FRS002 ranked and capped at three in text', () => {
  it('text shows the three most stale, most commits first, and one line for the rest', () => {
    const r = run();
    const lines = frs002Lines(r.stdout);
    assert.equal(lines.length, 3, r.stdout);
    assert.deepEqual(lines.map(l => l.match(/docs-canonical\/(\w+)\.md/)[1]), ['ALPHA', 'BRAVO', 'CHARLIE']);
    assert.match(r.stdout, /\[FRS002\] and 2 more document\(s\) due for review by the repository-wide count — `docguard guard --verbose` lists them all/);
  });

  it('--verbose lists every one', () => {
    assert.equal(frs002Lines(run('--verbose').stdout).length, 5);
  });

  it('JSON keeps every finding, and the exit code is the same as with --verbose', () => {
    const json = run('--format', 'json');
    const findings = JSON.parse(json.stdout).findings.filter(f => f.code === 'FRS002');
    assert.equal(findings.length, 5);
    assert.equal(run().status, run('--verbose').status);
    assert.equal(run().status, json.status);
  });

  it('ranking reads the commit count from the current FRS002 message (fails if the message format drifts)', () => {
    const json = JSON.parse(run('--format', 'json').stdout);
    const ranked = rankFrs002(json.findings.filter(f => f.code === 'FRS002'));
    assert.match(ranked[0].message, /\d+ code commits since/);
    assert.deepEqual(ranked.map(f => f.location.match(/(\w+)\.md/)[1]), DOCS);
  });

  it('a finding with measured staleness evidence ranks above a bare commit count', () => {
    const ranked = rankFrs002([
      { code: 'FRS002', location: 'a.md', message: 'a.md — review due: 40 code commits since last doc update' },
      { code: 'FRS002', location: 'b.md', message: 'b.md — review due: 12 code commits since last doc update', staleness: { references: [{ path: 'src/x.mjs', share: 0.8 }] } },
    ]);
    assert.deepEqual(ranked.map(f => f.location), ['b.md', 'a.md']);
  });
});
