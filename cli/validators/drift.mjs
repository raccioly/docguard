/**
 * Drift Validator — Every // DRIFT: comment must have a DRIFT-LOG.md entry
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { relPosix } from '../shared-ignore.mjs';

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.swift', '.kt',
  '.rb', '.php', '.cs', '.c', '.cpp', '.h',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'cli', // Exclude DocGuard's own source (contains DRIFT: in regex patterns)
]);

export function validateDrift(projectDir, config) {
  const results = { name: 'drift', errors: [], warnings: [], passed: 0, total: 0 };

  // v0.15-P3: when config.changedFiles is set (--changed-only mode), only
  // visit the listed paths. Drift comments in unchanged files are still in
  // git so they'll be caught by a full guard run; pre-commit hooks care
  // about NEW drift comments in this commit.
  const scanFile = (filePath) => {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) return;
    // v0.15 hotfix: test files commonly contain literal `// DRIFT:` inside
    // string fixtures (e.g. `'// DRIFT: a-drift\n'`). Reading the test as
    // source would treat the string as a real drift comment. Skip test
    // files unless the user opts in — same pattern TODO-Tracking uses.
    const rel = relPosix(projectDir, filePath);
    const includeTests = config?.drift?.includeTestFiles === true;
    if (!includeTests && /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^.]+$/.test(rel)) {
      return;
    }
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }
    if (!content.includes('DRIFT:')) return;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const match = line.match(/(?:\/\/|#|\/\*|\-\-)\s*DRIFT:\s*(.+)/i);
      if (match) {
        driftComments.push({
          file: relPosix(projectDir, filePath),
          line: i + 1,
          comment: match[1].trim(),
        });
      }
    });
  };

  const driftComments = [];
  if (Array.isArray(config.changedFiles) && config.changedFiles.length > 0) {
    for (const rel of config.changedFiles) {
      scanFile(resolve(projectDir, rel));
    }
  } else {
    walkDir(projectDir, scanFile);
  }

  if (driftComments.length === 0) {
    // No // DRIFT: comments to reconcile — not applicable (NOT a pass).
    results.note = 'no // DRIFT: comments in code';
    return results;
  }

  // Read DRIFT-LOG.md
  const driftLogPath = resolve(projectDir, config.requiredFiles.driftLog);
  if (!existsSync(driftLogPath)) {
    results.total = driftComments.length;
    for (const dc of driftComments) {
      results.errors.push(
        `${dc.file}:${dc.line} has DRIFT comment but DRIFT-LOG.md doesn't exist`
      );
    }
    return results;
  }

  const driftLogContent = readFileSync(driftLogPath, 'utf-8');

  // Check each drift comment has a matching entry in DRIFT-LOG.md
  for (const dc of driftComments) {
    results.total++;
    // Check if the file is mentioned in DRIFT-LOG.md
    if (driftLogContent.includes(dc.file)) {
      results.passed++;
    } else {
      results.errors.push(
        `${dc.file}:${dc.line} — DRIFT comment not logged in DRIFT-LOG.md`
      );
    }
  }

  return results;
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (stat.isFile()) {
        callback(fullPath);
      }
    } catch {
      // Skip files we can't read
    }
  }
}
