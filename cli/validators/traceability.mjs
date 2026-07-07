/**
 * Traceability Validator — Checks that canonical docs are linked to source code
 * 
 * Two modes:
 *   1. Source Traceability: Canonical docs reference actual source files
 *   2. Requirement Traceability (V-Model): Requirement IDs in docs trace to tests
 *
 * Requirement traceability is opt-in by convention — if no requirement IDs are
 * found (REQ-001, FR-001, etc.), the check silently passes. Once you add IDs,
 * DocGuard automatically enforces traceability.
 *
 * Inspired by ISO/IEC/IEEE 29119, IEEE 1016, and V-Model methodology.
 * V-Model concepts informed by spec-kit-v-model (github.com/leocamello/spec-kit-v-model).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { TRACE_MAP, TEST_PATTERNS, isTraceableSource } from '../shared-trace-patterns.mjs';
import { walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { tokenize } from '../shared-diff.mjs';
import { rankBySimilarity } from '../shared-ir.mjs';

// IR soft-link recovery (feat 5): tokenize test files once so an untraced
// requirement can be matched to the test that most likely already covers it
// (TF-IDF cosine, VSM). Capped so a huge test suite can't blow up guard.
function buildTestCorpus(projectDir, projectFiles, { maxFiles = 250, maxTokens = 400 } = {}) {
  const testFiles = projectFiles.filter(f =>
    TEST_PATTERNS.some(p => p.test(f)) || /__tests__\//.test(f) || /tests?\//.test(f)
  ).slice(0, maxFiles);
  const corpus = [];
  for (const relPath of testFiles) {
    try {
      const content = readFileSync(resolve(projectDir, relPath), 'utf-8');
      corpus.push({ id: relPath, tokens: tokenize(content).slice(0, maxTokens) });
    } catch { /* skip unreadable */ }
  }
  return corpus;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);


// ──── Default requirement ID patterns ────
// Users can override via config.traceability.requirementPattern
// Includes spec-kit standard IDs: FR-xxx, SC-xxx, T-xxx
const DEFAULT_REQ_PATTERNS = [
  /\b(REQ)-(\d{2,4})\b/g,
  /\b(FR)-(\d{2,4})\b/g,
  /\b(NFR)-(\d{2,4})\b/g,
  /\b(US)-(\d{2,4})\b/g,
  /\b(STORY)-(\d{2,4})\b/g,
  /\b(AC)-(\d{2,4})\b/g,
  /\b(UC)-(\d{2,4})\b/g,
  /\b(SYS)-(\d{2,4})\b/g,
  /\b(ARCH)-(\d{2,4})\b/g,
  /\b(MOD)-(\d{2,4})\b/g,
  /\b(SC)-(\d{2,4})\b/g,     // Spec Kit: Success Criteria
  // Spec Kit task IDs (T001, T002). Unlike the hyphenated IDs above, a bare
  // `T350` over-matches prose (timeouts, model names, status codes), forcing
  // spurious "untraced requirement" warnings. Anchor to the two contexts where
  // a real task ID actually appears: a markdown checklist marker (`- [ ] T001`,
  // the spec-kit tasks.md format) or a test annotation (`@req T001`/`@task`).
  /(?<=\[[ xX]\]\s|@(?:req|task|covers)\s)(T)(\d{3,4})\b/g,
];

