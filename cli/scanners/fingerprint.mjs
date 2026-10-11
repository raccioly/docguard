/**
 * Fingerprints shared by the doc-dependency lock and requirement anchors.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors), which
 * extracts this from specs/030-doc-dependency-lock.
 *
 * Two algorithms live here, side by side:
 *
 *   - `doclock-v0`: what `.docguard-doc-lock.json` has always recorded. A
 *     sha256 of the Babel node's JSON with positions and comments removed, or
 *     of Python's `ast.dump`. The declaration's own name is part of the hash.
 *     It must never change: every reviewed doc section in every adopting
 *     repository is pinned to it (FR-015, research P2).
 *   - `v1` (`dg1:` prefix): the anchor algorithm. It also leaves out the
 *     symbol's own name, so a rename with an unchanged body keeps its
 *     fingerprint (FR-030), and it adds the directive comments inside the span
 *     (`@ts-ignore`, `//go:build`, `# type: ignore`, ...), because those
 *     change behavior while ordinary comments do not (FR-010).
 *
 * WHY THE AST AND NOT TOKENS where a parser exists: Prettier 3 made trailing
 * commas the default. A token hash changes on every such reformat; the
 * normalized AST does not (red-team, research §4).
 *
 * @implements docguard.requirement-anchors#FR-010
 * @implements docguard.requirement-anchors#FR-011
 * @implements docguard.requirement-anchors#FR-015
 */

import { createHash } from 'node:crypto';

export const ALGO_DOCLOCK_V0 = 'doclock-v0';
export const ALGO_V1 = 'v1';
export const V1_PREFIX = 'dg1:';
export const BABEL_TIER = 'babel@7';

const AST_METADATA = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments',
  'trailingComments', 'innerComments', 'tokens', 'errors']);

/** Comment bodies that change how code compiles, lints or is tree-shaken. */
export const DIRECTIVE_RE = /^\s*(?:@ts-(?:ignore|expect-error|nocheck)\b|eslint-disable|go:(?:build|generate)\b|\+build\b|[#@]__PURE__|type:\s*ignore\b|noqa\b|pragma:\s*no\s+cover\b)/;

/** doclock-v0 digest: `sha256:<hex>`. */
export const sha256 = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** v1 digest: `dg1:sha256:<hex>`. */
export const dg1 = text => `${V1_PREFIX}${sha256(text)}`;

export const isV1 = fp => typeof fp === 'string' && /^dg1:sha256:[0-9a-f]{64}$/.test(fp);

/** doclock-v0 normalization of a Babel node (positions and comments removed, name kept). */
export function normalizeJsV0(node) {
  return JSON.stringify(node, (key, value) => (AST_METADATA.has(key) ? undefined : value));
}

/**
 * v1 fingerprint of a Babel node: v0 normalization without the root's own
 * name (`id` of a function, class or variable declarator, `key` of a method),
 * followed by the directive comments inside the node's span, in order.
 */
export function jsFingerprintV1(node, comments = []) {
  const json = JSON.stringify(node, function replacer(key, value) {
    if (AST_METADATA.has(key)) return undefined;
    if (this === node && (key === 'id' || key === 'key')) return undefined;
    return value;
  });
  const directives = comments
    .filter(c => c.start >= node.start && c.end <= node.end && DIRECTIVE_RE.test(c.value))
    .map(c => `directive:${c.value.trim()}`);
  return dg1([json, ...directives].join('\u0000'));
}

/** v1 fingerprint of a Python field-walk serialization plus its directive comments. */
export function pyFingerprintV1(serialized, directives = []) {
  return dg1([serialized, ...directives.map(d => `directive:${d.trim()}`)].join('\u0000'));
}

/** The members a node can be descended into by name, in source order. */
function namedChildren(node) {
  const out = [];
  const add = (name, child) => { if (name !== undefined && name !== null) out.push([String(name), child]); };
  const declare = stmt => {
    if (!stmt) return;
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') return declare(stmt.declaration);
    if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) add(d.id?.name, d);
    else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration' || stmt.type === 'TSEnumDeclaration'
      || stmt.type === 'TSInterfaceDeclaration' || stmt.type === 'TSModuleDeclaration') add(stmt.id?.name, stmt);
  };
  const target = node.type === 'VariableDeclarator' ? node.init : node;
  if (!target) return out;
  const classBody = target.body?.type === 'ClassBody' ? target.body.body : null;
  if (classBody) for (const m of classBody) add(m.key?.name ?? m.key?.value, m);
  else if (target.type === 'ObjectExpression') for (const p of target.properties) add(p.key?.name ?? p.key?.value, p);
  else if (Array.isArray(target.body?.body)) for (const stmt of target.body.body) declare(stmt);
  else if (target.type === 'TSModuleDeclaration' && Array.isArray(target.body?.body)) for (const stmt of target.body.body) declare(stmt);
  return out;
}

/**
 * The declaration named `symbol` in a Babel AST: a top-level declaration or
 * named export, then members by name at any depth (`Class.method`,
 * `fn.helper`, `Ns.Inner.method`). One- and two-part names resolve exactly as
 * the doc lock always has (doclock-v0 compatibility).
 */
export function findJsSymbol(ast, symbol) {
  const [name, ...members] = symbol.split('.');
  const body = ast?.program?.body || [];
  const locals = new Map();
  const exportsByName = new Map();
  const add = (id, node) => { if (id && !locals.has(id)) locals.set(id, node); };
  const declare = decl => {
    if (!decl) return;
    if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) add(d.id?.name, d);
    else add(decl.id?.name, decl);
  };
  for (const stmt of body) {
    if (stmt.type === 'ExportNamedDeclaration') {
      declare(stmt.declaration);
      for (const s of stmt.specifiers || []) {
        const exported = s.exported?.name ?? s.exported?.value;
        if (exported && s.local?.name) exportsByName.set(exported, s.local.name);
      }
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      add('default', stmt.declaration);
      declare(stmt.declaration?.id ? stmt.declaration : null);
    } else declare(stmt);
  }
  let node = locals.get(name) || locals.get(exportsByName.get(name));
  for (const member of members) {
    if (!node) return null;
    // The original two-part lookup read class bodies only; keep that first.
    const classBody = node.body?.body || node.init?.body?.body || [];
    const direct = Array.isArray(classBody) ? classBody.find(m => (m.key?.name ?? m.key?.value) === member) : null;
    node = direct || namedChildren(node).find(([n]) => n === member)?.[1] || null;
  }
  return node || null;
}
