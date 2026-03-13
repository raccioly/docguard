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
    version: '0.1',
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
    },
  };

  if (existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return deepMerge(defaults, userConfig);
    } catch (e) {
      console.error(`${c.red}Error parsing .specguard.json: ${e.message}${c.reset}`);
      process.exit(1);
    }
  }

  return defaults;
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
  ║         SpecGuard v0.1.0                  ║
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

${c.bold}Options:${c.reset}
  --dir <path>    Project directory (default: current directory)
  --verbose       Show detailed output
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
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      flags.dir = args[i + 1];
      i++;
    } else if (args[i] === '--verbose') {
      flags.verbose = true;
    }
  }

  const projectDir = resolve(flags.dir);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log('specguard v0.1.0');
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
    default:
      console.error(`${c.red}Unknown command: ${command}${c.reset}`);
      console.log(`Run ${c.cyan}specguard --help${c.reset} for usage.`);
      process.exit(1);
  }
}

main();
