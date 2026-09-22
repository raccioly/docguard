import { describeCheckCoverage, summarizeCheckCoverage } from '../validator-coverage.mjs';
import { applyDocRoles } from '../shared-doc-roles.mjs';
/**
 * @implements docguard.evidence-scoped-verification#FR-010
 * Guard Command — Validate project against its canonical documentation
 * Runs all enabled validators and reports results.
 *
 * Two modes:
 *   runGuard()         → prints to console, exits with code
 *   runGuardInternal() → returns data, no side effects (for diagnose, ci)
 */

import { c, resolveSeverity, resolveFindingEnforcement, loadIgnorePatterns, resolveDocDirs } from '../shared.mjs';
import { walkFiles, buildIgnoreFilter } from '../shared-ignore.mjs';
import { CODES, mkFinding, resultFromFindings } from '../findings.mjs';
import { loadValidatorSuppressions } from '../validator-markers.mjs';
import { detectAgentMode, isSpecKitInitialized } from '../ensure-skills.mjs';
import { checkUpgradeStatus } from './upgrade.mjs';
import { changedFilesSince, isGitRepo } from '../shared-git.mjs';
import { extractSemanticClaims } from '../scanners/semantic-claims.mjs';
import { toSarif } from '../writers/sarif.mjs';
import { toJUnit } from '../writers/junit.mjs';
import { loadBaseline, saveBaseline, fingerprintFinding, BASELINE_FILE } from '../writers/baseline.mjs';
import { precisionEvidenceBlock } from '../precision-evidence.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, relative as relativePath } from 'node:path';
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
// v0.31.0 change-driven + smell detectors
import { validateDiffSuspicion } from '../validators/diff-suspicion.mjs';
import { validateReferenceExistence } from '../validators/reference-existence.mjs';
import { validateApiDocSmells } from '../validators/api-doc-smells.mjs';
import { validateDocumentLifecycle } from '../validators/document-lifecycle.mjs';
import { validateSpecRegistry } from '../validators/spec-registry.mjs';
import { validateEvidence } from '../validators/evidence.mjs';
import { coverSemanticClaims } from '../evidence/evaluate.mjs';

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

/**
 * v0.27: the list of issues to render for a validator. Prefers structured
 * findings (code + confidence + suggestion) when present; otherwise maps the
 * legacy error/warning strings into the same shape so the renderer is uniform.
 */
function renderableItems(v) {
  if (Array.isArray(v.findings) && v.findings.length > 0) {
    return v.findings.map((f) => ({
      severity: f.severity,
      effectiveSeverity: f.effectiveSeverity || f.severity,
      message: f.message,
      code: f.code,
      confidence: f.confidence,
      suggestion: f.suggestion,
    }));
  }
  return [
    ...(v.errors || []).map((m) => ({ severity: 'error', message: m })),
    ...(v.warnings || []).map((m) => ({ severity: 'warn', message: m })),
  ];
}

// ── Doc coverage map (v0.29) ──────────────────────────────────────────────────
// Field report #6, Gap 1: only allow-listed docs were ever validated, so a new
// .md could drift forever while guard stayed green — the human had to REMEMBER to
// enroll each doc, which is exactly the step that fails silently. We deliberately
// do NOT deep-scan every doc for claims (that floods false positives — see the
// downstream-project scar in metrics-consistency). Instead we cheaply report what's
// under a validation tier and what isn't, turning silent non-coverage into a
// visible nudge. Pure visibility — never gates the build.
//
// DocGuard's OWN installed slash-command docs are tool-managed, not the project's
// docs — counting them as "untracked drift" is noise the user can't act on.
const DOCGUARD_OWN_DOC_RE = /(^|\/)commands\/docguard\.[a-z-]+\.md$/i;

function collectMarkdown(projectDir) {
  const out = [];
  // Shared canonical walker (v0.29 consolidation) — same ignore set and dot-entry
  // skipping as every other validator, instead of a private IGNORE_DIRS copy.
  walkFiles(projectDir, (full) => {
    if (full.toLowerCase().endsWith('.md')) {
      out.push(relativePath(projectDir, full).replace(/\\/g, '/'));
    }
  });
  return out;
}

/**
 * Classify every discoverable Markdown file into a validation tier:
 *   canonical    — in requiredFiles.canonical (structure + review-gated)
 *   tracked      — inventoried under a doc home or at root; individual detector scopes differ
 *   ignored      — matched by .docguardignore
 *   unclassified — under NO tier; drift here is invisible (the Gap-1 trap)
 */
