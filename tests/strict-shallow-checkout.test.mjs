/**
 * A shallow checkout is reported on every run and does not change the exit code (specs/097-strict-by-default
 * FR-007, amended 2026-11-13): `actions/checkout` fetches one commit, so Freshness cannot see the history, which
 * is a property of the checkout and not of the project's documents. A complete repository with too few commits,
 * and a document that has no review record, are the project's own state and keep blocking.
 *
 * Every fixture is built with real git: a source repository with dated commits, then `git clone --depth 1`.
 *
 * @req docguard.strict-by-default#FR-007
 * @req docguard.strict-by-default#FR-021
 * @req docguard.strict-by-default#FR-005
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { isolateWithWaivers } from './helpers/strict-isolation.mjs';
import { isShallowRepository } from '../cli/shared-git.mjs';
import { EMPTY_CAUSES } from '../cli/validator-coverage.mjs';
import { buildStrictReport, strictBlocks, couldNotReadLines } from '../cli/enforcement.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const KEYS = [
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });
const scratch = prefix => { const dir = mkdtempSync(join(tmpdir(), prefix)); temporary.push(dir); return dir; };
const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
const DATES = ['2026-01-01', '2026-01-03', '2026-01-04', '2026-01-05'];

/**
 * A source repository with `commits` dated commits. `enforcement` is written to .docguard.json only when given:
 * no key is the default, which is strict.
 */
function source({ commits = 4, agents = null, enforcement = null } = {}) {
  const dir = scratch('docguard-shallow-src-');
  const isolated = isolateWithWaivers({}, { validators: Object.fromEntries(KEYS.map(k => [k, k === 'freshness'])), enforcement: 'strict' });
  const config = { projectName: 'shallow-fixture', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: isolated.config.validators, ...(enforcement ? { enforcement } : {}) };
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['config', 'user.email', 't@t']);
  for (let i = 0; i < commits; i++) {
    if (i === 0) {
      write(dir, '.docguard.json', JSON.stringify(config, null, 2));
      write(dir, 'README.md', `${isolated.files['README.md']}`);
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nThe service reads a queue and writes a table.\n');
      if (agents !== null) write(dir, 'AGENTS.md', agents);
    }
    write(dir, `src/code${i}.js`, `export const n${i} = ${i};\n`);
    fixtureGit(dir, ['add', '-A']);
    const date = `${DATES[i] || '2026-02-01'}T12:00:00Z`;
    fixtureGit(dir, ['commit', '-q', '-m', `commit ${i}`], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  }
  return dir;
}

function shallow(src) {
  const dest = join(scratch('docguard-shallow-dst-'), 'clone');
  fixtureGit(dirname(dest), ['clone', '-q', '--depth', '1', `file://${src}`, dest]);
  return dest;
}

function guardJson(dir) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, '--format', 'json'], { encoding: 'utf8', env: ENV });
  return { status: r.status, json: JSON.parse(r.stdout) };
}
const guardText = dir => spawnSync(process.execPath, [CLI, 'guard', '--dir', dir], { encoding: 'utf8', env: ENV });
const freshness = json => json.validators.find(v => v.key === 'freshness');
const couldNotRead = json => json.strict.couldNotRead.filter(c => c.validator === 'freshness');

const MARKED = '# Agents\n\nRun `node src/code0.js`.\n<!-- docguard:last-reviewed 2026-01-02 -->\n';
const UNREVIEWED = '# Agents\n\nRun `node src/code0.js`.\n';

describe('the helper and the cause', () => {
  it('isShallowRepository tells a depth-1 clone from the repository it came from', () => {
    const src = source();
    assert.equal(isShallowRepository(src), false);
    assert.equal(isShallowRepository(shallow(src)), true);
  });
  it('a directory that is not a repository is not shallow', () => {
    assert.equal(isShallowRepository(scratch('docguard-shallow-none-')), false);
  });
  it('history-unavailable is a registered empty cause', () => {
    assert.ok(EMPTY_CAUSES.includes('history-unavailable'));
  });
});

