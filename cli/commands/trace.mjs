/**
 * Trace Command — Generate a requirements traceability matrix
 * Maps canonical docs ↔ source code ↔ tests → produces a traceability report.
 *
 * Inspired by requirements traceability in Lopez et al., AITPG (IEEE TSE 2026)
 * and ISO/IEC/IEEE 29119 traceability requirements.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';
import { c } from '../shared.mjs';

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
import { TEST_PATTERNS, TRACE_MAP } from '../shared-trace-patterns.mjs';


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
      const matches = projectFiles.filter(f => pattern.glob.test(f));
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

function findRelatedTests(projectFiles, sourcePatterns) {
  // Find test files that might cover the source patterns
  const testFiles = projectFiles.filter(f => TEST_PATTERNS.some(p => p.test(f)));

  // Match tests to source patterns by directory/name proximity
  const relatedTests = new Set();

  for (const pattern of sourcePatterns) {
    const sourceFiles = projectFiles.filter(f => pattern.glob.test(f));
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
