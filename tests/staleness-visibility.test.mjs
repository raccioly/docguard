/**
 * Staleness visibility (specs/096-staleness-visibility).
 *
 * @req docguard.staleness-visibility#FR-001
 * @req docguard.staleness-visibility#FR-002
 * @req docguard.staleness-visibility#FR-003
 * @req docguard.staleness-visibility#FR-004
 * @req docguard.staleness-visibility#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureGit } from './helpers/git.mjs';
import { CONFIGURE_HINTS } from '../cli/validator-coverage.mjs';
import { rankFrs002, FRS002_SHOWN } from '../cli/commands/guard.mjs';
import { buildTaskContextPacket } from '../cli/scanners/task-context.mjs';

const CLI = resolve('cli/docguard.mjs');
const code = (n, tag = 'v') => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join('\n') + '\n';
const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-vis-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  const commit = (files, msg, date) => {
    for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` } });
  };
  const marker = '<!-- docguard:last-reviewed 2025-03-01 -->\n';
  const docs = {};
  for (const n of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT']) docs[`docs-canonical/${n}.md`] = `${marker}# ${n}\n\nStub.\n`;
  commit({
    ...docs,
    'AGENTS.md': `${marker}# Agents\n\n## Key files\n\n- \`src/engine.mjs\` — the engine: parse, then run.\n\n## Other\n\n- \`src/util.mjs\` — helpers.\n`,
    'src/engine.mjs': code(40), 'src/util.mjs': code(40, 'u'),
    '.docguard.json': JSON.stringify({ projectName: 'vis', profile: 'starter', validators: { freshness: true } }),
  }, 'initial', '2025-03-01');
  commit({ 'src/engine.mjs': code(140) }, 'engine grows', '2025-05-01');
  for (let i = 0; i < 11; i++) commit({ 'src/other.mjs': code(25 + i, 'o') }, `code ${i}`, '2025-06-01');
  return dir;
}

describe('FR-001 — empty validators say what it takes', () => {
  it('every registered validator has a hint entry (null when it always applies)', () => {
    const guard = readFileSync(resolve('cli/commands/guard.mjs'), 'utf8');
    const keys = new Set([...guard.matchAll(/key: '([a-zA-Z]+)'/g)].map(m => m[1]));
    const missing = [...keys].filter(k => !Object.prototype.hasOwnProperty.call(CONFIGURE_HINTS, k));
    assert.deepEqual(missing, []);
  });

  it('guard prints the hint under an empty validator and lists it in JSON', t => {
    const dir = project(t);
    assert.match(run(dir, ['guard']).stdout, /Doc-Dependency .*no-matches.*\n\s+↳ to check it: Add covers="path#symbol"/);
    const json = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    const dd = json.emptyValidators.find(v => v.key === 'docDependency');
    assert.equal(dd.status, 'no-matches');
    assert.match(dd.howToConfigure, /covers=/);
  });
});

describe('FR-002 — Canonical-Sync says why it does not apply', () => {
  it('is not-applicable with its reason outside DocGuard', t => {
    const dir = project(t);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'not-docguard' }));
    const json = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    const cs = json.validators.find(v => v.key === 'canonicalSync');
    assert.equal(cs.applicability.status, 'not-applicable');
    assert.match(cs.applicability.reason, /only runs in the docguard-cli repo/);
    assert.equal(cs.verdict, 'skipped');
  });
});

describe('FR-003 — FRS002 ranked and capped', () => {
  it('ranks evidence first, then commit count', () => {
    const items = [
      { code: 'FRS002', location: 'a.md', message: 'a.md — review due: 90 code commits since' },
      { code: 'FRS002', location: 'b.md', message: 'b.md — review due: 20 code commits since', staleness: { references: [{ share: 0.7 }] } },
      { code: 'FRS002', location: 'c.md', message: 'c.md — review due: 40 code commits since' },
    ];
    assert.deepEqual(rankFrs002(items).map(i => i.location), ['b.md', 'a.md', 'c.md']);
  });

  it('shows FRS002_SHOWN lines and a summary; --verbose and JSON keep all', t => {
    const dir = project(t);
    const text = run(dir, ['guard']).stdout;
    const shown = (text.match(/\[FRS002\] (?!and )\S+ — review due/g) || []).length;
    assert.equal(shown, FRS002_SHOWN);
    assert.match(text, /\[FRS002\] and 3 more document\(s\) due for review by the repository-wide count \(--verbose lists them\)/);
    assert.equal((run(dir, ['guard', '--verbose']).stdout.match(/\[FRS002\] (?!and )\S+ — review due/g) || []).length, 6);
    const json = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    assert.equal(json.findings.filter(f => f.code === 'FRS002').length, 6);
  });
});

describe('FR-004 — agent context names stale references', () => {
  it('an excerpt naming a stale file carries staleness; one that does not, does not', t => {
    const dir = project(t);
    const packet = buildTaskContextPacket(dir, {}, 'change how the engine parses and runs key files');
    const key = packet.excerpts.find(e => e.path === 'AGENTS.md' && e.startLine <= 7 && e.endLine >= 7);
    assert.ok(key, JSON.stringify(packet.excerpts.map(e => [e.path, e.startLine, e.endLine])));
    assert.equal(key.staleness.references[0].path, 'src/engine.mjs');
    assert.equal(key.staleness.reviewPoint.date, '2025-03-01');
    for (const e of packet.excerpts.filter(x => !(x.startLine <= 7 && x.endLine >= 7 && x.path === 'AGENTS.md'))) assert.equal(e.staleness, undefined);
    assert.match(run(dir, ['agent', '--task', 'change how the engine parses and runs key files']).stdout, /⚠ possibly stale: names src\/engine\.mjs 71%/);
  });
});
