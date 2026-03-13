/**
 * CI Command — Single command for CI/CD pipelines
 * Uses runGuardInternal directly (no subprocess) for reliability.
 *
 * Exit codes:
 *   0 = All pass, score meets threshold
 *   1 = Guard errors or score below threshold
 *   2 = Guard warnings only
 */

import { c } from '../shared.mjs';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';

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
  const hasErrors = guardData.errors > 0;
  const hasWarnings = guardData.warnings > 0;

  // ── Get score ──
  const scoreData = runScoreInternal(projectDir, config);

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
        validators: guardData.validators.filter(v => v.status !== 'skipped'),
      },
      threshold,
      thresholdMet: threshold <= 0 || scoreData.score >= threshold,
      status: hasErrors ? 'FAIL' : hasWarnings ? 'WARN' : 'PASS',
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Text output
    const guardStatus = hasErrors
      ? `${c.red}❌ FAIL${c.reset}`
      : hasWarnings
      ? `${c.yellow}⚠️  WARN${c.reset}`
      : `${c.green}✅ PASS${c.reset}`;

    console.log(`  ${c.bold}Guard:${c.reset}  ${guardStatus}  (${guardData.passed}/${guardData.total})`);
    console.log(`  ${c.bold}Score:${c.reset}  ${scoreData.score}/100 (${scoreData.grade})`);

    if (threshold > 0) {
      const met = scoreData.score >= threshold;
      console.log(`  ${c.bold}Threshold:${c.reset}  ${met ? `${c.green}✅ ≥${threshold}` : `${c.red}❌ <${threshold}`}${c.reset}`);
    }

    console.log('');
  }

  // Exit code determination
  if (hasErrors) process.exit(1);
  if (threshold > 0 && scoreData.score < threshold) process.exit(1);
  if (failOnWarning && hasWarnings) process.exit(1);
  if (hasWarnings) process.exit(2);
  process.exit(0);
}
