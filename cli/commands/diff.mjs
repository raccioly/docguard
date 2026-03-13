/**
 * Diff Command — Show differences between canonical docs and implementation
 * Compares what's documented vs what's actually in the code.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { c } from '../shared.mjs';

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
  console.log(`${c.bold}🔍 DocGuard Diff — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const results = [];

  // 1. Routes documented vs routes in code
  results.push(diffRoutes(projectDir, config));

  // 2. Entities documented vs models in code
  results.push(diffEntities(projectDir, config));

  // 3. Env vars documented vs .env.example
  results.push(diffEnvVars(projectDir, config));

  // 4. Tech stack documented vs package.json
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

function diffRoutes(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return null;

  const content = readFileSync(archPath, 'utf-8');

  // Extract route-like patterns from ARCHITECTURE.md
  const docRoutes = new Set();
  const routeRegex = /(?:\/api\/\S+|(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S+))/gi;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const route = match[1] || match[0];
    // Skip markdown table syntax and non-route content
    if (route.startsWith('|') || route.startsWith('(') || route.length < 3) continue;
    docRoutes.add(route);
  }

  // Also check for paths in tables
  const pathRegex = /`(\/api\/[^`]+)`/g;
  while ((match = pathRegex.exec(content)) !== null) {
    docRoutes.add(match[1]);
  }

  // Find route files in code
  const codeRoutes = new Set();
  const routeDirs = ['src/routes', 'src/app/api', 'routes', 'api'];
  for (const rd of routeDirs) {
    const routeDir = resolve(dir, rd);
    if (!existsSync(routeDir)) continue;

    const files = getFilesRecursive(routeDir);
    for (const f of files) {
      const rel = f.replace(dir + '/', '');
      codeRoutes.add(rel);
    }
  }

  return {
    title: 'API Routes',
    icon: '🛣️',
    onlyInDocs: [...docRoutes].filter(r => ![...codeRoutes].some(cr => cr.includes(r.replace(/\//g, '/')))),
    onlyInCode: [...codeRoutes].filter(cr => {
      const name = basename(cr, extname(cr));
      return ![...docRoutes].some(dr => dr.includes(name));
    }),
    matched: [...codeRoutes].filter(cr => {
      const name = basename(cr, extname(cr));
      return [...docRoutes].some(dr => dr.includes(name));
    }),
  };
}

function diffEntities(dir) {
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
    'Migration', 'Strategy',
  ]);

  const headerRegex = /^### (\S+)/gm;
  let match;
  while ((match = headerRegex.exec(content)) !== null) {
    const name = match[1].replace(/[`*]/g, '');
    // Skip template placeholders (<!-- ... -->) and noise words
    if (name.startsWith('<!--') || name.length <= 1 || HEADER_NOISE.has(name) || HEADER_NOISE.has(name.toLowerCase())) {
      continue;
    }
    docEntities.add(name.toLowerCase());
  }

  // Also check tables for entity references
  const tableRegex = /\|\s*(?:`)?(\w+)(?:`)?\s*\|/g;
  // Filter out common table headers, template placeholders, and markdown noise
  const TABLE_NOISE = new Set([
    'entity', 'field', 'type', 'from', 'to', 'table', 'index', 'storage',
    'required', 'default', 'constraints', 'description', 'name', 'value',
    'status', 'version', 'category', 'technology', 'license', 'purpose',
    'cascade', 'relationship', 'notes', 'date', 'author', 'changes',
    'metadata', 'tbd', 'fields', 'todo', 'example', 'primary', 'key',
    'none', 'see', 'detected', 'yes', 'no', 'all', 'the', 'for', 'not',
    'add', 'database', 'orm', 'source', 'unit', 'test', 'integration',
    'metric', 'target', 'current', 'journey', 'file', 'score', 'weight',
    'weighted', 'method', 'provider', 'token', 'expiry', 'role',
    'permissions', 'secret', 'rotation', 'access', 'variable', 'tool',
    'command', 'run', 'component', 'responsibility', 'location', 'tests',
    // Data types — common in table schemas, not entity names
    'string', 'boolean', 'number', 'integer', 'float', 'double', 'decimal',
    'array', 'object', 'null', 'undefined', 'enum', 'varchar', 'text',
    'timestamp', 'uuid', 'bigint', 'serial', 'json', 'jsonb', 'blob',
    'char', 'date', 'time', 'datetime', 'binary', 'bit', 'money',
    // Common table headers and template words
    'true', 'false', 'header', 'checks', 'project', 'count', 'grade',
    'breakdown', 'issuecount', 'autofixable', 'projectname', 'projecttype',
  ]);
  while ((match = tableRegex.exec(content)) !== null) {
    const name = match[1];
    if (name.length > 2 && !TABLE_NOISE.has(name.toLowerCase())) {
      docEntities.add(name.toLowerCase());
    }
  }

  // Find model/entity files in code
  const codeEntities = new Set();
  const modelDirs = ['src/models', 'models', 'src/entities', 'entities', 'src/schema', 'schema', 'prisma'];
  for (const md of modelDirs) {
    const modelDir = resolve(dir, md);
    if (!existsSync(modelDir)) continue;

    const files = getFilesRecursive(modelDir);
    for (const f of files) {
      const name = basename(f, extname(f)).toLowerCase();
      if (name !== 'index') {
        codeEntities.add(name);
      }
    }
  }

  return {
    title: 'Data Entities',
    icon: '🗃️',
    onlyInDocs: [...docEntities].filter(d => ![...codeEntities].some(ce => ce.includes(d) || d.includes(ce))),
    onlyInCode: [...codeEntities].filter(ce => ![...docEntities].some(d => d.includes(ce) || ce.includes(d))),
    matched: [...codeEntities].filter(ce => [...docEntities].some(d => d.includes(ce) || ce.includes(d))),
  };
}

function diffEnvVars(dir) {
  const envDocPath = resolve(dir, 'docs-canonical/ENVIRONMENT.md');
  if (!existsSync(envDocPath)) return null;

  const content = readFileSync(envDocPath, 'utf-8');

  // Extract env var names from ENVIRONMENT.md
  const docVars = new Set();
  const varRegex = /`([A-Z][A-Z0-9_]{2,})`/g;
  let match;
  while ((match = varRegex.exec(content)) !== null) {
    docVars.add(match[1]);
  }

  // Read .env.example
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
    icon: '🔧',
    onlyInDocs: [...docVars].filter(v => !codeVars.has(v)),
    onlyInCode: [...codeVars].filter(v => !docVars.has(v)),
    matched: [...docVars].filter(v => codeVars.has(v)),
  };
}

function diffTechStack(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(archPath) || !existsSync(pkgPath)) return null;

  const archContent = readFileSync(archPath, 'utf-8');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  // Extract tech from ARCHITECTURE.md
  const docTech = new Set();
  const techPatterns = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Express', 'Fastify', 'Hono',
    'PostgreSQL', 'MySQL', 'MongoDB', 'DynamoDB', 'Redis', 'Prisma', 'Drizzle',
    'TypeScript', 'Tailwind', 'Docker', 'Terraform'];

  for (const tech of techPatterns) {
    if (archContent.toLowerCase().includes(tech.toLowerCase())) {
      docTech.add(tech);
    }
  }

  // Extract from package.json
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
    icon: '⚙️',
    onlyInDocs: [...docTech].filter(t => !codeTech.has(t)),
    onlyInCode: [...codeTech].filter(t => !docTech.has(t)),
    matched: [...docTech].filter(t => codeTech.has(t)),
  };
}

function diffTests(dir) {
  const testSpecPath = resolve(dir, 'docs-canonical/TEST-SPEC.md');
  if (!existsSync(testSpecPath)) return null;

  const content = readFileSync(testSpecPath, 'utf-8');

  // Extract test file references from TEST-SPEC.md
  const docTests = new Set();
  const testFileRegex = /`([^`]*\.(?:test|spec)\.[^`]+)`/g;
  let match;
  while ((match = testFileRegex.exec(content)) !== null) {
    docTests.add(match[1]);
  }

  // Find actual test files
  const codeTests = new Set();
  const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e'];
  for (const td of testDirs) {
    const testDir = resolve(dir, td);
    if (!existsSync(testDir)) continue;

    const files = getFilesRecursive(testDir);
    for (const f of files) {
      const rel = f.replace(dir + '/', '');
      codeTests.add(rel);
    }
  }

  if (docTests.size === 0 && codeTests.size === 0) return null;

  return {
    title: 'Test Files',
    icon: '🧪',
    onlyInDocs: [...docTests].filter(t => !codeTests.has(t)),
    onlyInCode: [...codeTests].filter(t => !docTests.has(t)),
    matched: [...docTests].filter(t => codeTests.has(t)),
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
