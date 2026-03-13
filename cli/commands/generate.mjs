/**
 * Generate Command — Reverse-engineer canonical docs from an existing codebase
 * Scans source code and creates documentation templates pre-filled with project data.
 * 
 * This is the "killer feature" — take any project and auto-generate CDD docs.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, basename, relative, dirname } from 'node:path';
import { c } from '../docguard.mjs';
import { detectDocTools } from '../scanners/doc-tools.mjs';
import { scanRoutesDeep } from '../scanners/routes.mjs';
import { scanSchemasDeep, generateERDiagram } from '../scanners/schemas.mjs';

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
 * Standards citation map — each doc type maps to its governing industry standard.
 * Inspired by RAG-grounded standards alignment (Lopez et al., AITPG, IEEE TSE 2026).
 */
const STANDARDS_CITATIONS = {
  'ARCHITECTURE.md': {
    standard: 'arc42 Template + C4 Model',
    reference: 'Starke, G. & Brown, S. "arc42 — Architecture communication template." https://arc42.org | Brown, S. "The C4 Model for visualising software architecture." https://c4model.com',
    sections: '§1 Introduction, §2 Constraints, §3 Context, §4 Solution Strategy, §5 Building Blocks, §6 Runtime, §7 Deployment, §8 Crosscutting, §9 ADRs, §10 Quality, §11 Risks, §12 Glossary',
  },
  'DATA-MODEL.md': {
    standard: 'C4 Component Diagram + Entity-Relationship (Chen notation)',
    reference: 'Brown, S. "C4 Model — Component diagrams." https://c4model.com | Chen, P. "The Entity-Relationship Model." ACM TODS 1(1), 1976',
    sections: 'Entities, Relationships, ER Diagrams (Mermaid), Field-level definitions',
  },
  'TEST-SPEC.md': {
    standard: 'ISO/IEC/IEEE 29119-3:2022 — Test Documentation',
    reference: 'ISO/IEC/IEEE, "Software and systems engineering — Software testing — Part 3: Test documentation." International Standard, 2022',
    sections: 'Test Categories, Coverage Rules, Test Matrix, Tool Configuration',
  },
  'SECURITY.md': {
    standard: 'OWASP ASVS v4.0 + CWE Top 25',
    reference: 'OWASP Foundation, "Application Security Verification Standard v4.0." https://owasp.org/asvs | MITRE, "CWE Top 25." https://cwe.mitre.org/top25',
    sections: 'Authentication, Secrets Management, Access Control, Input Validation',
  },
  'ENVIRONMENT.md': {
    standard: '12-Factor App Methodology',
    reference: 'Wiggins, A. "The Twelve-Factor App." https://12factor.net',
    sections: 'Environment Variables, Config Separation, Setup Steps, Provider Configuration',
  },
  'API-REFERENCE.md': {
    standard: 'OpenAPI Specification 3.1',
    reference: 'OpenAPI Initiative, "OpenAPI Specification v3.1.0." https://spec.openapis.org/oas/v3.1.0',
    sections: 'Endpoints, Request/Response schemas, Authentication, Error codes',
  },
};

/**
 * Append a standards citation footer to generated doc content.
 * @param {string} content - The generated markdown content
 * @param {string} docName - The filename (e.g., 'ARCHITECTURE.md')
 * @returns {string} Content with citation footer appended
 */
function appendStandardsCitation(content, docName) {
  const citation = STANDARDS_CITATIONS[docName];
  if (!citation) return content;

  const footer = `
---

## Standards Reference

> **Aligned with**: ${citation.standard}
>
> **Sections covered**: ${citation.sections}
>
> **Reference**: ${citation.reference}
>
> *Standards alignment inspired by RAG-grounded generation (Lopez et al., AITPG, IEEE TSE 2026).*
`;

  return content.trimEnd() + '\n' + footer;
}

