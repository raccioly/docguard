import { hasWorkerConfig } from './shared-source.mjs';
import { applyDocRoles } from './shared-doc-roles.mjs';
/**
 * @implements docguard.evidence-scoped-verification#FR-010
 * DocGuard — configuration loading.
 *
 * Extracted from docguard.mjs (v0.23.0) to break the demo.mjs → docguard.mjs
 * import cycle. demo.mjs runs guard/score against a temp fixture and needs
 * loadConfig, but docguard.mjs statically imports every command (including
 * demo). Importing loadConfig from here — which only pulls shared.mjs and
 * shared-ignore.mjs, never a command module — keeps the import graph acyclic.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { c, PROFILES, SEVERITY_LEVELS } from './shared.mjs';
import { CODES } from './findings.mjs';
import { mergeIgnoreFile } from './shared-ignore.mjs';
import { detectProjectName, detectProjectProfile } from './scanners/project-type.mjs';

export function loadConfig(projectDir) {
  const configPath = resolve(projectDir, '.docguard.json');
  const defaults = {
    // v0.26 (Bug #4): read the declared name from the root manifest
    // (pyproject/package.json/Cargo/composer/go.mod) before falling back to the
    // dir basename — otherwise a git-worktree slug becomes the project name.
    // An explicit `projectName` in .docguard.json still wins via deepMerge.
    projectName: detectProjectName(projectDir),
    // Legacy/unversioned fallback ONLY — the value a config is ASSUMED to be
    // when its file has no `version` field. NOT the current schema version
    // (that's CURRENT_SCHEMA_VERSION in shared.mjs, written by `init`). Kept low
    // on purpose so a versionless (pre-0.4) config still trips the upgrade nudge.
    version: '0.2',
    profile: 'standard',
    requiredFiles: {
      canonical: [
        'docs-canonical/ARCHITECTURE.md',
        'docs-canonical/DATA-MODEL.md',
        'docs-canonical/SECURITY.md',
        'docs-canonical/TEST-SPEC.md',
        'docs-canonical/ENVIRONMENT.md',
      ],
      agentFile: ['AGENTS.md', 'CLAUDE.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    },
    // All CDD document types — required vs optional
    documentTypes: {
      // Canonical (design intent) — required by default
      'docs-canonical/ARCHITECTURE.md':  { required: true,  category: 'canonical',      description: 'System design, components, layer boundaries' },
      'docs-canonical/DATA-MODEL.md':    { required: true,  category: 'canonical',      description: 'Database schemas, entities, relationships' },
      'docs-canonical/SECURITY.md':      { required: true,  category: 'canonical',      description: 'Authentication, authorization, secrets management' },
      'docs-canonical/TEST-SPEC.md':     { required: true,  category: 'canonical',      description: 'Test categories, coverage rules, service-to-test map' },
      'docs-canonical/ENVIRONMENT.md':   { required: true,  category: 'canonical',      description: 'Environment variables, setup steps, prerequisites' },
      'docs-canonical/DEPLOYMENT.md':    { required: false, category: 'canonical',      description: 'Infrastructure, CI/CD pipeline, DNS, monitoring' },
      'docs-canonical/ADR.md':           { required: false, category: 'canonical',      description: 'Architecture Decision Records with rationale' },
      // Implementation (current state) — optional by default
      'docs-implementation/KNOWN-GOTCHAS.md':    { required: false, category: 'implementation', description: 'Lessons learned — symptom/gotcha/fix format' },
      'docs-implementation/TROUBLESHOOTING.md':   { required: false, category: 'implementation', description: 'Error diagnosis guides by category' },
      'docs-implementation/RUNBOOKS.md':          { required: false, category: 'implementation', description: 'Operational procedures (deploy, rollback, backup)' },
      'docs-implementation/CURRENT-STATE.md':     { required: false, category: 'implementation', description: 'Deployment status, feature completion, tech debt' },
      'docs-implementation/VENDOR-BUGS.md':       { required: false, category: 'implementation', description: 'Third-party bug tracker with workarounds' },
      // Root files
      'AGENTS.md':     { required: true,  category: 'agent',    description: 'AI agent behavior rules and project context' },
      'CHANGELOG.md':  { required: true,  category: 'tracking', description: 'All notable changes per Keep a Changelog format' },
      'DRIFT-LOG.md':  { required: true,  category: 'tracking', description: 'Documented deviations from canonical docs' },
      'ROADMAP.md':    { required: false, category: 'tracking', description: 'Project phases, feature tracking, vision' },
    },
    sourcePatterns: {
      services: 'src/services/**/*.{ts,js,py,java}',
      routes: 'src/routes/**/*.{ts,js,py,java}',
      tests: 'tests/**/*.test.{ts,js,py,java}',
    },
    validators: {
      structure: true,
      docsSync: true,
      drift: true,
      changelog: true,
      architecture: false,
      testSpec: true,
      security: false,
      environment: true,
      freshness: true,
      documentLifecycle: true,
      specRegistry: true,
      docDependency: true, // opt-in by declaration: not applicable until a section declares covers=
      pathScopedRules: true, // not applicable without agent instruction files
      docOwnership: true, // not applicable without an ownership block or .devin/wiki.json
      evidence: true,
      // v0.31.0 — all three default ON. Soft (confidence:low, never break CI),
      // heuristic (field cases require ongoing precision checks), and quiet when
      // not applicable (no diff / no API-reference doc). api-doc-smells is
      // Detection yield and false positives must be measured per supported syntax.
      diffSuspicion: true,
      referenceExistence: true,
      apiDocSmells: true,
    },
    findingSeverity: {},
  };

  if (existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

      // Apply profile presets BEFORE merging user config
      // Profile sets the baseline, user config can override anything
      const profileName = userConfig.profile || defaults.profile;
      const profilePreset = PROFILES[profileName];
      const withProfile = profilePreset
        ? deepMerge(defaults, profilePreset)
        : defaults;

      // v0.17-P4: normalize validator/severity keys before merging so the
      // user can write either kebab-case (`test-spec`) or camelCase (`testSpec`)
      // and the internal lookups (always camelCase) still hit.
      const merged = deepMerge(withProfile, normalizeConfig(userConfig));
      merged.profile = profileName;

      // v0.24: severity accepts only high|medium|low and changes EXIT-CODE
      // weight — it never mutes a warning from display. A value like "off"
      // silently fell back to "medium", so users who wrote severity:{k:"off"}
      // expecting silence still saw the warning and got no feedback (field
      // report). Surface the misconfig and point at the real disable switch.
      if (merged.severity && typeof merged.severity === 'object') {
        for (const [key, val] of Object.entries(merged.severity)) {
          if (typeof val === 'string' && !SEVERITY_LEVELS.has(val.toLowerCase())) {
            console.error(`${c.yellow}⚠ .docguard.json: severity.${key} = "${val}" is not a valid level${c.reset} ${c.dim}(use high | medium | low). To silence a validator entirely, set ${c.reset}${c.cyan}validators.${key}: false${c.dim}.${c.reset}`);
          }
        }
      }
      if (merged.findingSeverity && typeof merged.findingSeverity === 'object') {
        for (const [code, val] of Object.entries(merged.findingSeverity)) {
          if (!Object.hasOwn(CODES, code)) {
            throw new Error(`findingSeverity.${code} is not a known finding code`);
          }
          if (typeof val !== 'string' || !SEVERITY_LEVELS.has(val.toLowerCase())) {
            throw new Error(`findingSeverity.${code} must be high, medium, or low`);
          }
        }
      }

      // Auto-detect project type if not set
      if (!merged.projectType) {
        merged.projectType = autoDetectProjectType(projectDir);
      }
      // Ensure projectTypeConfig has sensible defaults based on type
      merged.projectTypeConfig = {
        ...getProjectTypeDefaults(merged.projectType),
        ...(merged.projectTypeConfig || {}),
      };
      // Normalize testPattern (string) → testPatterns (array) for backward compat
      if (merged.testPattern && !merged.testPatterns) {
        merged.testPatterns = [merged.testPattern];
      } else if (merged.testPattern && merged.testPatterns) {
        // Both set — merge, deduplicate
        if (!merged.testPatterns.includes(merged.testPattern)) {
          merged.testPatterns.push(merged.testPattern);
        }
      }
      // Merge .docguardignore patterns into config.ignore so every validator
      // honors them without having to know about the file.
      mergeIgnoreFile(projectDir, merged);
      return applyDocRoles(projectDir, merged);
    } catch (e) {
      console.error(`${c.red}Error parsing .docguard.json: ${e.message}${c.reset}`);
      process.exit(1);
    }
  }

  // No config file — auto-detect everything
  defaults.projectType = autoDetectProjectType(projectDir);
  defaults.projectTypeConfig = getProjectTypeDefaults(defaults.projectType);
  // .docguardignore is read even when no .docguard.json exists — keeps
  // ignore-only projects (no config but want to skip paths) working.
  mergeIgnoreFile(projectDir, defaults);
  return defaults;
}

