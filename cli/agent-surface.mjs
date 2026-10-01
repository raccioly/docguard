/**
 * Agent surface — what the project's coding agent can actually run.
 *
 * Spec: specs/048-spec-kit-integration-honesty (docguard.spec-kit-integration-honesty).
 *
 * @implements docguard.spec-kit-integration-honesty#FR-002
 * @implements docguard.spec-kit-integration-honesty#FR-006
 * @implements docguard.spec-kit-integration-honesty#FR-009
 *
 * DocGuard used to print `/docguard.<name>` for any command and claim
 * "workflow hooks active" without looking. Spec Kit supports 40+ agents with
 * five file shapes, so a per-agent table would drift the way the removed
 * `--ai` flags did. Instead the layout is read from Spec Kit's own install
 * manifest (`.specify/integrations/<key>.manifest.json`): the file it wrote for
 * the `constitution` command shows the directory, the shape and the separator,
 * and every other command follows the same pattern. A command is only ever
 * suggested when its file exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDetectedAgent, detectAIAgent } from './ensure-skills.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGED_MANIFEST = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard', 'extension.yml');

const VALID_KEY = /^[a-zA-Z0-9_-]{1,32}$/;
const CONSTITUTION_FILE = /(^|\/)speckit([.-])constitution(\/SKILL\.md|\.[a-z][a-z.]*)$/;

// Invocation prefixes, mirrored from Spec Kit 1.0.13 `_invocation_style.py`:
// these agents run skills as `$speckit-<name>` or `/skill:speckit-<name>`.
const DOLLAR_SKILL_AGENTS = new Set(['codex', 'zcode', 'command-code']);
const SKILL_COLON_AGENTS = new Set(['kimi']);

// Skills directories for agents detected by a filesystem signal alone, before
// Spec Kit has written a manifest (Spec Kit 1.0.13 integration folders). An
// agent missing here falls back to DocGuard's `.agent/` convention.
const SIGNAL_SKILL_DIRS = {
  claude: '.claude/skills',
  'cursor-agent': '.cursor/skills',
  codex: '.agents/skills',
  agy: '.agents/skills',
};

const FALLBACK_SKILLS_DIR = '.agent/skills';
const FALLBACK_COMMANDS_DIR = '.agent/commands';

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A repository-relative path that stays inside the project, normalized to `/` without a trailing slash. */
export function safeProjectPath(projectDir, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim() || relPath.includes('\0')) return null;
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) return null;
  const parts = relPath.split(/[\\/]+/).filter(p => p && p !== '.');
  if (parts.length === 0 || parts.includes('..')) return null;
  const root = resolve(projectDir);
  const full = resolve(root, ...parts);
  if (!full.startsWith(root + sep)) return null;
  return parts.join('/');
}

/** The commands DocGuard's Spec Kit extension declares, as `{ id: 'docguard.guard', file: 'commands/guard.md' }`. */
export function readExtensionCommands(manifestPath = PACKAGED_MANIFEST) {
  let source;
  try { source = readFileSync(manifestPath, 'utf-8'); } catch { return []; }
  return [...source.matchAll(/^ {4}- name: "speckit\.(docguard\.[a-z-]+)"\n {6}file: "([^"]+)"/gm)]
    .map(([, id, file]) => ({ id, file }));
}

/**
 * The active integration's command layout, derived from Spec Kit's install
 * manifest, or null when the project has none.
 */
