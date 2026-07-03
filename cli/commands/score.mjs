/**
 * Score Command — Calculate CDD maturity score (0-100)
 * Shows category breakdown with weighted scoring.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { c, docHasSection } from '../shared.mjs';
import { validateSecurity } from '../validators/security.mjs';
import { runGuardInternal } from './guard.mjs';

/**
 * Detect whether the project configures a test runner (the "Check 3" of the
 * testing score). Extracted as an exported seam so it's unit-testable without
 * the full score pipeline.
 *
 * Recognises, in order: standalone config files; pytest config inside
 * pyproject.toml / tox.ini; node:test via projectTypeConfig or scripts.test;
 * a `scripts.test` that invokes a known runner; Vitest configured INSIDE
 * vite.config.* (field report #3 — `vitest/config` import or a `test:` block);
 * and runner configs in common workspace subdirs.
 *
 * @param {string} dir
 * @param {object} config
 * @returns {boolean}
 */
export function detectTestRunner(dir, config = {}) {
  const testConfigFiles = ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', 'pytest.ini', 'setup.cfg', '.mocharc.yml'];
  if (testConfigFiles.some((f) => existsSync(resolve(dir, f)))) return true;

  // Python: pytest config usually lives inside pyproject.toml ([tool.pytest.ini_options])
  // or tox.ini ([pytest]) — not a standalone file.
  for (const [file, marker] of [['pyproject.toml', /\[tool\.pytest/], ['tox.ini', /\[pytest\]/]]) {
    const p = resolve(dir, file);
    if (!existsSync(p)) continue;
    try { if (marker.test(readFileSync(p, 'utf-8'))) return true; } catch { /* skip */ }
  }

  // node:test has no config file — recognize it via projectTypeConfig or package.json.
  const ptc = config.projectTypeConfig || {};
  if (ptc.testFramework === 'node:test') return true;
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const testScript = pkg.scripts?.test || '';
      if (testScript.includes('node --test') || testScript.includes('node:test')) return true;
      // v0.27 (field report #3): a `scripts.test` that runs a known runner IS a
      // configured test runner, even without a standalone config file.
      if (/\b(vitest|jest|mocha|ava|playwright|cypress|pytest)\b/.test(testScript)) return true;
    } catch { /* skip */ }
  }

  // v0.27 (field report #3): Vitest configured INSIDE vite.config.* rather than a
  // standalone vitest.config (`vitest/config` import + a `test:` block).
  for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    const p = resolve(dir, f);
    if (!existsSync(p)) continue;
    try {
      const src = readFileSync(p, 'utf-8');
      if (/vitest\/config/.test(src) || /^\s*test\s*:/m.test(src)) return true;
    } catch { /* skip */ }
  }

  // Workspace subdirs: a runner config one level down still configures the project.
  const subConfigs = ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js', 'vite.config.ts'];
  for (const sub of ['backend', 'frontend', 'server', 'client', 'app', 'web', 'api']) {
    for (const f of subConfigs) {
      if (existsSync(resolve(dir, sub, f))) return true;
    }
  }

  return false;
}

/**
 * v0.18-P3: map score categories to the validator keys that contribute.
 * One category can roll up multiple validators (e.g. "environment" pulls
 * from Environment validator findings). When --diff fires, we use this
 * to surface the underlying warnings.
 */
const _SCORE_TO_VALIDATORS = {
  structure:    ['structure'],
  docQuality:   ['docQuality', 'docsCoverage', 'docsSync'],
  testing:      ['testSpec', 'todoTracking'],
  security:     ['security'],
  environment:  ['environment'],
  drift:        ['drift'],
  changelog:    ['changelog'],
  architecture: ['architecture'],
};

