/**
 * As-built specifications — facts DocGuard can establish about one area of
 * existing code, and whether a spec that claims to describe that area still
 * does.
 *
 * Spec: specs/024-as-built-specs (docguard.as-built-specs).
 *
 * The facts are what the existing scanners see without an LLM: routes
 * (method + path), exported JS/TS symbols, environment variables read, and
 * data entities. Each fact has a stable key, so a line move never churns it.
 * DocGuard never writes requirement prose; it proposes one candidate per fact
 * and leaves the statement to the agent. The same fact set later checks the
 * spec in both directions: code nobody accounted for, and cited facts that no
 * longer exist.
 *
 * @implements docguard.as-built-specs#FR-001
 * @implements docguard.as-built-specs#FR-002
 * @implements docguard.as-built-specs#FR-005
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { walkFiles, relPosix } from '../shared-ignore.mjs';
import { grepEnvUsage, summarizeTiers } from '../shared-source.mjs';
import { detectDocTools } from './doc-tools.mjs';
import { detectProjectProfile } from './project-type.mjs';
import { scanRoutesDeep } from './routes.mjs';
import { scanSchemasDeep } from './schemas.mjs';
import { exportedNames } from './js-ast.mjs';
import { isTestSource } from './requirement-evidence.mjs';

const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
export const FACT_MARKER_RE = /<!--\s*docguard:fact\s+(route|export|env|entity)\s+(.+?)\s*-->/g;

/**
 * Resolve an area inside the project, refusing escapes and symlinks.
 * @returns {{ ok: true, rel: string, abs: string } | { ok: false, reason: string }}
 */
export function resolveArea(projectDir, area) {
  if (!area || typeof area !== 'string') return { ok: false, reason: 'An area path is required (--spec <dir>).' };
  const root = realpathSync(resolve(projectDir));
  const abs = resolve(projectDir, area);
  if (!existsSync(abs)) return { ok: false, reason: `Area not found: ${area}` };
  if (lstatSync(abs).isSymbolicLink()) return { ok: false, reason: `Area is a symlink: ${area}` };
  const real = realpathSync(abs);
  if (real !== root && !real.startsWith(`${root}${sep}`)) return { ok: false, reason: `Area is outside the project: ${area}` };
  if (!statSync(real).isDirectory()) return { ok: false, reason: `Area is not a directory: ${area}` };
  const rel = relPosix(root, real) || '.';
  return { ok: true, rel, abs: real };
}

const within = (file, rel) => rel === '.' || file === rel || file.startsWith(`${rel}/`);


/**
 * Deterministic facts under one area, sorted by key.
 * @returns {Array<{ kind: 'route'|'export'|'env'|'entity', key: string, file: string|null, line: number|null }>}
 */
export function collectAreaFacts(projectDir, areaRel, config = {}) {
  const facts = new Map();
  // Route and entity facts carry the parser tier that read them; the scan
  // tiers ride along so a fact that is absent can be judged too
  // (docguard.python-extraction#FR-013).
  const add = (kind, key, file = null, line = null, tier = null) => {
    const id = `${kind} ${key}`;
    if (!facts.has(id)) facts.set(id, { kind, key, file, line, ...(tier ? { tier } : {}) });
  };

  const profile = detectProjectProfile(projectDir, config);
  const framework = profile.primary?.framework || profile.frameworks?.[0] || '';
  const docTools = detectDocTools(projectDir);

  const routes = scanRoutesDeep(projectDir, { framework: (profile.frameworks || []).join(' ') }, docTools, { config }) || [];
  for (const r of routes) {
    const file = r.file ? String(r.file).replace(/\\/g, '/') : null;
    if (!file || r.source === 'openapi' || !within(file, areaRel) || !r.method || !r.path) continue;
    add('route', `${String(r.method).toUpperCase()} ${r.path}`, file, r.line ?? null, r.tier || null);
  }

  walkFiles(resolve(projectDir, areaRel), abs => {
    const file = relPosix(projectDir, abs);
    if (!JS_EXT.has(extname(abs)) || isTestSource(file) || /\.d\.ts$/.test(file)) return;
    let content;
    try { content = readFileSync(abs, 'utf8'); } catch { return; }
    for (const { name, line } of exportedNames(content, abs)) add('export', `${file}#${name}`, file, line ?? null);
  });

  for (const name of grepEnvUsage(projectDir, config, { within: areaRel })) add('env', name);

  const schemas = scanSchemasDeep(projectDir, { framework }, docTools, config) || { entities: [] };
  for (const e of schemas.entities || []) {
    const file = e.file ? String(e.file).replace(/\\/g, '/') : null;
    if (e.name && file && within(file, areaRel)) add('entity', e.name, file, e.line ?? null, e.tier || null);
  }

  const list = [...facts.values()].sort((a, b) => `${a.kind} ${a.key}`.localeCompare(`${b.kind} ${b.key}`));
  const kindTier = (scanTier, kind) => summarizeTiers([...(scanTier ? [scanTier] : []), ...list.filter(f => f.kind === kind && f.tier)]);
  Object.defineProperty(list, 'tiers', {
    value: { route: kindTier(routes.scanTier, 'route'), entity: kindTier(schemas.scanTier, 'entity') },
    enumerable: false,
  });
  return list;
}

