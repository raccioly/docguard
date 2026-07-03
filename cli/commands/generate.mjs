/**
 * Generate Command — Reverse-engineer canonical docs from an existing codebase
 * Scans source code and creates documentation templates pre-filled with project data.
 * 
 * This is the "killer feature" — take any project and auto-generate CDD docs.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, basename, relative } from 'node:path';
import { c } from '../shared.mjs';
import { walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { detectDocTools } from '../scanners/doc-tools.mjs';
import { scanRoutesDeep } from '../scanners/routes.mjs';
import { scanSchemasDeep } from '../scanners/schemas.mjs';
import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { upsertSection } from '../writers/sections.mjs';
import { safeWrite, registerGeneratedCanonicalDocs, surfaceConfidence } from '../writers/generate-io.mjs';
import {
  generateArchitecture, generateApiReference, generateDataModel,
  generateEnvironment, generateTestSpec, generateSecurity, generateRootFiles,
} from '../writers/doc-generators.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs',
]);

/**
 * `docguard generate --plan` — AI-powered Generate.
 * Builds the code-truth skeleton (marked sections) and emits the agent task
 * manifest. `--format json` → machine manifest for an agent; text → summary.
 * `--write` → scaffold the skeleton docs (code sections filled; prose sections
 * inserted as agent-task placeholders), respecting human prose via markers.
 */