function _showScoreDiff(projectDir, config, scores) {
  console.log(`  ${c.bold}── Drill-down (--diff) ──${c.reset}\n`);
  // Pull live guard data; reuses the in-process plan cache so this is
  // cheap when run right after the score calc.
  const guard = runGuardInternal(projectDir, config);
  const byKey = new Map(guard.validators.map(v => [v.key, v]));

  let anyShown = false;
  for (const [category, score] of Object.entries(scores)) {
    if (score === 100) continue;
    const validatorKeys = _SCORE_TO_VALIDATORS[category];
    if (!validatorKeys) continue;
    const warnings = [];
    const errors = [];
    for (const k of validatorKeys) {
      const v = byKey.get(k);
      if (!v) continue;
      warnings.push(...(v.warnings || []));
      errors.push(...(v.errors || []));
    }
    if (warnings.length === 0 && errors.length === 0) continue;
    anyShown = true;
    console.log(`  ${c.yellow}${category}${c.reset} ${c.dim}(${score}/100)${c.reset}`);
    for (const e of errors.slice(0, 5)) console.log(`     ${c.red}✗${c.reset} ${e}`);
    for (const w of warnings.slice(0, 5)) console.log(`     ${c.yellow}⚠${c.reset} ${w}`);
    const totalIssues = errors.length + warnings.length;
    if (totalIssues > 5) console.log(`     ${c.dim}... ${totalIssues - 5} more${c.reset}`);
    console.log('');
  }

  if (!anyShown) {
    console.log(`  ${c.dim}No specific findings available for the weakest categories. They may be scoring below 100 due to structural/quality heuristics rather than discrete check failures.${c.reset}\n`);
  } else {
    console.log(`  ${c.dim}Fix options:${c.reset}`);
    console.log(`    ${c.dim}• Run ${c.cyan}docguard explain "<warning>"${c.dim} for the full validator help on any line above${c.reset}`);
    console.log(`    ${c.dim}• Run ${c.cyan}docguard fix --write${c.dim} for the mechanical fixes${c.reset}`);
  }
}

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
  // v0.16-P1: suppress banner in JSON mode so stdout stays parseable.
  // Was already fixed for guard/diagnose in v0.12; score/trace/diff missed
  // the pattern. Reported on a Python project where `score --format json`
  // mixed ANSI escapes with JSON.
  const isJson = flags.format === 'json';
  if (!isJson) {
    console.log(`${c.bold}📊 DocGuard Score — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);
  }

  const { scores, totalScore, grade, details } = calcAllScores(projectDir, config);

  // ── "Memory" framing: split signals into Completeness vs Accuracy ──
  // Completeness = "is the memory whole?"  Accuracy = "does it match code?"
  // No weight changes — just a derived view of the existing per-category scores.
  const COMPLETENESS = new Set(['structure', 'docQuality']);
  const memory = (() => {
    let cW = 0, cP = 0, aW = 0, aP = 0;
    for (const [cat, s] of Object.entries(scores)) {
      const w = WEIGHTS[cat] || 0;
      if (COMPLETENESS.has(cat)) { cW += w; cP += s * w; }
      else { aW += w; aP += s * w; }
    }
    return {
      completeness: cW ? Math.round(cP / cW) : 0,
      accuracy: aW ? Math.round(aP / aW) : 0,
    };
  })();

  // ── Display Results ──
  if (flags.format === 'json') {
    const result = {
      project: config.projectName,
      score: totalScore,
      grade,
      memory,
      categories: {},
    };
    for (const [cat, score] of Object.entries(scores)) {
      result.categories[cat] = {
        score,
        weight: WEIGHTS[cat],
        weighted: Math.round((score / 100) * WEIGHTS[cat]),
        axis: COMPLETENESS.has(cat) ? 'completeness' : 'accuracy',
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
  // Memory framing: is the documentation memory COMPLETE and ACCURATE?
  const memColor = (s) => s >= 80 ? c.green : s >= 60 ? c.yellow : c.red;
  console.log(`  ${c.dim}Memory:${c.reset} ${memColor(memory.completeness)}Completeness ${memory.completeness}%${c.reset} ${c.dim}·${c.reset} ${memColor(memory.accuracy)}Accuracy ${memory.accuracy}%${c.reset}`);

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

  // v0.18-P3: --diff drill-down. Symmetric to v0.17 memory --diff.
  // Shows WHICH specific checks dragged each weak category down by joining
  // the guard validator warnings to score categories. Cheap: we already
  // import runGuardInternal; one extra guard run on `--diff` is acceptable.
  if (flags.diff) {
    _showScoreDiff(projectDir, config, scores);
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

  // ── ALCOA+ Compliance Scoring ──
  // Maps existing validators to the 9 ALCOA+ attributes (FDA data integrity framework)
  // Always shown — gives enterprise positioning value
  const alcoa = computeAlcoaCompliance(projectDir, config, scores);

  console.log(`  ${c.bold}🏛️  ALCOA+ Compliance${c.reset} ${c.dim}(FDA Data Integrity Framework)${c.reset}`);
  console.log(`  ${c.dim}─────────────────────────────────${c.reset}`);

  for (const attr of alcoa.attributes) {
    const icon = attr.met ? `${c.green}✅` : `${c.yellow}⚠️`;
    const status = attr.met ? `${c.green}${attr.evidence}` : `${c.yellow}${attr.gap}`;
    console.log(`  ${icon} ${attr.name.padEnd(16)}${c.reset} — ${status}${c.reset}`);
    if (!attr.met && attr.fix) {
      console.log(`  ${c.dim}     Fix: ${attr.fix}${c.reset}`);
    }
  }

  const alcoaColor = alcoa.score >= 78 ? c.green : alcoa.score >= 56 ? c.yellow : c.red;
  console.log(`\n  ${alcoaColor}${c.bold}ALCOA+ Score: ${alcoa.score}% (${alcoa.met}/${alcoa.total} attributes)${c.reset}`);
  if (alcoa.met < alcoa.total) {
    console.log(`  ${c.dim}${alcoa.total - alcoa.met} action(s) needed for full compliance${c.reset}`);
  }
  console.log('');

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

/**
 * ALCOA+ Compliance Scoring
 *
 * Maps DocGuard's existing validators to the 9 ALCOA+ attributes
 * (FDA 21 CFR Part 11 / EMA Annex 11 data integrity framework).
 *
 * ALCOA+ = Attributable, Legible, Contemporaneous, Original, Accurate
 *        + Complete, Consistent, Enduring, Available
 *
 * Reference: WHO Technical Report Series, No. 996, 2016, Annex 5
 */
function computeAlcoaCompliance(projectDir, config, scores) {
  const attributes = [];

  // 1. Attributable — Can we trace who wrote/reviewed docs?
  const hasGit = existsSync(resolve(projectDir, '.git'));
  const docsDir = resolve(projectDir, 'docs-canonical');
  let hasReviewedMeta = false;
  if (existsSync(docsDir)) {
    try {
      const docs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
      for (const doc of docs) {
        const content = readFileSync(join(docsDir, doc), 'utf-8');
        if (content.includes('docguard:last-reviewed') || content.includes('last-reviewed')) {
          hasReviewedMeta = true;
          break;
        }
      }
    } catch { /* ignore */ }
  }
  attributes.push({
    name: 'Attributable',
    met: hasGit,
    evidence: hasGit ? `Git authorship found${hasReviewedMeta ? ', review metadata present' : ''}` : null,
    gap: !hasGit ? 'No version control found' : null,
    fix: !hasGit ? 'Initialize git repository: git init' : null,
  });

  // 2. Legible — Are docs readable and well-written?
  const legible = scores.docQuality >= 60;
  attributes.push({
    name: 'Legible',
    met: legible,
    evidence: legible ? `Doc quality score: ${scores.docQuality}% (readable)` : null,
    gap: !legible ? `Doc quality score: ${scores.docQuality}% (needs improvement)` : null,
    fix: !legible ? 'Run docguard diagnose for specific readability improvements' : null,
  });

  // 3. Contemporaneous — Are docs kept current?
  let freshnessMet = true;
  if (existsSync(docsDir)) {
    try {
      const docs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
      for (const doc of docs) {
        const stat_ = statSync(join(docsDir, doc));
        const daysSinceModified = (Date.now() - stat_.mtimeMs) / (1000 * 60 * 60 * 24);
        if (daysSinceModified > 30) {
          freshnessMet = false;
          break;
        }
      }
    } catch { /* ignore */ }
  }
  attributes.push({
    name: 'Contemporaneous',
    met: freshnessMet,
    evidence: freshnessMet ? 'All docs updated within 30 days' : null,
    gap: !freshnessMet ? 'Some docs not updated in 30+ days' : null,
    fix: !freshnessMet ? 'Review and update stale docs, add <!-- docguard:last-reviewed YYYY-MM-DD -->' : null,
  });

  // 4. Original — Are docs stored as originals (not copies)?
  const hasCanonicalDir = existsSync(docsDir);
  attributes.push({
    name: 'Original',
    met: hasCanonicalDir,
    evidence: hasCanonicalDir ? 'Canonical docs present as markdown originals' : null,
    gap: !hasCanonicalDir ? 'No docs-canonical/ directory found' : null,
    fix: !hasCanonicalDir ? 'Run docguard init to create canonical documentation' : null,
  });

  // 5. Accurate — Do docs match the code?
  const accurate = scores.drift >= 80 && scores.docQuality >= 50;
  attributes.push({
    name: 'Accurate',
    met: accurate,
    evidence: accurate ? `Drift: ${scores.drift}%, doc quality: ${scores.docQuality}%` : null,
    gap: !accurate ? `Drift: ${scores.drift}%, doc quality: ${scores.docQuality}% — docs may be inaccurate` : null,
    fix: !accurate ? 'Run docguard diagnose to find doc/code mismatches' : null,
  });

  // 6. Complete — Are all required docs present?
  const complete = scores.structure >= 80;
  attributes.push({
    name: 'Complete',
    met: complete,
    evidence: complete ? `Structure score: ${scores.structure}% — required docs present` : null,
    gap: !complete ? `Structure score: ${scores.structure}% — missing required docs` : null,
    fix: !complete ? 'Run docguard init to create missing documentation' : null,
  });

  // 7. Consistent — Are versions, metadata, and references in sync?
  const consistent = scores.changelog >= 50;
  attributes.push({
    name: 'Consistent',
    met: consistent,
    evidence: consistent ? `Changelog: ${scores.changelog}% — versions tracked` : null,
    gap: !consistent ? `Changelog: ${scores.changelog}% — version inconsistencies` : null,
    fix: !consistent ? 'Update CHANGELOG.md with [Unreleased] section and version headers' : null,
  });

  // 8. Enduring — Will docs survive infrastructure changes?
  const enduring = hasGit;
  attributes.push({
    name: 'Enduring',
    met: enduring,
    evidence: enduring ? 'Git-backed repository with version history' : null,
    gap: !enduring ? 'No version control — docs could be lost' : null,
    fix: !enduring ? 'Initialize git repository: git init' : null,
  });

  // 9. Available — Can anyone access the docs?
  const available = hasCanonicalDir;
  attributes.push({
    name: 'Available',
    met: available,
    evidence: available ? 'Docs in plain markdown — no vendor lock-in, universally accessible' : null,
    gap: !available ? 'No docs directory found' : null,
    fix: !available ? 'Run docguard init to create accessible documentation' : null,
  });

  const met = attributes.filter(a => a.met).length;
  const total = attributes.length;
  const score = Math.round((met / total) * 100);

  return { attributes, met, total, score };
}

function calcAllScores(projectDir, config) {
  const scores = {};
  const details = {}; // Per-category failure details for actionable suggestions

  // Every calc*Score returns { score, failures } so the "Top improvements"
  // line can name the sub-checks that actually failed instead of printing a
  // static per-category template (field report, Issue B).
  for (const [cat, fn] of [
    ['structure',    calcStructureScore],
    ['docQuality',   calcDocQualityScore],
    ['testing',      calcTestingScore],
    ['security',     calcSecurityScore],
    ['environment',  calcEnvironmentScore],
    ['drift',        calcDriftScore],
    ['changelog',    calcChangelogScore],
    ['architecture', calcArchitectureScore],
  ]) {
    const { score, failures } = fn(projectDir, config);
    scores[cat] = score;
    details[cat] = failures || [];
  }

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
  const failures = [];

  for (const file of config.requiredFiles.canonical) {
    total++;
    if (existsSync(resolve(dir, file))) found++;
    else failures.push({ issue: `missing ${file}` });
  }

  total++;
  const hasAgent = config.requiredFiles.agentFile.some(f => existsSync(resolve(dir, f)));
  if (hasAgent) found++;
  else failures.push({ issue: `missing agent file (${config.requiredFiles.agentFile.join(' or ')})` });

  total++;
  if (existsSync(resolve(dir, config.requiredFiles.changelog))) found++;
  else failures.push({ issue: `missing ${config.requiredFiles.changelog}` });

  total++;
  if (existsSync(resolve(dir, config.requiredFiles.driftLog))) found++;
  else failures.push({ issue: `missing ${config.requiredFiles.driftLog}` });

  const score = total === 0 ? 0 : Math.round((found / total) * 100);
  return { score, failures };
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
      // v0.24: synonym/number-tolerant (docHasSection) so arc42/C4 headings
      // count — was a literal substring check that flagged equivalent sections
      // as missing, making structured docs score worse than the skeleton.
      if (docHasSection(content, section)) {
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
  const failures = [];

  // ── Check 1: Test files exist (40 pts) ──
  // Check top-level test directories
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];
  const hasTopLevelTestDir = testDirs.some(d => existsSync(resolve(dir, d)));

  // Check co-located tests: **/__tests__/ and **/*.test.* / **/*.spec.*
  // Scan ALL common source roots — not just src/, also backend/, packages/, etc.
  let hasColocatedTests = false;
  if (!hasTopLevelTestDir) {
    hasColocatedTests = findColocatedTests(dir);
  }

  // Check if testPatterns config points to existing test locations
  let hasPatternTests = false;
  if (!hasTopLevelTestDir && !hasColocatedTests) {
    const patterns = config.testPatterns || [];
    if (patterns.length > 0) {
      for (const pattern of patterns) {
        // Extract the root directory from the pattern
        const rootDir = pattern.split('/')[0].split('*')[0];
        if (rootDir && existsSync(resolve(dir, rootDir))) {
          hasPatternTests = true;
          break;
        }
      }
    }
  }

  // Check vitest/jest config for custom test patterns
  let hasConfigTests = false;
  if (!hasTopLevelTestDir && !hasColocatedTests && !hasPatternTests) {
    const testConfigs = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'jest.config.ts', 'jest.config.js'];
    for (const cfgFile of testConfigs) {
      const cfgPath = resolve(dir, cfgFile);
      if (existsSync(cfgPath)) {
        try {
          const cfgContent = readFileSync(cfgPath, 'utf-8');
          const includeMatch = cfgContent.match(/include\s*:\s*\[([^\]]+)\]/);
          if (includeMatch) {
            const patterns = includeMatch[1].match(/['"]([^'"]+)['"]/g);
            if (patterns) {
              for (const p of patterns) {
                const pattern = p.replace(/['"]|\s/g, '');
                const rootDir = pattern.split('/')[0];
                if (rootDir && rootDir !== '**' && rootDir !== '*') {
                  const fullDir = resolve(dir, rootDir);
                  if (existsSync(fullDir)) {
                    hasConfigTests = true;
                    break;
                  }
                }
              }
            }
          }
        } catch { /* config parse may fail */ }
        break;
      }
    }
  }

  if (hasTopLevelTestDir || hasColocatedTests || hasPatternTests || hasConfigTests) score += 40;
  else failures.push({ issue: 'no test files found (looked in tests/, src/**/__tests__, and configured testPatterns)' });

  // ── Check 2: TEST-SPEC.md exists (30 pts) ──
  if (existsSync(resolve(dir, 'docs-canonical/TEST-SPEC.md'))) score += 30;
  else failures.push({ issue: 'TEST-SPEC.md missing', fixCmd: 'docguard fix --doc test-spec' });

  // ── Check 3: Test config or built-in runner (15 pts) ──
  if (detectTestRunner(dir, config)) score += 15;
  else failures.push({ issue: 'no test runner config detected (jest/vitest/pytest/node:test)' });

  // ── Check 4: CI test step (15 pts) ──
  // Support multiple CI systems — not just GitHub Actions
  const ciFiles = [
    '.github/workflows/ci.yml', '.github/workflows/test.yml',
    '.github/workflows/ci.yaml', '.github/workflows/test.yaml',
    'buildspec.yml', 'buildspec.test.yml',     // AWS CodeBuild
    'amplify.yml',                              // AWS Amplify
    'Jenkinsfile',                              // Jenkins
    '.circleci/config.yml',                     // CircleCI
    '.gitlab-ci.yml',                           // GitLab CI
    '.travis.yml',                              // Travis CI
  ];
  let hasCITest = ciFiles.some(f => existsSync(resolve(dir, f)));

  // Also check turbo.json for "test" pipeline task
  if (!hasCITest) {
    const turboPath = resolve(dir, 'turbo.json');
    if (existsSync(turboPath)) {
      try {
        const turboContent = readFileSync(turboPath, 'utf-8');
        if (/"test"/.test(turboContent)) hasCITest = true;
      } catch { /* skip */ }
    }
  }

  if (hasCITest) score += 15;
  else failures.push({ issue: 'no CI test step (.github/workflows, .gitlab-ci.yml, Jenkinsfile, etc.)' });

  return { score: Math.min(100, score), failures };
}

/**
 * Scan common source directories for co-located test files.
 * Checks: __tests__/ dirs, *.test.*, *.spec.* anywhere in src/, app/, lib/, packages/
 * Also checks root-level for *.test.* files.
 */
function findColocatedTests(dir) {
  // Scan these common source roots for co-located tests
  // Includes backend/, server/ for monorepo-style projects (e.g., backend/src/__tests__/)
  const sourceRoots = ['src', 'app', 'lib', 'packages', 'modules', 'backend', 'server'];
  const ignoreSet = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache']);

  for (const root of sourceRoots) {
    const rootDir = resolve(dir, root);
    if (!existsSync(rootDir)) continue;
    if (walkForTests(rootDir, ignoreSet)) return true;
  }

  // Also check root-level for *.test.* files (some projects put tests at root)
  try {
    const rootEntries = readdirSync(dir);
    for (const entry of rootEntries) {
      if (/\.(test|spec)\.[^.]+$/.test(entry)) return true;
    }
  } catch { /* ignore */ }

  return false;
}

/** Recursively walk a dir looking for test files. Returns true as soon as one is found. */
function walkForTests(d, ignoreSet) {
  let entries;
  try { entries = readdirSync(d); } catch { return false; }
  for (const entry of entries) {
    if (ignoreSet.has(entry) || entry.startsWith('.')) continue;
    const full = join(d, entry);
    try {
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === '__tests__' || entry === '__test__') return true;
        if (walkForTests(full, ignoreSet)) return true;
      } else {
        if (/\.(test|spec)\.[^.]+$/.test(entry)) return true;
      }
    } catch { continue; }
  }
  return false;
}

function calcSecurityScore(dir, config) {
  let score = 0;
  const ptc = config.projectTypeConfig || {};
  const failures = [];

  // SECURITY.md exists (25 pts)
  if (existsSync(resolve(dir, 'docs-canonical/SECURITY.md'))) score += 25;
  else failures.push({ issue: 'SECURITY.md missing', fixCmd: 'docguard fix --doc security' });

  // .gitignore exists and includes .env (15 + 15 pts)
  const gitignorePath = resolve(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    score += 15;
    const content = readFileSync(gitignorePath, 'utf-8');
    if (content.includes('.env')) score += 15;
    else failures.push({ issue: '.gitignore does not list .env' });
  } else {
    failures.push({ issue: '.gitignore missing' });
  }

  // No .env file committed (10 pts)
  if (!existsSync(resolve(dir, '.env')) || existsSync(gitignorePath)) score += 10;
  else failures.push({ issue: '.env is committed without a .gitignore' });

  // .env.example exists (safe template) — only check if project needs env vars (10 pts)
  if (ptc.needsEnvExample === false) {
    score += 10; // Full marks — project doesn't need env vars
  } else if (existsSync(resolve(dir, '.env.example'))) {
    score += 10;
  } else {
    failures.push({ issue: '.env.example missing' });
  }

  // No hardcoded secrets found by security validator (25 pts)
  // Commands MAY compose validator results (Constitution IV, v1.1.0)
  try {
    const secResults = validateSecurity(dir, config);
    if (secResults.errors.length === 0) {
      score += 25;
    } else {
      // Partial credit: deduct proportionally, but give at least some credit
      // if there are few findings relative to project size
      const findingCount = secResults.errors.length;
      if (findingCount <= 2) score += 15;
      else if (findingCount <= 5) score += 5;
      // 6+ findings = 0 pts for this check
      failures.push({ issue: `${findingCount} possible secret(s) / unsafe pattern(s) in code — run \`docguard guard --verbose\`` });
    }
  } catch {
    // If validator fails to run, give benefit of the doubt
    score += 25;
  }

  return { score: Math.min(100, score), failures };
}

