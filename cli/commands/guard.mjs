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
import { changedFilesSince, isGitRepo } from '../shared-git.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath as fp } from 'node:url';
import { dirname as dn } from 'node:path';

// v0.17-P1: CLI version for version-pin checks (F8). Reproducibility for CDD —
// users can pin the docguard version their config was last validated against.
const _PKG = JSON.parse(readFileSync(resolvePath(dn(fp(import.meta.url)), '..', '..', 'package.json'), 'utf-8'));
const CLI_VERSION = _PKG.version;

/**
 * v0.17-P1: parse a semver-ish version string into a comparable tuple.
 * Tolerates trailing pre-release tags (`0.16.0-rc.1`). Returns null on garbage.
 */
function _parseSemver(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * v0.17-P1: returns +1 if a > b, 0 if equal, -1 if a < b. Unparseable
 * input sorts as equal (silent — never blocks a guard run).
 */
function _semverCompare(a, b) {
  const pa = _parseSemver(a);
  const pb = _parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * v0.17-P1: emit a "you're running a newer CLI than the config was pinned
 * against" nudge. Cheap, file-local check. Returns the nudge text or null.
 */
function _checkVersionPin(config) {
  const pinned = config.docguardVersion;
  if (!pinned) return null;
  const cmp = _semverCompare(CLI_VERSION, pinned);
  if (cmp > 0) {
    return `Running CLI v${CLI_VERSION} but config pins v${pinned}. ` +
      `New validators/rules may have appeared. Run \`docguard guard --pin\` to update the pin once you've reviewed any new findings.`;
  }
  if (cmp < 0) {
    return `Running CLI v${CLI_VERSION} but config pins v${pinned} (newer). ` +
      `Older CLI may be missing checks the config expects. Upgrade with \`npm i -g docguard-cli@latest\`.`;
  }
  return null;
}

/**
 * v0.17.1: small in-code highlight reel surfaced when a project's pinned
 * version is behind the running CLI. The biggest recurring user pattern is
 * "I asked for feature X" → "X shipped two releases ago". This eliminates
 * the need to grep the CHANGELOG. Keep entries short and command-oriented.
 *
 * Add to this table on every release. Format: [introducedIn, oneLineFeature].
 */
const _RELEASE_HIGHLIGHTS = [
  ['0.13.0', '`docguard sync --since <ref>` — surgical refresh of code-truth doc sections'],
  ['0.13.1', '`docguard impact --since <ref>` — changed files → affected canonical docs map'],
  ['0.13.1', '`Cross-Reference` validator + "did you mean #X?" hints for broken anchors'],
  ['0.14.1', '`docguard fix --write` auto-fixes high-confidence anchor matches'],
  ['0.15.0', '`docguard guard --timings` — per-validator wall-time profile'],
  ['0.15.0', '`.docguard.json` JSON Schema for VS Code autocomplete'],
  ['0.16.0', '`docguard explain "<warning>"` — paste any warning, get the validator help'],
  ['0.16.0', '`docguard guard --quiet` — suppress banner in hooks/CI'],
  ['0.16.0', '`docguard init --no-spec-kit` — opt out of Spec Kit scaffolding'],
  ['0.16.0', 'Language-aware test patterns (Python `test_*.py`, Rust `tests/*.rs`, Go `*_test.go`, ...)'],
  ['0.17.0', '`docguard memory --diff` — drill into accuracy mismatches (which claim ≠ code)'],
  ['0.17.0', '`docguard guard --pin` — record running CLI version into .docguard.json'],
];

function _whatsNewSince(pinnedVersion) {
  if (!pinnedVersion) return [];
  const out = [];
  for (const [introducedIn, feature] of _RELEASE_HIGHLIGHTS) {
    if (_semverCompare(introducedIn, pinnedVersion) > 0) {
      out.push(`v${introducedIn}: ${feature}`);
    }
  }
  return out;
}

/**
 * v0.17-P1: update the docguardVersion field in .docguard.json after a
 * successful guard run. Triggered by `docguard guard --pin`. Idempotent.
 */
function _updateVersionPin(projectDir) {
  const cfgPath = resolvePath(projectDir, '.docguard.json');
  if (!existsSync(cfgPath)) return { written: false, reason: '.docguard.json not found — run `docguard init` first' };
  let raw, cfg;
  try { raw = readFileSync(cfgPath, 'utf-8'); cfg = JSON.parse(raw); } catch (e) {
    return { written: false, reason: `could not parse .docguard.json: ${e.message}` };
  }
  if (cfg.docguardVersion === CLI_VERSION) {
    return { written: false, reason: `already pinned at v${CLI_VERSION}` };
  }
  const prev = cfg.docguardVersion || '(unset)';
  cfg.docguardVersion = CLI_VERSION;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  return { written: true, from: prev, to: CLI_VERSION };
}
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
import { validateGeneratedStaleness } from '../validators/generated-staleness.mjs';
import { validateTodoTracking } from '../validators/todo-tracking.mjs';
import { validateSchemaSync } from '../validators/schema-sync.mjs';
import { validateSpecKitIntegration } from '../validators/spec-kit.mjs';
import { validateCanonicalSync } from '../validators/canonical-sync.mjs';
import { validateSurfaceSync } from '../validators/surface-sync.mjs';

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
    { key: 'generatedStaleness', name: 'Generated-Staleness', fn: () => validateGeneratedStaleness(projectDir, config) },
    { key: 'surfaceSync', name: 'Surface-Sync', fn: () => validateSurfaceSync(projectDir, config) },
    // Metrics-Consistency runs post-loop (needs guard results)
  ];

  // v0.14-Q2: per-validator timing. Cheap (one `performance.now()` pair per
  // validator) and the data is what we'd need to optimize anything later.
  // Exposed via --profile in the public guard.
  for (const { key, name, fn } of validatorMap) {
    if (validators[key] === false) {
      results.push({ name, key, status: 'skipped', quality: null, errors: [], warnings: [], passed: 0, total: 0, durationMs: 0 });
      continue;
    }

    const start = performance.now();
    try {
      const result = fn();
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ ...result, name, key, durationMs, ...classifyResult(result) });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ name, key, status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
    }
  }

  // ── Canonical-Sync runs AFTER main loop, BEFORE metrics-consistency.
  //    Needs the live validator results to count "real" validators that ran.
  //    (Pre-canonical-sync ordering — comes before metrics-consistency so the
  //    metrics validator sees a stable surface count.)
  if (validators.canonicalSync !== false) {
    const start = performance.now();
    try {
      const result = validateCanonicalSync(projectDir, config, results);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ ...result, name: 'Canonical-Sync', key: 'canonicalSync', durationMs, ...classifyResult(result) });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ name: 'Canonical-Sync', key: 'canonicalSync', status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
    }
  }

  // ── Metrics-Consistency runs AFTER all other validators (needs their results) ──
  if (validators.metricsConsistency !== false) {
    const start = performance.now();
    try {
      const result = validateMetricsConsistency(projectDir, config, results);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ ...result, name: 'Metrics-Consistency', key: 'metricsConsistency', durationMs, ...classifyResult(result) });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ name: 'Metrics-Consistency', key: 'metricsConsistency', status: 'fail', quality: 'LOW', errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
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

  // The headline status word MUST agree with the exit code, which is
  // severity-aware (effectiveErrors/effectiveWarnings, computed above).
  // Deriving it from RAW counts was a bug: a validator marked severity=high
  // with only warnings printed "WARN" yet exited 1 (FAIL), and one marked
  // severity=low printed "WARN" yet exited 0 (PASS). Use effective counts so
  // what the user reads is what CI does.
  const overallStatus = effectiveErrors > 0 ? 'FAIL' : effectiveWarnings > 0 ? 'WARN' : 'PASS';

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
export const CHANGED_ONLY_VALIDATORS = ['docsSync', 'environment', 'apiSurface', 'drift', 'todoTracking'];

