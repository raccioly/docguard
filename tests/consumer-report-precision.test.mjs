/**
 * Consumer reports against 0.45.1 (spec 080, issues 593, 594, 596, 597, 598).
 *
 * Each case is the report's own reproduction on a throwaway project, next to a
 * positive control that keeps the finding the report says is still right.
 *
 * @req docguard.consumer-report-precision#FR-001
 * @req docguard.consumer-report-precision#FR-002
 * @req docguard.consumer-report-precision#FR-003
 * @req docguard.consumer-report-precision#FR-004
 * @req docguard.consumer-report-precision#FR-005
 * @req docguard.consumer-report-precision#FR-007
 * @req docguard.consumer-report-precision#FR-008
 * @req docguard.consumer-report-precision#SC-001
 */
// The A/B proofs (SC-002, SC-003) are recorded in the spec's Implementation
// Outcomes; these cases are the reproductions that A/B was checked against.
// @req docguard.consumer-report-precision#SC-002
// @req docguard.consumer-report-precision#SC-003
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';
import { applyMechanicalFix } from '../cli/writers/mechanical.mjs';
import { detectUntouchedClaims, detectSpecKit } from '../cli/scanners/speckit.mjs';
import { validateDiffSuspicion } from '../cli/validators/diff-suspicion.mjs';
import { fixtureGit } from './helpers/git.mjs';
// @implements docguard.test-git-hermeticity#FR-001: this file's fixture git goes through the helper.

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-080-'));
  dirs.push(dir);
  write(dir, files);
  return dir;
}

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
}

const cases = (n, prefix = 'c') => Array.from({ length: n }, (_, i) => `it('${prefix}${i}', () => {});`).join('\n') + '\n';
const codes = (result, code) => result.findings.filter(f => f.code === code);
const metrics = (dir, guard) => validateMetricsConsistency(dir, {}, guard);

// ── FR-001: thousands separators in DocGuard meta-counts (#593) ─────────────

describe('FR-001: a comma-formatted check count is read whole (#593)', () => {
  it('the #593 reproduction: "1,183 checks" equals 1183 and reports nothing', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard currently runs 1,183 checks.\n' });
    const r = metrics(dir, [{ status: 'pass', total: 1183 }]);
    assert.deepEqual(codes(r, 'MET001'), [], JSON.stringify(r.findings));
    assert.deepEqual(r.fixes, []);
  });

  it('a genuinely stale comma count is reported whole and the fix rewrites the whole number', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard currently runs 1,100 checks.\n' });
    const r = metrics(dir, [{ status: 'pass', total: 1183 }]);
    const met = codes(r, 'MET001');
    assert.equal(met.length, 1);
    assert.match(met[0].message, /says "1,100 checks"/);
    assert.equal(r.fixes.length, 1);
    assert.equal(r.fixes[0].found, 1100);
    const applied = applyMechanicalFix(dir, r.fixes[0], { config: {} });
    assert.equal(applied.applied, true, JSON.stringify(applied));
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# Fixture\n\nDocGuard currently runs 1,183 checks.\n');
  });

  it('a plain stale count is still rewritten in plain digits', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard currently runs 1100 checks.\n' });
    const r = metrics(dir, [{ status: 'pass', total: 1183 }]);
    assert.equal(codes(r, 'MET001').length, 1);
    assert.equal(applyMechanicalFix(dir, r.fixes[0], { config: {} }).applied, true);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# Fixture\n\nDocGuard currently runs 1183 checks.\n');
  });

  it('the fix leaves a ratio and an identifier with the same digits untouched', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard currently runs 1,100 checks.\nDocGuard passed 8/1,100 checks; DocGuard FR1100 checks stay.\n' });
    const r = metrics(dir, [{ status: 'pass', total: 1183 }]);
    assert.equal(applyMechanicalFix(dir, r.fixes[0], { config: {} }).applied, true);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'),
      '# Fixture\n\nDocGuard currently runs 1,183 checks.\nDocGuard passed 8/1,100 checks; DocGuard FR1100 checks stay.\n');
  });

  it('ratios stay excluded, with and without separators', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard passes 8/8 checks and 1,183/1,183 checks.\n' });
    const r = metrics(dir, [{ status: 'pass', total: 1183 }]);
    assert.deepEqual(codes(r, 'MET001'), []);
  });

  it('a comma-formatted validator count is read whole', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard ships 2,045 validators.\n' });
    const met = codes(metrics(dir), 'MET001');
    assert.equal(met.length, 1);
    assert.match(met[0].message, /says "2,045 validators"/);
  });
});

