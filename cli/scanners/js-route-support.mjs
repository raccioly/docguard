/**
 * Helpers shared by the NestJS, Cloudflare Workers and Hono/itty-router route
 * readers (docguard.js-framework-routes): one parse per file with the tier it
 * was read at, served-path joining, and the test-file rule.
 *
 * @implements docguard.js-framework-routes#FR-006
 */

import { tierFor } from '../shared-source.mjs';
import { isNonProductPath } from '../shared-ignore.mjs';
import { parseJsTs, astTierAvailable } from './js-ast.mjs';
import { createAliasResolver, resolveModuleFile } from './ts-paths.mjs';
import { dirname, resolve } from 'node:path';

/**
 * Parse a JS/TS file once and say which tier it was read at: `js-ast` with a
 * syntax tree, else `regex-fallback` with the reason (the file did not parse,
 * or the parser is not installed).
 * @returns {{ ast: object|null, tier: string, tierReason: string|null }}
 */
export function parseWithTier(content, abs) {
  const parsed = parseJsTs(content, abs);
  const tier = parsed.ok
    ? tierFor(abs, { ok: true })
    : astTierAvailable() ? tierFor(abs, { ok: false, error: parsed.error }) : tierFor(abs, null);
  return { ast: parsed.ok ? parsed.ast : null, ...tier };
}

/** 1-based line of a character offset. */
export function lineAt(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

/**
 * Join path pieces the way a router serves them: single slashes, a leading
 * slash, no trailing slash, `/` for nothing. `:param` and `*` are kept.
 */
export function joinSegments(...parts) {
  const segs = [];
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    for (const seg of String(part).split('/')) if (seg) segs.push(seg);
  }
  return `/${segs.join('/')}`;
}

/** A test, fixture or example file: never a source of application settings. */
export function isTestFile(rel, config = {}) {
  return isNonProductPath(rel, config) || /\.(?:spec|test|e2e-spec|e2e)\.[cm]?[jt]sx?$/.test(rel);
}

/** Source text of a node, for a limitation's `target`. */
export function nodeText(content, node) {
  return node && typeof node.start === 'number' ? String(content).slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 80) : '';
}

/**
 * Mask comments and string bodies in JS/TS source without moving any offset,
 * for the pattern fallback (the contract of `lexCLike` in route-lexing.mjs,
 * with JavaScript's three quote forms). `lits` maps each literal's opening
 * quote to `{ value, end }`; a template with `${…}` has `value: null`.
 * @returns {{ code: string, lits: Map<number, { value: string|null, end: number }> }}
 */
export function lexJs(src) {
  const n = src.length;
  const out = src.split('');
  const lits = new Map();
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let value = '';
      let dynamic = false;
      while (j < n && src[j] !== c && (c === '`' || src[j] !== '\n')) {
        if (src[j] === '\\' && j + 1 < n) { value += src[j + 1]; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') dynamic = true;
        value += src[j];
        j++;
      }
      const end = Math.min(n, j + 1);
      out[i] = '"';
      for (let k = i + 1; k < end - 1; k++) if (out[k] !== '\n') out[k] = '\u0001';
      out[end - 1] = '"';
      lits.set(i, { value: dynamic ? null : value, end });
      i = end;
      continue;
    }
    i++;
  }
  return { code: out.join(''), lits };
}

/**
 * `resolve(fromAbs, spec)` → the project file a relative or `tsconfig`/
 * `jsconfig`-aliased import names, or null (packages are not followed). A
 * TypeScript ESM import written with `.js` finds its `.ts` source.
 */
export function createImportResolver(projectDir) {
  const alias = createAliasResolver(projectDir);
  return function resolveImport(fromAbs, spec) {
    if (!spec || typeof spec !== 'string') return null;
    if (!spec.startsWith('.')) return alias(fromAbs, spec);
    const base = resolve(dirname(fromAbs), spec);
    const found = resolveModuleFile(base);
    if (found) return found;
    const js = /\.(m|c)?jsx?$/.exec(base);
    if (!js) return null;
    const stem = base.slice(0, -js[0].length);
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
      const hit = resolveModuleFile(stem + ext);
      if (hit) return hit;
    }
    return null;
  };
}
