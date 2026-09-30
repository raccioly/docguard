/**
 * DocGuard's local state directory, `.docguard/`.
 *
 * Plan cache, score history, fix memory, feedback records, nudge throttle,
 * context pack and active context all live here. They are local, per-developer
 * or regenerable, so the directory ignores itself with a `.gitignore` holding
 * `*` (the convention of `.pytest_cache/` and `.ruff_cache/`). That covers
 * projects that never ran `init` and projects initialized by older versions,
 * and it never edits the project's own `.gitignore`.
 *
 * @implements docguard.read-only-commands#FR-005
 */
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_DIR = '.docguard';

/**
 * Create `.docguard/` if needed and make sure it ignores itself.
 * Never writes through a symlinked or non-directory `.docguard`, and never
 * replaces an existing `.docguard/.gitignore` (exclusive create).
 * @returns {boolean} whether `.docguard/` is a real directory callers may use
 */
export function ensureStateDir(projectDir) {
  const dir = join(projectDir, STATE_DIR);
  try {
    try {
      if (!lstatSync(dir).isDirectory()) return false;
    } catch (err) {
      if (err.code !== 'ENOENT') return false;
      mkdirSync(dir);
      if (!lstatSync(dir).isDirectory()) return false;
    }
    try {
      writeFileSync(join(dir, '.gitignore'), '*\n', { encoding: 'utf-8', flag: 'wx' });
    } catch { /* EEXIST keeps the owner's file; any other failure is best-effort */ }
    return true;
  } catch {
    return false;
  }
}
