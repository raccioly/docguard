/**
 * Per-file cache of anchor extraction, so a warm run parses only the files
 * that changed.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors#FR-041).
 *
 * The cache maps a path to `{ sha, value }`, where `sha` is the sha256 of the
 * working-tree bytes. A hit requires the same bytes and the same extractor
 * identity (algorithm and tier versions), so a cache can never answer for
 * code it did not see. It is still only a speed-up, and it is NOT TRUSTED when
 * it could have been planted:
 *
 *   - in CI (`CI` set), where a cache can only arrive through the checkout;
 *   - when any file under `.docguard/` is tracked by git. `.docguard/` ignores
 *     itself, so a tracked file means someone forced it in (`git add -f`), and
 *     a forged cache could otherwise make changed code read as current. That
 *     case is reported (ANC010), not silently tolerated;
 *   - with `--no-cache`.
 *
 * Publication is atomic (exclusive temporary file, then rename), the read is
 * size-capped and validated, and a symlinked cache file is never followed:
 * the conventions of the memory-plan cache.
 *
 * @implements docguard.requirement-anchors#FR-041
 */

import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { closeSync, constants, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureStateDir, STATE_DIR } from '../writers/state-dir.mjs';

export const ANCHOR_CACHE_PATH = `${STATE_DIR}/anchors.cache.json`;
const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

export const contentSha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Files under `.docguard/` that git tracks (empty outside git). */
function trackedStateFiles(projectDir) {
  const r = spawnSync('git', ['ls-files', '-z', '--', STATE_DIR], { cwd: projectDir, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter(Boolean);
}

function readCache(projectDir, identity) {
  try {
    const path = resolve(projectDir, ANCHOR_CACHE_PATH);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return new Map();
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let data;
    try { data = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (data?.v !== CACHE_VERSION || data.identity !== identity || !data.files || typeof data.files !== 'object') return new Map();
    const files = new Map();
    for (const [rel, entry] of Object.entries(data.files)) {
      if (entry && typeof entry.sha === 'string' && /^[0-9a-f]{64}$/.test(entry.sha) && entry.value !== undefined) files.set(rel, entry);
    }
    return files;
  } catch { return new Map(); }
}

/**
 * Open the cache for one run.
 * @param {string} projectDir
 * @param {{ identity: string, noCache?: boolean, env?: object }} options
 * @returns {{ enabled: boolean, reason: string|null, tracked: string[], get(rel, sha): any, set(rel, sha, value): void, save(): void }}
 */
export function openAnchorCache(projectDir, { identity, noCache = false, env = process.env } = {}) {
  const off = (reason, tracked = []) => ({
    enabled: false, reason, tracked, get: () => undefined, set: () => {}, save: () => {},
  });
  if (noCache) return off('disabled by --no-cache');
  if (env.CI) return off('disabled in CI');
  const tracked = trackedStateFiles(projectDir);
  if (tracked.length) return off(`ignored: git tracks ${tracked.length} file(s) under ${STATE_DIR}/ (${tracked.slice(0, 3).join(', ')}), so a cache there may have been planted`, tracked);
  const files = readCache(projectDir, identity);
  const touched = new Map();
  let dirty = false;
  return {
    enabled: true,
    reason: null,
    tracked: [],
    get(rel, sha) {
      const entry = files.get(rel);
      if (entry?.sha !== sha) return undefined;
      touched.set(rel, entry);
      return entry.value;
    },
    set(rel, sha, value) {
      touched.set(rel, { sha, value });
      dirty = true;
    },
    save() {
      // Keep only what this run read or wrote: deleted and renamed files drop out.
      if (!dirty && touched.size === files.size) return;
      let temporary;
      try {
        if (!ensureStateDir(projectDir)) return;
        const path = resolve(projectDir, ANCHOR_CACHE_PATH);
        try { if (!lstatSync(path).isFile()) return; } catch (err) { if (err.code !== 'ENOENT') return; }
        const payload = JSON.stringify({ v: CACHE_VERSION, identity, files: Object.fromEntries([...touched].sort(([a], [b]) => (a < b ? -1 : 1))) });
        if (Buffer.byteLength(payload) > MAX_CACHE_BYTES) return;
        temporary = join(projectDir, STATE_DIR, `anchors.cache.${randomUUID()}.tmp`);
        writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
        temporary = null;
      } catch { /* the cache is best-effort */ }
      finally {
        if (temporary) { try { unlinkSync(temporary); } catch { /* already gone */ } }
      }
    },
  };
}
