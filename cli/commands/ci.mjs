/**
 * CI Command — Single command for CI/CD pipelines
 * Uses runGuardInternal directly (no subprocess) for reliability.
 *
 * Exit codes:
 *   0 = All pass, score meets threshold
 *   1 = Guard errors or score below threshold
 *   2 = Guard warnings only
 *
 * v0.33: each run appends one line to `.docguard/history.jsonl` (score,
 * grade, commit, guard counts) so `docguard score --trend` can show the
 * trajectory. Opt out with `--no-history`. The append is silent-on-failure —
 * recording history must never fail the pipeline it records.
 */

import { c } from '../shared.mjs';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { appendHistory } from '../writers/history.mjs';
import { getHeadInfo, isGitRepo } from '../shared-git.mjs';

export function runCI(projectDir, config, flags) {
  const threshold = parseInt(flags.threshold || '0', 10);
  const failOnWarning = flags.failOnWarning || false;
  const isJson = flags.format === 'json';

  if (!isJson) {
    console.log(`${c.bold}🔄 DocGuard CI — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
    if (threshold > 0) console.log(`${c.dim}   Score threshold: ${threshold}${c.reset}`);
    console.log('');
  }

  // ── Run guard (internal — no subprocess) ──
  const guardData = runGuardInternal(projectDir, config);
  // Severity-aware effective counts (M2): `guard` gates on these, so `ci`
  // must too — a severity=low demotion or severity=high escalation has to
  // produce the same verdict from both commands.
  const hasErrors = guardData.effectiveErrors > 0;
  const hasWarnings = guardData.effectiveWarnings > 0;

  // ── Get score ──
  const scoreData = runScoreInternal(projectDir, config);

  // Status reflects EVERY gate, not just guard (L3): a threshold or
  // --fail-on-warning failure exits 1 and must not be recorded as PASS in
  // history or the JSON consumers parse.
  const thresholdMet = threshold <= 0 || scoreData.score >= threshold;
  const status =
    hasErrors || !thresholdMet || (failOnWarning && hasWarnings) ? 'FAIL'
    : hasWarnings ? 'WARN'
    : 'PASS';

  // ── Record history (unless opted out) ──
  if (!flags.noHistory) {
    const git = isGitRepo(projectDir) ? getHeadInfo(projectDir) : null;
    appendHistory(projectDir, {
      timestamp: new Date().toISOString(),
      commit: git ? git.commit.slice(0, 12) : null,
      score: scoreData.score,
      grade: scoreData.grade,
      errors: guardData.errors,
      warnings: guardData.warnings,
      baselineSuppressed: guardData.baselineSuppressed || 0,
      passed: guardData.passed,
      total: guardData.total,
      status,
    });
  }

  // ── Output ──
  if (isJson) {
    const result = {
      project: config.projectName,
      profile: config.profile || 'standard',
      projectType: config.projectType || 'unknown',
      score: scoreData.score,
      grade: scoreData.grade,
      guard: {
        passed: guardData.passed,
        total: guardData.total,
        status: guardData.status,
        baselineSuppressed: guardData.baselineSuppressed || 0,
        validators: guardData.validators.filter(v => v.status !== 'skipped'),
      },
      threshold,
      thresholdMet,
      status,
      timestamp: new Date().toISOString(),
    };
    // Machine output must survive a pipe: stdout.write + natural exit, never
    // console.log + process.exit (>8 KB payloads truncate mid-flush — same
    // class as the guard --format json bug fixed in v0.28).
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // Text output
    const guardStatus = hasErrors
      ? `${c.red}❌ FAIL${c.reset}`
      : hasWarnings
      ? `${c.yellow}⚠️  WARN${c.reset}`
      : `${c.green}✅ PASS${c.reset}`;

    console.log(`  ${c.bold}Guard:${c.reset}  ${guardStatus}  (${guardData.passed}/${guardData.total})`);
    if (guardData.baselineSuppressed > 0) {
      console.log(`  ${c.dim}📋 ${guardData.baselineSuppressed} pre-existing finding(s) suppressed by the committed baseline${c.reset}`);
    }
    console.log(`  ${c.bold}Score:${c.reset}  ${scoreData.score}/100 (${scoreData.grade})`);

    if (threshold > 0) {
      console.log(`  ${c.bold}Threshold:${c.reset}  ${thresholdMet ? `${c.green}✅ ≥${threshold}` : `${c.red}❌ <${threshold}`}${c.reset}`);
    }

    console.log('');
  }

  // Exit code follows `status` exactly — one derivation, no drift between
  // what history/JSON record and what the pipeline does.
  process.exitCode = status === 'FAIL' ? 1 : status === 'WARN' ? 2 : 0;
}
