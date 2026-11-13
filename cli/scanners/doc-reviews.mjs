/**
 * Recorded document reviews (specs/095-recorded-document-reviews).
 *
 * `.docguard-doc-reviews.json` records, per document, the commit a review
 * happened at, why, and a fingerprint of every file the document referenced
 * then. A `docguard:last-reviewed` marker records when; this records what.
 *
 * Kept apart from `.docguard-doc-lock.json` on purpose: that lock rejects
 * unknown top-level fields, so extending it would make every older DocGuard a
 * CI pins reject the whole lock. This file has the opposite policy from day
 * one: a future field goes under a reserved `extensions` object (top level or
 * per document), which every reader ignores; anything else unknown is an
 * error. A malformed file is a failing finding (FRS010), never "no reviews".
 *
 * @implements docguard.recorded-document-reviews#FR-001
 * @implements docguard.recorded-document-reviews#FR-002
 * @implements docguard.recorded-document-reviews#FR-003
 * @implements docguard.recorded-document-reviews#FR-004
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fingerprint, serializeLock } from './doc-deps.mjs';
import { isNonProductPath } from '../shared-ignore.mjs';
import { runGit } from '../shared-git.mjs';
import { generatedBy } from '../shared-agent-instructions.mjs';

export const DOC_REVIEWS_PATH = '.docguard-doc-reviews.json';
export const DOC_REVIEWS_SCHEMA_VERSION = 1;
export const MIN_REFERENCE_LINES = 20;
const REVISION_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_REVIEWS_BYTES = 4 * 1024 * 1024;
const TIERS = new Set(['content', 'ast', 'python-ast']);

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function reviewsProblem(data) {
  if (!isObject(data)) return 'must be an object';
  if (data.schemaVersion !== DOC_REVIEWS_SCHEMA_VERSION) return `unsupported schemaVersion ${JSON.stringify(data.schemaVersion)}`;
  const top = Object.keys(data).filter(k => !['schemaVersion', 'documents', 'extensions'].includes(k));
  if (top.length) return `has unknown top-level field ${JSON.stringify(top[0])} (a new field belongs under "extensions")`;
  if (data.extensions !== undefined && !isObject(data.extensions)) return 'extensions must be an object';
  if (!isObject(data.documents)) return 'documents must be an object';
  for (const [doc, entry] of Object.entries(data.documents)) {
    if (!doc || doc.startsWith('/') || doc.split('/').includes('..') || doc.includes('\\')) return `invalid document path ${JSON.stringify(doc)}`;
    if (!isObject(entry)) return `${doc} must be an object`;
    const unknown = Object.keys(entry).filter(k => !['reviewedAt', 'reviewedRevision', 'reason', 'references', 'excluded', 'extensions'].includes(k));
    if (unknown.length) return `${doc} has unknown field ${JSON.stringify(unknown[0])} (a new field belongs under "extensions")`;
    if (entry.reviewedRevision !== null && !REVISION_RE.test(entry.reviewedRevision || '')) return `${doc}.reviewedRevision must be a full revision or null`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt || '')) return `${doc}.reviewedAt must be YYYY-MM-DD`;
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8 || entry.reason.length > 500) return `${doc}.reason must be 8-500 characters`;
    if (!isObject(entry.references)) return `${doc}.references must be an object`;
    for (const [ref, fp] of Object.entries(entry.references)) {
      if (!isObject(fp) || !TIERS.has(fp.tier)) return `${doc} → ${ref}: unknown tier`;
      if (!/^sha256:[0-9a-f]{64}$/.test(fp.fingerprint || '')) return `${doc} → ${ref}: invalid fingerprint`;
      if (Object.keys(fp).some(k => !['tier', 'fingerprint', 'extensions'].includes(k))) return `${doc} → ${ref}: unknown field`;
    }
    if (entry.excluded !== undefined && (!isObject(entry.excluded) || Object.values(entry.excluded).some(v => typeof v !== 'string'))) return `${doc}.excluded must map paths to reasons`;
    if (entry.extensions !== undefined && !isObject(entry.extensions)) return `${doc}.extensions must be an object`;
  }
  return null;
}

/** @returns {{ exists: boolean, reviews: object|null, error: string|null }} */
export function readDocReviews(projectDir) {
  const abs = resolve(projectDir, DOC_REVIEWS_PATH);
  const empty = { schemaVersion: DOC_REVIEWS_SCHEMA_VERSION, documents: {} };
  let st;
  try { st = lstatSync(abs); } catch { return { exists: false, reviews: empty, error: null }; }
  if (!st.isFile()) return { exists: true, reviews: null, error: `${DOC_REVIEWS_PATH} is not a regular file` };
  if (st.size > MAX_REVIEWS_BYTES) return { exists: true, reviews: null, error: `${DOC_REVIEWS_PATH} is larger than 4 MiB` };
  let data;
  try { data = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { return { exists: true, reviews: null, error: `${DOC_REVIEWS_PATH} is not valid JSON: ${e.message.split('\n')[0]}` }; }
  const problem = reviewsProblem(data);
  return problem ? { exists: true, reviews: null, error: `${DOC_REVIEWS_PATH}: ${problem}` } : { exists: true, reviews: data, error: null };
}

export function serializeDocReviews(reviews) {
  return serializeLock(reviews);
}

export { reviewsProblem as docReviewsProblem };

// ── References ──────────────────────────────────────────────────────────────

const DATA_LIKE = [
  /(^|\/)CHANGELOG[^/]*$/i, /\.lock$/i, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/,
  /\.claims\.json$/i, /evidence[^/]*\.json$/i,
];

/**
 * Raw path-like tokens a document names, with their 1-based line: backticked
 * spans, Markdown link targets and slash-paths. Fenced blocks are included —
 * a command block in an instruction file is instruction.
 */
export function referenceTokens(content) {
  const out = [];
  String(content).split('\n').forEach((line, i) => {
    const push = raw => out.push({ raw, line: i + 1 });
    for (const m of line.matchAll(/`([^`\n]+)`/g)) push(m[1]);
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) push(m[1]);
    for (const m of line.matchAll(/(?:^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?=$|[\s),.;:])/g)) push(m[1]);
  });
  return out;
}

function cleanToken(raw) {
  const s = String(raw).trim().replace(/^\.\//, '').replace(/[#?].*$/, '').replace(/[),.;:]+$/, '').replace(/:\d+(-\d+)?$/, '');
  if (!s || s.length > 300 || /\s/.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/') || s.startsWith('~')) return null;
  return s;
}

/** Paths marked `linguist-generated` in .gitattributes (one git call). */
function linguistGenerated(projectDir, paths) {
  if (!paths.length || !existsSync(resolve(projectDir, '.gitattributes'))) return new Set();
  // No attribute line names it: nothing can be generated by attribute, so no spawn.
  try { if (!/linguist-generated/.test(readFileSync(resolve(projectDir, '.gitattributes'), 'utf8'))) return new Set(); } catch { return new Set(); }
  const r = runGit(projectDir, ['check-attr', '-z', '--stdin', 'linguist-generated'], { operation: 'git check-attr (generated references)', answers: [0], input: paths.join('\0') + '\0', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || r.error) return new Set();
  const parts = r.stdout.split('\0');
  const out = new Set();
  for (let i = 0; i + 2 < parts.length; i += 3) if (['set', 'true'].includes(parts[i + 2])) out.add(parts[i]);
  return out;
}

const lineCount = text => { const n = text.split('\n').length; return text.endsWith('\n') ? n - 1 : n; };

/**
 * The files a document references, and those excluded with the reason.
 *
 * @param {{ tracked: string[], vendored?: Set<string> }} ctx
 * @returns {{ references: { path, line }[], excluded: Record<string,string> }}
 */
export function documentReferences(projectDir, doc, content, { tracked, vendored = new Set(), config = {} }) {
  const files = new Set(tracked);
  const dirs = new Set();
  for (const f of tracked) { let d = posix.dirname(f); while (d !== '.') { dirs.add(d); d = posix.dirname(d); } }
  const docDir = posix.dirname(doc) === '.' ? '' : posix.dirname(doc);
  const seen = new Map();
  const excluded = {};
  for (const { raw, line } of referenceTokens(content)) {
    const token = cleanToken(raw);
    if (!token) continue;
    for (const cand of [...new Set([posix.normalize(posix.join(docDir, token)), posix.normalize(token)])]) {
      const path = cand.replace(/\/$/, '');
      if (path === '.' || path.startsWith('../') || path === doc) continue;
      if (files.has(path)) { if (!seen.has(path)) seen.set(path, line); break; }
      if (dirs.has(path)) { excluded[path] ||= 'directory'; break; }
    }
  }
  const candidates = [...seen.keys()];
  const generated = linguistGenerated(projectDir, candidates);
  const references = [];
  for (const path of candidates) {
    let reason = null;
    if (vendored.has(path)) reason = 'vendored copy';
    else if (DATA_LIKE.some(re => re.test(path))) reason = 'changelog, lockfile or claims/evidence data';
    else if (isNonProductPath(path, config)) reason = 'test, fixture or example path';
    else if (/\.(md|mdx|markdown|rst|adoc|txt)$/i.test(path)) reason = 'another document (reviewed on its own)';
    else if (/(^|\/)\.docguard[^/]*$/.test(path)) reason = 'DocGuard state file';
    else if (generated.has(path)) reason = 'linguist-generated';
    else {
      let text = '';
      try { text = readFileSync(resolve(projectDir, path), 'utf8'); } catch { reason = 'unreadable'; }
      if (!reason && generatedBy(text)) reason = 'generated-by header';
      else if (!reason && lineCount(text) < MIN_REFERENCE_LINES) reason = `under ${MIN_REFERENCE_LINES} lines`;
    }
    if (reason) excluded[path] = reason;
    else references.push({ path, line: seen.get(path) });
  }
  return { references, excluded };
}

/**
 * The entry `review --accept <doc>` records.
 * @param {object} fpCtx a doc-deps context (createContext)
 */
export function documentReviewEntry(fpCtx, projectDir, doc, content, { tracked, vendored, config, reason, revision, date }) {
  const { references, excluded } = documentReferences(projectDir, doc, content, { tracked, vendored, config });
  const recorded = {};
  for (const { path } of references) {
    const fp = fingerprint(fpCtx, path);
    if (fp.ok) recorded[path] = { tier: fp.tier, fingerprint: fp.fingerprint };
    else excluded[path] = `could not fingerprint: ${fp.reason}`;
  }
  return { reviewedAt: date, reviewedRevision: revision, reason, references: recorded, excluded };
}

