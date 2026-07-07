/**
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
import { mergeIgnoreFile } from './shared-ignore.mjs';
import { detectProjectName } from './scanners/project-type.mjs';

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
      // v0.31.0 — all three default ON. Soft (confidence:low, never break CI),
      // precise (zero false positives across the 6-repo corpus), and quiet when
      // not applicable (no diff / no API-reference doc). api-doc-smells is
      // low-yield but zero-FP, so on-by-default beats a self-counting split.
      diffSuspicion: true,
      referenceExistence: true,
      apiDocSmells: true,
    },
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
      return merged;
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
 * Auto-detect project type from package.json and file structure.
 * Returns: 'cli' | 'library' | 'webapp' | 'api' | 'unknown'
 */
function autoDetectProjectType(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // CLI tool: has "bin" field
      if (pkg.bin) return 'cli';

      // Web app: has a frontend framework
      if (allDeps.next || allDeps.react || allDeps.vue || allDeps['@angular/core'] ||
          allDeps.svelte || allDeps.nuxt || allDeps['@sveltejs/kit']) return 'webapp';

      // API: has a server framework but no frontend
      if (allDeps.express || allDeps.fastify || allDeps.hono || allDeps.koa) return 'api';

      // Library: has "main" or "exports" and no framework
      if (pkg.main || pkg.exports || pkg.module) return 'library';
    } catch { /* fall through */ }
  }

  // Python project
  if (existsSync(resolve(dir, 'manage.py'))) return 'webapp';
  if (existsSync(resolve(dir, 'setup.py')) || existsSync(resolve(dir, 'pyproject.toml'))) return 'library';

  return 'unknown';
}

/**
 * Get default projectTypeConfig for a given project type.
 */
function getProjectTypeDefaults(type) {
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
