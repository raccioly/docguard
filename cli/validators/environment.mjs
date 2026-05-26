/**
 * Environment Validator — Checks ENVIRONMENT.md docs and .env.example
 * Now respects projectTypeConfig (e.g., skip env checks for CLI tools)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { grepEnvUsage } from '../shared-source.mjs';

export function validateEnvironment(projectDir, config) {
  const results = { name: 'environment', errors: [], warnings: [], passed: 0, total: 0 };
  const ptc = config.projectTypeConfig || {};

  const envDocPath = resolve(projectDir, 'docs-canonical/ENVIRONMENT.md');
  if (!existsSync(envDocPath)) {
    return results; // Structure validator catches missing files
  }

  const content = readFileSync(envDocPath, 'utf-8');

  // Check for required sections (anchored headings — not substring matches that
  // could hit a TOC entry or code block).
  const hasHeading = (re) => re.test(content);
  results.total++;
  if (hasHeading(/^#{2,3}\s+(Prerequisites|Setup Steps)\b/m)) {
    results.passed++;
  } else {
    results.warnings.push('ENVIRONMENT.md: missing "## Prerequisites" or "## Setup Steps" section');
  }

  results.total++;
  if (hasHeading(/^#{2,3}\s+Environment Variables\b/m)) {
    results.passed++;
  } else {
    results.warnings.push('ENVIRONMENT.md: missing "## Environment Variables" section');
  }

  // ── Real code-truth check: env vars USED in code but documented nowhere ──
  // (Replaces the old pure section-presence heuristic with an actual comparison
  // against process.env / import.meta.env usage. .env.example counts as docs.
  // CLI/library projects that declare no env vars skip this.)
  if (ptc.needsEnvVars !== false) {
    const documented = new Set();
    // Require the matched name to end with a letter/digit — prevents prose-only
    // tokens like `VITE_` (the convention prefix) from being treated as a real
    // variable name.
    const varRe = /`([A-Z][A-Z0-9_]*[A-Z0-9])`/g;
    // v0.16-P4: skip backticked SYSTEM env vars (PATH, HOME, USER, etc.).
    // They appear in ENVIRONMENT.md prose ("the venv `PATH`") but aren't
    // user-set application vars. Mirrors the same skip in diff.mjs.
    const SYSTEM = new Set([
      'PATH','HOME','USER','USERNAME','SHELL','PWD','OLDPWD','TMPDIR','TEMP','TMP',
      'LANG','LC_ALL','LC_CTYPE','LC_MESSAGES','TZ',
      'EDITOR','VISUAL','PAGER','TERM','COLORTERM',
      'DISPLAY','SSH_AUTH_SOCK','SSH_CONNECTION','SSH_TTY',
      'XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR',
      'CI','GITHUB_TOKEN','GITHUB_ACTIONS','GITHUB_REF','GITHUB_SHA','NODE_ENV',
    ]);
    let m;
    while ((m = varRe.exec(content)) !== null) {
      if (m[1].length < 3) continue; // 'OK' / 'ID' etc. are too short to be env var refs
      if (SYSTEM.has(m[1])) continue; // v0.16-P4: prose mentions of system vars are not docs
      documented.add(m[1]);
    }
    for (const envFile of ['.env.example', '.env.template']) {
      const p = resolve(projectDir, envFile);
      if (!existsSync(p)) continue;
      const re = /^([A-Z][A-Z0-9_]*[A-Z0-9])\s*=/gm;
      const ex = readFileSync(p, 'utf-8');
      let em;
      while ((em = re.exec(ex)) !== null) documented.add(em[1]);
    }

    const codeUsed = grepEnvUsage(projectDir, config);

    // Only assess when code actually reads env vars — otherwise the check is
    // vacuous (always passes) and would just inflate the count.
    if (codeUsed.size > 0) {
      const usedButUndocumented = [...codeUsed].filter(v => !documented.has(v));
      results.total++;
      if (usedButUndocumented.length === 0) {
        results.passed++;
      } else {
        const shown = usedButUndocumented.slice(0, 10).join(', ');
        const more = usedButUndocumented.length > 10 ? ` (+${usedButUndocumented.length - 10} more)` : '';
        results.warnings.push(
          `${usedButUndocumented.length} env var(s) used in code but not documented in ENVIRONMENT.md / .env.example: ${shown}${more}`
        );
      }
    }
  }

  // Only check .env.example if the project type needs it
  if (ptc.needsEnvExample !== false && ptc.needsEnvVars !== false) {
    // Check if .env.example is referenced and exists
    if (content.includes('.env.example')) {
      results.total++;
      if (existsSync(resolve(projectDir, '.env.example'))) {
        results.passed++;
      } else {
        results.warnings.push(
          'ENVIRONMENT.md references .env.example but the file does not exist'
        );
      }
    }

    // Check if any .env file exists but no .env.example is provided
    results.total++;
    const hasEnvFile = ['.env', '.env.local', '.env.development'].some(f =>
      existsSync(resolve(projectDir, f))
    );
    const hasEnvExample = existsSync(resolve(projectDir, '.env.example'));

    if (hasEnvFile && !hasEnvExample) {
      results.warnings.push(
        '.env file exists but no .env.example template — new contributors won\'t know what vars to set'
      );
    } else {
      results.passed++;
    }
  } else {
    // CLI/library project — just verify doc exists and has basic content
    results.total++;
    results.passed++;
  }

  return results;
}
