/**
 * Module diagram — a mermaid `graph LR` of a project's modules and the static
 * imports between them, derived from the import graph
 * (specs/035-code-derived-diagrams).
 *
 * The diagram lives in a `source=code` section, so Generated-Staleness (GST002)
 * reports it when the imports change and `sync --write` redraws it. That only
 * works if the same imports always produce the same bytes: nodes and edges are
 * sorted by path, ids come from paths, and nothing in the output changes unless
 * the module graph does.
 *
 * @implements docguard.code-derived-diagrams#FR-002
 * @implements docguard.code-derived-diagrams#FR-003
 * @implements docguard.code-derived-diagrams#FR-004
 */

import { createHash } from 'node:crypto';
import { isNonProductPath } from '../shared-ignore.mjs';

export const MODULE_GRAPH_DEFAULTS = Object.freeze({ depth: 2, maxNodes: 30 });
export const MAX_NODES_CAP = 60;
export const MAX_EDGES = 150;
const MERGED_ID = 'merged_modules';
const MERGED_KEY = '￿';

/** Resolve `diagrams.moduleGraph` into bounded options. */
export function moduleGraphOptions(config = {}) {
  const raw = config?.diagrams?.moduleGraph || {};
  const int = (value, fallback, min, max) => {
    const n = Number.isInteger(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const include = Array.isArray(raw.include)
    ? [...new Set(raw.include.filter(p => typeof p === 'string')
      .map(p => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
      .filter(Boolean))].sort()
    : [];
  return {
    depth: int(raw.depth, MODULE_GRAPH_DEFAULTS.depth, 1, 8),
    maxNodes: int(raw.maxNodes, MODULE_GRAPH_DEFAULTS.maxNodes, 2, MAX_NODES_CAP),
    include,
  };
}

/** The module a file belongs to: the first `depth` segments of its directory. */
export function moduleOf(file, depth) {
  const slash = file.lastIndexOf('/');
  if (slash < 0) return '.';
  return file.slice(0, slash).split('/').slice(0, depth).join('/');
}

const posix = p => String(p).replace(/\\/g, '/');

/**
 * Environment-dependent gaps make the diagram partial: the same code would
 * draw differently on a runner with Python, or where the file is readable.
 * Code-dependent gaps (a dynamic Python import) draw the same everywhere, so
 * they are captioned instead.
 */
const PARTIAL_CODES = {
  'python-interpreter-unavailable': 'Python interpreter unavailable',
  'python-parse-failed': 'Python file could not be parsed',
  'source-unreadable': 'source file unreadable',
};
const UNDRAWN_CODES = new Set(['python-dynamic-import', 'python-path-mutation']);

/**
 * Turn an import graph into the module-graph section.
 *
 * @param {{files:string[], edges:{from,to,dynamic}[], unsupportedFiles?:string[], limitations?:object[]}} graph
 * @returns {{body:string, completeness:'complete'|'partial', partialReason:string|null,
 *   nodes:number, edges:number}}
 */
export function renderModuleGraph(graph, config = {}) {
  const options = moduleGraphOptions(config);
  const inScope = file => !isNonProductPath(file, config)
    && (options.include.length === 0 || options.include.some(p => file === p || file.startsWith(`${p}/`)));
  const files = [...new Set((graph.files || []).map(posix).filter(inScope))].sort();
  const fileSet = new Set(files);
  const imports = (graph.edges || [])
    .map(e => ({ from: posix(e.from), to: posix(e.to), dynamic: !!e.dynamic }))
    .filter(e => fileSet.has(e.from) && fileSet.has(e.to));

  // Completeness and captions consider only files the diagram draws.
  const partialFiles = new Map();
  const undrawn = new Set();
  for (const item of graph.limitations || []) {
    if (item.code === 'python-interpreter-unavailable') {
      for (const f of (graph.unsupportedFiles || []).map(posix).filter(inScope)) partialFiles.set(f, PARTIAL_CODES[item.code]);
    } else if (PARTIAL_CODES[item.code] && item.file && inScope(posix(item.file))) {
      partialFiles.set(posix(item.file), PARTIAL_CODES[item.code]);
    } else if (UNDRAWN_CODES.has(item.code) && item.file && inScope(posix(item.file))) {
      undrawn.add(posix(item.file));
    }
  }
  const reasons = [...new Set(partialFiles.values())].sort();
  const partialReason = partialFiles.size
    ? `${reasons.join('; ')} (${partialFiles.size} file${partialFiles.size === 1 ? '' : 's'})`
    : null;

  // Group one level higher until the modules fit (User Story 2).
  let depth = options.depth;
  let modules = groupModules(files, imports, depth);
  while (modules.names.length > options.maxNodes && depth > 1) {
    depth--;
    modules = groupModules(files, imports, depth);
  }

  // Still too many: keep the best-connected, merge the rest into one node.
  let merged = [];
  let names = modules.names;
  let pairs = modules.pairs;
  if (names.length > options.maxNodes) {
    const degree = new Map(names.map(n => [n, new Set()]));
    for (const { from, to } of pairs.values()) { degree.get(from).add(to); degree.get(to).add(from); }
    const ranked = [...names].sort((a, b) => (degree.get(b).size - degree.get(a).size) || cmp(a, b));
    const keep = new Set(ranked.slice(0, options.maxNodes - 1));
    merged = ranked.slice(options.maxNodes - 1).sort(cmp);
    names = [...keep].sort(cmp);
    const folded = new Map();
    for (const edge of pairs.values()) {
      const from = keep.has(edge.from) ? edge.from : MERGED_KEY;
      const to = keep.has(edge.to) ? edge.to : MERGED_KEY;
      if (from === to) continue;
      addPair(folded, from, to, edge.dynamic);
    }
    pairs = folded;
  }

  // Cap edges: those touching the merged node go first, then the latest by path.
  const ordered = [...pairs.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  const priority = [
    ...ordered.filter(e => e.from !== MERGED_KEY && e.to !== MERGED_KEY),
    ...ordered.filter(e => e.from === MERGED_KEY || e.to === MERGED_KEY),
  ];
  const kept = new Set(priority.slice(0, MAX_EDGES));
  const edges = ordered.filter(e => kept.has(e));

  const ids = nodeIds(names);
  if (merged.length) ids.set(MERGED_KEY, MERGED_ID);
  const label = name => name === MERGED_KEY ? `${merged.length} more modules` : name === '.' ? '(root)' : name;
  const lines = ['```mermaid', 'graph LR'];
  for (const name of [...names, ...(merged.length ? [MERGED_KEY] : [])]) {
    lines.push(`  ${ids.get(name)}["${label(name).replace(/"/g, '#quot;')}"]`);
  }
  for (const e of edges) lines.push(`  ${ids.get(e.from)} ${e.dynamic ? '-.->' : '-->'} ${ids.get(e.to)}`);
  lines.push('```');

  const notes = [];
  if (edges.some(e => e.dynamic)) notes.push('a dashed edge is a dynamic `import()` only');
  if (depth !== options.depth) notes.push(`grouped at directory depth ${depth} instead of ${options.depth} to fit ${options.maxNodes} nodes`);
  if (merged.length) notes.push(`the ${merged.length} least-connected modules are merged into one node`);
  if (ordered.length > edges.length) notes.push(`${ordered.length - edges.length} of ${ordered.length} edges are not drawn (limit ${MAX_EDGES})`);
  if (undrawn.size) {
    const one = undrawn.size === 1;
    notes.push(`${undrawn.size} Python file${one ? ' imports' : 's import'} dynamically or ${one ? 'changes' : 'change'} \`sys.path\`; those imports are not drawn`);
  }
  if (partialReason) notes.push(`partial: ${partialReason}`);

  const body = files.length === 0
    // Stated positively: generated text must pass DocGuard's own prose checks
    // (DQ007 negation load; docguard.generated-docs-consistency#FR-011).
    ? '_Module graph: empty. The import scanner reads JavaScript, TypeScript and Python files and found zero here._'
    : `${lines.join('\n')}${notes.length ? `\n\n_Module graph: ${notes.join('; ')}._` : ''}`;
  return {
    body,
    completeness: partialReason ? 'partial' : 'complete',
    partialReason,
    nodes: names.length + (merged.length ? 1 : 0),
    edges: edges.length,
  };
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addPair(pairs, from, to, dynamic) {
  const key = `${from}\n${to}`;
  const existing = pairs.get(key);
  // An edge is dashed only when every import behind it is dynamic.
  if (existing) existing.dynamic = existing.dynamic && dynamic;
  else pairs.set(key, { from, to, dynamic });
}

function groupModules(files, imports, depth) {
  const names = [...new Set(files.map(f => moduleOf(f, depth)))].sort(cmp);
  const pairs = new Map();
  for (const e of imports) {
    const from = moduleOf(e.from, depth);
    const to = moduleOf(e.to, depth);
    if (from !== to) addPair(pairs, from, to, e.dynamic);
  }
  return { names, pairs };
}

/**
 * Ids come from paths (`cli/commands` → `m_cli_commands`), so adding a module
 * adds lines instead of renumbering. Paths that sanitize to the same id all
 * take a suffix from their own path, so no id depends on the order of others.
 */
function nodeIds(names) {
  const base = name => name === '.' ? 'm_root' : `m_${name.replace(/[^A-Za-z0-9]/g, '_')}`;
  const groups = new Map();
  for (const name of names) {
    const id = base(name);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(name);
  }
  const ids = new Map();
  for (const [id, members] of groups) {
    for (const name of members) {
      ids.set(name, members.length === 1 ? id : `${id}_${createHash('sha256').update(name).digest('hex').slice(0, 6)}`);
    }
  }
  return ids;
}