/**
 * Validate traceability — ensures canonical docs have corresponding source artifacts,
 * and requirement IDs trace through to test files.
 * Respects config.requiredFiles.canonical — only checks docs the user requires.
 *
 * v0.29: migrated to structured findings (TRC001–TRC005). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings array.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateTraceability(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    // No docs-canonical dir at all — structure validator handles this
    return resultFromFindings([], { passed: 0, total: 0 });
  }

  // Build set of required doc basenames from config
  const requiredDocs = new Set(
    (config.requiredFiles?.canonical || []).map(f => basename(f))
  );

  // Scan project files once
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);

  // Scan source files for `// @doc <filename>.md` annotations. An annotation
  // is an explicit author signal that a source file documents (or is
  // documented by) a canonical doc. It is the user-facing escape hatch when
  // a project's directory layout doesn't match the built-in TRACE_MAP globs
  // (e.g. a route file outside any `routes/` / `app/api/` tree). The
  // annotation is also shown in templates and templates/commands docs, so
  // users have been told it works — actually honoring it is the fix here.
  const docAnnotations = scanDocAnnotations(projectFiles, projectDir);

  // ── Part 1: Source Traceability (existing) ──
  for (const [docName, traceInfo] of Object.entries(TRACE_MAP)) {
    // Skip docs not in the user's required list
    if (!requiredDocs.has(docName)) continue;

    total++;
    const docPath = resolve(docsDir, docName);
    const docExists = existsSync(docPath);

    if (!docExists) {
      findings.push(mkFinding({
        code: 'TRC001',
        validator: 'traceability',
        severity: 'warn',
        message: `${docName} — required but missing, no traceability possible`,
        location: `docs-canonical/${docName}`,
        suggestion: { kind: 'fix', text: 'Create the required doc from the professional template', command: 'docguard init' },
      }));
      continue;
    }

    // Explicit `// @doc <docName>` annotation counts as a link regardless of
    // whether the file path matches any built-in pattern. Checked first so
    // path-pattern misses don't drown out explicit author intent.
    if (docAnnotations.has(docName) && docAnnotations.get(docName).size > 0) {
      passed++;
      continue;
    }

    // Count matching source files
    // ⚡ Bolt: Fast early return using .some() instead of .filter()
    // v0.24: skip .md files — a doc isn't "linked" just because another doc's
    // name matches the glob (e.g. SECURITY's `guard` matching docguard.guard.md);
    // that masked genuinely unlinked docs (field report).
    let hasSource = false;
    for (const pattern of traceInfo.sourcePatterns) {
      if (projectFiles.some(f => isTraceableSource(f) && pattern.glob.test(f))) {
        hasSource = true;
        break;
      }
    }

    if (hasSource) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'TRC002',
        validator: 'traceability',
        severity: 'warn',
        message: `${docName} — exists but no matching source code found (unlinked doc)`,
        location: `docs-canonical/${docName}`,
        suggestion: {
          kind: 'fix',
          text: 'Link a source file explicitly with a header annotation if the code lives in a non-standard location',
          pragma: `// @doc ${docName}`,
        },
      }));
    }
  }

  // ── Detect orphaned files (exist but not required) ──
  try {
    const existingDocs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const docFile of existingDocs) {
      if (!requiredDocs.has(docFile) && TRACE_MAP[docFile]) {
        findings.push(mkFinding({
          code: 'TRC003',
          validator: 'traceability',
          severity: 'warn',
          message: `${docFile} — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical`,
          location: `docs-canonical/${docFile}`,
          suggestion: { kind: 'review', text: 'Delete the doc, or add it to requiredFiles.canonical in .docguard.json so it gets validated' },
        }));
      }
    }
  } catch { /* ignore */ }

  // ── Part 2: Requirement ID Traceability (V-Model) ──
  const reqResult = validateRequirementTraceability(projectDir, config, projectFiles);
  findings.push(...reqResult.findings);
  passed += reqResult.passed;
  total += reqResult.total;

  return resultFromFindings(findings, { passed, total });
}

// ──── Requirement ID Traceability ────────────────────────────────────────────

/**
 * Scan docs for requirement IDs and verify they appear in test files.
 *
 * Behavior:
 *   - If no requirement IDs found anywhere → silently passes (0 checks)
 *   - If IDs found → validates each has a matching test reference
 *   - Reports untraced requirements and orphaned test refs
 */
