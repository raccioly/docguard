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
import { mkFinding, resultFromFindings } from '../findings.mjs';

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
 * OpenAPI specs that exist and declare a `paths:` section but parsed to ZERO
 * endpoints — i.e. DocGuard's minimal YAML/JSON parser couldn't extract them
 * (an unsupported feature: `$ref`, anchors, folded scalars). These are silently
 * skipped by findAllOpenApiSpecs (good — code scanning takes over), but the
 * parse failure must be SURFACED so a broken spec doesn't masquerade as a
 * clean "no API surface" pass. Returns relative spec paths.
 */
export function findUnparseableSpecs(projectDir, config) {
  const out = [];
  const seen = new Set();
  for (const dir of orderedSpecDirs(projectDir, config)) {
    const oa = detectOpenAPI(dir);
    if (!oa.found || !oa.parseIncomplete) continue;
    const abs = resolve(dir, oa.path);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(relPosix(projectDir, abs));
  }
  return out;
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

/**
 * v0.28 (field report #4): diff the OpenAPI spec against the routes actually
 * REGISTERED in code. When a spec exists, resolveApiSurface treats it as ground
 * truth and the API-REFERENCE doc reconciles against it — so a spec that declares
 * a phantom endpoint (no Express/Fastify route registers it) passes doc-vs-spec
 * clean while the spec itself is wrong. This catches that.
 *
 * Conservative on purpose: only runs when code routes are actually scannable.
 * If the scanner finds zero routes (unsupported framework, dynamically-registered
 * routes), we can't tell "no route" from "scanner blind", so we skip rather than
 * flag every spec endpoint as phantom. Reuses compareEndpoints so path-param /
 * mount-prefix normalization matches the rest of the validator.
 *
 * @returns {{ applicable:boolean, specPath:string|null, routeCount:number,
 *             matched:object[], specDeclaredNoRoute:object[], reason?:string }}
 */
export function computeSpecVsRouteDrift(projectDir, config) {
  const specs = findAllOpenApiSpecs(projectDir, config);
  if (specs.length === 0) {
    return { applicable: false, specPath: null, routeCount: 0, matched: [], specDeclaredNoRoute: [], reason: 'no openapi spec' };
  }
  const spec = specs[0]; // authoritative (sourceRoot first, root last)
  const framework = detectFramework(projectDir, config);
  const routes = scanRoutesDeep(projectDir, { framework }, { openapi: { found: false } }, { config });
  if (routes.length === 0) {
    return { applicable: false, specPath: spec.relPath, routeCount: 0, matched: [], specDeclaredNoRoute: [], reason: 'no routes scannable' };
  }
  // documentedButAbsent = in the SPEC (first arg) but absent from the ROUTES
  // (second arg) = spec-declares-but-no-route.
  const cmp = compareEndpoints(
    spec.endpoints.map(e => ({ method: e.method, path: e.path })),
    routes.map(r => ({ method: r.method, path: r.path }))
  );
  return {
    applicable: true,
    specPath: spec.relPath,
    routeCount: routes.length,
    matched: cmp.matched,
    specDeclaredNoRoute: cmp.documentedButAbsent,
  };
}

// v0.29: migrated to structured findings (API001–API005). Messages are
// byte-identical to the legacy strings — resultFromFindings derives the
// errors/warnings arrays from the same findings; `fixes` and
// `authoritativeSpec` are preserved.
export function validateApiSurface(projectDir, config) {
  const findings = [];
  const fixes = [];
  const trim = (arr) => {
    const shown = arr.slice(0, MAX_REPORTED);
    return { shown, extra: arr.length - shown.length };
  };

  // v0.14-P2: when --changed-only scoping is active and NONE of the changed
  // files look like route/spec/controller files, this validator has nothing
  // to add — return N/A so the lite-mode total reflects only what was actually
  // checked. Route patterns mirror the SECTION_FILE_MATCHERS in sync.mjs.
  if (Array.isArray(config.changedFiles)) {
    const ROUTE_RE = /(^|\/)(routes|controllers|handlers|app\/api)\/|openapi|swagger/i;
    const anyRouteFile = config.changedFiles.some(f => ROUTE_RE.test(f));
    if (!anyRouteFile) {
      return {
        errors: [], warnings: [], passed: 0, total: 0, fixes,
        applicable: false,
        note: 'no route/spec files in changed set',
      };
    }
  }

  // ── Honest-failure: an OpenAPI spec we couldn't parse ──
  // A spec that declares paths but yielded zero endpoints means our parser
  // choked on it. We fall back to code scanning (below), but the parse failure
  // is surfaced here rather than silently producing a clean "no surface" pass.
  for (const specPath of findUnparseableSpecs(projectDir, config)) {
    findings.push(mkFinding({
      code: 'API001',
      validator: 'apiSurface',
      severity: 'warn',
      message: `OpenAPI spec ${specPath} declares paths but DocGuard parsed 0 endpoints from it ` +
        `(likely an unsupported YAML feature — $ref, anchors, or folded scalars). ` +
        `Falling back to code scanning; the spec's own endpoint list is unavailable. ` +
        `Validate it with a full OpenAPI linter.`,
      location: specPath,
      suggestion: { kind: 'review', text: 'Validate the spec with a full OpenAPI linter (e.g. spectral) and simplify unsupported YAML features' },
    }));
  }

  const drift = computeApiSurfaceDrift(projectDir, config);

  // ── Multi-spec divergence (independent of the API-REFERENCE doc) ──
  const divergence = detectSpecDivergence(projectDir, config);
  if (divergence) {
    const others = divergence.specs.slice(1).map(s => s.relPath).join(', ');
    const sample = divergence.divergent.slice(0, 8).join(', ');
    const more = divergence.divergent.length > 8 ? ` (+${divergence.divergent.length - 8} more)` : '';
    findings.push(mkFinding({
      code: 'API002',
      validator: 'apiSurface',
      severity: 'warn',
      message: `Multiple OpenAPI specs disagree on ${divergence.divergent.length} endpoint(s): ` +
        `${divergence.authoritative} (treated as authoritative) vs ${others}. Divergent: ${sample}${more}`,
      location: divergence.authoritative,
      suggestion: { kind: 'review', text: 'Regenerate or delete the stale spec copy so every spec agrees on the endpoint set' },
    }));
  }

  // ── #4: spec declares an endpoint with no registered route ──
  // Independent of the API-REFERENCE doc — it checks the spec against code, so it
  // runs even when no doc exists. Conservative (only when routes are scannable).
  const specRoute = computeSpecVsRouteDrift(projectDir, config);
  let specRouteTotal = 0;
  let specRoutePassed = 0;
  if (specRoute.applicable) {
    specRouteTotal = specRoute.matched.length + specRoute.specDeclaredNoRoute.length;
    specRoutePassed = specRoute.matched.length;
    if (specRoute.specDeclaredNoRoute.length) {
      const { shown, extra } = trim(specRoute.specDeclaredNoRoute);
      for (const e of shown) {
        findings.push(mkFinding({
          code: 'API003',
          validator: 'apiSurface',
          severity: 'warn',
          // "may be wrong" — the route scanner can be blind to dynamic
          // registration, so this is a candidate false positive by design.
          confidence: 'low',
          message: `OpenAPI spec (${specRoute.specPath}) declares ${e.method} ${e.path} but no route registers it in code — ` +
            `the spec may be wrong, and the API-REFERENCE doc reconciles clean against it, hiding the gap.`,
          location: specRoute.specPath,
          suggestion: { kind: 'review', text: 'Verify the endpoint: remove it from the spec if it no longer exists, or check whether the route is registered dynamically' },
        }));
      }
      if (extra > 0) {
        findings.push(mkFinding({
          code: 'API003',
          validator: 'apiSurface',
          severity: 'warn',
          confidence: 'low',
          message: `…and ${extra} more spec-declared endpoint(s) with no registered route`,
          location: specRoute.specPath,
          suggestion: { kind: 'review', text: 'Verify each spec-declared endpoint against the registered routes' },
        }));
      }
    }
  }

  if (!drift.applicable) {
    // Nothing to validate against the API-REFERENCE doc — but the spec-vs-route
    // check above may still have produced findings.
    return {
      ...resultFromFindings(findings, { passed: specRoutePassed, total: specRouteTotal }),
      fixes,
      authoritativeSpec: drift.source || specRoute.specPath,
    };
  }

  const { documentedButAbsent, presentButUndocumented, matched, confidence, source } = drift;
  const total = matched.length + documentedButAbsent.length + presentButUndocumented.length + specRouteTotal;
  const passed = matched.length + specRoutePassed;

  // documented-but-absent → deterministic remove-endpoint fixes
  if (documentedButAbsent.length) {
    const { shown, extra } = trim(documentedButAbsent);
    for (const e of shown) {
      const msg = `Documented endpoint not found in code: ${e.method} ${e.path} (${API_DOC})`;
      if (confidence === 'spec') {
        findings.push(mkFinding({
          code: 'API004',
          validator: 'apiSurface',
          severity: 'error',
          message: msg,
          location: API_DOC,
          suggestion: { kind: 'fix', text: 'Remove the dead endpoint from the doc', command: 'docguard fix --write' },
        }));
      } else {
        findings.push(mkFinding({
          code: 'API004',
          validator: 'apiSurface',
          severity: 'warn',
          // The "[code-scan — verify]" suffix marks this as heuristic-only:
          // the route scanner may simply not see the endpoint's registration.
          confidence: 'low',
          message: `${msg} [code-scan — verify]`,
          location: API_DOC,
          suggestion: { kind: 'review', text: 'Verify the endpoint really is gone from the code, then remove it from the doc' },
        }));
      }
    }
    if (extra > 0) {
      const tail = `…and ${extra} more documented endpoint(s) not found in code`;
      if (confidence === 'spec') {
        findings.push(mkFinding({
          code: 'API004',
          validator: 'apiSurface',
          severity: 'error',
          message: tail,
          location: API_DOC,
          suggestion: { kind: 'fix', text: 'Remove the dead endpoints from the doc', command: 'docguard fix --write' },
        }));
      } else {
        findings.push(mkFinding({
          code: 'API004',
          validator: 'apiSurface',
          severity: 'warn',
          confidence: 'low',
          message: tail,
          location: API_DOC,
          suggestion: { kind: 'review', text: 'Verify each documented endpoint against the code, then prune the doc' },
        }));
      }
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
      findings.push(mkFinding({
        code: 'API005',
        validator: 'apiSurface',
        severity: 'warn',
        message: `Undocumented endpoint in code: ${e.method} ${e.path} — add it to ${API_DOC}`,
        location: API_DOC,
        suggestion: { kind: 'fix', text: `Document the endpoint in ${API_DOC}` },
      }));
    }
    if (extra > 0) {
      findings.push(mkFinding({
        code: 'API005',
        validator: 'apiSurface',
        severity: 'warn',
        message: `…and ${extra} more undocumented endpoint(s) in code`,
        location: API_DOC,
        suggestion: { kind: 'fix', text: `Document the remaining endpoints in ${API_DOC}` },
      }));
    }
  }

  return { ...resultFromFindings(findings, { passed, total }), fixes, authoritativeSpec: source };
}