describe('FR-001 edge cases', () => {
  const guard = [{ status: 'pass', total: 1183 }];
  it('a range is not a count, and a malformed group is not a count', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard runs 30-40 checks.\nDocGuard runs 1,1833 checks.\n' });
    assert.deepEqual(codes(metrics(dir, guard), 'MET001'), []);
  });

  it('both spellings of one stale number are rewritten, each in its own spelling', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard runs 1,100 checks.\nDocGuard: 1100 checks in CI.\n' });
    const r = metrics(dir, guard);
    assert.equal(r.fixes.length, 1);
    assert.equal(applyMechanicalFix(dir, r.fixes[0], { config: {} }).applied, true);
    assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# Fixture\n\nDocGuard runs 1,183 checks.\nDocGuard: 1183 checks in CI.\n');
  });
});

// ── FR-002: identifiers are not counts (#594) ───────────────────────────────

describe('FR-002: a requirement identifier is not a test count (#594)', () => {
  const suite = sentence => project({ 'tests/example.test.js': cases(400), 'README.md': `# Fixture\n\n${sentence}\n` });

  for (const sentence of [
    'The unit suite guards FR365 tests for held handoffs.',
    'The unit suite guards FR-365 tests for held handoffs.',
    'The suite keeps the #365 tests from the regression.',
    'The suite pins v3.65 tests to the old runner.',
  ]) {
    it(`"${sentence}" reports nothing`, () => {
      assert.deepEqual(codes(metrics(suite(sentence)), 'MET003'), []);
    });
  }

  it('a genuinely stale count still warns (positive control)', () => {
    const met = codes(metrics(suite('The unit suite contains 365 tests.')), 'MET003');
    assert.equal(met.length, 1);
    assert.match(met[0].message, /says "365 tests"/);
  });

  it('a correct count reports nothing', () => {
    assert.deepEqual(codes(metrics(suite('The unit suite contains 400 tests.')), 'MET003'), []);
  });

  it('a thousands-separated count is still read whole: 1,200 is not 200', () => {
    assert.deepEqual(codes(metrics(suite('The suite contains 1,200 tests.')), 'MET003'), []);
  });

  it('an identifier is not a check count either', () => {
    const dir = project({ 'README.md': '# Fixture\n\nDocGuard FR-365 checks the handoff.\n' });
    assert.deepEqual(codes(metrics(dir, [{ status: 'pass', total: 1183 }]), 'MET001'), []);
  });
});

// ── FR-003: a test-file count is not a test-case count (#596) ───────────────

describe('FR-003: "N test files" is not compared with declared cases (#596)', () => {
  const twenty = () => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`tests/f${i}.test.js`, cases(20, `f${i}-`)]));
  const suite = sentence => project({ ...twenty(), 'README.md': `# Fixture\n\n${sentence}\n` });

  for (const sentence of [
    'The Vitest suite passes 400 cases across 20 test files.',
    '## Checkpoint 2026-10-16\n\nFinal full local Vitest run passes400/400 cases across20 test files.',
    'The suite spans 20 test suites.',
    'The suite runs in 20 test modules.',
  ]) {
    it(`"${sentence.split('\n').pop()}" reports nothing`, () => {
      assert.deepEqual(codes(metrics(suite(sentence)), 'MET003'), []);
    });
  }

  it('a stale case count still warns (positive control)', () => {
    assert.equal(codes(metrics(suite('The test suite contains 20 tests.')), 'MET003').length, 1);
  });

  it('"N test cases" is still a case count', () => {
    assert.equal(codes(metrics(suite('The suite has 20 test cases.')), 'MET003').length, 1);
    assert.deepEqual(codes(metrics(suite('The suite has 400 test cases.')), 'MET003'), []);
  });
});

