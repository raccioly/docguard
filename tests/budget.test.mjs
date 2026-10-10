/**
 * Non-regression budgets (specs/031-non-regression-budgets): a change is
 * compared with its base on the same machine, and a cost it adds is either
 * inside a budget or declared.
 *
 * @req docguard.non-regression-budgets#FR-001
 * @req docguard.non-regression-budgets#FR-002
 * @req docguard.non-regression-budgets#FR-003
 * @req docguard.non-regression-budgets#FR-004
 * @req docguard.non-regression-budgets#FR-006
 * @req docguard.non-regression-budgets#SC-001
 * @req docguard.non-regression-budgets#FR-005
 * @req docguard.non-regression-budgets#FR-007
 * @req docguard.non-regression-budgets#SC-002
 * @req docguard.non-regression-budgets#SC-003
 *
 * Every guard-time verdict here comes from a scripted timing source
 * (specs/062-budget-deterministic); the one test on real processes asserts
 * only bounds that machine load cannot break.
 *
 * @req docguard.budget-deterministic#FR-001
 * @req docguard.budget-deterministic#FR-002
 * @req docguard.budget-deterministic#FR-003
 * @req docguard.budget-deterministic#FR-004
 * @req docguard.budget-deterministic#FR-005
 * @req docguard.budget-deterministic#SC-001
 * @req docguard.budget-deterministic#SC-002
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { compare, guardPair, loadBudgets, measurePair, median, parseExemptions, renderTable } from '../tools/budget.mjs';

const budgets = loadBudgets();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const report = (over = {}) => ({
  guard: { '.': 1000 },
  findings: { errors: 0, byCode: { 'DLC002:warn': 3 } },
  agentBytes: { 'memory-pack': 6000, 'mcp:docguard_guard': 100000 },
  package: { size: 850000, unpackedSize: 2700000, files: 230 },
  dependencies: ['@babel/parser'],
  ...over,
});
const verdict = (result, metric) => result.rows.find(r => r.metric === metric)?.verdict;

describe('compare applies each budget (FR-002)', () => {
  it('passes an unchanged head', () => {
    assert.equal(compare(report(), report(), budgets).status, 'PASS');
  });

  it('fails guard time past ×1.15, and ignores a difference under the 150 ms floor', () => {
    assert.equal(verdict(compare(report(), report({ guard: { '.': 1300 } }), budgets), 'guard-ms:.'), 'FAIL');
    assert.equal(verdict(compare(report({ guard: { '.': 200 } }), report({ guard: { '.': 340 } }), budgets), 'guard-ms:.'), 'PASS', '+140 ms is under the floor even at ×1.7');
  });

  it('fails a new error-severity self-finding, and reports warning changes for review only', () => {
    const r = compare(report(), report({ findings: { errors: 1, byCode: { 'DLC002:warn': 1, 'SEC001:error': 1 } } }), budgets);
    assert.equal(verdict(r, 'self-errors'), 'FAIL');
    assert.equal(verdict(r, 'findings:DLC002:warn'), 'INFO');
  });

  it('fails agent-facing bytes past +10%, reports a new output as NEW and a removed one as GONE', () => {
    const r = compare(report(), report({ agentBytes: { 'memory-pack': 7000, 'mcp:docguard_docs_for_path': 900 } }), budgets);
    assert.equal(verdict(r, 'bytes:memory-pack'), 'FAIL');
    assert.equal(verdict(r, 'bytes:mcp:docguard_docs_for_path'), 'NEW');
    assert.equal(verdict(r, 'bytes:mcp:docguard_guard'), 'GONE');
  });

  it('fails a new runtime dependency and package growth past budget', () => {
    const r = compare(report(), report({ dependencies: ['@babel/parser', 'left-pad'], package: { size: 1000000, unpackedSize: 2700000, files: 230 } }), budgets);
    assert.equal(verdict(r, 'dependencies'), 'FAIL');
    assert.match(r.rows.find(x => x.metric === 'dependencies').note, /left-pad/);
    assert.equal(verdict(r, 'package:size'), 'FAIL');
  });

  it('is inconclusive, never passing, when the base could not be measured', () => {
    const r = compare(report({ guard: { '.': null } }), report(), budgets);
    assert.equal(verdict(r, 'guard-ms:.'), 'INCONCLUSIVE');
    assert.equal(r.status, 'INCONCLUSIVE');
    assert.equal(compare(report({ findings: null }), report(), budgets).status, 'INCONCLUSIVE');
  });
});

describe('Budget-Exempt waives exactly the named metric (FR-003)', () => {
  it('parses metric and reason, and requires a reason', () => {
    const ex = parseExemptions('Body\n\nBudget-Exempt: bytes:memory-pack — the pack gains a symbol section by design\nBudget-Exempt: guard-ms:. — x\n');
    assert.deepEqual([...ex.keys()], ['bytes:memory-pack']);
  });

  it('turns that metric FAIL into EXEMPT and leaves the others failing', () => {
    const ex = parseExemptions('Budget-Exempt: bytes:memory-pack — the pack gains a symbol section by design');
    const r = compare(report(), report({ agentBytes: { 'memory-pack': 7000, 'mcp:docguard_guard': 200000 } }), budgets, ex);
    assert.equal(verdict(r, 'bytes:memory-pack'), 'EXEMPT');
    assert.equal(verdict(r, 'bytes:mcp:docguard_guard'), 'FAIL');
    assert.equal(r.status, 'FAIL');
    assert.match(renderTable(r), /\| `bytes:memory-pack` \| 6000 \| 7000 \| \+1000 \|.*EXEMPT — the pack gains/);
  });
});

/** A stand-in tree whose CLI busy-waits `ms` for guard and answers the rest minimally. */
function stubTree(ms) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-budget-stub-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'cli'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stub', version: '0.0.0', dependencies: {} }));
  writeFileSync(join(dir, 'cli/docguard.mjs'), `
const [cmd] = process.argv.slice(2);
if (cmd === 'guard') {
  const end = Date.now() + ${ms}; while (Date.now() < end) {}
  console.log(JSON.stringify({ findings: [] }));
}
else if (cmd === 'memory') console.log('# pack');
`);
  return dir;
}

