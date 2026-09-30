/**
 * Doc dependency lock: which code a documentation section describes, what
 * that code looked like when the section was last reviewed, and whether it
 * has changed since.
 *
 * Spec: specs/030-doc-dependency-lock (docguard.doc-dependency-lock).
 *
 * A section declares its dependencies on its marker:
 *
 *   <!-- docguard:section id=pricing source=human covers="src/pricing.mjs#discount" -->
 *
 * `.docguard-doc-lock.json` records a fingerprint per dependency at review
 * time. A fingerprint is the hash of the symbol's normalized AST where a
 * parser exists (formatting, comments and line moves do not change it), and a
 * sha256 of the file's bytes otherwise. Each fingerprint records its tier.
 * Nothing here needs git history: the recorded revision only feeds the
 * "show me the change" command.
 *
 * WHY NOT LINE COUNTS OR FILE SIZE: a same-size edit (`30` → `90`, `>` → `>=`)
 * is exactly the drift that matters, and neither signal sees it
 * (specs/030-doc-dependency-lock/research.md, SC-004).
 *
 * @implements docguard.doc-dependency-lock#FR-001
 * @implements docguard.doc-dependency-lock#FR-002
 * @implements docguard.doc-dependency-lock#FR-003
 * @implements docguard.doc-dependency-lock#FR-008
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { buildIgnoreFilter, globMatch, listCanonicalDocs, loadDocguardIgnore, relPosix, walkFiles } from '../shared-ignore.mjs';
import { inspectSections } from '../writers/sections.mjs';
import { parseJsTs } from './js-ast.mjs';
import { pythonCommand } from './py-ast.mjs';

export const DOC_LOCK_PATH = '.docguard-doc-lock.json';
export const DOC_LOCK_SCHEMA_VERSION = 1;
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const PY_EXT = new Set(['.py']);
const AST_METADATA = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments',
  'trailingComments', 'innerComments', 'tokens', 'errors']);
const REVISION_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const sha256 = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** `a.mjs#fn, dir/**` → ['a.mjs#fn', 'dir/**'] */
export function parseCovers(value) {
  if (!value) return [];
  return [...new Set(String(value).split(',').map(s => s.trim()).filter(Boolean))];
}

/** Blank fenced code blocks so marker examples in docs are never parsed as sections. */
function withoutFences(content) {
  const lines = String(content).split('\n');
  let fence = null;
  return lines.map(line => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return '';
    }
    if (m) { fence = m[1]; return ''; }
    return line;
  }).join('\n');
}

/** Covered sections in one document: [{ id, covers: string[], line }] */
export function coveredSections(content) {
  return inspectSections(withoutFences(content)).sections
    .filter(section => section.id && section.attrs.covers !== undefined)
    .map(section => ({ id: section.id, covers: parseCovers(section.attrs.covers), line: section.openLine + 1 }));
}

/** The documents that may declare covered sections. */
export function candidateDocs(projectDir, config = {}) {
  const out = new Map();
  for (const { rel } of listCanonicalDocs(projectDir, { config })) out.set(rel, true);
  for (const rel of ['README.md', 'AGENTS.md']) if (existsSync(resolve(projectDir, rel))) out.set(rel, true);
  return [...out.keys()].sort();
}

function normalizeAst(node) {
  return JSON.stringify(node, (key, value) => (AST_METADATA.has(key) ? undefined : value));
}

/** Top-level declaration (or Class.method) named `symbol` in a Babel AST. */
function findJsSymbol(ast, symbol) {
  const [name, member] = symbol.split('.');
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
  const node = locals.get(name) || locals.get(exportsByName.get(name));
  if (!node) return null;
  if (!member) return node;
  const classBody = node.body?.body || node.init?.body?.body || [];
  return classBody.find(m => (m.key?.name ?? m.key?.value) === member) || null;
}

