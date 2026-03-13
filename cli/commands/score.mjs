/**
 * Score Command — Calculate CDD maturity score (0-100)
 * Shows category breakdown with weighted scoring.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { c } from '../docguard.mjs';

const WEIGHTS = {
  structure: 25,     // Required files exist
  docQuality: 20,    // Docs have required sections + content
  testing: 15,       // Test spec alignment
  security: 10,      // No hardcoded secrets, .gitignore
  environment: 10,   // Env docs, .env.example
  drift: 10,         // Drift tracking discipline
  changelog: 5,      // Changelog maintenance
  architecture: 5,   // Layer boundary compliance
};

export function runScore(projectDir, config, flags) {
  console.log(`${c.bold}📊 DocGuard Score — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const { scores, totalScore, grade } = calcAllScores(projectDir, config);

  // ── Display Results ──
  if (flags.format === 'json') {
    const result = {
      project: config.projectName,
      score: totalScore,
      grade,
      categories: {},
    };
    for (const [cat, score] of Object.entries(scores)) {
      result.categories[cat] = {
        score,
        weight: WEIGHTS[cat],
        weighted: Math.round((score / 100) * WEIGHTS[cat]),
      };
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Visual display
  console.log(`  ${c.bold}Category Breakdown${c.reset}\n`);

  for (const [category, score] of Object.entries(scores)) {
    const bar = renderBar(score);
    const label = category.padEnd(14);
    const weight = `(×${WEIGHTS[category]})`.padEnd(5);
    const weighted = Math.round((score / 100) * WEIGHTS[category]);
    console.log(`  ${label} ${bar} ${score}%  ${c.dim}${weight} = ${weighted} pts${c.reset}`);
  }

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);

  const gradeColor = totalScore >= 80 ? c.green : totalScore >= 60 ? c.yellow : c.red;
  console.log(`  ${gradeColor}${c.bold}CDD Maturity Score: ${totalScore}/100 (${grade})${c.reset}`);

  // Grade description
  const descriptions = {
    'A+': 'Excellent — CDD fully adopted',
    'A': 'Great — Strong CDD compliance',
    'B': 'Good — Most CDD practices in place',
    'C': 'Fair — Partial CDD adoption',
    'D': 'Needs Work — Significant gaps',
    'F': 'Not Started — Run `docguard init` first',
  };
  console.log(`  ${c.dim}${descriptions[grade]}${c.reset}\n`);

  // Suggestions
  const weakest = Object.entries(scores)
    .filter(([, s]) => s < 100)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);

  if (weakest.length > 0) {
    console.log(`  ${c.bold}Top improvements:${c.reset}`);
    for (const [cat, score] of weakest) {
      const suggestion = getSuggestion(cat, score);
      console.log(`  ${c.yellow}→ ${cat}${c.reset}: ${suggestion}`);
    }
    console.log('');
  }

  // ── Tax Estimate (--tax flag) ──
  if (flags.tax) {
    const tax = estimateDocTax(projectDir, config, scores);
    const taxColor = tax.level === 'LOW' ? c.green : tax.level === 'MEDIUM' ? c.yellow : c.red;

    console.log(`  ${c.bold}📋 Documentation Tax Estimate${c.reset}`);
    console.log(`  ${c.dim}─────────────────────────────────${c.reset}`);
    console.log(`  Tracked docs:        ${c.cyan}${tax.docCount}${c.reset} files`);
    console.log(`  Active profile:      ${c.cyan}${config.profile || 'standard'}${c.reset}`);
    console.log(`  Est. maintenance:    ${c.bold}~${tax.minutesPerWeek} min/week${c.reset}`);
    console.log(`  Tax-to-value ratio:  ${taxColor}${c.bold}${tax.level}${c.reset}`);
    console.log(`  ${c.dim}${tax.recommendation}${c.reset}\n`);
  }
}

/**
 * Internal scoring — returns data without printing.
 * Used by badge, ci, and other commands that need the score.
 */
export function runScoreInternal(projectDir, config) {
  const { scores, totalScore, grade } = calcAllScores(projectDir, config);
  return { score: totalScore, grade, categories: scores };
}

