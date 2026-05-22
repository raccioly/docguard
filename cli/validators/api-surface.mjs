/**
 * API-Surface Validator — Detects drift between the documented API surface
 * (docs-canonical/API-REFERENCE.md) and the project's actual API surface.
 *
 * This is the check that catches a deleted endpoint still being documented —
 * the exact class of drift DocGuard exists to prevent.
 *
 * Actual surface, in order of confidence:
 *   1. OpenAPI spec (sourceRoot/workspace-aware)  → high confidence
 *   2. Monorepo-aware code route scan             → lower confidence (warn only)
 *
 * Severity policy:
 *   - documented-but-absent  → ERROR when confirmed by an OpenAPI spec
 *                              (docs lie about a real endpoint → fail the build);
 *                              downgraded to WARNING on heuristic code-scan only.
 *   - present-but-undocumented → WARNING (a real route missing from the docs).
 *
 * Returns { errors, warnings, passed, total } like the other validators.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { detectOpenAPI } from '../scanners/doc-tools.mjs';
import { scanRoutesDeep } from '../scanners/routes.mjs';
import { parseApiReferenceDoc, compareEndpoints } from '../scanners/api-doc.mjs';
import { collectPackageJsons, getWorkspaceDirs } from '../shared-source.mjs';

const MAX_REPORTED = 15;

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
 * divergent root copy.
 */
function orderedSpecDirs(projectDir, config) {
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
 * Locate the authoritative OpenAPI spec across the monorepo.
 * Returns the FIRST spec found in priority order (sourceRoot first).
 */
function findOpenApiEndpoints(projectDir, config) {
  for (const dir of orderedSpecDirs(projectDir, config)) {
    const oa = detectOpenAPI(dir);
    if (oa.found && oa.endpoints?.length) {
      const endpoints = oa.endpoints.filter(e => e && e.method && e.path);
      if (endpoints.length) return { endpoints, path: oa.path };
    }
  }
  return null;
}

function detectFramework(projectDir, config) {
  const deps = {};
  for (const { pkg } of collectPackageJsons(projectDir, config)) {
    Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {});
  }
  if (deps.next) return 'Next.js';
  if (deps.express) return 'Express';
  if (deps.fastify) return 'Fastify';
  if (deps.hono) return 'Hono';
  return '';
}

/**
 * Resolve the actual API surface.
 * @returns {{ endpoints: Array<{method,path}>, confidence: 'spec'|'code'|'none', source: string }}
 */
export function resolveApiSurface(projectDir, config) {
  const spec = findOpenApiEndpoints(projectDir, config);
  if (spec) {
    return {
      endpoints: spec.endpoints.map(e => ({ method: e.method, path: e.path })),
      confidence: 'spec',
      source: spec.path,
    };
  }

  // Fallback: monorepo-aware code route scan
  const framework = detectFramework(projectDir, config);
  const routes = scanRoutesDeep(projectDir, { framework }, { openapi: { found: false } }, { config });
  if (routes.length) {
    return {
      endpoints: routes.map(r => ({ method: r.method, path: r.path })),
      confidence: 'code',
      source: 'code-scan',
    };
  }

  return { endpoints: [], confidence: 'none', source: null };
}

export function validateApiSurface(projectDir, config) {
  const errors = [];
  const warnings = [];

  const apiDocPath = resolve(projectDir, 'docs-canonical/API-REFERENCE.md');
  if (!existsSync(apiDocPath)) {
    // No API reference doc → nothing to validate (not applicable).
    return { errors, warnings, passed: 0, total: 0 };
  }

  const documented = parseApiReferenceDoc(readFileSync(apiDocPath, 'utf-8'));
  const surface = resolveApiSurface(projectDir, config);

  // If we cannot determine the actual surface, do not fabricate drift.
  if (surface.confidence === 'none' || documented.length === 0) {
    return { errors, warnings, passed: documented.length, total: documented.length };
  }

  const { documentedButAbsent, presentButUndocumented, matched } =
    compareEndpoints(documented, surface.endpoints);

  const total = matched.length + documentedButAbsent.length + presentButUndocumented.length;
  const passed = matched.length;

  const trim = (arr) => {
    const shown = arr.slice(0, MAX_REPORTED);
    const extra = arr.length - shown.length;
    return { shown, extra };
  };

  // documented-but-absent
  if (documentedButAbsent.length) {
    const { shown, extra } = trim(documentedButAbsent);
    for (const e of shown) {
      const msg = `Documented endpoint not found in code: ${e.method} ${e.path} (docs-canonical/API-REFERENCE.md)`;
      if (surface.confidence === 'spec') errors.push(msg);
      else warnings.push(`${msg} [code-scan — verify]`);
    }
    if (extra > 0) {
      const tail = `…and ${extra} more documented endpoint(s) not found in code`;
      if (surface.confidence === 'spec') errors.push(tail);
      else warnings.push(tail);
    }
  }

  // present-but-undocumented
  if (presentButUndocumented.length) {
    const { shown, extra } = trim(presentButUndocumented);
    for (const e of shown) {
      warnings.push(`Undocumented endpoint in code: ${e.method} ${e.path} — add it to docs-canonical/API-REFERENCE.md`);
    }
    if (extra > 0) {
      warnings.push(`…and ${extra} more undocumented endpoint(s) in code`);
    }
  }

  return { errors, warnings, passed, total };
}
