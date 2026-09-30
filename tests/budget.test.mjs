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
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { compare, loadBudgets, measurePair, median, parseExemptions, renderTable } from '../tools/budget.mjs';

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
function stubTree(ms, { tag = null, log = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-budget-stub-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'cli'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'stub', version: '0.0.0', dependencies: {} }));
  writeFileSync(join(dir, 'cli/docguard.mjs'), `
import { appendFileSync } from 'node:fs';
const [cmd] = process.argv.slice(2);
if (cmd === 'guard') {
  ${log ? `appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${tag}\n`)});` : ''}
  const end = Date.now() + ${ms}; while (Date.now() < end) {}
  console.log(JSON.stringify({ findings: [] }));
}
else if (cmd === 'memory') console.log('# pack');
`);
  return dir;
}

describe('base-vs-head on one machine catches a slowdown without flaking (FR-001, FR-004, SC-001)', () => {
  const small = { ...budgets, samples: 3, guardTargets: ['.'], agentTasks: {}, mcpCalls: [] };

  it('an injected 3× slowdown fails', () => {
    const pair = measurePair(stubTree(100), stubTree(400), small);
    assert.ok(pair.head.guard['.'] > pair.base.guard['.']);
    assert.equal(verdict(compare(pair.base, pair.head, small), 'guard-ms:.'), 'FAIL');
  });

  it('interleaves: the tree that runs first alternates between samples', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'docguard-budget-log-')), 'order.log');
    dirs.push(dirname(log));
    // The self-findings measure calls guard once more per tree; keep only the
    // timed samples, which come first.
    measurePair(stubTree(1, { tag: 'base', log }), stubTree(1, { tag: 'head', log }), { ...small, samples: 4 });
    const order = readFileSync(log, 'utf8').trim().split('\n').slice(0, 8);
    assert.deepEqual(order, ['base', 'head', 'head', 'base', 'base', 'head', 'head', 'base']);
  });

  it('ten base-vs-base comparisons never fail', () => {
    const tree = stubTree(60);
    for (let i = 0; i < 10; i++) {
      const pair = measurePair(tree, tree, { ...small, samples: 1 });
      assert.equal(verdict(compare(pair.base, pair.head, small), 'guard-ms:.'), 'PASS', `run ${i}`);
    }
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