export function runGeneratePlan(projectDir, config, flags) {
  // `--profile <name>` previews a profile's doc set without needing `init` first.
  if (flags.profile) config = { ...config, profile: flags.profile };
  const plan = buildMemoryPlan(projectDir, config);

  if (flags.format === 'json') {
    console.log(JSON.stringify({
      project: config.projectName,
      profile: {
        languages: plan.profile.languages,
        frameworks: plan.profile.frameworks,
        polyglot: plan.profile.polyglot,
        kind: plan.profile.kind,
        ecosystems: plan.profile.ecosystems.map(e => ({ dir: e.dir, language: e.language, framework: e.framework, kind: e.kind })),
      },
      surface: {
        endpoints: plan.surface.endpoints.length,
        entities: plan.surface.entities.length,
        screens: plan.surface.screens.length,
        components: plan.surface.components.length,
        modules: plan.surface.modules.length,
        tests: { files: plan.surface.tests.totalFiles, cases: plan.surface.tests.totalCases },
        envVars: plan.surface.envVars.length,
        confidence: surfaceConfidence(plan.profile.kind),
      },
      docs: plan.docs.map(d => ({
        path: d.path,
        sections: d.sections.map(s => s.source === 'code'
          ? { id: s.id, source: 'code' }
          : { id: s.id, source: 'human', task: s.task, grounding: s.grounding }),
      })),
      agentTasks: plan.agentTasks,
      notes: plan.notes || [],
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // --write: scaffold the skeleton docs with code sections + agent-task placeholders.
  if (flags.write) {
    const docsDir = resolve(projectDir, 'docs-canonical');
    if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
    let wrote = 0;
    for (const doc of plan.docs) {
      const full = resolve(projectDir, doc.path);
      const title = basename(doc.path, '.md').replace(/-/g, ' ');
      let content = existsSync(full)
        ? readFileSync(full, 'utf-8')
        : `# ${title}\n\n<!-- docguard:generated true -->\n`;
      for (const sec of doc.sections) {
        const body = sec.source === 'code'
          ? sec.body
          : `> **AI task:** ${sec.task}\n<!-- docguard:pending agent writes this section -->`;
        content = upsertSection(content, sec.id, body, { source: sec.source }).content;
      }
      // Route through safeWrite: creates the parent dir (docs-implementation/ may
      // not exist yet — was an ENOENT crash) and snapshots a .bak before writing.
      safeWrite(full, content);
      wrote++;
    }
    // B7: register the scaffolded canonical docs so guard doesn't flag them.
    const registered = registerGeneratedCanonicalDocs(projectDir, plan.docs.map(d => d.path));
    console.log(`${c.bold}🔮 DocGuard Generate --plan --write — ${config.projectName}${c.reset}`);
    console.log(`  ${c.green}✅ Scaffolded ${wrote} doc(s)${c.reset} with code-truth sections + ${plan.agentTasks.length} agent task(s).`);
    if (registered > 0) {
      console.log(`  ${c.dim}Registered ${registered} canonical doc(s) in .docguard.json requiredFiles.${c.reset}`);
    }
    for (const note of plan.notes || []) {
      console.log(`  ${c.yellow}ℹ️  ${note}${c.reset}`);
    }
    console.log(`  ${c.dim}Now run your AI agent (/docguard.fix) to write the prose sections, then ${c.cyan}docguard guard${c.dim}.${c.reset}\n`);
    return;
  }

  // Text summary.
  console.log(`${c.bold}🔮 DocGuard Generate Plan — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   ${plan.profile.polyglot ? 'Polyglot' : 'Single-language'}: ${plan.profile.languages.join(', ')} | frameworks: ${plan.profile.frameworks.join(', ') || '—'} | kind: ${plan.profile.kind}${c.reset}\n`);
  console.log(`  ${c.bold}Code-truth surface:${c.reset} ${plan.surface.modules.length} modules · ${plan.surface.tests.totalFiles} test files (${plan.surface.tests.totalCases} cases) · ${plan.surface.endpoints.length} endpoints · ${plan.surface.entities.length} entities · ${plan.surface.screens.length} screens · ${plan.surface.envVars.length} env vars\n`);
  const webSurface = plan.surface.endpoints.length + plan.surface.entities.length + plan.surface.screens.length + plan.surface.components.length;
  if (surfaceConfidence(plan.profile.kind) === 'low' && webSurface > 0) {
    console.log(`  ${c.yellow}⚠️  Low-confidence surface:${c.reset} ${c.dim}this looks like a ${plan.profile.kind} (not a web app), so the HTTP/SDK/route surface above may be pattern-matches in your OWN source — not real usage. Verify before documenting; pin any corrected code section with ${c.cyan}pinned="reason"${c.dim}.${c.reset}\n`);
  }
  console.log(`  ${c.bold}Documents to build (${plan.docs.length}):${c.reset}`);
  for (const d of plan.docs) {
    const code = d.sections.filter(s => s.source === 'code').length;
    const prose = d.sections.filter(s => s.source === 'human').length;
    console.log(`    ${c.cyan}${d.path}${c.reset} ${c.dim}(${code} code section(s), ${prose} agent task(s))${c.reset}`);
  }
  for (const note of plan.notes || []) {
    console.log(`  ${c.yellow}ℹ️  ${note}${c.reset}`);
  }
  console.log(`\n  ${c.bold}🤖 Agent tasks (${plan.agentTasks.length}):${c.reset} ${c.dim}prose the AI must write, grounded in scanned facts.${c.reset}`);
  for (const t of plan.agentTasks) {
    console.log(`    ${c.dim}• [${t.doc} → ${t.sectionId}] ${t.instruction}${c.reset}`);
  }
  console.log(`\n  ${c.dim}Scaffold the skeleton: ${c.cyan}docguard generate --plan --write${c.dim} · Machine manifest: ${c.cyan}--plan --format json${c.reset}\n`);
}

export function runGenerate(projectDir, config, flags) {
  // --plan: emit the AI-powered "memory plan" — the agent task manifest. The CLI
  // builds the code-truth skeleton (marked sections) + tells the agent exactly
  // what prose to write per section. This is the language-aware Generate path.
  if (flags.plan) {
    return runGeneratePlan(projectDir, config, flags);
  }

  console.log(`${c.bold}🔮 DocGuard Generate — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  console.log(`${c.dim}   Scanning codebase to generate canonical documentation...${c.reset}\n`);

  // ── 1. Detect Framework/Stack ──
  const stack = detectStack(projectDir);
  console.log(`  ${c.bold}Detected Stack:${c.reset}`);
  for (const [category, tech] of Object.entries(stack)) {
    if (tech) console.log(`    ${c.cyan}${category}:${c.reset} ${tech}`);
  }
  console.log('');

  // ── 2. Detect Existing Doc Tools ──
  const docTools = detectDocTools(projectDir);
  if (docTools._detected.length > 0) {
    console.log(`  ${c.bold}Detected Documentation Tools:${c.reset}`);
    for (const tool of docTools._detected) {
      const info = docTools[tool];
      const details = info.config || info.path || info.middleware || '';
      let extra = '';
      if (tool === 'openapi' && info.endpoints) extra = ` — ${info.endpoints.length} endpoints, ${info.schemas?.length || 0} schemas`;
      if (tool === 'storybook' && info.storyCount) extra = ` — ${info.storyCount} stories`;
      console.log(`    ${c.cyan}${tool}:${c.reset} ${details}${extra}`);
    }
    console.log('');
  }

  // ── 3. Scan Project Structure ──
  const scan = scanProject(projectDir);

  // ── 4. Deep Scan Routes ──
  const deepRoutes = scanRoutesDeep(projectDir, stack, docTools, { config });
  if (deepRoutes.length > 0) {
    console.log(`  ${c.bold}Route Scanning:${c.reset} ${deepRoutes.length} endpoints found (source: ${deepRoutes[0]?.source || 'code'})`);
  }

  // ── 5. Deep Scan Schemas ──
  const deepSchemas = scanSchemasDeep(projectDir, stack, docTools, config);
  if (deepSchemas.entities.length > 0) {
    console.log(`  ${c.bold}Schema Scanning:${c.reset} ${deepSchemas.entities.length} entities, ${deepSchemas.relationships.length} relationships (source: ${deepSchemas.source})`);
  }
  console.log('');

  // ── 6. Generate Documents ──
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  // ── Safety: warn if --force will overwrite existing files ──
  if (flags.force) {
    const targetFiles = [
      'docs-canonical/ARCHITECTURE.md', 'docs-canonical/API-REFERENCE.md',
      'docs-canonical/DATA-MODEL.md', 'docs-canonical/ENVIRONMENT.md',
      'docs-canonical/TEST-SPEC.md', 'docs-canonical/SECURITY.md',
      'AGENTS.md', 'CHANGELOG.md', 'DRIFT-LOG.md',
    ];
    const existing = targetFiles.filter(f => existsSync(resolve(projectDir, f)));
    if (existing.length > 0) {
      console.log(`  ${c.yellow}⚠️  --force: ${existing.length} existing file(s) will be overwritten.${c.reset}`);
      console.log(`  ${c.dim}   Backups saved as .bak files.${c.reset}\n`);
    }
  }

  let created = 0;
  let skipped = 0;

  // Generate ARCHITECTURE.md (arc42-aligned)
  const archResult = generateArchitecture(projectDir, config, stack, scan, flags, docTools);
  if (archResult) { created++; } else { skipped++; }

  // Generate API-REFERENCE.md (NEW — from deep route scanning)
  if (deepRoutes.length > 0) {
    const apiResult = generateApiReference(projectDir, config, stack, deepRoutes, flags);
    if (apiResult) { created++; } else { skipped++; }
  }

  // Generate DATA-MODEL.md (enhanced with deep schema scanning)
  const dataResult = generateDataModel(projectDir, config, stack, scan, flags, deepSchemas);
  if (dataResult) { created++; } else { skipped++; }

  // Generate ENVIRONMENT.md
  const envResult = generateEnvironment(projectDir, config, stack, scan, flags);
  if (envResult) { created++; } else { skipped++; }

  // Generate TEST-SPEC.md
  const testResult = generateTestSpec(projectDir, config, stack, scan, flags);
  if (testResult) { created++; } else { skipped++; }

  // Generate SECURITY.md
  const secResult = generateSecurity(projectDir, config, stack, scan, flags);
  if (secResult) { created++; } else { skipped++; }

  // Generate root files (AGENTS.md, CHANGELOG, DRIFT-LOG)
  const rootResults = generateRootFiles(projectDir, config, stack, scan, flags, docTools);
  created += rootResults.created;
  skipped += rootResults.skipped;

  // B7: keep guard coherent — register the canonical docs we emitted so the
  // traceability validator doesn't flag the generator's own output.
  const registered = registerGeneratedCanonicalDocs(projectDir, [
    'docs-canonical/ARCHITECTURE.md', 'docs-canonical/API-REFERENCE.md',
    'docs-canonical/DATA-MODEL.md', 'docs-canonical/ENVIRONMENT.md',
    'docs-canonical/TEST-SPEC.md', 'docs-canonical/SECURITY.md',
  ]);

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Generated: ${created}${c.reset}  Skipped: ${skipped} (already exist)`);
  if (registered > 0) {
    console.log(`  ${c.dim}Registered ${registered} canonical doc(s) in .docguard.json requiredFiles.${c.reset}`);
  }
  if (docTools._detected.length > 0) {
    console.log(`  ${c.dim}Leveraged: ${docTools._detected.join(', ')} (existing tools detected)${c.reset}`);
  }
  console.log(`\n  ${c.yellow}${c.bold}⚠️  Review all generated docs!${c.reset}`);
  console.log(`  ${c.dim}Generated docs are a starting point — review and refine them.${c.reset}`);
  console.log(`  ${c.dim}Run ${c.cyan}docguard score${c.dim} to check your CDD maturity.${c.reset}\n`);
}

// ── Stack Detection ────────────────────────────────────────────────────────

function detectStack(dir) {
  const stack = {
    language: null,
    framework: null,
    database: null,
    orm: null,
    testing: null,
    hosting: null,
    css: null,
    auth: null,
  };

  // Check package.json
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // Language
    if (allDeps.typescript) stack.language = `TypeScript ${allDeps.typescript}`;
    else stack.language = 'JavaScript';

    // Framework
    if (allDeps.next) stack.framework = `Next.js ${allDeps.next}`;
    else if (allDeps.fastify) stack.framework = `Fastify ${allDeps.fastify}`;
    else if (allDeps.express) stack.framework = `Express ${allDeps.express}`;
    else if (allDeps.hono) stack.framework = `Hono ${allDeps.hono}`;
    else if (allDeps.nuxt) stack.framework = `Nuxt ${allDeps.nuxt}`;
    else if (allDeps.svelte || allDeps['@sveltejs/kit']) stack.framework = 'SvelteKit';
    else if (allDeps.react) stack.framework = `React ${allDeps.react}`;
    else if (allDeps.vue) stack.framework = `Vue ${allDeps.vue}`;
    else if (allDeps.angular || allDeps['@angular/core']) stack.framework = 'Angular';

    // Database
    if (allDeps['@aws-sdk/client-dynamodb'] || allDeps['aws-sdk']) stack.database = 'DynamoDB';
    else if (allDeps.pg || allDeps['@neondatabase/serverless']) stack.database = 'PostgreSQL';
    else if (allDeps.mysql2) stack.database = 'MySQL';
    else if (allDeps.mongoose || allDeps.mongodb) stack.database = 'MongoDB';
    else if (allDeps['better-sqlite3']) stack.database = 'SQLite';

    // ORM
    if (allDeps['drizzle-orm']) stack.orm = `Drizzle ${allDeps['drizzle-orm']}`;
    else if (allDeps['@prisma/client'] || allDeps.prisma) stack.orm = 'Prisma';
    else if (allDeps.typeorm) stack.orm = 'TypeORM';
    else if (allDeps.sequelize) stack.orm = 'Sequelize';
    else if (allDeps.knex) stack.orm = 'Knex.js';

    // Testing
    if (allDeps.vitest) stack.testing = 'Vitest';
    else if (allDeps.jest) stack.testing = 'Jest';
    else if (allDeps.mocha) stack.testing = 'Mocha';
    else if (allDeps.playwright || allDeps['@playwright/test']) stack.testing = 'Playwright';

    // CSS
    if (allDeps.tailwindcss) stack.css = `Tailwind ${allDeps.tailwindcss}`;
    else if (allDeps['styled-components']) stack.css = 'Styled Components';

    // Auth
    if (allDeps['next-auth']) stack.auth = 'NextAuth.js';
    else if (allDeps.passport) stack.auth = 'Passport.js';
    else if (allDeps['@auth0/auth0-react']) stack.auth = 'Auth0';
    else if (allDeps.bcryptjs || allDeps.bcrypt) stack.auth = 'Custom (bcrypt)';
  }

  // Check for Python
  if (existsSync(resolve(dir, 'requirements.txt')) || existsSync(resolve(dir, 'pyproject.toml'))) {
    stack.language = 'Python';
    if (existsSync(resolve(dir, 'manage.py'))) stack.framework = 'Django';
    else if (existsSync(resolve(dir, 'app.py')) || existsSync(resolve(dir, 'main.py'))) stack.framework = 'FastAPI/Flask';
  }

  // Check for Go
  if (existsSync(resolve(dir, 'go.mod'))) {
    stack.language = 'Go';
  }

  // Hosting detection
  if (existsSync(resolve(dir, 'amplify.yml'))) stack.hosting = 'AWS Amplify';
  else if (existsSync(resolve(dir, 'vercel.json'))) stack.hosting = 'Vercel';
  else if (existsSync(resolve(dir, 'Dockerfile'))) stack.hosting = 'Docker';
  else if (existsSync(resolve(dir, 'fly.toml'))) stack.hosting = 'Fly.io';
  else if (existsSync(resolve(dir, 'railway.json'))) stack.hosting = 'Railway';
  else if (existsSync(resolve(dir, 'render.yaml'))) stack.hosting = 'Render';

  return stack;
}

// ── Project Scanner ────────────────────────────────────────────────────────



function scanProject(dir) {
  const scan = {
    routes: [],
    models: [],
    services: [],
    tests: [],
    envVars: [],
    components: [],
    middlewares: [],
    totalFiles: 0,
    totalLines: 0,
  };

  scanRoutes(dir, scan);
  scanModels(dir, scan);
  scanServices(dir, scan);
  scanTests(dir, scan);
  scanComponents(dir, scan);
  scanMiddlewares(dir, scan);
  scanEnvVars(dir, scan);

  // Count files and lines
  countFilesAndLines(dir, scan);

  // ── Filter test files out of source lists ──
  // Test files (*.test.*, *.spec.*, __tests__/) should NOT appear as source files
  const isTestFile = (f) => f.includes('__tests__') || f.includes('__test__') || /\.(test|spec)\.[^.]+$/.test(f);
  scan.routes = scan.routes.filter(f => !isTestFile(f));
  scan.models = scan.models.filter(f => !isTestFile(f));
  scan.services = scan.services.filter(f => !isTestFile(f));
  scan.components = scan.components.filter(f => !isTestFile(f));
  scan.middlewares = scan.middlewares.filter(f => !isTestFile(f));

  return scan;
}

function scanRoutes(dir, scan) {
  // Find routes
  ['src/app/api', 'src/routes', 'routes', 'api', 'src/api'].forEach(routeDir => {
    const fullDir = resolve(dir, routeDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.routes.push(relative(dir, f));
      }
    }
  });
}


function scanModels(dir, scan) {
  // Find models/entities
  ['src/models', 'models', 'src/entities', 'entities', 'src/schema', 'schema', 'prisma'].forEach(modelDir => {
    const fullDir = resolve(dir, modelDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.models.push(relative(dir, f));
      }
    }
  });
}


function scanServices(dir, scan) {
  // Find services
  ['src/services', 'services', 'src/lib', 'lib'].forEach(svcDir => {
    const fullDir = resolve(dir, svcDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.services.push(relative(dir, f));
      }
    }
  });
}


