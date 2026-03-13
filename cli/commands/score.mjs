/**
 * Score Command — Calculate CDD maturity score (0-100)
 * Shows category breakdown with weighted scoring.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { c } from '../shared.mjs';

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

  const { scores, totalScore, grade, details } = calcAllScores(projectDir, config);

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
      const suggestion = getSuggestion(cat, score, details);
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

  // ── Multi-Signal Breakdown (--signals flag) ──
  // Inspired by CJE multi-signal composite scoring (Lopez et al., TRACE, IEEE TMLCN 2026)
  if (flags.signals) {
    console.log(`  ${c.bold}📡 Multi-Signal Quality Breakdown${c.reset}`);
    console.log(`  ${c.dim}─────────────────────────────────${c.reset}`);

    const signals = [
      { name: 'Structure',     score: scores.structure,    weight: WEIGHTS.structure,    description: 'Required files exist' },
      { name: 'Doc Quality',   score: scores.docQuality,   weight: WEIGHTS.docQuality,   description: 'Docs have required sections + content' },
      { name: 'Testing',       score: scores.testing,      weight: WEIGHTS.testing,      description: 'Test spec alignment' },
      { name: 'Security',      score: scores.security,     weight: WEIGHTS.security,     description: 'No hardcoded secrets, .gitignore' },
      { name: 'Environment',   score: scores.environment,  weight: WEIGHTS.environment,  description: 'Env docs, .env.example' },
      { name: 'Drift',         score: scores.drift,        weight: WEIGHTS.drift,        description: 'Drift tracking discipline' },
      { name: 'Changelog',     score: scores.changelog,    weight: WEIGHTS.changelog,    description: 'Changelog maintenance' },
      { name: 'Architecture',  score: scores.architecture, weight: WEIGHTS.architecture, description: 'Layer boundary compliance' },
    ];

    for (const sig of signals) {
      const weighted = Math.round((sig.score / 100) * sig.weight);
      const quality = sig.score >= 90 ? 'HIGH' : sig.score >= 50 ? 'MEDIUM' : 'LOW';
      const qColor = quality === 'HIGH' ? c.green : quality === 'MEDIUM' ? c.yellow : c.red;
      const bar = renderBar(sig.score);

      console.log(`  ${bar} ${qColor}[${quality}]${c.reset} ${sig.name.padEnd(14)} ${sig.score}% → ${c.bold}${weighted}/${sig.weight}${c.reset} pts  ${c.dim}${sig.description}${c.reset}`);
    }

    console.log(`\n  ${c.dim}Composite: Σ(signal_score × weight) = ${totalScore}/100${c.reset}`);
    console.log(`  ${c.dim}Quality labels: HIGH (≥90%), MEDIUM (50-89%), LOW (<50%)${c.reset}`);
    console.log(`  ${c.dim}Methodology: CJE multi-signal composite (Lopez et al., TRACE, IEEE TMLCN 2026)${c.reset}\n`);
  }

  // Badge snippet
  const bColor = totalScore >= 90 ? 'brightgreen' : totalScore >= 80 ? 'green' : totalScore >= 70 ? 'yellowgreen' : totalScore >= 60 ? 'yellow' : totalScore >= 50 ? 'orange' : 'red';
  const badgeUrl = `https://img.shields.io/badge/CDD_Score-${totalScore}%2F100_(${grade})-${bColor}`;
  console.log(`  ${c.dim}📎 Badge: ![CDD Score](${badgeUrl})${c.reset}\n`);
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
  const details = {}; // Per-category failure details for actionable suggestions

  scores.structure = calcStructureScore(projectDir, config);
  const dqResult = calcDocQualityScore(projectDir, config);
  scores.docQuality = dqResult.score;
  details.docQuality = dqResult.failures;
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

  return { scores, totalScore, grade: getGrade(totalScore), details };
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
  const failures = []; // Track specific failures for actionable suggestions

  for (const [file, sections] of Object.entries(checks)) {
    const fullPath = resolve(dir, file);
    if (!existsSync(fullPath)) {
      failures.push({ file, issue: 'file missing' });
      continue;
    }

    const content = readFileSync(fullPath, 'utf-8');
    const docName = file.replace('docs-canonical/', '').replace('.md', '').toLowerCase();

    for (const section of sections) {
      total++;
      if (content.includes(section)) {
        found++;
      } else {
        failures.push({ file, issue: `missing section: ${section}`, fixCmd: `docguard fix --doc ${docName}` });
      }
    }

    // Check if doc has more than just template placeholders
    total++;
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>') && !l.startsWith('<!--'));
    if (lines.length > 5) {
      found++;
    } else {
      failures.push({ file, issue: `thin content (${lines.length} lines — need >5)`, fixCmd: `docguard fix --doc ${docName}` });
    }
  }

  const score = total === 0 ? 0 : Math.round((found / total) * 100);
  return { score, failures };
}

function calcTestingScore(dir, config) {
  let score = 0;

  // Check test directory exists
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];
  const hasTestDir = testDirs.some(d => existsSync(resolve(dir, d)));
  if (hasTestDir) score += 40;

  // Check test spec exists
  if (existsSync(resolve(dir, 'docs-canonical/TEST-SPEC.md'))) score += 30;

  // Check for test config files OR built-in test runner
  const testConfigs = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', 'pytest.ini', 'setup.cfg', '.mocharc.yml'];
  const hasTestConfig = testConfigs.some(f => existsSync(resolve(dir, f)));

  if (hasTestConfig) {
    score += 15;
  } else {
    // Check if using node:test (no config needed) — look in package.json scripts
    const ptc = config.projectTypeConfig || {};
    const pkgPath = resolve(dir, 'package.json');
    if (ptc.testFramework === 'node:test') {
      score += 15; // Config says node:test — no config file needed
    } else if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const testScript = pkg.scripts?.test || '';
        if (testScript.includes('node --test') || testScript.includes('node:test')) {
          score += 15; // Using built-in test runner
        }
      } catch { /* skip */ }
    }
  }

  // Check for CI test step
  const ciFiles = ['.github/workflows/ci.yml', '.github/workflows/test.yml'];
  const hasCITest = ciFiles.some(f => existsSync(resolve(dir, f)));
  if (hasCITest) score += 15;

  return Math.min(100, score);
}

