/**
 * History-replay benchmark (specs/095-recorded-document-reviews FR-012).
 *
 * @req docguard.recorded-document-reviews#FR-012
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureGit } from './helpers/git.mjs';
import { replayRepository, summarize } from '../benchmarks/history-replay/run.mjs';

const code = (n, tag = 'v') => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join('\n') + '\n';

function history(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-replay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  const commit = (files, msg, date) => {
    for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` } });
  };
  const doc = engine => `<!-- docguard:last-reviewed 2025-01-01 -->\n# Agents\n\n- \`src/engine.mjs\` — ${engine}\n- \`src/util.mjs\` — helpers.\n`;
  commit({ 'AGENTS.md': doc('parse, then run.'), 'src/engine.mjs': code(40), 'src/util.mjs': code(40, 'u') }, 'review', '2025-01-01');
  commit({ 'src/engine.mjs': code(140) }, 'engine grows', '2025-01-05');
  commit({ 'src/util.mjs': code(140, 'u') }, 'util grows', '2025-01-06');
  // The project later rewrites what it says about the engine, never about util.
  commit({ 'AGENTS.md': doc('parse, plan, then run in parallel.') }, 'describe engine', '2025-02-10');
  commit({ 'README.md': '# later\n' }, 'later', '2025-06-01');
  return dir;
}

describe('history replay', () => {
  it('labels a hit true when the document later rewrote the line naming the file, false when it did not', t => {
    const { hits, reviewPoints } = replayRepository(history(t), { name: 'fixture' });
    assert.equal(reviewPoints, 1);
    const at14 = hits.filter(h => h.code === 'FRS006' && h.horizonDays === 14);
    const byFile = Object.fromEntries(at14.map(h => [h.subject, h.label]));
    assert.deepEqual(byFile, { 'src/engine.mjs': true, 'src/util.mjs': false });
  });

  it('summarizes precision with a Wilson interval per role, horizon and threshold', t => {
    const { hits } = replayRepository(history(t), { name: 'fixture' });
    const row = summarize(hits).find(r => r.code === 'FRS006' && r.role === 'agent-instruction' && r.horizonDays === 14 && r.threshold === 0.5);
    assert.equal(row.n, 2);
    assert.equal(row.tp, 1);
    assert.equal(row.precision, 0.5);
    assert.ok(row.confidence95.lower < 0.5 && row.confidence95.upper > 0.5);
  });

  it('a human label overrides the proxy', t => {
    const dir = history(t);
    const first = replayRepository(dir, { name: 'fixture' }).hits.find(h => h.subject === 'src/util.mjs' && h.horizonDays === 14);
    const again = replayRepository(dir, { name: 'fixture', labels: { [first.key]: true } }).hits.find(h => h.key === first.key);
    assert.equal(again.label, true);
    assert.equal(again.labelSource, 'human');
  });
});
