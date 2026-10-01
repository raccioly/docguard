/**
 * Doc ownership map — which doc section is responsible for which source paths
 * (specs/034-doc-ownership-map).
 *
 * A project declares `ownership` in `.docguard.json`:
 *
 *   { "roots": ["src"], "entries": [
 *       { "doc": "docs-canonical/ARCHITECTURE.md", "section": "component-map",
 *         "purpose": "…", "paths": ["src/api/**", "src/index.ts"] } ] }
 *
 * Each tracked file resolves to at most one owner: an exact file path beats
 * any glob, a longer literal directory prefix beats a shorter one, and any
 * other overlap is a tie with no single owner. DocGuard reads the block; it
 * never writes it, because `purpose` is prose.
 *
 * @implements docguard.doc-ownership-map#FR-001
 * @implements docguard.doc-ownership-map#FR-002
 * @implements docguard.doc-ownership-map#FR-004
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileGlob, buildIgnoreFilter, isNonProductPath, loadDocguardIgnore, relPosix, walkFiles } from '../shared-ignore.mjs';
import { listTrackedFiles } from '../shared-git.mjs';
import { extractHeadings } from '../shared-headings.mjs';
import { parseSections } from '../writers/sections.mjs';
import { scanComponents } from './inventory.mjs';

// A source file is code; docs, data and config are not "unowned code".
export const SOURCE_RE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|rb|php|cs|swift|scala|sh|bash|ps1|lua|dart|ex|exs|clj|c|cc|cpp|h|hpp|m|mm|vue|svelte)$/i;
const GLOB_CHARS = /[*?{[]/;

const _compiled = new Map(); // config key → compiled map (long-lived MCP server)

/**
 * Load and validate the `ownership` block. Unsafe or malformed input is an
 * error (OWN007), never "everything owned".
 *
 * @returns {{ present: boolean, error: string|null, roots: string[]|null, entries: object[] }}
 */
export function loadOwnership(projectDir, config = {}) {
  const block = config?.ownership;
  if (block === undefined || block === null) return { present: false, error: null, roots: null, entries: [] };
  let key;
  try { key = JSON.stringify([resolve(projectDir), block]); } catch { key = null; }
  if (key && _compiled.has(key)) return _compiled.get(key);
  const result = compile(projectDir, block);
  if (key) {
    if (_compiled.size >= 16) _compiled.delete(_compiled.keys().next().value);
    _compiled.set(key, result);
  }
  return result;
}

/** Project-relative POSIX pattern, or null when it leaves the project. */
function safePattern(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.trim().replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\') || p.includes('\0')) return null;
  if (p.split('/').includes('..')) return null;
  return p.replace(/\/+$/, '');
}

function compile(projectDir, block) {
  const fail = error => ({ present: true, error, roots: null, entries: [] });
  if (typeof block !== 'object' || Array.isArray(block)) return fail('ownership must be an object with "entries" (and optional "roots")');
  if (!Array.isArray(block.entries)) return fail('ownership.entries must be an array');
  let roots = null;
  if (block.roots !== undefined) {
    if (!Array.isArray(block.roots) || block.roots.some(r => safePattern(r) === null || GLOB_CHARS.test(r))) {
      return fail('ownership.roots must be a list of project-relative directories (no globs, no .., no absolute paths)');
    }
    roots = [...new Set(block.roots.map(safePattern))].sort();
  }
  const entries = [];
  for (const [index, e] of block.entries.entries()) {
    const where = `ownership.entries[${index}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return fail(`${where} must be an object`);
    if (typeof e.doc !== 'string' || !/\.md$/i.test(e.doc) || safePattern(e.doc) === null) return fail(`${where}.doc must be a project-relative .md path`);
    if (e.section !== undefined && (typeof e.section !== 'string' || !e.section.trim())) return fail(`${where}.section must be a non-empty string`);
    if (e.purpose !== undefined && typeof e.purpose !== 'string') return fail(`${where}.purpose must be a string`);
    if (!Array.isArray(e.paths) || e.paths.length === 0) return fail(`${where}.paths must be a non-empty list`);
    const patterns = [];
    for (const raw of e.paths) {
      const p = safePattern(raw);
      if (p === null) return fail(`${where}.paths has ${JSON.stringify(raw)}, which is not a project-relative path (no .., no absolute paths)`);
      patterns.push(compilePattern(projectDir, p));
    }
    const doc = safePattern(e.doc);
    const section = e.section?.trim() || null;
    entries.push({ index, doc, section, purpose: e.purpose || null, key: section ? `${doc}#${section}` : doc, patterns });
  }
  return { present: true, error: null, roots, entries };
}

