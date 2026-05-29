/**
 * Demo Command — v0.21.
 *
 * The 30-second "ah-ha" experience for devs shopping for doc tools.
 *
 *   npx docguard-cli demo
 *
 * Spins up a baked-in fixture project (`templates/demo-fixture/`) — a 4-service
 * payments API with INTENTIONAL doc drift — runs guard against it, and prints
 * a curated narrative with real-world-impact annotations + a clear install CTA.
 *
 * Zero install required, zero damage to the user's environment: the fixture
 * is copied to a temp directory, git-initialized there, and cleaned up on exit.
 *
 * Why this exists: per SURFACE-AUDIT v0.21 plan, the #2 friction point for
 * adoption was "no demo path — devs have to install, init, write docs, run
 * guard just to see what we do." This command compresses that to 30 seconds.
 */

import { mkdtempSync, rmSync, cpSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { c } from '../shared.mjs';
import { runGuardInternal, classifyResult } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { loadConfig } from '../config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_SRC = resolve(__dirname, '../../templates/demo-fixture');

/**
 * Each warning pattern gets a 1-2 line "real-world impact" gloss. Keyed by
 * a regex on the warning text; the first match wins. Falls back to the
 * generic gloss for unrecognized warnings (so this dictionary stays
 * resilient as validators evolve).
 *
 * The point: turn validator-speak ("Missing 'Setup Steps' section") into
 * adopter-speak ("New devs spend an hour figuring out how to run this").
 */
const IMPACT_GLOSS = [
  {
    re: /env var.*not documented|missing.*Environment Variables/i,
    impact: 'New devs hit cryptic "X is undefined" runtime errors at boot. CI bypasses the missing var entirely.',
  },
  {
    re: /[Aa]rchitecture|service.*not (in|mentioned)|not in [Aa]rchitecture/,
    impact: 'Your AI agent reads the architecture doc and gives wrong answers about how the system works.',
  },
  {
    re: /missing.*Usage|missing.*License|README/,
    impact: 'First-time visitors bounce. The README is the storefront — empty sections = lost trust.',
  },
  {
    re: /endpoint|route|API-REFERENCE/i,
    impact: 'Clients call a documented endpoint that no longer exists, or worse — miss a new endpoint entirely.',
  },
  {
    re: /Test-Spec|test.*directory|test files/,
    impact: 'Your TEST-SPEC doesn\'t reflect reality. New tests get written in the wrong place.',
  },
  {
    re: /Unreleased.*section|Changelog/,
    impact: 'Release automation can\'t auto-detect what\'s pending. Versioning becomes manual guesswork.',
  },
  {
    re: /Spec.?Kit/i,
    impact: 'Specs aren\'t structured for AI agents to use. You miss the multiplier on spec-driven development.',
  },
  {
    re: /Config file.*not mentioned/,
    impact: 'Devs see an unknown config file and don\'t know if it\'s safe to delete or required.',
  },
  {
    re: /unlinked doc|not in your requiredFiles/,
    impact: 'Doc lives in canonical/ but isn\'t in the manifest — guard skips it, drift accumulates silently.',
  },
];

function getImpact(warning) {
  for (const { re, impact } of IMPACT_GLOSS) {
    if (re.test(warning)) return impact;
  }
  return null;
}

/**
 * Set up a temp copy of the fixture, git-init it, return the path.
 */
function setupFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-demo-'));
  cpSync(FIXTURE_SRC, dir, { recursive: true });
  // Initialize git so any history-aware validators (Freshness, Drift-Comments)
  // can run without erroring. Identity is set locally so commit succeeds on
  // CI runners that have no global git identity.
  const opts = { cwd: dir, stdio: 'ignore' };
  spawnSync('git', ['init', '-q', '-b', 'main'], opts);
  spawnSync('git', ['config', 'user.email', 'demo@docguard.dev'], opts);
  spawnSync('git', ['config', 'user.name', 'docguard-demo'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '-q', '-m', 'fixture'], opts);
  return dir;
}

/**
 * Pretty-print a curated guard run.
 */
