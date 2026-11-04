/**
 * The sensor's per-tree-state guard cache (specs/090-aidlc-plugin), read
 * without running guard. A leaf module so a scanner can read it: the MCP doc
 * tools report a document's open findings only when the cache matches the
 * tree in front of them (docguard.dora-evidence#FR-005), and importing the
 * sensor command would pull guard, and every validator, into the scanner.
 *
 * @implements docguard.dora-evidence#FR-005
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGit } from './shared-git.mjs';

export const SENSOR_CACHE = '.docguard/sensor-cache.json';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;

/** HEAD, the working-tree changes with their content, and the config: what guard's answer depends on. */
export function treeKey(projectDir) {
  const h = createHash('sha256');
  const head = runGit(projectDir, ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const status = runGit(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  if (head.status === 0 && status.status === 0) {
    h.update(`head:${head.stdout.trim()}\n`);
    for (const entry of status.stdout.split('\0').filter(Boolean)) {
      const path = entry.slice(3);
      if (path.startsWith('.docguard/')) continue; // DocGuard's own state, including this cache
      h.update(`${entry}\n`);
      try { if (statSync(resolve(projectDir, path)).isFile()) h.update(readFileSync(resolve(projectDir, path))); } catch { /* deleted */ }
    }
  } else {
    // No git: the newest mtime under the project stands in for the tree state.
    h.update(`nogit:${newestMtime(projectDir)}\n`);
  }
  const cfg = resolve(projectDir, '.docguard.json');
  if (existsSync(cfg)) h.update(readFileSync(cfg));
  h.update(`v:${VERSION}`);
  return h.digest('hex');
}

function newestMtime(dir, depth = 0) {
  if (depth > 6) return 0;
  let newest = 0;
  try {
    for (const name of readdirSyncSafe(dir)) {
      if (name === '.git' || name === 'node_modules' || name === '.docguard') continue;
      const p = resolve(dir, name);
      const s = statSync(p);
      newest = Math.max(newest, s.isDirectory() ? newestMtime(p, depth + 1) : s.mtimeMs);
    }
  } catch { /* unreadable */ }
  return newest;
}
function readdirSyncSafe(dir) { try { return readdirSync(dir); } catch { return []; } }

/** Finding codes per file, for every finding (the sensor's stdout lists at most 20). */
export function fileCodes(findings) {
  const out = {};
  for (const f of findings) {
    const file = typeof f.location === 'string' ? f.location : f.location?.file;
    if (!file) continue;
    const key = String(file).split(':')[0];
    (out[key] ||= new Set()).add(f.code || 'DOCGUARD');
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
}

/**
 * The cached per-file codes when the cache is for the current tree state,
 * else null. Never runs guard; the tree key costs a git status, paid only
 * when a cache file exists.
 */
export function currentFileCodes(projectDir) {
  const path = resolve(projectDir, SENSOR_CACHE);
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, 'utf-8'));
    if (!cached.fileCodes || cached.key !== treeKey(projectDir)) return null;
    return cached.fileCodes;
  } catch { return null; }
}
