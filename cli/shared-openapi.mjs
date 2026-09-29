/**
 * OpenAPI specification discovery shared by the API-Surface and Docs-Sync
 * validators. It lives here because a validator must never import another
 * validator (Constitution IV); docs-sync previously imported it from
 * cli/validators/api-surface.mjs.
 *
 * @implements docguard.spec-kit-artifact-coverage#FR-007
 */

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { detectOpenAPI } from './scanners/doc-tools.mjs';
import { getWorkspaceDirs } from './shared-source.mjs';
import { relPosix } from './shared-ignore.mjs';

/** Walk up from a dir to the nearest enclosing package.json directory. */
function nearestPackageDir(projectDir, startDir) {
  let cur = startDir;
  const root = resolve(projectDir);
  while (cur && cur.startsWith(root)) {
    if (existsSync(join(cur, 'package.json'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Build an ordered list of directories to search for an OpenAPI spec.
 * The spec under the configured sourceRoot's package takes precedence over a
 * (possibly stale) copy at the repo root — monorepos frequently keep a
 * divergent root copy. Only CANONICAL bases are searched (sourceRoot package,
 * workspaces, repo root) — never worktrees / vendor / scan-tool dirs.
 */
export function orderedSpecDirs(projectDir, config) {
  const ordered = [];
  const seen = new Set();
  const add = (d) => { if (d && !seen.has(d)) { seen.add(d); ordered.push(d); } };

  const srList = config?.sourceRoot
    ? (Array.isArray(config.sourceRoot) ? config.sourceRoot : [config.sourceRoot])
    : [];
  for (const sr of srList) {
    const abs = resolve(projectDir, sr);
    add(nearestPackageDir(projectDir, abs));
    add(abs);
  }
  for (const d of getWorkspaceDirs(projectDir)) add(d);
  add(resolve(projectDir)); // root copy last — lowest priority
  return ordered;
}

/**
 * Enumerate every OpenAPI spec found in a canonical location, in priority order.
 * @returns {Array<{ absPath: string, relPath: string, endpoints: object[] }>}
 */
export function findAllOpenApiSpecs(projectDir, config) {
  const specs = [];
  const seenAbs = new Set();
  for (const dir of orderedSpecDirs(projectDir, config)) {
    const oa = detectOpenAPI(dir);
    if (!oa.found || !oa.endpoints?.length) continue;
    const absPath = resolve(dir, oa.path);
    if (seenAbs.has(absPath)) continue;
    seenAbs.add(absPath);
    specs.push({
      absPath,
      relPath: relPosix(projectDir, absPath),
      endpoints: oa.endpoints.filter(e => e && e.method && e.path),
    });
  }
  return specs;
}