function scanTests(dir, scan) {
  // Find tests — top-level test dirs
  ['tests', 'test', '__tests__', 'spec', 'e2e'].forEach(testDir => {
    const fullDir = resolve(dir, testDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.tests.push(relative(dir, f));
      }
    }
  });

  // Find co-located tests: src/**/__tests__/ and src/**/*.test.* / src/**/*.spec.*
  const srcDir = resolve(dir, 'src');
  if (existsSync(srcDir)) {
    walkDir(srcDir, (filePath) => {
      const rel = relative(dir, filePath);
      const isTestDir = rel.includes('__tests__') || rel.includes('__test__');
      const isTestFile = /\.(test|spec)\.[^.]+$/.test(rel);
      if ((isTestDir || isTestFile) && !scan.tests.includes(rel)) {
        scan.tests.push(rel);
      }
    });
  }

  // Read vitest/jest config for custom test patterns
  const testConfigs = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'jest.config.ts', 'jest.config.js'];
  for (const cfgFile of testConfigs) {
    const cfgPath = resolve(dir, cfgFile);
    if (existsSync(cfgPath)) {
      try {
        const cfgContent = readFileSync(cfgPath, 'utf-8');
        // Extract include patterns like: include: ['src/**/*.test.ts']
        const includeMatch = cfgContent.match(/include\s*:\s*\[([^\]]+)\]/);
        if (includeMatch) {
          // Parse the test root from the pattern (e.g., 'src/**/*.test.ts' → 'src')
          const patterns = includeMatch[1].match(/['"]([^'"]+)['"]/g);
          if (patterns) {
            for (const p of patterns) {
              const pattern = p.replace(/['"]|\s/g, '');
              // Extract root dir from glob (e.g., 'src/**/*.test.ts' → 'src')
              const rootDir = pattern.split('/')[0];
              if (rootDir && rootDir !== '**' && rootDir !== '*') {
                const fullDir = resolve(dir, rootDir);
                if (existsSync(fullDir)) {
                  walkDir(fullDir, (filePath) => {
                    const rel = relative(dir, filePath);
                    if (/\.(test|spec)\.[^.]+$/.test(rel) && !scan.tests.includes(rel)) {
                      scan.tests.push(rel);
                    }
                  });
                }
              }
            }
          }
        }
      } catch { /* config parse may fail */ }
      break; // Use first found config
    }
  }
}


