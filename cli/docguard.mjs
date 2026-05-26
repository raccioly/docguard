#!/usr/bin/env node

/**
 * DocGuard CLI — The enforcement tool for Canonical-Driven Development (CDD)
 * 
 * Zero NPM runtime dependencies. Pure Node.js.
 * 
 * Usage:
 *   npx docguard-cli audit     — Scan project, report what docs exist/missing
 *   npx docguard-cli init      — Initialize CDD docs from templates
 *   npx docguard-cli guard     — Validate project against its canonical docs
 *   npx docguard-cli --help    — Show help
 * 
 * @see https://github.com/raccioly/docguard
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read version from package.json (single source of truth)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = PKG.version;
// audit is now an alias for guard (old audit.mjs deleted — guard does everything it did + more)
import { runInit } from './commands/init.mjs';
import { runGuard } from './commands/guard.mjs';
import { runScore } from './commands/score.mjs';
import { runDiff } from './commands/diff.mjs';
import { runAgents } from './commands/agents.mjs';
import { runGenerate } from './commands/generate.mjs';
import { runHooks } from './commands/hooks.mjs';
import { runBadge } from './commands/badge.mjs';
import { runCI } from './commands/ci.mjs';
import { runFix } from './commands/fix.mjs';
import { runWatch } from './commands/watch.mjs';
import { runDiagnose } from './commands/diagnose.mjs';
import { runSync } from './commands/sync.mjs';
import { runPublish } from './commands/publish.mjs';
import { runTrace } from './commands/trace.mjs';
import { runLlms } from './commands/llms.mjs';
import { runSetup } from './commands/setup.mjs';
import { runUpgrade } from './commands/upgrade.mjs';
import { runImpact } from './commands/impact.mjs';
import { runExplain } from './commands/explain.mjs';
import { runMemory } from './commands/memory.mjs';
import { ensureSkills } from './ensure-skills.mjs';

// ── Shared constants (imported to break circular dependencies) ──────────
import { c, PROFILES } from './shared.mjs';
import { mergeIgnoreFile } from './shared-ignore.mjs';
export { c, PROFILES };

// ── Config Loading ─────────────────────────────────────────────────────────
export function loadConfig(projectDir) {
  const configPath = resolve(projectDir, '.docguard.json');
  const defaults = {
    projectName: basename(projectDir),
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
  'metricsConsistency',
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

// ── Banner ─────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
${c.cyan}${c.bold}  ╔═══════════════════════════════════════════╗
  ║         DocGuard v${VERSION.padEnd(27)}║
  ║   Canonical-Driven Development (CDD)      ║
  ╚═══════════════════════════════════════════╝${c.reset}
`);
}

// ── Help ───────────────────────────────────────────────────────────────────
function printHelp() {
  printBanner();
  console.log(`${c.bold}Usage:${c.reset}
  docguard <command> [options]

${c.bold}The Daily 5${c.reset} ${c.dim}— what you'll reach for 95% of the time${c.reset}
  ${c.green}init${c.reset}       Bootstrap a project (use ${c.cyan}--wizard${c.reset} for guided / ${c.cyan}--with <name>${c.reset} for scaffolders)
  ${c.green}guard${c.reset}      Validate against canonical docs (23 validators)
  ${c.green}diff${c.reset}       Show gaps between docs and code (add ${c.cyan}--since <ref>${c.reset} for changed-file impact)
  ${c.green}sync${c.reset}       Refresh code-truth doc sections — keeps memory always up to date
  ${c.green}score${c.reset}      CDD maturity score (0-100; ${c.cyan}--diff${c.reset} for delta between refs)

${c.bold}Tools (situational, but day-to-day useful)${c.reset}
  ${c.green}diagnose${c.reset}   AI orchestrator — guard → emit fix prompts in one command
  ${c.green}fix${c.reset}        Generate AI fix instructions for specific docs
  ${c.green}generate${c.reset}   Reverse-engineer canonical docs from existing code (${c.cyan}--plan${c.reset} for AI scan)
  ${c.green}explain${c.reset}    Explain a validator key or warning text
  ${c.green}memory${c.reset}     Show what DocGuard remembers (${c.cyan}--diff${c.reset} drills into drift)
  ${c.green}trace${c.reset}      Requirements traceability matrix (${c.cyan}--reverse${c.reset} for code→doc map)
  ${c.green}upgrade${c.reset}    Migrate ${c.cyan}.docguard.json${c.reset} schema + CLI (${c.cyan}--apply --pr${c.reset} for team-wide PR)
  ${c.green}watch${c.reset}      Live mode: re-run guard on file changes

${c.bold}init --with <name>${c.reset} ${c.dim}— optional scaffolders, picked at init time${c.reset}
  ${c.dim}agents${c.reset}     AGENTS.md / CLAUDE.md / .cursor/rules / Copilot instructions
  ${c.dim}hooks${c.reset}      Git pre-commit / pre-push hooks
  ${c.dim}ci${c.reset}         GitHub Actions / pipeline config
  ${c.dim}badge${c.reset}      Shields.io score badges for README
  ${c.dim}llms${c.reset}       llms.txt generation
  ${c.dim}publish${c.reset}    External doc-site scaffold (Mintlify) ${c.dim}— experimental${c.reset}

${c.bold}Deprecation aliases${c.reset} ${c.dim}— still work in v0.20.x with a yellow warning${c.reset}
  ${c.dim}setup${c.reset} → ${c.cyan}init --wizard${c.reset}
  ${c.dim}agents · hooks · ci · badge · llms · publish${c.reset} → ${c.cyan}init --with <name>${c.reset}
  ${c.dim}impact${c.reset} → ${c.cyan}diff --since <ref>${c.reset}
  ${c.dim}audit${c.reset} → ${c.green}guard${c.reset} ${c.dim}(permanent — no warning, no removal planned)${c.reset}
  ${c.dim}See docs-implementation/MIGRATION-v0.20.md for the full timeline.${c.reset}

${c.bold}Options:${c.reset}
  --dir <path>    Project directory (default: current directory)
  --verbose       Show detailed output
  --format json   Output results as JSON (for CI)
  --fix           Auto-create missing files from templates
  --force         Overwrite existing files (for agents/init)
  --agent <name>  Target specific agent (for agents command)
  --type <name>   Hook type: pre-commit, pre-push, commit-msg
  --list          List available hooks and their status
  --remove        Remove installed DocGuard hooks
  --threshold <n> Minimum score for CI pass (used with ci command)
  --fail-on-warning  Fail CI on warnings (used with ci command)
  --auto          Auto-fix what's possible (used with fix command)
  --write         Apply deterministic fixes in place (fix command): removes
                  documented endpoints the OpenAPI spec confirms are gone.
                  Only edits docguard:generated docs unless --force.
  --plan          AI-powered Generate (generate command): scan any project
                  (JS/Python/Rust/Go/Java/…), emit the agent task manifest +
                  code-truth skeleton. Add --write to scaffold, --format json
                  for the machine-readable manifest.
  --doc <name>    Generate AI prompt for specific doc (architecture, security, etc.)
  --profile <p>   Compliance profile: starter, standard, enterprise (init command)
  --tax           Show estimated documentation maintenance cost (with score)
  --help          Show this help message
  --version       Show version

${c.bold}Profiles:${c.reset}
  ${c.green}starter${c.reset}      Minimal CDD — just ARCHITECTURE.md + CHANGELOG (side projects)
  ${c.green}standard${c.reset}     Full CDD — all 5 canonical docs (default, team projects)
  ${c.green}enterprise${c.reset}   Strict CDD — all docs + all validators + freshness enforced

${c.bold}Examples:${c.reset}
  ${c.dim}# AI auto-diagnose and fix${c.reset}
  docguard diagnose

  ${c.dim}# Interactive setup (asks which docs you need)${c.reset}
  docguard init

  ${c.dim}# Quick start for a side project${c.reset}
  docguard init --profile starter --skip-prompts

  ${c.dim}# See documentation tax estimate${c.reset}
  docguard score --tax

${c.bold}Configuration:${c.reset}
  Create ${c.cyan}.docguard.json${c.reset} in your project root to customize validators.
  See: https://github.com/raccioly/docguard

${c.bold}Learn more:${c.reset}
  Canonical-Driven Development: ${c.cyan}PHILOSOPHY.md${c.reset}
  Full standard: ${c.cyan}STANDARD.md${c.reset}
`);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse flags
  const flags = {
    dir: '.',
    verbose: false,
    format: 'text',
    fix: false,
    force: false,
    agent: null,
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      flags.dir = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      flags.verbose = true;
    } else if (args[i] === '--format' && args[i + 1]) {
      flags.format = args[i + 1];
      i++;
    } else if (args[i] === '--fix') {
      flags.fix = true;
    } else if (args[i] === '--force') {
      flags.force = true;
    } else if (args[i] === '--agent' && args[i + 1]) {
      flags.agent = args[i + 1];
      i++;
    } else if (args[i] === '--type' && args[i + 1]) {
      flags.type = args[i + 1];
      i++;
    } else if (args[i] === '--list') {
      flags.list = true;
    } else if (args[i] === '--remove') {
      flags.remove = true;
    } else if (args[i] === '--threshold' && args[i + 1]) {
      flags.threshold = args[i + 1];
      i++;
    } else if (args[i] === '--fail-on-warning') {
      flags.failOnWarning = true;
    } else if (args[i] === '--auto') {
      flags.auto = true;
    } else if (args[i] === '--write') {
      flags.write = true;
    } else if (args[i] === '--plan') {
      flags.plan = true;
    } else if (args[i] === '--since' && args[i + 1]) {
      flags.since = args[i + 1];
      i++;
    } else if (args[i] === '--show-failing') {
      flags.showFailing = true;
    } else if (args[i] === '--check-only') {
      flags.checkOnly = true;
    } else if (args[i] === '--apply') {
      flags.apply = true;
    } else if (args[i] === '--changed-only') {
      flags.changedOnly = true;
    } else if (args[i] === '--reverse') {
      flags.reverse = true;
    } else if (args[i] === '--history') {
      flags.history = true;
    } else if (args[i] === '--force-redo') {
      flags.forceRedo = true;
    } else if (args[i] === '--pr') {
      flags.pr = true;
    } else if (args[i] === '--timings' || args[i] === '--show-timings') {
      // v0.14-Q2: per-validator timing display. Renamed from `--profile` to
      // avoid collision with `docguard init --profile <name>`. `--show-timings`
      // is the long form for users who prefer explicit verbs.
      flags.timings = true;
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      // v0.16-P5: suppress the banner + ensureSkills decorative line.
      // Useful inside git hooks (every commit prints the banner otherwise)
      // and any CI/script that pipes docguard's output.
      flags.quiet = true;
    } else if (args[i] === '--no-spec-kit') {
      // v0.16-P8: opt-out of automatic Spec Kit init during `docguard init`.
      // Default stays on (discoverability), but lets minimalist library
      // projects skip the .specify/.agent/commands scaffolding.
      flags.noSpecKit = true;
    } else if (args[i] === '--pin') {
      // v0.17-P1: `docguard guard --pin` records the running CLI version
      // into .docguard.json (`docguardVersion` field) after a successful run.
      // Different from `--pr` (used by upgrade) — this is for guard.
      flags.pin = true;
    } else if (args[i] === '--diff') {
      // v0.17-P2: `docguard memory --diff` drills into accuracy mismatches.
      // Distinct from the `diff` command itself (which is a top-level cmd).
      flags.diff = true;
    } else if (args[i] === '--with' && args[i + 1]) {
      // v0.20: `docguard init --with agents,hooks,ci,badge,llms,publish`
      // folds the six standalone scaffolders into init. Comma-separated
      // names, each dispatched to the matching runner after init finishes.
      flags.with = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--wizard') {
      // v0.20: `docguard init --wizard` runs the 7-step interactive
      // onboarding flow (previously `docguard setup`). `setup` keeps
      // working as a deprecation alias.
      flags.wizard = true;
    } else if (!args[i].startsWith('--') && i > 0) {
      // Positional args go into flags.args for commands that take them (e.g.
      // `docguard trace --reverse <path>`). Skip the command itself (i === 0).
      flags.args = flags.args || [];
      flags.args.push(args[i]);
    } else if (args[i] === '--doc' && args[i + 1]) {
      flags.doc = args[i + 1];
      i++;
    } else if (args[i] === '--profile' && args[i + 1]) {
      flags.profile = args[i + 1];
      i++;
    } else if (args[i] === '--tax') {
      flags.tax = true;
    } else if (args[i] === '--auto-fix') {
      flags.autoFix = true;
    } else if (args[i] === '--skip-prompts') {
      flags.skipPrompts = true;
    } else if (args[i] === '--platform' && args[i + 1]) {
      flags.platform = args[i + 1];
      i++;
    } else if (args[i] === '--no-fix') {
      flags.noFix = true;
    } else if (args[i] === '--signals') {
      flags.signals = true;
    } else if (args[i] === '--debate') {
      flags.debate = true;
    } else if (args[i] === '--stdout') {
      flags.stdout = true;
    }
  }

  const projectDir = resolve(flags.dir);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(`docguard v${VERSION}`);
    process.exit(0);
  }

  // In JSON mode the entire stdout MUST be parseable JSON. The banner and
  // ensureSkills' install message would corrupt the output for any
  // programmatic consumer (CI, dashboards, the Score-on-PR Action recipe).
  // Headless flags (`--write`, `--check-only`, `--auto`) also suppress chrome.
  // v0.16-P5: --quiet (-q) joins the headless club for users who want
  // banner-free output without committing to a specific machine format.
  const jsonMode = flags.format === 'json';
  const headless = jsonMode || flags.write || flags.checkOnly || flags.changedOnly || flags.quiet;

  if (!headless) printBanner();

  const config = loadConfig(projectDir);

  // Silent auto-check: install skills/commands if missing. Skip entirely in
  // headless modes where the user wants deterministic, parseable output and
  // doesn't expect side effects on their AI-agent skill directories.
  if (command !== 'setup' && command !== 'init' && !headless) {
    ensureSkills(projectDir, flags);
  }

  // v0.20: deprecation aliases. The legacy command keeps working through v0.20
  // and emits a yellow stderr warning suggesting the new shape. Quiet mode
  // (e.g. inside hooks) suppresses the warning so CI output stays clean.
  // The full deprecation timeline is in docs-implementation/MIGRATION-v0.20.md.
  const DEPRECATED_COMMANDS = {
    setup:   { since: '0.20', replacement: 'docguard init --wizard' },
    agents:  { since: '0.20', replacement: 'docguard init --with agents' },
    hooks:   { since: '0.20', replacement: 'docguard init --with hooks' },
    ci:      { since: '0.20', replacement: 'docguard init --with ci' },
    badge:   { since: '0.20', replacement: 'docguard init --with badge' },
    llms:    { since: '0.20', replacement: 'docguard init --with llms' },
    publish: { since: '0.20', replacement: 'docguard init --with publish' },
    impact:  { since: '0.20', replacement: 'docguard diff --since <ref>' },
  };

  // v0.20: dropped aliases — the 10 cute variants the audit identified.
  // `audit` is intentionally NOT here; it remains a permanent silent alias
  // for `guard` (per SURFACE-AUDIT §8.1 — older CI scripts depend on it).
  const DROPPED_ALIASES = {
    onboard:        'setup (deprecated) — try `docguard init --wizard`',
    gen:            'generate',
    badges:         'badge (deprecated) — try `docguard init --with badge`',
    pipeline:       'ci (deprecated) — try `docguard init --with ci`',
    repair:         'fix',
    dx:             'diagnose',
    pub:            'publish (deprecated) — try `docguard init --with publish`',
    traceability:   'trace',
    'help-warning': 'explain',
    update:         'upgrade',
  };

  if (DROPPED_ALIASES[command]) {
    console.error(`${c.red}Unknown command: ${command}${c.reset}`);
    console.error(`${c.yellow}Hint: this alias was removed in v0.20. Try ${c.cyan}docguard ${DROPPED_ALIASES[command]}${c.yellow}.${c.reset}`);
    console.error(`${c.dim}See docs-implementation/MIGRATION-v0.20.md for the full list.${c.reset}`);
    process.exit(1);
  }

  if (DEPRECATED_COMMANDS[command] && !flags.quiet) {
    const { since, replacement } = DEPRECATED_COMMANDS[command];
    console.error(`${c.yellow}⚠ Deprecated since v${since}:${c.reset} ${c.cyan}docguard ${command}${c.reset} → use ${c.cyan}${replacement}${c.reset}`);
    console.error(`${c.dim}  The old form still works in v0.20.x but will be removed in v1.0. See MIGRATION-v0.20.md.${c.reset}`);
  }

  switch (command) {
    case 'audit':
      // Permanent silent alias for guard (SURFACE-AUDIT §8.1).
      runGuard(projectDir, config, flags);
      break;
    case 'init':
      await runInit(projectDir, config, flags);
      break;
    case 'setup':
      // v0.20: deprecated → dispatches to init --wizard
      await runInit(projectDir, config, { ...flags, wizard: true });
      break;
    case 'guard':
      runGuard(projectDir, config, flags);
      break;
    case 'score':
      runScore(projectDir, config, flags);
      break;
    case 'diff':
      // v0.20: `docguard diff --since <ref>` dispatches to the impact-mode
      // analyzer (post-commit "which docs reference files changed since X").
      // Without --since it's the standard current-state drift report.
      if (flags.since) {
        runImpact(projectDir, config, flags);
      } else {
        runDiff(projectDir, config, flags);
      }
      break;
    case 'agents':
      // v0.20: deprecated → dispatches through init --with
      await runInit(projectDir, config, { ...flags, with: ['agents'], skipPrompts: true });
      break;
    case 'generate':
      runGenerate(projectDir, config, flags);
      break;
    case 'hooks':
      await runInit(projectDir, config, { ...flags, with: ['hooks'], skipPrompts: true });
      break;
    case 'badge':
      await runInit(projectDir, config, { ...flags, with: ['badge'], skipPrompts: true });
      break;
    case 'ci':
      await runInit(projectDir, config, { ...flags, with: ['ci'], skipPrompts: true });
      break;
    case 'fix':
      runFix(projectDir, config, flags);
      break;
    case 'diagnose':
      runDiagnose(projectDir, config, flags);
      break;
    case 'watch':
      runWatch(projectDir, config, flags);
      break;
    case 'sync':
      runSync(projectDir, config, flags);
      break;
    case 'publish':
      await runInit(projectDir, config, { ...flags, with: ['publish'], skipPrompts: true });
      break;
    case 'trace':
      runTrace(projectDir, config, flags);
      break;
    case 'llms':
      await runInit(projectDir, config, { ...flags, with: ['llms'], skipPrompts: true });
      break;
    case 'upgrade':
      await runUpgrade(projectDir, config, flags);
      break;
    case 'impact':
      // v0.20: deprecated alias for `diff --since`. Default --since HEAD~1
      // matches impact's historical behavior.
      runImpact(projectDir, config, { ...flags, since: flags.since || 'HEAD~1' });
      break;
    case 'explain':
      runExplain(projectDir, config, flags);
      break;
    case 'memory':
      runMemory(projectDir, config, flags);
      break;
    default:
      console.error(`${c.red}Unknown command: ${command}${c.reset}`);
      console.log(`Run ${c.cyan}docguard --help${c.reset} for usage.`);
      process.exit(1);
  }
}

main();