// PROFILES is exported from shared.mjs (re-exported at line 43)

/**
 * Auto-detect project type: 'cli' | 'library' | 'webapp' | 'api' | 'unknown'.
 *
 * One detector: the ecosystem profile (scanners/project-type.mjs), which
 * reads every manifest DocGuard supports. A root ecosystem that names a
 * framework or a kind wins over a root `library` (a Python service with a
 * package.json for tooling), and a `service` is an `api`. A Worker config is
 * checked first, as before. (docguard.python-extraction#FR-010)
 */
const KIND_TO_PROJECT_TYPE = { cli: 'cli', library: 'library', webapp: 'webapp', api: 'api', service: 'api' };

export function autoDetectProjectType(dir) {
  if (hasWorkerConfig(dir)) return 'api';
  let profile;
  try { profile = detectProjectProfile(dir); } catch { return 'unknown'; }
  const roots = profile.ecosystems.filter(e => e.dir === '.');
  const pick = roots.find(e => e.kind !== 'library') || profile.primary;
  if (!pick) return 'unknown';
  // A package.json with no entry point, no bin and no framework is not
  // evidence of a library; keep the historical 'unknown' for it.
  if (pick.kind === 'library' && pick.manifest === 'package.json' && !hasLibraryEntry(dir)) return 'unknown';
  return KIND_TO_PROJECT_TYPE[pick.kind] || 'unknown';
}