describe('FR-007: a shallow checkout is reported and does not block (strict is the default)', () => {
  it('a depth-1 clone of a four-commit repository: Freshness is listed under could-not-read with the fix, and does not block', () => {
    const { status, json } = guardJson(shallow(source()));
    assert.notEqual(status, 4, JSON.stringify(json.strict));
    assert.ok(!json.strict.blocking.includes('freshness'));
    assert.ok(!json.strict.unexamined.some(u => u.validator === 'freshness'));
    const [entry] = couldNotRead(json);
    assert.ok(entry, 'Freshness is listed under strict.couldNotRead');
    assert.equal(entry.cause, 'history-unavailable');
    assert.match(entry.howToConfigure, /fetch-depth/);
    assert.match(entry.reason, /shallow/i);
    assert.equal(freshness(json).emptyCause, 'history-unavailable');
  });

  it('the text output prints it in the could-not-read block with the fix', () => {
    const r = guardText(shallow(source()));
    assert.notEqual(r.status, 4);
    assert.match(r.stdout, /DocGuard could not read: \(reported only; this does not change the exit code\)/);
    assert.match(r.stdout, /Freshness is empty \(history-unavailable\)/);
    assert.match(r.stdout, /fetch-depth: 0/);
  });

  it('the same content as a complete repository with one commit still blocks, cause needs-content', () => {
    const { status, json } = guardJson(source({ commits: 1 }));
    assert.equal(status, 4);
    assert.ok(json.strict.blocking.includes('freshness'));
    assert.equal(json.strict.unexamined.find(u => u.validator === 'freshness').cause, 'needs-content');
    assert.equal(couldNotRead(json).length, 0);
  });

  it('a shallow clone with a reviewed root AGENTS.md: not blocking, listed under could-not-read', () => {
    const src = source({ agents: MARKED });
    const { status, json } = guardJson(shallow(src));
    assert.notEqual(status, 4, JSON.stringify(json.strict));
    assert.ok(!json.strict.blocking.includes('freshness'));
    const entries = couldNotRead(json);
    assert.equal(entries.length, 1, 'one entry for Freshness, documents joined to it');
    assert.equal(entries[0].cause, 'history-unavailable');
    assert.ok(entries[0].documents?.includes('AGENTS.md'), JSON.stringify(entries[0]));
  });

  it('the same reviewed AGENTS.md in the complete repository is examined: nothing to report', () => {
    const { status, json } = guardJson(source({ agents: MARKED }));
    assert.notEqual(status, 4, JSON.stringify(json.strict));
    assert.equal(couldNotRead(json).length, 0);
  });

  it('a complete repository where AGENTS.md has no review record still blocks (FR-021)', () => {
    const { status, json } = guardJson(source({ agents: UNREVIEWED }));
    assert.equal(status, 4);
    const row = json.strict.unexamined.find(u => u.validator === 'freshness');
    assert.deepEqual(row.documents, ['AGENTS.md']);
    assert.equal(row.cause, 'needs-declaration');
  });

  it('a shallow clone whose AGENTS.md has no review record at all still blocks: that gap is not the history', () => {
    const { status, json } = guardJson(shallow(source({ agents: UNREVIEWED })));
    assert.equal(status, 4);
    const row = json.strict.unexamined.find(u => u.validator === 'freshness');
    assert.deepEqual(row.documents, ['AGENTS.md']);
    assert.equal(row.cause, 'needs-declaration');
  });
});

