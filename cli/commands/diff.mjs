/**
 * Diff Command — Show differences between canonical docs and implementation
 * Compares what's documented vs what's actually in the code.
 */

import { access, readFile, readdir } from 'node:fs/promises';
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

export async function runDiff(projectDir, config, flags) {
  console.log(`${c.bold}🔍 DocGuard Diff — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  // Run all diffs in parallel
  const results = await Promise.all([
    diffRoutes(projectDir, config),
    diffEntities(projectDir, config),
    diffEnvVars(projectDir, config),
    diffTechStack(projectDir, config),
    diffTests(projectDir, config),
  ]);

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

async function diffRoutes(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  try {
    await access(archPath);
  } catch {
    return null;
  }

  const content = await readFile(archPath, 'utf-8');

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
  const tasks = routeDirs.map(async (rd) => {
    const routeDir = resolve(dir, rd);
    try {
      await access(routeDir);
    } catch {
      return;
    }

    const files = await getFilesRecursive(routeDir);
    for (const f of files) {
      const rel = f.replace(dir + '/', '');
      codeRoutes.add(rel);
    }
  });

  await Promise.all(tasks);

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

async function diffEntities(dir) {
  const dataModelPath = resolve(dir, 'docs-canonical/DATA-MODEL.md');
  try {
    await access(dataModelPath);
  } catch {
    return null;
  }

  const content = await readFile(dataModelPath, 'utf-8');

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

  const headerRegex = /^### (\S+)/gm;
  let match;
  while ((match = headerRegex.exec(content)) !== null) {
    const name = match[1].replace(/[`*]/g, '');
    // Skip template placeholders (<!-- ... -->) and noise words
    if (name.startsWith('<!--') || name.length <= 2 || HEADER_NOISE.has(name) || HEADER_NOISE.has(name.toLowerCase())) {
      continue;
    }
    // Skip hyphenated words (e.g., 'Trade-offs', 'Set-up') — these are section titles, not entities
    if (name.includes('-')) continue;
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
    // Common doc section words (not entity names)
    'trade', 'offs', 'tradeoffs', 'setup', 'overview', 'summary',
    'details', 'configuration', 'reference', 'pattern', 'patterns',
    'strategy', 'approach', 'impact', 'benefit', 'risk', 'concern',
    'action', 'result', 'outcome', 'inverted', 'composite', 'secondary',
  ]);
  while ((match = tableRegex.exec(content)) !== null) {
    const name = match[1];
    // Skip short names (<=3 chars) and noise words
    if (name.length > 3 && !TABLE_NOISE.has(name.toLowerCase())) {
      docEntities.add(name.toLowerCase());
    }
  }

  // Find model/entity files in code
  const codeEntities = new Set();
  const modelDirs = ['src/models', 'models', 'src/entities', 'entities', 'src/schema', 'schema', 'prisma'];
  const tasks = modelDirs.map(async (md) => {
    const modelDir = resolve(dir, md);
    try {
      await access(modelDir);
    } catch {
      return;
    }

    const files = await getFilesRecursive(modelDir);
    for (const f of files) {
      const name = basename(f, extname(f)).toLowerCase();
      if (name !== 'index') {
        codeEntities.add(name);
      }
    }
  });

  await Promise.all(tasks);

  return {
    title: 'Data Entities',
    icon: '🗃️',
    onlyInDocs: [...docEntities].filter(d => ![...codeEntities].some(ce => ce.includes(d) || d.includes(ce))),
    onlyInCode: [...codeEntities].filter(ce => ![...docEntities].some(d => d.includes(ce) || ce.includes(d))),
    matched: [...codeEntities].filter(ce => [...docEntities].some(d => d.includes(ce) || ce.includes(d))),
  };
}

async function diffEnvVars(dir) {
  const envDocPath = resolve(dir, 'docs-canonical/ENVIRONMENT.md');
  try {
    await access(envDocPath);
  } catch {
    return null;
  }

  const content = await readFile(envDocPath, 'utf-8');

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
  try {
    const envContent = await readFile(envExamplePath, 'utf-8');
    const envRegex = /^([A-Z][A-Z0-9_]+)\s*=/gm;
    while ((match = envRegex.exec(envContent)) !== null) {
      codeVars.add(match[1]);
    }
  } catch { /* skip if .env.example doesn't exist */ }

  if (docVars.size === 0 && codeVars.size === 0) return null;

  return {
    title: 'Environment Variables',
    icon: '🔧',
    onlyInDocs: [...docVars].filter(v => !codeVars.has(v)),
    onlyInCode: [...codeVars].filter(v => !docVars.has(v)),
    matched: [...docVars].filter(v => codeVars.has(v)),
  };
}

async function diffTechStack(dir) {
  const archPath = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  const pkgPath = resolve(dir, 'package.json');
  try {
    await Promise.all([access(archPath), access(pkgPath)]);
  } catch {
    return null;
  }

  const [archContent, pkgContent] = await Promise.all([
    readFile(archPath, 'utf-8'),
    readFile(pkgPath, 'utf-8'),
  ]);
  const pkg = JSON.parse(pkgContent);

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

async function diffTests(dir) {
  const testSpecPath = resolve(dir, 'docs-canonical/TEST-SPEC.md');
  try {
    await access(testSpecPath);
  } catch {
    return null;
  }

  const content = await readFile(testSpecPath, 'utf-8');

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
  const tasks = testDirs.map(async (td) => {
    const testDir = resolve(dir, td);
    try {
      await access(testDir);
    } catch {
      return;
    }

    const files = await getFilesRecursive(testDir);
    for (const f of files) {
      const rel = f.replace(dir + '/', '');
      codeTests.add(rel);
    }
  });

  await Promise.all(tasks);

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

async function getFilesRecursive(dir) {
  const results = [];
  try {
    await access(dir);
  } catch {
    return results;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const tasks = entries.map(async (entry) => {
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) return;
    const fullPath = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const nestedFiles = await getFilesRecursive(fullPath);
        results.push(...nestedFiles);
      } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    } catch { /* skip */ }
  });

  await Promise.all(tasks);
  return results;
}
