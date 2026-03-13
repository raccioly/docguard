/**
 * CI Command — Single command for CI/CD pipelines
 * Runs guard + score and exits with appropriate code.
 * 
 * Exit codes:
 *   0 = All pass, score meets threshold
 *   1 = Guard errors or score below threshold
 *   2 = Guard warnings only
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c } from '../specguard.mjs';
import { runScoreInternal } from './score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'specguard.mjs');

export function runCI(projectDir, config, flags) {
  const threshold = parseInt(flags.threshold || '0', 10);
  const failOnWarning = flags.failOnWarning || false;
  const isJson = flags.format === 'json';

  if (!isJson) {
    console.log(`${c.bold}🔄 SpecGuard CI — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
    if (threshold > 0) console.log(`${c.dim}   Score threshold: ${threshold}${c.reset}`);
    console.log('');
  }

  // ── Run guard ──
  let guardExitCode = 0;
  let guardOutput = '';
  try {
    guardOutput = execSync(`node ${CLI_PATH} guard --dir "${projectDir}"`, {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    guardExitCode = e.status || 1;
    guardOutput = (e.stdout || '') + (e.stderr || '');
  }

  // Parse guard results from output
  const passMatch = guardOutput.match(/(\d+)\/(\d+)/);
  const totalPassed = passMatch ? parseInt(passMatch[1]) : 0;
  const totalChecks = passMatch ? parseInt(passMatch[2]) : 0;
  const hasErrors = guardExitCode === 1;
  const hasWarnings = guardExitCode === 2;

  // ── Get score ──
  const scoreData = runScoreInternal(projectDir, config);

  // ── Output ──
  if (isJson) {
    const result = {
      project: config.projectName,
      projectType: config.projectType || 'unknown',
      score: scoreData.score,
      grade: scoreData.grade,
      guard: {
        passed: totalPassed,
        total: totalChecks,
        status: hasErrors ? 'FAIL' : hasWarnings ? 'WARN' : 'PASS',
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

    console.log(`  ${c.bold}Guard:${c.reset}  ${guardStatus}  (${totalPassed}/${totalChecks})`);
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