export function runGenerate(projectDir, config, flags) {
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
  const deepRoutes = scanRoutesDeep(projectDir, stack, docTools);
  if (deepRoutes.length > 0) {
    console.log(`  ${c.bold}Route Scanning:${c.reset} ${deepRoutes.length} endpoints found (source: ${deepRoutes[0]?.source || 'code'})`);
  }

  // ── 5. Deep Scan Schemas ──
  const deepSchemas = scanSchemasDeep(projectDir, stack, docTools);
  if (deepSchemas.entities.length > 0) {
    console.log(`  ${c.bold}Schema Scanning:${c.reset} ${deepSchemas.entities.length} entities, ${deepSchemas.relationships.length} relationships (source: ${deepSchemas.source})`);
  }
  console.log('');

  // ── 6. Generate Documents ──
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
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

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Generated: ${created}${c.reset}  Skipped: ${skipped} (already exist)`);
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

function generateArchitecture(dir, config, stack, scan, flags, docTools) {
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

  // Storybook integration
  if (docTools?.storybook?.found) {
    componentRows.push(`| Storybook | UI component docs | .storybook/ (${docTools.storybook.storyCount || '?'} stories) | |`);
  }

  // Doc tools section — always include DocGuard since it generated these docs
  const docToolRows = ['| DocGuard | `.docguard.json` | Active |'];
  if (docTools?._detected?.length > 0) {
    for (const tool of docTools._detected) {
      const info = docTools[tool];
      docToolRows.push(`| ${tool} | ${info.config || info.path || info.middleware || 'detected'} | Active |`);
    }
  }

  const content = `# Architecture

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->
<!-- docguard:standards arc42, C4 -->

> **Auto-generated by DocGuard.** Review and refine this document.
> Follows [arc42](https://arc42.org) structure and [C4 Model](https://c4model.com) diagrams.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Version** | \`0.1.0\` |
| **Last Updated** | ${new Date().toISOString().split('T')[0]} |
| **Project Size** | ${scan.totalFiles} files, ~${Math.round(scan.totalLines / 1000)}K lines |

---

## 1. Introduction & Goals
<!-- arc42: §1 — Introduction and Goals -->

<!-- TODO: Describe what this system does, who it's for, and key quality goals -->
${config.projectName} is a ${stack.framework || stack.language || 'software'} application.

### Quality Goals

| Priority | Quality Goal | Scenario |
|----------|-------------|----------|
| 1 | <!-- e.g. Performance --> | <!-- e.g. Response time < 200ms --> |
| 2 | <!-- e.g. Security --> | <!-- e.g. All endpoints authenticated --> |
| 3 | <!-- e.g. Maintainability --> | <!-- e.g. New feature in < 1 day --> |

## 2. Constraints
<!-- arc42: §2 — Constraints -->

| Type | Constraint | Background |
|------|-----------|------------|
| Technical | ${stack.language || 'TBD'} | Primary language |
| Technical | ${stack.framework || 'TBD'} | Framework |
| Infrastructure | ${stack.hosting || 'TBD'} | Hosting provider |

## 3. Context & Scope
<!-- arc42: §3 — Context and Scope (C4 Level 1: System Context) -->

\\\`\\\`\\\`mermaid
graph TD
    U[Users/Clients] --> S[${config.projectName}]
    S --> DB[(${stack.database || 'Database'})]
    S --> EXT[External Services]
\\\`\\\`\\\`

## 4. Solution Strategy
<!-- arc42: §4 — Solution Strategy -->

See \\\`docs-canonical/ADR.md\\\` for architecture decision records.

## 5. Building Block View
<!-- arc42: §5 — Building Block View (C4 Level 2: Container) -->

| Component | Responsibility | Location | Tests |
|-----------|---------------|----------|-------|
${componentRows.join('\\n') || '| <!-- Add components --> | | | |'}

\\\`\\\`\\\`mermaid
graph TD
    A[Client] --> B[${stack.framework || 'API'}]
    B --> C[Services]
    C --> D[${stack.database || 'Database'}]
    ${scan.middlewares.length > 0 ? 'A --> M[Middleware] --> B' : ''}
    ${scan.components.length > 0 ? 'A --> UI[UI Components]' : ''}
\\\`\\\`\\\`

## 6. Runtime View
<!-- arc42: §6 — Runtime View -->

\\\`\\\`\\\`mermaid
sequenceDiagram
    participant C as Client
    participant A as ${stack.framework || 'API'}
    participant S as Service
    participant D as ${stack.database || 'DB'}
    C->>A: Request
    A->>S: Process
    S->>D: Query
    D-->>S: Result
    S-->>A: Response
    A-->>C: JSON
\\\`\\\`\\\`

## 7. Deployment View
<!-- arc42: §7 — Deployment View -->

See \\\`docs-canonical/DEPLOYMENT.md\\\` for details.

| Environment | Infrastructure | URL |
|-------------|---------------|-----|
| Development | localhost | http://localhost:3000 |
| Staging | ${stack.hosting || 'TBD'} | <!-- TODO --> |
| Production | ${stack.hosting || 'TBD'} | <!-- TODO --> |

## 8. Crosscutting Concepts
<!-- arc42: §8 — Crosscutting Concepts -->

### Tech Stack

| Category | Technology | Version | License |
|----------|-----------|---------|---------|
${techRows || '| <!-- Add technologies --> | | | |'}
${docToolRows.length > 0 ? `
### Documentation Tools

| Tool | Config | Status |
|------|--------|--------|
${docToolRows.join('\\n')}
` : ''}

### Layer Boundaries

| Layer | Can Import From | Cannot Import From |
|-------|----------------|-------------------|
${scan.routes.length > 0 ? '| Routes/Handlers | Services, Middleware | Models (direct) |' : ''}
${scan.services.length > 0 ? '| Services | Repositories, Utils | Routes |' : ''}
${scan.models.length > 0 ? '| Models/Repositories | Utils | Services, Routes |' : ''}

## 9. Architecture Decisions
<!-- arc42: §9 — Architecture Decisions -->

See \\\`docs-canonical/ADR.md\\\` for the full decision log.

## 10. Quality Requirements
<!-- arc42: §10 — Quality Requirements -->

See \\\`docs-canonical/TEST-SPEC.md\\\` for test requirements and coverage targets.

## 11. Risks & Technical Debt
<!-- arc42: §11 — Risk Assessment and Technical Debt -->

See \\\`DRIFT-LOG.md\\\` for documented deviations from canonical specs.
See \\\`docs-canonical/KNOWN-GOTCHAS.md\\\` for known issues.

## 12. Glossary
<!-- arc42: §12 — Glossary -->

| Term | Definition |
|------|-----------|
| CDD | Canonical-Driven Development — documentation as the source of truth |
| Canonical Doc | A specification document that defines system behavior |
| Drift | Conscious deviation from canonical documentation |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated (arc42 + C4 aligned) |
`;

  writeFileSync(path, appendStandardsCitation(content, 'ARCHITECTURE.md'), 'utf-8');
  console.log(`  ${c.green}✅ ARCHITECTURE.md${c.reset} (arc42 §1-§12, ${componentRows.length} components, ${Object.values(stack).filter(Boolean).length} tech)`);
  return true;
}

// ── API Reference Generator (NEW — from deep route scanning) ───────────────

function generateApiReference(dir, config, stack, deepRoutes, flags) {
  const path = resolve(dir, 'docs-canonical/API-REFERENCE.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  API-REFERENCE.md (exists)${c.reset}`);
    return false;
  }

  // Group routes by resource (first path segment after /api/)
  const groups = {};
  for (const route of deepRoutes) {
    const parts = route.path.split('/').filter(Boolean);
    const resource = parts[1] || parts[0] || 'root';
    if (!groups[resource]) groups[resource] = [];
    groups[resource].push(route);
  }

  // Build endpoint table
  const endpointRows = deepRoutes
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .map(r => `| \`${r.method}\` | \`${r.path}\` | ${r.handler || '—'} | ${r.auth ? '🔒' : '🔓'} | ${r.description || '—'} |`)
    .join('\n');

  // Build per-resource sections
  const resourceSections = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, routes]) => {
      const routeDetails = routes.map(r => `#### ${r.method} \`${r.path}\`

> Source: \`${r.file}\`${r.source ? ` (${r.source})` : ''}

- **Auth:** ${r.auth ? 'Required' : 'None'}
- **Handler:** ${r.handler || '—'}
${r.description ? `- **Description:** ${r.description}` : ''}

| Parameter | In | Type | Required | Description |
|-----------|-----|------|:--------:|-------------|
| <!-- TODO --> | | | | |

| Status | Response |
|--------|----------|
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
`).join('\n');

      return `### ${resource.charAt(0).toUpperCase() + resource.slice(1)}

${routeDetails}`;
    }).join('\n---\n\n');

  const content = `# API Reference

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->

> **Auto-generated by DocGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Base URL** | \`http://localhost:3000\` |
| **Auth** | <!-- TODO: Describe auth mechanism --> |
| **Total Endpoints** | ${deepRoutes.length} |
| **Source** | ${deepRoutes[0]?.source || 'code scan'} |

---

## Endpoints Summary

| Method | Path | Handler | Auth | Description |
|--------|------|---------|:----:|-------------|
${endpointRows}

---

## Endpoint Details

${resourceSections}

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated (${deepRoutes.length} endpoints from ${deepRoutes[0]?.source || 'code'}) |
`;

  writeFileSync(path, appendStandardsCitation(content, 'API-REFERENCE.md'), 'utf-8');
  console.log(`  ${c.green}✅ API-REFERENCE.md${c.reset} (${deepRoutes.length} endpoints, ${Object.keys(groups).length} resources)`);
  return true;
}

