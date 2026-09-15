// @req docguard.adoption-workflow-integrity#FR-009
// @req docs-canonical/REQUIREMENTS.md#FR-013
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReadinessAssessment } from '../cli/assessment.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLI = join(TEST_DIR, '..', 'cli', 'docguard.mjs');

function guard(status, errors = 0, warnings = 0) {
  return {
    status,
    errors,
    warnings,
    effectiveErrors: errors,
    effectiveWarnings: warnings,
  };
}

function score(value = 99, grade = 'A+') {
  return { score: value, grade, scoreKind: 'structural-maturity' };
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

describe('combined readiness assessment', () => {
  it('blocks on guard failure even with a 99/A+ Structural Maturity score', () => {
    const result = buildReadinessAssessment(guard('FAIL', 1), score());

    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['GUARD_FAILED']);
    assert.deepEqual(result.structuralMaturity, {
      score: 99,
      grade: 'A+',
      scoreKind: 'structural-maturity',
    });
    assert.match(result.summary, /guard failed/);
    assert.match(result.summary, /Structural Maturity is 99\/100 \(A\+\)/);
  });

  it('requires attention for guard warnings and reports ready for a pass', () => {
    const warning = buildReadinessAssessment(guard('WARN', 0, 2), score(87, 'A'));
    const passing = buildReadinessAssessment(guard('PASS'), score(87, 'A'));

    assert.equal(warning.status, 'ATTENTION');
    assert.deepEqual(warning.reasons, ['GUARD_WARNINGS']);
    assert.match(warning.summary, /2 advisory warnings/);
    assert.equal(passing.status, 'READY');
    assert.deepEqual(passing.reasons, []);
    assert.match(passing.summary, /^guard passed/);
  });

  it('blocks when a configured CI score threshold is not met', () => {
    const result = buildReadinessAssessment(guard('PASS'), score(79, 'B'), {
      threshold: 80,
      thresholdMet: false,
    });

    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['CI_THRESHOLD_NOT_MET']);
    assert.deepEqual(result.threshold, { configured: true, value: 80, met: false });
    assert.match(result.summary, /below CI threshold 80/);
  });

  it('preserves fail-on-warning as a blocking CI policy', () => {
    const result = buildReadinessAssessment(guard('WARN', 0, 1), score(), {
      failOnWarning: true,
    });

    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['CI_WARNINGS_BLOCKED']);
  });
});

describe('assessment command contracts', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  function makeIncompleteProject() {
    projectDir = mkdtempSync(join(tmpdir(), 'docguard-assessment-'));
    mkdirSync(join(projectDir, 'docs-canonical'));
    writeFileSync(join(projectDir, '.docguard.json'), JSON.stringify({
      projectName: 'assessment-fixture',
      profile: 'standard',
      diskCache: false,
    }));
    writeFileSync(join(projectDir, 'README.md'), '# Assessment fixture\n');
    writeFileSync(join(projectDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n\nIncomplete fixture.\n');
    return projectDir;
  }

  it('adds BLOCKED readiness to CI, report, and diagnose JSON without replacing legacy fields', () => {
    const dir = makeIncompleteProject();

    for (const command of ['ci', 'report', 'diagnose']) {
      const result = runCli([command, '--dir', dir, '--format', 'json', '--no-history'], dir);
      assert.ok([0, 1, 2].includes(result.status), `${command}: ${result.stderr}`);
      const output = JSON.parse(result.stdout);

      assert.equal(output.assessment.status, 'BLOCKED', command);
      assert.equal(output.assessment.structuralMaturity.score, command === 'report' ? output.score.score : output.score);
      assert.equal(output.assessment.structuralMaturity.grade, command === 'report' ? output.score.grade : output.grade);
      assert.ok(output.status || output.guard.status, `${command} keeps its existing verdict field`);
    }
  });

  it('shows readiness in CI, report, and diagnose human output', () => {
    const dir = makeIncompleteProject();
    const ci = runCli(['ci', '--dir', dir, '--no-history'], dir);
    const report = runCli(['report', '--dir', dir], dir);
    const diagnose = runCli(['diagnose', '--dir', dir], dir);
    const ciOutput = stripAnsi(ci.stdout);
    const reportOutput = stripAnsi(report.stdout);
    const diagnoseOutput = stripAnsi(diagnose.stdout);

    assert.match(ciOutput, /Readiness:\s+BLOCKED/);
    assert.match(ciOutput, /Structural Maturity:/);
    assert.match(reportOutput, /\| Readiness \| \*\*BLOCKED\*\*/);
    assert.match(reportOutput, /\| Structural Maturity \|/);
    assert.match(diagnoseOutput, /Readiness:\s+BLOCKED/);
    assert.match(diagnoseOutput, /Structural Maturity:/);
  });

  it('labels standalone score as Structural Maturity and disclaims a guard verdict', () => {
    const dir = makeIncompleteProject();
    const jsonResult = runCli(['score', '--dir', dir, '--format', 'json'], dir);
    const textResult = runCli(['score', '--dir', dir], dir);
    const json = JSON.parse(jsonResult.stdout);

    assert.match(textResult.stdout, /DocGuard Structural Maturity/);
    assert.match(textResult.stdout, /not a guard verdict/);
    assert.match(textResult.stdout, new RegExp(`CDD Maturity Score: ${json.score}\\/100 \\(${json.grade.replace('+', '\\+')}\\)`));
    assert.equal(json.scoreKind, 'structural-maturity');
  });
});