/**
 * A pattern and its specificity. A path with no glob characters is an exact
 * file when a file exists there, and a directory (everything under it)
 * otherwise; its literal prefix is the whole path.
 */
function compilePattern(projectDir, raw) {
  if (!GLOB_CHARS.test(raw)) {
    let isFile = false;
    try { isFile = statSync(resolve(projectDir, raw)).isFile(); } catch { /* not on disk: a directory pattern */ }
    if (isFile) return { raw, exact: true, prefix: raw.length, test: p => p === raw };
    const re = compileGlob(`${raw}/**`);
    return { raw, exact: false, prefix: raw.length + 1, test: p => re.test(p) };
  }
  const literal = raw.slice(0, raw.search(GLOB_CHARS));
  const prefix = literal.includes('/') ? literal.slice(0, literal.lastIndexOf('/') + 1).length : 0;
  const re = compileGlob(raw);
  return { raw, exact: false, prefix, test: p => re.test(p) };
}

/**
 * The owner of one project-relative path.
 * @returns {{ owner: object|null, tie: object[]|null, candidates: number }}
 */
export function resolveOwner(map, path) {
  const hits = [];
  for (const entry of map.entries) {
    let best = null;
    for (const pattern of entry.patterns) {
      if (!pattern.test(path)) continue;
      if (!best || rank(pattern) > rank(best)) best = pattern;
    }
    if (best) hits.push({ entry, pattern: best });
  }
  if (hits.length === 0) return { owner: null, tie: null, candidates: 0 };
  hits.sort((a, b) => rank(b.pattern) - rank(a.pattern) || a.entry.index - b.entry.index);
  if (hits.length > 1 && rank(hits[0].pattern) === rank(hits[1].pattern)) {
    return { owner: null, tie: hits.filter(h => rank(h.pattern) === rank(hits[0].pattern)).map(h => h.entry), candidates: hits.length };
  }
  return { owner: { ...hits[0].entry, matchedBy: hits[0].pattern.raw }, tie: null, candidates: hits.length };
}

// Specificity is the literal prefix length. An exact path wins by
// construction: its prefix is the whole path, and a glob matching the same
// file has a literal prefix that stops at a directory boundary before it.
const rank = pattern => pattern.prefix;

/** Tracked files (or the working tree without git), minus ignored ones. */
export function projectFiles(projectDir, config = {}) {
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  let files = listTrackedFiles(projectDir);
  const tracked = files !== null;
  if (!tracked) {
    files = [];
    walkFiles(projectDir, full => { files.push(relPosix(projectDir, full)); });
  }
  return { files: files.filter(f => !ignored(f)).sort(), tracked };
}

/**
 * Default roots when the map declares none: the top-level source modules the
 * memory plan finds, plus each module's parent directory for the source files
 * directly in it (`src/pricing.mjs` beside `src/api/`). Without the second
 * part such a file was never checked (docguard.output-ux#FR-009).
 * @implements docguard.output-ux#FR-009
 * @returns {{ modules: string[], looseDirs: string[] }}
 */
export function defaultOwnershipRoots(projectDir, config = {}) {
  const modules = scanComponents(projectDir, config).filter(m => m.kind === 'module').map(m => m.path).sort();
  const looseDirs = [...new Set(modules.filter(m => m.includes('/')).map(m => m.slice(0, m.lastIndexOf('/'))))]
    .filter(dir => !modules.includes(dir)).sort();
  return { modules, looseDirs };
}

const dirName = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/**
 * Everything the validator and `trace --owners` report.
 *
 * Roots: declared, or the top-level source modules the memory plan finds. A
 * declared root is checked as declared; default roots skip test, fixture and
 * example paths, which are not "unowned code".
 */
