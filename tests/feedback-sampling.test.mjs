/**
 * The feedback loop samples the labels that have never been validated.
 *
 * `reportable` derived from `confidence` alone, and the default `feedback`
 * selection used `reportable`. So the channel that would validate the
 * confidence label sampled only findings that label already doubted. Measured
 * on a real repository: 17 findings, all high-confidence, none of their codes
 * ever benchmarked — and `docguard feedback` selected ZERO.
 *
 * Now `reportable` is true when the code is unmeasured OR confidence is low,
 * and whatever the default leaves out is stated rather than hidden.
 *
 * @implements docguard.calibrated-finding-channels#FR-014
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkFinding } from '../cli/findings.mjs';
import { isMeasured } from '../cli/precision-evidence.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');
const dirs = [];

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-sampling-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

// A bare project produces BOTH populations at once: findings on codes the
// corpus measures (STR001 is one of the seven) and findings on codes it never
// has. Every one of them is high-confidence, which is exactly the run that
// used to offer nothing at all to the feedback loop.
const SPARSE = {
  'package.json': JSON.stringify({ name: 'sampling', version: '1.0.0' }),
  '.docguard.json': JSON.stringify({ projectName: 'sampling', profile: 'starter' }),
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nOne module.\n',
};

const run = (dir, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.stdout;
};

describe('default selection (FR-014)', () => {
  test('a confident finding on an unmeasured code IS sampled', () => {
    const f = mkFinding({ code: 'DQ007', confidence: 'high', suggestion: { kind: 'fix', text: 't' } });
    assert.equal(f.evidence.status, 'not-measured');
    assert.equal(f.reportable, true,
      'the population where a wrong label costs most must not be excluded by default');
  });

  test('a confident finding on a MEASURED code is left out of the default', () => {
    assert.equal(isMeasured('SEC005'), true);
    assert.equal(mkFinding({ code: 'SEC005', confidence: 'high' }).reportable, false);
  });

  test('end to end: the unmeasured findings are offered and the measured ones are not', () => {
    const dir = project(SPARSE);
    const findings = JSON.parse(run(dir, ['guard', '--format', 'json'])).findings;
    assert.ok(findings.length > 0, 'fixture must produce findings');
    assert.ok(findings.every(f => f.confidence === 'high'),
      'every finding is confident — under the old rule this run offered nothing');

    const unmeasured = findings.filter(f => f.evidence.status === 'not-measured');
    const measured = findings.filter(f => f.evidence.status === 'measured');
    assert.ok(unmeasured.length > 0 && measured.length > 0,
      'the fixture must exercise both populations to be worth anything');

    const feedback = JSON.parse(run(dir, ['feedback', '--preview', '--format', 'json']));
    assert.equal(feedback.reportable.length, unmeasured.length,
      'exactly the never-benchmarked findings are offered; the old rule offered zero');
    assert.equal(feedback.excluded.findings, measured.length,
      'the measured, confident findings are excluded — and said so');
  });

  test('what the default leaves out is stated, not hidden', () => {
    const dir = project(SPARSE);
    const feedback = JSON.parse(run(dir, ['feedback', '--preview', '--format', 'json']));
    assert.ok(feedback.excluded, 'the JSON contract must disclose the excluded set');
    assert.equal(typeof feedback.excluded.findings, 'number');
    assert.ok(Array.isArray(feedback.excluded.codes));
  });

  test('--all and --code still reach everything', () => {
    const dir = project(SPARSE);
    const all = JSON.parse(run(dir, ['feedback', '--preview', '--all', '--format', 'json']));
    const guard = JSON.parse(run(dir, ['guard', '--format', 'json']));
    assert.equal(all.reportable.length, guard.findings.length);
    assert.deepEqual(all.excluded, { findings: 0, codes: [] }, '--all excludes nothing');

    const code = guard.findings[0].code;
    const one = JSON.parse(run(dir, ['feedback', '--preview', '--code', code, '--format', 'json']));
    assert.ok(one.reportable.every(f => f.code === code));
  });
});

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
