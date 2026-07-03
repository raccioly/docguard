/**
 * TODO/FIXME Tracking Validator — Ensures code annotations are documented
 *
 * Scans source files for TODO:, FIXME:, HACK:, XXX: annotations and checks
 * if they are tracked in documentation (ROADMAP.md, CURRENT-STATE.md, etc.).
 *
 * Also detects skipped tests without explanation.
 *
 * Respects config.todoIgnore (glob patterns) and config.ignore (global).
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 *
 * Inspired by spec-kit-cleanup (github.com/dsrednicki/spec-kit-cleanup)
 * which uses tiered issue classification for code hygiene.
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { shouldIgnore, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless', 'Research',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.cs',
  '.vue', '.svelte', '.astro',
]);

const TEST_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

// ──── Patterns ────

// TEMP must be the standalone word — `(?![A-Za-z])` excludes TEMPLATE, TEMPORARY,
// TEMPO, TEMPEST, etc. (the old `(?!late|orar)` only caught the first two).
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|TEMP(?![A-Za-z])|WORKAROUND)\s*[(:]/;
const TODO_EXTRACT = /\b(TODO|FIXME|HACK|XXX|TEMP(?![A-Za-z])|WORKAROUND)\s*[:(]?\s*(.+)/;

// Matches a comment-opening marker. Real TODOs live in comments — restricting
// matches to text AFTER a comment marker prevents false positives from regex
// literals or strings that happen to contain a TODO keyword.
//   //  — JS/TS/C/C++/Rust/Go/Java line comment
//   #   — Python/Ruby/shell/YAML
//   /*  — JS/C/C++ block comment open
//   *   — block comment continuation (when at start of line)
//   <!-- — HTML/Markdown
const COMMENT_MARKER = /(?:\/\/|#|\/\*|<!--|^\s*\*\s)/;

/**
 * Return the portion of a line after the first comment marker, or null if
 * the line has no comment. Used to constrain TODO matching to comments.
 */
function commentPortion(line) {
  const m = line.match(COMMENT_MARKER);
  return m ? line.slice(m.index + m[0].length) : null;
}