function calcEnvironmentScore(dir, config) {
  let score = 0;
  const ptc = config.projectTypeConfig || {};
  const failures = [];

  if (existsSync(resolve(dir, 'docs-canonical/ENVIRONMENT.md'))) score += 40;
  else failures.push({ issue: 'ENVIRONMENT.md missing', fixCmd: 'docguard fix --doc environment' });

  // .env.example — only check if project needs env vars
  if (ptc.needsEnvExample === false) {
    score += 30; // Full marks — project doesn't need env vars
  } else if (existsSync(resolve(dir, '.env.example'))) {
    score += 30;
  } else {
    failures.push({ issue: '.env.example missing' });
  }

  // Check for setup documentation
  const readmePath = resolve(dir, 'README.md');
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, 'utf-8');
    if (content.includes('## Setup') || content.includes('## Getting Started') || content.includes('Quick Start')) {
      score += 30;
    } else {
      score += 15;  // README exists but no setup section
      failures.push({ issue: 'README has no Setup / Getting Started section' });
    }
  } else {
    failures.push({ issue: 'README.md missing' });
  }

  return { score: Math.min(100, score), failures };
}

function calcDriftScore(dir, config) {
  // Perfect score if drift log exists and no unlogged drift comments
  if (!existsSync(resolve(dir, config.requiredFiles.driftLog))) {
    return { score: 0, failures: [{ issue: `${config.requiredFiles.driftLog} missing` }] };
  }

  let score = 50; // Drift log exists
  const failures = [];

  const content = readFileSync(resolve(dir, config.requiredFiles.driftLog), 'utf-8');

  // Has structure (headers)
  if (content.includes('## ') || content.includes('| ')) score += 25;
  else failures.push({ issue: `${config.requiredFiles.driftLog} has no headers or table structure` });

  // Has entries (not just template)
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
  if (lines.length > 3) score += 25;
  else failures.push({ issue: `${config.requiredFiles.driftLog} has no entries yet (template only)` });

  return { score: Math.min(100, score), failures };
}

