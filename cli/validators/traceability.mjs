/**
 * Traceability Validator — Checks that canonical docs are linked to source code
 * 
 * Returns warnings for PARTIAL/UNLINKED canonical docs, and errors for MISSING ones.
 * This runs as part of `docguard guard` on every invocation.
 *
 * Inspired by ISO/IEC/IEEE 29119 traceability requirements
 * and Lopez et al., AITPG (IEEE TSE 2026).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

/**
 * Mapping of canonical docs to source code patterns they should trace to.
 */
const TRACE_MAP = {
  'ARCHITECTURE.md': {
    sourcePatterns: [
      { label: 'Entry points', glob: /^(index|main|app|server)\.[jt]sx?$/ },
      { label: 'Config files', glob: /^(package\.json|tsconfig.*|next\.config|vite\.config)/ },
      { label: 'Route handlers', glob: /(routes?|api|pages|app)\// },
    ],
  },
  'DATA-MODEL.md': {
    sourcePatterns: [
      { label: 'Schema definitions', glob: /(schema|model|entity|migration|prisma)/i },
      { label: 'Type definitions', glob: /types?\.[jt]sx?$/ },
      { label: 'Database configs', glob: /(drizzle|knex|sequelize|typeorm)/i },
    ],
  },
  'TEST-SPEC.md': {
    sourcePatterns: [
      { label: 'Test files', glob: /\.(test|spec)\.(mjs|cjs|[jt]sx?)$/ },
      { label: 'Test config', glob: /(jest|vitest|playwright|cypress)\.config/ },
      { label: 'E2E tests', glob: /(e2e|integration)\// },
    ],
  },
  'SECURITY.md': {
    sourcePatterns: [
      { label: 'Auth modules', glob: /(auth|login|session|jwt|oauth|middleware)/i },
      { label: 'Secret configs', glob: /\.(env|env\.example|env\.local)$/ },
      { label: 'Gitignore', glob: /^\.gitignore$/ },
    ],
  },
  'ENVIRONMENT.md': {
    sourcePatterns: [
      { label: 'Env files', glob: /\.env/ },
      { label: 'Docker configs', glob: /(Dockerfile|docker-compose|\.dockerignore)/ },
      { label: 'CI/CD configs', glob: /\.(github|gitlab-ci|circleci)/ },
    ],
  },
  'API-REFERENCE.md': {
    sourcePatterns: [
      { label: 'Route handlers', glob: /(routes?|controllers?|handlers?)\// },
      { label: 'OpenAPI spec', glob: /(openapi|swagger)\.(json|ya?ml)/ },
      { label: 'API middleware', glob: /middleware\// },
    ],
  },
};

/**
 * Validate traceability — ensures canonical docs have corresponding source artifacts.
 * Respects config.requiredFiles.canonical — only checks docs the user requires.
 * Also warns about orphaned files (exist but excluded from config).
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateTraceability(projectDir, config) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    // No docs-canonical dir at all — structure validator handles this
    return { errors, warnings, passed: 0, total: 0 };
  }

  // Build set of required doc basenames from config
  const requiredDocs = new Set(
    (config.requiredFiles?.canonical || []).map(f => basename(f))
  );

  // Scan project files once
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);

  // ── Check required docs for traceability ──
  for (const [docName, traceInfo] of Object.entries(TRACE_MAP)) {
    // Skip docs not in the user's required list
    if (!requiredDocs.has(docName)) continue;

    total++;
    const docPath = resolve(docsDir, docName);
    const docExists = existsSync(docPath);

    if (!docExists) {
      warnings.push(`${docName} — required but missing, no traceability possible`);
      continue;
    }

    // Count matching source files
    let totalSources = 0;
    for (const pattern of traceInfo.sourcePatterns) {
      const matches = projectFiles.filter(f => pattern.glob.test(f));
      totalSources += matches.length;
    }

    if (totalSources > 0) {
      passed++;
    } else {
      warnings.push(`${docName} — exists but no matching source code found (unlinked doc)`);
    }
  }

  // ── Detect orphaned files (exist but not required) ──
  try {
    const existingDocs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const docFile of existingDocs) {
      if (!requiredDocs.has(docFile) && TRACE_MAP[docFile]) {
        warnings.push(`${docFile} — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical`);
      }
    }
  } catch { /* ignore */ }

  return { errors, warnings, passed, total };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function scanDir(rootDir, dir, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.') && entry !== '.env' && entry !== '.env.example'
        && entry !== '.gitignore' && !entry.startsWith('.github')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      scanDir(rootDir, full, files);
    } else {
      files.push(relative(rootDir, full));
    }
  }
}
