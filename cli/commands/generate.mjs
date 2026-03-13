/**
 * Generate Command — Reverse-engineer canonical docs from an existing codebase
 * Scans source code and creates documentation templates pre-filled with project data.
 * 
 * This is the "killer feature" — take any project and auto-generate CDD docs.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';
import { c } from '../specguard.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs',
]);

export function runGenerate(projectDir, config, flags) {
  console.log(`${c.bold}🔮 SpecGuard Generate — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  console.log(`${c.dim}   Scanning codebase to generate canonical documentation...${c.reset}\n`);

  // ── 1. Detect Framework/Stack ──
  const stack = detectStack(projectDir);
  console.log(`  ${c.bold}Detected Stack:${c.reset}`);
  for (const [category, tech] of Object.entries(stack)) {
    if (tech) console.log(`    ${c.cyan}${category}:${c.reset} ${tech}`);
  }
  console.log('');

  // ── 2. Scan Project Structure ──
  const scan = scanProject(projectDir);

  // ── 3. Generate Documents ──
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  let created = 0;
  let skipped = 0;

  // Generate ARCHITECTURE.md
  const archResult = generateArchitecture(projectDir, config, stack, scan, flags);
  if (archResult) { created++; } else { skipped++; }

  // Generate DATA-MODEL.md
  const dataResult = generateDataModel(projectDir, config, stack, scan, flags);
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

  // Generate root files
  const rootResults = generateRootFiles(projectDir, config, stack, scan, flags);
  created += rootResults.created;
  skipped += rootResults.skipped;

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Generated: ${created}${c.reset}  Skipped: ${skipped} (already exist)`);
  console.log(`\n  ${c.yellow}${c.bold}⚠️  Review all generated docs!${c.reset}`);
  console.log(`  ${c.dim}Generated docs are a starting point — review and refine them.${c.reset}`);
  console.log(`  ${c.dim}Run ${c.cyan}specguard score${c.dim} to check your CDD maturity.${c.reset}\n`);
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

  // Find tests
  ['tests', 'test', '__tests__', 'spec', 'e2e'].forEach(testDir => {
    const fullDir = resolve(dir, testDir);
    if (existsSync(fullDir)) {
      const files = getFilesRecursive(fullDir);
      for (const f of files) {
        scan.tests.push(relative(dir, f));
      }
    }
  });

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

  // Count files and lines
  countFilesAndLines(dir, scan);

  return scan;
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

// ── Document Generators ────────────────────────────────────────────────────

function generateArchitecture(dir, config, stack, scan, flags) {
  const path = resolve(dir, 'docs-canonical/ARCHITECTURE.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  ARCHITECTURE.md (exists)${c.reset}`);
    return false;
  }

  const techRows = Object.entries(stack)
    .filter(([, v]) => v)
    .map(([k, v]) => `| ${k.charAt(0).toUpperCase() + k.slice(1)} | ${v} | | |`)
    .join('\n');

  const componentRows = [];
  if (scan.routes.length > 0) componentRows.push(`| API Routes | HTTP request handling | ${scan.routes.length > 3 ? scan.routes.slice(0, 3).join(', ') + '...' : scan.routes.join(', ')} | |`);
  if (scan.services.length > 0) componentRows.push(`| Services | Business logic | ${scan.services.length > 3 ? scan.services.slice(0, 3).join(', ') + '...' : scan.services.join(', ')} | |`);
  if (scan.models.length > 0) componentRows.push(`| Models | Data entities | ${scan.models.length > 3 ? scan.models.slice(0, 3).join(', ') + '...' : scan.models.join(', ')} | |`);
  if (scan.components.length > 0) componentRows.push(`| UI Components | Frontend components | ${scan.components.length} files | |`);
  if (scan.middlewares.length > 0) componentRows.push(`| Middleware | Request processing | ${scan.middlewares.join(', ')} | |`);

  const content = `# Architecture

<!-- specguard:version 0.1.0 -->
<!-- specguard:status draft -->
<!-- specguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- specguard:generated true -->

> **Auto-generated by SpecGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Version** | \`0.1.0\` |
| **Last Updated** | ${new Date().toISOString().split('T')[0]} |
| **Project Size** | ${scan.totalFiles} files, ~${Math.round(scan.totalLines / 1000)}K lines |

---

## System Overview

<!-- TODO: Describe what this system does and who it's for -->
${config.projectName} is a ${stack.framework || stack.language || 'software'} application.

## Component Map

| Component | Responsibility | Location | Tests |
|-----------|---------------|----------|-------|
${componentRows.join('\n') || '| <!-- Add components --> | | | |'}

## Tech Stack

| Category | Technology | Version | License |
|----------|-----------|---------|---------|
${techRows || '| <!-- Add technologies --> | | | |'}

## Layer Boundaries

<!-- TODO: Define which layers can import from which -->

| Layer | Can Import From | Cannot Import From |
|-------|----------------|-------------------|
${scan.routes.length > 0 ? '| Routes/Handlers | Services, Middleware | Models (direct) |' : ''}
${scan.services.length > 0 ? '| Services | Repositories, Utils | Routes |' : ''}
${scan.models.length > 0 ? '| Models/Repositories | Utils | Services, Routes |' : ''}

## Diagrams

\`\`\`mermaid
graph TD
    A[Client] --> B[${stack.framework || 'API'}]
    B --> C[Services]
    C --> D[${stack.database || 'Database'}]
\`\`\`

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | SpecGuard Generate | Auto-generated from codebase scan |
`;

  writeFileSync(path, content, 'utf-8');
  console.log(`  ${c.green}✅ ARCHITECTURE.md${c.reset} (${componentRows.length} components, ${Object.values(stack).filter(Boolean).length} tech)`);
  return true;
}

function generateDataModel(dir, config, stack, scan, flags) {
  const path = resolve(dir, 'docs-canonical/DATA-MODEL.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  DATA-MODEL.md (exists)${c.reset}`);
    return false;
  }

  // Parse model files for entity names
  const entities = [];
  for (const modelFile of scan.models) {
    const name = basename(modelFile, extname(modelFile));
    if (name !== 'index' && name !== 'schema') {
      entities.push({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        file: modelFile,
      });
    }
  }

  // Check for Prisma schema
  const prismaPath = resolve(dir, 'prisma/schema.prisma');
  if (existsSync(prismaPath)) {
    const prismaContent = readFileSync(prismaPath, 'utf-8');
    const modelRegex = /model\s+(\w+)\s*\{/g;
    let match;
    while ((match = modelRegex.exec(prismaContent)) !== null) {
      if (!entities.find(e => e.name.toLowerCase() === match[1].toLowerCase())) {
        entities.push({ name: match[1], file: 'prisma/schema.prisma' });
      }
    }
  }

  const entityRows = entities.map(e =>
    `| ${e.name} | ${stack.database || 'TBD'} | ${e.name.toLowerCase()}Id | See \`${e.file}\` |`
  ).join('\n');

  const content = `# Data Model

<!-- specguard:version 0.1.0 -->
<!-- specguard:status draft -->
<!-- specguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- specguard:generated true -->

> **Auto-generated by SpecGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Version** | \`0.1.0\` |
| **Database** | ${stack.database || 'TBD'} |
| **ORM** | ${stack.orm || 'None detected'} |

---

## Entities

| Entity | Storage | Primary Key | Description |
|--------|---------|-------------|-------------|
${entityRows || '| <!-- No models detected --> | | | |'}

${entities.map(e => `### ${e.name}

> Source: \`${e.file}\`

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| <!-- TODO: Fill in fields --> | | | | | |
`).join('\n')}

## Relationships

| From | To | Type | FK/Reference | Cascade |
|------|-----|------|-------------|---------|
| <!-- TODO --> | | | | |

## Indexes

| Table | Index Name | Fields | Type | Purpose |
|-------|-----------|--------|------|---------|
| <!-- TODO --> | | | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | SpecGuard Generate | Auto-generated (${entities.length} entities found) |
`;

  writeFileSync(path, content, 'utf-8');
  console.log(`  ${c.green}✅ DATA-MODEL.md${c.reset} (${entities.length} entities detected)`);
  return true;
}

function generateEnvironment(dir, config, stack, scan, flags) {
  const path = resolve(dir, 'docs-canonical/ENVIRONMENT.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  ENVIRONMENT.md (exists)${c.reset}`);
    return false;
  }

  const envVarRows = scan.envVars.map(v =>
    `| \`${v.name}\` | ${categorizeEnvVar(v.name)} | Yes | \`${v.example}\` | |`
  ).join('\n');

  const content = `# Environment

<!-- specguard:version 0.1.0 -->
<!-- specguard:status draft -->
<!-- specguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- specguard:generated true -->

> **Auto-generated by SpecGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Version** | \`0.1.0\` |

---

## Prerequisites

| Tool | Version | Installation |
|------|---------|-------------|
${stack.language ? `| ${stack.language.split(' ')[0]} | ${stack.language.split(' ')[1] || 'latest'} | |` : ''}
${stack.framework ? `| ${stack.framework.split(' ')[0]} | ${stack.framework.split(' ')[1] || 'latest'} | |` : ''}
${stack.database ? `| ${stack.database} | latest | |` : ''}

## Environment Variables

| Variable | Category | Required | Example | Description |
|----------|----------|:--------:|---------|-------------|
${envVarRows || '| <!-- No .env.example found --> | | | | |'}

## Setup Steps

1. Clone the repository
2. Install dependencies: \`${existsSync(resolve(dir, 'pnpm-lock.yaml')) ? 'pnpm install' : 'npm install'}\`
3. Copy environment file: \`cp .env.example .env.local\`
4. Fill in environment variables
5. Start development server: \`${existsSync(resolve(dir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'} run dev\`

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | SpecGuard Generate | Auto-generated (${scan.envVars.length} env vars found) |
`;

  writeFileSync(path, content, 'utf-8');
  console.log(`  ${c.green}✅ ENVIRONMENT.md${c.reset} (${scan.envVars.length} env vars detected)`);
  return true;
}

function generateTestSpec(dir, config, stack, scan, flags) {
  const path = resolve(dir, 'docs-canonical/TEST-SPEC.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  TEST-SPEC.md (exists)${c.reset}`);
    return false;
  }

  // Build service-to-test map
  const serviceMap = [];
  for (const svc of scan.services) {
    const svcName = basename(svc, extname(svc));
    const matchingTest = scan.tests.find(t =>
      t.includes(svcName) || t.includes(svcName.replace('.', '.test.'))
    );
    serviceMap.push({
      source: svc,
      test: matchingTest || '—',
      status: matchingTest ? '✅' : '❌',
    });
  }

  const serviceRows = serviceMap.map(s =>
    `| \`${s.source}\` | \`${s.test}\` | — | ${s.status} |`
  ).join('\n');

  const content = `# Test Specification

<!-- specguard:version 0.1.0 -->
<!-- specguard:status draft -->
<!-- specguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- specguard:generated true -->

> **Auto-generated by SpecGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Test Framework** | ${stack.testing || 'Not detected'} |
| **Test Files Found** | ${scan.tests.length} |

---

## Test Categories

| Category | Framework | Location | Run Command |
|----------|-----------|----------|-------------|
| Unit | ${stack.testing || 'TBD'} | tests/unit/ | \`npm test\` |
| Integration | ${stack.testing || 'TBD'} | tests/integration/ | \`npm run test:integration\` |
| E2E | Playwright | tests/e2e/ | \`npm run test:e2e\` |

## Coverage Rules

| Metric | Target | Current |
|--------|:------:|:-------:|
| Line Coverage | 80% | <!-- TODO --> |
| Branch Coverage | 70% | <!-- TODO --> |
| Function Coverage | 80% | <!-- TODO --> |

## Service-to-Test Map

| Source File | Unit Test | Integration Test | Status |
|------------|-----------|-----------------|:------:|
${serviceRows || '| <!-- No services found --> | | | |'}

## Critical User Journeys

| # | Journey | Test File | Status |
|---|---------|-----------|:------:|
| 1 | <!-- e.g. User Registration --> | <!-- test file --> | ❌ |
| 2 | <!-- e.g. Login Flow --> | | ❌ |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | SpecGuard Generate | Auto-generated (${scan.tests.length} test files, ${serviceMap.filter(s => s.status === '✅').length}/${serviceMap.length} mapped) |
`;

  writeFileSync(path, content, 'utf-8');
  console.log(`  ${c.green}✅ TEST-SPEC.md${c.reset} (${scan.tests.length} tests, ${serviceMap.filter(s => s.status === '✅').length}/${serviceMap.length} services mapped)`);
  return true;
}

function generateSecurity(dir, config, stack, scan, flags) {
  const path = resolve(dir, 'docs-canonical/SECURITY.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  SECURITY.md (exists)${c.reset}`);
    return false;
  }

  const content = `# Security

<!-- specguard:version 0.1.0 -->
<!-- specguard:status draft -->
<!-- specguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- specguard:generated true -->

> **Auto-generated by SpecGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |

---

## Authentication

| Method | Provider | Token Type | Expiry |
|--------|---------|-----------|--------|
| ${stack.auth || '<!-- TODO -->'} | | | |

## Authorization

| Role | Permissions | Notes |
|------|-----------|-------|
| <!-- e.g. admin --> | <!-- All --> | |
| <!-- e.g. user --> | <!-- Read/Write --> | |

## Secrets Management

| Secret | Storage | Rotation | Access |
|--------|---------|----------|--------|
${scan.envVars.filter(v => isSecretVar(v.name)).map(v =>
  `| \`${v.name}\` | Environment Variable | <!-- TODO --> | Application |`
).join('\n') || '| <!-- TODO --> | | | |'}

## Security Rules

- [ ] All secrets stored in environment variables (never in code)
- [ ] \`.env\` is in \`.gitignore\`
- [ ] API endpoints require authentication
- [ ] Input validation on all user inputs
- [ ] HTTPS enforced in production
- [ ] CORS configured appropriately

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | SpecGuard Generate | Auto-generated |
`;

  writeFileSync(path, content, 'utf-8');
  console.log(`  ${c.green}✅ SECURITY.md${c.reset} (auth: ${stack.auth || 'not detected'})`);
  return true;
}

function generateRootFiles(dir, config, stack, scan, flags) {
  let created = 0;
  let skipped = 0;

  // AGENTS.md
  const agentsPath = resolve(dir, 'AGENTS.md');
  if (!existsSync(agentsPath) || flags.force) {
    const content = `# AI Agent Instructions — ${config.projectName}

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.

## Workflow

1. **Read** \`docs-canonical/\` before suggesting changes
2. **Check** existing patterns in the codebase
3. **Confirm** your approach before writing code
4. **Implement** matching existing code style
5. **Log** any deviations in \`DRIFT-LOG.md\` with \`// DRIFT: reason\`

## Project Stack

${Object.entries(stack).filter(([, v]) => v).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}

## Key Files

| File | Purpose |
|------|---------|
| \`docs-canonical/ARCHITECTURE.md\` | System design |
| \`docs-canonical/DATA-MODEL.md\` | Database schemas |
| \`docs-canonical/SECURITY.md\` | Auth & secrets |
| \`docs-canonical/TEST-SPEC.md\` | Test requirements |
| \`docs-canonical/ENVIRONMENT.md\` | Environment setup |
| \`CHANGELOG.md\` | Change tracking |
| \`DRIFT-LOG.md\` | Documented deviations |

## Rules

- Never commit without updating CHANGELOG.md
- If code deviates from docs, add \`// DRIFT: reason\`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
`;
    writeFileSync(agentsPath, content, 'utf-8');
    console.log(`  ${c.green}✅ AGENTS.md${c.reset}`);
    created++;
  } else {
    console.log(`  ${c.dim}⏭️  AGENTS.md (exists)${c.reset}`);
    skipped++;
  }

  // CHANGELOG.md
  const changelogPath = resolve(dir, 'CHANGELOG.md');
  if (!existsSync(changelogPath) || flags.force) {
    const content = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- CDD documentation via SpecGuard generate
`;
    writeFileSync(changelogPath, content, 'utf-8');
    console.log(`  ${c.green}✅ CHANGELOG.md${c.reset}`);
    created++;
  } else {
    console.log(`  ${c.dim}⏭️  CHANGELOG.md (exists)${c.reset}`);
    skipped++;
  }

  // DRIFT-LOG.md
  const driftPath = resolve(dir, 'DRIFT-LOG.md');
  if (!existsSync(driftPath) || flags.force) {
    const content = `# Drift Log

> Documents conscious deviations from canonical specifications.
> Every \`// DRIFT: reason\` in code must have a corresponding entry here.

| Date | File | Canonical Doc | Drift Description | Severity | Resolution |
|------|------|---------------|-------------------|----------|------------|
| | | | | | |
`;
    writeFileSync(driftPath, content, 'utf-8');
    console.log(`  ${c.green}✅ DRIFT-LOG.md${c.reset}`);
    created++;
  } else {
    console.log(`  ${c.dim}⏭️  DRIFT-LOG.md (exists)${c.reset}`);
    skipped++;
  }

  return { created, skipped };
}

// ── Utility Functions ──────────────────────────────────────────────────────

function categorizeEnvVar(name) {
  if (name.includes('SECRET') || name.includes('KEY') || name.includes('TOKEN') || name.includes('PASSWORD')) return '🔐 Secret';
  if (name.includes('DATABASE') || name.includes('DB_') || name.includes('REDIS')) return '🗃️ Database';
  if (name.includes('AUTH') || name.includes('JWT') || name.includes('SESSION')) return '🔒 Auth';
  if (name.includes('AWS') || name.includes('CLOUD') || name.includes('S3')) return '☁️ Cloud';
  if (name.includes('URL') || name.includes('HOST') || name.includes('PORT')) return '🌐 Network';
  return '⚙️ Config';
}

function isSecretVar(name) {
  return name.includes('SECRET') || name.includes('KEY') || name.includes('TOKEN') || name.includes('PASSWORD');
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(fullPath))) {
        callback(fullPath);
      }
    } catch { /* skip */ }
  }
}

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
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    } catch { /* skip */ }
  }
  return results;
}
