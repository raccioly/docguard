/**
 * Symbol map — the most central source files and the names they offer, cut to
 * a byte budget, for `memory --pack --symbols` (specs/036-symbol-map).
 *
 * Adapts Aider's repo map: files ranked by PageRank over the static import
 * graph, each listed with its exported (or top-level) symbols. Deterministic:
 * a fixed iteration count, scores rounded before sorting, ties broken by
 * path, and no text that changes between runs on the same tree.
 *
 * Symbols are read only for the files that fit the budget, so the cost
 * follows the budget, not the size of the repository (SC-002).
 *
 * @implements docguard.symbol-map#FR-001
 * @implements docguard.symbol-map#FR-002
 * @implements docguard.symbol-map#FR-003
 */

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { buildImportGraph, JS_EXTENSIONS } from './import-graph.mjs';
import { moduleSymbols } from './js-ast.mjs';
import { extractPythonFiles } from './py-ast.mjs';
import { isNonProductPath } from '../shared-ignore.mjs';

export const SYMBOL_MAP_DEFAULT_BYTES = 4096;
export const SYMBOL_MAP_MAX_BYTES = 16384;
export const MAX_SYMBOLS_PER_FILE = 12;
const DAMPING = 0.85;
const ITERATIONS = 30;

const posix = p => String(p).replace(/\\/g, '/');
const isSource = f => JS_EXTENSIONS.has(extname(f)) || extname(f) === '.py';
const isGenerated = f => /\.d\.ts$|\.min\.js$|(^|\/)(dist|build|generated|vendor)\//.test(f);

/** Bounded budget from `memory.symbolMap.maxBytes`. */
export function symbolMapBudget(config = {}) {
  const raw = config?.memory?.symbolMap?.maxBytes;
  const n = Number.isInteger(raw) ? raw : SYMBOL_MAP_DEFAULT_BYTES;
  return Math.min(SYMBOL_MAP_MAX_BYTES, Math.max(256, n));
}

/**
 * PageRank over a file graph (FR-002): damping 0.85, 30 iterations, uniform
 * teleport, dangling mass spread uniformly, scores rounded to 9 decimals, ties
 * broken by path. A cycle cannot affect termination.
 *
 * @param {string[]} nodes
 * @param {[string, string][]} edges from → to, both in `nodes`
 * @returns {{ path: string, score: number }[]} highest first
 */
export function pageRank(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return [];
  const index = new Map(nodes.map((p, i) => [p, i]));
  const out = Array.from({ length: n }, () => new Set());
  for (const [from, to] of edges) {
    if (from !== to && index.has(from) && index.has(to)) out[index.get(from)].add(index.get(to));
  }
  let rank = new Array(n).fill(1 / n);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = new Array(n).fill((1 - DAMPING) / n);
    let dangling = 0;
    for (let u = 0; u < n; u++) {
      if (out[u].size === 0) { dangling += rank[u]; continue; }
      const share = (DAMPING * rank[u]) / out[u].size;
      for (const v of out[u]) next[v] += share;
    }
    const spread = (DAMPING * dangling) / n;
    for (let v = 0; v < n; v++) next[v] += spread;
    rank = next;
  }
  return nodes
    .map((path, i) => ({ path, score: Math.round(rank[i] * 1e9) / 1e9 }))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Symbols for a batch of files; Python in one interpreter call. */
function readSymbols(projectDir, files) {
  const result = new Map();
  const py = files.filter(f => extname(f) === '.py');
  const parsed = py.length ? extractPythonFiles(py.map(f => resolve(projectDir, f))) : {};
  for (const f of files) {
    if (extname(f) === '.py') {
      const entry = parsed === null ? null : parsed[resolve(projectDir, f)];
      result.set(f, parsed === null ? { ok: false, tier: 'python-interpreter-unavailable', names: [] }
        : entry?.ok ? { ok: true, names: entry.symbols || [] } : { ok: false, tier: 'python-parse-failed', names: [] });
      continue;
    }
    let content;
    try { content = readFileSync(resolve(projectDir, f), 'utf8'); }
    catch { result.set(f, { ok: false, tier: 'unreadable', names: [] }); continue; }
    const s = moduleSymbols(content, f);
    result.set(f, s.ok ? { ok: true, names: s.names } : { ok: false, tier: 'js-parse-failed', names: [] });
  }
  return result;
}

