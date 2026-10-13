/**
 * The CI test runtime budget (specs/051-release-cut-green FR-007 revision):
 * each top-level test, divided by the run's speed factor, stays under one
 * ceiling. These tests pin the TAP reading, the speed factor and every way
 * the check fails closed.
 *
 * @req docguard.release-cut-green#FR-007
 * @req docguard.release-cut-green#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReference, evaluate, MIN_COMMON, parseTap, speedFactor } from '../tools/suite-runtime-budget.mjs';

const TOOL = fileURLToPath(new URL('../tools/suite-runtime-budget.mjs', import.meta.url));

/** A node:test TAP stream: each top-level test has one nested subtest. */
function tap(tests, durationMs = 1000) {
  const lines = ['TAP version 13'];
  tests.forEach(({ name, ms, fail }, i) => {
    lines.push(`# Subtest: ${name}`, '    # Subtest: inner', '    ok 1 - inner', '      ---', '      duration_ms: 999999', '      ...', '    1..1');
    lines.push(`${fail ? 'not ok' : 'ok'} ${i + 1} - ${name}`, '  ---', `  duration_ms: ${ms}`, "  type: 'suite'", '  ...');
  });
  lines.push(`1..${tests.length}`, `# tests ${tests.length}`, `# duration_ms ${durationMs}`);
  return `${lines.join('\n')}\n`;
}

/** 150 shared tests of 100ms-1.6s at reference speed. */
const referenceTests = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`test ${i}`, 100 + i * 10]));
const reference = { tests: referenceTests };
const runAt = (factor, extra = []) => ({
  durationMs: 300_000 * factor,
  tests: [...Object.entries(referenceTests).map(([name, ms]) => ({ name, ms: ms * factor })), ...extra],
});

describe('parseTap reads the top-level tests of node:test TAP', () => {
  it('takes each top-level duration and the suite total, not nested ones', () => {
    const run = parseTap(tap([{ name: 'a', ms: 12.5 }, { name: 'b', ms: 40, fail: true }], 4321.5));
    assert.deepEqual(run, { durationMs: 4321.5, tests: [{ name: 'a', ms: 12.5 }, { name: 'b', ms: 40 }] });
  });

  it('drops SKIP/TODO directives and unescapes # and backslashes in names', () => {
    const text = 'ok 1 - skipped one # SKIP not here\n  ---\n  duration_ms: 3\n  ...\nok 2 - issue \\#328 in C:\\\\tmp\n  ---\n  duration_ms: 4\n  ...\n# duration_ms 10\n';
    assert.deepEqual(parseTap(text).tests.map(t => t.name), ['skipped one', 'issue #328 in C:\\tmp']);
  });

  it('reports a missing total as null', () => {
    assert.equal(parseTap('ok 1 - a\n  ---\n  duration_ms: 3\n  ...\n').durationMs, null);
  });
});

describe('the speed factor is the median ratio to the reference', () => {
  it('recovers a uniform runner slowdown', () => {
    const { factor, common } = speedFactor(runAt(1.7).tests, referenceTests);
    assert.deepEqual({ factor: Number(factor.toFixed(9)), common }, { factor: 1.7, common: 150 });
  });

  it('is not moved by one runaway test', () => {
    const run = runAt(0.6);
    run.tests[0].ms += 165_000;
    assert.equal(Number(speedFactor(run.tests, referenceTests).factor.toFixed(9)), 0.6);
  });

  it('sums repeated names and ignores tests under 50ms in the reference', () => {
    const { factor, common } = speedFactor(
      [{ name: 'dup', ms: 100 }, { name: 'dup', ms: 100 }, { name: 'tiny', ms: 900 }],
      { dup: 100, tiny: 10 });
    assert.deepEqual({ factor, common }, { factor: 2, common: 1 });
  });
});

