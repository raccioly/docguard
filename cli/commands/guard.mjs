/**
 * Guard Command — Validate project against its canonical documentation
 * Runs all enabled validators and reports results.
 *
 * Two modes:
 *   runGuard()         → prints to console, exits with code
 *   runGuardInternal() → returns data, no side effects (for diagnose, ci)
 */

import { c } from '../docguard.mjs';
import { validateStructure, validateDocSections } from '../validators/structure.mjs';
import { validateDrift } from '../validators/drift.mjs';
import { validateChangelog } from '../validators/changelog.mjs';
import { validateTestSpec } from '../validators/test-spec.mjs';
import { validateEnvironment } from '../validators/environment.mjs';
import { validateSecurity } from '../validators/security.mjs';
import { validateDocsSync } from '../validators/docs-sync.mjs';
import { validateArchitecture } from '../validators/architecture.mjs';
import { validateFreshness } from '../validators/freshness.mjs';
import { validateTraceability } from '../validators/traceability.mjs';

/**
 * Internal guard — returns structured data, no console output, no process.exit.
 * Used by diagnose, ci, and guard --format json.
 */
export function runGuardInternal(projectDir, config) {
  const validators = config.validators || {};
  const results = [];

  const validatorMap = [
    { key: 'structure', name: 'Structure', fn: () => validateStructure(projectDir, config) },
    { key: 'structure', name: 'Doc Sections', fn: () => validateDocSections(projectDir, config) },
    { key: 'docsSync', name: 'Docs-Sync', fn: () => validateDocsSync(projectDir, config) },
    { key: 'drift', name: 'Drift', fn: () => validateDrift(projectDir, config) },
    { key: 'changelog', name: 'Changelog', fn: () => validateChangelog(projectDir, config) },
    { key: 'testSpec', name: 'Test-Spec', fn: () => validateTestSpec(projectDir, config) },
    { key: 'environment', name: 'Environment', fn: () => validateEnvironment(projectDir, config) },
    { key: 'security', name: 'Security', fn: () => validateSecurity(projectDir, config) },
    { key: 'architecture', name: 'Architecture', fn: () => validateArchitecture(projectDir, config) },
    { key: 'freshness', name: 'Freshness', fn: () => {
      const freshnessResults = validateFreshness(projectDir, config);
      const errors = [];
      const warnings = [];
      let passed = 0;
      for (const r of freshnessResults) {
        if (r.status === 'pass') passed++;
        else if (r.status === 'warn') warnings.push(r.message);
        else if (r.status === 'fail') errors.push(r.message);
      }
      return { errors, warnings, passed, total: passed + warnings.length + errors.length };
    }},
    { key: 'traceability', name: 'Traceability', fn: () => validateTraceability(projectDir, config) },
  ];

  for (const { key, name, fn } of validatorMap) {
    if (validators[key] === false) {
      results.push({ name, key, status: 'skipped', quality: null, errors: [], warnings: [], passed: 0, total: 0 });
      continue;
    }

    try {
      const result = fn();
      const hasErrors = result.errors.length > 0;
      const hasWarnings = result.warnings.length > 0;
      const status = hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass';

      // Quality label: HIGH/MEDIUM/LOW (inspired by CJE quality stratification, Lopez et al. TRACE 2026)
      let quality;
      if (hasErrors) {
        quality = 'LOW';
      } else if (hasWarnings) {
        quality = 'MEDIUM';
      } else {
        // Pass — check coverage ratio for HIGH vs MEDIUM
        const ratio = result.total > 0 ? result.passed / result.total : 1;
        quality = ratio >= 0.9 ? 'HIGH' : 'MEDIUM';
      }

      results.push({ ...result, name, key, status, quality });
    } catch (err) {
      results.push({ name, key, status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1 });
    }
  }

  const activeResults = results.filter(r => r.status !== 'skipped');
  const totalErrors = activeResults.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = activeResults.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalPassed = activeResults.reduce((sum, r) => sum + r.passed, 0);
  const totalChecks = activeResults.reduce((sum, r) => sum + r.total, 0);

  const overallStatus = totalErrors > 0 ? 'FAIL' : totalWarnings > 0 ? 'WARN' : 'PASS';

  return {
    project: config.projectName,
    profile: config.profile || 'standard',
    status: overallStatus,
    passed: totalPassed,
    total: totalChecks,
    errors: totalErrors,
    warnings: totalWarnings,
    validators: results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Public guard — prints results and exits.
 */
export function runGuard(projectDir, config, flags) {
  const data = runGuardInternal(projectDir, config);

  // ── JSON output ──
  if (flags.format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    if (data.errors > 0) process.exit(1);
    if (data.warnings > 0) process.exit(2);
    process.exit(0);
  }

  // ── Text output ──
  console.log(`${c.bold}🛡️  DocGuard Guard — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  for (const v of data.validators) {
    if (v.status === 'skipped') {
      if (flags.verbose) {
        console.log(`  ${c.dim}⏭️  ${v.name} (disabled)${c.reset}`);
      }
      continue;
    }

    // Quality label badge
    const qColor = v.quality === 'HIGH' ? c.green : v.quality === 'MEDIUM' ? c.yellow : c.red;
    const qBadge = `${qColor}[${v.quality}]${c.reset}`;

    if (v.status === 'pass') {
      console.log(`  ${c.green}✅ ${v.name}${c.reset} ${qBadge}${c.dim}  ${v.passed}/${v.total} checks passed${c.reset}`);
    } else if (v.status === 'fail') {
      console.log(`  ${c.red}❌ ${v.name}${c.reset} ${qBadge}${c.dim}  ${v.passed}/${v.total} checks passed${c.reset}`);
    } else {
      console.log(`  ${c.yellow}⚠️  ${v.name}${c.reset} ${qBadge}${c.dim}  ${v.passed}/${v.total} checks passed${c.reset}`);
    }

    if (flags.verbose || v.status === 'fail') {
      for (const err of v.errors) {
        console.log(`     ${c.red}✗ ${err}${c.reset}`);
      }
    }
    if (flags.verbose || v.status === 'warn') {
      for (const warn of v.warnings) {
        console.log(`     ${c.yellow}⚠ ${warn}${c.reset}`);
      }
    }
  }

  // Summary
  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);

  if (data.status === 'PASS') {
    console.log(`  ${c.green}${c.bold}✅ PASS${c.reset} ${c.green}— All ${data.total} checks passed${c.reset}`);
  } else if (data.status === 'WARN') {
    console.log(`  ${c.yellow}${c.bold}⚠️  WARN${c.reset} ${c.yellow}— ${data.passed}/${data.total} passed, ${data.warnings} warning(s)${c.reset}`);
  } else {
    console.log(`  ${c.red}${c.bold}❌ FAIL${c.reset} ${c.red}— ${data.passed}/${data.total} passed, ${data.errors} error(s), ${data.warnings} warning(s)${c.reset}`);
  }

  // Next step hint — always point to diagnose when issues exist
  if (data.status !== 'PASS') {
    console.log(`  ${c.dim}Run ${c.cyan}docguard diagnose${c.dim} to get AI fix prompts.${c.reset}`);
  }

  console.log('');

  if (data.errors > 0) process.exit(1);
  if (data.warnings > 0) process.exit(2);
  process.exit(0);
}