function validateRequirementTraceability(projectDir, config, projectFiles) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // Get requirement patterns (user-configurable or defaults)
  const customPattern = config.traceability?.requirementPattern;
  const patterns = customPattern
    ? [new RegExp(customPattern, 'g')]
    : DEFAULT_REQ_PATTERNS;

  // ── Step 1: Collect requirement IDs from documentation ──
  const reqIds = collectRequirementIds(projectDir, config, patterns);

  // If no requirement IDs found, silently pass — this project doesn't use them
  if (reqIds.size === 0) {
    return { findings, passed, total };
  }

  // ── Step 2: Scan test files for requirement ID references ──
  const testRefs = scanTestFilesForReferences(projectDir, projectFiles, patterns);

  // ── Step 3: Report traceability results ──

  // IR soft-link recovery (feat 5): build the tokenized test corpus once, only
  // if there are untraced requirements to match. Threshold is deliberately low
  // — short requirement text vs a whole test file yields modest cosine scores;
  // the hint is a suggestion, not proof.
  const softThreshold = config.traceability?.irSoftThreshold ?? 0.10;
  let testCorpus = null;

  // Check each documented requirement has at least one test reference
  for (const [reqId, location] of reqIds) {
    total++;
    if (testRefs.has(reqId)) {
      passed++;
    } else {
      // Try to recover a likely-but-unannotated test via TF-IDF cosine.
      let softHint = '';
      let softText = `Add an @req ${reqId} comment to the test that verifies this requirement`;
      const queryText = location.text && location.text.length > reqId.length ? location.text : reqId;
      if (testCorpus === null) testCorpus = buildTestCorpus(projectDir, projectFiles);
      if (testCorpus.length > 0) {
        const ranked = rankBySimilarity(tokenize(queryText), testCorpus);
        const top = ranked[0];
        if (top && top.score >= softThreshold) {
          const pct = (top.score * 100).toFixed(0);
          softHint = ` — IR soft-match: ${top.id} (${pct}% similar) may already cover it`;
          softText = `${top.id} looks like it already tests this (${pct}% similar) — add @req ${reqId} there, or if unrelated, write the missing test`;
        }
      }
      findings.push(mkFinding({
        code: 'TRC004',
        validator: 'traceability',
        severity: 'warn',
        message: `Requirement ${reqId} (${location.file}:${location.line}) has no test coverage.${softHint || ' Add @req ' + reqId + ' comment to the test that verifies this requirement'}`,
        location: `${location.file}:${location.line}`,
        suggestion: { kind: 'fix', text: softText },
      }));
    }
  }

  // Check for orphaned test refs (tests referencing non-existent requirements)
  for (const [reqId, refs] of testRefs) {
    if (!reqIds.has(reqId)) {
      total++;
      findings.push(mkFinding({
        code: 'TRC005',
        validator: 'traceability',
        severity: 'warn',
        message: `Test references ${reqId} (${refs[0].file}:${refs[0].line}) but no requirement ` +
          `with this ID exists in documentation. Remove the reference or add the requirement to docs`,
        location: `${refs[0].file}:${refs[0].line}`,
        suggestion: { kind: 'review', text: 'Remove the stale reference, or add the requirement to the documentation' },
      }));
    }
  }

  return { findings, passed, total };
}

function collectRequirementIds(projectDir, config, patterns) {
  const reqIds = new Map(); // reqId → { file, line }
  const docSearchPaths = getRequirementDocPaths(projectDir, config);

  for (const docPath of docSearchPaths) {
    if (!existsSync(docPath)) continue;

    const content = readFileSync(docPath, 'utf-8');

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    const lines = content.split('\n');
    const docName = relative(projectDir, docPath);

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        // Reset regex lastIndex for each line
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(lines[i])) !== null) {
          const reqId = match[0]; // e.g., "REQ-001"
          if (!reqIds.has(reqId)) {
            // capture the line text (the requirement description) for IR soft-match
            reqIds.set(reqId, { file: docName, line: i + 1, text: lines[i].trim() });
          }
        }
      }
    }
  }

  return reqIds;
}

function scanTestFilesForReferences(projectDir, projectFiles, patterns) {
  const testFiles = projectFiles.filter(f =>
    TEST_PATTERNS.some(p => p.test(f)) ||   // multilingual: JS/TS, Python, Go, Rust, Java/Kotlin, Ruby, PHP
    /__tests__\//.test(f) ||
    /tests?\//.test(f)
  );

  const testRefs = new Map(); // reqId → [{ file, line }]

  for (const relPath of testFiles) {
    const fullPath = resolve(projectDir, relPath);
    if (!existsSync(fullPath)) continue;

    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(lines[i])) !== null) {
          const reqId = match[0];
          if (!testRefs.has(reqId)) testRefs.set(reqId, []);
          testRefs.get(reqId).push({ file: relPath, line: i + 1 });
        }
      }
    }
  }

  return testRefs;
}