// ── Enhanced Data Model Generator ──────────────────────────────────────────

function generateDataModel(dir, config, stack, scan, flags, deepSchemas) {
  const path = resolve(dir, 'docs-canonical/DATA-MODEL.md');
  if (existsSync(path) && !flags.force) {
    console.log(`  ${c.dim}⏭️  DATA-MODEL.md (exists)${c.reset}`);
    return false;
  }

  // Use deep schemas if available, fallback to basic scan
  let entities = [];
  let relationships = [];
  let schemaSource = 'file scan';

  if (deepSchemas && deepSchemas.entities.length > 0) {
    entities = deepSchemas.entities;
    relationships = deepSchemas.relationships;
    schemaSource = deepSchemas.source;
  } else {
    // Fallback: basic entity detection from file names
    for (const modelFile of scan.models) {
      const name = basename(modelFile, extname(modelFile));
      if (name !== 'index' && name !== 'schema') {
        entities.push({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          fields: [],
          file: modelFile,
          source: 'file',
        });
      }
    }
  }

  // Build entity summary table
  const entityRows = entities
    .filter(e => e.source !== 'prisma-enum')
    .map(e => {
      const pk = e.fields?.find(f => f.primaryKey);
      return `| ${e.name} | ${stack.database || 'TBD'} | ${pk ? pk.name : e.name.toLowerCase() + 'Id'} | ${e.file || '—'} | ${e.fields?.length || 0} fields |`;
    }).join('\n');

  // Build detailed entity sections
  const entitySections = entities
    .filter(e => e.source !== 'prisma-enum')
    .map(e => {
      if (!e.fields || e.fields.length === 0) {
        return `### ${e.name}

> Source: \`${e.file || 'unknown'}\`

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| <!-- TODO: Fill in fields --> | | | | | |
`;
      }
      const fieldRows = e.fields.map(f =>
        `| ${f.name} | ${f.type} | ${f.required ? '✓' : '✗'} | ${f.default || '—'} | ${f.primaryKey ? 'PK' : ''}${f.unique ? ' UK' : ''} | ${f.description || ''} |`
      ).join('\n');

      return `### ${e.name}

> Source: \`${e.file || 'unknown'}\` (${e.source || 'detected'})

| Field | Type | Required | Default | Constraints | Description |
|-------|------|:--------:|---------|-------------|-------------|
${fieldRows}
`;
    }).join('\n');

  // Build enum sections (if Prisma enums found)
  const enums = entities.filter(e => e.source === 'prisma-enum');
  const enumSection = enums.length > 0 ? `## Enums

${enums.map(e => `### ${e.name}

| Value |
|-------|
${e.fields.map(f => `| ${f.name} |`).join('\n')}
`).join('\n')}` : '';

  // Build relationship table
  const relRows = relationships.length > 0
    ? relationships.map(r => `| ${r.from} | ${r.to} | ${r.type} | ${r.field} | — |`).join('\n')
    : '| <!-- No relationships detected --> | | | | |';

  // Generate mermaid ER diagram
  const erDiagram = generateERDiagram(entities, relationships);

  const content = `# Data Model

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->

> **Auto-generated by DocGuard.** Review and refine this document.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-draft-yellow) |
| **Version** | \`0.1.0\` |
| **Database** | ${stack.database || 'TBD'} |
| **ORM** | ${stack.orm || 'None detected'} |
| **Schema Source** | ${schemaSource} |
| **Entities** | ${entities.filter(e => e.source !== 'prisma-enum').length} |
| **Relationships** | ${relationships.length} |

---

## Entity Summary

| Entity | Storage | Primary Key | Source | Fields |
|--------|---------|-------------|--------|--------|
${entityRows || '| <!-- No models detected --> | | | | |'}

---

## Entity Details

${entitySections}
${enumSection}

## Relationships

| From | To | Type | FK/Reference | Cascade |
|------|-----|------|-------------|---------|
${relRows}
${erDiagram ? `
## Entity-Relationship Diagram

\`\`\`mermaid
${erDiagram}
\`\`\`
` : ''}

