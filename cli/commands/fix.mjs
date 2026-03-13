/**
 * Fix Command — The AI Orchestrator
 * 
 * The CLI does NOT write documentation content.
 * It FLAGS what needs work and generates intelligent prompts
 * that tell the AI exactly what to research and write.
 * 
 * Output modes:
 *   --format text   Human-readable issue list (default)
 *   --format json   Machine-readable for VS Code / CI
 *   --format prompt Full AI-ready prompt with codebase research instructions
 *   --doc <name>    Generate deep prompt for a specific document
 *   --auto          Create skeleton files (NOT content) via init
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { c } from '../docguard.mjs';

// ── Document Quality Definitions ───────────────────────────────────────────
// What each doc SHOULD contain, and what to look for in the codebase

const DOC_EXPECTATIONS = {
  'docs-canonical/ARCHITECTURE.md': {
    label: 'Architecture',
    purpose: 'Define the system design: layers, components, boundaries, and data flow',
    qualitySignals: [
      'Has a system overview (not a TODO placeholder)',
      'Lists actual components/modules with responsibilities',
      'Defines layer boundaries and allowed imports',
      'Includes a data flow or request lifecycle description',
      'References real file paths or directories',
    ],
    aiResearchInstructions: `
RESEARCH STEPS:
1. Read package.json for project name, description, dependencies, and scripts
2. List the top-level directory structure (ls -la, focus on src/, lib/, cli/, app/, etc.)
3. Identify the entry point(s) — check "main", "bin", or "exports" in package.json
4. For each major directory, read 2-3 representative files to understand its purpose
5. Map the import graph — which modules import which
6. Identify external dependencies and what role they play

WRITE THE DOCUMENT:
- System Overview: 2-3 sentences on what this project does and who uses it
- Component Map: Table of each module/directory with its responsibility
- Layer Boundaries: Which layers can import from which (draw import rules)
- Data Flow: How a request/command flows through the system
- Key Design Decisions: Why the architecture is the way it is
- Technology Choices: List frameworks/tools and why they were chosen

FORMAT: Use the docguard metadata header (version, status, last-reviewed).
IMPORTANT: Use REAL file paths, REAL module names, REAL dependency names. No placeholders.`,
  },

  'docs-canonical/DATA-MODEL.md': {
    label: 'Data Model',
    purpose: 'Document all data structures, schemas, database tables, and relationships',
    qualitySignals: [
      'Lists actual database tables/collections or data structures',
      'Shows field names, types, and constraints',
      'Documents relationships (foreign keys, references)',
      'Includes indexes if applicable',
      'No TODO or example placeholders in table rows',
    ],
    aiResearchInstructions: `
RESEARCH STEPS:
1. Search for schema definitions: grep -r "Schema\\|model\\|Table\\|Entity\\|interface\\|type " src/ lib/ --include="*.ts" --include="*.js" --include="*.mjs"
2. Look for database config: grep -r "database\\|sequelize\\|prisma\\|mongoose\\|drizzle\\|knex" package.json
3. Check for migration files in migrations/, db/, prisma/, etc.
4. Look for TypeScript interfaces/types that define data shapes
5. Check for Zod schemas, JSON schemas, or validation files
6. If no database: document the config file format (.docguard.json, etc.)

WRITE THE DOCUMENT:
- If database project: Document each table with columns, types, constraints, indexes, relationships
- If config-driven: Document each config file format with all fields, types, defaults, and validation rules
- If API project: Document request/response shapes
- If CLI project: Document any configuration formats, file formats the tool reads/writes

FORMAT: Use markdown tables. Include field name, type, required/optional, default, description.
IMPORTANT: Research the actual codebase. Do NOT use placeholder values.`,
  },

  'docs-canonical/SECURITY.md': {
    label: 'Security',
    purpose: 'Document authentication, authorization, secrets management, and security boundaries',
    qualitySignals: [
      'Documents actual auth mechanism (or explicitly states "no auth needed")',
      'Lists secrets/credentials and where they are stored',
      'Describes RBAC/permissions if applicable',
      'Has a threat model or security boundaries section',
      'References .gitignore patterns for sensitive files',
    ],
    aiResearchInstructions: `
RESEARCH STEPS:
1. Check .gitignore for security-related patterns (.env, secrets, keys, credentials)
2. Search for auth: grep -r "auth\\|token\\|jwt\\|session\\|password\\|secret\\|apiKey\\|API_KEY" src/ lib/ --include="*.ts" --include="*.js" --include="*.mjs"
3. Check package.json for auth-related dependencies (passport, jwt, bcrypt, etc.)
4. Look for middleware or guards that enforce permissions
5. Check for .env files (but DON'T include secret values — only variable names)
6. Look for CORS configuration, rate limiting, input validation

WRITE THE DOCUMENT:
- Auth Mechanism: What auth does this project use? (OAuth, JWT, API key, none, etc.)
- Secrets Inventory: List all secrets/env vars needed (names only, never values)
- Secrets Storage: Where are secrets stored? (.env, Vault, AWS Secrets Manager, etc.)
- Permissions/RBAC: What roles exist? What can each role do?
- Security Boundaries: What is trusted vs untrusted input?
- .gitignore Audit: Confirm sensitive files are excluded from version control
- If CLI tool with no auth: State explicitly "No authentication required — this is a local CLI tool"

IMPORTANT: Be specific to THIS project. Don't add generic security boilerplate for features the project doesn't have.`,
  },

  'docs-canonical/TEST-SPEC.md': {
    label: 'Test Spec',
    purpose: 'Document test strategy, coverage requirements, and critical test scenarios',
    qualitySignals: [
      'References actual test files and test frameworks',
      'Lists critical flows that must be tested',
      'Documents test commands (npm test, etc.)',
      'Has coverage thresholds or quality gates',
      'No generic placeholder test scenarios',
    ],
    aiResearchInstructions: `
RESEARCH STEPS:
1. Read package.json "scripts" for test commands
2. Find test files: find . -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" | head -20
3. Read the test configuration (jest.config, vitest.config, .mocharc, etc.)
4. Read 2-3 test files to understand the testing patterns used
5. Check for E2E test setup (playwright, cypress, puppeteer configs)
6. Look for CI config that runs tests (.github/workflows/)

WRITE THE DOCUMENT:
- Test Framework: What testing tool is used and why
- Test Structure: Where tests live, naming conventions
- Test Commands: Exact commands to run unit, integration, E2E tests
- Critical Flows: List the 5-10 most important things that MUST be tested
- Coverage: Current coverage and target thresholds
- CI Integration: How tests run in CI/CD

IMPORTANT: Reference REAL test files. If there are no tests yet, document what SHOULD be tested.`,
  },

  'docs-canonical/ENVIRONMENT.md': {
    label: 'Environment',
    purpose: 'Document setup steps, dependencies, and environment variables',
    qualitySignals: [
      'Has actual setup commands (not placeholders)',
      'Lists real environment variables with descriptions',
      'Documents Node/Python/runtime version requirements',
      'Includes troubleshooting for common setup issues',
      'Works as a "new contributor can follow this and get running" guide',
    ],
    aiResearchInstructions: `
RESEARCH STEPS:
1. Read package.json for: engines, scripts, dependencies
2. Check for .nvmrc, .node-version, .python-version, .tool-versions
3. Search for process.env usage: grep -r "process.env\\|os.environ" src/ lib/ cli/ --include="*.ts" --include="*.js" --include="*.mjs" --include="*.py"
4. Check for .env.example or .env.template files
5. Check for Docker/docker-compose files
6. Look for setup scripts in scripts/ or Makefile

WRITE THE DOCUMENT:
- Prerequisites: Node version, package manager, any system deps
- Setup Steps: Exact commands from clone to running (git clone → npm install → npm run dev)
- Environment Variables: Table of all env vars (name, required/optional, description, example value — never real secrets)
- If CLI with no env vars: State "No environment variables required"
- Common Issues: Known gotchas during setup

IMPORTANT: A new contributor should be able to follow this doc and have the project running in under 10 minutes.`,
  },
};

// ── Main Entry ─────────────────────────────────────────────────────────────

export function runFix(projectDir, config, flags) {
  const isJson = flags.format === 'json';
  const isPrompt = flags.format === 'prompt';
  const autoFix = flags.auto || false;
  const specificDoc = flags.doc || null;

  // If --doc flag is provided, generate a deep prompt for that specific document
  if (specificDoc) {
    return generateDocPrompt(projectDir, config, specificDoc);
  }

  if (!isJson && !isPrompt) {
    console.log(`${c.bold}🔧 DocGuard Fix — ${config.projectName}${c.reset}`);
    console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
    console.log(`${c.dim}   Scanning for issues...${c.reset}\n`);
  }

  const issues = collectIssues(projectDir, config);

  if (autoFix) {
    const fixed = autoFixIssues(projectDir, config, issues);
    if (!isJson) {
      console.log(`  ${c.green}✅ Created ${fixed} skeleton file(s)${c.reset}`);
      console.log(`  ${c.dim}   Now run ${c.cyan}docguard fix --format prompt${c.dim} to generate AI instructions for filling them in${c.reset}\n`);
    }
    const remaining = collectIssues(projectDir, config);
    outputResults(remaining, projectDir, config, flags);
  } else {
    outputResults(issues, projectDir, config, flags);
  }
}

// ── Issue Collection ───────────────────────────────────────────────────────

function collectIssues(projectDir, config) {
  const issues = [];
  const ptc = config.projectTypeConfig || {};

  // 1. Missing required files
  const requiredFiles = [
    ...config.requiredFiles.canonical,
    config.requiredFiles.changelog,
    config.requiredFiles.driftLog,
  ];

  for (const file of requiredFiles) {
    if (!existsSync(resolve(projectDir, file))) {
      issues.push({
        type: 'missing-file',
        severity: 'error',
        file,
        message: `Missing: ${file}`,
        autoFixable: true,
        fix: {
          action: 'create',
          command: 'docguard fix --auto',
          ai_instruction: `Create ${file} with real project content. Run: docguard fix --doc ${basename(file, '.md').toLowerCase()}`,
        },
      });
    }
  }

  // Agent file check
  const hasAgent = config.requiredFiles.agentFile.some(f =>
    existsSync(resolve(projectDir, f))
  );
  if (!hasAgent) {
    issues.push({
      type: 'missing-file',
      severity: 'error',
      file: 'AGENTS.md',
      message: 'Missing: AGENTS.md (AI agent config)',
      autoFixable: true,
      fix: {
        action: 'create',
        command: 'docguard fix --auto',
        ai_instruction: 'Create AGENTS.md with project stack, workflow rules, and DocGuard integration.',
      },
    });
  }

  // 2. Document quality assessment (not just placeholder detection)
  for (const [filePath, expectations] of Object.entries(DOC_EXPECTATIONS)) {
    const fullPath = resolve(projectDir, filePath);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    const quality = assessDocQuality(content, expectations);

    if (quality.score === 'empty') {
      issues.push({
        type: 'empty-doc',
        severity: 'error',
        file: filePath,
        message: `${expectations.label} doc is a skeleton template with no real content`,
        autoFixable: false,
        fix: {
          action: 'rewrite',
          ai_instruction: `This document is just a template. Run: docguard fix --doc ${basename(filePath, '.md').toLowerCase()}\nThen have your AI assistant execute the generated prompt to write real content.`,
        },
      });
    } else if (quality.score === 'partial') {
      issues.push({
        type: 'partial-doc',
        severity: 'warning',
        file: filePath,
        message: `${expectations.label} doc has ${quality.placeholders} unfilled placeholder(s) — needs AI to complete`,
        autoFixable: false,
        fix: {
          action: 'improve',
          ai_instruction: `Improve ${filePath}. ${quality.failedSignals.join('. ')}.\nRun: docguard fix --doc ${basename(filePath, '.md').toLowerCase()} --format prompt`,
        },
      });
    }
    // quality.score === 'good' → no issue
  }

  // 3. Missing .docguard.json
  if (!existsSync(resolve(projectDir, '.docguard.json'))) {
    issues.push({
      type: 'missing-config',
      severity: 'info',
      file: '.docguard.json',
      message: 'No .docguard.json — using defaults',
      autoFixable: true,
      fix: {
        action: 'create',
        command: 'docguard fix --auto',
        ai_instruction: 'Create .docguard.json with projectName, projectType, and projectTypeConfig.',
      },
    });
  }

  // 4. Check .env.example if needed
  if (ptc.needsEnvExample !== false && ptc.needsEnvVars !== false) {
    if (!existsSync(resolve(projectDir, '.env.example'))) {
      const hasEnv = ['.env', '.env.local', '.env.development'].some(f =>
        existsSync(resolve(projectDir, f))
      );
      if (hasEnv) {
        issues.push({
          type: 'missing-env-example',
          severity: 'warning',
          file: '.env.example',
          message: '.env exists but no .env.example for contributors',
          autoFixable: false,
          fix: {
            action: 'create',
            ai_instruction: 'Create .env.example with all env var names from .env, replace secrets with descriptions.',
          },
        });
      }
    }
  }

  // 5. CHANGELOG quality
  const changelogPath = resolve(projectDir, config.requiredFiles.changelog);
  if (existsSync(changelogPath)) {
    const content = readFileSync(changelogPath, 'utf-8');
    if (!content.includes('[Unreleased]') && !content.includes('## [')) {
      issues.push({
        type: 'empty-changelog',
        severity: 'warning',
        file: config.requiredFiles.changelog,
        message: 'CHANGELOG.md has no version entries',
        autoFixable: false,
        fix: {
          action: 'edit',
          ai_instruction: 'Add version entries to CHANGELOG.md following Keep a Changelog format. Check git log for recent changes.',
        },
      });
    }
  }

  return issues;
}

// ── Document Quality Assessment ────────────────────────────────────────────

function assessDocQuality(content, expectations) {
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim() && !l.startsWith('<!--'));
  const placeholders = (content.match(/<!-- TODO|<!-- e\.g\./g) || []).length;
  const hasRealContent = nonEmptyLines.length > 10; // More than just headers

  // Check if this is basically just a template
  const contentLines = lines.filter(l =>
    l.trim() &&
    !l.startsWith('#') &&
    !l.startsWith('<!--') &&
    !l.startsWith('|--') &&
    !l.startsWith('| *') &&
    !l.match(/^\|\s*$/)
  );

  // Count lines that are actual content (not table headers, not metadata)
  const realContentLines = contentLines.filter(l =>
    !l.includes('<!-- TODO') &&
    !l.includes('<!-- e.g.') &&
    !l.match(/^\|\s*\|/) // empty table cells
  );

  const failedSignals = [];
  for (const signal of expectations.qualitySignals) {
    // Simple heuristic checks
    if (signal.includes('TODO placeholder') && placeholders > 0) {
      failedSignals.push(`Still has ${placeholders} placeholder(s)`);
    }
    if (signal.includes('actual') && realContentLines.length < 5) {
      failedSignals.push('Lacks specific, project-relevant content');
    }
  }

  if (!hasRealContent || realContentLines.length < 5) {
    return { score: 'empty', placeholders, failedSignals };
  }

  if (placeholders > 0 || failedSignals.length > 2) {
    return { score: 'partial', placeholders, failedSignals };
  }

  return { score: 'good', placeholders: 0, failedSignals: [] };
}

// ── Deep Document Prompt Generator ─────────────────────────────────────────

function generateDocPrompt(projectDir, config, docName) {
  // Normalize doc name: "architecture" → "docs-canonical/ARCHITECTURE.md"
  const normalized = docName.toLowerCase().replace(/\.md$/, '');
  const mapping = {
    'architecture': 'docs-canonical/ARCHITECTURE.md',
    'data-model': 'docs-canonical/DATA-MODEL.md',
    'datamodel': 'docs-canonical/DATA-MODEL.md',
    'security': 'docs-canonical/SECURITY.md',
    'test-spec': 'docs-canonical/TEST-SPEC.md',
    'testspec': 'docs-canonical/TEST-SPEC.md',
    'environment': 'docs-canonical/ENVIRONMENT.md',
    'env': 'docs-canonical/ENVIRONMENT.md',
  };

  const filePath = mapping[normalized];
  if (!filePath) {
    console.error(`${c.red}Unknown document: ${docName}${c.reset}`);
    console.log(`${c.dim}Available: architecture, data-model, security, test-spec, environment${c.reset}`);
    process.exit(1);
  }

  const expectations = DOC_EXPECTATIONS[filePath];
  if (!expectations) {
    console.error(`${c.red}No prompt template for: ${filePath}${c.reset}`);
    process.exit(1);
  }

  // Build context about the project
  const projectType = config.projectType || 'unknown';
  const projectName = config.projectName || basename(projectDir);

  // Check if doc exists and what state it's in
  const fullPath = resolve(projectDir, filePath);
  const exists = existsSync(fullPath);
  const currentContent = exists ? readFileSync(fullPath, 'utf-8') : null;
  const quality = currentContent ? assessDocQuality(currentContent, expectations) : null;

  const action = !exists ? 'CREATE' : quality?.score === 'empty' ? 'REWRITE (current file is just a template)' : 'IMPROVE';

  console.log(`\nYou are documenting the project "${projectName}" (a ${projectType} project).`);
  console.log(`Project directory: ${projectDir}\n`);
  console.log(`TASK: ${action} the file ${filePath}`);
  console.log(`PURPOSE: ${expectations.purpose}\n`);

  if (exists && quality?.score !== 'good') {
    console.log(`CURRENT STATE: The document ${quality?.score === 'empty' ? 'is just a skeleton template with TODO placeholders — it needs to be completely rewritten with REAL project content' : `has ${quality?.placeholders} placeholder(s) that need to be replaced with real content`}.`);
    console.log('');
  }

  console.log(expectations.aiResearchInstructions.trim());

  console.log(`\nVALIDATION: After writing, run \`npx docguard guard\` to verify the document passes all checks.`);
  console.log(`The document should have NO <!-- TODO --> or <!-- e.g. --> placeholders.`);
  console.log(`Set the docguard:status header to 'active' (not 'draft').`);
}

// ── Auto-Fix (skeleton creation only) ──────────────────────────────────────

function autoFixIssues(projectDir, config, issues) {
  let fixed = 0;
  const autoFixable = issues.filter(i => i.autoFixable);

  if (autoFixable.length === 0) return 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  try {
    const cliPath = resolve(import.meta.dirname, '..', 'docguard.mjs');
    execSync(`node ${cliPath} init --dir "${projectDir}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    fixed = autoFixable.length;
  } catch { /* init may partially succeed */ }

  return fixed;
}