// ── FR-004: git cannot see an ignored file (#597) ───────────────────────────

describe('FR-004: SPK010 does not say "never changed" about a file git cannot observe (#597)', () => {
  function repo() {
    const dir = project();
    const git = (...a) => fixtureGit(dir, a);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    write(dir, {
      '.gitignore': '.wolf/\n',
      'src/untouched.js': 'export const u = 1;\n',
      '.docguard.json': JSON.stringify({ projectName: 'd', profile: 'starter' }),
    });
    git('add', '-A'); git('commit', '-qm', 'baseline');
    write(dir, {
      'specs/001-example/spec.md': '# Feature Specification: Example\n\n**Status**: Active\n',
      'specs/001-example/tasks.md': [
        '# Tasks: Example', '',
        '- [x] T001 Implement `src/current.js`.',
        '- [x] T002 Change `src/untouched.js`.',
        '- [x] T003 Run the local diagnostic; evidence `.wolf/validate/run/report.json`.',
        '- [x] T004 Keep the receipts under `.wolf/validate/`.',
        '',
      ].join('\n'),
      'src/current.js': 'export const c = 1;\n',
    });
    git('add', '-A'); git('commit', '-qm', 'feature');
    write(dir, { '.wolf/validate/run/report.json': '{"ok":true}\n' });
    return { dir, git };
  }
  const untouched = dir => detectUntouchedClaims(dir, detectSpecKit(dir).specs).flatMap(r => r.untouched);

  it('the #597 reproduction: only the tracked, untouched deliverable is reported', () => {
    const { dir, git } = repo();
    assert.equal(git('check-ignore', '.wolf/validate/run/report.json').trim(), '.wolf/validate/run/report.json');
    assert.equal(git('status', '--porcelain'), '');
    const found = untouched(dir);
    assert.deepEqual(found.map(u => u.id), ['T002']);
    assert.deepEqual(found[0].paths, ['src/untouched.js']);
  });

  it('a tracked file under an ignore rule is observable, so it is still reported when untouched', () => {
    const dir = project();
    const git = (...a) => fixtureGit(dir, a);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    write(dir, { '.gitignore': 'vendor/\n', 'vendor/pinned.js': 'export const v = 1;\n' });
    git('add', '-A'); git('add', '-f', 'vendor/pinned.js'); git('commit', '-qm', 'baseline');
    write(dir, {
      'specs/001-example/spec.md': '# Feature Specification: Example\n\n**Status**: Active\n',
      'specs/001-example/tasks.md': '# Tasks: Example\n\n- [x] T001 Patch `vendor/pinned.js`.\n',
    });
    git('add', '-A'); git('commit', '-qm', 'feature');
    assert.deepEqual(untouched(dir).map(u => u.paths), [['vendor/pinned.js']]);
  });
});

// ── FR-005: overlap is read where the doc names the file (#598) ─────────────