/**
 * Build a validators map that enables the pre-commit-lite set — PLUS any
 * validator the team explicitly escalated to `severity: high`.
 * Used by `docguard guard --changed-only`.
 *
 * Why the union: `--changed-only` trades coverage for speed, but a
 * `severity: high` override is an explicit "this must always block CI" signal.
 * Silently dropping such a validator here meant a changed-only gate could pass
 * (exit 0) on exactly the drift the team most wanted blocked — e.g. a committed
 * secret when `security` is marked high. So high-severity validators are forced
 * on regardless of the lite set, unless the user also explicitly disabled them.
 */
export function liteValidatorsConfig(config = {}) {
  const all = [
    'structure', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment',
    'security', 'architecture', 'freshness', 'traceability', 'docsDiff',
    'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking',
    'schemaSync', 'specKit', 'crossReference', 'generatedStaleness',
    'canonicalSync', 'metricsConsistency',
  ];
  const userValidators = (config && config.validators) || {};
  const out = {};
  for (const k of all) {
    let enabled = CHANGED_ONLY_VALIDATORS.includes(k);
    if (!enabled && resolveSeverity(config, k) === 'high' && userValidators[k] !== false) {
      enabled = true;
    }
    out[k] = enabled;
  }
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
    // Compute the set of changed files since the given ref (default HEAD~1 —
    // the pre-commit common case: "files changed in this commit vs the last
    // committed state"). Validators that opt into `config.changedFiles` can
    // scope to this list; others run normally over the whole tree.
    const ref = flags.since || 'HEAD~1';
    const changed = isGitRepo(projectDir) ? changedFilesSince(projectDir, ref) : [];
    const liteVals = liteValidatorsConfig(config);
    // Validators that ran beyond the lite set because they're severity=high.
    const escalated = Object.keys(liteVals).filter(
      k => liteVals[k] && !CHANGED_ONLY_VALIDATORS.includes(k)
    );
    config = {
      ...config,
      validators: liteVals,
      changedFiles: changed,
      changedSinceRef: ref,
    };
    const label = changed.length > 0
      ? `${changed.length} file(s) changed since ${ref}`
      : `no changes since ${ref} — running all ${CHANGED_ONLY_VALIDATORS.length} lite validators on full tree`;
    const escalatedNote = escalated.length > 0
      ? ` ${c.yellow}+ ${escalated.length} high-severity validator(s): ${escalated.join(', ')}${c.reset}`
      : '';
    console.log(`${c.cyan}⚡ docguard guard --changed-only${c.reset} ${c.dim}(${label})${c.reset}${escalatedNote}\n`);
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
    // PASS can still carry raw warnings if a validator was demoted to
    // severity=low — surface that honestly rather than claiming a clean sweep.
    if (data.warnings > 0) {
      console.log(`  ${c.green}${c.bold}✅ PASS${c.reset} ${c.green}— ${data.passed}/${data.total} passed (${data.warnings} non-blocking warning(s))${c.reset}`);
    } else {
      console.log(`  ${c.green}${c.bold}✅ PASS${c.reset} ${c.green}— All ${data.total} checks passed${c.reset}`);
    }
  } else if (data.status === 'WARN') {
    // effective* counts are what drove the verdict; raw warnings are still
    // enumerated per-validator above, so nothing is hidden.
    console.log(`  ${c.yellow}${c.bold}⚠️  WARN${c.reset} ${c.yellow}— ${data.passed}/${data.total} passed, ${data.effectiveWarnings} warning(s)${c.reset}`);
  } else {
    // effectiveErrors may include warnings escalated by severity=high, so call
    // them "blocking issue(s)" rather than "error(s)". The severity-override
    // note below spells out any escalation/demotion.
    const warnSuffix = data.effectiveWarnings > 0 ? `, ${data.effectiveWarnings} warning(s)` : '';
    console.log(`  ${c.red}${c.bold}❌ FAIL${c.reset} ${c.red}— ${data.passed}/${data.total} passed, ${data.effectiveErrors} blocking issue(s)${warnSuffix}${c.reset}`);
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

  // v0.14-Q2: --timings prints per-validator timing, sorted slowest-first.
  // Designed for self-diagnosis on slow repos: shows exactly which validator
  // to optimize first. Cheap to opt into; off by default to keep output clean.
  // (Originally proposed as `--profile` but that flag is taken by `init`.)
  if (flags.timings) {
    console.log(`\n  ${c.bold}⏱  Profile${c.reset} ${c.dim}(per-validator wall time, slowest first)${c.reset}`);
    const timed = data.validators
      .filter(v => typeof v.durationMs === 'number' && v.status !== 'skipped')
      .sort((a, b) => b.durationMs - a.durationMs);
    const total = timed.reduce((sum, v) => sum + v.durationMs, 0);
    for (const v of timed.slice(0, 10)) {
      const pct = total > 0 ? Math.round((v.durationMs / total) * 100) : 0;
      const bar = '▇'.repeat(Math.max(1, Math.round(pct / 5)));
      console.log(`     ${v.durationMs.toFixed(1).padStart(7)}ms  ${pct.toString().padStart(2)}%  ${bar.padEnd(20)} ${v.name}`);
    }
    if (timed.length > 10) console.log(`     ${c.dim}... ${timed.length - 10} faster validators omitted${c.reset}`);
    console.log(`     ${c.dim}─────────${c.reset}`);
    console.log(`     ${c.bold}${total.toFixed(1).padStart(7)}ms${c.reset}  ${c.dim}total validator time${c.reset}`);
  }

  // Schema upgrade nudge — fires when the project's .docguard.json schema is
  // behind the CLI's CURRENT_SCHEMA_VERSION. Cheap, file-local check; no
  // network access. Suppressed in JSON output to keep machine consumers clean.
  if (!flags || flags.format !== 'json') {
    const upgradeHint = checkUpgradeStatus(projectDir);
    if (upgradeHint) {
      console.log(`\n  ${c.yellow}↑ ${upgradeHint}${c.reset}`);
    }

    // v0.17-P1: version-pin nudge. When .docguard.json carries a
    // docguardVersion field and the running CLI doesn't match, emit a
    // one-line note. Keeps CDD reproducibility honest — "same project,
    // same docs, different score across versions" no longer silent.
    const pinHint = _checkVersionPin(config);
    if (pinHint) {
      console.log(`\n  ${c.yellow}📌 ${pinHint}${c.reset}`);
      // v0.17.1: surface features added since the pinned version so users
      // who pinned at v0.12 and just upgraded actually KNOW about sync,
      // impact, explain, memory --diff, etc. The biggest user complaint
      // pattern is "I asked for X but X already shipped two releases ago."
      const whatsNew = _whatsNewSince(config.docguardVersion);
      if (whatsNew.length > 0) {
        console.log(`  ${c.dim}New since v${config.docguardVersion}:${c.reset}`);
        for (const item of whatsNew.slice(0, 5)) {
          console.log(`    ${c.dim}• ${item}${c.reset}`);
        }
        if (whatsNew.length > 5) console.log(`    ${c.dim}... ${whatsNew.length - 5} more in CHANGELOG.md${c.reset}`);
      }
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

  // v0.17-P1: --pin updates docguardVersion in .docguard.json to the running
  // CLI version. Only meaningful AFTER a clean (or near-clean) guard run —
  // pinning to a version that just failed defeats the reproducibility goal.
  // We allow pinning when status is PASS or WARN; refuse on FAIL.
  if (flags.pin) {
    if (data.status === 'FAIL') {
      console.log(`  ${c.red}✗ Cannot --pin after a FAIL run.${c.reset} Fix the errors first, then retry.`);
    } else {
      const r = _updateVersionPin(projectDir);
      if (r.written) {
        console.log(`  ${c.green}📌 docguardVersion pinned: ${r.from} → ${r.to}${c.reset}`);
      } else {
        console.log(`  ${c.dim}📌 ${r.reason}${c.reset}`);
      }
    }
    console.log('');
  }

  // v0.5: severity-aware exit codes (see runGuardInternal for the rollup).
  if (data.effectiveErrors > 0) process.exit(1);
  if (data.effectiveWarnings > 0) process.exit(2);
  process.exit(0);
}
