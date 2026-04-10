/**
 * Docs-Diff Validator — Checks alignment between canonical docs and code.
 *
 * Runs as part of `docguard guard` on every invocation.
 * Detects undocumented code artifacts and documented items not found in code.
 * Returns warnings (not errors) since drift is a soft signal.
 *
 * Respects config.ignore and config.testPatterns for test file discovery.
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';
import { shouldIgnore, globMatch } from '../shared-ignore.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'docs-canonical', 'docs-implementation', 'templates',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
]);

/**
 * Validate doc-code alignment — compares canonical docs vs source code.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateDocsDiff(projectDir, config) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const checks = [
    diffTechStack(projectDir),
    diffEnvVars(projectDir),
    diffTests(projectDir, config),
  ];

  for (const result of checks) {
    if (!result) continue;

    total++;
    const undocumented = result.onlyInCode.length;
    const stale = result.onlyInDocs.length;

    if (undocumented === 0 && stale === 0) {
      passed++;
    } else {
      const parts = [];
      if (undocumented > 0) parts.push(`${undocumented} in code but not documented`);
      if (stale > 0) parts.push(`${stale} documented but not found in code`);
      warnings.push(`${result.title} drift: ${parts.join(', ')}`);
    }
  }

  return { errors: [], warnings, passed, total };
}

// ── Diff Functions (lightweight versions for validator) ──────────────────

export function diffTechStack(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(archPath) || !existsSync(pkgPath)) return null;

  const archContent = readFileSync(archPath, 'utf-8');
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch { return null; }

  const docTech = new Set();
  const techPatterns = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Express', 'Fastify', 'Hono',
    'PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB', 'Redis', 'Prisma', 'Drizzle',
    'TypeScript', 'Tailwind', 'Docker', 'Terraform'];

  for (const tech of techPatterns) {
    if (archContent.toLowerCase().includes(tech.toLowerCase())) {
      docTech.add(tech);
    }
  }

  const codeTech = new Set();
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const depMap = {
    'react': 'React', 'next': 'Next.js', 'vue': 'Vue', 'express': 'Express',
    'fastify': 'Fastify', 'hono': 'Hono', 'prisma': 'Prisma', '@prisma/client': 'Prisma',
    'drizzle-orm': 'Drizzle', 'typescript': 'TypeScript', 'tailwindcss': 'Tailwind',
    'redis': 'Redis', 'ioredis': 'Redis', 'pg': 'PostgreSQL', 'mysql2': 'MySQL',
    'mongoose': 'MongoDB', '@aws-sdk/client-dynamodb': 'DynamoDB',
  };

  for (const [dep, tech] of Object.entries(depMap)) {
    if (allDeps[dep]) codeTech.add(tech);
  }

  if (docTech.size === 0 && codeTech.size === 0) return null;

  return {
    title: 'Tech Stack',
    onlyInDocs: [...docTech].filter(t => !codeTech.has(t)),
    onlyInCode: [...codeTech].filter(t => !docTech.has(t)),
  };
}

function diffEnvVars(dir) {
  const envDocPath = resolve(dir, 'docs-canonical/ENVIRONMENT.md');
  if (!existsSync(envDocPath)) return null;

  const content = readFileSync(envDocPath, 'utf-8');
  const docVars = new Set();
  const varRegex = /`([A-Z][A-Z0-9_]{2,})`/g;
  let match;
  while ((match = varRegex.exec(content)) !== null) {
    docVars.add(match[1]);
  }

  const codeVars = new Set();
  const envExamplePath = resolve(dir, '.env.example');
  if (existsSync(envExamplePath)) {
    const envContent = readFileSync(envExamplePath, 'utf-8');
    const envRegex = /^([A-Z][A-Z0-9_]+)\s*=/gm;
    while ((match = envRegex.exec(envContent)) !== null) {
      codeVars.add(match[1]);
    }
  }

  if (docVars.size === 0 && codeVars.size === 0) return null;

  return {
    title: 'Environment Variables',
    onlyInDocs: [...docVars].filter(v => !codeVars.has(v)),
    onlyInCode: [...codeVars].filter(v => !docVars.has(v)),
  };
}

/**
 * Diff test files between TEST-SPEC.md and actual code.
 * Uses config.testPatterns if available, otherwise falls back to
 * scanning standard test directories.
 * Always ignores node_modules via globMatch().
 */
function diffTests(dir, config) {
  const testSpecPath = resolve(dir, 'docs-canonical/TEST-SPEC.md');
  if (!existsSync(testSpecPath)) return null;

  const content = readFileSync(testSpecPath, 'utf-8');
  const docTests = new Set();
  const testFileRegex = /`([^`]*\.(test|spec)\.[^`]+)`/g;
  let match;
  while ((match = testFileRegex.exec(content)) !== null) {
    docTests.add(match[1]);
  }

  // Collect test files from disk using globMatch (always excludes node_modules)
  const codeTests = new Set();
  const testPatterns = config?.testPatterns || [];

  if (testPatterns.length > 0) {
    // Use configured patterns — globMatch handles node_modules exclusion
    const allTestFiles = getTestFilesFromPatterns(dir, testPatterns, config);
    for (const f of allTestFiles) {
      codeTests.add(f);
    }
  } else {
    // Fall back to standard test directories
    const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];
    for (const td of testDirs) {
      const testDir = resolve(dir, td);
      if (!existsSync(testDir)) continue;
      const files = getFilesRecursive(testDir, config);
      for (const f of files) {
        codeTests.add(f.replace(dir + '/', ''));
      }
    }
  }

  if (docTests.size === 0 && codeTests.size === 0) return null;

  return {
    title: 'Test Files',
    onlyInDocs: [...docTests].filter(t => !codeTests.has(t)),
    onlyInCode: [...codeTests].filter(t => !docTests.has(t)),
  };
}

/**
 * Find test files matching configured testPatterns.
 * Uses globMatch() for pattern matching — always excludes node_modules.
 * Results are deduplicated via Set (handles overlapping patterns).
 */
function getTestFilesFromPatterns(dir, patterns, config) {
  const results = new Set();

  function walk(currentDir) {
    let entries;
    try { entries = readdirSync(currentDir); } catch { return; }

    for (const entry of entries) {
      // Skip node_modules and other ignored dirs at directory level (fast path)
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const fullPath = join(currentDir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile()) {
          const relPath = relative(dir, fullPath);
          // Skip files in globally ignored paths
          if (config && shouldIgnore(relPath, config)) continue;
          // Use globMatch for positive pattern matching (rejects node_modules internally)
          if (globMatch(relPath, patterns)) {
            results.add(relPath);
          }
        }
      } catch { /* skip */ }
    }
  }

  walk(dir);
  return [...results];
}

function getFilesRecursive(dir, config) {
  const results = [];
  if (!existsSync(dir)) return results;
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...getFilesRecursive(fullPath, config));
      } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return results;
}