export function readIntegrationLayout(projectDir) {
  const key = getDetectedAgent(projectDir);
  if (!key || !VALID_KEY.test(key)) return null;
  const manifest = readJson(resolve(projectDir, '.specify', 'integrations', `${key}.manifest.json`));
  const files = manifest && manifest.files && typeof manifest.files === 'object' ? Object.keys(manifest.files) : [];
  const template = files
    .map(f => f.replace(/\\/g, '/'))
    .filter(f => CONSTITUTION_FILE.test(f) && safeProjectPath(projectDir, f))
    .sort((a, b) => Number(b.endsWith('/SKILL.md')) - Number(a.endsWith('/SKILL.md')) || a.localeCompare(b))[0];
  if (!template) return null;
  const [, , separator, suffix] = template.match(CONSTITUTION_FILE);
  const style = suffix === '/SKILL.md' ? 'skills' : 'commands';
  const marker = `speckit${separator}constitution`;
  const at = template.lastIndexOf(marker);
  const before = template.slice(0, at);
  const after = template.slice(at + marker.length);
  const dir = before.replace(/\/$/, '');
  let prefix = '/';
  if (style === 'skills' && DOLLAR_SKILL_AGENTS.has(key)) prefix = '$';
  if (style === 'skills' && SKILL_COLON_AGENTS.has(key)) prefix = '/skill:';
  const nameFor = id => `speckit${separator}${String(id).replace(/^speckit\./, '').replace(/\./g, separator)}`;
  return {
    key,
    style,
    separator,
    dir,
    template,
    /** Repository-relative file for a command id such as `constitution` or `docguard.brief`. */
    pathFor: id => `${before}${nameFor(id)}${after}`,
    /** What the user types in the agent to run it. */
    invocation: id => `${prefix}${nameFor(id)}`,
  };
}

/**
 * Where DocGuard's own skills and commands belong for this project, and the
 * Spec Kit command layout when one is recorded.
 *
 * @returns {{ integration: string|null, layout: object|null, skillsDir: string|null,
 *             commandsDir: string|null, writesExtensionCommands: boolean, reason: string|null }}
 */
export function readAgentSurface(projectDir) {
  const recorded = getDetectedAgent(projectDir);
  const integration = recorded || detectAIAgent(projectDir) || null;
  const layout = recorded ? readIntegrationLayout(projectDir) : null;

  if (layout && layout.key === 'generic') {
    // Spec Kit registers no extension command for `generic`, so DocGuard
    // writes them next to the generic integration's own commands.
    // In either generic mode the layout directory is its --commands-dir.
    return {
      integration, layout,
      skillsDir: FALLBACK_SKILLS_DIR,
      commandsDir: safeProjectPath(projectDir, layout.dir) || null,
      writesExtensionCommands: true,
      reason: null,
    };
  }
  if (layout && layout.style === 'skills') {
    return { integration, layout, skillsDir: layout.dir, commandsDir: null, writesExtensionCommands: false, reason: null };
  }
  if (layout) {
    return {
      integration, layout, skillsDir: null, commandsDir: null, writesExtensionCommands: false,
      reason: `the ${layout.key} integration reads commands, not skills; Spec Kit registers DocGuard's commands there`,
    };
  }
  if (integration && SIGNAL_SKILL_DIRS[integration]) {
    return { integration, layout: null, skillsDir: SIGNAL_SKILL_DIRS[integration], commandsDir: null, writesExtensionCommands: false, reason: null };
  }
  if (integration === 'generic') {
    const settings = readJson(resolve(projectDir, '.specify', 'integration.json'))?.integration_settings?.generic;
    const recordedDir = safeProjectPath(projectDir, settings?.parsed_options?.commands_dir);
    return { integration, layout: null, skillsDir: FALLBACK_SKILLS_DIR, commandsDir: recordedDir || FALLBACK_COMMANDS_DIR, writesExtensionCommands: false, reason: null };
  }
  return { integration, layout: null, skillsDir: FALLBACK_SKILLS_DIR, commandsDir: FALLBACK_COMMANDS_DIR, writesExtensionCommands: false, reason: null };
}

/**
 * The agent invocation of a command when its file exists in this project,
 * else null. `name` is a DocGuard CLI command (`guard`, `fix`, …) or, with
 * `{ speckit: true }`, a Spec Kit core command (`constitution`).
 */