const PY_SCRIPT = `
import ast, json, sys
path, names = sys.argv[1], json.loads(sys.argv[2])
tree = ast.parse(open(path, encoding='utf-8').read(), filename=path)
top = {}
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        top.setdefault(node.name, node)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name): top.setdefault(t.id, node)
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        top.setdefault(node.target.id, node)
out = {}
for name in names:
    head, _, member = name.partition('.')
    node = top.get(head)
    if node is not None and member:
        node = next((m for m in getattr(node, 'body', []) if getattr(m, 'name', None) == member), None)
    out[name] = ast.dump(node, include_attributes=False) if node is not None else None
print(json.dumps(out))
`;

/**
 * A per-run context: parse caches (FR-008) and the ignore filter.
 */
export function createContext(projectDir, config = {}) {
  return {
    projectDir,
    root: realpathSync(resolve(projectDir)),
    ignored: buildIgnoreFilter(loadDocguardIgnore(projectDir)),
    contents: new Map(),
    jsAsts: new Map(),
    pySymbols: new Map(),
    files: null,
    config,
  };
}

/** Refuse anything that is not a plain file inside the project. */
function safePath(ctx, rel) {
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) return { ok: false, reason: 'must be a relative path inside the project' };
  const abs = resolve(ctx.projectDir, rel);
  if (!existsSync(abs)) return { ok: false, reason: 'does not exist' };
  if (lstatSync(abs).isSymbolicLink()) return { ok: false, reason: 'is a symbolic link' };
  const real = realpathSync(abs);
  if (real !== ctx.root && !real.startsWith(`${ctx.root}${sep}`)) return { ok: false, reason: 'resolves outside the project' };
  if (!lstatSync(abs).isFile()) return { ok: false, reason: 'is not a file' };
  if (ctx.ignored(rel)) return { ok: false, reason: 'is excluded by .docguardignore' };
  return { ok: true, abs };
}

function read(ctx, abs) {
  if (!ctx.contents.has(abs)) ctx.contents.set(abs, readFileSync(abs));
  return ctx.contents.get(abs);
}

function pySymbolDump(ctx, abs, symbol) {
  const py = pythonCommand();
  if (!py) return { unavailable: true };
  const key = abs;
  if (!ctx.pySymbols.has(key)) ctx.pySymbols.set(key, new Map());
  const cache = ctx.pySymbols.get(key);
  if (!cache.has(symbol)) {
    const r = spawnSync(py, ['-c', PY_SCRIPT, abs, JSON.stringify([symbol])], { encoding: 'utf8', timeout: 15000 });
    let dump = null;
    try { dump = r.status === 0 ? JSON.parse(r.stdout)[symbol] : undefined; } catch { dump = undefined; }
    cache.set(symbol, dump);
  }
  const dump = cache.get(symbol);
  return dump === undefined ? { parseFailed: true } : { dump };
}

function listFiles(ctx) {
  if (!ctx.files) {
    ctx.files = [];
    walkFiles(ctx.projectDir, abs => { ctx.files.push(relPosix(ctx.projectDir, abs)); });
    ctx.files.sort();
  }
  return ctx.files;
}

const isGlob = ref => /[*?[\]{}]/.test(ref);

/**
 * Fingerprint one dependency. `preferTier` asks for the tier the lock was
 * recorded with, so an environment that lacks a parser reports that it cannot
 * compare instead of reporting a change.
 * @returns {{ ok: true, tier, fingerprint } | { ok: false, missing?: boolean, unverifiable?: boolean, reason }}
 */
