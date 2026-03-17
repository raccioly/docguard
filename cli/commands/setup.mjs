/**
 * Setup Command — Interactive onboarding wizard for DocGuard
 *
 * Walks through 7 steps to ensure DocGuard is fully configured:
 *   1. Project detection & config
 *   2. Canonical docs
 *   3. AI skills
 *   4. Slash commands
 *   5. Agent configs
 *   6. External integrations (spec-kit, understanding)
 *   7. Git hooks
 *
 * Each step shows current status (✅/⚠️) and offers to fix what's missing.
 * Supports --skip-prompts for non-interactive CI mode.
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 * Framework dependency: spec-kit (convention, not code).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { c } from '../shared.mjs';
import { ensureSkills, detectAgentMode, isSpecKitInitialized, getDetectedAgent } from '../ensure-skills.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, '../../templates');
const SKILLS_SOURCE = resolve(__dirname, '../../extensions/spec-kit-docguard/skills');
const COMMANDS_SOURCE = resolve(__dirname, '../../commands');

// ── Readline Helper ─────────────────────────────────────────────────────

function askQuestion(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(prompt, answer => {
      rl.close();
      res(answer.trim().toLowerCase());
    });
  });
}

async function askYesNo(prompt, defaultYes = true) {
  const label = defaultYes ? 'Y/n' : 'y/N';
  const answer = await askQuestion(`${prompt} [${label}]: `);
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

// ── Project Type Detection ──────────────────────────────────────────────

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

// ── CLI Detection ───────────────────────────────────────────────────────

function isCliAvailable(name) {
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    execSync(`${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function detectAgentDirs(projectDir) {
  const agentDirs = [
    { name: 'GitHub Copilot', dir: '.github', commandsPath: '.github/commands' },
    { name: 'Cursor', dir: '.cursor', commandsPath: '.cursor/rules' },
    { name: 'Google Gemini', dir: '.gemini', commandsPath: '.gemini/commands' },
    { name: 'Claude Code', dir: '.claude', commandsPath: '.claude/commands' },
    { name: 'Antigravity', dir: '.agents', commandsPath: '.agents/workflows' },
  ];

  return agentDirs.filter(a => existsSync(resolve(projectDir, a.dir)));
}

// ── Main Setup Wizard ───────────────────────────────────────────────────

export async function runSetup(projectDir, config, flags) {
  console.log(`${c.bold}🧙 DocGuard Setup Wizard${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const interactive = !flags.skipPrompts;
  let configured = 0;
  let alreadyGood = 0;

  // ── Step 1: Project Detection & Config ──────────────────────────────

  console.log(`  ${c.bold}Step 1/7: Project Detection${c.reset}`);

  const detectedType = detectProjectType(projectDir);
  console.log(`  ${c.green}✅${c.reset} Project type: ${c.cyan}${detectedType}${c.reset}`);

  const configPath = resolve(projectDir, '.docguard.json');
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log(`  ${c.green}✅${c.reset} .docguard.json exists (profile: ${c.cyan}${cfg.profile || 'standard'}${c.reset})`);
    alreadyGood++;
  } else {
    console.log(`  ${c.yellow}⚠️${c.reset}  .docguard.json missing`);
    const create = interactive
      ? await askYesNo(`     → Create config file?`)
      : true;

    if (create) {
      const typeDefaults = {
        cli:     { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
        library: { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
        webapp:  { needsEnvVars: true,  needsEnvExample: true,  needsE2E: true,  needsDatabase: true },
        api:     { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
        unknown: { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
      };

      const defaultConfig = {
        projectName: config.projectName,
        version: '0.4',
        profile: 'standard',
        projectType: detectedType,
        projectTypeConfig: typeDefaults[detectedType] || typeDefaults.unknown,
      };

      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
      console.log(`     ${c.green}✅ Created .docguard.json${c.reset}`);
      configured++;
    }
  }

  console.log('');

  // ── Step 2: Canonical Docs ──────────────────────────────────────────

  console.log(`  ${c.bold}Step 2/7: Canonical Docs${c.reset}`);

  const canonicalDocs = [
    { file: 'docs-canonical/ARCHITECTURE.md', template: 'ARCHITECTURE.md.template', label: 'Architecture',     defaultYes: true },
    { file: 'docs-canonical/DATA-MODEL.md',   template: 'DATA-MODEL.md.template',   label: 'Data Model',      defaultYes: ['webapp', 'api'].includes(detectedType) },
    { file: 'docs-canonical/SECURITY.md',     template: 'SECURITY.md.template',     label: 'Security',        defaultYes: ['webapp', 'api'].includes(detectedType) },
    { file: 'docs-canonical/TEST-SPEC.md',    template: 'TEST-SPEC.md.template',    label: 'Test Spec',       defaultYes: true },
    { file: 'docs-canonical/ENVIRONMENT.md',  template: 'ENVIRONMENT.md.template',  label: 'Environment',     defaultYes: ['webapp', 'api'].includes(detectedType) },
    { file: 'docs-canonical/REQUIREMENTS.md', template: 'REQUIREMENTS.md.template', label: 'Requirements',    defaultYes: true },
  ];

  const trackingFiles = [
    { file: 'AGENTS.md',     template: 'AGENTS.md.template',     label: 'Agent Instructions' },
    { file: 'CHANGELOG.md',  template: 'CHANGELOG.md.template',  label: 'Changelog' },
    { file: 'DRIFT-LOG.md',  template: 'DRIFT-LOG.md.template',  label: 'Drift Log' },
  ];

  let missingDocs = [];

  // Check canonical docs
  for (const doc of [...canonicalDocs, ...trackingFiles]) {
    const fullPath = resolve(projectDir, doc.file);
    if (existsSync(fullPath)) {
      console.log(`  ${c.green}✅${c.reset} ${doc.file}`);
      alreadyGood++;
    } else {
      console.log(`  ${c.yellow}⚠️${c.reset}  ${doc.file} ${c.dim}(missing)${c.reset}`);
      missingDocs.push(doc);
    }
  }

  if (missingDocs.length > 0) {
    const create = interactive
      ? await askYesNo(`     → Create ${missingDocs.length} missing doc(s) from templates?`)
      : true;

    if (create) {
      const today = new Date().toISOString().split('T')[0];
      for (const doc of missingDocs) {
        const destPath = resolve(projectDir, doc.file);
        const templatePath = resolve(TEMPLATES_DIR, doc.template);

        const destDir = dirname(destPath);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }

        if (existsSync(templatePath)) {
          const content = readFileSync(templatePath, 'utf-8').replace(/YYYY-MM-DD/g, today);
          writeFileSync(destPath, content, 'utf-8');
          console.log(`     ${c.green}✅ Created ${doc.file}${c.reset}`);
          configured++;
        }
      }
    }
  }

  console.log('');

  // ── Step 3: AI Skills ──────────────────────────────────────────────

  console.log(`  ${c.bold}Step 3/7: AI Skills${c.reset}`);

  const docguardSkills = ['docguard-guard', 'docguard-fix', 'docguard-review', 'docguard-score'];
  const speckitSkills = [
    'speckit-specify', 'speckit-plan', 'speckit-tasks', 'speckit-implement',
    'speckit-analyze', 'speckit-clarify', 'speckit-checklist', 'speckit-constitution',
    'speckit-taskstoissues',
  ];
  const allSkillNames = [...docguardSkills, ...speckitSkills];
  const skillsDest = resolve(projectDir, '.agent/skills');
  let missingSkills = [];

  for (const skill of allSkillNames) {
    const skillPath = resolve(skillsDest, skill, 'SKILL.md');
    if (existsSync(skillPath)) {
      console.log(`  ${c.green}✅${c.reset} ${skill}`);
      alreadyGood++;
    } else {
      console.log(`  ${c.yellow}⚠️${c.reset}  ${skill} ${c.dim}(not installed)${c.reset}`);
      missingSkills.push(skill);
    }
  }

  if (missingSkills.length > 0) {
    const hasSpeckitMissing = missingSkills.some(s => s.startsWith('speckit-'));
    const hasDocguardMissing = missingSkills.some(s => s.startsWith('docguard-'));

    if (hasSpeckitMissing) {
      console.log(`  ${c.dim}   Spec-kit skills installed via: ${c.cyan}specify init --here --force --ai-skills${c.reset}`);
    }

    if (hasDocguardMissing) {
      const install = interactive
        ? await askYesNo(`     → Install ${missingSkills.filter(s => s.startsWith('docguard-')).length} DocGuard skill(s) to .agent/skills/?`)
        : true;

      if (install) {
        for (const skill of missingSkills.filter(s => s.startsWith('docguard-'))) {
          const srcSkill = resolve(SKILLS_SOURCE, skill, 'SKILL.md');
          const destDir = resolve(skillsDest, skill);
          if (existsSync(srcSkill)) {
            if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
            writeFileSync(resolve(destDir, 'SKILL.md'), readFileSync(srcSkill, 'utf-8'), 'utf-8');
            console.log(`     ${c.green}✅ Installed ${skill}${c.reset}`);
            configured++;
          }
        }
      }
    }
  }

  console.log('');

  // ── Step 4: Slash Commands ─────────────────────────────────────────

  console.log(`  ${c.bold}Step 4/7: Slash Commands${c.reset}`);

  // Check root commands/ dir
  const rootCommandsDir = resolve(projectDir, 'commands');
  const rootCommandsExist = existsSync(resolve(rootCommandsDir, 'docguard.guard.md'));

  if (rootCommandsExist) {
    console.log(`  ${c.green}✅${c.reset} commands/ ${c.dim}(root)${c.reset}`);
    alreadyGood++;
  } else {
    console.log(`  ${c.yellow}⚠️${c.reset}  commands/ ${c.dim}(not installed)${c.reset}`);
  }

  // Detect agent directories and sync commands
  const detectedAgents = detectAgentDirs(projectDir);
  let unsyncedAgents = [];

  for (const agent of detectedAgents) {
    const agentCommandCheck = resolve(projectDir, agent.commandsPath, 'docguard.guard.md');
    if (existsSync(agentCommandCheck)) {
      console.log(`  ${c.green}✅${c.reset} ${agent.commandsPath}/ ${c.dim}(${agent.name})${c.reset}`);
      alreadyGood++;
    } else {
      console.log(`  ${c.yellow}⚠️${c.reset}  ${agent.commandsPath}/ ${c.dim}(${agent.name} — not synced)${c.reset}`);
      unsyncedAgents.push(agent);
    }
  }

  const needsCommands = !rootCommandsExist || unsyncedAgents.length > 0;

  if (needsCommands && existsSync(COMMANDS_SOURCE)) {
    const install = interactive
      ? await askYesNo(`     → Install/sync slash commands?`)
      : true;

    if (install) {
      const commandFiles = readdirSync(COMMANDS_SOURCE).filter(f => f.endsWith('.md'));

      // Install to root commands/
      if (!rootCommandsExist) {
        if (!existsSync(rootCommandsDir)) mkdirSync(rootCommandsDir, { recursive: true });
        for (const file of commandFiles) {
          const destPath = resolve(rootCommandsDir, file);
          if (!existsSync(destPath)) {
            writeFileSync(destPath, readFileSync(resolve(COMMANDS_SOURCE, file), 'utf-8'), 'utf-8');
          }
        }
        console.log(`     ${c.green}✅ Installed to commands/${c.reset}`);
        configured++;
      }

      // Sync to agent-specific dirs
      for (const agent of unsyncedAgents) {
        const destDir = resolve(projectDir, agent.commandsPath);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        for (const file of commandFiles) {
          const destPath = resolve(destDir, file);
          if (!existsSync(destPath)) {
            writeFileSync(destPath, readFileSync(resolve(COMMANDS_SOURCE, file), 'utf-8'), 'utf-8');
          }
        }
        console.log(`     ${c.green}✅ Synced to ${agent.commandsPath}/ (${agent.name})${c.reset}`);
        configured++;
      }
    }
  }

  console.log('');

  // ── Step 5: Agent Configs ──────────────────────────────────────────

  console.log(`  ${c.bold}Step 5/7: Agent Configs${c.reset}`);

  const agentConfigs = [
    { file: 'AGENTS.md',  label: 'Agent Instructions' },
    { file: 'CLAUDE.md',  label: 'Claude Code' },
    { file: '.cursor/rules/cdd.mdc', label: 'Cursor' },
    { file: '.github/copilot-instructions.md', label: 'GitHub Copilot' },
  ];

  let missingConfigs = [];
  for (const cfg of agentConfigs) {
    const fullPath = resolve(projectDir, cfg.file);
    if (existsSync(fullPath)) {
      console.log(`  ${c.green}✅${c.reset} ${cfg.file} ${c.dim}(${cfg.label})${c.reset}`);
      alreadyGood++;
    } else {
      // AGENTS.md is handled in step 2, skip it here
      if (cfg.file !== 'AGENTS.md') {
        console.log(`  ${c.dim}──${c.reset}  ${cfg.file} ${c.dim}(${cfg.label} — not generated)${c.reset}`);
        missingConfigs.push(cfg);
      }
    }
  }

  if (missingConfigs.length > 0) {
    console.log(`  ${c.dim}   Run ${c.cyan}docguard agents${c.dim} to generate agent-specific configs${c.reset}`);
  }

  console.log('');

  // ── Step 6: Integrations ───────────────────────────────────────────

  console.log(`  ${c.bold}Step 6/7: Integrations${c.reset}`);

  // Check spec-kit framework (Extension-First: detect .specify/ directory)
  const specKitInitialized = isSpecKitInitialized(projectDir);
  const specifyDir = resolve(projectDir, '.specify');
  if (specKitInitialized) {
    const agent = getDetectedAgent(projectDir);
    console.log(`  ${c.green}✅${c.reset} spec-kit ${c.dim}(SDD configured${agent ? `, agent: ${agent}` : ''})${c.reset}`);
    alreadyGood++;
  } else if (existsSync(specifyDir)) {
    console.log(`  ${c.yellow}⚠️${c.reset}  spec-kit ${c.dim}(.specify/ exists but not fully initialized)${c.reset}`);
    console.log(`  ${c.dim}     Run: ${c.cyan}specify init --here --force --ai-skills${c.reset}`);
  } else {
    console.log(`  ${c.dim}──${c.reset}  spec-kit ${c.dim}(not configured — recommended for full SDD+CDD workflow)${c.reset}`);
    console.log(`  ${c.dim}     Install: ${c.cyan}uv tool install specify-cli --from git+https://github.com/github/spec-kit.git${c.reset}`);
    console.log(`  ${c.dim}     Then: ${c.cyan}docguard init${c.reset} ${c.dim}(will auto-run specify init)${c.reset}`);
  }

  // Check for spec-kit extensions
  const extensionsDir = resolve(projectDir, 'extensions');
  
  // DocGuard extension (this project IS DocGuard, so check if extension is bundled)
  const docguardExt = resolve(extensionsDir, 'spec-kit-docguard', 'extension.yml');
  if (existsSync(docguardExt)) {
    console.log(`  ${c.green}✅${c.reset} docguard extension ${c.dim}(spec-kit CDD enforcement)${c.reset}`);
    alreadyGood++;
  } else {
    // DocGuard is installed as a CLI, not necessarily as a spec-kit extension
    console.log(`  ${c.green}✅${c.reset} docguard CLI ${c.dim}(standalone — 19 validators + 31 quality metrics)${c.reset}`);
    alreadyGood++;
  }

  // Understanding extension (spec-kit community extension)
  const understandingExt = resolve(extensionsDir, 'spec-kit-understanding', 'extension.yml');
  if (existsSync(understandingExt)) {
    console.log(`  ${c.green}✅${c.reset} understanding ${c.dim}(spec-kit deep doc analysis)${c.reset}`);
    alreadyGood++;
  } else {
    console.log(`  ${c.dim}──${c.reset}  understanding ${c.dim}(spec-kit extension — optional)${c.reset}`);
    console.log(`  ${c.dim}     Install via spec-kit: ${c.cyan}https://github.com/github/spec-kit/tree/main/extensions${c.reset}`);
  }

  console.log('');

  // ── Step 7: Git Hooks ──────────────────────────────────────────────

  console.log(`  ${c.bold}Step 7/7: Git Hooks${c.reset}`);

  const gitDir = resolve(projectDir, '.git');
  if (!existsSync(gitDir)) {
    console.log(`  ${c.dim}──${c.reset}  No .git directory ${c.dim}(not a git repo)${c.reset}`);
  } else {
    const preCommitHook = resolve(gitDir, 'hooks', 'pre-commit');
    let hasDocguardHook = false;

    if (existsSync(preCommitHook)) {
      const content = readFileSync(preCommitHook, 'utf-8');
      hasDocguardHook = content.includes('docguard');
    }

    if (hasDocguardHook) {
      console.log(`  ${c.green}✅${c.reset} pre-commit hook ${c.dim}(docguard guard)${c.reset}`);
      alreadyGood++;
    } else {
      console.log(`  ${c.dim}──${c.reset}  pre-commit hook ${c.dim}(not installed)${c.reset}`);
      if (interactive) {
        const install = await askYesNo(`     → Install docguard guard as pre-commit hook?`, false);
        if (install) {
          try {
            const hooksDir = resolve(gitDir, 'hooks');
            if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

            const hookContent = existsSync(preCommitHook)
              ? readFileSync(preCommitHook, 'utf-8') + '\n\n# DocGuard CDD validation\nnpx docguard-cli guard --fail-on-warning\n'
              : '#!/bin/sh\n\n# DocGuard CDD validation\nnpx docguard-cli guard --fail-on-warning\n';

            writeFileSync(preCommitHook, hookContent, { mode: 0o755 });
            console.log(`     ${c.green}✅ Pre-commit hook installed${c.reset}`);
            configured++;
          } catch (e) {
            console.log(`     ${c.yellow}⚠️  Failed to install hook: ${e.message}${c.reset}`);
          }
        }
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────

  console.log(`\n  ${c.bold}─────────────────────────────────────${c.reset}`);

  if (configured > 0) {
    console.log(`  ${c.green}✅ Setup complete!${c.reset} ${configured} item(s) configured, ${alreadyGood} already good.`);
  } else if (alreadyGood > 0) {
    console.log(`  ${c.green}✅ Everything is set up!${c.reset} ${alreadyGood} item(s) verified.`);
  } else {
    console.log(`  ${c.dim}No changes made.${c.reset}`);
  }

  const agentMode = detectAgentMode(projectDir);
  console.log(`\n  ${c.bold}Next steps:${c.reset} ${c.dim}(${agentMode === 'llm' ? 'LLM mode' : 'CLI mode'})${c.reset}`);
  if (agentMode === 'llm') {
    if (!isSpecKitInitialized(projectDir)) {
      console.log(`  ${c.dim}Bootstrap:${c.reset}      ${c.cyan}/speckit.constitution${c.reset}`);
    }
    console.log(`  ${c.dim}Fill docs:${c.reset}      ${c.cyan}/docguard.guard${c.reset}`);
    console.log(`  ${c.dim}Fix issues:${c.reset}     ${c.cyan}/docguard.fix${c.reset}`);
    console.log(`  ${c.dim}Review:${c.reset}         ${c.cyan}/docguard.review${c.reset}`);
  } else {
    console.log(`  ${c.dim}Fill docs:${c.reset}      ${c.cyan}docguard diagnose${c.reset}`);
    console.log(`  ${c.dim}Validate:${c.reset}       ${c.cyan}docguard guard${c.reset}`);
    console.log(`  ${c.dim}Check score:${c.reset}    ${c.cyan}docguard score${c.reset}`);
  }
  console.log('');
}
