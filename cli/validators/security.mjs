/**
 * Security Validator — Basic checks for secrets in code
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

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

    const content = readFileSync(filePath, 'utf-8');
    const relPath = filePath.replace(projectDir + '/', '');

    for (const { pattern, label } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (match) {
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