function scanComponents(dir, scan) {
  // Find components
  ['src/components', 'components', 'src/ui'].forEach(compDir => {
    const fullDir = resolve(dir, compDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.components.push(relative(dir, f));
      }
    }
  });
}


function scanMiddlewares(dir, scan) {
  // Find middleware
  ['src/middleware', 'middleware', 'src/middlewares'].forEach(mwDir => {
    const fullDir = resolve(dir, mwDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.middlewares.push(relative(dir, f));
      }
    }
  });
}


function scanEnvVars(dir, scan) {
  // Parse .env.example for env vars
  const envExample = resolve(dir, '.env.example');
  if (existsSync(envExample)) {
    const content = readFileSync(envExample, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Z][A-Z0-9_]+)\s*=\s*(.*)/);
      if (match) {
        scan.envVars.push({ name: match[1], example: match[2] || '<required>' });
      }
    }
  }
}

function countFilesAndLines(dir, scan) {
  walkDir(dir, (filePath) => {
    scan.totalFiles++;
    try {
      const content = readFileSync(filePath, 'utf-8');
      scan.totalLines += content.split('\n').length;
    } catch { /* skip binary files */ }
  });
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function walkDir(dir, callback) {
  sharedWalkFiles(dir, (fullPath) => {
    if (CODE_EXTENSIONS.has(extname(fullPath))) callback(fullPath);
  }, { ignoreDirs: IGNORE_DIRS });
}

function getFilesRecursive(dir) {
  const results = [];
  sharedWalkFiles(dir, (fullPath) => results.push(fullPath), { ignoreDirs: IGNORE_DIRS });
  return results;
}
