/**
 * Ensure Skills — Silent auto-check for DocGuard AI skills and commands
 *
 * Called only by `docguard init` (docguard.read-only-commands#FR-001); no
 * other command installs anything. If skills or commands are missing,
 * copies them from the package's bundled assets into the project directory.
 *
 * Also provides agent mode detection (LLM vs CLI) and spec-kit availability.
 *
 * Zero npm dependencies — pure Node.js built-ins only.
 * Framework dependency: spec-kit (convention, not code).
 *
 * @implements docguard.specify-init-delegation#FR-005
 * @implements docguard.specify-init-delegation#FR-006
 * @implements docguard.specify-init-delegation#FR-008
 * @implements docguard.specify-init-delegation#FR-009
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { c } from './shared.mjs';

/**
 * v0.21.1 (security): cross-platform safe spawn for the `specify` CLI.
 *
 * On POSIX, runs the `specify` binary directly with argv passed as an array
 * — no shell interpolation possible. On Windows, the equivalent is via
 * `cmd.exe /c specify.cmd ...` since `specify` is shipped as a .cmd shim by
 * `pip install`. Args are still passed as an array so cmd.exe doesn't
 * re-parse them.
 *
 * Replaces the pre-v0.21.1 pattern of `execSync(\`specify init ... \${flag} ...\`)`
 * which was shell-interpolated and vulnerable to command injection via
 * `.specify/init-options.json`'s `ai` field (issue #190).
 */
export function safeSpawnSpecify(args, opts) {
  if (!Array.isArray(args)) {
    throw new TypeError('safeSpawnSpecify(args, opts): args must be an array');
  }
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'specify.cmd', ...args], opts);
  }
  return execFileSync('specify', args, opts);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source locations in the npm package
const SKILLS_SOURCE = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard', 'skills');
const COMMANDS_SOURCE = resolve(__dirname, '..', 'commands');

// Destinations depend on the project's agent: see readAgentSurface in
// cli/agent-surface.mjs (docguard.spec-kit-integration-honesty#FR-009).
// `.agent/` remains the convention for the generic integration and for an
// agent DocGuard cannot place.

// ── Agent Mode Detection ────────────────────────────────────────────────

/**
 * Detect if user is in LLM mode (AI agent) or CLI mode (terminal).
 * DocGuard is LLM-first — defaults to 'llm' when any agent signal detected.
 *
 * @param {string} projectDir - The project root directory
 * @returns {'llm' | 'cli'}
 */