export function fingerprint(ctx, ref, { preferTier = null } = {}) {
  if (isGlob(ref)) {
    const matches = listFiles(ctx).filter(rel => globMatch(rel, [ref]) && !ctx.ignored(rel));
    if (!matches.length) return { ok: false, missing: true, reason: `glob ${ref} matches no file outside .docguardignore` };
    const lines = [];
    for (const rel of matches) {
      const fp = fingerprint(ctx, rel);
      if (!fp.ok) return fp;
      lines.push(`${rel}\t${fp.fingerprint}`);
    }
    return { ok: true, tier: 'glob', fingerprint: sha256(lines.join('\n')) };
  }
  const hash = ref.indexOf('#');
  const path = hash < 0 ? ref : ref.slice(0, hash);
  const symbol = hash < 0 ? null : ref.slice(hash + 1);
  const safe = safePath(ctx, path);
  if (!safe.ok) return { ok: false, missing: safe.reason === 'does not exist', reason: `${path} ${safe.reason}` };
  const bytes = read(ctx, safe.abs);
  if (!symbol) return { ok: true, tier: 'content', fingerprint: sha256(bytes) };
  const ext = extname(path).toLowerCase();
  if (JS_EXT.has(ext)) {
    if (!ctx.jsAsts.has(safe.abs)) ctx.jsAsts.set(safe.abs, parseJsTs(bytes.toString('utf8'), path));
    const parsed = ctx.jsAsts.get(safe.abs);
    if (parsed.ok && parsed.ast && !parsed.ast.errors?.length) {
      const node = findJsSymbol(parsed.ast, symbol);
      if (!node) return { ok: false, missing: true, reason: `${path} has no top-level symbol ${symbol}` };
      return { ok: true, tier: 'ast', fingerprint: sha256(normalizeAst(node)) };
    }
    if (preferTier === 'ast') return { ok: false, unverifiable: true, reason: `${path} did not parse, so its ${symbol} AST fingerprint cannot be compared` };
    return { ok: true, tier: 'content', fingerprint: sha256(bytes) };
  }
  if (PY_EXT.has(ext)) {
    const r = pySymbolDump(ctx, safe.abs, symbol);
    if (r.dump === null) return { ok: false, missing: true, reason: `${path} has no top-level symbol ${symbol}` };
    if (r.dump) return { ok: true, tier: 'python-ast', fingerprint: sha256(r.dump) };
    if (preferTier === 'python-ast') return { ok: false, unverifiable: true, reason: `python3 is ${r.unavailable ? 'unavailable' : 'unable to parse the file'}, so ${ref} cannot be compared at the python-ast tier` };
    return { ok: true, tier: 'content', fingerprint: sha256(bytes) };
  }
  // No parser for this language: the whole file stands in for the symbol.
  return { ok: true, tier: 'content', fingerprint: sha256(bytes) };
}

/** Deterministic serialization: sorted keys at every level, trailing newline. */
export function serializeLock(lock) {
  const sort = value => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
    return value;
  };
  return `${JSON.stringify(sort(lock), null, 2)}\n`;
}

/** @returns {{ exists: boolean, lock: object|null, error: string|null }} */
export function readLock(projectDir) {
  const p = resolve(projectDir, DOC_LOCK_PATH);
  if (!existsSync(p)) return { exists: false, lock: { schemaVersion: DOC_LOCK_SCHEMA_VERSION, sections: {} }, error: null };
  let lock;
  try { lock = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { exists: true, lock: null, error: `${DOC_LOCK_PATH} is not valid JSON: ${e.message}` }; }
  const problem = lockProblem(lock);
  return problem ? { exists: true, lock: null, error: `${DOC_LOCK_PATH}: ${problem}` } : { exists: true, lock, error: null };
}

