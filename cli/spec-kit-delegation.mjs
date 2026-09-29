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
 *
 * Spec Kit 0.10.0 removed `--ai`, `--ai-skills`, `--ai-commands-dir` and
 * `--no-git` in favour of `--integration <key>`. DocGuard kept passing the old
 * options and discarded the resulting error, so every adopter on a current
 * Spec Kit was told nothing (or told it worked). Everything here returns a
 * structured result; callers render it and never print success for a failed
 * step. Capability is read from `specify init --help` rather than a version
 * table, which would drift the same way the flags did.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeSpawnSpecify, isSpecKitAvailable, isSpecKitInitialized, getDetectedAgent, detectAIAgent } from './ensure-skills.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The first Spec Kit release where the integration model is the only form. */
export const MIN_SPEC_KIT_VERSION = '0.10.0';

export const SPEC_KIT_UPGRADE_HINT =
  'specify self upgrade   (older CLIs: uv tool install specify-cli --force --from git+https://github.com/github/spec-kit.git)';

/** DocGuard's own Spec Kit extension, shipped inside the npm package. */
export const PACKAGED_EXTENSION_DIR = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard');

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

/**
 * Read which `init` options the installed CLI documents.
 * @returns {{ available: boolean, supported: boolean, flags: Set<string>, error: string|null }}
 */
export function readSpecKitCapabilities(projectDir) {
  if (!isSpecKitAvailable()) {
    return { available: false, supported: false, flags: new Set(), error: null };
  }
  try {
    const help = safeSpawnSpecify(['init', '--help'], {
      cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(15000),
      env: { ...process.env, NO_COLOR: '1', COLUMNS: '200' },
    });
    const flags = new Set(stripAnsi(help).match(/--[a-z][a-z-]*/g) || []);
    return { available: true, supported: flags.has('--integration'), flags, error: null };
  } catch (err) {
    return { available: true, supported: false, flags: new Set(), error: failureReason(err) };
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

/** True when `.specify/extensions/.registry` already lists DocGuard. */
export function isDocGuardRegistered(projectDir) {
  const registry = resolve(projectDir, '.specify', 'extensions', '.registry');
  if (!existsSync(registry)) return false;
  try {
    const parsed = JSON.parse(readFileSync(registry, 'utf-8'));
    return Boolean(parsed?.extensions?.docguard);
  } catch {
    return false;
  }
}

/**
 * Register DocGuard's packaged extension with Spec Kit (offline, version-matched).
 * @returns {{ status: 'registered'|'already-registered'|'failed'|'not-attempted', reason: string|null, manualCommand: string|null }}
 */
export function registerDocGuardExtension(projectDir, { extensionDir = PACKAGED_EXTENSION_DIR } = {}) {
  if (isDocGuardRegistered(projectDir)) {
    return { status: 'already-registered', reason: null, manualCommand: null };
  }
  const args = ['extension', 'add', extensionDir, '--dev'];
  const manualCommand = renderCommand(args);
  if (!existsSync(resolve(extensionDir, 'extension.yml'))) {
    return { status: 'failed', reason: `packaged extension not found at ${extensionDir}`, manualCommand };
  }
  try {
    safeSpawnSpecify(args, { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutMs(60000) });
    return { status: 'registered', reason: null, manualCommand: null };
  } catch (err) {
    return { status: 'failed', reason: failureReason(err), manualCommand };
  }
}

/**
 * Initialize Spec Kit for this project. Only `docguard init` may call this —
 * other commands must never scaffold a repository behind the user's back.
 *
 * @returns {{ status: 'initialized'|'already-initialized'|'skipped'|'unavailable'|'unsupported-version'|'failed',
 *             integration: {key: string, source: string}|null, reason: string|null, manualCommand: string|null,
 *             extension: {status: string, reason: string|null, manualCommand: string|null} }}
 */
export function delegateSpecKitInit(projectDir, { skip = false } = {}) {
  const notAttempted = { status: 'not-attempted', reason: null, manualCommand: null };
  if (skip) {
    return { status: 'skipped', integration: null, reason: null, manualCommand: null, extension: notAttempted };
  }

  const capabilities = readSpecKitCapabilities(projectDir);

  if (isSpecKitInitialized(projectDir)) {
    const integration = resolveIntegration(projectDir);
    const extension = capabilities.available ? registerDocGuardExtension(projectDir) : notAttempted;
    return { status: 'already-initialized', integration, reason: null, manualCommand: null, extension };
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
  return { status: 'initialized', integration, reason: null, manualCommand: null, extension: registerDocGuardExtension(projectDir) };
}
