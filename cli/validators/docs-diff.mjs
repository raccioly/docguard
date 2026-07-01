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
import { collectPackageJsons, detectDocker, resolveSourceRoots } from '../shared-source.mjs';

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

  // NOTE: env-var drift is owned by the Environment validator (which compares
  // documented vars against real process.env / import.meta.env usage). Docs-Diff
  // covers tech-stack and test-file drift to avoid double-reporting.
  const checks = [
    diffTechStack(projectDir, config),
    diffTests(projectDir, config),
  ];

  // Limit how many offending names are inlined in a single warning — keeps
  // the line readable on terminals while still naming the specific files so
  // the warning is actually actionable. Without these names the user gets a
  // bare count ("1 documented but not found in code") with no path to debug.
  const MAX_INLINE = 5;
  const fmtList = (arr) => {
    const shown = arr.slice(0, MAX_INLINE).map(v => `\`${v}\``).join(', ');
    const extra = arr.length - MAX_INLINE;
    return extra > 0 ? `${shown} (+${extra} more)` : shown;
  };

  for (const result of checks) {
    if (!result) continue;

    total++;
    const undocumented = result.onlyInCode.length;
    const stale = result.onlyInDocs.length;

    if (undocumented === 0 && stale === 0) {
      passed++;
    } else {
      const parts = [];
      if (undocumented > 0) {
        parts.push(`${undocumented} in code but not documented: ${fmtList(result.onlyInCode)}`);
      }
      if (stale > 0) {
        parts.push(`${stale} documented but not found in code: ${fmtList(result.onlyInDocs)}`);
      }
      warnings.push(`${result.title} drift: ${parts.join('; ')}`);
    }
  }

  return { errors: [], warnings, passed, total };
}

// ── Diff Functions (lightweight versions for validator) ──────────────────

