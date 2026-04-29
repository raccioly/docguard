/**
 * Ensure Skills — Silent auto-check for DocGuard AI skills and commands
 *
 * Called before every command execution. If skills or commands are missing,
 * copies them from the package's bundled assets into the project directory.
 *
 * Also provides agent mode detection (LLM vs CLI) and spec-kit availability.
 *
 * Zero npm dependencies — pure Node.js built-ins only.
 * Framework dependency: spec-kit (convention, not code).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { c } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source locations in the npm package
const SKILLS_SOURCE = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard', 'skills');
const COMMANDS_SOURCE = resolve(__dirname, '..', 'commands');

// Destination in the user's project
const SKILLS_DEST = '.agent/skills';
const COMMANDS_DEST = 'commands';

// ── Agent Mode Detection ────────────────────────────────────────────────

/**
 * Detect if user is in LLM mode (AI agent) or CLI mode (terminal).
 * DocGuard is LLM-first — defaults to 'llm' when any agent signal detected.
 *
 * @param {string} projectDir - The project root directory
 * @returns {'llm' | 'cli'}
 */
export function detectAgentMode(projectDir) {
  // First check .specify/init-options.json for explicit AI agent selection
  const initOptions = resolve(projectDir, '.specify', 'init-options.json');
  if (existsSync(initOptions)) {
    try {
      const opts = JSON.parse(readFileSync(initOptions, 'utf-8'));
      if (opts.ai) return 'llm'; // spec-kit was initialized with an AI agent
    } catch { /* ignore */ }
  }

  // Check for LLM signal directories/files
  const llmSignals = [
    '.agent/skills',
    '.cursor',
    '.claude',
    '.specify',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    '.gemini',
    '.agents',
  ];

  for (const signal of llmSignals) {
    if (existsSync(resolve(projectDir, signal))) return 'llm';
  }

  return 'cli';
}

/**
 * Get the detected AI agent name from spec-kit init options.
 * Returns null if spec-kit hasn't been initialized.
 *
 * @param {string} projectDir - The project root directory
 * @returns {string | null}
 */
