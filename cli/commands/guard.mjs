/**
 * Guard Command — Validate project against its canonical documentation
 * Runs all enabled validators and reports results.
 *
 * Two modes:
 *   runGuard()         → prints to console, exits with code
 *   runGuardInternal() → returns data, no side effects (for diagnose, ci)
 */

import { c, resolveSeverity } from '../shared.mjs';
import { detectAgentMode, isSpecKitInitialized } from '../ensure-skills.mjs';
import { checkUpgradeStatus } from './upgrade.mjs';
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
import { validateDocsDiff } from '../validators/docs-diff.mjs';
import { validateApiSurface } from '../validators/api-surface.mjs';
import { validateMetadataSync } from '../validators/metadata-sync.mjs';
import { validateMetricsConsistency } from '../validators/metrics-consistency.mjs';
import { validateDocsCoverage } from '../validators/docs-coverage.mjs';
import { validateDocQuality } from '../validators/doc-quality.mjs';
import { validateCrossReferences } from '../validators/cross-reference.mjs';
import { validateTodoTracking } from '../validators/todo-tracking.mjs';
import { validateSchemaSync } from '../validators/schema-sync.mjs';
import { validateSpecKitIntegration } from '../scanners/speckit.mjs';

/**
 * Internal guard — returns structured data, no console output, no process.exit.
 * Used by diagnose, ci, and guard --format json.
 */
/**
 * Classify a validator result into a status + quality badge.
 *
 * Critically, a check that found NOTHING to validate (no errors, no warnings,
 * total === 0) — or that explicitly reports `applicable === false` — is status
 * 'na' (not applicable), NOT 'pass'. This prevents a validator from rendering a
 * confident green ✅ when it actually checked nothing (the root cause of the
 * "clean bill of health on out-of-sync docs" incident).
 */
export function classifyResult(result) {
  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;

  if (!hasErrors && !hasWarnings && (result.applicable === false || result.total === 0)) {
    return { status: 'na', quality: null };
  }

  const status = hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass';

  // Quality label: HIGH/MEDIUM/LOW (inspired by CJE quality stratification, Lopez et al. TRACE 2026)
  let quality;
  if (hasErrors) {
    quality = 'LOW';
  } else if (hasWarnings) {
    quality = 'MEDIUM';
  } else {
    const ratio = result.total > 0 ? result.passed / result.total : 1;
    quality = ratio >= 0.9 ? 'HIGH' : 'MEDIUM';
  }
  return { status, quality };
}

