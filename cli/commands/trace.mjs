/**
 * Trace Command — Generate a requirements traceability matrix
 * Maps canonical docs ↔ source code ↔ tests → produces a traceability report.
 *
 * Inspired by requirements traceability in Lopez et al., AITPG (IEEE TSE 2026)
 * and ISO/IEC/IEEE 29119 traceability requirements.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename, relative, dirname } from 'node:path';
import { c } from '../shared.mjs';
import { detectSpecKit } from '../scanners/speckit.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs',
]);

// v0.16-P2: language-aware patterns. The original JS/TS-only sets created
// false-negative warnings on Python/Rust/Go/Java projects (reported by the
// quick-recon-tool Python user: TEST-SPEC.md was flagged unlinked even
// though Python tests existed because `.test.mjs` didn't match `test_*.py`).
import { TEST_PATTERNS, TRACE_MAP, isTraceableSource } from '../shared-trace-patterns.mjs';


/**
 * L-2 / S-3 — Reverse trace: given a code file, find which canonical doc
 * sections mention it. Mirror of the forward trace (doc → code).
 *
 * Match strategies (each yields a hit):
 *   1. Direct path match: full project-relative path appears in doc text.
 *   2. Basename match: e.g. `users.ts` appears (covers cases where the doc
 *      refers to the file by name without the full path).
 *   3. Module name match: file stem (e.g. `users`) appears as a fenced
 *      `code` reference. Tighter than 2 — avoids matching common nouns.
 *
 * Output: one line per (doc, match-line) pair, with the surrounding context.
 */