function calcAllScores(projectDir, config) {
  const scores = {};
  scores.structure = calcStructureScore(projectDir, config);
  scores.docQuality = calcDocQualityScore(projectDir, config);
  scores.testing = calcTestingScore(projectDir, config);
  scores.security = calcSecurityScore(projectDir, config);
  scores.environment = calcEnvironmentScore(projectDir, config);
  scores.drift = calcDriftScore(projectDir, config);
  scores.changelog = calcChangelogScore(projectDir, config);
  scores.architecture = calcArchitectureScore(projectDir, config);

  let totalScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    totalScore += (score / 100) * WEIGHTS[category];
  }
  totalScore = Math.round(totalScore);

  return { scores, totalScore, grade: getGrade(totalScore) };
}

// ── Scoring Functions ──────────────────────────────────────────────────────

function calcStructureScore(dir, config) {
  let found = 0;
  let total = 0;

  for (const file of config.requiredFiles.canonical) {
    total++;
    if (existsSync(resolve(dir, file))) found++;
  }

  total++;
  const hasAgent = config.requiredFiles.agentFile.some(f => existsSync(resolve(dir, f)));
  if (hasAgent) found++;

  total++;
  if (existsSync(resolve(dir, config.requiredFiles.changelog))) found++;

  total++;
  if (existsSync(resolve(dir, config.requiredFiles.driftLog))) found++;

  return total === 0 ? 0 : Math.round((found / total) * 100);
}

function calcDocQualityScore(dir, config) {
  const checks = {
    'docs-canonical/ARCHITECTURE.md': ['## System Overview', '## Component Map', '## Tech Stack'],
    'docs-canonical/DATA-MODEL.md': ['## Entities'],
    'docs-canonical/SECURITY.md': ['## Authentication', '## Secrets Management'],
    'docs-canonical/TEST-SPEC.md': ['## Test Categories', '## Coverage Rules'],
    'docs-canonical/ENVIRONMENT.md': ['## Environment Variables', '## Setup Steps'],
  };

  let found = 0;
  let total = 0;

  for (const [file, sections] of Object.entries(checks)) {
    const fullPath = resolve(dir, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');

    for (const section of sections) {
      total++;
      if (content.includes(section)) found++;
    }

    // Bonus: check if doc has docguard metadata
    total++;
    if (content.includes('docguard:version')) found++;

    // Bonus: check if doc has more than just template placeholders
    total++;
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>') && !l.startsWith('<!--'));
    if (lines.length > 5) found++;
  }

  return total === 0 ? 0 : Math.round((found / total) * 100);
}

function calcTestingScore(dir) {
  let score = 0;

  // Check test directory exists
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];
  const hasTestDir = testDirs.some(d => existsSync(resolve(dir, d)));
  if (hasTestDir) score += 40;

  // Check test spec exists
  if (existsSync(resolve(dir, 'docs-canonical/TEST-SPEC.md'))) score += 30;

  // Check for test config files
  const testConfigs = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', 'pytest.ini', 'setup.cfg', '.mocharc.yml'];
  const hasTestConfig = testConfigs.some(f => existsSync(resolve(dir, f)));
  if (hasTestConfig) score += 15;

  // Check for CI test step
  const ciFiles = ['.github/workflows/ci.yml', '.github/workflows/test.yml'];
  const hasCITest = ciFiles.some(f => existsSync(resolve(dir, f)));
  if (hasCITest) score += 15;

  return Math.min(100, score);
}

function calcSecurityScore(dir) {
  let score = 0;

  // SECURITY.md exists
  if (existsSync(resolve(dir, 'docs-canonical/SECURITY.md'))) score += 30;

  // .gitignore exists and includes .env
  const gitignorePath = resolve(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    score += 20;
    const content = readFileSync(gitignorePath, 'utf-8');
    if (content.includes('.env')) score += 20;
  }

  // No .env file committed (check if .env exists but .gitignore covers it)
  if (!existsSync(resolve(dir, '.env')) || existsSync(gitignorePath)) score += 15;

  // .env.example exists (safe template)
  if (existsSync(resolve(dir, '.env.example'))) score += 15;

  return Math.min(100, score);
}

function calcEnvironmentScore(dir) {
  let score = 0;

  if (existsSync(resolve(dir, 'docs-canonical/ENVIRONMENT.md'))) score += 40;
  if (existsSync(resolve(dir, '.env.example'))) score += 30;

  // Check for setup documentation
  const readmePath = resolve(dir, 'README.md');
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, 'utf-8');
    if (content.includes('## Setup') || content.includes('## Getting Started') || content.includes('Quick Start')) {
      score += 30;
    } else {
      score += 15;  // README exists but no setup section
    }
  }

  return Math.min(100, score);
}