function computeDocCoverage(projectDir, config) {
  const fileIgnored = loadIgnorePatterns(projectDir);
  const configIgnored = buildIgnoreFilter(config.ignore || []);
  const isIgnored = path => fileIgnored(path) || configIgnored(path);
  const canonical = new Set(
    ((config.requiredFiles && config.requiredFiles.canonical) || []).map(p => p.replace(/\\/g, '/'))
  );
  // Any path declared in documentTypes is a KNOWN doc (even if optional) — not
  // "untracked." This keeps the warning specific to genuinely-unenrolled files.
  const known = new Set(Object.keys(config.documentTypes || {}).map(p => p.replace(/\\/g, '/')));
  // This is a document inventory, not a claim that every detector checks
  // each tracked file. Keep individual check coverage separate.
  const docHomePrefixes = resolveDocDirs(projectDir, config).map(d => d.replace(/\/?$/, '/'));
  const all = collectMarkdown(projectDir);
  let canonicalCount = 0, tracked = 0, ignored = 0;
  const unclassified = [];
  for (const rel of all) {
    if (isIgnored(rel) || DOCGUARD_OWN_DOC_RE.test(rel)) { ignored++; continue; }
    if (canonical.has(rel)) { canonicalCount++; continue; }
    const inHome = docHomePrefixes.some(h => rel.startsWith(h));
    const atRoot = !rel.includes('/');
    if (inHome || atRoot || known.has(rel)) { tracked++; continue; }
    unclassified.push(rel);
  }
  return { discovered: all.length, canonical: canonicalCount, tracked, ignored, unclassified };
}

