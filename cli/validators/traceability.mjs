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
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateTraceability(projectDir, config) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    // No docs-canonical dir at all — structure validator handles this
    return { errors, warnings, passed: 0, total: 0 };
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
      warnings.push(`${docName} — required but missing, no traceability possible`);
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
      warnings.push(`${docName} — exists but no matching source code found (unlinked doc)`);
    }
  }

  // ── Detect orphaned files (exist but not required) ──
  try {
    const existingDocs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const docFile of existingDocs) {
      if (!requiredDocs.has(docFile) && TRACE_MAP[docFile]) {
        warnings.push(`${docFile} — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical`);
      }
    }
  } catch { /* ignore */ }

  // ── Part 2: Requirement ID Traceability (V-Model) ──
  const reqResult = validateRequirementTraceability(projectDir, config, projectFiles);
  errors.push(...reqResult.errors);
  warnings.push(...reqResult.warnings);
  passed += reqResult.passed;
  total += reqResult.total;

  return { errors, warnings, passed, total };
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
  const errors = [];
  const warnings = [];
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
    return { errors, warnings, passed, total };
  }

  // ── Step 2: Scan test files for requirement ID references ──
  const testRefs = scanTestFilesForReferences(projectDir, projectFiles, patterns);

  // ── Step 3: Report traceability results ──

  // Check each documented requirement has at least one test reference
  for (const [reqId, location] of reqIds) {
    total++;
    if (testRefs.has(reqId)) {
      passed++;
    } else {
      warnings.push(
        `Requirement ${reqId} (${location.file}:${location.line}) has no test coverage. ` +
        `Add @req ${reqId} comment to the test that verifies this requirement`
      );
    }
  }

  // Check for orphaned test refs (tests referencing non-existent requirements)
  for (const [reqId, refs] of testRefs) {
    if (!reqIds.has(reqId)) {
      total++;
      warnings.push(
        `Test references ${reqId} (${refs[0].file}:${refs[0].line}) but no requirement ` +
        `with this ID exists in documentation. Remove the reference or add the requirement to docs`
      );
    }
  }

  return { errors, warnings, passed, total };
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
            reqIds.set(reqId, { file: docName, line: i + 1 });
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

function scanDir(rootDir, dir, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

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