export function ownershipReport(projectDir, config = {}) {
  const map = loadOwnership(projectDir, config);
  if (!map.present || map.error) return { map, files: [], tracked: true, entries: [], ties: [], unowned: [], deadRoots: [], roots: [], looseDirs: [] };
  const { files, tracked } = projectFiles(projectDir, config);
  const declared = map.roots !== null;
  const defaults = declared ? { modules: [], looseDirs: [] } : defaultOwnershipRoots(projectDir, config);
  const roots = declared ? map.roots : defaults.modules;
  const looseDirs = new Set(defaults.looseDirs);
  const under = (file, root) => root === '' || file === root || file.startsWith(`${root}/`);

  const perEntry = new Map(map.entries.map(e => [e.index, { entry: e, files: 0, deadPatterns: e.patterns.map(p => p.raw) }]));
  const ties = new Map();
  const ownedDirs = new Set();
  const sources = [];
  for (const file of files) {
    const result = resolveOwner(map, file);
    for (const entry of map.entries) {
      const stats = perEntry.get(entry.index);
      if (stats.deadPatterns.length) stats.deadPatterns = stats.deadPatterns.filter(raw => !entry.patterns.find(p => p.raw === raw).test(file));
    }
    if (result.owner) {
      perEntry.get(result.owner.index).files++;
      for (let i = file.indexOf('/'); i !== -1; i = file.indexOf('/', i + 1)) ownedDirs.add(file.slice(0, i));
    }
    if (result.tie) {
      const k = result.tie.map(e => e.index).join(',');
      if (!ties.has(k)) ties.set(k, { entries: result.tie, example: file, count: 0 });
      ties.get(k).count++;
    }
    let root = roots.find(r => under(file, r));
    const loose = root === undefined && looseDirs.has(dirName(file));
    if (loose) root = dirName(file);
    if (root === undefined || !SOURCE_RE.test(file)) continue;
    if (!declared && isNonProductPath(file, config)) continue;
    sources.push({ file, root, loose, owned: Boolean(result.owner) || Boolean(result.tie) });
  }

  // The highest directory under the root with no owned file in it; a file in
  // a directory that also holds owned files is reported on its own.
  const unowned = new Set();
  for (const s of sources.filter(x => !x.owned)) {
    if (s.loose) { unowned.add(s.file); continue; }
    const parts = s.file.split('/');
    let reported = s.file;
    const start = s.root === '' ? 0 : s.root.split('/').length;
    for (let depth = start; depth < parts.length; depth++) {
      const dir = parts.slice(0, depth).join('/');
      if (depth === 0 && s.root !== '') continue;
      if (dir && !ownedDirs.has(dir)) { reported = dir; break; }
    }
    unowned.add(reported);
  }
  const deadRoots = roots.filter(r => !files.some(f => under(f, r)));
  return {
    map,
    files,
    tracked,
    roots,
    looseDirs: [...looseDirs],
    entries: [...perEntry.values()],
    ties: [...ties.values()],
    unowned: [...unowned].sort(),
    deadRoots,
  };
}

/**
 * Whether an entry's doc and section exist. A section is a `docguard:section`
 * id or a heading anchor in that doc.
 * @returns {string|null} what is missing, or null
 */