export function getDetectedAgent(projectDir) {
  const initOptions = resolve(projectDir, '.specify', 'init-options.json');
  if (existsSync(initOptions)) {
    try {
      const opts = JSON.parse(readFileSync(initOptions, 'utf-8'));
      return opts.ai || null;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Detect which AI agent is in use, returning the spec-kit --ai flag value.
 * Matches spec-kit's supported agents: agy, claude, copilot, cursor-agent,
 * gemini, windsurf, codex, roo, etc.
 *
 * Priority: .specify/init-options.json > filesystem signals > null
 *
 * @param {string} projectDir - The project root directory
 * @returns {string | null} - spec-kit --ai flag value, or null if unknown
 */
export function detectAIAgent(projectDir) {
  // 1. Check spec-kit init options (already initialized — trust it)
  const existing = getDetectedAgent(projectDir);
  if (existing) return existing;

  // 2. Map filesystem signals to spec-kit agent IDs
  // Order matters: more specific signals first
  const agentSignals = [
    { signal: '.cursor',                        agent: 'cursor-agent' },
    { signal: '.claude',                        agent: 'claude' },
    { signal: 'CLAUDE.md',                      agent: 'claude' },
    { signal: '.gemini',                        agent: 'gemini' },
    { signal: '.agents',                        agent: 'agy' },         // Antigravity
    { signal: '.github/copilot-instructions.md', agent: 'copilot' },
    { signal: '.windsurf',                      agent: 'windsurf' },
    { signal: '.codex',                         agent: 'codex' },
    { signal: '.roo',                           agent: 'roo' },
    { signal: '.amp',                           agent: 'amp' },
    { signal: '.kiro',                          agent: 'kiro-cli' },
    { signal: '.tabnine',                       agent: 'tabnine' },
  ];

  for (const { signal, agent } of agentSignals) {
    if (existsSync(resolve(projectDir, signal))) return agent;
  }

  // 3. No signal found — return null (caller decides: interactive vs generic)
  return null;
}

/**
 * Check if the specify CLI (spec-kit) is available on PATH.
 *
 * @returns {boolean}
 */
export function isSpecKitAvailable() {
  try {
    const cmd = process.platform === 'win32' ? 'where specify' : 'which specify';
    execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if spec-kit has been initialized in this project.
 *
 * @param {string} projectDir - The project root directory
 * @returns {boolean}
 */
export function isSpecKitInitialized(projectDir) {
  return existsSync(resolve(projectDir, '.specify', 'init-options.json'));
}

// ── Spec-Kit Integration Gate ───────────────────────────────────────────

// Read DocGuard package version (for skill auto-update)
const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

const SPEC_KIT_INSTALL_CMD = 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git';

/**
 * Ensure spec-kit is initialized in the project.
 * Called on every command run — this is the persistent nudge.
 *
 * - If .specify/ exists → do nothing
 * - If specify CLI available → auto-run specify init with detected agent
 * - If specify CLI not available → show prominent install reminder (every time)
 *
 * @param {string} projectDir - The project root directory
 * @param {object} flags - CLI flags
 * @returns {{ specKitReady: boolean }}
 */
export function ensureSpecKit(projectDir, flags = {}) {
  const silent = flags.format === 'json';

  // Already initialized — nothing to do
  if (isSpecKitInitialized(projectDir)) {
    return { specKitReady: true };
  }

  // Spec-kit CLI available — auto-initialize
  if (isSpecKitAvailable()) {
    if (!silent) {
      console.log(`  ${c.cyan}🌱 Spec Kit detected — auto-initializing SDD workflow...${c.reset}`);
    }
    try {
      const detectedAgent = detectAIAgent(projectDir);
      const args = ['init', '--here', '--force', '--ai', detectedAgent || 'generic'];
      if (!detectedAgent) {
        args.push('--ai-commands-dir', '.agent/commands/');
      }
      args.push('--ai-skills', '--ignore-agent-tools', '--no-git', '--script', process.platform === 'win32' ? 'ps' : 'sh');

      try {
        execFileSync('specify', args, { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
      } catch (err) {
        if (process.platform === 'win32' && err.code === 'ENOENT') {
          execFileSync('specify.cmd', args, { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
        } else {
          throw err;
        }
      }
      if (!silent) {
        console.log(`  ${c.green}✅ Spec Kit initialized${c.reset} ${c.dim}(agent: ${detectedAgent || 'generic'}, 9 skills installed)${c.reset}\n`);
      }
      return { specKitReady: true };
    } catch {
      // Failed silently — will show reminder instead
    }
  }

  // No specify CLI — show prominent reminder (every time, no dismiss)
  if (!silent) {
    console.log(`  ${c.yellow}┌─────────────────────────────────────────────────────────┐${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  ${c.bold}💡 Spec Kit not installed${c.reset}                                ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}                                                          ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  DocGuard is a Spec Kit extension. Install Spec Kit      ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  for the full experience: 13 AI skills, SDD workflow,    ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  project constitution, and seamless agent integration.   ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}                                                          ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  ${c.cyan}${SPEC_KIT_INSTALL_CMD}${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}                                                          ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}│${c.reset}  ${c.dim}Then run: ${c.cyan}docguard init${c.reset}                                ${c.yellow}│${c.reset}`);
    console.log(`  ${c.yellow}└─────────────────────────────────────────────────────────┘${c.reset}\n`);
  }

  return { specKitReady: false };
}

// ── Skill Installation ──────────────────────────────────────────────────

/**
 * Silently ensure DocGuard skills and commands are installed in the project.
 * Also checks spec-kit integration and auto-updates stale skills.
 *
 * @param {string} projectDir - The project root directory
 * @param {object} flags - CLI flags (format, etc.)
 * @returns {{ skillsInstalled: boolean, commandsInstalled: boolean, specKitReady: boolean }}
 */
export function ensureSkills(projectDir, flags = {}) {
  const result = { skillsInstalled: false, commandsInstalled: false, specKitReady: false };
  const silent = flags.format === 'json';

  // ── Spec-Kit Gate (runs on every command) ─────────────────────────────
  const specKitResult = ensureSpecKit(projectDir, flags);
  result.specKitReady = specKitResult.specKitReady;

  // ── DocGuard Skills (install + auto-update) ───────────────────────────
  if (existsSync(SKILLS_SOURCE)) {
    try {
      const skillDirs = readdirSync(SKILLS_SOURCE).filter(d =>
        d.startsWith('docguard-') && existsSync(resolve(SKILLS_SOURCE, d, 'SKILL.md'))
      );

      for (const skillDir of skillDirs) {
        const destDir = resolve(projectDir, SKILLS_DEST, skillDir);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        const srcSkill = resolve(SKILLS_SOURCE, skillDir, 'SKILL.md');
        const destSkill = resolve(destDir, 'SKILL.md');

        if (!existsSync(destSkill)) {
          // New install
          writeFileSync(destSkill, readFileSync(srcSkill, 'utf-8'), 'utf-8');
          result.skillsInstalled = true;
        } else {
          // Auto-update: check if package version is newer than installed
          const installedContent = readFileSync(destSkill, 'utf-8');
          const versionMatch = installedContent.match(/docguard:version:\s*(\S+)/);
          const installedVersion = versionMatch ? versionMatch[1] : '0.0.0';

          if (installedVersion !== PKG_VERSION) {
            writeFileSync(destSkill, readFileSync(srcSkill, 'utf-8'), 'utf-8');
            result.skillsInstalled = true;
          }
        }
      }

      if (result.skillsInstalled && !silent) {
        console.log(`  ${c.cyan}✨ DocGuard AI skills installed/updated → ${SKILLS_DEST}/${c.reset}`);
      }
    } catch {
      // Silent failure — skills are optional enhancement
    }
  }

  // ── Slash Commands ────────────────────────────────────────────────────
  const commandsCheck = resolve(projectDir, COMMANDS_DEST, 'docguard.guard.md');
  if (!existsSync(commandsCheck) && existsSync(COMMANDS_SOURCE)) {
    try {
      const commandFiles = readdirSync(COMMANDS_SOURCE).filter(f => f.endsWith('.md'));

      if (commandFiles.length > 0) {
        const destDir = resolve(projectDir, COMMANDS_DEST);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }

        for (const file of commandFiles) {
          const destPath = resolve(destDir, file);
          if (!existsSync(destPath)) {
            writeFileSync(destPath, readFileSync(resolve(COMMANDS_SOURCE, file), 'utf-8'), 'utf-8');
          }
        }

        result.commandsInstalled = true;
        if (!silent) {
          console.log(`  ${c.cyan}✨ DocGuard slash commands installed → ${COMMANDS_DEST}/${c.reset}`);
        }
      }
    } catch {
      // Silent failure — commands are optional enhancement
    }
  }

  return result;
}

