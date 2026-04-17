/**
 * Drift Validator — Every // DRIFT: comment must have a DRIFT-LOG.md entry
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

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

  // Find all // DRIFT: comments in source code
  const driftComments = [];
  walkDir(projectDir, (filePath) => {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) return;

    const content = readFileSync(filePath, 'utf-8');

    // Fast early-return: skip expensive string split if no comment exists
    if (!content.includes('DRIFT:')) return;

    const lines = content.split('\n');

    lines.forEach((line, i) => {
      // Match various comment styles: // DRIFT:, # DRIFT:, /* DRIFT:, -- DRIFT:
      const match = line.match(/(?:\/\/|#|\/\*|\-\-)\s*DRIFT:\s*(.+)/i);
      if (match) {
        driftComments.push({
          file: filePath.replace(projectDir + '/', ''),
          line: i + 1,
          comment: match[1].trim(),
        });
      }
    });
  });

  if (driftComments.length === 0) {
    results.total = 1;
    results.passed = 1;
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
