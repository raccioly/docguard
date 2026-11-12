/**
 * Recorded document reviews and per-reference staleness
 * (specs/095-recorded-document-reviews).
 *
 * @req docguard.recorded-document-reviews#FR-001
 * @req docguard.recorded-document-reviews#FR-002
 * @req docguard.recorded-document-reviews#FR-003
 * @req docguard.recorded-document-reviews#FR-004
 * @req docguard.recorded-document-reviews#FR-005
 * @req docguard.recorded-document-reviews#FR-006
 * @req docguard.recorded-document-reviews#FR-007
 * @req docguard.recorded-document-reviews#FR-008
 * @req docguard.recorded-document-reviews#FR-009
 * @req docguard.recorded-document-reviews#FR-010
 * @req docguard.recorded-document-reviews#FR-011
 * @req docguard.recorded-document-reviews#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureGit } from './helpers/git.mjs';
import { validateFreshness } from '../cli/validators/freshness.mjs';
import { documentReferences, readDocReviews, DOC_REVIEWS_PATH } from '../cli/scanners/doc-reviews.mjs';
import { resolveFindingEnforcement } from '../cli/shared.mjs';

const CLI = resolve('cli/docguard.mjs');
const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
const code = (n, tag = 'v') => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join('\n') + '\n';

function commit(dir, files, message, date) {
  for (const [p, b] of Object.entries(files)) write(dir, p, b);
  fixtureGit(dir, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` };
  fixtureGit(dir, ['commit', '-q', '-m', message], { env });
}

/**
 * A project reviewed on 2025-03-01: AGENTS.md describes src/engine.mjs (40
 * lines) and src/util.mjs (40 lines). Later, engine.mjs grows to 140 lines
 * and a `corpus` script and `corpus/` directory appear.
 */
function project(t, { marker = true, grow = true, surface = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-rdr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  const agents = `${marker ? '<!-- docguard:last-reviewed 2025-03-01 -->\n' : ''}# Agents\n\n## Key files\n\n- \`src/engine.mjs\` — the engine: parse, then run.\n- \`src/util.mjs\` — helpers.\n- \`src/\` — sources.\n\nRun \`npm test\` before pushing.\n`;
  commit(dir, {
    'AGENTS.md': agents,
    'src/engine.mjs': code(40),
    'src/util.mjs': code(40, 'u'),
    'package.json': JSON.stringify({ name: 'fx', scripts: { test: 'node --test' } }, null, 2),
  }, 'initial', '2025-03-01');
  if (grow) commit(dir, { 'src/engine.mjs': code(140) }, 'engine grows', '2025-05-01');
  if (surface) commit(dir, {
    'package.json': JSON.stringify({ name: 'fx', scripts: { test: 'node --test', corpus: 'node corpus/run.mjs', precorpus: 'true' } }, null, 2),
    'corpus/run.mjs': code(30, 'c'),
  }, 'corpus', '2025-05-02');
  return dir;
}

const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
const codes = (results, c) => results.filter(r => r.code === c);

describe('US1 — a review records what was checked', () => {
  it('review --accept <doc> records the commit, the reason and a fingerprint per referenced file', t => {
    const dir = project(t, { grow: false, surface: false });
    const r = run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'read every key file against the code', '--format', 'json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const { reviews, error } = readDocReviews(dir);
    assert.equal(error, null);
    const entry = reviews.documents['AGENTS.md'];
    assert.match(entry.reviewedRevision, /^[0-9a-f]{40}$/);
    assert.deepEqual(Object.keys(entry.references).sort(), ['src/engine.mjs', 'src/util.mjs']);
    assert.equal(entry.references['src/engine.mjs'].tier, 'content');
    assert.equal(entry.excluded.src, 'directory');
    const again = JSON.parse(run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'read every key file against the code', '--format', 'json']).stdout);
    assert.equal(again.document.written, false, 'an identical rerun writes nothing');
  });

  it('refuses a short reason and an unknown document', t => {
    const dir = project(t, { grow: false, surface: false });
    assert.equal(run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'ok']).status, 1);
    write(dir, 'notes.md', '# notes\n');
    const r = run(dir, ['review', '--accept', 'notes.md', '--reason', 'looked at it closely']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not an agent-instruction, canonical, README or CONTRIBUTING document/);
  });

  it('excludes directories, data-like files, generated files and tiny files (FR-004)', t => {
    const dir = project(t, { grow: false, surface: false });
    write(dir, 'CHANGELOG.md', '# Changes\n'.repeat(30));
    write(dir, 'src/gen.mjs', `// <!-- generated by codegen 1.0 -->\n${code(30)}`.replace('// ', ''));
    write(dir, 'src/tiny.mjs', code(5));
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-q', '-m', 'more']);
    const text = '`src/engine.mjs` `CHANGELOG.md` `src/gen.mjs` `src/tiny.mjs` `src/`';
    const tracked = fixtureGit(dir, ['ls-files']).trim().split('\n');
    const { references, excluded } = documentReferences(dir, 'AGENTS.md', text, { tracked });
    assert.deepEqual(references.map(r => r.path), ['src/engine.mjs']);
    assert.match(excluded['CHANGELOG.md'], /changelog/);
    assert.equal(excluded['src/gen.mjs'], 'generated-by header');
    assert.equal(excluded['src/tiny.mjs'], 'under 20 lines');
    assert.equal(excluded.src, 'directory');
  });
});