function calcChangelogScore(dir, config) {
  const path = resolve(dir, config.requiredFiles.changelog);
  if (!existsSync(path)) {
    return { score: 0, failures: [{ issue: `${config.requiredFiles.changelog} missing` }] };
  }

  let score = 40; // Exists
  const failures = [];
  const content = readFileSync(path, 'utf-8');

  if (content.includes('[Unreleased]') || content.includes('[unreleased]')) score += 30;
  else failures.push({ issue: 'no [Unreleased] section' });
  if (/## \[[\d.]+\]/.test(content)) score += 30;
  else failures.push({ issue: 'no versioned release headings (## [x.y.z])' });

  return { score: Math.min(100, score), failures };
}

function calcArchitectureScore(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) {
    return { score: 0, failures: [{ issue: 'ARCHITECTURE.md missing', fixCmd: 'docguard fix --doc architecture' }] };
  }

  let score = 30;
  const failures = [];
  const content = readFileSync(archPath, 'utf-8');

  // v0.24: heading checks are synonym/number-tolerant (docHasSection) so arc42
  // ("## 5.4 Layer boundaries") and C4 ("## Building Block View") docs score
  // their real content instead of being told to add sections they have.
  if (docHasSection(content, '## Layer Boundaries') || docHasSection(content, '## Component Map')) score += 25;
  else failures.push({ issue: 'no Layer Boundaries / Component Map section' });
  if (content.includes('```mermaid') || content.includes('graph ')) score += 20;
  else failures.push({ issue: 'no architecture diagram (mermaid / graph)' });
  if (docHasSection(content, '## External Dependencies')) score += 15;
  else failures.push({ issue: 'no External Dependencies section' });
  if (docHasSection(content, '## Revision History')) score += 10;
  else failures.push({ issue: 'no Revision History section' });

  return { score: Math.min(100, score), failures };
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

// Default fix command per category, used when a failure doesn't carry its own.
const CATEGORY_FIX = {
  structure:    'docguard init',
  docQuality:   'docguard fix',
  testing:      'docguard fix --doc test-spec',
  security:     'docguard fix --doc security',
  environment:  'docguard fix --doc environment',
  architecture: 'docguard fix --doc architecture',
};

// Static fallback — only reached if a category scores < 100 but recorded no
// specific failure (shouldn't happen now that every deduction tracks one).
const STATIC_SUGGESTIONS = {
  structure: 'Run `docguard init` to create missing documentation',
  docQuality: 'Run `docguard fix` to get AI prompts for each doc that needs content',
  testing: 'Add test files and create TEST-SPEC.md → Run `docguard fix --doc test-spec`',
  security: 'Create SECURITY.md and add .env to .gitignore → Run `docguard fix --doc security`',
  environment: 'Document env variables and create .env.example → Run `docguard fix --doc environment`',
  drift: 'Create DRIFT-LOG.md and log any code deviations',
  changelog: 'Maintain CHANGELOG.md with [Unreleased] section',
  architecture: 'Add layer boundaries and Mermaid diagrams → Run `docguard fix --doc architecture`',
};

function getSuggestion(category, score, details) {
  const failures = details?.[category];

  // docQuality groups its failures by doc (they carry { file, issue, fixCmd }).
  if (category === 'docQuality' && failures?.length > 0) {
    const byDoc = {};
    for (const f of failures) {
      const doc = (f.file || '').replace('docs-canonical/', '') || 'docs';
      if (!byDoc[doc]) byDoc[doc] = [];
      byDoc[doc].push(f.issue);
    }
    const parts = Object.entries(byDoc).map(([doc, issues]) => `${doc}: ${issues.join(', ')}`);
    const fixCmd = failures.find(f => f.fixCmd)?.fixCmd || CATEGORY_FIX.docQuality;
    return `${parts.join(' | ')} → Run \`${fixCmd}\``;
  }

  // Every other category: name the sub-checks that actually failed, so the line
  // never describes work that's already done (field report, Issue B).
  if (failures?.length > 0) {
    const base = failures.map(f => f.issue).join('; ');
    const fixCmd = failures.find(f => f.fixCmd)?.fixCmd || CATEGORY_FIX[category];
    return fixCmd ? `${base} → Run \`${fixCmd}\`` : base;
  }

  return STATIC_SUGGESTIONS[category] || 'Review and improve this area';
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
    const output = execFileSync('git', ['log', '--oneline', '--since=30 days ago'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 5
    }).trim();
    recentCommits = output ? output.split('\n').filter(Boolean).length : 0;
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
