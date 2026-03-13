#!/usr/bin/env node

/**
 * SpecGuard CLI — The enforcement tool for Canonical-Driven Development (CDD)
 * 
 * Zero dependencies. Pure Node.js.
 * 
 * Usage:
 *   npx specguard audit     — Scan project, report what docs exist/missing
 *   npx specguard init      — Initialize CDD docs from templates
 *   npx specguard guard     — Validate project against its canonical docs
 *   npx specguard --help    — Show help
 * 
 * @see https://github.com/ricardoaccioly/specguard
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { runAudit } from './commands/audit.mjs';
import { runInit } from './commands/init.mjs';
import { runGuard } from './commands/guard.mjs';
import { runScore } from './commands/score.mjs';
import { runDiff } from './commands/diff.mjs';
import { runAgents } from './commands/agents.mjs';
import { runGenerate } from './commands/generate.mjs';
import { runHooks } from './commands/hooks.mjs';
import { runBadge } from './commands/badge.mjs';
import { runCI } from './commands/ci.mjs';

// ── Colors (ANSI escape codes, zero deps) ──────────────────────────────────
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

// ── Config Loading ─────────────────────────────────────────────────────────
export function loadConfig(projectDir) {
  const configPath = resolve(projectDir, '.specguard.json');
  const defaults = {
    projectName: basename(projectDir),
    version: '0.2',
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
      const merged = deepMerge(defaults, userConfig);
      // Auto-detect project type if not set
      if (!merged.projectType) {
        merged.projectType = autoDetectProjectType(projectDir);
      }
      // Ensure projectTypeConfig has sensible defaults based on type
      merged.projectTypeConfig = {
        ...getProjectTypeDefaults(merged.projectType),
        ...(merged.projectTypeConfig || {}),
      };
      return merged;
    } catch (e) {
      console.error(`${c.red}Error parsing .specguard.json: ${e.message}${c.reset}`);
      process.exit(1);
    }
  }

  // No config file — auto-detect everything
  defaults.projectType = autoDetectProjectType(projectDir);
  defaults.projectTypeConfig = getProjectTypeDefaults(defaults.projectType);
  return defaults;
}

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
  ║         SpecGuard v0.4.0                  ║
  ║   Canonical-Driven Development (CDD)      ║
  ╚═══════════════════════════════════════════╝${c.reset}
`);
}

// ── Help ───────────────────────────────────────────────────────────────────
function printHelp() {
  printBanner();
  console.log(`${c.bold}Usage:${c.reset}
  specguard <command> [options]

${c.bold}Commands:${c.reset}
  ${c.green}audit${c.reset}     Scan project, report what CDD docs exist or are missing
  ${c.green}init${c.reset}      Initialize CDD documentation from templates
  ${c.green}guard${c.reset}     Validate project against its canonical documentation
  ${c.green}score${c.reset}     Calculate CDD maturity score (0-100)
  ${c.green}diff${c.reset}      Show gaps between canonical docs and code
  ${c.green}agents${c.reset}    Generate agent-specific config files from AGENTS.md
  ${c.green}generate${c.reset}  Reverse-engineer canonical docs from existing code
  ${c.green}hooks${c.reset}     Install git hooks (pre-commit, pre-push, commit-msg)
  ${c.green}badge${c.reset}     Generate CDD score badges for README
  ${c.green}ci${c.reset}        Single command for CI/CD pipelines (guard + score)

${c.bold}Options:${c.reset}
  --dir <path>    Project directory (default: current directory)
  --verbose       Show detailed output
  --format json   Output results as JSON (for CI)
  --fix           Auto-create missing files from templates
  --force         Overwrite existing files (for agents/init)
  --agent <name>  Target specific agent (for agents command)
  --type <name>   Hook type: pre-commit, pre-push, commit-msg
  --list          List available hooks and their status
  --remove        Remove installed SpecGuard hooks
  --threshold <n> Minimum score for CI pass (used with ci command)
  --fail-on-warning  Fail CI on warnings (used with ci command)
  --help          Show this help message
  --version       Show version

${c.bold}Examples:${c.reset}
  ${c.dim}# Audit current project${c.reset}
  specguard audit

  ${c.dim}# Initialize CDD docs in a project${c.reset}
  specguard init --dir ./my-project

  ${c.dim}# Run guard checks (for CI/pre-commit)${c.reset}
  specguard guard

${c.bold}Configuration:${c.reset}
  Create ${c.cyan}.specguard.json${c.reset} in your project root to customize validators.
  See: https://github.com/ricardoaccioly/specguard

${c.bold}Learn more:${c.reset}
  Canonical-Driven Development: ${c.cyan}PHILOSOPHY.md${c.reset}
  Full standard: ${c.cyan}STANDARD.md${c.reset}
`);
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
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
    }
  }

  const projectDir = resolve(flags.dir);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log('specguard v0.4.0');
    process.exit(0);
  }

  printBanner();

  const config = loadConfig(projectDir);

  switch (command) {
    case 'audit':
      runAudit(projectDir, config, flags);
      break;
    case 'init':
      runInit(projectDir, config, flags);
      break;
    case 'guard':
      runGuard(projectDir, config, flags);
      break;
    case 'score':
      runScore(projectDir, config, flags);
      break;
    case 'diff':
      runDiff(projectDir, config, flags);
      break;
    case 'agents':
      runAgents(projectDir, config, flags);
      break;
    case 'generate':
    case 'gen':
      runGenerate(projectDir, config, flags);
      break;
    case 'hooks':
      runHooks(projectDir, config, flags);
      break;
    case 'badge':
    case 'badges':
      runBadge(projectDir, config, flags);
      break;
    case 'ci':
    case 'pipeline':
      runCI(projectDir, config, flags);
      break;
    default:
      console.error(`${c.red}Unknown command: ${command}${c.reset}`);
      console.log(`Run ${c.cyan}specguard --help${c.reset} for usage.`);
      process.exit(1);
  }
}

main();