function line(file, symbols) {
  if (!symbols.ok) return `- \`${file}\``;
  if (symbols.names.length === 0) return `- \`${file}\``;
  const shown = symbols.names.slice(0, MAX_SYMBOLS_PER_FILE);
  const more = symbols.names.length - shown.length;
  return `- \`${file}\`: ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
}

/**
 * The `## Symbol map` section. `maxBytes` bounds the whole section, footer
 * included; it stops at a whole line and says how many ranked files it left
 * out.
 *
 * @returns {{ text: string, listed: number, omitted: number, degraded: object, ranking: 'pagerank'|'symbol-count' }}
 */
export function buildSymbolMap(projectDir, config = {}, { maxBytes = symbolMapBudget(config) } = {}) {
  const graph = buildImportGraph(projectDir, config);
  const files = [...new Set(graph.files.map(posix))]
    .filter(f => isSource(f) && !isGenerated(f) && !isNonProductPath(f, config))
    .sort();
  const fileSet = new Set(files);
  const edges = graph.edges
    .filter(e => !e.dynamic)
    .map(e => [posix(e.from), posix(e.to)])
    .filter(([a, b]) => fileSet.has(a) && fileSet.has(b));

  const header = ['## Symbol map', ''];
  let ranked;
  let ranking = 'pagerank';
  let symbols = new Map();
  if (edges.length > 0) {
    ranked = pageRank(files, edges).map(r => r.path);
    header.push('Source files ranked by how central they are in the static import graph (PageRank), each with the names it exports. Names only: this says nothing about what they do.');
  } else {
    // No import edges: rank by how many names a file offers, then path.
    ranking = 'symbol-count';
    symbols = readSymbols(projectDir, files);
    ranked = [...files].sort((a, b) => symbols.get(b).names.length - symbols.get(a).names.length || (a < b ? -1 : 1));
    header.push('No import edges were found, so files are ranked by how many names they export, then by path. Names only: this says nothing about what they do.');
  }
  header.push('');

  const bytes = s => Buffer.byteLength(s, 'utf8');
  const footerReserve = 200;
  let used = bytes(header.join('\n')) + 1;
  const body = [];
  const degraded = {};
  // Read symbols in small batches as lines are placed, so a large repository
  // costs about as much as the budget allows lines for.
  for (let i = 0; i < ranked.length;) {
    const batch = ranked.slice(i, i + 16).filter(f => !symbols.has(f));
    if (batch.length) for (const [f, s] of readSymbols(projectDir, batch)) symbols.set(f, s);
    let stop = false;
    for (const f of ranked.slice(i, i + 16)) {
      const s = symbols.get(f);
      const text = line(f, s);
      if (used + bytes(text) + 1 > maxBytes - footerReserve) { stop = true; break; }
      body.push(text);
      used += bytes(text) + 1;
      if (!s.ok) degraded[s.tier] = (degraded[s.tier] || 0) + 1;
      i++;
    }
    if (stop) break;
  }
  const render = () => {
    const omitted = ranked.length - body.length;
    const footer = [];
    if (files.length === 0) footer.push('_No ranked source files._');
    if (omitted > 0) footer.push(`_${omitted} more ranked file${omitted === 1 ? '' : 's'} not shown (budget ${maxBytes} bytes)._`);
    const tiers = Object.entries(degraded).sort(([a], [b]) => (a < b ? -1 : 1));
    if (tiers.length) footer.push(`_Listed without symbols: ${tiers.map(([t, n]) => `${n} (${t})`).join(', ')}._`);
    return { text: [...header, ...body, ...(footer.length ? ['', ...footer] : [])].join('\n'), omitted };
  };
  let out = render();
  // The footer reserve is an estimate; the budget is a promise.
  while (bytes(out.text) > maxBytes && body.length) { body.pop(); out = render(); }
  return { text: out.text, listed: body.length, omitted: out.omitted, degraded, ranking };
}
