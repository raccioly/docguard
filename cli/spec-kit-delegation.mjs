/**
 * Spec Kit delegation — the single place DocGuard talks to the `specify` CLI.
 *
 * Spec: specs/014-specify-init-delegation (docguard.specify-init-delegation).
 * Contract: specs/014-specify-init-delegation/contracts/specify-cli.md.
 *
 * @implements docguard.specify-init-delegation#FR-001
 * @implements docguard.specify-init-delegation#FR-002
 * @implements docguard.specify-init-delegation#FR-003
 * @implements docguard.specify-init-delegation#FR-004
 * @implements docguard.specify-init-delegation#FR-005
 * @implements docguard.specify-init-delegation#FR-007
 * @implements docguard.specify-init-delegation#FR-010
 * @implements docguard.specify-init-delegation#FR-012
 * @implements docguard.spec-kit-integration-honesty#FR-001
 * @implements docguard.spec-kit-integration-honesty#FR-002
 * @implements docguard.spec-kit-integration-honesty#FR-003
 * @implements docguard.spec-kit-integration-honesty#FR-008
 *
 * Spec Kit 0.10.0 removed `--ai`, `--ai-skills`, `--ai-commands-dir` and
 * `--no-git` in favour of `--integration <key>`. DocGuard kept passing the old
 * options and discarded the resulting error, so every adopter on a current
 * Spec Kit was told nothing (or told it worked). Everything here returns a
 * structured result; callers render it and never print success for a failed
 * step. Capability is read from `specify init --help` rather than a version
 * table, which would drift the same way the flags did.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeSpawnSpecify, isSpecKitAvailable, isSpecKitInitialized, getDetectedAgent, detectAIAgent } from './ensure-skills.mjs';
import { readAgentSurface, readExtensionCommands, safeProjectPath, verifyHooks } from './agent-surface.mjs';
import { compareVersions } from './shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** DocGuard's own Spec Kit extension, shipped inside the npm package. */
export const PACKAGED_EXTENSION_DIR = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard');

function readPackagedManifest(extensionDir = PACKAGED_EXTENSION_DIR) {
  try { return readFileSync(resolve(extensionDir, 'extension.yml'), 'utf-8'); } catch { return ''; }
}

/**
 * The one Spec Kit floor (docguard.spec-kit-integration-honesty#FR-008): the
 * manifest's `requires.speckit_version`, which Spec Kit enforces when the
 * extension is registered. Initializing Spec Kit on an older CLI and then
 * failing registration left a half-integrated project, so `init` checks it
 * before either step.
 */
export const MIN_SPEC_KIT_VERSION =
  readPackagedManifest().match(/^\s+speckit_version:\s*"?>=\s*(\d+\.\d+\.\d+)"?/m)?.[1] || '0.11.2';

/** The version of the extension shipped with this CLI. */
export function packagedExtensionVersion(extensionDir = PACKAGED_EXTENSION_DIR) {
  return readPackagedManifest(extensionDir).match(/^extension:\n(?:\s{2}.*\n)*?\s{2}version:\s*"?([^"\n]+)"?/m)?.[1] || null;
}

export const SPEC_KIT_UPGRADE_HINT =
  'specify self upgrade   (older CLIs: uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git)';

const GENERIC_COMMANDS_DIR = '.agent/commands/';
const REMOVED_OPTIONS = new Set(['--ai', '--ai-skills', '--ai-commands-dir', '--no-git']);
const VALID_INTEGRATION = /^[a-zA-Z0-9_-]{1,32}$/;
const REASON_MAX = 400;