export function entryTargetProblem(projectDir, entry) {
  const full = resolve(projectDir, entry.doc);
  if (!existsSync(full)) return `${entry.doc} does not exist`;
  if (!entry.section) return null;
  let content;
  try { content = readFileSync(full, 'utf8'); } catch { return `${entry.doc} is unreadable`; }
  const id = entry.section.replace(/^#/, '');
  if (parseSections(content).some(s => s.id === id)) return null;
  if (extractHeadings(content).some(h => h.anchor === id)) return null;
  return `${entry.doc} has no section or heading anchor "${id}"`;
}

/** The declared owner of `path`, for `docguard_docs_for_path` and `trace --reverse`. */
export function ownerOf(projectDir, config, path) {
  const map = loadOwnership(projectDir, config);
  if (!map.present) return { owner: null, configured: false, reason: 'no ownership map is configured' };
  if (map.error) return { owner: null, reason: `the ownership map is invalid: ${map.error}` };
  const result = resolveOwner(map, path);
  if (result.tie) return { owner: null, tie: result.tie.map(e => e.key), reason: `${result.tie.length} entries are equally specific for this path: ${result.tie.map(e => e.key).join(', ')}` };
  if (!result.owner) return { owner: null, reason: 'no ownership entry matches this path' };
  const { key, doc, section, purpose, matchedBy } = result.owner;
  return { owner: { key, doc, section, purpose, matchedBy, source: 'declared' }, reason: null };
}

/**
 * Devin's `.devin/wiki.json` rules, checked against
 * https://docs.devin.ai/work-with-devin/deepwiki on 2026-09-30 (FR-006):
 * `repo_notes` and `pages` are required; `pages` has at least one page, each
 * with a unique non-empty `title` and a `purpose`; a note is `{ content,
 * author? }`. Limits: 30 pages (80 on enterprise, so `devinWiki.maxPages` is
 * configurable), 100 notes counting `repo_notes` and every `page_notes`
 * together, 10,000 characters per note (counted in code points: the docs do
 * not say, and this reports only what is certainly over).
 */
export const DEVIN_WIKI = Object.freeze({
  path: '.devin/wiki.json',
  maxPages: 30,
  maxPagesEnterprise: 80,
  maxNotes: 100,
  maxNoteChars: 10000,
  checked: '2026-09-30',
  source: 'https://docs.devin.ai/work-with-devin/deepwiki',
});

// Paths in wiki text: backticked or bare, a file with an extension or a
// directory written with a trailing slash ("the cui/ folder").
const WIKI_PATH_RE = /(?:^|[\s(`'"])((?:\.?[\w-]+\/)+(?:[\w.-]+\.[A-Za-z]\w{0,9})?)(?=$|[\s)`'",.;:!?])/g;

/**
 * @returns {{ present: boolean, error: string|null, problems: {where: string, message: string}[],
 *   paths: {where: string, path: string}[] }}
 */
export function lintDevinWiki(projectDir, config = {}) {
  const full = resolve(projectDir, DEVIN_WIKI.path);
  if (!existsSync(full)) return { present: false, error: null, problems: [], paths: [] };
  let wiki;
  try { wiki = JSON.parse(readFileSync(full, 'utf8')); }
  catch (error) { return { present: true, error: `${DEVIN_WIKI.path} is not valid JSON: ${error.message}`, problems: [], paths: [] }; }
  if (!wiki || typeof wiki !== 'object' || Array.isArray(wiki)) return { present: true, error: `${DEVIN_WIKI.path} must be a JSON object`, problems: [], paths: [] };
  const maxPages = Number.isInteger(config?.devinWiki?.maxPages)
    ? Math.min(Math.max(config.devinWiki.maxPages, 1), DEVIN_WIKI.maxPagesEnterprise) : DEVIN_WIKI.maxPages;
  const problems = [];
  const paths = [];
  const noteText = (note, where) => {
    if (!note || typeof note !== 'object' || typeof note.content !== 'string') {
      problems.push({ where, message: 'a note must be an object with a string "content"' });
      return;
    }
    const chars = [...note.content].length;
    if (chars > DEVIN_WIKI.maxNoteChars) problems.push({ where, message: `the note has ${chars} characters; Devin allows ${DEVIN_WIKI.maxNoteChars}` });
    collectPaths(note.content, where, paths);
  };
  if (!Array.isArray(wiki.repo_notes)) problems.push({ where: 'repo_notes', message: '"repo_notes" is required (use [] when there are none)' });
  if (!Array.isArray(wiki.pages) || wiki.pages.length === 0) problems.push({ where: 'pages', message: '"pages" is required and must list at least one page; Devin rejects the file otherwise' });
  let notes = 0;
  for (const [i, note] of (Array.isArray(wiki.repo_notes) ? wiki.repo_notes : []).entries()) { notes++; noteText(note, `repo_notes[${i}]`); }
  const pages = Array.isArray(wiki.pages) ? wiki.pages : [];
  if (pages.length > maxPages) problems.push({ where: 'pages', message: `${pages.length} pages; Devin allows ${maxPages}${maxPages === DEVIN_WIKI.maxPages ? ` (${DEVIN_WIKI.maxPagesEnterprise} on enterprise: set devinWiki.maxPages)` : ''}` });
  const titles = new Map();
  for (const [i, page] of pages.entries()) {
    const where = `pages[${i}]`;
    if (!page || typeof page !== 'object') { problems.push({ where, message: 'a page must be an object' }); continue; }
    if (typeof page.title !== 'string' || !page.title.trim()) problems.push({ where, message: 'a page needs a non-empty "title"' });
    else if (titles.has(page.title)) problems.push({ where, message: `title "${page.title}" repeats ${titles.get(page.title)}; titles must be unique` });
    else titles.set(page.title, where);
    if (typeof page.purpose !== 'string') problems.push({ where, message: 'a page needs a "purpose"' });
    else collectPaths(page.purpose, `${where}.purpose`, paths);
    for (const [j, note] of (Array.isArray(page.page_notes) ? page.page_notes : []).entries()) { notes++; noteText(note, `${where}.page_notes[${j}]`); }
  }
  if (notes > DEVIN_WIKI.maxNotes) problems.push({ where: 'notes', message: `${notes} notes across repo_notes and page_notes; Devin allows ${DEVIN_WIKI.maxNotes} in total` });
  return { present: true, error: null, problems, paths };
}

function collectPaths(text, where, out) {
  for (const m of String(text).matchAll(WIKI_PATH_RE)) {
    const path = m[1].replace(/^\.\//, '');
    if (/^https?:|:\/\//.test(path) || path.split('/').includes('..')) continue;
    out.push({ where, path });
  }
}