export function runGuardInternal(projectDir, config) {
  config = applyDocRoles(projectDir, config);
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
      // v0.29: adapter now emits structured findings (FRS001–FRS005). The
      // validator keeps its array-of-{status, code, doc, message} contract;
      // messages describe review signals rather than asserting semantic drift.
      const freshnessResults = validateFreshness(projectDir, config);
      const findings = [];
      let passed = 0;
      for (const r of freshnessResults) {
        if (r.status === 'pass') { passed++; continue; }
        if (r.status !== 'warn' && r.status !== 'fail') continue; // skip entries
        findings.push(mkFinding({
          code: r.code || null,
          validator: 'freshness',
          severity: r.status === 'fail' ? 'error' : 'warn',
          confidence: r.confidence || 'low',
          disposition: r.disposition || 'escalate',
          message: r.message,
          location: r.doc || null,
          suggestion: r.suggestion || { kind: 'review', text: 'Review the document against its intended scope. A history signal does not establish which side should change.' },
        }));
      }
      const skipped = freshnessResults.filter(r => r.status === 'skip');
      return { ...resultFromFindings(findings, { passed, total: passed + findings.length }), ...(passed + findings.length === 0 && skipped.length ? { applicability: { status: 'no-matches', reason: skipped.map(r => r.message).join('; ') } } : {}) };
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
    { key: 'documentLifecycle', name: 'Document-Lifecycle', fn: () => validateDocumentLifecycle(projectDir, config) },
    { key: 'specRegistry', name: 'Spec-Registry', fn: () => validateSpecRegistry(projectDir, config) },
    { key: 'evidence', name: 'Evidence', fn: () => validateEvidence(projectDir, config) },
    { key: 'crossReference', name: 'Cross-Reference', fn: () => validateCrossReferences(projectDir, config) },
    { key: 'generatedStaleness', name: 'Generated-Staleness', fn: () => validateGeneratedStaleness(projectDir, config) },
    { key: 'surfaceSync', name: 'Surface-Sync', fn: () => validateSurfaceSync(projectDir, config) },
    // v0.31.0 — change-driven + smell detectors (all confidence:low / soft).
    { key: 'diffSuspicion', name: 'Diff-Suspicion', fn: () => validateDiffSuspicion(projectDir, config) },
    { key: 'referenceExistence', name: 'Reference-Existence', fn: () => validateReferenceExistence(projectDir, config) },
    { key: 'apiDocSmells', name: 'API-Doc-Smells', fn: () => validateApiDocSmells(projectDir, config) },
    // Metrics-Consistency runs post-loop (needs guard results)
  ];

  // Inline `<!-- docguard:validator <key> n/a — reason -->` markers let a
  // project declare a whole validator non-applicable, visibly and in-repo
  // (e.g. a POC marking testSpec/traceability N/A). Distinct from the config
  // `validators:{k:false}` switch: a marked validator renders as ➖ [N/A] with
  // its reason, not a silent skip. Resolve once against the full key set.
  const allValidatorKeys = [...new Set(validatorMap.map(v => v.key)), 'canonicalSync', 'metricsConsistency'];
  const { suppressed: naMarkers, unknown: unknownMarkers } = loadValidatorSuppressions(projectDir, allValidatorKeys);
  const naResult = (name, key) => ({
    name, key, status: 'na', quality: null, errors: [], warnings: [], passed: 0, total: 0, durationMs: 0,
    note: naMarkers.get(key) ? `declared N/A: ${naMarkers.get(key)}` : 'declared N/A',
  });

  // v0.14-Q2: per-validator timing. Cheap (one `performance.now()` pair per
  // validator) and the data is what we'd need to optimize anything later.
  // Exposed via --profile in the public guard.
  for (const { key, name, fn } of validatorMap) {
    if (naMarkers.has(key)) {
      results.push(naResult(name, key));
      continue;
    }
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
      results.push({ name, key, status: 'fail', quality: 'LOW', applicability: { status: 'error', reason: 'Validator could not complete: ' + err.message }, errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
    }
  }

  // ── Canonical-Sync runs AFTER main loop, BEFORE metrics-consistency.
  //    Needs the live validator results to count "real" validators that ran.
  //    (Pre-canonical-sync ordering — comes before metrics-consistency so the
  //    metrics validator sees a stable surface count.)
  if (naMarkers.has('canonicalSync')) {
    results.push(naResult('Canonical-Sync', 'canonicalSync'));
  } else if (validators.canonicalSync !== false) {
    const start = performance.now();
    try {
      const result = validateCanonicalSync(projectDir, config, results);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ ...result, name: 'Canonical-Sync', key: 'canonicalSync', durationMs, ...classifyResult(result) });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ name: 'Canonical-Sync', key: 'canonicalSync', status: 'fail', quality: 'LOW', applicability: { status: 'error', reason: 'Validator could not complete: ' + err.message }, errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
    }
  }

  // ── Metrics-Consistency runs AFTER all other validators (needs their results) ──
  if (naMarkers.has('metricsConsistency')) {
    results.push(naResult('Metrics-Consistency', 'metricsConsistency'));
  } else if (validators.metricsConsistency !== false) {
    const start = performance.now();
    try {
      const result = validateMetricsConsistency(projectDir, config, results);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ ...result, name: 'Metrics-Consistency', key: 'metricsConsistency', durationMs, ...classifyResult(result) });
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({ name: 'Metrics-Consistency', key: 'metricsConsistency', status: 'fail', quality: 'LOW', applicability: { status: 'error', reason: 'Validator could not complete: ' + err.message }, errors: [err.message], warnings: [], passed: 0, total: 1, durationMs });
    }
  }

  // ── Adoption baseline (v0.33) ──
  // If the repo committed `.docguard.baseline.json`, findings frozen at
  // adoption time are suppressed BEFORE any tally — so exit codes, severity
  // rollups, json/sarif/junit, ci, and report all gate only NEW drift.
  // Suppression is visible (baselineSuppressed in the payload + a display
  // note), applies only to findings-backed results (legacy string-only
  // errors/warnings can't be fingerprinted), and `--no-baseline`
  // (config.baseline === false) turns it off.
  let baselineSuppressed = 0;
  const baselineMap = config.baseline === false ? null : loadBaseline(projectDir);
  if (baselineMap) {
    // Occurrence budget: each fingerprint suppresses at most its frozen
    // count (H2). Validators run in a fixed order, so consumption is
    // deterministic — the same tree always suppresses the same instances.
    const remaining = new Map(baselineMap);
    for (const r of results) {
      if (!Array.isArray(r.findings) || r.findings.length === 0) continue;
      if (r.errors.length + r.warnings.length !== r.findings.length) continue;
      const kept = r.findings.filter(f => {
        const fp = fingerprintFinding(f);
        const budget = remaining.get(fp) || 0;
        if (budget <= 0) return true;
        remaining.set(fp, budget - 1);
        return false;
      });
      const removed = r.findings.length - kept.length;
      if (removed === 0) continue;
      baselineSuppressed += removed;
      r.findings = kept;
      r.errors = kept.filter(f => f.severity === 'error').map(f => f.message);
      r.warnings = kept.filter(f => f.severity !== 'error').map(f => f.message);
      r.total = r.passed + kept.length;
      Object.assign(r, classifyResult(r));
    }
  }

  for (const key of ['canonicalSync', 'metricsConsistency']) {
    if (validators[key] === false && !results.some(r => r.key === key)) results.push({ key, name: key === 'canonicalSync' ? 'Canonical-Sync' : 'Metrics-Consistency', status: 'skipped', quality: null, errors: [], warnings: [], passed: 0, total: 0, durationMs: 0 });
  }
  for (const result of results) result.applicability = describeCheckCoverage(projectDir, config, result);
  const checkCoverage = summarizeCheckCoverage(results);
  const activeResults = results.filter(r => r.status !== 'skipped');
  const totalErrors = activeResults.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = activeResults.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalPassed = activeResults.reduce((sum, r) => sum + r.passed, 0);
  const totalChecks = activeResults.reduce((sum, r) => sum + r.total, 0);

  // Compute enforcement after baseline suppression. Structured findings can
  // be reweighted by exact stable code; legacy validators retain the existing
  // per-validator behavior. Preserve intrinsic severity for auditability.
  for (const v of activeResults) {
    v.severity = resolveSeverity(config, v.key);
    let errors = 0, warnings = 0, infos = 0;
    if (Array.isArray(v.findings) && v.findings.length > 0) {
      for (const finding of v.findings) {
        const enforcement = resolveFindingEnforcement(config, finding, v.key);
        finding.effectiveSeverity = enforcement.level;
        finding.enforcement = enforcement;
        if (enforcement.level === 'error') errors++;
        else if (enforcement.level === 'warn') warnings++;
        else infos++;
      }
    } else {
      errors = v.errors.length;
      if (v.severity === 'high') errors += v.warnings.length;
      else if (v.severity === 'medium') warnings = v.warnings.length;
      else infos = v.warnings.length;
    }
    v.effectiveErrors = errors;
    v.effectiveWarnings = warnings;
    v.effectiveInfos = infos;
    v.effectiveStatus = errors > 0 ? 'fail' : warnings > 0 ? 'warn' : v.status === 'na' ? 'na' : 'pass';
  }
  const effectiveErrors = activeResults.reduce((sum, v) => sum + v.effectiveErrors, 0);
  const effectiveWarnings = activeResults.reduce((sum, v) => sum + v.effectiveWarnings, 0);
  const effectiveInfos = activeResults.reduce((sum, v) => sum + v.effectiveInfos, 0);

  // The headline status word MUST agree with the exit code, which is
  // severity-aware (effectiveErrors/effectiveWarnings, computed above).
  // Deriving it from RAW counts was a bug: a validator marked severity=high
  // with only warnings printed "WARN" yet exited 1 (FAIL), and one marked
  // severity=low printed "WARN" yet exited 0 (PASS). Use effective counts so
  // what the user reads is what CI does.
  const overallStatus = effectiveErrors > 0 ? 'FAIL' : effectiveWarnings > 0 ? 'WARN' : 'PASS';

  // v0.27: stable, LLM-addressable contract. `findings` is the flattened,
  // structured view (those validators that emit it); `reportable` are the
  // low-confidence ones the feedback loop offers to report; `nextStep` is the
  // single machine hint so an agent in a hook never has to parse prose.
  const allFindings = activeResults.flatMap((r) => (Array.isArray(r.findings) ? r.findings : []));
  const reportable = allFindings.filter((f) => f.reportable);
  const nextStep =
    overallStatus === 'PASS' ? null : 'docguard diagnose';

  // v0.29: coverage map + semantic-claim surfacing. Both are pure visibility —
  // they never change errors/warnings/exit code. Skipped on the --changed-only
  // lite path, which trades coverage for sub-2s speed and shouldn't pay for a
  // repo-wide Markdown walk.
  const lite = Array.isArray(config.changedFiles);
  let coverage = null;
  let semanticClaims = null;
  const evidence = results.find(result => result.key === 'evidence')?.evidence || null;
  if (!lite) {
    try { coverage = computeDocCoverage(projectDir, config); } catch { coverage = null; }
    try {
      const claims = extractSemanticClaims(projectDir, config);
      const scoped = coverSemanticClaims(claims, evidence);
      semanticClaims = { count: scoped.unverified, discovered: scoped.total, verifiedWithinScope: scoped.verifiedWithinScope, coveredClaimIds: scoped.covered };
    }
    catch { semanticClaims = null; }
  }

  return {
    project: config.projectName,
    profile: config.profile || 'standard',
    status: overallStatus,
    passed: totalPassed,
    total: totalChecks,
    errors: totalErrors,
    warnings: totalWarnings,
    findings: allFindings,
    reportable,
    nextStep,
    // v0.5: severity-aware counts for exit-code logic. The display still uses
    // the raw counts above so users see every warning, but CI only fails on
    // things they've marked as high-severity.
    effectiveErrors,
    effectiveWarnings,
    effectiveInfos,
    baselineSuppressed,
    coverage,
    checkCoverage,
    semanticClaims,
    evidence,
    // Benchmark evidence for the codes this run actually emitted. Codes the
    // corpus never exercised say so; none inherits another code's measurement.
    precisionEvidence: precisionEvidenceBlock(allFindings.map(f => f.code), CLI_VERSION),
    validators: results,
    // Unknown keys in `docguard:validator … n/a` markers — typo protection so
    // a mistyped key doesn't silently fail to suppress. Surfaced by runGuard.
    validatorMarkerWarnings: unknownMarkers.map(
      u => `Unknown validator key "${u.raw}" in a docguard:validator marker — ignored. Valid keys: ${allValidatorKeys.join(', ')}`
    ),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validator states that mean DocGuard could NOT check what it was asked to.
 *
 * `no-matches` is deliberately absent: a validator that ran and found nothing
 * applicable did its job completely. `disabled` and `not-applicable` are
 * choices the project made, not gaps.
 * @implements docguard.calibrated-finding-channels#FR-020
 */
export const INCOMPLETE_COVERAGE_STATES = Object.freeze(['partial', 'missing-prerequisite', 'unsupported', 'error']);

/** How many active validators could not complete their checks. */
export function incompleteCoverage(checkCoverage) {
  if (!checkCoverage || !checkCoverage.counts) return 0;
  return INCOMPLETE_COVERAGE_STATES.reduce((sum, key) => sum + (checkCoverage.counts[key] || 0), 0);
}

/**
 * Badge colour for a run.
 *
 * `passed/total` counts CHECKS, and its denominator excludes every validator
 * that could not run — so a run can print 100% while part of the project went
 * unexamined. The summary says so in prose, but the badge is the artifact that
 * travels into a README without the prose.
 *
 * The cap is `green`, not `yellow`, and the distinction matters: a partial run
 * is not a failing run, since everything that ran passed. `yellow` would be
 * wrong, and would train readers to ignore the badge on any project that
 * legitimately has no API reference. `brightgreen` claims everything is fine,
 * which a run that could not read its Python imports cannot support.
 * `green` says: passed, with a caveat.
 *
 * @param {number} pct passed/total as a percentage
 * @param {number} incomplete active validators that could not complete
 * @implements docguard.calibrated-finding-channels#FR-020
 */
export function badgeColor(pct, incomplete = 0) {
  if (pct >= 90) return incomplete > 0 ? 'green' : 'brightgreen';
  if (pct >= 70) return 'green';
  return pct >= 50 ? 'yellow' : 'red';
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
export const CHANGED_ONLY_VALIDATORS = ['docsSync', 'environment', 'apiSurface', 'drift', 'todoTracking', 'evidence'];

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
    'canonicalSync', 'surfaceSync', 'metricsConsistency', 'documentLifecycle',
    'specRegistry', 'diffSuspicion', 'referenceExistence', 'apiDocSmells',
    'evidence',
  ];
  const userValidators = (config && config.validators) || {};
  const exactHighValidators = new Set(
    Object.entries(config.findingSeverity || {})
      .filter(([, level]) => typeof level === 'string' && level.toLowerCase() === 'high')
      .map(([code]) => CODES[code.toUpperCase()]?.validator)
      .filter(Boolean)
  );
  const out = {};
  for (const k of all) {
    let enabled = CHANGED_ONLY_VALIDATORS.includes(k);
    if (!enabled && (resolveSeverity(config, k) === 'high' || exactHighValidators.has(k)) && userValidators[k] !== false) {
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

  // ── `--update-baseline`: freeze the CURRENT full finding set ──
  // Runs with the baseline disabled so the file captures everything visible
  // today (updating through an active baseline would only ever shrink it).
  if (flags.updateBaseline) {
    // --changed-only rewrites config.validators to the 5-validator lite set;
    // freezing THAT would silently shrink the committed team baseline to a
    // subset (L1). Refuse the combination rather than corrupt the file.
    if (flags.changedOnly) {
      console.error(`${c.red}✗ --update-baseline cannot be combined with --changed-only — the baseline must freeze the FULL validator set, not the pre-commit lite subset.${c.reset}`);
      process.exitCode = 1;
      return;
    }
    const fullData = runGuardInternal(projectDir, { ...config, baseline: false });
    const n = saveBaseline(projectDir, fullData.findings || []);
    if (flags.format === 'json') {
      process.stdout.write(JSON.stringify({ written: true, file: BASELINE_FILE, fingerprints: n, findings: (fullData.findings || []).length }, null, 2) + '\n');
    } else {
      console.log(`${c.green}✅ Baseline written:${c.reset} ${BASELINE_FILE} (${n} fingerprint(s))`);
      console.log(`${c.dim}   Commit it. guard/ci now gate only NEW findings; --no-baseline shows everything.${c.reset}`);
    }
    process.exitCode = 0;
    return;
  }

  const data = runGuardInternal(projectDir, config);

  // A project with no .docguard.json has not adopted DocGuard. Its "failures"
  // are missing canonical docs, which is not the same fact as "this project
  // failed its checks" — and consumers need to tell them apart. Exit 3 says
  // "not initialised": still non-zero, so a CI gate that fails on any non-zero
  // status is unchanged, but the generated Git hook can let the commit through
  // instead of blocking a project that never adopted the tool.
  const uninitialised = !existsSync(resolvePath(projectDir, '.docguard.json'));
  const exitFor = d => (d.effectiveErrors > 0
    ? (uninitialised ? 3 : 1)
    : d.effectiveWarnings > 0 ? 2 : 0);

  // ── SARIF output (2.1.0) ──
  // Same flush discipline as the JSON branch below (bug-105): set exitCode and
  // write+return so a piped consumer never gets a truncated payload.
  if (flags.format === 'sarif') {
    const sarif = toSarif(data, { projectDir });
    process.exitCode = exitFor(data);
    process.stdout.write(JSON.stringify(sarif, null, 2) + '\n');
    return;
  }

  // ── JUnit XML output ──
  // SARIF is GitHub's language; JUnit is everyone else's (GitLab
  // artifacts:reports:junit, Jenkins junit step, Azure DevOps, CircleCI).
  // Exit-code semantics identical to sarif/json.
  if (flags.format === 'junit') {
    const xml = toJUnit(data);
    process.exitCode = exitFor(data);
    process.stdout.write(xml + '\n');
    return;
  }

  // ── JSON output ──
  if (flags.format === 'json') {
    // Use severity-aware effective counts for exit code; raw counts stay in the JSON
    // for display tools that want to show the full picture.
    const code = exitFor(data);
    // v0.28: set exitCode + return instead of process.exit(). A large JSON
    // payload (>~8 KB) written to a PIPE flushes asynchronously; an immediate
    // process.exit() truncates it mid-string, so a CI consumer parsing stdout
    // gets "Unterminated string in JSON" on exactly the big reports that matter.
    // Returning lets Node drain stdout and exit naturally with process.exitCode.
    process.exitCode = code;
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
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
      const showReason = flags.verbose || ['unsupported', 'partial', 'missing-prerequisite', 'error'].includes(v.applicability.status);
      const reason = showReason ? ` ${c.dim}(${v.applicability.reason})${c.reset}` : '';
      console.log(`  ${c.dim}➖ ${v.name}${c.reset} ${c.dim}[${v.applicability.status}]${c.reset}${reason}`);
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
    if (v.requirementCoverage?.deferred > 0) {
      console.log(`     ${c.dim}${v.requirementCoverage.deferred} planned requirement(s) deferred by reviewed lifecycle${c.reset}`);
    }

    // --show-failing forces enumeration of every error/warning regardless of
    // overall validator status — useful when a validator passes overall
    // (passed < total) without surfacing the specific failing checks.
    const show = flags.verbose || flags.showFailing;
    const showErr = show || v.status === 'fail';
    const showWarn = show || v.status === 'warn';
    // v0.27: render from structured findings when the validator emits them
    // (each issue carries a code, confidence, and a `→ suggestion`); otherwise
    // fall back to the legacy error/warning strings. Identical gating.
    for (const item of renderableItems(v)) {
      if (item.severity === 'error' && !showErr) continue;
      if (item.severity === 'warn' && !showWarn) continue;
      const effective = item.effectiveSeverity || item.severity;
      const mark = effective === 'error' ? `${c.red}✗` : effective === 'info' ? `${c.cyan}•` : `${c.yellow}⚠`;
      const codeTag = item.code ? `${c.dim}[${item.code}]${c.reset} ` : '';
      // Two distinct annotations, because they answer different questions.
      // `low confidence` = the detector may have misread its input.
      // `review` = the detector read its input correctly and the judgement is
      // yours. A finding can be neither, either, or both.
      const conf = item.confidence === 'low'
        ? ` ${c.dim}(low confidence — possible false positive)${c.reset}` : '';
      const disp = item.disposition === 'escalate' && item.confidence !== 'low'
        ? ` ${c.dim}(review — signal, not a verdict)${c.reset}` : '';
      console.log(`     ${mark} ${codeTag}${item.message}${c.reset}${conf}${disp}`);
      if (item.suggestion?.text) {
        console.log(`       ${c.cyan}→${c.reset} ${c.dim}${item.suggestion.text}${c.reset}`);
        if (item.suggestion.command) {
          console.log(`         ${c.cyan}${item.suggestion.command}${c.reset}`);
        } else if (item.suggestion.pragma) {
          console.log(`         ${c.dim}${item.suggestion.pragma}${c.reset}`);
        }
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

  // Baseline suppression is always visible — a gate that hides findings
  // silently is the false-green failure mode this tool exists to prevent.
  if (data.baselineSuppressed > 0) {
    console.log(`  ${c.dim}📋 ${data.baselineSuppressed} pre-existing finding(s) suppressed by ${BASELINE_FILE} (--no-baseline to show)${c.reset}`);
  }

  // Act vs escalate, immediately under the verdict: the verdict says whether
  // CI blocks, this says what the work actually is. Severity alone cannot
  // express it — a blocking error can still be an escalation.
  if (Array.isArray(data.findings) && data.findings.length > 0) {
    const act = data.findings.filter(f => f.disposition === 'act').length;
    const escalate = data.findings.length - act;
    const parts = [];
    if (act > 0) parts.push(`${c.cyan}${act} to fix${c.reset}${c.dim}`);
    if (escalate > 0) parts.push(`${c.yellow}${escalate} to review${c.reset}${c.dim}`);
    console.log(`  ${c.dim}${parts.join(' · ')} ${c.reset}${c.dim}(fix = DocGuard names the correction; review = the judgement is yours)${c.reset}`);
  }

  // ── Next steps — every run ends with a suggested action (v0.27) ──
  // The field-report principle: whenever DocGuard calls out an issue it must
  // suggest what to do next; on a clean run it points at the next workflow step
  // rather than nagging. JSON consumers read this off the `nextStep`/`reportable`
  // contract fields instead of this prose.
  const agentMode = detectAgentMode(projectDir);
  const skill = (name) => (agentMode === 'llm' ? `/docguard.${name}` : `docguard ${name}`);

  if (data.status !== 'PASS') {
    console.log(`  ${c.dim}Next: run ${c.cyan}${skill('diagnose')}${c.dim} to get AI fix prompts that resolve the issues above.${c.reset}`);
  } else {
    console.log(`  ${c.dim}Next: ${c.cyan}${skill('score')}${c.dim} for your CDD maturity score, or commit with confidence.${c.reset}`);
  }

  // Low-confidence findings → the feedback path. Scoped to CODES, not
  // findings: `reportable` now includes every unmeasured code, which on a real
  // repository runs to hundreds of entries (666 of 671 findings across
  // fourteen projects), and a contribution is filed against a code once, not
  // against each occurrence.
  //
  // "Never measured" belongs to the benchmark-evidence block below, which
  // already reports it per code with the version skew and the per-code
  // command. Saying it twice in one summary just teaches the reader to skip
  // both. This line stays about the distinct claim: DocGuard suspects it
  // misread THIS input.
  if (Array.isArray(data.findings) && data.findings.length > 0) {
    const uncertain = new Set(data.findings.filter(f => f.confidence === 'low').map(f => f.code));
    if (uncertain.size > 0) {
      console.log(`  ${c.dim}↪ ${uncertain.size} code(s) flagged uncertain here (possible false positives). Review or report: ${c.cyan}${skill('feedback')}${c.reset}`);
    }
  }

  // Read-only skills nudge (never writes — that's `init`'s job). If the agent
  // has no /docguard.* commands installed yet, say how to get them.
  if (agentMode === 'llm' && !existsSync(resolvePath(projectDir, '.agent', 'skills', 'docguard-guard'))) {
    console.log(`  ${c.dim}💡 Install ${c.cyan}/docguard.*${c.dim} commands for your agent: ${c.cyan}docguard init${c.reset}`);
  }

  // ── Coverage + claim visibility (v0.29, field report #6) ──
  // "Green" must mean "I checked these and they're clean," not "I checked the few
  // files I was told about." Show what's under no tier (Gap 1) and that documented
  // factual claims remain unverified vs code (Gap 2). Neither gates the build — but
  // both must SHOW, or a green run misleads.
  if (data.coverage) {
    const cov = data.coverage;
    const unclassN = cov.unclassified.length;
    const tierLine = `${cov.canonical} canonical · ${cov.tracked} tracked · ${cov.ignored} ignored`
      + (unclassN ? ` · ${c.yellow}${unclassN} outside any tier${c.reset}${c.dim}` : '');
    console.log(`\n  ${c.dim}📑 Docs: ${tierLine} ${c.reset}${c.dim}(${cov.discovered} Markdown files)${c.reset}`);
    if (unclassN > 0) {
      // Calm by default — surface the COUNT every run (so non-coverage is never
      // silent), but don't enumerate or cry "invisible drift": much of this is
      // legitimately untracked (fixtures, templates, specs). The file list is one
      // `--verbose` away. Loud-by-default here would just train users to ignore it.
      console.log(`  ${c.dim}↪ ${unclassN} file(s) in no validation tier — add to requiredFiles.canonical, a docs/ home, or .docguardignore${flags.verbose ? ':' : ` (${skill('guard')} --verbose to list)`}${c.reset}`);
      if (flags.verbose) {
        for (const f of cov.unclassified.slice(0, 10)) console.log(`     ${c.dim}• ${f}${c.reset}`);
        if (unclassN > 10) console.log(`     ${c.dim}... and ${unclassN - 10} more${c.reset}`);
      }
    }
  }
  if (data.checkCoverage) {
    const counts = data.checkCoverage.counts;
    // Lead with how many validators actually checked. The passed/total figure
    // counts CHECKS, and its denominator excludes every validator that could
    // not run — so "628/628 passed" and "seven validators found nothing to
    // check" were both true of the same run, with only the first travelling
    // into a badge. (calibrated-finding-channels#FR-020)
    const active = Object.entries(counts).filter(([status]) => status !== 'disabled')
      .reduce((sum, [, n]) => sum + n, 0);
    const rest = Object.entries(counts)
      .filter(([status, count]) => count > 0 && status !== 'checked')
      .map(([status, count]) => count + ' ' + status.replaceAll('-', ' '));
    console.log(`  Check coverage: ${counts.checked} of ${active} validator(s) checked`
      + (rest.length ? ' · ' + rest.join(' · ') : ''));
    console.log('  Document inventory and passing checks do not establish factual accuracy.');
  }
  if (data.semanticClaims && data.semanticClaims.count > 0) {
    console.log(`\n  ${c.cyan}🔍 ${data.semanticClaims.count} documented claim(s) (counts/limits/enums) are unverified against code.${c.reset}`);
    console.log(`     ${c.dim}A passing guard means configured gates passed; these values remain unverified.${c.reset}`);
    console.log(`     ${c.dim}Confirm them: ${c.cyan}${skill('verify')} --semantic${c.reset}`);
  }

  // How much of what this run reported has ever been benchmarked. Silent when
  // there is nothing to report, so a clean run stays clean.
  const pe = data.precisionEvidence;
  if (pe && pe.coverage.codesInRun > 0) {
    const { measured, codesInRun, notMeasured } = pe.coverage;
    console.log(`\n  ${c.cyan}🔬 Benchmark evidence: ${measured} of ${codesInRun} finding code(s) in this run ${measured === 1 ? 'has' : 'have'} measured precision.${c.reset}`);
    if (notMeasured > 0) {
      console.log(`     ${c.dim}${notMeasured} ${notMeasured === 1 ? 'has' : 'have'} never been benchmarked; a finding from those may still be correct.${c.reset}`);
      console.log(`     ${c.dim}Disagree with one? ${c.cyan}docguard feedback --code <CODE> --preview${c.reset}`);
    }
    if (!pe.source.matchesRunningVersion) {
      console.log(`     ${c.dim}Measured on DocGuard ${pe.source.toolVersion}; you are running ${pe.source.runningVersion}.${c.reset}`);
    }
    console.log(`     ${c.dim}Per code: ${c.cyan}${skill('explain')} <CODE>${c.reset}`);
  }

  // Badge snippet.
  const pct = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
  const bColor = badgeColor(pct, incompleteCoverage(data.checkCoverage));
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
        console.log(`\n  ${c.yellow}↻ ${staleDocs.length} documents have repository-history review signals. Review their scope and intended behavior before changing documentation or code.${c.reset}`);
      }
    }
  }

  // Spec-kit reminder — persistent nudge if not initialized
  if (!isSpecKitInitialized(projectDir)) {
    console.log(`\n  ${c.yellow}💡${c.reset} ${c.dim}Enhance DocGuard with Spec Kit: ${c.cyan}uv tool install specify-cli --from git+https://github.com/github/spec-kit.git${c.reset}`);
  }

  // Typo protection for docguard:validator markers — a mistyped key would
  // otherwise silently fail to suppress the validator.
  if (Array.isArray(data.validatorMarkerWarnings) && data.validatorMarkerWarnings.length > 0) {
    for (const w of data.validatorMarkerWarnings) {
      console.log(`\n  ${c.yellow}⚠ ${w}${c.reset}`);
    }
  }

  // When severity overrides demoted warnings to "low" (or promoted them to
  // "high"), show a one-line note so the user knows the exit code may not
  // match what they expected from reading the warning count.
  const severityShifted =
    data.effectiveErrors !== data.errors || data.effectiveWarnings !== data.warnings || data.effectiveInfos > 0;
  if (severityShifted) {
    const upgraded = data.findings.filter(f => f.severity === 'warn' && f.effectiveSeverity === 'error').length
      + data.validators.filter(v => !Array.isArray(v.findings) || v.findings.length === 0)
        .reduce((sum, v) => sum + (v.severity === 'high' ? v.warnings.length : 0), 0);
    const demotedErrors = data.findings.filter(f => f.severity === 'error' && f.effectiveSeverity !== 'error').length;
    const informational = data.effectiveInfos;
    const parts = [];
    if (upgraded > 0) parts.push(`${upgraded} warning(s) escalated to fail (severity=high)`);
    if (demotedErrors > 0) parts.push(`${demotedErrors} intrinsic error(s) explicitly demoted by finding code`);
    if (informational > 0) parts.push(`${informational} finding(s) informational for exit code (severity=low)`);
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
  // v0.28: exitCode + return (not process.exit) so the buffered text output
  // flushes to a pipe before the process exits — same truncation fix as the
  // JSON path above.
  process.exitCode = exitFor(data);
}