describe('US2 — FRS006 names the file that changed since the review', () => {
  it('marker review: names the line, the file, the share and +added/−deleted', t => {
    const results = validateFreshness(project(t, { surface: false }), {});
    const hits = codes(results, 'FRS006');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].doc, 'AGENTS.md:6');
    assert.match(hits[0].message, /L6 src\/engine\.mjs 71% \(\+100\/−0\)/);
    assert.match(hits[0].message, /since its 2025-03-01 review/);
    assert.equal(hits[0].staleness.references[0].path, 'src/engine.mjs');
    assert.ok(!/util\.mjs/.test(hits[0].message), 'an unchanged file is not named');
  });

  it('recorded review now: silent; then one referenced file changes: fires for that file only', t => {
    const dir = project(t, { surface: false });
    assert.equal(run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'reviewed against the grown engine']).status, 0);
    commit(dir, { [DOC_REVIEWS_PATH]: readFileSync(join(dir, DOC_REVIEWS_PATH), 'utf8') }, 'record review', '2025-05-03');
    assert.equal(codes(validateFreshness(dir, {}), 'FRS006').length, 0);
    commit(dir, { 'src/util.mjs': code(120, 'w') }, 'rewrite util', '2025-05-10');
    const hits = codes(validateFreshness(dir, {}), 'FRS006');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /src\/util\.mjs/);
    assert.ok(!/engine/.test(hits[0].message));
    assert.match(hits[0].message, /\(recorded; fingerprint changed\)/);
  });

  it('a recorded review whose fingerprint is unchanged is silent even when the share is high', t => {
    const dir = project(t, { surface: false });
    // Record at the 2025-03-01 commit, then make util grow and shrink back to the same bytes.
    assert.equal(run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'reviewed against the grown engine']).status, 0);
    const hits = codes(validateFreshness(dir, {}), 'FRS006');
    assert.equal(hits.length, 0);
  });

  it('a line edited after the review is measured from that edit', t => {
    const dir = project(t, { surface: false });
    const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8').replace('the engine: parse, then run.', 'the engine: parse, plan, then run in parallel.');
    commit(dir, { 'AGENTS.md': text }, 'describe engine again', '2025-05-05');
    assert.equal(codes(validateFreshness(dir, {}), 'FRS006').length, 0);
  });

  it('canonical documents get no FRS006; their FRS002 carries the evidence (FR-007)', t => {
    const dir = project(t, { grow: false, surface: false });
    commit(dir, { 'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2025-03-01 -->\n# Architecture\n\n`src/engine.mjs` runs everything.\n' }, 'arch', '2025-03-01');
    commit(dir, { 'src/engine.mjs': code(140) }, 'engine grows', '2025-05-01');
    for (let i = 0; i < 11; i++) commit(dir, { 'src/other.mjs': code(25 + i, 'o') }, `code ${i}`, '2025-06-01');
    const results = validateFreshness(dir, {});
    assert.ok(!codes(results, 'FRS006').some(r => r.doc.startsWith('docs-canonical/')));
    const due = results.find(r => r.code === 'FRS002' && r.doc === 'docs-canonical/ARCHITECTURE.md');
    assert.ok(due, 'FRS002 expected');
    assert.equal(due.documentRole, 'canonical');
    assert.equal(due.staleness.references[0].path, 'src/engine.mjs');
  });
});

describe('US3 — FRS007 names surface added since the review', () => {
  it('names the new script and directory, not pre/post hooks, not surface that existed', t => {
    const hits = codes(validateFreshness(project(t), {}), 'FRS007');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /package script\(s\) `corpus` or top-level directory `corpus\/`/);
    assert.ok(!/precorpus|`test`|`src\/`/.test(hits[0].message));
  });

  it('a file that says to follow AGENTS.md inherits its mentions', t => {
    const dir = project(t);
    commit(dir, { 'AGENTS.md': readFileSync(join(dir, 'AGENTS.md'), 'utf8').replace('Run `npm test` before pushing.', 'Run `npm test` before pushing; `npm run corpus` rebuilds `corpus/`.') }, 'mention', '2025-05-03');
    const claude = `${'<!-- docguard:last-reviewed 2025-03-01 -->\n'}# Claude\n\nFollow \`AGENTS.md\`.\n\n${Array.from({ length: 8 }, (_, i) => `- local note ${i}`).join('\n')}\n`;
    commit(dir, { 'CLAUDE.md': claude }, 'claude', '2025-05-04');
    const hits = codes(validateFreshness(dir, {}), 'FRS007');
    assert.deepEqual(hits.map(h => h.doc), []);
  });

  it('a mention silences it, including one in a pointer file', t => {
    const dir = project(t);
    commit(dir, { 'CLAUDE.md': '@AGENTS.md\n\nAlso: `npm run corpus` rebuilds the `corpus/` benchmark.\n' }, 'pointer', '2025-05-03');
    assert.equal(codes(validateFreshness(dir, {}), 'FRS007').length, 0);
  });
});