## Indexes

| Table | Index Name | Fields | Type | Purpose |
|-------|-----------|--------|------|---------|
| <!-- TODO: Document indexes --> | | | | |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated (${entities.length} entities, ${relationships.length} relationships from ${schemaSource}) |
`;

  writeFileSync(path, appendStandardsCitation(content, 'DATA-MODEL.md'), 'utf-8');
  console.log(`  ${c.green}✅ DATA-MODEL.md${c.reset} (${entities.length} entities, ${relationships.length} relationships from ${schemaSource})`);
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

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->

> **Auto-generated by DocGuard.** Review and refine this document.

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
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated (${scan.envVars.length} env vars found) |
`;

  writeFileSync(path, appendStandardsCitation(content, 'ENVIRONMENT.md'), 'utf-8');
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

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->

> **Auto-generated by DocGuard.** Review and refine this document.

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
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated (${scan.tests.length} test files, ${serviceMap.filter(s => s.status === '✅').length}/${serviceMap.length} mapped) |
`;

  writeFileSync(path, appendStandardsCitation(content, 'TEST-SPEC.md'), 'utf-8');
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

<!-- docguard:version 0.1.0 -->
<!-- docguard:status draft -->
<!-- docguard:last-reviewed ${new Date().toISOString().split('T')[0]} -->
<!-- docguard:generated true -->

> **Auto-generated by DocGuard.** Review and refine this document.

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
| 0.1.0 | ${new Date().toISOString().split('T')[0]} | DocGuard Generate | Auto-generated |
`;

  writeFileSync(path, appendStandardsCitation(content, 'SECURITY.md'), 'utf-8');
  console.log(`  ${c.green}✅ SECURITY.md${c.reset} (auth: ${stack.auth || 'not detected'})`);
  return true;
}

