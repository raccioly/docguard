/**
 * Score history + `score --trend` (v0.33).
 *
 * @req SC-HIS-001 — appendHistory/loadHistory roundtrip via .docguard/history.jsonl
 * @req SC-HIS-002 — malformed lines are skipped, never thrown
 * @req SC-HIS-003 — loadHistory returns [] when no history exists
 * @req SC-HIS-004 — `docguard ci` appends one entry per run
 * @req SC-HIS-005 — `docguard ci --no-history` opts out
 * @req SC-HIS-006 — `score --trend` renders a friendly hint when empty, history when present
 * @req SC-HIS-007 — `score --trend --format json` is pure parseable JSON
 * @req SC-HIS-008 — ci --format json survives a pipe (stdout.write, not console.log+exit)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { appendHistory, loadHistory, sparkline } from '../cli/writers/history.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-history-'));
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'history-fixture', profile: 'standard',
  }));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
  return dir;
}

function spawnCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('history writer', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('roundtrips entries oldest → newest', () => {
    dir = makeFixture();
    appendHistory(dir, { timestamp: 't1', score: 50, grade: 'C', status: 'WARN' });
    appendHistory(dir, { timestamp: 't2', score: 80, grade: 'A', status: 'PASS' });
    const rows = loadHistory(dir);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].score, 50);
    assert.equal(rows[1].score, 80);
  });

  it('skips malformed lines and entries without a numeric score', () => {
    dir = makeFixture();
    mkdirSync(join(dir, '.docguard'), { recursive: true });
    writeFileSync(join(dir, '.docguard', 'history.jsonl'),
      '{"score":42,"grade":"C"}\nnot-json{{{\n{"noScore":true}\n{"score":90,"grade":"A"}\n');
    const rows = loadHistory(dir);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].score, 42);
    assert.equal(rows[1].score, 90);
  });

  it('returns [] with no history file', () => {
    dir = makeFixture();
    assert.deepEqual(loadHistory(dir), []);
  });

  it('sparkline maps 0..100 to ▁..█', () => {
    const line = sparkline([0, 50, 100]);
    assert.equal(line.length, 3);
    assert.equal(line[0], '▁');
    assert.equal(line[2], '█');
  });
});

describe('docguard ci — history recording', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('appends one entry per run', () => {
    dir = makeFixture();
    spawnCli(['ci'], dir);
    spawnCli(['ci'], dir);
    const rows = loadHistory(dir);
    assert.equal(rows.length, 2);
    assert.equal(typeof rows[0].score, 'number');
    assert.ok(rows[0].grade);
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(rows[0].status));
  });

  it('--no-history opts out', () => {
    dir = makeFixture();
    spawnCli(['ci', '--no-history'], dir);
    assert.ok(!existsSync(join(dir, '.docguard', 'history.jsonl')),
      '--no-history must not create the history file');
  });

  it('H1 regression: bare `docguard ci` (text mode) never scaffolds into the workspace', () => {
    dir = makeFixture();
    spawnCli(['ci', '--no-history'], dir);
    assert.ok(!existsSync(join(dir, '.agent')), 'ci must not run ensureSkills (.agent scaffold)');
    assert.ok(!existsSync(join(dir, '.specify')), 'ci must not trigger the Spec Kit scaffold');
  });

  it('L3 regression: a threshold failure is recorded as FAIL, not PASS', () => {
    dir = makeFixture();
    const res = spawnCli(['ci', '--threshold', '101', '--format', 'json', '--no-history'], dir);
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.status, 'FAIL', 'status must reflect the threshold gate');
    assert.equal(parsed.thresholdMet, false);
  });

  it('--format json is pure parseable JSON through a pipe and keeps exit codes', () => {
    dir = makeFixture();
    const res = spawnCli(['ci', '--format', 'json'], dir);
    const parsed = JSON.parse(res.stdout); // throws if banner bytes leaked
    assert.equal(parsed.project, 'history-fixture');
    // bare fixture ⇒ missing required docs ⇒ guard errors ⇒ exit 1. (Before
    // v0.33 the deprecated init-routing scaffolded the missing docs first —
    // a CI gate mutating the workspace — and exited 2. Direct dispatch
    // validates what's actually there.)
    assert.equal(res.status, 1);
    assert.equal(parsed.status, 'FAIL');
  });
});

describe('docguard score --trend', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('shows a hint when no history exists (exit 0)', () => {
    dir = makeFixture();
    const res = spawnCli(['score', '--trend'], dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /No history yet/);
    assert.match(res.stdout, /docguard ci/);
  });

  it('renders sparkline + recent runs once history exists', () => {
    dir = makeFixture();
    spawnCli(['ci'], dir);
    spawnCli(['ci'], dir);
    const res = spawnCli(['score', '--trend'], dir);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /over 2 run\(s\)/);
    assert.match(res.stdout, /\/100/);
  });

  it('--format json returns {entries, latest, delta} as pure JSON', () => {
    dir = makeFixture();
    spawnCli(['ci'], dir);
    const res = spawnCli(['score', '--trend', '--format', 'json'], dir);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.latest.score, parsed.entries[0].score);
    assert.equal(parsed.delta, 0);
  });
});
