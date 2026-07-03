/**
 * Environment Validator — Checks ENVIRONMENT.md docs and .env.example
 * Now respects projectTypeConfig (e.g., skip env checks for CLI tools)
 *
 * v0.29: migrated to structured findings (ENV001–ENV005). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { grepEnvUsage } from '../shared-source.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

export function validateEnvironment(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;
  const ptc = config.projectTypeConfig || {};

  const envDoc = 'docs-canonical/ENVIRONMENT.md';
  const envDocPath = resolve(projectDir, envDoc);
  if (!existsSync(envDocPath)) {
    // Structure validator catches missing files. Keep the exact legacy shape
    // here (no `findings` key) — tests deep-equal this early return.
    return { name: 'environment', errors: [], warnings: [], passed: 0, total: 0 };
  }

  const content = readFileSync(envDocPath, 'utf-8');

  // Check for required sections (anchored headings — not substring matches that
  // could hit a TOC entry or code block).
  const hasHeading = (re) => re.test(content);
  total++;
  if (hasHeading(/^#{2,3}\s+(Prerequisites|Setup Steps)\b/m)) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'ENV001',
      validator: 'environment',
      severity: 'warn',
      message: 'ENVIRONMENT.md: missing "## Prerequisites" or "## Setup Steps" section',
      location: envDoc,
      suggestion: { kind: 'fix', text: 'Add a "## Setup Steps" (or "## Prerequisites") section describing how to get the project running' },
    }));
  }

  total++;
  if (hasHeading(/^#{2,3}\s+Environment Variables\b/m)) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'ENV002',
      validator: 'environment',
      severity: 'warn',
      message: 'ENVIRONMENT.md: missing "## Environment Variables" section',
      location: envDoc,
      suggestion: { kind: 'fix', text: 'Add a "## Environment Variables" section documenting each variable the app reads' },
    }));
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
    // v0.16-P4 (revised in v0.17.1-B7): skip backticked SYSTEM env vars
    // (PATH, HOME, USER, etc.) that appear in ENVIRONMENT.md prose. Trimmed
    // to TRULY-system-only after wu feedback — NODE_ENV / CI / GITHUB_* were
    // causing asymmetric flagging between diff and this validator. Apps
    // legitimately treat NODE_ENV as app config; keep the list to vars that
    // no sane application would read as runtime config.
    const SYSTEM = new Set([
      'PATH','HOME','USER','USERNAME','SHELL','PWD','OLDPWD','TMPDIR','TEMP','TMP',
      'LANG','LC_ALL','LC_CTYPE','LC_MESSAGES','TZ',
      'EDITOR','VISUAL','PAGER','TERM','COLORTERM',
      'DISPLAY','SSH_AUTH_SOCK','SSH_CONNECTION','SSH_TTY',
      'XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR',
    ]);
    let m;
    while ((m = varRe.exec(content)) !== null) {
      if (m[1].length < 3) continue; // 'OK' / 'ID' etc. are too short to be env var refs
      if (SYSTEM.has(m[1])) continue; // v0.16-P4: prose mentions of system vars are not docs
      documented.add(m[1]);
    }
    // Also extract markdown table rows where the first column is a bare env
    // var name (no backticks). Real-world ENVIRONMENT.md docs frequently use
    // pipe tables with un-backticked names — the backtick-only regex above
    // silently misses every suffixed variant (DYNAMODB_TABLE_JOBS,
    // DYNAMODB_TABLE_SOURCES, …) and they get reported as undocumented.
    // Match `| VAR_NAME |` anywhere on the line; require the row to also
    // contain a second `|` (real table row), not a stray pipe in prose.
    const tableRe = /^\s*\|\s*([A-Z][A-Z0-9_]*[A-Z0-9])\s*\|/gm;
    while ((m = tableRe.exec(content)) !== null) {
      if (m[1].length < 3) continue;
      if (SYSTEM.has(m[1])) continue;
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
      total++;
      if (usedButUndocumented.length === 0) {
        passed++;
      } else {
        const shown = usedButUndocumented.slice(0, 10).join(', ');
        const more = usedButUndocumented.length > 10 ? ` (+${usedButUndocumented.length - 10} more)` : '';
        findings.push(mkFinding({
          code: 'ENV003',
          validator: 'environment',
          severity: 'warn',
          message: `${usedButUndocumented.length} env var(s) used in code but not documented in ENVIRONMENT.md / .env.example: ${shown}${more}`,
          location: envDoc,
          suggestion: { kind: 'fix', text: 'Document each listed variable in ENVIRONMENT.md, or add it to .env.example' },
        }));
      }
    }
  }

  // Only check .env.example if the project type needs it
  if (ptc.needsEnvExample !== false && ptc.needsEnvVars !== false) {
    // Check if .env.example is referenced and exists
    if (content.includes('.env.example')) {
      total++;
      if (existsSync(resolve(projectDir, '.env.example'))) {
        passed++;
      } else {
        findings.push(mkFinding({
          code: 'ENV004',
          validator: 'environment',
          severity: 'warn',
          message: 'ENVIRONMENT.md references .env.example but the file does not exist',
          location: envDoc,
          suggestion: { kind: 'fix', text: 'Create .env.example with placeholder values, or remove the stale reference from ENVIRONMENT.md' },
        }));
      }
    }

    // Check if any .env file exists but no .env.example is provided
    total++;
    const hasEnvFile = ['.env', '.env.local', '.env.development'].some(f =>
      existsSync(resolve(projectDir, f))
    );
    const hasEnvExample = existsSync(resolve(projectDir, '.env.example'));

    if (hasEnvFile && !hasEnvExample) {
      findings.push(mkFinding({
        code: 'ENV005',
        validator: 'environment',
        severity: 'warn',
        message: '.env file exists but no .env.example template — new contributors won\'t know what vars to set',
        location: '.env.example',
        suggestion: { kind: 'fix', text: 'Create a .env.example template listing every variable with a placeholder value' },
      }));
    } else {
      passed++;
    }
  } else {
    // CLI/library project — just verify doc exists and has basic content
    total++;
    passed++;
  }

  return { name: 'environment', ...resultFromFindings(findings, { passed, total }) };
}
