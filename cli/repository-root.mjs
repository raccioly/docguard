/** Read-only repository-root guidance for commands launched in nested packages. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { compileGlob } from './shared-ignore.mjs';

const MAX_ANCESTORS = 32;
const MAX_MANIFEST_BYTES = 256 * 1024;

function regularFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_MANIFEST_BYTES;
  } catch { return false; }
}

function readRegular(path) {
  if (!regularFile(path)) return null;
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function gitTopLevel(dir) {
  try {
    return resolve(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
      timeout: 3000,
    }).trim());
  } catch { return null; }
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function normalizePattern(pattern) {
  const value = String(pattern).trim().replaceAll('\\', '/').replace(/^\.\//, '');
  return posix.normalize(value).replace(/^\.\//, '').replace(/\/$/, '');
}

function npmPatterns(root) {
  const content = readRegular(join(root, 'package.json'));
  if (content == null) return [];
  try {
    const value = JSON.parse(content).workspaces;
    const patterns = Array.isArray(value) ? value : value?.packages;
    return Array.isArray(patterns) ? patterns.filter(item => typeof item === 'string') : [];
  } catch { return []; }
}

function pnpmPatterns(root) {
  const content = readRegular(join(root, 'pnpm-workspace.yaml'));
  if (content == null) return [];
  const patterns = [];
  let packages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { packages = true; continue; }
    if (!packages) continue;
    if (/^[^\s#][^:]*\s*:/.test(line)) break;
    const match = line.match(/^\s*-\s*(?:'([^']*)'|"([^"]*)"|([^#]*?))\s*(?:#.*)?$/);
    const value = match && (match[1] ?? match[2] ?? match[3])?.trim();
    if (value) patterns.push(value);
  }
  return patterns;
}

function matchesWorkspace(patterns, packagePath) {
  const normalized = patterns.map(normalizePattern).filter(Boolean);
  const positives = normalized.filter(pattern => !pattern.startsWith('!'));
  const negatives = normalized.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
  const matches = (pattern) => {
    try { return compileGlob(pattern).test(packagePath); } catch { return false; }
  };
  return positives.some(matches) && !negatives.some(matches);
}

function workspaceOwner(root, selected) {
  const hasPnpmWorkspace = regularFile(join(root, 'pnpm-workspace.yaml'));
  const pnpm = pnpmPatterns(root);
  const npm = hasPnpmWorkspace ? [] : npmPatterns(root);
  const patterns = hasPnpmWorkspace ? pnpm : npm;
  if (patterns.length === 0) return null;

  let packageDir = selected;
  while (within(root, packageDir) && packageDir !== root) {
    if (regularFile(join(packageDir, 'package.json'))) {
      const packagePath = relative(root, packageDir).replaceAll('\\', '/');
      if (matchesWorkspace(patterns, packagePath)) {
        return {
          reason: hasPnpmWorkspace ? 'pnpm_workspace' : 'npm_workspace',
          evidence: hasPnpmWorkspace ? 'pnpm-workspace.yaml#packages' : 'package.json#workspaces',
          packagePath,
        };
      }
    }
    const parent = dirname(packageDir);
    if (parent === packageDir) break;
    packageDir = parent;
  }
  return null;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Find the nearest ancestor with explicit DocGuard or workspace ownership.
 * The selected directory is never changed.
 * @implements docguard.language-repository-coverage#FR-012
 * @implements docguard.language-repository-coverage#FR-013
 * @implements docguard.language-repository-coverage#FR-014
 */
export function detectRepositoryRootGuidance(selectedDir, { explicitDir = false, argv = [] } = {}) {
  const selected = resolve(selectedDir);
  if (explicitDir || existsSync(join(selected, '.docguard.json'))) return null;
  const gitRoot = gitTopLevel(selected);
  let current = dirname(selected);
  for (let depth = 1; depth <= MAX_ANCESTORS && current !== dirname(current); depth++) {
    // A nested repository is an independent boundary unless ownership is
    // declared inside that same working tree.
    if (gitRoot && !within(gitRoot, current)) break;
    let ownership = regularFile(join(current, '.docguard.json'))
      ? { reason: 'ancestor_docguard_config', evidence: '.docguard.json', packagePath: relative(current, selected).replaceAll('\\', '/') }
      : null;
    ownership ||= workspaceOwner(current, selected);
    if (ownership) {
      const rerun = ['docguard', ...argv.map(shellQuote), '--dir', shellQuote(current)].join(' ');
      return {
        selectedDir: selected,
        suggestedDir: current,
        reason: ownership.reason,
        evidence: ownership.evidence,
        packagePath: ownership.packagePath,
        gitRoot,
        rerun,
        automaticScopeChange: false,
      };
    }
    current = dirname(current);
  }
  return null;
}

export function renderRepositoryRootGuidance(guidance, { machine = false } = {}) {
  if (!guidance) return '';
  if (machine) return JSON.stringify({
    type: 'docguard.repository-root-guidance',
    repositoryRootGuidance: guidance,
  });
  return [
    `DocGuard is checking ${guidance.selectedDir}.`,
    `${guidance.suggestedDir} appears to govern this package via ${guidance.evidence}; the scan scope was not changed.`,
    `Re-run for repository scope: ${guidance.rerun}`,
  ].join('\n');
}
