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
 * Also flags MULTIPLE OpenAPI specs in the repo that disagree on their endpoint
 * set (e.g. a served spec and a generated spec that have diverged).
 *
 * Returns { errors, warnings, passed, total, fixes, authoritativeSpec } — the
 * `fixes` array lists deterministic remove-endpoint actions that
 * `docguard fix --write` can apply without an LLM.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { detectOpenAPI } from '../scanners/doc-tools.mjs';
import { scanRoutesDeep } from '../scanners/routes.mjs';
import { parseApiReferenceDoc, compareEndpoints, endpointKey } from '../scanners/api-doc.mjs';
import { collectPackageJsons, getWorkspaceDirs } from '../shared-source.mjs';
import { relPosix } from '../shared-ignore.mjs';

const MAX_REPORTED = 15;
const API_DOC = 'docs-canonical/API-REFERENCE.md';

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

/**
 * Detect divergence between multiple canonical OpenAPI specs.
 * @returns {null | { specs, divergent: string[], authoritative: string }}
 */
export function detectSpecDivergence(projectDir, config) {
  const specs = findAllOpenApiSpecs(projectDir, config);
  if (specs.length < 2) return null;

  const keySets = specs.map(s => new Set(s.endpoints.map(e => endpointKey(e.method, e.path))));
  // Union and symmetric difference across all specs.
  const union = new Set();
  for (const ks of keySets) for (const k of ks) union.add(k);
  const divergent = [...union].filter(k => !keySets.every(ks => ks.has(k)));

  if (divergent.length === 0) return null;
  return { specs, divergent, authoritative: specs[0].relPath };
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
  const specs = findAllOpenApiSpecs(projectDir, config);
  if (specs.length > 0) {
    const spec = specs[0]; // highest priority (sourceRoot first, root last)
    return {
      endpoints: spec.endpoints.map(e => ({ method: e.method, path: e.path })),
      confidence: 'spec',
      source: spec.relPath,
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

/**
 * Compute API-surface drift in a structured, reusable form.
 * Used by the validator AND by `docguard fix --write`.
 * @returns {{ applicable, confidence, source, documented, documentedButAbsent,
 *             presentButUndocumented, matched }}
 */
export function computeApiSurfaceDrift(projectDir, config) {
  const apiDocPath = resolve(projectDir, API_DOC);
  if (!existsSync(apiDocPath)) {
    return { applicable: false, confidence: 'none', source: null,
      documented: [], documentedButAbsent: [], presentButUndocumented: [], matched: [] };
  }

  const documented = parseApiReferenceDoc(readFileSync(apiDocPath, 'utf-8'));
  const surface = resolveApiSurface(projectDir, config);

  if (surface.confidence === 'none' || documented.length === 0) {
    return { applicable: false, confidence: surface.confidence, source: surface.source,
      documented, documentedButAbsent: [], presentButUndocumented: [], matched: [] };
  }

  const cmp = compareEndpoints(documented, surface.endpoints);
  return {
    applicable: true,
    confidence: surface.confidence,
    source: surface.source,
    documented,
    documentedButAbsent: cmp.documentedButAbsent,
    presentButUndocumented: cmp.presentButUndocumented,
    matched: cmp.matched,
  };
}

export function validateApiSurface(projectDir, config) {
  const errors = [];
  const warnings = [];
  const fixes = [];

  // v0.14-P2: when --changed-only scoping is active and NONE of the changed
  // files look like route/spec/controller files, this validator has nothing
  // to add — return N/A so the lite-mode total reflects only what was actually
  // checked. Route patterns mirror the SECTION_FILE_MATCHERS in sync.mjs.
  if (Array.isArray(config.changedFiles)) {
    const ROUTE_RE = /(^|\/)(routes|controllers|handlers|app\/api)\/|openapi|swagger/i;
    const anyRouteFile = config.changedFiles.some(f => ROUTE_RE.test(f));
    if (!anyRouteFile) {
      return {
        errors, warnings, passed: 0, total: 0, fixes,
        applicable: false,
        note: 'no route/spec files in changed set',
      };
    }
  }

  const drift = computeApiSurfaceDrift(projectDir, config);

  // ── Multi-spec divergence (independent of the API-REFERENCE doc) ──
  const divergence = detectSpecDivergence(projectDir, config);
  if (divergence) {
    const others = divergence.specs.slice(1).map(s => s.relPath).join(', ');
    const sample = divergence.divergent.slice(0, 8).join(', ');
    const more = divergence.divergent.length > 8 ? ` (+${divergence.divergent.length - 8} more)` : '';
    warnings.push(
      `Multiple OpenAPI specs disagree on ${divergence.divergent.length} endpoint(s): ` +
      `${divergence.authoritative} (treated as authoritative) vs ${others}. Divergent: ${sample}${more}`
    );
  }

  if (!drift.applicable) {
    // Nothing to validate against the API-REFERENCE doc.
    return { errors, warnings, passed: 0, total: 0, fixes, authoritativeSpec: drift.source };
  }

  const { documentedButAbsent, presentButUndocumented, matched, confidence, source } = drift;
  const total = matched.length + documentedButAbsent.length + presentButUndocumented.length;
  const passed = matched.length;

  const trim = (arr) => {
    const shown = arr.slice(0, MAX_REPORTED);
    return { shown, extra: arr.length - shown.length };
  };

  // documented-but-absent → deterministic remove-endpoint fixes
  if (documentedButAbsent.length) {
    const { shown, extra } = trim(documentedButAbsent);
    for (const e of shown) {
      const msg = `Documented endpoint not found in code: ${e.method} ${e.path} (${API_DOC})`;
      if (confidence === 'spec') errors.push(msg);
      else warnings.push(`${msg} [code-scan — verify]`);
    }
    if (extra > 0) {
      const tail = `…and ${extra} more documented endpoint(s) not found in code`;
      if (confidence === 'spec') errors.push(tail);
      else warnings.push(tail);
    }
    // Only spec-confirmed absences are safe to auto-remove.
    if (confidence === 'spec') {
      for (const e of documentedButAbsent) {
        fixes.push({ type: 'remove-endpoint', method: e.method, path: e.path, doc: API_DOC });
      }
    }
  }

  // present-but-undocumented → warning (NOT auto-applied; needs a real block)
  if (presentButUndocumented.length) {
    const { shown, extra } = trim(presentButUndocumented);
    for (const e of shown) {
      warnings.push(`Undocumented endpoint in code: ${e.method} ${e.path} — add it to ${API_DOC}`);
    }
    if (extra > 0) warnings.push(`…and ${extra} more undocumented endpoint(s) in code`);
  }

  return { errors, warnings, passed, total, fixes, authoritativeSpec: source };
}