export function detectAgentMode(projectDir) {
  // Spec Kit recorded an agent integration — the project is agent-driven.
  if (getDetectedAgent(projectDir)) return 'llm';

  // Check for LLM signal directories/files
  const llmSignals = [
    '.agent/skills',
    '.cursor',
    '.claude',
    '.specify',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.gemini',
    '.agents',
    '.antigravity',
    'ANTIGRAVITY.md',
    '.kiro',
    '.windsurf',
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
// v0.21.1 (security): allowlist for the Spec Kit integration key. Source
// values come from `.specify/*.json`, which is attacker-writable
// in any compromised project. Without this filter, a value like
// `"claude; touch /tmp/pwned;"` would shell-execute on every `docguard init`.
//
// Set conservatively from spec-kit's published agent list. New agents
// require a code change to be accepted — by design.
const VALID_AI_AGENT = /^[a-zA-Z0-9_-]{1,32}$/;

function readSpecifyJson(projectDir, name) {
  const file = resolve(projectDir, '.specify', name);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Spec Kit >= 0.8 records the agent in `.specify/integration.json`
// (`default_integration`); `init-options.json` keeps `integration`/`ai` for
// compatibility. Read the authoritative file first (docguard.specify-init-
// delegation#FR-006). Every candidate passes the allowlist — a value that fails
// is skipped, never forwarded to a subprocess (issue #190).
export function getDetectedAgent(projectDir) {
  const integration = readSpecifyJson(projectDir, 'integration.json');
  const initOptions = readSpecifyJson(projectDir, 'init-options.json');
  const candidates = [
    integration?.default_integration,
    integration?.integration,
    initOptions?.integration,
    initOptions?.ai,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && VALID_AI_AGENT.test(value)) return value;
  }
  return null;
}

/**
 * Detect which AI agent is in use, returning a Spec Kit integration key
 * (`specify init --integration <key>`): claude, codex, copilot, cursor-agent,
 * gemini, kiro-cli, tabnine, … A key the installed CLI no longer knows
 * (windsurf, roo) is still returned: Spec Kit's rejection is reported to the
 * user rather than DocGuard silently substituting another agent.
 *
 * Priority: recorded Spec Kit state > filesystem signals > null
 *
 * @param {string} projectDir - The project root directory
 * @returns {string | null} - integration key, or null if unknown
 */
export function detectAIAgent(projectDir) {
  // 1. Recorded Spec Kit state (already initialized — trust it)
  const existing = getDetectedAgent(projectDir);
  if (existing) return existing;

  // 2. Map filesystem signals to spec-kit agent IDs
  // Order matters: more specific signals first
  const agentSignals = [
    { signal: '.cursor',                        agent: 'cursor-agent' },
    { signal: '.claude',                        agent: 'claude' },
    { signal: 'CLAUDE.md',                      agent: 'claude' },
    { signal: '.gemini',                        agent: 'gemini' },
    // `.agents/` is NOT a signal: Spec Kit's codex, agy, zed and muse
    // integrations all install there, so it identifies no single agent.
    { signal: '.antigravity',                   agent: 'agy' },         // Antigravity (alt convention)
    { signal: 'ANTIGRAVITY.md',                 agent: 'agy' },         // Antigravity rules file
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
  return existsSync(resolve(projectDir, '.specify', 'integration.json'))
    || existsSync(resolve(projectDir, '.specify', 'init-options.json'));
}

// ── Spec-Kit Integration Gate ───────────────────────────────────────────

const SPEC_KIT_INSTALL_CMD = 'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git';

/**
 * Report whether Spec Kit is initialized, with a one-line hint when it is not.
 * Called from ensureSkills, so only during init. It never runs `specify`: scaffolding
 * belongs to `docguard init` (see cli/spec-kit-delegation.mjs).
 *
 * @param {string} projectDir - The project root directory
 * @param {object} flags - CLI flags
 * @returns {{ specKitReady: boolean }}
 */
export function ensureSpecKit(projectDir, flags = {}) {
  if (isSpecKitInitialized(projectDir)) {
    return { specKitReady: true };
  }
  // Only an explicit `docguard init` may scaffold Spec Kit (docguard.specify-
  // init-delegation#FR-009): this gate once ran on every write-capable command,
  // and `specify init --here --force` rewrites a repository. Here we may only
  // point the way — once, on one line, and never in quiet or machine modes.
  const silent = flags.format === 'json' || flags.quiet || flags.noSpecKit || flags.specKitHandled;
  if (!silent) {
    const how = isSpecKitAvailable()
      ? `run ${c.cyan}docguard init${c.reset}${c.dim} to set it up`
      : `install it (${c.cyan}${SPEC_KIT_INSTALL_CMD}${c.reset}${c.dim}), then run ${c.cyan}docguard init${c.reset}`;
    console.log(`  ${c.dim}💡 Spec Kit is not initialized here — ${how}${c.dim}.${c.reset}`);
  }
  return { specKitReady: false, skipped: Boolean(flags.noSpecKit) };
}

// ── Skill Installation ──────────────────────────────────────────────────

/** Bundled files DocGuard installs, as `{ src, dest }` pairs for this project's surface. */
function plannedAssets(surface) {
  if (!surface) throw new TypeError('plannedAssets(surface): pass readAgentSurface(projectDir)');
  const planned = [];
  if (surface.skillsDir && existsSync(SKILLS_SOURCE)) {
    for (const skillDir of readdirSync(SKILLS_SOURCE).sort()) {
      const src = resolve(SKILLS_SOURCE, skillDir, 'SKILL.md');
      if (skillDir.startsWith('docguard-') && existsSync(src)) {
        planned.push({ kind: 'skill', src, dest: `${surface.skillsDir}/${skillDir}/SKILL.md` });
      }
    }
  }
  if (surface.commandsDir && existsSync(COMMANDS_SOURCE)) {
    for (const file of readdirSync(COMMANDS_SOURCE).filter(f => f.endsWith('.md')).sort()) {
      planned.push({ kind: 'command', src: resolve(COMMANDS_SOURCE, file), dest: `${surface.commandsDir}/${file}` });
    }
  }
  return planned;
}

/**
 * Read-only: installed DocGuard skills and commands whose content differs from
 * this CLI's bundled copy. A missing file is not "stale" — `init` installs it.
 *
 * @implements docguard.spec-kit-integration-honesty#FR-004
 * @returns {string[]} repository-relative paths
 */
export function staleAgentAssets(projectDir, surface) {
  return plannedAssets(surface)
    .filter(({ src, dest }) => {
      const full = resolve(projectDir, dest);
      return existsSync(full) && readFileSync(full, 'utf-8') !== readFileSync(src, 'utf-8');
    })
    .map(({ dest }) => dest);
}

/**
 * Install DocGuard's skills and commands where the project's agent reads them
 * (docguard.spec-kit-integration-honesty#FR-009): a skills integration's
 * skills directory, `.agent/` for generic or an unknown agent, and nothing
 * for a commands-style integration Spec Kit already registered DocGuard in.
 * Content-equality gated, so an identical rerun writes nothing (field report,
 * Issue D: a version-marker gate rewrote skills on every command).
 *
 * @implements docguard.spec-kit-integration-honesty#FR-009
 * @implements docguard.spec-kit-integration-honesty#FR-010
 * @returns {{ written: string[], skillsDir: string|null, commandsDir: string|null, reason: string|null }}
 */
export function installAgentAssets(projectDir, surface) {
  const written = [];
  for (const { src, dest } of plannedAssets(surface)) {
    const full = resolve(projectDir, dest);
    const content = readFileSync(src, 'utf-8');
    if (existsSync(full) && readFileSync(full, 'utf-8') === content) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    written.push(dest);
  }
  return { written, skillsDir: surface.skillsDir, commandsDir: surface.commandsDir, reason: surface.reason };
}

/**
 * Install DocGuard's skills and commands for this project. Called only by
 * `docguard init` (docguard.read-only-commands#FR-001) and `upgrade --apply`.
 *
 * @param {string} projectDir - The project root directory
 * @param {object} flags - CLI flags (format, etc.)
 * @param {object} surface - readAgentSurface(projectDir) from cli/agent-surface.mjs (passed in,
 *   because agent-surface reads this module's agent detection)
 * @returns {{ skillsInstalled: boolean, commandsInstalled: boolean, specKitReady: boolean, written: string[] }}
 */
export function ensureSkills(projectDir, flags = {}, surface) {
  const silent = flags.format === 'json';
  const { specKitReady } = ensureSpecKit(projectDir, flags);
  let assets = { written: [], skillsDir: null, commandsDir: null, reason: null };
  try {
    assets = installAgentAssets(projectDir, surface);
  } catch (err) {
    if (!silent) console.log(`  ${c.yellow}⚠️  DocGuard agent files not installed: ${err.message}${c.reset}`);
  }
  const skills = assets.written.filter(p => p.endsWith('/SKILL.md'));
  const commands = assets.written.filter(p => !p.endsWith('/SKILL.md'));
  if (!silent) {
    if (skills.length) console.log(`  ${c.cyan}✨ DocGuard AI skills installed/updated → ${assets.skillsDir}/ (${skills.length} file${skills.length === 1 ? '' : 's'})${c.reset}`);
    if (commands.length) console.log(`  ${c.cyan}✨ DocGuard slash commands installed/updated → ${assets.commandsDir}/ (${commands.length} file${commands.length === 1 ? '' : 's'})${c.reset}`);
    if (assets.reason && !assets.skillsDir && !assets.commandsDir) {
      console.log(`  ${c.dim}DocGuard's own skills are not copied: ${assets.reason}.${c.reset}`);
    }
  }
  return { skillsInstalled: skills.length > 0, commandsInstalled: commands.length > 0, specKitReady, written: assets.written };
}
