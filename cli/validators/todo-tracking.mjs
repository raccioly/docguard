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
import { shouldIgnore } from '../shared-ignore.mjs';

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
const SKIP_PATTERNS = /\b(?:test\.skip|it\.skip|describe\.skip|xit|xdescribe|xtest|test\.todo|it\.todo)\s*\(|\.todo\s*\(/;

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
function checkSkippedTests(projectDir, config) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  const testFiles = [];
  findTestFiles(projectDir, projectDir, testFiles, config);

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

    // Fast early-return: skip expensive string split if no skip patterns exist
    if (!SKIP_PATTERNS.test(content)) continue;

    // Fast memory-efficient line parsing, replacing lines.split
    let i = 0;
    let lineStartIndex = 0;
    let newlineIndex = content.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = content.slice(lineStartIndex, newlineIndex);

      // Check if this line has a test skip pattern
      if (SKIP_PATTERNS.test(line)) {
        // Find surrounding lines (3 above, 1 below, and inline) for explanation
        // Developers commonly place block comments above the skip call
        // We find the bounds rather than slicing an array of lines.
        let surroundingStart = lineStartIndex;
        for (let k = 0; k < 3; k++) {
          const prev = content.lastIndexOf('\n', surroundingStart - 2);
          if (prev === -1) {
            surroundingStart = 0;
            break;
          }
          surroundingStart = prev + 1;
        }

        let surroundingEnd = newlineIndex;
        for (let k = 0; k < 2; k++) {
          const next = content.indexOf('\n', surroundingEnd + 1);
          if (next === -1) {
            surroundingEnd = content.length;
            break;
          }
          surroundingEnd = next;
        }

        const surroundingLines = content.slice(surroundingStart, surroundingEnd);

        // Also check for block comment pattern: /* REASON: ... */ or /** ... REASON: ... */
        const blockCommentPattern = /\/\*[\s\S]*?(REASON|SKIP|TODO|FIXME|NOTE|WHY)\s*:/i;

        const hasReason =
          SKIP_REASON_PATTERN.test(surroundingLines) ||
          blockCommentPattern.test(surroundingLines);

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

      lineStartIndex = newlineIndex + 1;
      newlineIndex = content.indexOf('\n', lineStartIndex);
      i++;
    }

    // Process last line
    const line = content.slice(lineStartIndex);
    if (SKIP_PATTERNS.test(line)) {
      // Find surrounding lines (3 above, 1 below, and inline) for explanation

      let surroundingStart = lineStartIndex;
      for (let k = 0; k < 3; k++) {
        const prev = content.lastIndexOf('\n', surroundingStart - 2);
        if (prev === -1) {
          surroundingStart = 0;
          break;
        }
        surroundingStart = prev + 1;
      }

      const surroundingLines = content.slice(surroundingStart);

      // Also check for block comment pattern: /* REASON: ... */ or /** ... REASON: ... */
      const blockCommentPattern = /\/\*[\s\S]*?(REASON|SKIP|TODO|FIXME|NOTE|WHY)\s*:/i;

      const hasReason =
        SKIP_REASON_PATTERN.test(surroundingLines) ||
        blockCommentPattern.test(surroundingLines);

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
  findTodos(projectDir, projectDir, todos, config);

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
    // Check if the TODO is tracked in documentation
    // Improved matching: check full text AND file location context
    const isTracked = trackingContent.some(doc => {
      const content = doc.content;
      const contentLower = doc.contentLower;
      const todoTextLower = todo.text.toLowerCase().trim();

      // Match 1: Full TODO text appears in the doc (at least 20 chars or full text)
      const searchText = todoTextLower.length > 20
        ? todoTextLower.substring(0, 40)
        : todoTextLower;
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
        const content = readFileSync(fullPath, 'utf-8');
        docs.push({
          file,
          content,
          contentLower: content.toLowerCase()
        });
      } catch { /* ignore */ }
    }
  }

  return docs;
}

// ──── File Scanners ────────────────────────────────────────────────────────

function findTestFiles(rootDir, dir, files, config) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      findTestFiles(rootDir, full, files, config);
    } else {
      const ext = extname(entry).toLowerCase();
      if (!TEST_EXTENSIONS.has(ext)) continue;

      // Match test file patterns
      if (/\.(test|spec)\.(mjs|cjs|[jt]sx?)$/.test(entry) ||
          /__(tests|test)__/.test(relative(rootDir, full))) {
        const relPath = relative(rootDir, full);
        // Apply config ignore patterns (todoIgnore + global ignore)
        if (config && shouldIgnore(relPath, config, 'todoIgnore')) continue;
        files.push(relPath);
      }
    }
  }
}

function findTodos(rootDir, dir, todos, config) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      findTodos(rootDir, full, todos, config);
    } else {
      const ext = extname(entry).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const relPath = relative(rootDir, full);

      // Apply config ignore patterns (todoIgnore + global ignore)
      if (config && shouldIgnore(relPath, config, 'todoIgnore')) continue;

      let content;
      try { content = readFileSync(full, 'utf-8'); } catch { continue; }

      // Fast early-return: skip expensive string split if no TODO patterns exist
      if (!TODO_PATTERN.test(content)) continue;

      // Use indexOf('\n') to avoid array allocation overhead (as per memory)
      let lineNum = 1;
      let lineStartIndex = 0;
      let newlineIndex = content.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = content.slice(lineStartIndex, newlineIndex);
        if (TODO_PATTERN.test(line)) {
          const match = line.match(TODO_EXTRACT);
          if (match) {
            todos.push({
              keyword: match[1].toUpperCase(),
              text: match[2].trim(),
              file: relPath,
              line: lineNum,
            });
          }
        }
        lineStartIndex = newlineIndex + 1;
        newlineIndex = content.indexOf('\n', lineStartIndex);
        lineNum++;
      }

      // Process last line
      const line = content.slice(lineStartIndex);
      if (TODO_PATTERN.test(line)) {
        const match = line.match(TODO_EXTRACT);
        if (match) {
          todos.push({
            keyword: match[1].toUpperCase(),
            text: match[2].trim(),
            file: relPath,
            line: lineNum,
          });
        }
      }
    }
  }
}