// ── Output ─────────────────────────────────────────────────────────────────

function outputResults(issues, projectDir, config, flags) {
  const isJson = flags.format === 'json';
  const isPrompt = flags.format === 'prompt';

  if (issues.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ status: 'clean', issues: [], fixCount: 0 }));
    } else if (isPrompt) {
      console.log('No CDD issues found. All documentation is complete.');
    } else {
      console.log(`  ${c.green}${c.bold}✅ No issues — documentation is complete!${c.reset}\n`);
    }
    return;
  }

  if (isJson) {
    console.log(JSON.stringify({
      status: 'issues-found',
      project: config.projectName,
      projectType: config.projectType || 'unknown',
      issueCount: issues.length,
      autoFixable: issues.filter(i => i.autoFixable).length,
      issues: issues.map(i => ({
        type: i.type,
        severity: i.severity,
        file: i.file,
        message: i.message,
        autoFixable: i.autoFixable,
        fix: i.fix,
      })),
    }, null, 2));
    return;
  }

  if (isPrompt) {
    // Smart prompt that groups by action type
    console.log(`You are working on "${config.projectName}" (${config.projectType || 'unknown'} project).`);
    console.log(`DocGuard found ${issues.length} documentation issue(s).\n`);

    // Group: empty/missing docs first (these need AI to write)
    const needsWriting = issues.filter(i => i.type === 'empty-doc' || i.type === 'missing-file');
    const needsFixing = issues.filter(i => i.type === 'partial-doc' || i.type === 'missing-env-example' || i.type === 'empty-changelog');
    const other = issues.filter(i => !needsWriting.includes(i) && !needsFixing.includes(i));

    if (needsWriting.length > 0) {
      console.log('## Documents That Need To Be Written\n');
      console.log('These documents are empty templates or missing. For each one, run the docguard fix --doc command to get detailed research instructions:\n');
      for (const issue of needsWriting) {
        const docKey = basename(issue.file, '.md').toLowerCase();
        console.log(`- **${issue.file}**: ${issue.message}`);
        console.log(`  → Run: \`docguard fix --doc ${docKey}\` for AI research prompt\n`);
      }
    }

    if (needsFixing.length > 0) {
      console.log('## Documents That Need Improvement\n');
      for (const issue of needsFixing) {
        console.log(`- **${issue.file}**: ${issue.message}`);
        console.log(`  → ${issue.fix.ai_instruction}\n`);
      }
    }

    if (other.length > 0) {
      console.log('## Other Issues\n');
      for (const issue of other) {
        console.log(`- **${issue.file}**: ${issue.message}`);
        console.log(`  → ${issue.fix.ai_instruction}\n`);
      }
    }

    console.log('\nAfter fixing, run `docguard guard` to verify compliance.');
    return;
  }

  // Text output
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  if (errors.length > 0) {
    console.log(`  ${c.red}${c.bold}Errors (${errors.length})${c.reset}`);
    for (const e of errors) {
      console.log(`    ${c.red}✖${c.reset} ${e.message}`);
      if (e.type === 'empty-doc') {
        const docKey = basename(e.file, '.md').toLowerCase();
        console.log(`      ${c.dim}Run: ${c.cyan}docguard fix --doc ${docKey}${c.dim} → paste prompt into AI${c.reset}`);
      } else {
        console.log(`      ${c.dim}Run: ${c.cyan}${e.fix.command || 'docguard fix --auto'}${c.reset}`);
      }
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Warnings (${warnings.length})${c.reset}`);
    for (const w of warnings) {
      console.log(`    ${c.yellow}⚠${c.reset} ${w.message}`);
      if (w.type === 'partial-doc') {
        const docKey = basename(w.file, '.md').toLowerCase();
        console.log(`      ${c.dim}Run: ${c.cyan}docguard fix --doc ${docKey}${c.dim} → paste prompt into AI${c.reset}`);
      } else {
        console.log(`      ${c.dim}${w.fix.ai_instruction.slice(0, 100)}${c.reset}`);
      }
    }
    console.log('');
  }

  if (infos.length > 0) {
    console.log(`  ${c.cyan}${c.bold}Info (${infos.length})${c.reset}`);
    for (const info of infos) {
      console.log(`    ${c.cyan}ℹ${c.reset} ${info.message}`);
    }
    console.log('');
  }

  console.log(`  ${c.bold}─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.bold}Total: ${issues.length} issue(s)${c.reset}`);
  console.log('');
  console.log(`  ${c.dim}${c.bold}Workflow:${c.reset}`);
  console.log(`  ${c.dim}  1. ${c.cyan}docguard fix --auto${c.dim}            Create skeleton files${c.reset}`);
  console.log(`  ${c.dim}  2. ${c.cyan}docguard fix --doc architecture${c.dim}  Get AI prompt for each doc${c.reset}`);
  console.log(`  ${c.dim}  3. Paste prompt into your AI assistant (Copilot, Cursor, Claude)${c.reset}`);
  console.log(`  ${c.dim}  4. ${c.cyan}docguard guard${c.dim}                  Verify compliance${c.reset}\n`);
}