/**
 * Get all file paths where requirement IDs might be defined.
 * Checks: docs-canonical/*.md, spec.md, REQUIREMENTS.md, specs/[feature]/spec.md
 */
function getRequirementDocPaths(projectDir, config) {
  const paths = [];

  // docs-canonical/ directory
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) {
        if (extname(f).toLowerCase() === '.md') {
          paths.push(join(docsDir, f));
        }
      }
    } catch { /* ignore */ }
  }

  // Root-level docs
  const rootDocs = ['REQUIREMENTS.md', 'spec.md', 'README.md'];
  for (const doc of rootDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p)) paths.push(p);
  }

  // User-configured requirement docs
  const configDocs = config.traceability?.requirementDocs || [];
  for (const doc of configDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p) && !paths.includes(p)) paths.push(p);
  }

  // Spec Kit artifacts: .specify/specs/*/spec.md (v3+) and specs/*/spec.md (legacy)
  const specKitDirs = [
    resolve(projectDir, '.specify', 'specs'),  // v3+ standard
    resolve(projectDir, 'specs'),               // legacy
  ];
  for (const specsDir of specKitDirs) {
    if (existsSync(specsDir)) {
      try {
        for (const feature of readdirSync(specsDir)) {
          const specPath = join(specsDir, feature, 'spec.md');
          if (existsSync(specPath) && !paths.includes(specPath)) paths.push(specPath);
        }
      } catch { /* ignore */ }
    }
  }

  return paths;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Scan code files for `// @doc <name>.md` annotations. Returns a Map from
 * canonical doc basename → Set of source file paths that annotate it.
 *
 * Annotation forms accepted:
 *   - `// @doc API-REFERENCE.md`
 *   - `// @doc docs-canonical/API-REFERENCE.md`  (basename is what matters)
 *   - `/* @doc API-REFERENCE.md *​/`              (block comment, single line)
 *   - `# @doc API-REFERENCE.md`                  (Python / Ruby comment style)
 *
 * Only the basename of the referenced doc is keyed; callers compare against
 * the doc basename (e.g. `API-REFERENCE.md`). We cap how many files we open
 * to keep this scan O(N) and stop reading the rest of a file after the
 * first 4 KB — annotations belong at the top of a file by convention, and
 * reading every byte of every source file just to find a header comment
 * would balloon scan time on large monorepos.
 */
function scanDocAnnotations(projectFiles, projectDir) {
  const map = new Map();
  const annotationRe = /(?:\/\/|\/\*|#)\s*@doc\s+(\S+\.md)/g;
  const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java']);
  const HEAD_BYTES = 4096;

  for (const relPath of projectFiles) {
    const ext = extname(relPath);
    if (!CODE_EXT.has(ext)) continue;
    const full = resolve(projectDir, relPath);
    let content;
    try { content = readFileSync(full, 'utf-8'); } catch { continue; }
    // Annotations live near the top of the file. Slicing avoids reading
    // megabytes of bundled / minified output looking for a header comment.
    const head = content.length > HEAD_BYTES ? content.slice(0, HEAD_BYTES) : content;
    if (!head.includes('@doc')) continue;
    annotationRe.lastIndex = 0;
    let m;
    while ((m = annotationRe.exec(head)) !== null) {
      const docName = basename(m[1]);
      if (!map.has(docName)) map.set(docName, new Set());
      map.get(docName).add(relPath);
    }
  }
  return map;
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
// keepDot preserves the traceability-relevant dot entries (.env, .env.example,
// .gitignore, .github/) that a doc may legitimately reference.
function scanDir(rootDir, dir, files) {
  sharedWalkFiles(dir, (full) => files.push(relative(rootDir, full)), {
    ignoreDirs: IGNORE_DIRS,
    keepDot: (entry) => entry === '.env' || entry === '.env.example'
      || entry === '.gitignore' || entry.startsWith('.github'),
  });
}
