/**
 * The "possibly stale" mark on sections handed to an agent (specs/097-strict-
 * by-default T028b, from spec 096): `docguard agent --task`, MCP
 * `docguard_task_context` and `docguard_read_section`. A section from a
 * document whose review no longer covers it, or that a current guard run found
 * due for review, says so; `stalenessBasis` says what was looked at, so an
 * unmarked section is not read as fresh. Nothing here runs guard.
 *
 * @req docguard.strict-by-default#FR-021
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { readSection } from '../cli/scanners/doc-references.mjs';
import { buildTaskContextPacket } from '../cli/scanners/task-context.mjs';
import { treeKey, SENSOR_CACHE } from '../cli/sensor-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const code = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
const CONFIG = { projectName: 'stale-excerpt', version: '0.6', requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'] } };

/** AGENTS.md reviewed on 2026-01-01 describes src/engine.mjs, which then grew to five times its size. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-stale-excerpt-'));
  temporary.push(dir);
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  const commit = (files, msg, date) => {
    for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` } });
  };
  commit({
    '.docguard.json': JSON.stringify(CONFIG, null, 2),
    'src/engine.mjs': code(40),
    'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Architecture\n\n## Engine\n\nThe engine parses the input and runs the plan.\n',
    'AGENTS.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Agents\n\n## Engine\n\n- `src/engine.mjs` parses the input, then runs the plan.\n- Run `npm test` before committing.\n',
  }, 'init', '2026-01-01');
  commit({ 'src/engine.mjs': code(120) }, 'engine grows', '2026-02-01');
  commit({ 'src/engine.mjs': code(220) }, 'engine grows again', '2026-03-01');
  return dir;
}

/** A sensor cache for this exact tree state that lists FRS002 on the architecture document. */
function cacheReviewDue(dir) {
  mkdirSync(join(dir, '.docguard'), { recursive: true });
  writeFileSync(join(dir, SENSOR_CACHE), JSON.stringify({ key: treeKey(dir), stage: null, result: {}, fileCodes: { 'docs-canonical/ARCHITECTURE.md': ['FRS002'] } }) + '\n');
}

describe('T028b: read_section marks a possibly stale section', () => {
  it('a section of an agent-instruction file whose review no longer covers it is suspect-review, with the review date', () => {
    const dir = project();
    const r = readSection(dir, CONFIG, { doc: 'AGENTS.md', anchor: 'engine' });
    assert.deepEqual(r.possiblyStale, { signals: ['suspect-review'], since: '2026-01-01' });
    assert.equal(r.stalenessBasis, 'review-only', 'no guard run on this tree: only the direct review check ran');
  });

  it('a section a current guard run found due for review is review-due, on the sensor-cache basis', () => {
    const dir = project();
    cacheReviewDue(dir);
    const r = readSection(dir, CONFIG, { doc: 'docs-canonical/ARCHITECTURE.md', anchor: 'engine' });
    assert.deepEqual(r.possiblyStale, { signals: ['review-due'] });
    assert.equal(r.stalenessBasis, 'sensor-cache');
  });

  it('an unmarked section still says what was looked at', () => {
    const dir = project();
    const r = readSection(dir, CONFIG, { doc: 'docs-canonical/ARCHITECTURE.md', anchor: 'engine' });
    assert.equal(r.possiblyStale, undefined);
    assert.equal(r.stalenessBasis, 'review-only');
  });
});

describe('T028b: task context marks a possibly stale excerpt', () => {
  it('the excerpt from AGENTS.md carries the mark, and the packet carries its basis', () => {
    const dir = project();
    const packet = buildTaskContextPacket(dir, CONFIG, 'change how the engine parses the input and runs the plan');
    const agents = packet.excerpts.find(e => e.path === 'AGENTS.md');
    assert.ok(agents, JSON.stringify(packet.excerpts.map(e => e.path)));
    assert.deepEqual(agents.possiblyStale, { signals: ['suspect-review'], since: '2026-01-01' });
    assert.equal(packet.stalenessBasis, 'review-only');
  });

  it('the mark does not change the core digest', () => {
    const dir = project();
    const task = 'change how the engine parses the input and runs the plan';
    const before = buildTaskContextPacket(dir, CONFIG, task).coreDigest;
    cacheReviewDue(dir);
    assert.equal(buildTaskContextPacket(dir, CONFIG, task).coreDigest, before);
  });

  it('agent --task prints the mark under the excerpt', () => {
    const dir = project();
    const r = spawnSync(process.execPath, [CLI, 'agent', '--dir', dir, '--task', 'change how the engine parses the input and runs the plan'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /possibly stale: its 2026-01-01 review no longer covers the files it names/);
  });
});