// Test skip patterns for common test frameworks
const SKIP_PATTERNS = [
  /\btest\.skip\s*\(/,
  /\bit\.skip\s*\(/,
  /\bdescribe\.skip\s*\(/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /\bxtest\s*\(/,
  /\.todo\s*\(/,
  /\btest\.todo\s*\(/,
  /\bit\.todo\s*\(/,
];

// Skip explanation patterns (comments that justify the skip)
const SKIP_REASON_PATTERN = /\/\/\s*(REASON|SKIP|TODO|FIXME|NOTE|WHY)\s*:/i;

/**
 * Main validator — checks for untracked TODOs and unexplained test skips.
 *
 * v0.29: migrated to structured findings (TDO001–TDO003). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings array.
 */
export function validateTodoTracking(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // ── Part 1: Skipped Tests ──
  const skipResults = checkSkippedTests(projectDir, config);
  findings.push(...skipResults.findings);
  passed += skipResults.passed;
  total += skipResults.total;

  // ── Part 2: Untracked Annotations ──
  const todoResults = checkUntrackedTodos(projectDir, config);
  findings.push(...todoResults.findings);
  passed += todoResults.passed;
  total += todoResults.total;

  const res = resultFromFindings(findings, { passed, total });
  // Back-compat: on a clean run the legacy result carried no extra keys (the
  // empty-project test deep-equals the whole object), and an empty findings
  // array has nothing to render — so omit the key when there are no findings.
  if (findings.length === 0) delete res.findings;
  return res;
}

// ──── Skipped Tests ────────────────────────────────────────────────────────

/**
 * Scan test files for skip/todo patterns without adjacent explanation comments.
 */
function checkSkippedTests(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const testFiles = [];
  findTestFiles(projectDir, projectDir, testFiles, config);

  if (testFiles.length === 0) return { findings, passed, total };

  // Check: "Project has test files" → pass
  total++;
  passed++;

  let skippedWithoutReason = 0;
  let skippedWithReason = 0;

  for (const relPath of testFiles) {
    const fullPath = resolve(projectDir, relPath);
    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Fast early-return: skip expensive string split if no skip patterns exist
    const hasSkip = SKIP_PATTERNS.some(p => p.test(content));
    if (!hasSkip) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line has a test skip pattern
      const isSkipped = SKIP_PATTERNS.some(p => p.test(line));
      if (!isSkipped) continue;

      // Check surrounding lines (3 above, 1 below, and inline) for explanation
      // Developers commonly place block comments above the skip call
      const surroundingLines = [];
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 1); j++) {
        surroundingLines.push(lines[j]);
      }

      // Also check for block comment pattern: /* REASON: ... */ or /** ... REASON: ... */
      const blockCommentPattern = /\/\*[\s\S]*?(REASON|SKIP|TODO|FIXME|NOTE|WHY)\s*:/i;

      const hasReason =
        surroundingLines.some(l => SKIP_REASON_PATTERN.test(l)) ||
        blockCommentPattern.test(surroundingLines.join('\n'));

      if (hasReason) {
        skippedWithReason++;
      } else {
        skippedWithoutReason++;
        findings.push(mkFinding({
          code: 'TDO001',
          validator: 'todoTracking',
          severity: 'warn',
          message: `Skipped test without explanation at ${relPath}:${i + 1}. ` +
            `Add a // REASON: comment explaining why the test is skipped`,
          location: `${relPath}:${i + 1}`,
          suggestion: {
            kind: 'fix',
            text: 'Add a // REASON: comment on or up to 3 lines above the skip explaining why',
            pragma: '// REASON: <why this test is skipped>',
          },
        }));
      }
    }
  }

  // Check: "All skipped tests have explanations"
  if (skippedWithoutReason > 0 || skippedWithReason > 0) {
    total++;
    if (skippedWithoutReason === 0) {
      passed++;
    }
  }

  return { findings, passed, total };
}

// ──── Untracked Annotations ────────────────────────────────────────────────

/**
 * Scan source files for TODO/FIXME annotations and check if they appear
 * in tracking documentation.
 */
function checkUntrackedTodos(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // Collect all TODO/FIXME items from source
  const todos = [];
  findTodos(projectDir, projectDir, todos, config);

  if (todos.length === 0) {
    // No TODOs found — that's clean code
    total++;
    passed++;
    return { findings, passed, total };
  }

  // Check if TODOs are tracked in documentation
  const trackingContent = loadTrackingDocs(projectDir, config);

  total++;
  let untrackedCount = 0;

  for (const todo of todos) {
    // Check if the TODO is tracked in documentation
    // Improved matching: check full text AND file location context
    // ⚡ Bolt: Precompute string lowercasing and trimming once per TODO
    // instead of inside the trackingContent.some loop
    const todoTextLower = todo.text.toLowerCase().trim();
    const searchText = todoTextLower.length > 20
      ? todoTextLower.substring(0, 40)
      : todoTextLower;

    const isTracked = trackingContent.some(doc => {
      const content = doc.content;
      // ⚡ Bolt: use the precomputed lowercased content
      const contentLower = doc.contentLower;

      // Match 1: Full TODO text appears in the doc (at least 20 chars or full text)
      const hasText = contentLower.includes(searchText);

      // Match 2: File location appears nearby in the doc
      const hasLocation = content.includes(todo.file) ||
        content.includes(`${todo.file}:${todo.line}`);

      // Either the full text matches, or the file location is referenced with partial text
      return (hasText && hasLocation) || (hasText && todoTextLower.length > 30);
    });

    if (!isTracked) {
      untrackedCount++;
      // Only report first 5 to avoid noise
      if (untrackedCount <= 5) {
        findings.push(mkFinding({
          code: 'TDO002',
          validator: 'todoTracking',
          severity: 'warn',
          message: `Untracked ${todo.keyword} at ${todo.file}:${todo.line}: "${todo.text.substring(0, 60)}". ` +
            `Add to ROADMAP.md, CURRENT-STATE.md, or a GitHub issue`,
          location: `${todo.file}:${todo.line}`,
          suggestion: {
            kind: 'fix',
            text: 'Track it in ROADMAP.md or CURRENT-STATE.md (or resolve it) — or exclude the path via todoIgnore in .docguard.json',
          },
        }));
      }
    }
  }

  if (untrackedCount > 5) {
    findings.push(mkFinding({
      code: 'TDO003',
      validator: 'todoTracking',
      severity: 'warn',
      message: `...and ${untrackedCount - 5} more untracked TODO/FIXME items`,
      location: null,
      suggestion: {
        kind: 'suppress',
        text: 'Address the items above and re-run guard to surface the rest — or exclude noisy paths via todoIgnore in .docguard.json',
      },
    }));
  }

  if (untrackedCount === 0) {
    passed++;
  }

  return { findings, passed, total };
}

/**
 * Load doc files where TODOs should be tracked.
 */
function loadTrackingDocs(projectDir, config) {
  const docs = [];
  const trackingFiles = [
    'ROADMAP.md', 'CURRENT-STATE.md', 'TODO.md', 'BACKLOG.md',
    'docs-canonical/ARCHITECTURE.md', 'CHANGELOG.md',
    // v0.27 (field report #6): many projects keep the roadmap/backlog under
    // docs-canonical/ — a TODO tracked there was wrongly read as "untracked".
    'docs-canonical/ROADMAP.md', 'docs-canonical/CURRENT-STATE.md',
    'docs-canonical/BACKLOG.md', 'docs-canonical/TODO.md',
    ...(config.todoTracking?.trackingFiles || []),
  ];

  for (const file of trackingFiles) {
    const fullPath = resolve(projectDir, file);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        // ⚡ Bolt: Precompute lowercased content during file load to avoid N*M overhead
        docs.push({ file, content, contentLower: content.toLowerCase() });
      } catch { /* ignore */ }
    }
  }

  return docs;
}

// ──── File Scanners ────────────────────────────────────────────────────────

// v0.29 consolidation: traversal delegates to the shared canonical walker;
// test-file pattern matching and config-ignore filtering stay per-file here.
function findTestFiles(rootDir, dir, files, config) {
  sharedWalkFiles(dir, (full) => {
    const entry = full.slice(full.lastIndexOf('/') + 1);
    const ext = extname(entry).toLowerCase();
    if (!TEST_EXTENSIONS.has(ext)) return;

    // Match test file patterns
    if (/\.(test|spec)\.(mjs|cjs|[jt]sx?)$/.test(entry) ||
        /__(tests|test)__/.test(relative(rootDir, full))) {
      const relPath = relative(rootDir, full);
      // Apply config ignore patterns (todoIgnore + global ignore)
      if (config && shouldIgnore(relPath, config, 'todoIgnore')) return;
      files.push(relPath);
    }
  }, { ignoreDirs: IGNORE_DIRS });
}

// Test-file path patterns — TODO scanning skips these by default to avoid
// false positives from test fixture strings (writeFileSync(..., '// xxxxx:')
// inside template literals is a comment marker for the regex but not a real
// annotation to track). Set config.todoTracking.includeTestFiles = true to override.
const TEST_FILE_RE = /(^|\/)__tests?__\//;
const TEST_NAME_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|java|go)$/;

// The validator's own source file describes the keyword list in its docstring
// and code. Skipping itself avoids self-referential false positives.
const SELF_PATH = new URL(import.meta.url).pathname;

function isTestFilePath(relPath) {
  return TEST_FILE_RE.test(relPath) || TEST_NAME_RE.test(relPath);
}

function isSelfPath(fullPath) {
  return fullPath === SELF_PATH;
}

function findTodos(rootDir, dir, todos, config) {
  // v0.15-P3: when config.changedFiles is set (--changed-only mode), only
  // scan those paths. New TODOs in this commit get caught; pre-existing
  // TODOs in unchanged files are still tracked by full guard runs.
  if (dir === rootDir && Array.isArray(config?.changedFiles) && config.changedFiles.length > 0) {
    for (const rel of config.changedFiles) {
      const full = resolve(rootDir, rel);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      _scanTodoFile(rootDir, full, todos, config);
    }
    return;
  }

  // v0.29 consolidation: traversal delegates to the shared canonical walker.
  sharedWalkFiles(dir, (full) => _scanTodoFile(rootDir, full, todos, config), {
    ignoreDirs: IGNORE_DIRS,
  });
}

/**
 * v0.15-P3: per-file TODO scan extracted so both the full-tree walker and
 * the --changed-only path can reuse it. Honors test-file filtering,
 * self-path skip, ignore patterns, and the TODO regex.
 */
function _scanTodoFile(rootDir, full, todos, config) {
  const includeTests = config?.todoTracking?.includeTestFiles === true;
  const ext = extname(full).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(ext)) return;

  const relPath = relative(rootDir, full);

  if (!includeTests && isTestFilePath(relPath)) return;
  if (isSelfPath(full)) return;
  if (config && shouldIgnore(relPath, config, 'todoIgnore')) return;

  let content;
  try { content = readFileSync(full, 'utf-8'); } catch { return; }
  if (!TODO_PATTERN.test(content)) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const commentText = commentPortion(lines[i]);
    if (commentText === null) continue;
    if (TODO_PATTERN.test(commentText)) {
      const match = commentText.match(TODO_EXTRACT);
      if (match) {
        todos.push({
          keyword: match[1].toUpperCase(),
          text: match[2].trim(),
          file: relPath,
          line: i + 1,
        });
      }
    }
  }
}
