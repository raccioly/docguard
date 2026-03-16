/**
 * Init Command — Initialize CDD documentation from templates
 * Interactive setup: asks which docs the user needs + suggests hooks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { c, PROFILES } from '../shared.mjs';
import { ensureSkills } from '../ensure-skills.mjs';

function detectProjectType(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (pkg.bin) return 'cli';
      if (allDeps.next || allDeps.react || allDeps.vue || allDeps['@angular/core'] ||
          allDeps.svelte || allDeps.nuxt) return 'webapp';
      if (allDeps.express || allDeps.fastify || allDeps.hono || allDeps.koa) return 'api';
      if (pkg.main || pkg.exports || pkg.module) return 'library';
    } catch { /* fall through */ }
  }
  if (existsSync(resolve(dir, 'manage.py'))) return 'webapp';
  if (existsSync(resolve(dir, 'setup.py')) || existsSync(resolve(dir, 'pyproject.toml'))) return 'library';
  return 'unknown';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

// ── Readline helper ──────────────────────────────────────────────────────

function askQuestion(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(prompt, answer => {
      rl.close();
      res(answer);
    });
  });
}

// ── Init Command ─────────────────────────────────────────────────────────

export async function runInit(projectDir, config, flags) {
  const profileName = flags.profile || 'standard';
  const profile = PROFILES[profileName];

  if (!profile) {
    console.error(`${c.red}Unknown profile: ${profileName}${c.reset}`);
    console.log(`Available profiles: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }

  console.log(`${c.bold}🏗️  DocGuard Init — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  console.log(`${c.dim}   Profile:   ${profileName} — ${profile.description}${c.reset}\n`);

  // Detect project type
  const detectedType = detectProjectType(projectDir);
  console.log(`  ${c.dim}Auto-detected project type: ${c.cyan}${detectedType}${c.reset}\n`);

  // ── Doc catalog ────────────────────────────────────────────────────────
  const allDocs = [
    { key: 'ARCHITECTURE', file: 'docs-canonical/ARCHITECTURE.md', template: 'ARCHITECTURE.md.template', desc: 'System architecture, tech stack, layer boundaries', defaultYes: true },
    { key: 'DATA-MODEL', file: 'docs-canonical/DATA-MODEL.md', template: 'DATA-MODEL.md.template', desc: 'Database schemas, entities, relationships', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'SECURITY', file: 'docs-canonical/SECURITY.md', template: 'SECURITY.md.template', desc: 'Auth, secrets, security controls', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'TEST-SPEC', file: 'docs-canonical/TEST-SPEC.md', template: 'TEST-SPEC.md.template', desc: 'Test strategy, coverage requirements', defaultYes: true },
    { key: 'ENVIRONMENT', file: 'docs-canonical/ENVIRONMENT.md', template: 'ENVIRONMENT.md.template', desc: 'Environment variables, deployment config', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'REQUIREMENTS', file: 'docs-canonical/REQUIREMENTS.md', template: 'REQUIREMENTS.md.template', desc: 'Functional requirements, user stories (spec-kit aligned)', defaultYes: true },
  ];

  let selectedDocs;

  if (flags.skipPrompts || flags.force) {
    // Non-interactive — use profile defaults
    const profileCanonical = profile.requiredFiles?.canonical || allDocs.map(d => d.file);
    selectedDocs = allDocs.filter(d => profileCanonical.includes(d.file));
    console.log(`  ${c.dim}Non-interactive mode — using ${profileName} profile defaults${c.reset}\n`);
  } else {
    // Interactive — ask about each doc
    console.log(`  ${c.bold}Which canonical docs does your project need?${c.reset}`);
    console.log(`  ${c.dim}(press Enter for default, type y or n)${c.reset}\n`);

    selectedDocs = [];
    for (const doc of allDocs) {
      const defaultLabel = doc.defaultYes ? 'Y/n' : 'y/N';
      const answer = await askQuestion(`    ${doc.key} — ${doc.desc} [${defaultLabel}]: `);
      const trimmed = answer.trim().toLowerCase();

      const include = doc.defaultYes
        ? (trimmed === '' || trimmed === 'y' || trimmed === 'yes')
        : (trimmed === 'y' || trimmed === 'yes');

      if (include) {
        selectedDocs.push(doc);
      }
    }
    console.log('');
  }

  // ── Create selected doc files ──────────────────────────────────────────
  const created = [];
  const skipped = [];

  // Always create tracking files
  const alwaysCreate = [
    { template: 'AGENTS.md.template', dest: 'AGENTS.md' },
    { template: 'CHANGELOG.md.template', dest: 'CHANGELOG.md' },
    { template: 'DRIFT-LOG.md.template', dest: 'DRIFT-LOG.md' },
  ];

  const fileMappings = [
    ...selectedDocs.map(d => ({ template: d.template, dest: d.file })),
    ...alwaysCreate,
  ];

  for (const mapping of fileMappings) {
    const destPath = resolve(projectDir, mapping.dest);
    const templatePath = resolve(TEMPLATES_DIR, mapping.template);

    if (existsSync(destPath)) {
      skipped.push(mapping.dest);
      console.log(`  ${c.yellow}⏭️${c.reset}  ${mapping.dest} ${c.dim}(already exists)${c.reset}`);
      continue;
    }

    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    if (existsSync(templatePath)) {
      const content = readFileSync(templatePath, 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      const processed = content.replace(/YYYY-MM-DD/g, today);
      writeFileSync(destPath, processed, 'utf-8');
      created.push(mapping.dest);
      console.log(`  ${c.green}✅${c.reset} Created: ${c.cyan}${mapping.dest}${c.reset}`);
    } else {
      console.log(`  ${c.red}❌${c.reset} Template not found: ${mapping.template}`);
    }
  }

  // ── Create .docguard.json ──────────────────────────────────────────────
  const configPath = resolve(projectDir, '.docguard.json');
  if (!existsSync(configPath)) {
    const typeDefaults = {
      cli:     { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
      library: { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
      webapp:  { needsEnvVars: true,  needsEnvExample: true,  needsE2E: true,  needsDatabase: true },
      api:     { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
      unknown: { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
    };

    const ptc = typeDefaults[detectedType] || typeDefaults.unknown;

    const defaultConfig = {
      projectName: config.projectName,
      version: '0.4',
      profile: profileName,
      projectType: detectedType,
      projectTypeConfig: ptc,
      requiredFiles: {
        canonical: selectedDocs.map(d => d.file),
      },
      validators: profile.validators || {
        structure: true,
        docsSync: true,
        drift: true,
        changelog: true,
        architecture: false,
        testSpec: true,
        security: false,
        environment: true,
        freshness: true,
      },
    };

    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
    created.push('.docguard.json');
    console.log(`  ${c.green}✅${c.reset} Created: ${c.cyan}.docguard.json${c.reset} ${c.dim}(${selectedDocs.length} docs selected, type: ${detectedType})${c.reset}`);
  } else {
    skipped.push('.docguard.json');
    console.log(`  ${c.yellow}⏭️${c.reset}  .docguard.json ${c.dim}(already exists)${c.reset}`);
  }

  // ── Slash commands for AI agents ───────────────────────────────────────
  const commandsSourceDir = resolve(TEMPLATES_DIR, 'commands');
  if (existsSync(commandsSourceDir)) {
    const commandFiles = readdirSync(commandsSourceDir).filter(f => f.endsWith('.md'));

    const agentDirs = [
      { name: 'GitHub Copilot', path: '.github/commands' },
      { name: 'Cursor', path: '.cursor/rules' },
      { name: 'Google Gemini', path: '.gemini/commands' },
      { name: 'Claude Code', path: '.claude/commands' },
      { name: 'Antigravity', path: '.agents/workflows' },
    ];

    const detected = agentDirs.filter(a =>
      existsSync(resolve(projectDir, a.path.split('/')[0]))
    );

    const targets = detected.length > 0
      ? detected
      : [{ name: 'GitHub (default)', path: '.github/commands' }];

    let totalCreated = 0;
    const installedLocations = [];

    for (const target of targets) {
      const destDir = resolve(projectDir, target.path);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      let dirCreated = 0;
      for (const file of commandFiles) {
        const destPath = resolve(destDir, file);
        if (!existsSync(destPath)) {
          const content = readFileSync(resolve(commandsSourceDir, file), 'utf-8');
          writeFileSync(destPath, content, 'utf-8');
          dirCreated++;
        }
      }

      if (dirCreated > 0) {
        totalCreated += dirCreated;
        installedLocations.push(`${target.path}/ (${target.name})`);
      }
    }

    if (totalCreated > 0) {
      created.push(`slash commands (${installedLocations.length} location(s))`);
      console.log(`  ${c.green}✅${c.reset} Installed ${c.cyan}slash commands${c.reset} for AI agents:`);
      for (const loc of installedLocations) {
        console.log(`     ${c.dim}→ ${loc}${c.reset}`);
      }
    } else {
      console.log(`  ${c.yellow}⏭️${c.reset}  Slash commands ${c.dim}(already installed)${c.reset}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Created:${c.reset} ${created.length} files`);
  if (skipped.length > 0) {
    console.log(`  ${c.yellow}Skipped:${c.reset} ${skipped.length} files (already exist)`);
  }

  // ── Hooks suggestion ──────────────────────────────────────────────────
  console.log(`\n  ${c.bold}💡 Automation:${c.reset}`);
  console.log(`  ${c.dim}Auto-guard on commit:${c.reset}  ${c.cyan}docguard hooks --type pre-commit${c.reset}`);
  console.log(`  ${c.dim}Auto-guard on push:${c.reset}   ${c.cyan}docguard hooks --type pre-push${c.reset}`);

  // ── Next steps ─────────────────────────────────────────────────────────
  const createdDocs = created.filter(f => f.startsWith('docs-canonical/'));

  if (createdDocs.length > 0) {
    console.log(`\n  ${c.bold}🤖 AI Auto-Populate${c.reset}`);
    console.log(`  ${c.dim}The files above are skeleton templates. Your AI agent should fill them.${c.reset}`);
    console.log(`  ${c.dim}Run this single command to get a full remediation plan:${c.reset}\n`);
    console.log(`  ${c.cyan}${c.bold}docguard diagnose${c.reset}\n`);
    console.log(`  ${c.dim}Or generate prompts for individual docs:${c.reset}`);

    const docNameMap = {
      'docs-canonical/ARCHITECTURE.md': 'architecture',
      'docs-canonical/DATA-MODEL.md': 'data-model',
      'docs-canonical/SECURITY.md': 'security',
      'docs-canonical/TEST-SPEC.md': 'test-spec',
      'docs-canonical/ENVIRONMENT.md': 'environment',
    };

    for (const doc of createdDocs) {
      const target = docNameMap[doc];
      if (target) {
        console.log(`  ${c.cyan}docguard fix --doc ${target}${c.reset}`);
      }
    }
    console.log(`\n  ${c.dim}Then verify:${c.reset} ${c.cyan}docguard guard${c.reset}\n`);
  } else {
    console.log(`\n  ${c.dim}Run${c.reset} ${c.cyan}docguard diagnose${c.reset} ${c.dim}to check for issues.${c.reset}\n`);
  }

  // Auto-install skills and commands
  ensureSkills(projectDir, flags);
}
