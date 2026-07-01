/**
 * Diff Command — Show differences between canonical docs and implementation
 * Compares what's documented vs what's actually in the code.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { c } from '../shared.mjs';
import { collectPackageJsons, detectDocker, grepEnvUsage, resolveSourceRoots } from '../shared-source.mjs';
import { parseApiReferenceDoc, compareEndpoints } from '../scanners/api-doc.mjs';
import { resolveApiSurface } from '../validators/api-surface.mjs';
import { collectCodeTests } from '../validators/docs-diff.mjs';
import { scanSchemasDeep } from '../scanners/schemas.mjs';
import { detectDocTools } from '../scanners/doc-tools.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'docs-canonical', 'docs-implementation', 'templates',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
]);

export function runDiff(projectDir, config, flags) {
  // v0.16-P1: headless mode for JSON output (matches guard/score/trace fix).
  const isJson = flags.format === 'json';
  if (!isJson) {
    console.log(`${c.bold}🔍 DocGuard Diff — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);
  }

  const results = [];

  // 1. Routes documented vs routes in code
  results.push(diffRoutes(projectDir, config));

  // 2. Entities documented vs models in code
  results.push(diffEntities(projectDir, config));

  // 3. Env vars documented vs .env.example + source usage
  results.push(diffEnvVars(projectDir, config));

  // 4. Tech stack documented vs package.json(s)
  results.push(diffTechStack(projectDir, config));

  // 5. Tests documented vs tests that exist
  results.push(diffTests(projectDir, config));

  if (flags.format === 'json') {
    console.log(JSON.stringify(results.filter(r => r), null, 2));
    return;
  }

  // Display results
  let hasAnyDiff = false;

  for (const result of results) {
    if (!result) continue;

    console.log(`  ${c.bold}${result.icon} ${result.title}${c.reset}`);

    if (result.onlyInDocs.length > 0) {
      hasAnyDiff = true;
      console.log(`    ${c.yellow}Documented but not found in code:${c.reset}`);
      for (const item of result.onlyInDocs) {
        console.log(`      ${c.yellow}− ${item}${c.reset}`);
      }
    }

    if (result.onlyInCode.length > 0) {
      hasAnyDiff = true;
      console.log(`    ${c.red}In code but not documented:${c.reset}`);
      for (const item of result.onlyInCode) {
        console.log(`      ${c.red}+ ${item}${c.reset}`);
      }
    }

    if (result.matched.length > 0 && flags.verbose) {
      console.log(`    ${c.green}Matched (${result.matched.length}):${c.reset}`);
      for (const item of result.matched) {
        console.log(`      ${c.green}✓ ${item}${c.reset}`);
      }
    }

    if (result.onlyInDocs.length === 0 && result.onlyInCode.length === 0) {
      console.log(`    ${c.green}✓ In sync${c.reset}`);
    }

    console.log('');
  }

  if (!hasAnyDiff) {
    console.log(`  ${c.green}${c.bold}✅ No drift detected — canonical docs match implementation!${c.reset}\n`);
  } else {
    console.log(`  ${c.yellow}${c.bold}⚠️  Drift detected — update canonical docs or code to match.${c.reset}\n`);
  }
}

// ── Diff Functions ─────────────────────────────────────────────────────────

export function diffRoutes(dir, config = {}) {
  // Documented surface: prefer the dedicated API reference, fall back to ARCHITECTURE.md.
  const apiRefPath = resolve(dir, 'docs-canonical/API-REFERENCE.md');
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  const docPath = existsSync(apiRefPath) ? apiRefPath : (existsSync(archPath) ? archPath : null);
  if (!docPath) return null;

  const documented = parseApiReferenceDoc(readFileSync(docPath, 'utf-8'));

  // Actual surface: OpenAPI spec (sourceRoot-aware) → monorepo code scan.
  const surface = resolveApiSurface(dir, config);
  if (surface.confidence === 'none' && documented.length === 0) return null;

  const { documentedButAbsent, presentButUndocumented, matched } =
    compareEndpoints(documented, surface.endpoints);

  const fmt = (e) => `${e.method} ${e.path}`;
  return {
    title: 'API Routes',
    icon: '🛣️',
    onlyInDocs: documentedButAbsent.map(fmt),
    onlyInCode: presentButUndocumented.map(fmt),
    matched: matched.map(fmt),
  };
}

// Non-entity filenames commonly found in model/schema dirs (infra, not entities).
const CODE_ENTITY_NOISE = new Set([
  'index', 'types', 'type', 'schema', 'schemas', 'registry', 'paths', 'openapi',
  'models', 'model', 'utils', 'helpers', 'constants', 'config', 'common', 'base',
]);

export function diffEntities(dir, config = {}) {
  const dataModelPath = resolve(dir, 'docs-canonical/DATA-MODEL.md');
  if (!existsSync(dataModelPath)) return null;

  const content = readFileSync(dataModelPath, 'utf-8');

  // Extract entity names from DATA-MODEL.md (look for ### headers or table rows)
  const docEntities = new Set();

  // Filter out template placeholders and common header noise
  const HEADER_NOISE = new Set([
    'EntityName', 'Entity', 'metadata', 'tbd', 'cascade', 'fields',
    'purpose', 'version', 'author', 'example', 'TODO', 'Overview',
    'Revision', 'History', 'Entities', 'Relationships', 'Indexes',
    'Migration', 'Strategy', 'Trade-offs', 'Tradeoffs', 'Notes',
    'Summary', 'Details', 'Configuration', 'Setup', 'Reference',
    'Appendix', 'Glossary', 'FAQ', 'Introduction', 'Background',
    'Prerequisites', 'Requirements', 'Assumptions', 'Constraints',
    'Dependencies', 'Architecture', 'Design', 'Implementation',
    'Testing', 'Deployment', 'Monitoring', 'Operations', 'Security',
  ]);

  // Extract entity names ONLY from "### EntityName" headings. The previous
  // table-cell extractor produced garbage tokens (table, index, foreign, string…);
  // headings are the only reliable entity source in a DATA-MODEL doc.
  const headerRegex = /^#{3,4}\s+(.+)$/gm;
  let match;
  while ((match = headerRegex.exec(content)) !== null) {
    const name = match[1].replace(/[`*]/g, '').trim();
    if (name.startsWith('<!--') || name.length <= 2) continue;
    if (HEADER_NOISE.has(name) || HEADER_NOISE.has(name.toLowerCase())) continue;
    // Entity headings are a single PascalCase/snake_case identifier — not a phrase.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
    docEntities.add(name.toLowerCase());
  }

  // Use the REAL exported entity names from scanSchemasDeep, not file basenames
  // (a file `dynamoModels.ts` exports `User`/`Order`/etc. — its basename is not
  // an entity). scanSchemasDeep covers JS ORMs, SQLAlchemy/Pydantic, Diesel,
  // Go structs, JPA, Rails, and OpenAPI schemas.
  const docTools = detectDocTools(dir);
  const schemas = scanSchemasDeep(dir, {}, docTools, config);
  const codeEntities = new Set();
  for (const e of (schemas.entities || [])) {
    const n = String(e.name || '').toLowerCase();
    if (!n || CODE_ENTITY_NOISE.has(n)) continue;
    codeEntities.add(n);
  }

  // No code-side entity source (e.g. DynamoDB single-table design with no model
  // files) → cannot reliably diff. Skip rather than flag every documented entity.
  if (codeEntities.size === 0) return null;

  // Exact (normalized) matching — no fuzzy bidirectional substring includes().
  const norm = (s) => s.replace(/[_-]/g, '').replace(/s$/, '');
  const codeNorm = new Set([...codeEntities].map(norm));
  const docNorm = new Map([...docEntities].map(d => [norm(d), d]));

  return {
    title: 'Data Entities',
    icon: '🗃️',
    onlyInDocs: [...docEntities].filter(d => !codeNorm.has(norm(d))),
    onlyInCode: [...codeEntities].filter(ce => !docNorm.has(norm(ce))),
    matched: [...codeEntities].filter(ce => docNorm.has(norm(ce))),
  };
}

// v0.16-P4 (revised in v0.17.1): conservative denylist of system env vars
// that appear in prose ("the venv `PATH`") but are never user-set app env
// vars. v0.17.1-B7: trimmed to TRULY-system-only after wu feedback —
// NODE_ENV / CI / GITHUB_* are legitimately app env vars when read via
// process.env. Including them caused diff to falsely flag `NODE_ENV` as
// "in code but not docs" even when ENVIRONMENT.md documented it.
//
// Rule of thumb for inclusion: would a sane Node/Python/Go app ever
// `process.env.X` this name and treat it as app config? If yes → NOT a
// system var. PATH/HOME/SHELL/TERM never satisfy that bar.
const SYSTEM_ENV_VARS = new Set([
  // POSIX shell / OS
  'PATH', 'HOME', 'USER', 'USERNAME', 'SHELL', 'PWD', 'OLDPWD',
  'TMPDIR', 'TEMP', 'TMP',
  // Locale
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TZ',
  // Terminal / interactive
  'EDITOR', 'VISUAL', 'PAGER', 'TERM', 'COLORTERM',
  // SSH / Display
  'DISPLAY', 'SSH_AUTH_SOCK', 'SSH_CONNECTION', 'SSH_TTY',
  // XDG base directory spec
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  // NOTE: NODE_ENV / CI / GITHUB_* used to be here. Removed in v0.17.1
  // because apps DO read them as app config (e.g. NODE_ENV=production
  // gates branching in nearly every Node.js app).
]);

export function diffEnvVars(dir, config = {}) {
  const envDocPath = resolve(dir, 'docs-canonical/ENVIRONMENT.md');
  if (!existsSync(envDocPath)) return null;

  const content = readFileSync(envDocPath, 'utf-8');

  // Extract env var names from ENVIRONMENT.md
  const docVars = new Set();
  // Reject names ending in `_` (e.g. the literal prefix `VITE_` in prose).
  const varRegex = /`([A-Z][A-Z0-9_]*[A-Z0-9])`/g;
  let match;
  while ((match = varRegex.exec(content)) !== null) {
    // v0.16-P4: skip backticked system vars that appear in prose. They're
    // never user-set application env vars; flagging them produces noise.
    if (SYSTEM_ENV_VARS.has(match[1])) continue;
    docVars.add(match[1]);
  }

  // Code-side truth = .env.example/.env.template entries UNION process.env /
  // import.meta.env usage across the (monorepo-aware) source roots.
  const codeVars = new Set();
  for (const envFile of ['.env.example', '.env.template']) {
    const envExamplePath = resolve(dir, envFile);
    if (existsSync(envExamplePath)) {
      const envContent = readFileSync(envExamplePath, 'utf-8');
      const envRegex = /^([A-Z][A-Z0-9_]*[A-Z0-9])\s*=/gm;
      while ((match = envRegex.exec(envContent)) !== null) {
        codeVars.add(match[1]);
      }
    }
  }
  for (const name of grepEnvUsage(dir, config)) codeVars.add(name);

  if (docVars.size === 0 && codeVars.size === 0) return null;

  return {
    title: 'Environment Variables',
    icon: '🔧',
    onlyInDocs: [...docVars].filter(v => !codeVars.has(v)),
    onlyInCode: [...codeVars].filter(v => !docVars.has(v)),
    matched: [...docVars].filter(v => codeVars.has(v)),
  };
}

export function diffTechStack(dir, config = {}) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return null;

  // Monorepo-aware: merge dependencies across root + source-root + workspace packages.
  const pkgs = collectPackageJsons(dir, config);
  if (pkgs.length === 0) return null;

  const archContent = readFileSync(archPath, 'utf-8');

  // Extract tech from ARCHITECTURE.md
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

  // Extract from merged package.json dependencies
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

  // Docker via Dockerfile/compose (not an npm dependency).
  if (detectDocker(dir, config)) codeTech.add('Docker');

  if (docTech.size === 0 && codeTech.size === 0) return null;

  return {
    title: 'Tech Stack',
    icon: '⚙️',
    onlyInDocs: [...docTech].filter(t => !codeTech.has(t)),
    onlyInCode: [...codeTech].filter(t => !docTech.has(t)),
    matched: [...docTech].filter(t => codeTech.has(t)),
  };
}

function diffTests(dir, config = {}) {
  const testSpecPath = resolve(dir, 'docs-canonical/TEST-SPEC.md');
  if (!existsSync(testSpecPath)) return null;

  // Strip fenced code blocks (shell commands inside ``` ``` were mis-parsed as
  // test files), then extract whitespace-free test tokens (literals or globs).
  const content = readFileSync(testSpecPath, 'utf-8').replace(/```[\s\S]*?```/g, '');
  const docTests = new Set();
  const testFileRegex = /`([^`\s]*\.(?:test|spec)\.[a-zA-Z0-9]+)`/g;
  let match;
  while ((match = testFileRegex.exec(content)) !== null) {
    docTests.add(match[1]);
  }

  // Find actual test files (monorepo-aware: configured patterns + recursive
  // co-located/nested scan under each source root + root-level test dirs).
  const codeTests = collectCodeTests(dir, config);

  if (docTests.size === 0 && codeTests.size === 0) return null;

  // Glob-aware matching (documented entries are often patterns or basenames).
  const codeArr = [...codeTests];

  // PERFORMANCE OPTIMIZATION: Pre-compile regular expressions to avoid O(N*M)
  // instantiation bottlenecks inside the nested .filter and .some loops below.
  const docMatchers = [...docTests].map(docEntry => {
    const entry = String(docEntry).trim();
    const hasSlash = entry.includes('/');
    const target = hasSlash ? entry : basename(entry);
    const rx = new RegExp('^' + target.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*') + '$');

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
    icon: '🧪',
    onlyInDocs: docMatchers.filter(m => !codeArr.some(c => matches(m, c))).map(m => m.original),
    onlyInCode: codeArr.filter(c => !docMatchers.some(m => matches(m, c))),
    matched: docMatchers.filter(m => codeArr.some(c => matches(m, c))).map(m => m.original),
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function getFilesRecursive(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...getFilesRecursive(fullPath));
      } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return results;
}