function calcDriftScore(dir, config) {
  // Perfect score if drift log exists and no unlogged drift comments
  if (!existsSync(resolve(dir, config.requiredFiles.driftLog))) return 0;

  let score = 50; // Drift log exists

  const content = readFileSync(resolve(dir, config.requiredFiles.driftLog), 'utf-8');

  // Has structure (headers)
  if (content.includes('## ') || content.includes('| ')) score += 25;

  // Has entries (not just template)
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
  if (lines.length > 3) score += 25;

  return Math.min(100, score);
}

function calcChangelogScore(dir, config) {
  const path = resolve(dir, config.requiredFiles.changelog);
  if (!existsSync(path)) return 0;

  let score = 40; // Exists
  const content = readFileSync(path, 'utf-8');

  if (content.includes('[Unreleased]') || content.includes('[unreleased]')) score += 30;
  if (/## \[[\d.]+\]/.test(content)) score += 30;

  return Math.min(100, score);
}

function calcArchitectureScore(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return 0;

  let score = 30;
  const content = readFileSync(archPath, 'utf-8');

  if (content.includes('## Layer Boundaries') || content.includes('## Component Map')) score += 25;
  if (content.includes('```mermaid') || content.includes('graph ')) score += 20;
  if (content.includes('## External Dependencies')) score += 15;
  if (content.includes('## Revision History')) score += 10;

  return Math.min(100, score);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function renderBar(score) {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const color = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

function getGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function getSuggestion(category, score) {
  const suggestions = {
    structure: 'Run `docguard init` to create missing documentation',
    docQuality: 'Fill in template sections — replace placeholders with real content',
    testing: 'Add tests/ directory and configure TEST-SPEC.md',
    security: 'Create SECURITY.md and add .env to .gitignore',
    environment: 'Document env variables and create .env.example',
    drift: 'Create DRIFT-LOG.md and log any code deviations',
    changelog: 'Maintain CHANGELOG.md with [Unreleased] section',
    architecture: 'Add layer boundaries and Mermaid diagrams to ARCHITECTURE.md',
  };
  return suggestions[category] || 'Review and improve this area';
}

/**
 * Estimate documentation maintenance "tax" — how much time docs cost per week.
 * Based on: doc count, code churn, and current doc quality scores.
 */
function estimateDocTax(projectDir, config, scores) {
  // Count tracked docs
  const canonicalDir = resolve(projectDir, 'docs-canonical');
  let docCount = 0;
  if (existsSync(canonicalDir)) {
    try {
      docCount = readdirSync(canonicalDir).filter(f => f.endsWith('.md')).length;
    } catch { /* ignore */ }
  }
  // Add root tracking files
  if (existsSync(resolve(projectDir, 'CHANGELOG.md'))) docCount++;
  if (existsSync(resolve(projectDir, 'DRIFT-LOG.md'))) docCount++;

  // Estimate code churn (commits in last 30 days)
  let recentCommits = 0;
  try {
    const output = execSync('git log --oneline --since="30 days ago" 2>/dev/null | wc -l', {
      cwd: projectDir,
      encoding: 'utf-8',
    }).trim();
    recentCommits = parseInt(output, 10) || 0;
  } catch {
    recentCommits = 10; // Default assumption
  }

  // Calculate estimated minutes per week
  // Base: ~3 min per tracked doc per week (review time)
  // Churn multiplier: more commits = more potential doc updates
  const baseMinutes = docCount * 3;
  const churnMultiplier = recentCommits > 50 ? 1.5 : recentCommits > 20 ? 1.2 : 1.0;

  // Quality discount: higher scores = less rework needed
  const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  const qualityDiscount = avgScore > 80 ? 0.7 : avgScore > 60 ? 0.85 : 1.0;

  // AI discount: if docs are AI-maintained, tax drops significantly
  const aiDiscount = 0.3; // AI writes ~70% of docs

  const minutesPerWeek = Math.max(5, Math.round(baseMinutes * churnMultiplier * qualityDiscount * aiDiscount));

  // Determine tax level
  let level, recommendation;
  if (minutesPerWeek <= 10) {
    level = 'LOW';
    recommendation = 'Docs save more time than they cost. Current setup is sustainable.';
  } else if (minutesPerWeek <= 25) {
    level = 'MEDIUM';
    recommendation = 'Consider using `docguard fix --doc` to let AI handle updates.';
  } else {
    level = 'HIGH';
    recommendation = 'Consider switching to "starter" profile to reduce doc overhead.';
  }

  return { docCount, minutesPerWeek, level, recommendation };
}