function hasLibraryEntry(dir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8'));
    return !!(pkg.main || pkg.exports || pkg.module);
  } catch { return false; }
}

/**
 * Get default projectTypeConfig for a given project type.
 */
export function getProjectTypeDefaults(type) {
  const defaults = {
    cli:     { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false, testFramework: 'node:test', runCommand: null },
    library: { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false, testFramework: 'vitest',    runCommand: null },
    webapp:  { needsEnvVars: true,  needsEnvExample: true,  needsE2E: true,  needsDatabase: true,  testFramework: 'vitest',    runCommand: 'npm run dev' },
    api:     { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true,  testFramework: 'vitest',    runCommand: 'npm run dev' },
    unknown: { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true,  testFramework: null,        runCommand: null },
  };
  return defaults[type] || defaults.unknown;
}

/**
 * v0.17-P4: normalize validator-key naming so users can write either
 * `validators: { "test-spec": true }` (kebab-case, matches CLI display)
 * or `validators: { testSpec: true }` (camelCase, matches JSON internals)
 * in `.docguard.json`. We normalize the WHOLE config tree's known validator
 * keys to camelCase before merging. Same treatment applied to `severity`.
 *
 * Non-validator keys are left alone. Unknown keys (forward-compat) are
 * normalized blindly: kebab-case→camelCase always.
 */
const _KNOWN_VALIDATORS = [
  'structure', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment',
  'security', 'architecture', 'freshness', 'traceability', 'docsDiff',
  'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking',
  'schemaSync', 'specKit', 'crossReference', 'generatedStaleness',
  'canonicalSync', 'surfaceSync', 'metricsConsistency',
  'evidence',
];

function _kebabToCamel(k) {
  return k.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function _normalizeValidatorKeys(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const normalized = k.includes('-') ? _kebabToCamel(k) : k;
    out[normalized] = v;
  }
  return out;
}

function normalizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = { ...cfg };
  if (out.validators) out.validators = _normalizeValidatorKeys(out.validators);
  if (out.severity)   out.severity   = _normalizeValidatorKeys(out.severity);
  if (out.findingSeverity && typeof out.findingSeverity === 'object' && !Array.isArray(out.findingSeverity)) {
    const normalized = {};
    for (const [rawCode, value] of Object.entries(out.findingSeverity)) {
      const code = rawCode.toUpperCase();
      if (Object.hasOwn(normalized, code)) {
        throw new Error(`findingSeverity contains duplicate code ${code}`);
      }
      normalized[code] = typeof value === 'string' ? value.toLowerCase() : value;
    }
    out.findingSeverity = normalized;
  }
  return out;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