export function runGuardInternal(projectDir, config) {
  const validators = config.validators || {};
  const results = [];

  const validatorMap = [
    { key: 'structure', name: 'Structure', fn: () => validateStructure(projectDir, config) },
    { key: 'structure', name: 'Doc Sections', fn: () => validateDocSections(projectDir, config) },
    { key: 'docsSync', name: 'Docs-Sync', fn: () => validateDocsSync(projectDir, config) },
    { key: 'drift', name: 'Drift-Comments', fn: () => validateDrift(projectDir, config) },
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
    { key: 'docsDiff', name: 'Docs-Diff', fn: () => validateDocsDiff(projectDir, config) },
    { key: 'apiSurface', name: 'API-Surface', fn: () => validateApiSurface(projectDir, config) },
    { key: 'metadataSync', name: 'Metadata-Sync', fn: () => validateMetadataSync(projectDir, config) },
    { key: 'docsCoverage', name: 'Docs-Coverage', fn: () => validateDocsCoverage(projectDir, config) },
    { key: 'docQuality', name: 'Doc-Quality', fn: () => validateDocQuality(projectDir, config) },
    { key: 'todoTracking', name: 'TODO-Tracking', fn: () => validateTodoTracking(projectDir, config) },
    { key: 'schemaSync', name: 'Schema-Sync', fn: () => validateSchemaSync(projectDir, config) },
    { key: 'specKit', name: 'Spec-Kit', fn: () => validateSpecKitIntegration(projectDir, config) },
    { key: 'crossReference', name: 'Cross-Reference', fn: () => validateCrossReferences(projectDir, config) },
    // Metrics-Consistency runs post-loop (needs guard results)
  ];

  for (const { key, name, fn } of validatorMap) {
    if (validators[key] === false) {
      results.push({ name, key, status: 'skipped', quality: null, errors: [], warnings: [], passed: 0, total: 0 });
      continue;
    }

    try {
      const result = fn();
      results.push({ ...result, name, key, ...classifyResult(result) });
    } catch (err) {
      results.push({ name, key, status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1 });
    }
  }

  // ── Metrics-Consistency runs AFTER all other validators (needs their results) ──
  if (validators.metricsConsistency !== false) {
    try {
      const result = validateMetricsConsistency(projectDir, config, results);
      results.push({ ...result, name: 'Metrics-Consistency', key: 'metricsConsistency', ...classifyResult(result) });
    } catch (err) {
      results.push({ name: 'Metrics-Consistency', key: 'metricsConsistency', status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1 });
    }
  }

  const activeResults = results.filter(r => r.status !== 'skipped');
  const totalErrors = activeResults.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = activeResults.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalPassed = activeResults.reduce((sum, r) => sum + r.passed, 0);
  const totalChecks = activeResults.reduce((sum, r) => sum + r.total, 0);

  // Per-validator severity overrides (v0.5 schema). Affects EXIT-CODE only,
  // not display. Annotate each validator with its resolved severity and roll
  // up effective error/warning counts:
  //   - high  → validator's warnings get promoted to "effective errors"
  //   - low   → validator's warnings are demoted (ignored for exit code)
  //   - medium (default) → warnings stay as-is
  for (const v of activeResults) {
    v.severity = resolveSeverity(config, v.key);
  }
  let effectiveErrors = totalErrors;
  let effectiveWarnings = 0;
  for (const v of activeResults) {
    const wCount = v.warnings.length;
    if (wCount === 0) continue;
    if (v.severity === 'high') effectiveErrors += wCount;
    else if (v.severity === 'low') { /* ignored for exit */ }
    else effectiveWarnings += wCount;
  }

  const overallStatus = totalErrors > 0 ? 'FAIL' : totalWarnings > 0 ? 'WARN' : 'PASS';

  return {
    project: config.projectName,
    profile: config.profile || 'standard',
    status: overallStatus,
    passed: totalPassed,
    total: totalChecks,
    errors: totalErrors,
    warnings: totalWarnings,
    // v0.5: severity-aware counts for exit-code logic. The display still uses
    // the raw counts above so users see every warning, but CI only fails on
    // things they've marked as high-severity.
    effectiveErrors,
    effectiveWarnings,
    validators: results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * The "pre-commit lite" validator set — fast checks suitable for running
 * on every commit/save. Tuned for <2s wall-clock on average repos.
 *
 * The list is intentionally short: validators that catch >80% of the
 * common doc drift that developers introduce mid-feature (route added but
 * not documented, env var renamed but not updated in ENVIRONMENT.md,
 * endpoint deleted but still in API-REFERENCE.md). Heavy validators —
 * Freshness (git log), Traceability (REQ scan), Doc-Quality (prose lint) —
 * stay off for speed.
 */
export const CHANGED_ONLY_VALIDATORS = ['docsSync', 'environment', 'apiSurface'];

/**
 * Build a validators map that enables only the pre-commit-lite set.
 * Used by `docguard guard --changed-only`.
 */
function liteValidatorsConfig() {
  const all = [
    'structure', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment',
    'security', 'architecture', 'freshness', 'traceability', 'docsDiff',
    'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking',
    'schemaSync', 'specKit', 'crossReference', 'metricsConsistency',
  ];
  const out = {};
  for (const k of all) out[k] = CHANGED_ONLY_VALIDATORS.includes(k);
  return out;
}

/**
 * Public guard — prints results and exits.
 */
export function runGuard(projectDir, config, flags) {
  // --changed-only: pre-commit lite mode. Overrides the validator set to a
  // fast subset (Docs-Sync, Environment, API-Surface). Designed for husky/
  // lefthook hooks; expects to finish in under 2 seconds.
  if (flags.changedOnly) {
    config = { ...config, validators: liteValidatorsConfig() };
    console.log(`${c.cyan}⚡ docguard guard --changed-only${c.reset} ${c.dim}(running ${CHANGED_ONLY_VALIDATORS.length} fast validators only — pre-commit lite mode)${c.reset}\n`);
  }

  const data = runGuardInternal(projectDir, config);

  // ── JSON output ──
  if (flags.format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    // Use severity-aware effective counts for exit code; raw counts stay in the JSON
    // for display tools that want to show the full picture.
    if (data.effectiveErrors > 0) process.exit(1);
    if (data.effectiveWarnings > 0) process.exit(2);
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

    // Not applicable — nothing to validate. Render neutrally (NOT a green pass)
    // so the reader can tell "checked and clean" apart from "nothing checked".
    if (v.status === 'na') {
      const reason = v.note ? ` ${c.dim}(${v.note})${c.reset}` : ` ${c.dim}(nothing to validate)${c.reset}`;
      console.log(`  ${c.dim}➖ ${v.name}${c.reset} ${c.dim}[N/A]${c.reset}${reason}`);
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

    // --show-failing forces enumeration of every error/warning regardless of
    // overall validator status — useful when a validator passes overall
    // (passed < total) without surfacing the specific failing checks.
    const show = flags.verbose || flags.showFailing;
    if (show || v.status === 'fail') {
      for (const err of v.errors) {
        console.log(`     ${c.red}✗ ${err}${c.reset}`);
      }
    }
    if (show || v.status === 'warn') {
      for (const warn of v.warnings) {
        console.log(`     ${c.yellow}⚠ ${warn}${c.reset}`);
      }
    }
    // If a validator reports passed < total but has no errors/warnings, surface
    // the gap honestly so users aren't left wondering where the deficit went.
    if (v.status === 'pass' && v.total > v.passed && v.errors.length === 0 && v.warnings.length === 0) {
      const gap = v.total - v.passed;
      console.log(`     ${c.yellow}⚠ ${gap} check(s) did not pass but emitted no message — likely a validator bug. Please file an issue.${c.reset}`);
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
    const agentMode = detectAgentMode(projectDir);
    if (agentMode === 'llm') {
      console.log(`  ${c.dim}Use ${c.cyan}/docguard.diagnose${c.dim} to get AI fix prompts.${c.reset}`);
    } else {
      console.log(`  ${c.dim}Run ${c.cyan}docguard diagnose${c.dim} to get AI fix prompts.${c.reset}`);
    }
  }

  // Badge snippet
  const pct = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
  const bColor = pct >= 90 ? 'brightgreen' : pct >= 70 ? 'green' : pct >= 50 ? 'yellow' : 'red';
  const badgeUrl = `https://img.shields.io/badge/CDD_Guard-${data.passed}%2F${data.total}_passed-${bColor}`;
  console.log(`\n  ${c.dim}📎 Badge: ![CDD Guard](${badgeUrl})${c.reset}`);

  // Schema upgrade nudge — fires when the project's .docguard.json schema is
  // behind the CLI's CURRENT_SCHEMA_VERSION. Cheap, file-local check; no
  // network access. Suppressed in JSON output to keep machine consumers clean.
  if (!flags || flags.format !== 'json') {
    const upgradeHint = checkUpgradeStatus(projectDir);
    if (upgradeHint) {
      console.log(`\n  ${c.yellow}↑ ${upgradeHint}${c.reset}`);
    }

    // K-6 / S-2: sweep-needed nudge. Aggregates freshness warnings — if 2+
    // canonical docs are stale (matching the "X code commits since last doc
    // update" pattern), suggest a single `docguard sync --write` pass that
    // refreshes every code-truth section in one shot. Individual freshness
    // warnings already named the docs; this nudge just turns "5 warnings"
    // into one actionable recommendation.
    const freshness = data.validators.find(v => v.key === 'freshness');
    if (freshness && freshness.warnings) {
      const staleDocs = freshness.warnings.filter(w => /\d+ code commits since/.test(w));
      if (staleDocs.length >= 2) {
        console.log(`\n  ${c.yellow}↻ ${staleDocs.length} docs are stale (10+ commits since last update). Run ${c.cyan}docguard sync --write${c.yellow} to refresh code-truth sections in one pass.${c.reset}`);
      }
    }
  }

  // Spec-kit reminder — persistent nudge if not initialized
  if (!isSpecKitInitialized(projectDir)) {
    console.log(`\n  ${c.yellow}💡${c.reset} ${c.dim}Enhance DocGuard with Spec Kit: ${c.cyan}uv tool install specify-cli --from git+https://github.com/github/spec-kit.git${c.reset}`);
  }

  // When severity overrides demoted warnings to "low" (or promoted them to
  // "high"), show a one-line note so the user knows the exit code may not
  // match what they expected from reading the warning count.
  const severityShifted =
    data.effectiveErrors !== data.errors || data.effectiveWarnings !== data.warnings;
  if (severityShifted) {
    const upgraded = data.effectiveErrors - data.errors;
    const ignored = data.warnings - data.effectiveWarnings - upgraded;
    const parts = [];
    if (upgraded > 0) parts.push(`${upgraded} warning(s) escalated to fail (severity=high)`);
    if (ignored > 0) parts.push(`${ignored} warning(s) ignored for exit code (severity=low)`);
    if (parts.length > 0) {
      console.log(`\n  ${c.dim}Severity override: ${parts.join('; ')}.${c.reset}`);
    }
  }

  console.log('');

  // v0.5: severity-aware exit codes (see runGuardInternal for the rollup).
  if (data.effectiveErrors > 0) process.exit(1);
  if (data.effectiveWarnings > 0) process.exit(2);
  process.exit(0);
}
