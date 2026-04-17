/**
 * Security Validator — Basic checks for secrets in code
 *
 * Respects config.securityIgnore (glob patterns) and config.ignore (global).
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { shouldIgnore } from '../shared-ignore.mjs';

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.swift', '.kt',
  '.rb', '.php', '.cs', '.env',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
]);

// Patterns that might indicate hardcoded secrets
const SECRET_PATTERNS = [
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi, label: 'hardcoded password' },
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{16,}['"]/gi, label: 'hardcoded API key' },
  { pattern: /(?:secret[_-]?key|secretkey)\s*[:=]\s*['"][^'"]{16,}['"]/gi, label: 'hardcoded secret key' },
  { pattern: /(?:access[_-]?token|accesstoken)\s*[:=]\s*['"][^'"]{16,}['"]/gi, label: 'hardcoded access token' },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS Access Key ID' },
  { pattern: /(?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}/g, label: 'API secret key (Stripe/OpenAI pattern)' },
];

// Known-safe placeholder/example values that should never be flagged
const SAFE_PATTERNS = [
  /EXAMPLE/i,                           // AWS docs example keys contain "EXAMPLE"
  /placeholder\s*=\s*["']/i,           // HTML placeholder attributes
  /example\s*:/i,                       // OpenAPI example: blocks
  /['"]password123['"]/,               // Common test fixture value
  /\/\/\s*example/i,                    // Code comments with "example"
  /<!--.*-->/,                          // HTML comments
];

/**
 * Check if a match line is a known-safe placeholder/example.
 * @param {string} line - The full source line containing the match
 * @param {string} matchStr - The matched string
 * @returns {boolean} - true if this is a safe/placeholder value
 */
function isSafePlaceholder(line, matchStr) {
  // Check if the matched string itself contains "EXAMPLE"
  if (/EXAMPLE/i.test(matchStr)) return true;

  // Check if the source line matches any safe pattern
  return SAFE_PATTERNS.some(p => p.test(line));
}

export function validateSecurity(projectDir, config) {
  const results = { name: 'security', errors: [], warnings: [], passed: 0, total: 0 };

  const findings = [];

  walkDir(projectDir, (filePath) => {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) return;

    // Skip .env files — they're supposed to have secrets
    if (filePath.endsWith('.env') || filePath.endsWith('.env.local')) return;
    // Skip .env.example — it should have placeholder values
    if (filePath.endsWith('.env.example')) return;

    const relPath = filePath.replace(projectDir + '/', '');

    // Apply config ignore patterns (securityIgnore + global ignore)
    if (shouldIgnore(relPath, config, 'securityIgnore')) return;

    const content = readFileSync(filePath, 'utf-8');
    let lines = null;

    for (const { pattern, label } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (match) {
        // Lazily initialize lines only when a match is found
        if (!lines) lines = content.split('\n');

        // Find the line containing this match for context-aware filtering
        const matchPos = match.index;
        let charCount = 0;
        let matchLine = '';
        for (const line of lines) {
          charCount += line.length + 1; // +1 for newline
          if (charCount > matchPos) {
            matchLine = line;
            break;
          }
        }

        // Skip known-safe placeholder/example values
        if (isSafePlaceholder(matchLine, match[0])) continue;

        findings.push({ file: relPath, label, match: match[0].substring(0, 30) + '...' });
      }
    }
  });

  results.total = 1;
  if (findings.length === 0) {
    results.passed = 1;
  } else {
    for (const f of findings) {
      results.errors.push(`${f.file}: possible ${f.label} found`);
    }
  }

  // Check .gitignore includes .env
  results.total++;
  const gitignorePath = resolve(projectDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    if (gitignore.includes('.env') || gitignore.includes('.env.local')) {
      results.passed++;
    } else {
      results.warnings.push('.gitignore does not include .env — secrets may be committed');
    }
  } else {
    results.warnings.push('No .gitignore found — secrets may be committed');
  }

  return results;
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.') && entry !== '.env') continue;

    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (stat.isFile()) {
        callback(fullPath);
      }
    } catch {
      // Skip unreadable files
    }
  }
}