function calcSecurityScore(dir, config) {
  let score = 0;
  const ptc = config.projectTypeConfig || {};

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

  // .env.example exists (safe template) — only check if project needs env vars
  if (ptc.needsEnvExample === false) {
    score += 15; // Full marks — project doesn't need env vars
  } else if (existsSync(resolve(dir, '.env.example'))) {
    score += 15;
  }

  return Math.min(100, score);
}

function calcEnvironmentScore(dir, config) {
  let score = 0;
  const ptc = config.projectTypeConfig || {};

  if (existsSync(resolve(dir, 'docs-canonical/ENVIRONMENT.md'))) score += 40;

  // .env.example — only check if project needs env vars
  if (ptc.needsEnvExample === false) {
    score += 30; // Full marks — project doesn't need env vars
  } else if (existsSync(resolve(dir, '.env.example'))) {
    score += 30;
  }

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

function getSuggestion(category, score, details) {
  // Dynamic, specific suggestions based on actual failures
  if (category === 'docQuality' && details?.docQuality?.length > 0) {
    const failures = details.docQuality;
    // Group by doc
    const byDoc = {};
    for (const f of failures) {
      const doc = f.file.replace('docs-canonical/', '');
      if (!byDoc[doc]) byDoc[doc] = [];
      byDoc[doc].push(f.issue);
    }
    const parts = Object.entries(byDoc).map(([doc, issues]) => `${doc}: ${issues.join(', ')}`);
    const fixCmd = failures.find(f => f.fixCmd)?.fixCmd || 'docguard fix';
    return `${parts.join(' | ')} → Run \`${fixCmd}\``;
  }

  const suggestions = {
    structure: 'Run `docguard init` to create missing documentation',
    docQuality: 'Run `docguard fix` to get AI prompts for each doc that needs content',
    testing: 'Add tests/ directory and configure TEST-SPEC.md',
    security: 'Create SECURITY.md and add .env to .gitignore → Run `docguard fix --doc security`',
    environment: 'Document env variables and create .env.example → Run `docguard fix --doc environment`',
    drift: 'Create DRIFT-LOG.md and log any code deviations',
    changelog: 'Maintain CHANGELOG.md with [Unreleased] section',
    architecture: 'Add layer boundaries and Mermaid diagrams → Run `docguard fix --doc architecture`',
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