/**
 * A scripted timing source for guardPair: `ms(tree, slot)` is the wall time of
 * the guard sample taken in `slot` (0, 1, 2, … in call order). `calls` records
 * which tree each slot measured.
 */
function scripted(ms) {
  const calls = [];
  const sample = (tree, targets) => {
    const slot = calls.length;
    calls.push(tree);
    return Object.fromEntries(targets.map(t => [t, ms(tree, slot)]));
  };
  return { sample, calls };
}

/** Deterministic PRNG (mulberry32), so each "noisy" run is reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shared-runner noise for one comparison: every sample is 1000 ms plus up to
 * 50 ms of jitter, and two of the head's five samples (picked by the seed) are
 * hit by a load burst of up to 5 s. Bursts land on the head only, the worst
 * case for a base-vs-base comparison. `slowdown` scales the head's samples.
 */
function noisy(seed, { head, slowdown = 1 }) {
  const next = rng(seed);
  const burst = new Set();
  while (burst.size < 2) burst.add(Math.floor(next() * 5));
  let headSeen = 0;
  return scripted(tree => {
    const ms = 1000 + next() * 50;
    if (tree !== head) return ms;
    const hit = burst.has(headSeen++);
    return ms * slowdown + (hit ? 1000 + next() * 4000 : 0);
  });
}

