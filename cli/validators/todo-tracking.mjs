/**
 * TODO/FIXME Tracking Validator — Ensures code annotations are documented
 *
 * Scans source files for TODO:, FIXME:, HACK:, XXX: annotations and checks
 * if they are tracked in documentation (ROADMAP.md, CURRENT-STATE.md, etc.).
 *
 * Also detects skipped tests without explanation.
 *
 * Inspired by spec-kit-cleanup (github.com/dsrednicki/spec-kit-cleanup)
 * which uses tiered issue classification for code hygiene.
 *
 * Zero dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';

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

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|TEMP(?!late|orar)|WORKAROUND)\s*[(:]/;
const TODO_EXTRACT = /\b(TODO|FIXME|HACK|XXX|TEMP(?!late|orar)|WORKAROUND)\s*[:(]?\s*(.+)/;

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
 */
export function validateTodoTracking(projectDir, config) {
  const results = { errors: [], warnings: [], passed: 0, total: 0 };

  // ── Part 1: Skipped Tests ──
  const skipResults = checkSkippedTests(projectDir, config);
  results.errors.push(...skipResults.errors);
  results.warnings.push(...skipResults.warnings);
  results.passed += skipResults.passed;
  results.total += skipResults.total;

  // ── Part 2: Untracked TODOs/FIXMEs ──
  const todoResults = checkUntrackedTodos(projectDir, config);
  results.errors.push(...todoResults.errors);
  results.warnings.push(...todoResults.warnings);
  results.passed += todoResults.passed;
  results.total += todoResults.total;

  return results;
}

// ──── Skipped Tests ────────────────────────────────────────────────────────

/**
 * Scan test files for skip/todo patterns without adjacent explanation comments.
 */
function checkSkippedTests(projectDir) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  const testFiles = [];
  findTestFiles(projectDir, projectDir, testFiles);

  if (testFiles.length === 0) return { errors, warnings, passed, total };

  // Check: "Project has test files" → pass
  total++;
  passed++;

  let skippedWithoutReason = 0;
  let skippedWithReason = 0;

  for (const relPath of testFiles) {
    const fullPath = resolve(projectDir, relPath);
    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

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
        warnings.push(
          `Skipped test without explanation at ${relPath}:${i + 1}. ` +
          `Add a // REASON: comment explaining why the test is skipped`
        );
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

  return { errors, warnings, passed, total };
}

// ──── Untracked TODOs ──────────────────────────────────────────────────────

/**
 * Scan source files for TODO/FIXME annotations and check if they appear
 * in tracking documentation.
 */
function checkUntrackedTodos(projectDir, config) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  // Collect all TODO/FIXME items from source
  const todos = [];
  findTodos(projectDir, projectDir, todos);

  if (todos.length === 0) {
    // No TODOs found — that's clean code
    total++;
    passed++;
    return { errors, warnings, passed, total };
  }

  // Check if TODOs are tracked in documentation
  const trackingContent = loadTrackingDocs(projectDir, config);

  total++;
  let untrackedCount = 0;

  for (const todo of todos) {
    // Check if the TODO text appears somewhere in tracking docs
    const isTracked = trackingContent.some(doc =>
      doc.content.includes(todo.keyword) ||
      doc.content.toLowerCase().includes(todo.text.toLowerCase().trim().substring(0, 30))
    );

    if (!isTracked) {
      untrackedCount++;
      // Only report first 5 to avoid noise
      if (untrackedCount <= 5) {
        warnings.push(
          `Untracked ${todo.keyword} at ${todo.file}:${todo.line}: "${todo.text.substring(0, 60)}". ` +
          `Add to ROADMAP.md, CURRENT-STATE.md, or a GitHub issue`
        );
      }
    }
  }

  if (untrackedCount > 5) {
    warnings.push(`...and ${untrackedCount - 5} more untracked TODO/FIXME items`);
  }

  if (untrackedCount === 0) {
    passed++;
  }

  return { errors, warnings, passed, total };
}

/**
 * Load doc files where TODOs should be tracked.
 */
function loadTrackingDocs(projectDir, config) {
  const docs = [];
  const trackingFiles = [
    'ROADMAP.md', 'CURRENT-STATE.md', 'TODO.md', 'BACKLOG.md',
    'docs-canonical/ARCHITECTURE.md', 'CHANGELOG.md',
    ...(config.todoTracking?.trackingFiles || []),
  ];

  for (const file of trackingFiles) {
    const fullPath = resolve(projectDir, file);
    if (existsSync(fullPath)) {
      try {
        docs.push({ file, content: readFileSync(fullPath, 'utf-8') });
      } catch { /* ignore */ }
    }
  }

  return docs;
}

// ──── File Scanners ────────────────────────────────────────────────────────

function findTestFiles(rootDir, dir, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      findTestFiles(rootDir, full, files);
    } else {
      const ext = extname(entry).toLowerCase();
      if (!TEST_EXTENSIONS.has(ext)) continue;

      // Match test file patterns
      if (/\.(test|spec)\.(mjs|cjs|[jt]sx?)$/.test(entry) ||
          /__(tests|test)__/.test(relative(rootDir, full))) {
        files.push(relative(rootDir, full));
      }
    }
  }
}

function findTodos(rootDir, dir, todos) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      findTodos(rootDir, full, todos);
    } else {
      const ext = extname(entry).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      let content;
      try { content = readFileSync(full, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      const relPath = relative(rootDir, full);

      for (let i = 0; i < lines.length; i++) {
        if (TODO_PATTERN.test(lines[i])) {
          const match = lines[i].match(TODO_EXTRACT);
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
  }
}