function presentResults(guardData, scoreData) {
  const allWarnings = [];
  for (const v of guardData.validators) {
    for (const w of (v.warnings || [])) {
      allWarnings.push({ validator: v.name, message: w, severity: v.severity });
    }
  }

  console.log(`\n${c.bold}🔍 What DocGuard found in your fixture:${c.reset}`);
  console.log(`${c.dim}   Validators run: ${guardData.validators.length}   ·   Warnings: ${allWarnings.length}   ·   Time: ~0.5s${c.reset}\n`);

  // Pick up to 5 warnings showing VARIETY across validators (not 5 from the
  // same one). Dedupe by validator name; within each validator group, pick
  // the highest-severity warning. Then rank the picks by severity.
  const sev = { high: 0, medium: 1, low: 2 };
  const byValidator = new Map();
  for (const w of allWarnings) {
    const prev = byValidator.get(w.validator);
    if (!prev || (sev[w.severity] ?? 1) < (sev[prev.severity] ?? 1)) {
      byValidator.set(w.validator, w);
    }
  }
  const ranked = [...byValidator.values()].sort((a, b) => {
    return (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1);
  });
  const top = ranked.slice(0, 5);

  for (let i = 0; i < top.length; i++) {
    const w = top[i];
    const sev = w.severity === 'high' ? `${c.red}[HIGH]${c.reset}`
              : w.severity === 'low'  ? `${c.dim}[LOW]${c.reset}`
              : `${c.yellow}[MED]${c.reset}`;
    console.log(`   ${c.bold}${i + 1}.${c.reset} ${sev} ${c.cyan}${w.validator}${c.reset}`);
    console.log(`      ${c.dim}${w.message}${c.reset}`);
    const impact = getImpact(w.message);
    if (impact) {
      console.log(`      ${c.green}→${c.reset} ${impact}`);
    }
    console.log('');
  }

  if (allWarnings.length > top.length) {
    console.log(`   ${c.dim}... and ${allWarnings.length - top.length} more. Run \`docguard guard\` in your repo to see everything.${c.reset}\n`);
  }

  // Score line
  if (scoreData && typeof scoreData.score === 'number') {
    const grade = scoreData.score >= 90 ? 'A' : scoreData.score >= 80 ? 'B' : scoreData.score >= 70 ? 'C' : scoreData.score >= 60 ? 'D' : 'F';
    const color = scoreData.score >= 80 ? c.green : scoreData.score >= 60 ? c.yellow : c.red;
    console.log(`${c.bold}📊 CDD Maturity Score:${c.reset} ${color}${scoreData.score}/100 (${grade})${c.reset}`);
    console.log(`${c.dim}   ↑ This is the fixture's score. Yours will hopefully be higher.${c.reset}\n`);
  }
}

function printCTA() {
  console.log(`${c.bold}🛠️  Fixing drift like this:${c.reset}`);
  console.log(`   ${c.cyan}docguard fix --write${c.reset}      ${c.dim}— patches the mechanical stuff (version refs, counts, anchors)${c.reset}`);
  console.log(`   ${c.cyan}docguard sync --write${c.reset}     ${c.dim}— refreshes code-truth sections to match the codebase${c.reset}`);
  console.log(`   ${c.cyan}docguard diagnose${c.reset}         ${c.dim}— generates an AI prompt for the prose drift (Claude/GPT/Cursor)${c.reset}\n`);

  console.log(`${c.bold}🚀 Try it on YOUR project:${c.reset}`);
  console.log(`   ${c.green}npm install -g docguard-cli${c.reset}`);
  console.log(`   ${c.green}cd your-project${c.reset}`);
  console.log(`   ${c.green}docguard init${c.reset}              ${c.dim}— scans existing code and proposes canonical docs${c.reset}`);
  console.log(`   ${c.green}docguard guard${c.reset}             ${c.dim}— see what we catch${c.reset}\n`);

  console.log(`${c.dim}Or stay zero-install:${c.reset}`);
  console.log(`   ${c.green}npx docguard-cli init${c.reset}`);
  console.log(`   ${c.green}npx docguard-cli guard${c.reset}\n`);

  console.log(`${c.bold}📚 Learn more:${c.reset} ${c.cyan}https://github.com/raccioly/docguard${c.reset}`);
}

/**
 * Public entry point — `docguard demo`.
 *
 * @param {string} _projectDir — ignored; demo uses its own temp fixture
 * @param {object} _config — ignored
 * @param {object} flags — supports --quiet (skip banner) and --keep (don't cleanup fixture)
 */
export function runDemo(_projectDir, _config, flags = {}) {
  if (!flags.quiet) {
    console.log(`\n${c.bold}🎬 DocGuard Demo${c.reset} ${c.dim}— see what we catch in 30 seconds${c.reset}`);
    console.log(`${c.dim}   No install. No setup. We're running against a sample 4-service payments API${c.reset}`);
    console.log(`${c.dim}   with intentional drift between code and docs.${c.reset}\n`);
  }

  if (!existsSync(FIXTURE_SRC)) {
    console.error(`${c.red}Demo fixture not found at ${FIXTURE_SRC}.${c.reset}`);
    console.error(`${c.dim}If this is a packaging bug, please file an issue.${c.reset}`);
    process.exit(1);
  }

  let fixture;
  try {
    fixture = setupFixture();
    if (!flags.quiet) console.log(`${c.dim}   Fixture ready at ${fixture}${c.reset}\n`);
  } catch (err) {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
    console.error(`${c.red}Failed to set up demo fixture: ${err.message}${c.reset}`);
    process.exit(1);
  }

  // Run guard + score against the fixture
  let guardData, scoreData;
  try {
    // Load full config (defaults + fixture's .docguard.json) — same path the
    // real `docguard guard` uses. The fixture ships its own .docguard.json
    // so this hydrates the right project name + profile.
    const config = loadConfig(fixture);
    guardData = runGuardInternal(fixture, config);
    scoreData = runScoreInternal(fixture, config);
  } catch (err) {
    rmSync(fixture, { recursive: true, force: true });
    console.error(`${c.red}Demo guard run failed: ${err.message}${c.reset}`);
    process.exit(1);
  }

  presentResults(guardData, scoreData);
  printCTA();

  // Cleanup unless --keep
  if (!flags.keep) {
    rmSync(fixture, { recursive: true, force: true });
    if (!flags.quiet) console.log(`${c.dim}   Fixture cleaned up.${c.reset}`);
  } else {
    console.log(`${c.dim}   Fixture kept at ${fixture} (--keep)${c.reset}`);
  }

  // Always exit 0 — the demo is informational, never a failure
  process.exit(0);
}