export function runTraceReverse(projectDir, config, flags) {
  const target = flags.args && flags.args[0];
  if (!target) {
    console.error(`${c.red}Error: trace --reverse requires a target path${c.reset}`);
    console.log(`Usage: ${c.cyan}docguard trace --reverse <code-path>${c.reset}`);
    console.log(`Example: ${c.cyan}docguard trace --reverse src/routes/users.ts${c.reset}`);
    process.exit(1);
  }

  // Suppress chrome in JSON mode so stdout stays parseable.
  const isJson = flags.format === 'json';
  if (!isJson) {
    console.log(`${c.bold}🔄 DocGuard Trace (reverse) — ${target}${c.reset}`);
    console.log(`${c.dim}   Finding canonical doc sections that reference this file...${c.reset}\n`);
  }

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    if (isJson) {
      console.log(JSON.stringify({ target, matches: [], error: 'no docs-canonical/ directory' }, null, 2));
    } else {
      console.log(`  ${c.yellow}No docs-canonical/ directory found.${c.reset}`);
    }
    return;
  }

  // Normalize the target path: strip leading ./
  const normalized = target.replace(/^\.\//, '');
  const base = basename(normalized);
  const stem = base.replace(/\.[^.]+$/, '');

  const matches = []; // { doc, line, content, kind }
  for (const f of readdirSync(docsDir)) {
    if (!f.endsWith('.md')) continue;
    const docPath = resolve(docsDir, f);
    let content;
    try { content = readFileSync(docPath, 'utf-8'); } catch { continue; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let kind = null;
      if (line.includes(normalized)) kind = 'path';
      else if (line.includes(base)) kind = 'basename';
      else if (new RegExp(`\`${escapeRegex(stem)}\``).test(line)) kind = 'module';
      if (kind) {
        matches.push({ doc: f, line: i + 1, content: line.trim(), kind });
      }
    }
  }

  if (flags.format === 'json') {
    console.log(JSON.stringify({
      target: normalized,
      matches,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  if (matches.length === 0) {
    console.log(`  ${c.yellow}⚠️  No canonical doc references "${normalized}"${c.reset}`);
    console.log(`  ${c.dim}Consider documenting this file in docs-canonical/ARCHITECTURE.md or DATA-MODEL.md${c.reset}`);
    return;
  }

  // Group by doc for readable output
  const byDoc = new Map();
  for (const m of matches) {
    if (!byDoc.has(m.doc)) byDoc.set(m.doc, []);
    byDoc.get(m.doc).push(m);
  }

  console.log(`  ${c.green}✅ ${matches.length} reference(s) across ${byDoc.size} doc(s):${c.reset}\n`);
  for (const [doc, hits] of byDoc) {
    console.log(`  ${c.cyan}${doc}${c.reset} ${c.dim}(${hits.length} hit${hits.length > 1 ? 's' : ''})${c.reset}`);
    for (const h of hits.slice(0, 5)) {
      const trimmed = h.content.length > 80 ? h.content.slice(0, 77) + '…' : h.content;
      console.log(`     ${c.dim}L${h.line} [${h.kind}]${c.reset} ${trimmed}`);
    }
    if (hits.length > 5) console.log(`     ${c.dim}... ${hits.length - 5} more${c.reset}`);
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function runTrace(projectDir, config, flags) {
  // L-2: dispatch to reverse mode when --reverse is set.
  if (flags.reverse) {
    return runTraceReverse(projectDir, config, flags);
  }

  // Per-feature spec-kit adherence scoring when --features is set.
  if (flags.features) {
    return runTraceFeatures(projectDir, config, flags);
  }

  // v0.16-P1: same headless-mode pattern as guard/score. Reported by Python
  // user — trace --format json was leaking ANSI escapes before the body.
  const isJson = flags.format === 'json';
  if (!isJson) {
    console.log(`${c.bold}🔗 DocGuard Trace — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
    console.log(`${c.dim}   Generating requirements traceability matrix...${c.reset}\n`);
  }

  // ── 1. Build set of required doc basenames from config ──
  const requiredDocs = new Set(
    (config.requiredFiles?.canonical || []).map(f => basename(f))
  );

  // ── 2. Inventory canonical docs ──
  const docsDir = resolve(projectDir, 'docs-canonical');
  const canonicalDocs = [];
  if (existsSync(docsDir)) {
    for (const f of readdirSync(docsDir)) {
      if (f.endsWith('.md')) canonicalDocs.push(f);
    }
  }

  // ── 3. Scan project files ──
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);

  // ── 4. Build traceability matrix (only required docs) ──
  const matrix = [];
  const orphanedDocs = [];

  for (const [docName, traceInfo] of Object.entries(TRACE_MAP)) {
    const docPath = resolve(docsDir, docName);
    const docExists = existsSync(docPath);

    // Check if this doc is excluded from config
    if (!requiredDocs.has(docName)) {
      if (docExists) {
        orphanedDocs.push(docName);
      }
      continue; // Skip excluded docs from the matrix
    }

    let lastModified = null;
    let docSize = 0;

    if (docExists) {
      const stat = statSync(docPath);
      lastModified = stat.mtime.toISOString().split('T')[0];
      docSize = stat.size;
    }

    // Find matching source files for each pattern
    const traces = [];
    for (const pattern of traceInfo.sourcePatterns) {
      const matches = projectFiles.filter(f => isTraceableSource(f) && pattern.glob.test(f));
      traces.push({
        label: pattern.label,
        matchCount: matches.length,
        files: matches.slice(0, 5), // Cap at 5 for display
        hasMore: matches.length > 5,
      });
    }

    // Find test coverage (files that test code related to this doc)
    const relatedTests = findRelatedTests(projectFiles, traceInfo.sourcePatterns);

    // Calculate coverage signal
    const totalSources = traces.reduce((sum, t) => sum + t.matchCount, 0);
    const coverageSignal = !docExists ? 'MISSING'
      : totalSources === 0 ? 'UNLINKED'
      : relatedTests.length > 0 ? 'TRACED'
      : 'PARTIAL';

    matrix.push({
      document: docName,
      standard: traceInfo.standard,
      exists: docExists,
      lastModified,
      docSize,
      traces,
      relatedTests,
      totalSources,
      coverageSignal,
    });
  }

  // ── 5. Output ──
  if (flags.format === 'json') {
    outputJSON(config.projectName, matrix, orphanedDocs);
  } else {
    outputText(config.projectName, matrix, canonicalDocs, orphanedDocs);
  }
}

function outputJSON(projectName, matrix, orphanedDocs) {
  const result = {
    project: projectName,
    traceability: matrix.map(m => ({
      document: m.document,
      standard: m.standard,
      exists: m.exists,
      lastModified: m.lastModified,
      coverageSignal: m.coverageSignal,
      sources: m.totalSources,
      tests: m.relatedTests.length,
      traces: m.traces,
    })),
    orphanedDocs,
    summary: {
      total: matrix.length,
      traced: matrix.filter(m => m.coverageSignal === 'TRACED').length,
      partial: matrix.filter(m => m.coverageSignal === 'PARTIAL').length,
      unlinked: matrix.filter(m => m.coverageSignal === 'UNLINKED').length,
      missing: matrix.filter(m => m.coverageSignal === 'MISSING').length,
      orphaned: orphanedDocs.length,
    },
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

function outputText(projectName, matrix, canonicalDocs, orphanedDocs) {
  // Header table
  console.log(`  ${c.bold}Traceability Matrix${c.reset}\n`);
  console.log(`  ${c.dim}${'Document'.padEnd(22)} ${'Standard'.padEnd(28)} ${'Status'.padEnd(10)} ${'Sources'.padEnd(9)} ${'Tests'.padEnd(7)} ${'Last Modified'}${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(22)} ${'─'.repeat(28)} ${'─'.repeat(10)} ${'─'.repeat(9)} ${'─'.repeat(7)} ${'─'.repeat(14)}${c.reset}`);

  for (const entry of matrix) {
    const statusColor = entry.coverageSignal === 'TRACED' ? c.green
      : entry.coverageSignal === 'PARTIAL' ? c.yellow
      : entry.coverageSignal === 'UNLINKED' ? c.yellow
      : c.red;
    const statusIcon = entry.coverageSignal === 'TRACED' ? '✅'
      : entry.coverageSignal === 'PARTIAL' ? '⚠️ '
      : entry.coverageSignal === 'UNLINKED' ? '🔗'
      : '❌';

    console.log(`  ${statusIcon} ${entry.document.padEnd(19)} ${c.dim}${entry.standard.padEnd(28)}${c.reset} ${statusColor}${entry.coverageSignal.padEnd(10)}${c.reset} ${String(entry.totalSources).padEnd(9)} ${String(entry.relatedTests.length).padEnd(7)} ${entry.lastModified || c.dim + 'n/a' + c.reset}`);
  }

  // Detailed traces (verbose)
  console.log(`\n  ${c.bold}Detailed Traces${c.reset}\n`);

  for (const entry of matrix) {
    if (!entry.exists) {
      console.log(`  ${c.red}❌ ${entry.document}${c.reset} — ${c.dim}Document not found. Run \`docguard generate\` to create.${c.reset}`);
      continue;
    }

    console.log(`  ${c.bold}📄 ${entry.document}${c.reset} ${c.dim}(${entry.standard})${c.reset}`);

    for (const trace of entry.traces) {
      const icon = trace.matchCount > 0 ? `${c.green}✓${c.reset}` : `${c.dim}○${c.reset}`;
      console.log(`     ${icon} ${trace.label}: ${trace.matchCount} file(s)`);
      if (trace.matchCount > 0 && trace.files.length > 0) {
        for (const f of trace.files) {
          console.log(`       ${c.dim}→ ${f}${c.reset}`);
        }
        if (trace.hasMore) {
          console.log(`       ${c.dim}  ... and ${trace.matchCount - 5} more${c.reset}`);
        }
      }
    }

    if (entry.relatedTests.length > 0) {
      console.log(`     ${c.green}✓${c.reset} Test coverage: ${entry.relatedTests.length} test file(s)`);
      for (const t of entry.relatedTests.slice(0, 3)) {
        console.log(`       ${c.dim}→ ${t}${c.reset}`);
      }
      if (entry.relatedTests.length > 3) {
        console.log(`       ${c.dim}  ... and ${entry.relatedTests.length - 3} more${c.reset}`);
      }
    } else {
      console.log(`     ${c.yellow}○${c.reset} ${c.dim}No related test files found${c.reset}`);
    }
    console.log('');
  }

  // Summary
  const traced = matrix.filter(m => m.coverageSignal === 'TRACED').length;
  const partial = matrix.filter(m => m.coverageSignal === 'PARTIAL').length;
  const unlinked = matrix.filter(m => m.coverageSignal === 'UNLINKED').length;
  const missing = matrix.filter(m => m.coverageSignal === 'MISSING').length;

  console.log(`  ${c.bold}─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Traced: ${traced}${c.reset}  ${c.yellow}Partial: ${partial}${c.reset}  ${c.yellow}Unlinked: ${unlinked}${c.reset}  ${c.red}Missing: ${missing}${c.reset}`);
  console.log(`  ${c.dim}Total: ${matrix.length} canonical documents evaluated${c.reset}`);

  if (missing > 0 || unlinked > 0) {
    console.log(`\n  ${c.dim}Run ${c.cyan}docguard generate${c.dim} to create missing docs.${c.reset}`);
    console.log(`  ${c.dim}Run ${c.cyan}docguard diagnose${c.dim} to fix coverage gaps.${c.reset}`);
  }

  // ── Orphaned docs warning ──
  if (orphanedDocs.length > 0) {
    console.log(`\n  ${c.yellow}⚠️  Orphaned Files (${orphanedDocs.length})${c.reset}`);
    console.log(`  ${c.dim}These files exist in docs-canonical/ but are excluded from your config:${c.reset}`);
    for (const doc of orphanedDocs) {
      console.log(`     ${c.yellow}→${c.reset} ${doc}`);
    }
    console.log(`  ${c.dim}Delete them or add to .docguard.json requiredFiles.canonical${c.reset}`);
  }

  console.log(`\n  ${c.dim}Traceability methodology: ISO/IEC/IEEE 29119 (Lopez et al., AITPG, IEEE TSE 2026)${c.reset}\n`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function scanDir(rootDir, dir, files) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.') && entry !== '.env' && entry !== '.env.example'
        && entry !== '.gitignore' && !entry.startsWith('.github')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      scanDir(rootDir, full, files);
    } else {
      files.push(relative(rootDir, full));
    }
  }
}

// ── Per-feature spec adherence (trace --features) ───────────────────────────
//
// Scores each detected spec-kit feature's implementation adherence
// individually (inspired by spec-kit-retrospective), instead of only the
// repo-wide scores that `docguard score` produces. Deterministic signals only —
// no LLM judgment:
//
//   reqCoverage          40%  FR-/SC- IDs in spec.md referenced by any test file
//   taskCompletion       25%  checked/total `- [x]` tasks in tasks.md
//   taskEvidence         20%  checked tasks whose line names an existing file
//   artifactCompleteness 15%  spec.md (40%) + plan.md (30%) + tasks.md (30%)
//
// A signal that cannot be measured (no tasks.md, no requirement IDs, no
// checked task names a parseable path) is NEUTRAL: excluded from the weighted
// sum and its weight redistributed across the measurable signals. This mirrors
// the traceability validator's "no requirement IDs → silently pass" stance —
// absence of a convention is not evidence of low adherence (missing artifacts
// are already priced in by artifactCompleteness).

const FEATURE_SIGNAL_WEIGHTS = {
  reqCoverage: 0.40,
  taskCompletion: 0.25,
  taskEvidence: 0.20,
  artifactCompleteness: 0.15,
};

// Grade bands mirrored from cli/scanners/agent-readability.mjs GRADES.
// Display-only — never feeds the gating CDD grade that CI thresholds read.
const FEATURE_GRADES = [[90, 'A'], [75, 'B'], [60, 'C'], [40, 'D']];

function featureGrade(score) {
  for (const [min, g] of FEATURE_GRADES) if (score >= min) return g;
  return 'F';
}

// Spec-kit requirement IDs scored per feature. Subset of the traceability
// validator's DEFAULT_REQ_PATTERNS (cli/validators/traceability.mjs) — the two
// ID families spec-kit's spec-template.md mandates.
const FEATURE_REQ_RE = /\b(?:FR|SC)-\d{2,4}\b/g;

// Path-token heuristic mirrored from cli/scanners/semantic-claims.mjs
// CITED_CODE_RE: a backticked or bare path-like token with a code extension.
const TASK_PATH_RE = /`?([\w./-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|kt|rb|php|sql|yaml|yml|json))`?/g;

// 20-char bar mirrored from cli/commands/score.mjs renderBar (not exported
// there; score.mjs is display-conventions-only for this feature).
function featureBar(score) {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const color = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

/**
 * Collect every FR-/SC- ID referenced anywhere in a test file, once for the
 * whole project. Test-file discovery mirrors the traceability validator's
 * scanTestFilesForReferences(): TEST_PATTERNS ∪ __tests__/ ∪ tests?/ dirs, and
 * any occurrence of the ID in file content counts (not just @req lines).
 */
function collectTestReferencedIds(projectDir) {
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);
  const testFiles = projectFiles.filter(f =>
    TEST_PATTERNS.some(p => p.test(f)) || /__tests__\//.test(f) || /tests?\//.test(f)
  );

  const ids = new Set();
  for (const rel of testFiles) {
    let content;
    try { content = readFileSync(resolve(projectDir, rel), 'utf-8'); } catch { continue; }
    FEATURE_REQ_RE.lastIndex = 0;
    let m;
    while ((m = FEATURE_REQ_RE.exec(content)) !== null) ids.add(m[0]);
  }
  return ids;
}

/**
 * Compute the four adherence signals for one detected spec-kit feature.
 * Each signal: { applicable, value (0..1 | null), ...n/m detail fields }.
 */
function computeFeatureSignals(projectDir, feature, testRefIds) {
  // ── artifactCompleteness — always measurable ──
  const artifactValue = (feature.hasSpec ? 0.4 : 0)
    + (feature.hasPlan ? 0.3 : 0)
    + (feature.hasTasks ? 0.3 : 0);

  // ── taskCompletion + taskEvidence — parse tasks.md checklist lines ──
  let totalTasks = 0, checkedTasks = 0, evidenced = 0, considered = 0;
  if (feature.hasTasks && feature.tasksPath) {
    let content = null;
    try { content = readFileSync(feature.tasksPath, 'utf-8'); } catch { /* unreadable → no tasks */ }
    if (content !== null) {
      for (const line of content.split('\n')) {
        const box = /^\s*[-*]\s*\[([ xX])\]/.exec(line);
        if (!box) continue;
        totalTasks++;
        if (box[1] === ' ') continue;
        checkedTasks++;
        // Evidence: any named path on the line that exists in the project.
        // Checked tasks with no parseable path are neutral (skip denominator).
        TASK_PATH_RE.lastIndex = 0;
        let tok, sawToken = false, exists = false;
        while ((tok = TASK_PATH_RE.exec(line)) !== null) {
          sawToken = true;
          if (existsSync(resolve(projectDir, tok[1].replace(/^\.\//, '')))) { exists = true; break; }
        }
        if (sawToken) { considered++; if (exists) evidenced++; }
      }
    }
  }

  // ── reqCoverage — spec.md IDs that appear in ANY test file ──
  const specIds = [];
  if (feature.hasSpec && feature.specPath) {
    try {
      const spec = readFileSync(feature.specPath, 'utf-8');
      const seen = new Set();
      FEATURE_REQ_RE.lastIndex = 0;
      let m;
      while ((m = FEATURE_REQ_RE.exec(spec)) !== null) {
        if (!seen.has(m[0])) { seen.add(m[0]); specIds.push(m[0]); }
      }
    } catch { /* unreadable spec → no IDs */ }
  }
  const covered = specIds.filter(id => testRefIds.has(id));
  const uncovered = specIds.filter(id => !testRefIds.has(id));

  return {
    reqCoverage: {
      applicable: specIds.length > 0,
      value: specIds.length > 0 ? covered.length / specIds.length : null,
      covered: covered.length,
      total: specIds.length,
      uncovered,
    },
    taskCompletion: {
      applicable: totalTasks > 0,
      value: totalTasks > 0 ? checkedTasks / totalTasks : null,
      checked: checkedTasks,
      total: totalTasks,
    },
    taskEvidence: {
      applicable: considered > 0,
      value: considered > 0 ? evidenced / considered : null,
      evidenced,
      considered,
    },
    artifactCompleteness: {
      applicable: true,
      value: artifactValue,
      spec: feature.hasSpec,
      plan: feature.hasPlan,
      tasks: feature.hasTasks,
    },
  };
}

/** Weighted 0–100 score over the applicable signals (weights renormalized). */
function scoreFromSignals(signals) {
  let weighted = 0, weightTotal = 0;
  for (const [key, weight] of Object.entries(FEATURE_SIGNAL_WEIGHTS)) {
    const s = signals[key];
    if (!s.applicable) continue;
    weighted += weight * s.value;
    weightTotal += weight;
  }
  return weightTotal > 0 ? Math.round((weighted / weightTotal) * 100) : 0;
}

/**
 * The lowest-valued applicable signal. Iteration order is descending weight,
 * and replacement is strict-less-than, so ties resolve to the highest-impact
 * signal — the one worth fixing first.
 */
function weakestSignal(signals) {
  let worstKey = null;
  for (const key of Object.keys(FEATURE_SIGNAL_WEIGHTS)) {
    const s = signals[key];
    if (!s.applicable) continue;
    if (worstKey === null || s.value < signals[worstKey].value) worstKey = key;
  }
  return worstKey;
}

function fixHintFor(key, s, feature) {
  switch (key) {
    case 'reqCoverage':
      return `Cover the untested spec IDs (e.g. ${s.uncovered[0]}) — reference them from tests via @req annotations`;
    case 'taskCompletion':
      return `Complete (or prune) the ${s.total - s.checked} unchecked task(s) in tasks.md`;
    case 'taskEvidence':
      return `${s.considered - s.evidenced} checked task(s) name files that don't exist — fix stale paths or uncheck them`;
    case 'artifactCompleteness': {
      const missing = [
        feature.hasSpec ? null : 'spec.md',
        feature.hasPlan ? null : 'plan.md',
        feature.hasTasks ? null : 'tasks.md',
      ].filter(Boolean);
      return `Add ${missing.join(', ')} to complete the artifact set`;
    }
    default:
      return null;
  }
}

/**
 * `docguard trace --features` — per-feature spec-kit adherence report.
 * Reuses detectSpecKit() for feature discovery (no re-implementation).
 */
export function runTraceFeatures(projectDir, config, flags) {
  const isJson = flags.format === 'json';
  if (!isJson) {
    console.log(`${c.bold}🎯 DocGuard Trace (features) — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Scoring per-feature spec adherence (spec-kit)...${c.reset}\n`);
  }

  const speckit = detectSpecKit(projectDir);
  if (!speckit.detected || speckit.specs.length === 0) {
    // Same empty-state contract as trace --reverse: JSON stays parseable with
    // an `error` field; text gets an actionable pointer.
    if (isJson) {
      console.log(JSON.stringify({
        features: [],
        summary: { features: 0, avgScore: null, worst: null },
        error: 'no spec-kit features detected',
        timestamp: new Date().toISOString(),
      }, null, 2));
    } else {
      console.log(`  ${c.yellow}No spec-kit features detected.${c.reset}`);
      console.log(`  ${c.dim}Feature scoring needs .specify/specs/** or specs/** (spec.md/plan.md/tasks.md). Run \`specify init\` to start.${c.reset}`);
    }
    return;
  }

  const testRefIds = collectTestReferencedIds(projectDir);

  const features = speckit.specs.map(f => {
    const signals = computeFeatureSignals(projectDir, f, testRefIds);
    const score = scoreFromSignals(signals);
    const weakest = weakestSignal(signals);
    const needsFix = weakest !== null && signals[weakest].value < 1;
    return {
      name: f.name,
      dir: relative(projectDir, dirname(f.specPath || f.planPath || f.tasksPath)),
      score,
      grade: featureGrade(score),
      signals,
      weakest,
      fixHint: needsFix ? fixHintFor(weakest, signals[weakest], f) : null,
    };
  });

  // Worst-first — act on the weakest feature. Name tie-break for determinism.
  features.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  const avgScore = Math.round(features.reduce((sum, f) => sum + f.score, 0) / features.length);
  const summary = {
    features: features.length,
    avgScore,
    worst: { name: features[0].name, score: features[0].score },
  };

  if (isJson) {
    outputFeaturesJSON(features, summary);
  } else {
    outputFeaturesText(features, summary);
  }
}

function pctOrNull(signal) {
  return signal.applicable ? Math.round(signal.value * 100) : null;
}

function outputFeaturesJSON(features, summary) {
  console.log(JSON.stringify({
    features: features.map(f => ({
      name: f.name,
      dir: f.dir,
      score: f.score,
      grade: f.grade,
      signals: {
        reqCoverage: {
          pct: pctOrNull(f.signals.reqCoverage),
          covered: f.signals.reqCoverage.covered,
          total: f.signals.reqCoverage.total,
          uncovered: f.signals.reqCoverage.uncovered,
        },
        taskCompletion: {
          pct: pctOrNull(f.signals.taskCompletion),
          checked: f.signals.taskCompletion.checked,
          total: f.signals.taskCompletion.total,
        },
        taskEvidence: {
          pct: pctOrNull(f.signals.taskEvidence),
          evidenced: f.signals.taskEvidence.evidenced,
          considered: f.signals.taskEvidence.considered,
        },
        artifactCompleteness: {
          pct: pctOrNull(f.signals.artifactCompleteness),
          spec: f.signals.artifactCompleteness.spec,
          plan: f.signals.artifactCompleteness.plan,
          tasks: f.signals.artifactCompleteness.tasks,
        },
      },
      weakest: f.weakest,
      fixHint: f.fixHint,
    })),
    summary,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

function outputFeaturesText(features, summary) {
  console.log(`  ${c.bold}Feature Adherence${c.reset} ${c.dim}(worst first)${c.reset}\n`);

  for (const f of features) {
    const gradeColor = f.score >= 80 ? c.green : f.score >= 60 ? c.yellow : c.red;
    console.log(`  📦 ${c.bold}${f.name}${c.reset} — ${gradeColor}${f.score}/100 (${f.grade})${c.reset} ${featureBar(f.score)}`);
    console.log(`     ${c.dim}${f.dir}${c.reset}`);

    const sig = f.signals;
    const line = (label, weightPct, s, detail) => {
      const pct = s.applicable ? `${Math.round(s.value * 100)}%`.padEnd(4) : 'n/a ';
      const color = !s.applicable ? c.dim : s.value >= 0.8 ? c.green : s.value >= 0.5 ? c.yellow : c.red;
      console.log(`     ${color}${pct}${c.reset} ${label.padEnd(22)} ${c.dim}${detail} · weight ${weightPct}%${c.reset}`);
    };

    line('Requirement coverage', 40, sig.reqCoverage,
      sig.reqCoverage.applicable
        ? `${sig.reqCoverage.covered}/${sig.reqCoverage.total} spec IDs referenced by tests`
        : 'no FR-/SC- IDs in spec.md');
    line('Task completion', 25, sig.taskCompletion,
      sig.taskCompletion.applicable
        ? `${sig.taskCompletion.checked}/${sig.taskCompletion.total} tasks checked`
        : 'no tasks.md checklist');
    line('Task evidence', 20, sig.taskEvidence,
      sig.taskEvidence.applicable
        ? `${sig.taskEvidence.evidenced}/${sig.taskEvidence.considered} checked tasks name existing files`
        : 'no checked task names a file path');
    line('Artifacts', 15, sig.artifactCompleteness,
      `${[sig.artifactCompleteness.spec, sig.artifactCompleteness.plan, sig.artifactCompleteness.tasks].filter(Boolean).length}/3 ` +
      `(spec ${sig.artifactCompleteness.spec ? '✓' : '✗'} · plan ${sig.artifactCompleteness.plan ? '✓' : '✗'} · tasks ${sig.artifactCompleteness.tasks ? '✓' : '✗'})`);

    if (f.fixHint) {
      console.log(`     ${c.yellow}⚠ Fix first:${c.reset} ${f.fixHint}`);
    } else {
      console.log(`     ${c.green}✓ No weak signal — all applicable signals at 100%${c.reset}`);
    }
    console.log('');
  }

  console.log(`  ${c.bold}─────────────────────────────────────${c.reset}`);
  console.log(`  ${summary.features} feature(s) · avg ${summary.avgScore}/100 · worst: ${c.red}${summary.worst.name} (${summary.worst.score}/100)${c.reset}`);
  console.log(`\n  ${c.dim}Signals are deterministic (checklist, ID-to-test references, file existence) — adherence of intent, not correctness.${c.reset}\n`);
}

function findRelatedTests(projectFiles, sourcePatterns) {
  // Find test files that might cover the source patterns
  const testFiles = projectFiles.filter(f => TEST_PATTERNS.some(p => p.test(f)));

  // Match tests to source patterns by directory/name proximity
  const relatedTests = new Set();

  for (const pattern of sourcePatterns) {
    const sourceFiles = projectFiles.filter(f => isTraceableSource(f) && pattern.glob.test(f));
    for (const src of sourceFiles) {
      const srcBase = basename(src).replace(/\.[^.]+$/, '');
      const srcDir = src.split('/')[0];

      for (const test of testFiles) {
        // Match by name similarity or directory proximity
        if (test.includes(srcBase) || test.includes(srcDir)) {
          relatedTests.add(test);
        }
      }
    }
  }

  return [...relatedTests];
}