function generateRootFiles(dir, config, stack, scan, flags, docTools) {
  let created = 0;
  let skipped = 0;

  // AGENTS.md (AGENTS.md Standard compliant)
  const agentsPath = resolve(dir, 'AGENTS.md');
  if (!existsSync(agentsPath) || flags.force) {
    const content = `# AI Agent Instructions — ${config.projectName}

<!-- Standard: https://agents.md -->
<!-- Generated by DocGuard — AGENTS.md standard compliant -->

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.

## Workflow

1. **Read** \`docs-canonical/\` before suggesting changes
2. **Check** existing patterns in the codebase
3. **Run** \`npx docguard-cli diagnose\` to see what needs fixing
4. **Confirm** your approach before writing code
5. **Implement** matching existing code style
6. **Log** any deviations in \`DRIFT-LOG.md\` with \`// DRIFT: reason\`
7. **Verify** with \`npx docguard-cli guard\` — all checks must pass

## Project Stack

${Object.entries(stack).filter(([, v]) => v).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}

## Key Files

| File | Purpose |
|------|---------|
| \`docs-canonical/ARCHITECTURE.md\` | System design (arc42 aligned) |
| \`docs-canonical/API-REFERENCE.md\` | API endpoint documentation |
| \`docs-canonical/DATA-MODEL.md\` | Database schemas & entities |
| \`docs-canonical/SECURITY.md\` | Auth & secrets |
| \`docs-canonical/TEST-SPEC.md\` | Test requirements |
| \`docs-canonical/ENVIRONMENT.md\` | Environment setup |
| \`AGENTS.md\` | AI agent instructions (this file) |
| \`CHANGELOG.md\` | Change tracking |
| \`DRIFT-LOG.md\` | Documented deviations |

## Permissions & Guardrails

> **IMPORTANT:** These limits apply to all AI agents working on this project.

### Allowed

- Read any file in the repository
- Modify files within \`src/\`, \`tests/\`, and \`docs-canonical/\`
- Run test commands (\`npm test\`, \`npx docguard-cli guard\`)
- Create new files in appropriate directories

### Not Allowed

- Modify \`.env\` files or secrets
- Push commits or create releases without explicit approval
- Delete or rename canonical documentation files
- Bypass DocGuard checks (\`docguard guard\` must pass)
- Install new dependencies without approval

### Safety Rules

- Never hardcode secrets, tokens, or API keys
- Always validate inputs before processing
- Never expose internal paths or stack traces to users
- Run \`npx docguard-cli guard\` before every commit

## Monorepo Support

<!-- If this is a monorepo, nested AGENTS.md files in subdirectories
     override these instructions for their scope. -->

| Scope | AGENTS.md Location |
|-------|-------------------|
| Root (default) | \`./AGENTS.md\` |
| <!-- e.g. packages/api --> | <!-- packages/api/AGENTS.md --> |

## DocGuard Commands

\`\`\`bash
npx docguard-cli guard          # Validate compliance
npx docguard-cli diagnose       # Identify issues + AI fix prompts
npx docguard-cli fix --doc ARCH # Fix specific document
npx docguard-cli score          # CDD maturity score (0-100)
npx docguard-cli generate       # Generate docs from code
\`\`\`

### AI Agent Workflow (IMPORTANT)

1. **Before work**: Run \`npx docguard-cli guard\` — understand compliance state
2. **After changes**: Run \`npx docguard-cli diagnose\` — get fix instructions
3. **Fix issues**: Each issue has an \`ai_instruction\` — follow it exactly
4. **Verify**: Run \`npx docguard-cli guard\` again — must pass before commit
5. **Update CHANGELOG**: All changes need a changelog entry

## Rules

- Never commit without updating CHANGELOG.md
- If code deviates from docs, add \`// DRIFT: reason\`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
- Documentation changes must pass \`docguard guard\`
`;
    writeFileSync(agentsPath, content, 'utf-8');
    console.log(`  ${c.green}✅ AGENTS.md${c.reset} (AGENTS.md standard compliant)`);
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
- CDD documentation via DocGuard generate
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