export function agentCommand(projectDir, surface, name, args = '', { speckit = false } = {}) {
  const tail = args ? ` ${args}` : '';
  const layout = surface?.layout;
  const id = speckit ? name : `docguard.${name}`;
  if (layout && existsSync(resolve(projectDir, layout.pathFor(id)))) {
    return `${layout.invocation(id)}${tail}`;
  }
  if (!speckit && surface?.commandsDir && existsSync(resolve(projectDir, surface.commandsDir, `docguard.${name}.md`))) {
    return `/docguard.${name}${tail}`;
  }
  return null;
}

/** A command suggestion: the agent invocation when it exists, otherwise the CLI command. */
export function commandHint(projectDir, surface, name, args = '') {
  return agentCommand(projectDir, surface, name, args) || `docguard ${name}${args ? ` ${args}` : ''}`;
}

/**
 * DocGuard's hook entries in `.specify/extensions.yml`, or null when the file
 * is missing or unreadable. Spec Kit writes this file with PyYAML in one fixed
 * shape (see extensions/spec-kit-docguard/templates/extensions.yml), so a line
 * reader is enough and adds no dependency.
 *
 * @returns {Array<{event: string, extension: string|null, command: string|null, enabled: boolean, optional: boolean}>|null}
 */
export function readDocGuardHooks(projectDir) {
  let source;
  try { source = readFileSync(resolve(projectDir, '.specify', 'extensions.yml'), 'utf-8'); } catch { return null; }
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(l => /^hooks:\s*$/.test(l));
  if (start === -1) return [];
  const entries = [];
  let event = null;
  let current = null;
  let fieldIndent = -1;
  const scalar = v => {
    const s = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (s === 'true') return true;
    if (s === 'false') return false;
    return s;
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const ev = line.match(/^ {2}([a-z_]+):\s*$/);
    if (ev) { event = ev[1]; current = null; continue; }
    const item = line.match(/^(\s*)-\s+([a-z_]+):\s*(.*)$/);
    if (item && event) {
      current = { event, extension: null, command: null, enabled: true, optional: true };
      fieldIndent = item[1].length + 2;
      current[item[2]] = scalar(item[3]);
      entries.push(current);
      continue;
    }
    const field = line.match(/^(\s+)([a-z_]+):\s*(.*)$/);
    if (field && current && field[1].length === fieldIndent) current[field[2]] = scalar(field[3]);
  }
  return entries.filter(e => e.extension === 'docguard');
}

/**
 * Resolve every enabled mandatory DocGuard hook to a command file.
 *
 * @returns {{ status: 'active'|'unresolved'|'unverified', resolved: Array, unresolved: Array, reason: string|null }}
 */
export function verifyHooks(projectDir, surface = readAgentSurface(projectDir)) {
  const hooks = readDocGuardHooks(projectDir);
  if (hooks === null) {
    return { status: 'unverified', resolved: [], unresolved: [], reason: '.specify/extensions.yml was not found' };
  }
  const mandatory = hooks.filter(h => h.optional === false && h.enabled !== false && typeof h.command === 'string');
  if (mandatory.length === 0) {
    return { status: 'unresolved', resolved: [], unresolved: [], reason: '.specify/extensions.yml lists no mandatory DocGuard hook' };
  }
  const layout = surface?.layout;
  if (!layout) {
    const key = surface?.integration || 'the active';
    return { status: 'unverified', resolved: [], unresolved: [], reason: `Spec Kit's install manifest for ${key} integration was not found, so the hook command files cannot be located` };
  }
  const resolved = [];
  const unresolved = [];
  for (const hook of mandatory) {
    const path = layout.pathFor(hook.command);
    const entry = { event: hook.event, command: hook.command, path: posix.normalize(path), invocation: layout.invocation(hook.command) };
    (existsSync(resolve(projectDir, path)) ? resolved : unresolved).push(entry);
  }
  return { status: unresolved.length ? 'unresolved' : 'active', resolved, unresolved, reason: null };
}