describe('standard mode: exit codes are unchanged in all four situations', () => {
  const standard = opts => ({ enforcement: 'standard', ...opts });
  it('shallow, shallow with a reviewed AGENTS.md, complete with one commit, complete unreviewed: none exits 4', () => {
    for (const dir of [shallow(source(standard())), shallow(source(standard({ agents: MARKED }))), source(standard({ commits: 1 })), source(standard({ agents: UNREVIEWED }))]) {
      const { status, json } = guardJson(dir);
      assert.notEqual(status, 4);
      assert.ok(!json.strict || json.strict.evaluated === false || json.strict.blocking.length === 0);
    }
  });
  it('the exit code of a shallow clone equals that of the complete one-commit repository under standard', () => {
    assert.equal(guardJson(shallow(source(standard()))).status, guardJson(source(standard({ commits: 1 }))).status);
  });
});

describe('the strict report, on synthetic results', () => {
  const frs = extra => ({ key: 'freshness', name: 'Freshness', verdict: 'empty', findings: [], performed: 0, applicability: { status: 'no-matches', reason: 'shallow' }, ...extra });
  it('a validator-level history-unavailable result goes to couldNotRead and never to unexamined', () => {
    const report = buildStrictReport([frs({ emptyCause: 'history-unavailable', howToConfigure: 'fetch-depth: 0' })]);
    assert.deepEqual(report.unexamined, []);
    assert.deepEqual(report.blocking, []);
    assert.equal(report.couldNotRead[0].cause, 'history-unavailable');
    assert.equal(strictBlocks({ strict: report }), false);
  });
  it('history-unavailable documents go to couldNotRead; a blocking document beside them still blocks', () => {
    const docs = [
      { path: 'AGENTS.md', cause: 'history-unavailable', blocking: false, reason: 'AGENTS.md: shallow', howToConfigure: 'fetch-depth: 0' },
      { path: 'CLAUDE.md', cause: 'needs-declaration', blocking: true, reason: 'CLAUDE.md has no review record', howToConfigure: 'review it' },
    ];
    const report = buildStrictReport([{ key: 'freshness', name: 'Freshness', verdict: 'pass', findings: [], performed: 3, unexaminedDocuments: docs }]);
    assert.deepEqual(report.blocking, ['freshness']);
    assert.deepEqual(report.unexamined[0].documents, ['CLAUDE.md']);
    assert.deepEqual(report.couldNotRead[0].documents, ['AGENTS.md']);
    assert.equal(report.couldNotRead[0].cause, 'history-unavailable');
    const lines = couldNotReadLines(report).join('\n');
    assert.match(lines, /shallow/);
    assert.match(lines, /fetch-depth: 0/);
  });
  it('history-unavailable documents alone never block', () => {
    const docs = [{ path: 'AGENTS.md', cause: 'history-unavailable', blocking: false, reason: 'AGENTS.md: shallow', howToConfigure: 'fetch-depth: 0' }];
    const report = buildStrictReport([{ key: 'freshness', name: 'Freshness', verdict: 'pass', findings: [], performed: 3, unexaminedDocuments: docs }]);
    assert.equal(strictBlocks({ strict: report }), false);
  });
});

describe('docguard upgrade shows the same classification (read-only strict preview)', () => {
  it('a shallow clone lists Freshness as reported, not as failing', () => {
    const dir = shallow(source());
    const out = spawnSync(process.execPath, [CLI, 'upgrade', '--schema-only'], { cwd: dir, encoding: 'utf8', env: ENV }).stdout;
    assert.match(out, /Reported, and not failing the build:/);
    assert.match(out, /Freshness is empty \(history-unavailable\)/);
    assert.doesNotMatch(out, /What now fails:[^\n]*\n[^\n]*Freshness/);
  });
  it('a complete one-commit repository lists Freshness as failing', () => {
    const dir = source({ commits: 1 });
    const out = spawnSync(process.execPath, [CLI, 'upgrade', '--schema-only'], { cwd: dir, encoding: 'utf8', env: ENV }).stdout;
    assert.match(out, /Freshness is empty \(needs-content\)/);
    assert.match(out, /What now fails:/);
  });
});