export function diffTechStack(dir, config = {}) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return null;

  // Monorepo-aware: merge dependencies across the root package + the source-root
  // package + any workspace packages. A repo with no parseable package.json
  // anywhere yields no code-side truth → return null (graceful, like before).
  const pkgs = collectPackageJsons(dir, config);
  if (pkgs.length === 0) return null;

  const archContent = readFileSync(archPath, 'utf-8');

  const docTech = new Set();
  const techPatterns = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Express', 'Fastify', 'Hono',
    'PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB', 'Redis', 'Prisma', 'Drizzle',
    'TypeScript', 'Tailwind', 'Docker', 'Terraform'];

  // ⚡ Bolt: Precompute lowercased content outside the loop to avoid O(N) allocation overhead
  const archContentLower = archContent.toLowerCase();
  for (const tech of techPatterns) {
    if (archContentLower.includes(tech.toLowerCase())) {
      docTech.add(tech);
    }
  }

  const codeTech = new Set();
  const allDeps = {};
  for (const { pkg } of pkgs) {
    Object.assign(allDeps, pkg.dependencies || {}, pkg.devDependencies || {});
  }
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

  // Docker is not an npm dependency — detect it via a Dockerfile/compose file.
  if (detectDocker(dir, config)) codeTech.add('Docker');
  // Terraform: detect via .tf files anywhere in the project (non-npm artifact).
  if (hasFileWithExt(dir, '.tf', config)) codeTech.add('Terraform');

  if (docTech.size === 0 && codeTech.size === 0) return null;

  return {
    title: 'Tech Stack',
    onlyInDocs: [...docTech].filter(t => !codeTech.has(t)),
    onlyInCode: [...codeTech].filter(t => !docTech.has(t)),
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

  // Strip fenced code blocks first — they contain shell commands like
  // `npx playwright test login.spec.ts` whose tokens were being mis-extracted
  // as documented test files.
  const content = readFileSync(testSpecPath, 'utf-8').replace(/```[\s\S]*?```/g, '');
  const docTests = new Set();
  // A documented test reference: a single whitespace-free token ending in
  // .test.<ext> or .spec.<ext>, optionally containing glob '*'.
  const testFileRegex = /`([^`\s]*\.(?:test|spec)\.[a-zA-Z0-9]+)`/g;
  let match;
  while ((match = testFileRegex.exec(content)) !== null) {
    docTests.add(match[1]);
  }

  // Collect ALL test files from disk: configured patterns + every *.test.* /
  // *.spec.* file found recursively under each source root (catches co-located
  // and nested __tests__ dirs) + root-level conventional test dirs (e2e/, tests/).
  const codeTests = collectCodeTests(dir, config);

  if (docTests.size === 0 && codeTests.size === 0) return null;

  // TEST-SPEC.md frequently documents tests as GLOB PATTERNS
  // (`backend/src/*/__tests__/*.test.ts`, `e2e/*.spec.ts`), and entries may be
  // bare basenames or full paths. Treat each documented entry as a glob and
  // match it against code test paths (or basenames when the entry has no slash).
  // Exact-string comparison produced the false "N documented but not found".
  const codeArr = [...codeTests];

  // PERFORMANCE OPTIMIZATION: Pre-compile regular expressions to avoid O(N*M)
  // instantiation bottlenecks inside the nested .filter and .some loops below.
  const docMatchers = [...docTests].map(docEntry => {
    const entry = String(docEntry).trim();
    const hasSlash = entry.includes('/');
    const target = hasSlash ? entry : basename(entry);
    // Glob -> regex: escape regex specials, then any run of '*' becomes '.*'.
    const rx = new RegExp('^' + target
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*+/g, '.*') + '$');

    return {
      original: docEntry,
      hasSlash,
      rx
    };
  });

  const matches = (matcher, codeRel) => {
    const subject = matcher.hasSlash ? codeRel : basename(codeRel);
    return matcher.rx.test(subject);
  };

  return {
    title: 'Test Files',
    onlyInDocs: docMatchers.filter(m => !codeArr.some(c => matches(m, c))).map(m => m.original),
    onlyInCode: codeArr.filter(c => !docMatchers.some(m => matches(m, c))),
  };
}

/**
 * Collect every test file in the project (relative paths), monorepo-aware:
 *   - configured config.testPatterns
 *   - any *.test.* / *.spec.* found recursively under each source root
 *     (catches co-located and deeply-nested __tests__ directories)
 *   - root-level conventional test dirs (tests/, e2e/, cypress/, etc.)
 * @returns {Set<string>} relative test file paths
 */
export function collectCodeTests(dir, config = {}) {
  const codeTests = new Set();
  const isTest = (f) => /\.(test|spec)\./.test(f);

  // 1. configured patterns
  for (const f of getTestFilesFromPatterns(dir, config?.testPatterns || [], config)) {
    codeTests.add(f);
  }

  // 2. recursive scan of each source root (co-located + nested __tests__)
  for (const root of resolveSourceRoots(dir, config)) {
    for (const f of getFilesRecursive(root, config)) {
      if (isTest(f)) codeTests.add(relative(dir, f));
    }
  }

  // 3. root-level conventional test dirs (e2e lives outside any source root)
  for (const td of ['tests', 'test', '__tests__', 'spec', 'e2e', 'cypress']) {
    const testDir = join(resolve(dir), td);
    if (!existsSync(testDir)) continue;
    for (const f of getFilesRecursive(testDir, config)) {
      if (isTest(f)) codeTests.add(relative(dir, f));
    }
  }

  return codeTests;
}

/**
 * Find test files matching configured testPatterns.
 * Uses globMatch() for pattern matching — always excludes node_modules.
 * Results are deduplicated via Set (handles overlapping patterns).
 */
export function getTestFilesFromPatterns(dir, patterns, config) {
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

/** Returns true if any file with the given extension exists under dir (ignoring vendor dirs). */
function hasFileWithExt(dir, ext, config) {
  let found = false;
  const walk = (d) => {
    if (found) return;
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      if (found) return;
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const full = join(d, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (stat.isFile() && extname(full) === ext) {
          const rel = relative(dir, full);
          if (!config || !shouldIgnore(rel, config)) found = true;
        }
      } catch { /* skip */ }
    }
  };
  walk(dir);
  return found;
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