describe('FR-005: DSP001 counts overlap only in the reference context (#598)', () => {
  const OLD = "import { test } from 'node:test';\ntest('isolates only the child git context before exit', () => {});\n";
  const NEW = "import { test } from 'node:test';\ntest('stops the pre-push hook before lint when docs fail', () => {});\n";

  function repo(doc) {
    const dir = project();
    const git = (...a) => fixtureGit(dir, a);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    write(dir, { 'tests/unit/walk-env-safety.test.js': OLD, 'docs-canonical/TEST-SPEC.md': doc });
    git('add', '-A'); git('commit', '-qm', 'initial');
    write(dir, { 'tests/unit/walk-env-safety.test.js': NEW });
    git('add', '-A'); git('commit', '-qm', 'change');
    return dir;
  }
  const dsp = dir => codes(validateDiffSuspicion(dir, { changedSinceRef: 'HEAD~1' }), 'DSP001');

  it('the #598 shape: an inventory row plus unrelated prose in another section reports nothing', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Inventory', '',
      '| File | Cases |', '| --- | --- |', '| `tests/unit/walk-env-safety.test.js` | 23 |', '',
      '## Process model', '',
      'Each runner spawns only one child process and checks its exit code.', '',
    ].join('\n'));
    assert.deepEqual(dsp(dir), []);
  });

  it('other inventory rows in the same table do not lend their words to the referenced row', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Inventory', '',
      '| File | Covers |', '| --- | --- |',
      '| `tests/unit/walk-env-safety.test.js` | hook environment |',
      '| `tests/unit/exit-codes.test.js` | only the child exit codes |', '',
    ].join('\n'));
    assert.deepEqual(dsp(dir), []);
  });

  it('a field table in the file\'s own section still counts (positive control)', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Hook environment', '',
      'Source: `tests/unit/walk-env-safety.test.js`', '',
      '| Field | Meaning |', '| --- | --- |', '| `scope` | only the child git context |', '| `stop` | before exit |', '',
      '## Elsewhere', '',
      'Unrelated.', '',
    ].join('\n'));
    assert.equal(dsp(dir).length, 1);
  });

  it('a claim beside the reference about the removed behavior is still flagged (positive control)', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Hook environment', '',
      '`tests/unit/walk-env-safety.test.js` isolates only the child git context before exit.', '',
      '## Process model', '',
      'Unrelated.', '',
    ].join('\n'));
    const found = dsp(dir);
    assert.equal(found.length, 1);
    assert.match(found[0].message, /walk-env-safety/);
  });

  it('the #598 document shape: one long section of bold-label paragraphs around the inventory row', () => {
    const dir = repo([
      '# TEST SPEC', '',
      '**Frame attribution:** frame-meter tests require the new report to contain only its window.', '',
      '| File | Cases |', '| --- | --- |', '| `tests/unit/walk-env-safety.test.js` | 10 |', '| `tests/unit/walk-errors.test.js` | 10 |', '',
      '**Child clarity:** grading fixtures use one child slot each.', '',
      '**Room exits:** the door exit test checks the approach.', '',
    ].join('\n'));
    assert.deepEqual(dsp(dir), []);
  });

  it('an inventory row that itself carries the removed words is still flagged (positive control)', () => {
    const dir = repo([
      '# TEST SPEC', '',
      '| File | Covers |', '| --- | --- |', '| `tests/unit/walk-env-safety.test.js` | isolates only the child git context before exit |', '',
    ].join('\n'));
    assert.equal(dsp(dir).length, 1);
  });

  it('a prose reference still reads the next paragraph of its section (positive control)', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Hook environment', '',
      'The suite in `tests/unit/walk-env-safety.test.js` guards the hook.', '',
      'It isolates only the child git context before exit.', '',
    ].join('\n'));
    assert.equal(dsp(dir).length, 1);
  });

  it('a heading that names the file owns its subsections', () => {
    const dir = repo([
      '# Test Spec', '',
      '## `tests/unit/walk-env-safety.test.js`', '',
      '### Behavior', '',
      'It isolates only the child git context before exit.', '',
      '## Elsewhere', '',
      'Unrelated.', '',
    ].join('\n'));
    assert.equal(dsp(dir).length, 1);
  });

  it('a heading inside a code fence does not end the section', () => {
    const dir = repo([
      '# Test Spec', '',
      '## Hook environment', '',
      'See `tests/unit/walk-env-safety.test.js`:', '',
      '```sh', '# run it', 'npm test', '```', '',
      'It isolates only the child git context before exit.', '',
    ].join('\n'));
    assert.equal(dsp(dir).length, 1);
  });
});

// ── FR-008: the docs say what changed ────────────────────────────────────────

describe('FR-008: the finding reference and the language table describe the new behavior', () => {
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

  it('docs/reference/findings.md, generated from cli/findings.mjs, carries each change', () => {
    const findings = read('docs/reference/findings.md');
    assert.match(findings, /"1,183 checks" reads as 1183/);
    assert.match(findings, /"FR365 tests"\) and a count of something else \("20 test files"/);
    assert.match(findings, /A path git cannot observe \(ignored and untracked/);
    assert.match(findings, /in the section that names the file/);
  });

  it('docs/reference/languages.md says auth behind an unreadable use() path marks nothing', () => {
    assert.match(read('docs/reference/languages.md'), /auth behind a path the reader cannot read is recorded in `scan\.unresolved` and marks nothing/);
  });
});