describe('base-vs-head on one machine catches a slowdown without flaking (FR-001, FR-004, SC-001)', () => {
  const small = { ...budgets, samples: 5, guardTargets: ['.'], agentTasks: {}, mcpCalls: [] };
  const BASE = resolve(tmpdir(), 'docguard-budget-base');
  const HEAD = resolve(tmpdir(), 'docguard-budget-head');
  const guardVerdict = (pair) => verdict(compare(report({ guard: pair.base }), report({ guard: pair.head }), small), 'guard-ms:.');

  it('ten noisy base-vs-base comparisons never fail: medians absorb a burst on two of five samples', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { sample } = noisy(seed, { head: HEAD });
      const pair = guardPair(BASE, HEAD, [HEAD], { samples: 5, sample });
      assert.equal(guardVerdict(pair), 'PASS', `seed ${seed}: base ${pair.base['.']} head ${pair.head['.']}`);
    }
  });

  it('an injected 30% slowdown fails under the same noise', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { sample } = noisy(seed, { head: HEAD, slowdown: 1.3 });
      const pair = guardPair(BASE, HEAD, [HEAD], { samples: 5, sample });
      assert.equal(guardVerdict(pair), 'FAIL', `seed ${seed}: base ${pair.base['.']} head ${pair.head['.']}`);
    }
  });

  it('a single sample has no outlier protection: one burst fails a base-vs-base comparison', () => {
    // What made the old real-timing version of this test flaky: samples: 1.
    const { sample } = scripted(tree => (tree === HEAD ? 1400 : 1000));
    assert.equal(guardVerdict(guardPair(BASE, HEAD, [HEAD], { samples: 1, sample })), 'FAIL');
  });

  it('interleaves: the tree that runs first alternates between samples', () => {
    const { sample, calls } = scripted(() => 100);
    guardPair(BASE, HEAD, [HEAD], { samples: 4, sample });
    assert.deepEqual(calls.map(t => (t === BASE ? 'base' : 'head')), ['base', 'head', 'head', 'base', 'base', 'head', 'head', 'base']);
  });

  it('interleaving holds a steady load drift to one sample slot', () => {
    // Every sample is 100 ms slower than the one before. Base takes slots
    // 0,3,4,7,8 and head 1,2,5,6,9, so the medians are one slot apart. Base
    // then head in sequence would put them five slots (500 ms) apart.
    const { sample } = scripted((tree, slot) => 1000 + 100 * slot);
    const pair = guardPair(BASE, HEAD, [HEAD], { samples: 5, sample });
    assert.deepEqual([pair.base['.'], pair.head['.']], [1400, 1500]);
    assert.equal(guardVerdict(pair), 'PASS');
  });

  it('measurePair times each tree with its own CLI on the wall clock (real processes)', () => {
    // Smoke test of the real timing source. It asserts only what load cannot
    // break: a stub that busy-waits N ms is never measured under N ms.
    const pair = measurePair(stubTree(100), stubTree(400), { ...small, samples: 3 });
    assert.ok(pair.base.guard['.'] >= 99, `base ${pair.base.guard['.']}`);
    assert.ok(pair.head.guard['.'] >= 399, `head ${pair.head.guard['.']}`);
    assert.deepEqual(pair.head.findings, { errors: 0, byCode: {} });
    assert.ok(['PASS', 'FAIL'].includes(verdict(compare(pair.base, pair.head, small), 'guard-ms:.')));
  });
});

describe('the repository wiring (FR-004, FR-006, FR-007)', () => {
  it('median is the middle of interleaved samples', () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([null]), null);
  });

  it('CI runs the budget job on pull requests, and npm run budget reproduces it', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  budget:'));
    assert.ok(ci.includes('\n  budget:'), 'ci.yml has a budget job');
    assert.match(job, /tools\/budget\.mjs ab --base/);
    assert.match(job, /GITHUB_STEP_SUMMARY/);
    assert.match(JSON.parse(readFileSync('package.json', 'utf8')).scripts.budget, /tools\/budget\.mjs/);
    assert.match(readFileSync('AGENTS.md', 'utf8'), /Budget-Exempt/);
  });

  it('the CI recipe states which noise the guard-time verdict absorbs (spec 062 FR-005)', () => {
    const recipes = readFileSync('docs-canonical/CI-RECIPES.md', 'utf8');
    const recipe = recipes.slice(recipes.indexOf('## Recipe 3e'), recipes.indexOf('## Recipe 4 '));
    assert.match(recipe, /\(N − 1\) \/ 2 slowed samples/);
    assert.match(recipe, /one sample apart/);
    assert.match(recipe, /`--samples 1`/);
    assert.match(recipe, new RegExp(`${budgets.samples} in \`budgets\.json\``));
    assert.match(recipe, new RegExp(`floor\\s+\\(${budgets.guard.floorMs} ms\\)`));
  });

  it('runs beside the tests with a time ceiling, keeps the precision gate, and summarizes every PR (FR-005, SC-002, SC-003)', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  budget:'), ci.indexOf('\n  # ── npm publish dry-run'));
    assert.doesNotMatch(job, /needs:/, 'the budget job must not wait for the test matrix');
    const timeout = Number(job.match(/timeout-minutes: (\d+)/)?.[1]);
    assert.ok(timeout > 0 && timeout <= 6, `timeout-minutes ${timeout}`);
    assert.match(job, /--summary "\$GITHUB_STEP_SUMMARY"/);
    assert.match(ci, /benchmarks\/run\.mjs --baseline benchmarks\/baseline\.json/, 'the precision benchmark gate stays');
  });
});
