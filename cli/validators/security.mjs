/**
 * Security Validator — Basic checks for secrets in code
 *
 * Respects config.securityIgnore (glob patterns) and config.ignore (global).
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { shouldIgnore, relPosix, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings, lineSuppresses } from '../findings.mjs';

// Each secret pattern maps to a stable finding code (see cli/findings.mjs CODES)
// so it is `explain`-able and inline-suppressible (`// docguard:ignore SEC00x`).
const LABEL_TO_CODE = {
  'hardcoded password': 'SEC001',
  'hardcoded API key': 'SEC002',
  'hardcoded secret key': 'SEC003',
  'hardcoded access token': 'SEC004',
  'AWS Access Key ID': 'SEC005',
  'API secret key (Stripe/OpenAI pattern)': 'SEC006',
};

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

/**
 * v0.27 (field report #1): a password-style key whose VALUE is natural
 * language — an error message, validation copy, UI string — is almost never a
 * credential. e.g. a "New password must differ from recent passwords"
 * validation message assigned to such a key.
 *
 * We don't drop these (a real secret that happens to read like prose must still
 * surface — false-green is the failure mode this tool exists to prevent); we
 * downgrade them to a LOW-CONFIDENCE warning the agent can suppress inline,
 * instead of a blocking error. Heuristic per the field report: ≥3 words, OR
 * ≥2 internal spaces, OR ends in sentence punctuation.
 *
 * @param {string} value - the literal inside the quotes
 */
function looksLikeProse(value) {
  if (!value) return false;
  const v = value.trim();
  const words = v.split(/\s+/).filter(Boolean);
  // Multi-word natural language (validation messages, UI copy, sentences).
  if (words.length >= 3) return true;
  // A 2-word sentence fragment ending in terminal punctuation — but NOT a
  // single token like "SuperSecretPassword!" (strong passwords end in !/? too,
  // so terminal punctuation ALONE must never reclassify a one-word value).
  if (words.length >= 2 && /[.!?]$/.test(v)) return true;
  return false;
}

/** Pull the first quoted literal out of a matched secret expression. */
function quotedValue(matchStr) {
  const m = matchStr.match(/['"]([^'"]*)['"]/);
  return m ? m[1] : '';
}

export function validateSecurity(projectDir, config) {
  /** @type {import('../findings.mjs').Finding[]} */
  const findings = [];
  let passed = 0;
  let total = 0;
  let scanned = 0;
  let realSecretCount = 0;

  walkDir(projectDir, (filePath) => {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) return;

    // Skip .env files — they're supposed to have secrets
    if (filePath.endsWith('.env') || filePath.endsWith('.env.local')) return;
    // Skip .env.example — it should have placeholder values
    if (filePath.endsWith('.env.example')) return;

    const relPath = relPosix(projectDir, filePath);

    // Apply config ignore patterns (securityIgnore + global ignore)
    if (shouldIgnore(relPath, config, 'securityIgnore')) return;

    scanned++;
    const content = readFileSync(filePath, 'utf-8');
    let lines = null;

    for (const { pattern, label } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      // Scan ALL matches for this pattern, not just the first. A real secret
      // can sit BELOW a safe placeholder of the same kind (e.g. an
      // `apiKey = "EXAMPLE..."` line above a hardcoded real key). Bailing on
      // the first match — as this loop used to — silently missed the real one.
      while ((match = pattern.exec(content)) !== null) {
        // Lazily initialize lines only when a match is found
        if (!lines) lines = content.split('\n');

        // 1-based line number + the line above (for inline-pragma suppression).
        const lineNo = content.slice(0, match.index).split('\n').length;
        const matchLine = lines[lineNo - 1] || '';
        const prevLine = lines[lineNo - 2] || '';

        // Skip known-safe placeholder/example values, but keep scanning for a
        // real one further down the file.
        if (isSafePlaceholder(matchLine, match[0])) continue;

        const code = LABEL_TO_CODE[label];

        // v0.27 (#8): honour an inline `// docguard:ignore SEC00x` pragma on the
        // line or the line above — per-line suppression instead of blinding the
        // whole file via `securityIgnore`.
        if (code && lineSuppresses(code, matchLine, prevLine)) break;

        const location = `${relPath}:${lineNo}`;
        const value = quotedValue(match[0]);
        const isProse = looksLikeProse(value);

        if (isProse) {
          // v0.27 (#1): natural-language value → low-confidence warning, not a
          // blocking error. Still surfaced (no false-green), still suppressible,
          // and now reportable via `docguard feedback`.
          findings.push(mkFinding({
            code, validator: 'security', severity: 'warn', confidence: 'low',
            message: `${location}: possible ${label} — but the value reads like natural-language text (likely UI copy / a validation message, not a credential)`,
            location,
            suggestion: {
              kind: 'suppress',
              text: 'If this is UI copy or a message and not a real secret, suppress it inline.',
              pragma: `// docguard:ignore ${code} — UI copy, not a credential`,
            },
            reportable: true,
            redactedContext: `${label} pattern fired on a value that is natural-language text (~${value.trim().split(/\s+/).filter(Boolean).length} words). Literal omitted.`,
          }));
        } else {
          realSecretCount++;
          findings.push(mkFinding({
            code, validator: 'security', severity: 'error', confidence: 'high',
            message: `${location}: possible ${label} found`,
            location,
            suggestion: {
              kind: 'fix',
              text: 'Move the secret to an environment variable and read it via process.env / the platform secret store. Never commit credentials.',
              command: code ? `docguard explain ${code}` : undefined,
              pragma: code ? `// docguard:ignore ${code} — reason (only if a confirmed false positive)` : undefined,
            },
          }));
        }
        // One finding per (file, label) is enough — the reported message is
        // identical for repeats and we've already proven a match exists.
        break;
      }
    }
  });

  // Only count the secret scan as a passed check if we actually scanned files.
  // An empty scan that reports "no secrets" is a dangerous false ✅ — surface it.
  if (scanned > 0) {
    total++;
    // Low-confidence (prose) findings do not fail the check — only real secrets do.
    if (realSecretCount === 0) passed++;
  } else {
    findings.push(mkFinding({
      code: 'SEC011', validator: 'security', severity: 'warn', confidence: 'high',
      message: 'No source files were scanned for secrets — check config.sourceRoot / ignore patterns',
      suggestion: { kind: 'review', text: 'Verify config.sourceRoot and ignore patterns actually include your source tree.' },
    }));
  }

  // Check .gitignore includes .env
  total++;
  const gitignorePath = resolve(projectDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    if (gitignore.includes('.env') || gitignore.includes('.env.local')) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'SEC010', validator: 'security', severity: 'warn', confidence: 'high',
        message: '.gitignore does not include .env — secrets may be committed',
        location: '.gitignore',
        suggestion: { kind: 'fix', text: 'Add `.env` and `.env.local` to .gitignore.' },
      }));
    }
  } else {
    findings.push(mkFinding({
      code: 'SEC010', validator: 'security', severity: 'warn', confidence: 'high',
      message: 'No .gitignore found — secrets may be committed',
      suggestion: { kind: 'fix', text: 'Create a .gitignore that excludes `.env` and `.env.local`.' },
    }));
  }

  return resultFromFindings(findings, { passed, total });
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
// keepDot('.env') is LOAD-BEARING — a secrets validator must scan dotenv files.
function walkDir(dir, callback) {
  sharedWalkFiles(dir, callback, {
    ignoreDirs: IGNORE_DIRS,
    keepDot: (entry) => entry === '.env',
  });
}