/**
 * True when a tier means an AST-capable file was read by the pattern fallback.
 * @implements docguard.python-extraction#FR-013
 */
export function isPatternTier(tier) {
  return tier === 'regex-fallback' || tier === 'mixed';
}

/** The tier of the facts behind an as-built result, for reports and findings. */
export function factsTier(facts) {
  const tiers = facts?.tiers;
  if (!tiers) return { tier: 'not-applicable', tierReason: null };
  const s = summarizeTiers([tiers.route, tiers.entity].filter(t => t && t.tier !== 'not-applicable'));
  return { tier: s.tier, tierReason: s.tierReason };
}

/**
 * Test files under the area — existing evidence, listed, never candidates.
 * Python package markers and fixtures (`__init__.py`, `conftest.py`) sit in
 * test directories but are not tests.
 * @implements docguard.python-extraction#FR-015
 */
export function areaTests(projectDir, areaRel) {
  const out = [];
  walkFiles(resolve(projectDir, areaRel), abs => {
    const file = relPosix(projectDir, abs);
    if (/(?:^|\/)(?:__init__|conftest)\.py$/.test(file)) return;
    if (isTestSource(file)) out.push(file);
  });
  return out.sort();
}

/** Next free feature directory name, honouring Spec Kit's feature_numbering. */
export function nextFeatureDir(projectDir, slug, now = new Date()) {
  let numbering = 'sequential';
  try {
    const opts = JSON.parse(readFileSync(resolve(projectDir, '.specify', 'init-options.json'), 'utf8'));
    numbering = opts.feature_numbering || opts.branch_numbering || 'sequential';
  } catch { /* default */ }
  if (numbering === 'timestamp') {
    const p = n => String(n).padStart(2, '0');
    const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
    return `${stamp}-${slug}`;
  }
  let max = 0;
  const specsDir = resolve(projectDir, 'specs');
  if (existsSync(specsDir)) {
    for (const entry of readdirSync(specsDir, { withFileTypes: true })) {
      const m = entry.isDirectory() && entry.name.match(/^(\d{1,4})-/);
      if (m && !/^\d{8}-\d{6}-/.test(entry.name)) max = Math.max(max, Number(m[1]));
    }
  }
  return `${String(max + 1).padStart(3, '0')}-${slug}`;
}

export function slugFor(areaRel) {
  const s = areaRel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `as-built-${s || 'root'}`.slice(0, 60);
}

const FACT_NOUN = {
  route: fact => `the \`${fact.key}\` endpoint`,
  export: fact => `\`${fact.key.split('#')[1]}\` exported from \`${fact.key.split('#')[0]}\``,
  env: fact => `the \`${fact.key}\` environment variable`,
  entity: fact => `the \`${fact.key}\` entity`,
};

/**
 * The Spec Kit-shaped skeleton. Every requirement statement is an agent task,
 * never DocGuard prose; each candidate carries its fact marker and citation.
 * The success criteria DocGuard can state are checks it runs itself: SPR007
 * reports no drift for the spec, and (when tests exist) those tests pass —
 * so the skeleton passes SPK003 (docguard.generated-docs-consistency#FR-004).
 * @implements docguard.generated-docs-consistency#FR-004
 */