function timeoutMs(fallback) {
  const fromEnv = Number(process.env.DOCGUARD_SPECIFY_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback;
}

function stripAnsi(s) {
  return String(s).replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/** Bounded, ANSI-free excerpt of a failed spawn: stderr, then stdout, then the error message. */
export function failureReason(err) {
  if (err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM') {
    return 'specify timed out';
  }
  const raw = [err?.stderr, err?.stdout, err?.message]
    .map(v => (v == null ? '' : stripAnsi(v.toString()).trim()))
    .find(Boolean) || 'specify exited with an error';
  const oneLine = raw.replace(/[╭╮╰╯│─]+/g, ' ').replace(/\s+/g, ' ').trim();
  return oneLine.length > REASON_MAX ? `${oneLine.slice(0, REASON_MAX - 1)}…` : oneLine;
}

/** `specify --version` → `X.Y.Z`, or null when the CLI does not answer in that form. */
export function readSpecKitVersion(projectDir) {
  try {
    const out = safeSpawnSpecify(['--version'], {
      cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(15000),
      env: { ...process.env, NO_COLOR: '1' },
    });
    return stripAnsi(out).match(/\b(\d+\.\d+\.\d+)\b/)?.[1] || null;
  } catch {
    return null;
  }
}

function belowFloorReason(version) {
  return `specify ${version} is older than the Spec Kit ${MIN_SPEC_KIT_VERSION} DocGuard's extension requires`;
}

/**
 * Read which `init` options the installed CLI documents, and its version.
 * An unparseable version leaves the decision to the capability check, which
 * does not drift with Spec Kit's release numbering.
 * @returns {{ available: boolean, supported: boolean, flags: Set<string>, error: string|null,
 *             version: string|null, belowFloor: boolean }}
 */
export function readSpecKitCapabilities(projectDir) {
  if (!isSpecKitAvailable()) {
    return { available: false, supported: false, flags: new Set(), error: null, version: null, belowFloor: false };
  }
  const version = readSpecKitVersion(projectDir);
  const belowFloor = Boolean(version) && compareVersions(version, MIN_SPEC_KIT_VERSION) < 0;
  try {
    const help = safeSpawnSpecify(['init', '--help'], {
      cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(15000),
      env: { ...process.env, NO_COLOR: '1', COLUMNS: '200' },
    });
    const flags = new Set(stripAnsi(help).match(/--[a-z][a-z-]*/g) || []);
    return {
      available: true,
      supported: flags.has('--integration') && !belowFloor,
      flags,
      error: belowFloor ? belowFloorReason(version) : null,
      version,
      belowFloor,
    };
  } catch (err) {
    return { available: true, supported: false, flags: new Set(), error: failureReason(err), version, belowFloor };
  }
}

/**
 * Choose the Spec Kit integration key: recorded state first, then an
 * unambiguous filesystem signal, then `generic`.
 * @returns {{ key: string, source: 'recorded'|'signal'|'default' }}
 */
export function resolveIntegration(projectDir) {
  const recorded = getDetectedAgent(projectDir);
  if (recorded) return { key: recorded, source: 'recorded' };
  const signalled = detectAIAgent(projectDir);
  if (signalled && VALID_INTEGRATION.test(signalled)) return { key: signalled, source: 'signal' };
  return { key: 'generic', source: 'default' };
}

/** Argument array for `specify init`, restricted to options the CLI documents. */
export function buildInitArgs(capabilities, integrationKey, platform = process.platform) {
  if (!VALID_INTEGRATION.test(integrationKey)) {
    throw new Error(`refusing integration key outside the allowlist: ${JSON.stringify(integrationKey)}`);
  }
  const has = flag => capabilities.flags.has(flag);
  const args = ['init', '--here', '--force', '--integration', integrationKey];
  if (integrationKey === 'generic' && has('--integration-options')) {
    args.push('--integration-options', `--commands-dir ${GENERIC_COMMANDS_DIR}`);
  }
  if (has('--non-interactive')) args.push('--non-interactive');
  if (has('--ignore-agent-tools')) args.push('--ignore-agent-tools');
  if (has('--script')) args.push('--script', platform === 'win32' ? 'ps' : 'sh');
  for (const arg of args) {
    if (REMOVED_OPTIONS.has(arg)) throw new Error(`removed Spec Kit option in argv: ${arg}`);
  }
  return args;
}

function renderCommand(args) {
  return ['specify', ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
}

/** DocGuard's entry in `.specify/extensions/.registry`, or null. */
export function readRegistryEntry(projectDir) {
  const registry = resolve(projectDir, '.specify', 'extensions', '.registry');
  if (!existsSync(registry)) return null;
  try {
    const entry = JSON.parse(readFileSync(registry, 'utf-8'))?.extensions?.docguard;
    return entry && typeof entry === 'object' ? entry : null;
  } catch {
    return null;
  }
}

/** True when `.specify/extensions/.registry` already lists DocGuard. */
export function isDocGuardRegistered(projectDir) {
  return readRegistryEntry(projectDir) !== null;
}

/**
 * Register DocGuard's packaged extension with Spec Kit (offline, version-matched).
 *
 * A registration at another version is replaced (`--force`), keeping its
 * recorded priority: the README promises the registered version matches the
 * CLI, and "already registered" used to hide a stale one indefinitely. A
 * disabled registration is the user's choice and is left alone.
 *
 * @returns {{ status: 'registered'|'refreshed'|'already-registered'|'disabled'|'failed'|'not-attempted',
 *             reason: string|null, manualCommand: string|null, from?: string, to?: string }}
 */
export function registerDocGuardExtension(projectDir, { extensionDir = PACKAGED_EXTENSION_DIR } = {}) {
  const entry = readRegistryEntry(projectDir);
  const packaged = packagedExtensionVersion(extensionDir);
  if (entry && entry.enabled === false) {
    return { status: 'disabled', reason: null, manualCommand: 'specify extension enable docguard', from: entry.version || null, to: packaged };
  }
  const stale = entry && typeof entry.version === 'string' && packaged && entry.version !== packaged;
  if (entry && !stale) {
    return { status: 'already-registered', reason: null, manualCommand: null };
  }
  const args = ['extension', 'add', extensionDir, '--dev'];
  if (stale) {
    args.push('--force');
    if (Number.isInteger(entry.priority)) args.push('--priority', String(entry.priority));
  }
  const manualCommand = renderCommand(args);
  if (!existsSync(resolve(extensionDir, 'extension.yml'))) {
    return { status: 'failed', reason: `packaged extension not found at ${extensionDir}`, manualCommand };
  }
  try {
    safeSpawnSpecify(args, { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(60000) });
    return stale
      ? { status: 'refreshed', reason: null, manualCommand: null, from: entry.version, to: packaged }
      : { status: 'registered', reason: null, manualCommand: null };
  } catch (err) {
    return { status: 'failed', reason: failureReason(err), manualCommand };
  }
}

/** Spec Kit's skill frontmatter for an extension command (generic `--skills` layout). */
function renderSkillCommand(name, source) {
  const fm = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const description = fm?.[1].match(/^description:\s*(.*)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') || '';
  const body = fm ? source.slice(fm[0].length) : source;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\ncompatibility: Requires spec-kit project structure with .specify/ directory\nmetadata:\n  author: docguard\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/**
 * Spec Kit registers no extension command for the `generic` integration
 * (`registered_commands: {}`), so the mandatory hooks it records pointed at
 * commands that existed nowhere. Write each declared command next to the
 * generic integration's own commands, in its layout.
 *
 * @implements docguard.spec-kit-integration-honesty#FR-001
 * @returns {{ written: string[], skipped: string|null }}
 */
export function installGenericExtensionCommands(projectDir, { extensionDir = PACKAGED_EXTENSION_DIR, surface = readAgentSurface(projectDir) } = {}) {
  const layout = surface.layout;
  if (!surface.writesExtensionCommands || !layout) return { written: [], skipped: null };
  if (!safeProjectPath(projectDir, layout.dir)) {
    return { written: [], skipped: `the generic commands directory ${JSON.stringify(layout.dir)} is outside the project` };
  }
  const written = [];
  for (const { id, file } of readExtensionCommands(resolve(extensionDir, 'extension.yml'))) {
    const dest = safeProjectPath(projectDir, layout.pathFor(id));
    const src = resolve(extensionDir, file);
    if (!dest || !existsSync(src)) continue;
    const source = readFileSync(src, 'utf-8');
    const content = layout.style === 'skills' ? renderSkillCommand(layout.invocation(id).replace(/^\W+/, ''), source) : source;
    const full = resolve(projectDir, dest);
    if (existsSync(full) && readFileSync(full, 'utf-8') === content) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
    written.push(dest);
  }
  return { written, skipped: null };
}

/**
 * Register (or refresh) the extension, write what the generic integration
 * lacks, then check every mandatory hook resolves. Shared by `init` and
 * `upgrade --apply` (docguard.spec-kit-integration-honesty#FR-004).
 */
export function refreshSpecKitExtension(projectDir, capabilities = readSpecKitCapabilities(projectDir)) {
  const notAttempted = { status: 'not-attempted', reason: null, manualCommand: null };
  let extension = notAttempted;
  if (capabilities.available && capabilities.belowFloor) {
    extension = { status: 'unsupported-version', reason: belowFloorReason(capabilities.version), manualCommand: SPEC_KIT_UPGRADE_HINT };
  } else if (capabilities.available) {
    extension = registerDocGuardExtension(projectDir);
  }
  if (!isDocGuardRegistered(projectDir)) {
    return { extension, commands: { written: [], skipped: null }, hooks: null };
  }
  const commands = installGenericExtensionCommands(projectDir);
  return { extension, commands, hooks: verifyHooks(projectDir) };
}

/**
 * Initialize Spec Kit for this project. Only `docguard init` may call this —
 * other commands must never scaffold a repository behind the user's back.
 *
 * @returns {{ status: 'initialized'|'already-initialized'|'skipped'|'unavailable'|'unsupported-version'|'failed',
 *             integration: {key: string, source: string}|null, reason: string|null, manualCommand: string|null,
 *             extension: {status: string, reason: string|null, manualCommand: string|null},
 *             commands?: {written: string[], skipped: string|null}, hooks?: object|null }}
 */
export function delegateSpecKitInit(projectDir, { skip = false } = {}) {
  const notAttempted = { status: 'not-attempted', reason: null, manualCommand: null };
  if (skip) {
    return { status: 'skipped', integration: null, reason: null, manualCommand: null, extension: notAttempted };
  }

  const capabilities = readSpecKitCapabilities(projectDir);

  if (isSpecKitInitialized(projectDir)) {
    const integration = resolveIntegration(projectDir);
    return { status: 'already-initialized', integration, reason: null, manualCommand: null, ...refreshSpecKitExtension(projectDir, capabilities) };
  }

  if (!capabilities.available) {
    return { status: 'unavailable', integration: null, reason: null, manualCommand: null, extension: notAttempted };
  }

  const integration = resolveIntegration(projectDir);
  if (!capabilities.supported) {
    return {
      status: 'unsupported-version',
      integration,
      reason: capabilities.error
        || `the installed specify CLI predates the integration model; DocGuard requires Spec Kit >= ${MIN_SPEC_KIT_VERSION}`,
      version: capabilities.version,
      manualCommand: SPEC_KIT_UPGRADE_HINT,
      extension: notAttempted,
    };
  }

  const args = buildInitArgs(capabilities, integration.key);
  const manualCommand = renderCommand(args);
  try {
    safeSpawnSpecify(args, { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(60000) });
  } catch (err) {
    return { status: 'failed', integration, reason: failureReason(err), manualCommand, extension: notAttempted };
  }
  if (!isSpecKitInitialized(projectDir)) {
    return {
      status: 'failed',
      integration,
      reason: 'specify exited successfully but wrote no .specify/ state',
      manualCommand,
      extension: notAttempted,
    };
  }
  return { status: 'initialized', integration, reason: null, manualCommand: null, ...refreshSpecKitExtension(projectDir, capabilities) };
}