describe('evaluate applies one ceiling at reference speed and fails closed', () => {
  const ceilingMs = 100_000;

  it('passes a slow runner whose raw durations exceed the ceiling only because of the runner', () => {
    const r = evaluate(runAt(1.2, [{ name: 'big', ms: 110_000 }]), reference, { ceilingMs });
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.equal(Number(r.speedFactor.toFixed(9)), 1.2);
    assert.equal(Math.round(r.slowest[0].normalizedMs), Math.round(110_000 / 1.2));
    assert.equal(Math.round(r.normalizedDurationMs), 300_000);
  });

  it('fails a fast runner with one test 165s slower at reference speed', () => {
    const r = evaluate(runAt(0.55, [{ name: 'walks /', ms: 165_000 * 0.55 }]), reference, { ceilingMs });
    assert.equal(r.ok, false);
    assert.deepEqual(r.over.map(t => t.name), ['walks /']);
    assert.match(r.errors[0], /"walks \/" took 90750ms on this runner, 165000ms at reference speed/);
  });

  for (const [label, run, pattern] of [
    ['a missing suite total', { ...runAt(1), durationMs: null }, /Missing TAP suite duration/],
    ['no top-level durations', { durationMs: 1, tests: [] }, /No top-level test durations/],
    ['too few tests shared with the reference', { durationMs: 1, tests: runAt(1).tests.slice(0, MIN_COMMON - 1) }, /Only 99 tests are shared with the reference/],
  ]) {
    it(`fails on ${label}`, () => {
      const r = evaluate(run, reference, { ceilingMs });
      assert.equal(r.ok, false);
      assert.match(r.errors.join('\n'), pattern);
    });
  }

  it('still names a runaway when the suite total is also missing', () => {
    const r = evaluate({ ...runAt(1, [{ name: 'walks /', ms: 165_000 }]), durationMs: null }, reference, { ceilingMs });
    assert.deepEqual(r.over.map(t => t.name), ['walks /']);
    assert.equal(r.errors.length, 2);
  });

  for (const bad of [undefined, NaN, 0, -1]) {
    it(`fails without a usable ceiling (${bad})`, () => {
      assert.match(evaluate(runAt(1), reference, { ceilingMs: bad }).errors.join('\n'), /No per-test ceiling/);
    });
  }
});

describe('buildReference is in the units of the median runner among its inputs', () => {
  const at = (factor) => Object.fromEntries(Object.entries(referenceTests).map(([n, ms]) => [n, Math.round(ms * factor)]));

  it('normalizes each input by its own speed factor before taking medians', () => {
    const mixed = buildReference([runAt(0.6), runAt(1), runAt(1.2), runAt(0.7), runAt(1.1)]);
    assert.deepEqual(mixed.tests, at(1));
    assert.deepEqual(mixed.speedFactorRange, [0.6, 1.2]);
    assert.equal(mixed.inputs, 5);
  });

  it('does not blur a test that is missing from some inputs', () => {
    // Present only on the fast and slow runners: its raw median (0.9s) mixes them.
    const partial = (f) => [{ name: 'partial', ms: 1000 * f }];
    const ref = buildReference([runAt(0.6, partial(0.6)), runAt(0.6, partial(0.6)), runAt(1), runAt(1.2, partial(1.2)), runAt(1.2, partial(1.2))]);
    assert.equal(ref.tests.partial, 1000);
  });

  it('is in slow-runner units when every input is slow, so a refresh must span the fleet', () => {
    assert.deepEqual(buildReference([runAt(1.2), runAt(1.2), runAt(1.2)]).tests, at(1.2));
  });

  it('drops tests under 50ms and names missing from more than 20% of inputs', () => {
    const extra = (name, ms) => [{ name, ms }];
    const ref = buildReference([runAt(1, extra('rare', 500)), runAt(1, extra('tiny', 5)), runAt(1, extra('tiny', 5)), runAt(1, extra('tiny', 5)), runAt(1, extra('tiny', 5))]);
    assert.equal('rare' in ref.tests, false);
    assert.equal('tiny' in ref.tests, false);
    assert.equal(Object.keys(ref.tests).length, 150);
  });
});

describe('the check command', () => {
  const inTemp = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-suite-budget-'));
    try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const check = (dir, tests, extraArgs = []) => {
    writeFileSync(join(dir, 'ref.json'), JSON.stringify(reference));
    writeFileSync(join(dir, 'out.tap'), tap(tests, 250_000));
    return spawnSync(process.execPath, [TOOL, 'check', '--tap', join(dir, 'out.tap'), '--reference', join(dir, 'ref.json'), '--ceiling-ms', '100000', ...extraArgs], { encoding: 'utf8' });
  };

  it('exits 0, logs the speed factor and writes the job summary', () => inTemp(dir => {
    const summary = join(dir, 'summary.md');
    const result = check(dir, runAt(0.8).tests, ['--summary', summary]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /speed factor 0\.800 over 150 shared tests; 312500ms at reference speed/);
    assert.match(readFileSync(summary, 'utf8'), /### Test runtime budget: PASS[\s\S]*\| test 149 \| 1\.3 \| 1\.6 \|/);
  }));

  it('exits 1 with a GitHub error annotation for a runaway', () => inTemp(dir => {
    const result = check(dir, runAt(1, [{ name: 'runaway', ms: 165_000 }]).tests);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::"runaway" took 165000ms/);
  }));

  it('escapes workflow-command data in the error annotation', () => inTemp(dir => {
    const result = check(dir, runAt(1, [{ name: '100% of /', ms: 165_000 }]).tests);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::"100%25 of \/" took/);
  }));

  it('treats an empty --summary as no summary', () => inTemp(dir => {
    assert.equal(check(dir, runAt(1).tests, ['--summary', '']).status, 0);
  }));
});
