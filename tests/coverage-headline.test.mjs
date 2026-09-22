/**
 * The headline must not read non-coverage as success.
 *
 * `passed/total` counts CHECKS, and its denominator excludes every validator
 * that could not run. A repository could therefore print "628/628 passed" and
 * a brightgreen badge while the same run reported one validator partial, one
 * missing its prerequisite document, and seven with nothing to check. The
 * caveats were printed — but the badge is the artifact that travels into a
 * README without them.
 *
 * The cap is `green`, deliberately, not `yellow`. A partial run is not a
 * failing run: everything that ran, passed. `yellow` would be wrong, and would
 * train readers to ignore the badge on any project that legitimately has no
 * API reference. `green` says: passed, with a caveat.
 *
 * `no-matches` does NOT cap the colour. A validator that ran and found nothing
 * applicable did its job completely; only `partial`, `missing-prerequisite`,
 * `unsupported` and `error` mean DocGuard could not check what it was asked to.
 *
 * @implements docguard.calibrated-finding-channels#FR-020
 * @req docguard.calibrated-finding-channels#FR-020
 * @req FR-020 — the badge withholds its top grade from an incomplete run
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { badgeColor, incompleteCoverage, INCOMPLETE_COVERAGE_STATES } from '../cli/commands/guard.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-coverage-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

function guard(dir) {
  const run = spawnSync(process.execPath, [CLI, 'guard'], { cwd: dir, encoding: 'utf8' });
  return run.stdout;
}

const BASE = {
  'package.json': JSON.stringify({ name: 'cov', version: '1.0.0' }),
  '.docguard.json': JSON.stringify({ projectName: 'cov', profile: 'starter' }),
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nA single module.\n',
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
};

describe('headline coverage (FR-020)', () => {
  // @req docs-canonical/REQUIREMENTS.md#FR-020 — the badge withholds its top grade from a run that could not check everything
  let dirs = [];
  const make = (files) => { const d = project(files); dirs.push(d); return d; };
  test.afterEach?.(() => {});

  test('the coverage line leads with how many validators actually checked', () => {
    const out = guard(make(BASE));
    assert.match(out, /Check coverage: \d+ of \d+ validator\(s\) checked/,
      'the checked/active ratio must appear beside the check counts');
  });

  test('the checked count is never reported twice in one line', () => {
    const line = guard(make(BASE)).split('\n').find(l => l.includes('Check coverage:'));
    assert.ok(line, 'coverage line must be present');
    assert.equal((line.match(/checked/g) || []).length, 1, `redundant wording: ${line}`);
  });

  test('a perfect run with complete coverage still earns brightgreen', () => {
    assert.equal(badgeColor(100, 0), 'brightgreen');
    assert.equal(badgeColor(90, 0), 'brightgreen');
  });

  test('a perfect run with incomplete coverage is capped at green, not yellow', () => {
    // Capped, because the badge would otherwise claim everything is fine.
    // Green rather than yellow, because everything that ran did pass — yellow
    // would read as a failure and train readers to ignore the badge.
    assert.equal(badgeColor(100, 1), 'green');
    assert.equal(badgeColor(100, 9), 'green');
  });

  test('the cap never changes a colour below the top grade', () => {
    for (const pct of [89, 70, 69, 50, 49, 0]) {
      assert.equal(badgeColor(pct, 3), badgeColor(pct, 0),
        `incomplete coverage must not alter the colour at ${pct}%`);
    }
  });

  test('no-matches, disabled and not-applicable do not count as incomplete', () => {
    // A validator that ran and found nothing applicable did its job
    // completely; disabled and not-applicable are project choices, not gaps.
    // Counting them would cap every small project and make the signal useless.
    assert.equal(incompleteCoverage({ counts: { checked: 3, 'no-matches': 9, disabled: 6, 'not-applicable': 2 } }), 0);
  });

  test('each state that means DocGuard could not check counts toward the cap', () => {
    assert.deepEqual([...INCOMPLETE_COVERAGE_STATES].sort(),
      ['error', 'missing-prerequisite', 'partial', 'unsupported']);
    for (const state of INCOMPLETE_COVERAGE_STATES) {
      assert.equal(incompleteCoverage({ counts: { checked: 5, 'no-matches': 2, [state]: 1 } }), 1, state);
      assert.equal(badgeColor(100, incompleteCoverage({ counts: { [state]: 1 } })), 'green', state);
    }
  });

  test('a missing check-coverage block is treated as complete, never as a gap', () => {
    assert.equal(incompleteCoverage(undefined), 0);
    assert.equal(incompleteCoverage(null), 0);
    assert.equal(incompleteCoverage({}), 0);
  });

  test('end to end: a project missing a prerequisite reports that state', () => {
    const out = guard(make(BASE));
    assert.match(out, /missing prerequisite/,
      'apiSurface declares API-REFERENCE.md as a prerequisite; without it DocGuard could not check the API surface');
    assert.match(out, /Check coverage: \d+ of \d+ validator\(s\) checked/);
  });

  test.after?.(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
});