export function renderAsBuiltSpec({ title, specId, areaRel, facts, tests, dirName, date }) {
  const cite = f => (f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '');
  const candidates = facts.map((f, i) =>
    `- **FR-${String(i + 1).padStart(3, '0')}**: <!-- agent: state the observable behaviour of ${FACT_NOUN[f.kind](f)} as the code implements it today -->${cite(f)}\n  <!-- docguard:fact ${f.kind} ${f.key} -->`);
  return `# Feature Specification: ${title}

**Feature Branch**: \`${dirName}\`

**Created**: ${date}

**Status**: As-built

**Spec ID**: \`${specId}\`

**Source paths**: \`${areaRel}\`

**Input**: As-built specification of existing code, generated by \`docguard generate --spec ${areaRel}\`. It records current behaviour; it is not a decision to keep that behaviour.

## Problem

<!-- agent: what this area does, for whom, and why a specification is needed now (refactor, migration, onboarding). Ground every sentence in the code under ${areaRel}. -->

## User Scenarios & Testing *(mandatory)*

<!-- agent: the user-visible journeys this area supports today, each with Given/When/Then acceptance scenarios taken from observed behaviour. -->

## Requirements *(mandatory)*

### Functional Requirements

One candidate per fact DocGuard found under \`${areaRel}\`. Replace each agent note with the requirement; keep the fact marker. A fact that should not be specified belongs under Out of Scope with its marker and a reason.

${candidates.join('\n') || '<!-- no deterministic facts were found; describe behaviour manually -->'}

### Existing tests

${tests.length ? tests.map(t => `- \`${t}\``).join('\n') : '- none found under this area'}

## Success Criteria *(mandatory)*

- **SC-001**: \`docguard guard\` reports no SPR007 finding for this spec: every fact marked above still exists under \`${areaRel}\`, or is listed under Out of Scope with a reason.
${tests.length ? `- **SC-002**: The existing tests listed above pass.\n` : ''}
<!-- agent: add the measurable outcomes the current implementation meets, stated so a refactor can be checked against them. -->

## Out of Scope

<!-- move a candidate's fact marker here, with a reason, when that fact is deliberately not specified -->

## Assumptions

- Generated from deterministic scanners (routes, exported symbols, environment variables, entities). Behaviour no scanner sees must be added by hand.
`;
}

/** Fact keys a spec accounts for: markers anywhere, plus the Out of Scope set. */
export function specFactKeys(content) {
  const all = new Set();
  const outOfScope = new Set();
  const oosStart = content.search(/^## Out of Scope\s*$/m);
  const oosEnd = oosStart < 0 ? -1 : (() => { const n = content.slice(oosStart + 1).search(/^## /m); return n < 0 ? content.length : oosStart + 1 + n; })();
  for (const m of content.matchAll(FACT_MARKER_RE)) {
    const id = `${m[1]} ${m[2].trim()}`;
    all.add(id);
    if (oosStart >= 0 && m.index > oosStart && m.index < oosEnd) outOfScope.add(id);
  }
  return { all, outOfScope };
}

/**
 * Compare an as-built spec with the facts under its source paths.
 * @returns {{ unclaimed: object[], vanished: string[], tiers: {route: object, entity: object} }}
 */
export function checkAsBuiltSync(projectDir, specContent, sourcePaths, config = {}) {
  const current = new Map();
  const scanTiers = { route: [], entity: [] };
  for (const areaPath of sourcePaths) {
    const area = resolveArea(projectDir, areaPath);
    if (!area.ok) continue;
    const facts = collectAreaFacts(projectDir, area.rel, config);
    for (const f of facts) current.set(`${f.kind} ${f.key}`, f);
    for (const kind of ['route', 'entity']) if (facts.tiers?.[kind]) scanTiers[kind].push(facts.tiers[kind]);
  }
  const { all } = specFactKeys(specContent);
  const unclaimed = [...current.entries()].filter(([id]) => !all.has(id)).map(([, f]) => f);
  const vanished = [...all].filter(id => !current.has(id));
  return { unclaimed, vanished, tiers: { route: summarizeTiers(scanTiers.route), entity: summarizeTiers(scanTiers.entity) } };
}