function lockProblem(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return 'must be an object';
  if (lock.schemaVersion !== DOC_LOCK_SCHEMA_VERSION) return `unsupported schemaVersion ${JSON.stringify(lock.schemaVersion)}`;
  if (Object.keys(lock).some(k => !['schemaVersion', 'sections'].includes(k))) return 'has unknown top-level fields';
  if (!lock.sections || typeof lock.sections !== 'object' || Array.isArray(lock.sections)) return 'sections must be an object';
  for (const [key, entry] of Object.entries(lock.sections)) {
    if (!/^[^#\s]+#[\w.-]+$/.test(key)) return `invalid section key ${JSON.stringify(key)}`;
    if (!entry || typeof entry !== 'object') return `${key} must be an object`;
    if (Object.keys(entry).some(k => !['reviewedRevision', 'reviewedAt', 'reason', 'dependencies'].includes(k))) return `${key} has unknown fields`;
    if (entry.reviewedRevision !== null && !REVISION_RE.test(entry.reviewedRevision || '')) return `${key}.reviewedRevision must be a full revision or null`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt || '')) return `${key}.reviewedAt must be YYYY-MM-DD`;
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8 || entry.reason.length > 500) return `${key}.reason must be 8-500 characters`;
    if (!entry.dependencies || typeof entry.dependencies !== 'object' || !Object.keys(entry.dependencies).length) return `${key}.dependencies must list at least one dependency`;
    for (const [ref, dep] of Object.entries(entry.dependencies)) {
      if (!['ast', 'python-ast', 'content', 'glob'].includes(dep?.tier)) return `${key} → ${ref}: unknown tier`;
      if (!/^sha256:[0-9a-f]{64}$/.test(dep?.fingerprint || '')) return `${key} → ${ref}: invalid fingerprint`;
    }
  }
  return null;
}

export function revisionResolves(projectDir, revision) {
  if (!REVISION_RE.test(revision || '')) return false;
  try { execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], { cwd: projectDir, stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * Status of every covered section and every lock entry.
 * @returns {{ lockError: string|null, sections: object[], orphans: object[], anyCovered: boolean }}
 */
export function docLockStatus(projectDir, config = {}, ctx = createContext(projectDir, config)) {
  const { lock, error, exists } = readLock(projectDir);
  const entries = lock?.sections || {};
  const sections = [];
  const seen = new Set();
  for (const doc of candidateDocs(projectDir, config)) {
    let content;
    try { content = readFileSync(resolve(projectDir, doc), 'utf8'); } catch { continue; }
    for (const section of coveredSections(content)) {
      const key = `${doc}#${section.id}`;
      seen.add(key);
      const entry = entries[key];
      const deps = section.covers.map(ref => {
        const locked = entry?.dependencies?.[ref];
        const current = fingerprint(ctx, ref, { preferTier: locked?.tier || null });
        let state;
        if (!current.ok) state = current.unverifiable ? 'unverifiable' : 'missing';
        else if (!locked) state = 'unlocked';
        else if (locked.tier !== current.tier || locked.fingerprint !== current.fingerprint) state = 'changed';
        else state = 'current';
        const path = ref.includes('#') ? ref.slice(0, ref.indexOf('#')) : ref;
        return { ref, path, state, tier: current.tier || locked?.tier || null, reason: current.reason || null, locked: locked || null, current: current.ok ? { tier: current.tier, fingerprint: current.fingerprint } : null };
      });
      const droppedRefs = entry ? Object.keys(entry.dependencies).filter(ref => !section.covers.includes(ref)) : [];
      let state;
      if (!section.covers.length) state = 'empty';
      else if (!entry) state = 'unaccepted';
      else if (deps.some(d => d.state === 'missing')) state = 'missing-dependency';
      else if (deps.some(d => d.state === 'changed')) state = 'changed';
      else if (deps.some(d => d.state === 'unlocked') || droppedRefs.length) state = 'unaccepted';
      else if (deps.some(d => d.state === 'unverifiable')) state = 'unverifiable';
      else state = 'current';
      sections.push({ key, doc, id: section.id, line: section.line, state, deps, droppedRefs, entry: entry || null });
    }
  }
  const orphans = Object.keys(entries).filter(key => !seen.has(key)).sort().map(key => ({ key, entry: entries[key] }));
  return { lockExists: exists, lockError: error, sections, orphans, anyCovered: sections.length > 0 };
}

/** The lock entry `review --accept` writes for one section. */
export function acceptedEntry(ctx, section, { reason, revision, date }) {
  const dependencies = {};
  for (const ref of section.covers) {
    const fp = fingerprint(ctx, ref);
    if (!fp.ok) throw new Error(`${ref}: ${fp.reason}`);
    dependencies[ref] = { tier: fp.tier, fingerprint: fp.fingerprint };
  }
  return { reviewedRevision: revision, reviewedAt: date, reason, dependencies };
}