describe('US4 — FRS008: agent instructions with no review record', () => {
  it('a recently committed AGENTS.md with no marker and no recorded review', t => {
    const hits = codes(validateFreshness(project(t, { marker: false, grow: false, surface: false }), {}), 'FRS008');
    assert.equal(hits.length, 1);
    // The exact command is in the text; it is not a machine-run `command`: an
    // agent must not record a review it did not do.
    assert.match(hits[0].suggestion.text, /docguard review --accept AGENTS\.md --reason "<what you checked>"/);
    assert.equal(hits[0].suggestion.command, undefined);
    assert.equal(hits[0].status, 'warn');
  });
});

describe('US5 — FRS009: a marker advanced without a recorded review', () => {
  it('fires for a marker-only commit after a recorded review, and staleness keeps the recorded point', t => {
    const dir = project(t, { grow: false, surface: false });
    assert.equal(run(dir, ['review', '--accept', 'AGENTS.md', '--reason', 'reviewed the engine and util']).status, 0);
    // The review was recorded on 2025-03-01 (the CLI stamps today's date).
    const recorded = readFileSync(join(dir, DOC_REVIEWS_PATH), 'utf8').replace(/"reviewedAt": "\d{4}-\d{2}-\d{2}"/, '"reviewedAt": "2025-03-01"');
    commit(dir, { [DOC_REVIEWS_PATH]: recorded }, 'record', '2025-03-02');
    commit(dir, { 'src/engine.mjs': code(140) }, 'engine grows', '2025-05-01');
    const bumped = readFileSync(join(dir, 'AGENTS.md'), 'utf8').replace('2025-03-01', '2025-05-02');
    commit(dir, { 'AGENTS.md': bumped }, 'bump review date', '2025-05-02');
    const results = validateFreshness(dir, {});
    assert.equal(codes(results, 'FRS009').length, 1);
    assert.equal(codes(results, 'FRS006').length, 1, 'the bump does not reset the measure');
  });

  it('a legacy marker with no recorded review is honored, no FRS009', t => {
    assert.equal(codes(validateFreshness(project(t), {}), 'FRS009').length, 0);
  });
});

describe('FR-010 — a malformed reviews file fails, and its future fields go under extensions', () => {
  it('unknown top-level field fails as FRS010; extensions are ignored', t => {
    const dir = project(t, { grow: false, surface: false });
    write(dir, DOC_REVIEWS_PATH, JSON.stringify({ schemaVersion: 1, documents: {}, extensions: { future: true } }));
    assert.equal(codes(validateFreshness(dir, {}), 'FRS010').length, 0);
    write(dir, DOC_REVIEWS_PATH, JSON.stringify({ schemaVersion: 1, documents: {}, future: true }));
    const hits = codes(validateFreshness(dir, {}), 'FRS010');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].status, 'fail');
    assert.match(hits[0].message, /belongs under "extensions"/);
    write(dir, DOC_REVIEWS_PATH, '{ nope');
    assert.equal(codes(validateFreshness(dir, {}), 'FRS010').length, 1);
  });
});

describe('FR-010 — role-scoped findingSeverity', () => {
  it('applies the level only to findings about a document in that role', t => {
    const config = { findingSeverity: { FRS006: { 'agent-instruction': 'high' } } };
    assert.equal(resolveFindingEnforcement(config, { code: 'FRS006', documentRole: 'agent-instruction' }, 'freshness').level, 'error');
    assert.equal(resolveFindingEnforcement(config, { code: 'FRS006', documentRole: 'canonical' }, 'freshness').level, 'warn');
    const dir = project(t, { grow: false, surface: false });
    write(dir, '.docguard.json', JSON.stringify({ findingSeverity: { FRS006: { nonsense: 'high' } } }));
    const r = run(dir, ['guard']);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /findingSeverity\.FRS006\.nonsense is not a document role/);
  });
});

describe('FR-011 — agents are told first', () => {
  it('guard prints the stale-instructions line and JSON carries staleInstructions', t => {
    const dir = project(t);
    const json = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    assert.deepEqual(json.staleInstructions, [{ doc: 'AGENTS.md', codes: ['FRS006', 'FRS007'] }]);
    for (const args of [['guard'], ['guard', '--quiet']]) {
      assert.match(run(dir, args).stdout, /Agents are being served stale instructions: AGENTS\.md \(FRS006, FRS007\)/);
    }
  });
});
