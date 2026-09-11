/**
 * Docs-Diff Validator — Checks alignment between canonical docs and code.
 *
 * Runs as part of `docguard guard` on every invocation.
 * Detects undocumented code artifacts and documented items not found in code.
 * Returns warnings (not errors) since drift is a soft signal.
 *
 * Respects config.ignore and config.testPatterns for test file discovery.
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 *
 * v0.29: migrated to structured findings (DDF001–DDF002). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';
import { shouldIgnore, globMatch, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { collectPackageJsons, detectDocker, resolveSourceRoots } from '../shared-source.mjs';
import { docRolePath, resolveDocRole } from '../shared-doc-roles.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'docs-canonical', 'docs-implementation', 'templates',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
]);

// v0.29: one stable finding code per drift domain (not per occurrence).
// Location = the canonical doc that owns the domain, so an agent knows which
// file to reconcile. Drift is two-sided (doc stale OR code changed), hence
// suggestion kind 'review' — a human decides which side is wrong.
const DRIFT_FINDINGS = {
  'Tech Stack': {
    code: 'DDF001',
    role: 'architecture',
    suggestion: {
      kind: 'review',
      text: 'Reconcile the Tech Stack in ARCHITECTURE.md with the actual dependencies — document the new tech or remove stale entries',
    },
  },
  'Test Files': {
    code: 'DDF002',
    role: 'testSpec',
    suggestion: {
      kind: 'review',
      text: 'Reconcile TEST-SPEC.md with the test files on disk — document new tests or remove stale entries',
    },
  },
};

/**
 * Validate doc-code alignment — compares canonical docs vs source code.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateDocsDiff(projectDir, config = {}) {
  const findings = [];
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
      const meta = DRIFT_FINDINGS[result.title] || {};
      findings.push(mkFinding({
        code: meta.code,
        validator: 'docsDiff',
        severity: 'warn',
        message: `${result.title} drift: ${parts.join('; ')}`,
        location: docRolePath(config, meta.role),
        suggestion: meta.suggestion,
      }));
    }
  }

  return resultFromFindings(findings, { passed, total });
}

// ── Diff Functions (lightweight versions for validator) ──────────────────

/** Evaluate mentions locally; optionality is not evidence of absence or use. */
function mentionsCurrentTechnology(content, tech, technologies) {
  const escape = value => value.replace(/[.*+?^\x24{}()|[\]\\]/g, character => '\\' + character);
  const names = new RegExp('\\b(?:' + technologies.map(escape).join('|') + ')\\b', 'gi');
  const sentences = content.replace(/<!--[^]*?-->/g, '').replace(/[\x60*]/g, '')
    .split(/\n|[;!?]|\.(?=\s|$)/);
  for (const sentence of sentences) {
    let subject = null;
    for (let clause of sentence.split(/\b(?:but|whereas|while|however)\b/i)) {
      let mentions = [...clause.matchAll(names)];
      // Carry an omitted subject only within the same sentence, and only for
      // an explicit continuation predicate ("but [it] is used ...").
      if (!mentions.length && subject && /^\s*,?\s*(?:it\s+)?(?:is|was|remains)\s+/i.test(clause)) {
        clause = subject + ' ' + clause.trim().replace(/^,\s*/, '').replace(/^it\s+/i, '');
        mentions = [...clause.matchAll(names)];
      }
      if (mentions.length) subject = mentions.at(-1)[0];
      // A leading "No" governs every item in a subject list, including tools
      // outside our vocabulary. Stop at the predicate; later claims stay live.
      const negativeList = /^\s*No\s+(.+?)\s+(?:is|are|was|were)\s+used\b/i.exec(clause);
      const negativeListEnd = negativeList &&
        !/\b(?:is|are|was|were|uses?|used|requires?|required)\b/i.test(negativeList[1])
        ? clause.indexOf(negativeList[1]) + negativeList[1].length : -1;
      for (let i = 0; i < mentions.length; i++) {
        const mention = mentions[i];
        if (mention[0].toLowerCase() !== tech.toLowerCase()) continue;
        if (mention.index < negativeListEnd) continue;
        const before = clause.slice(i ? mentions[i - 1].index + mentions[i - 1][0].length : 0, mention.index);
        const after = clause.slice(mention.index + mention[0].length, mentions[i + 1]?.index ?? clause.length)
          .replace(/^\s*[|:(—-]\s*/, ' ').trim();
        const negativeBefore = /\b(?:no|without|neither|nor|not(?:\s+using|\s+used)?|(?:do|does|did)\s+not\s+use|never\s+used?|no\s+longer\s+(?:use|using)|(?:migrated|moved)\s+(?:away\s+)?from)\s*$/i;
        const historicalBefore = /\b(?:previously|formerly|historically|once)\s+(?:(?:we\s+)?(?:used?|using)\s+)?$|\bused\s+to\s+use\s*$/i;
        const negativeAfter = /^(?:(?:is|was|are|were)\s+)?(?:not\s+(?:used|using|supported|adopted)|no\s+longer\s+(?:used|supported)|unused|removed|retired)\b/i;
        const optionalAfter = /^(?:(?:is|was|are|were)\s+)?(?:not\s+(?:needed|required)|optional)\b/i;
        const historicalAfter = /^(?:(?:is|was|were)\s+)?(?:previously|formerly|historically|once)\b|^(?:was|were)\s+used\b/i;
        if (!negativeBefore.test(before) && !historicalBefore.test(before) &&
            !negativeAfter.test(after) && !optionalAfter.test(after) && !historicalAfter.test(after)) return true;
      }
    }
  }
  return false;
}

export function diffTechStack(dir, config = {}) {
  const archPath = resolveDocRole(dir, config, 'architecture');
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

  for (const tech of techPatterns) {
    if (mentionsCurrentTechnology(archContent, tech, techPatterns)) {
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
  const testSpecPath = resolveDocRole(dir, config, 'testSpec');
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
      if (isTest(f)) {
        const rel = relative(dir, f);
        if (!shouldIgnore(rel, config)) codeTests.add(rel);
      }
    }
  }

  // 3. root-level conventional test dirs (e2e lives outside any source root)
  for (const td of ['tests', 'test', '__tests__', 'spec', 'e2e', 'cypress']) {
    const testDir = join(resolve(dir), td);
    if (!existsSync(testDir)) continue;
    for (const f of getFilesRecursive(testDir, config)) {
      if (isTest(f)) {
        const rel = relative(dir, f);
        if (!shouldIgnore(rel, config)) codeTests.add(rel);
      }
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

  // v0.29 consolidation: traversal delegates to the shared canonical walker;
  // per-file filtering (config ignore + positive globMatch) stays here.
  sharedWalkFiles(dir, (fullPath) => {
    const relPath = relative(dir, fullPath);
    // Skip files in globally ignored paths
    if (config && shouldIgnore(relPath, config)) return;
    // Use globMatch for positive pattern matching (rejects node_modules internally)
    if (globMatch(relPath, patterns)) {
      results.add(relPath);
    }
  }, { ignoreDirs: IGNORE_DIRS });
  return [...results];
}

/** Returns true if any file with the given extension exists under dir (ignoring vendor dirs). */
function hasFileWithExt(dir, ext, config) {
  // v0.29 consolidation: shared walker. The old hand-rolled version early-exited
  // on first match; the shared walker completes the traversal — acceptable here
  // (one-shot existence probe on source trees already pruned by IGNORE_DIRS).
  let found = false;
  sharedWalkFiles(dir, (full) => {
    if (found || extname(full) !== ext) return;
    const rel = relative(dir, full);
    if (!config || !shouldIgnore(rel, config)) found = true;
  }, { ignoreDirs: IGNORE_DIRS });
  return found;
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function getFilesRecursive(dir, config) {
  const results = [];
  sharedWalkFiles(dir, (fullPath) => {
    if (CODE_EXTENSIONS.has(extname(fullPath))) results.push(fullPath);
  }, { ignoreDirs: IGNORE_DIRS });
  return results;
}
