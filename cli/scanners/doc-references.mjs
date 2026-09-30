/**
 * Which documentation describes a file, what a document contains, and one
 * section of it — the deterministic answers behind the MCP doc tools.
 *
 * Spec: specs/032-mcp-doc-tools (docguard.mcp-doc-tools).
 *
 * DeepWiki's MCP server offers a structure call, a contents call, and an LLM
 * "ask". DocGuard makes no model calls, so it offers only the exact half:
 * every answer here is a byte-stable function of the tree. Responses are
 * bounded, because agents pay for every byte on every turn.
 *
 * `trace --reverse`, `impact` and `docguard_docs_for_path` share one
 * reference matcher, so the three surfaces cannot disagree (FR-003).
 *
 * @implements docguard.mcp-doc-tools#FR-002
 * @implements docguard.mcp-doc-tools#FR-003
 * @implements docguard.mcp-doc-tools#FR-004
 * @implements docguard.mcp-doc-tools#FR-005
 * @implements docguard.mcp-doc-tools#FR-007
 * @implements docguard.mcp-doc-tools#FR-008
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { listCanonicalDocs, globMatch } from '../shared-ignore.mjs';
import { extractHeadingLines } from '../shared-headings.mjs';
import { inspectSections } from '../writers/sections.mjs';
import { createEvidenceReader } from './semantic-claims.mjs';
import { coveredSections, docLockStatus } from './doc-deps.mjs';

export const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
export const READ_DEFAULT_BYTES = 8 * 1024;
export const READ_MAX_BYTES = 32 * 1024;
const LIST_CAP = 50;
const LINE_TEXT_MAX = 240;
export const LINE_CONTEXT_DEFAULT = 3;
const LINE_CONTEXT_MAX = 50;

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `@doc <FILE>.md` in a comment near the top of a source file links it to a
 * doc. Shared with the Traceability validator so both read the same links
 * (FR-003). Accepts `//`, `/* … `, `#`, and JSDoc continuation lines (` * @doc`),
 * which the validator's earlier pattern silently ignored.
 */
export const DOC_ANNOTATION_HEAD_BYTES = 4096;
export function docAnnotationsIn(content) {
  const head = String(content).slice(0, DOC_ANNOTATION_HEAD_BYTES);
  if (!head.includes('@doc')) return [];
  return [...head.matchAll(/(?:\/\/|\/\*+|#|^[ \t]*\*)[ \t]*@doc[ \t]+(\S+\.md)/gm)].map(m => m[1]);
}

/** How a documentation line names `file`: its path, its basename, or its backticked module name. */
export function referenceKind(line, file) {
  const normalized = file.replace(/^\.\//, '');
  const base = basename(normalized);
  if (line.includes(normalized)) return 'path';
  if (line.includes(base)) return 'basename';
  const stem = base.replace(/\.[^.]+$/, '');
  if (new RegExp(`\`${escapeRegex(stem)}\``).test(line)) return 'module';
  return null;
}

/**
 * References to `file` across documents given as [name, lines] pairs.
 * @returns {Array<{ doc: string, line: number, kind: string }>}
 */
export function findReferences(file, docs) {
  const refs = [];
  for (const [doc, lines] of docs) {
    for (let i = 0; i < lines.length; i++) {
      const kind = referenceKind(lines[i], file);
      if (kind) refs.push({ doc, line: i + 1, kind });
    }
  }
  return refs;
}

/** Project-relative, no traversal, no NUL/backslash/absolute path. */
function refusal(path) {
  if (typeof path !== 'string' || !path.trim()) return 'a project-relative path is required';
  if (path.includes('\0') || path.includes('\\')) return 'the path contains a NUL or backslash';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'the path must be relative to the project';
  if (path.split('/').includes('..')) return 'the path must not contain ..';
  return null;
}

/** Read a project file through the evidence reader's safety checks, or throw a named refusal. */
function safeRead(projectDir, path) {
  const bad = refusal(path);
  if (bad) throw new Error(`Refused ${JSON.stringify(path)}: ${bad}.`);
  const { evidence, content } = createEvidenceReader(projectDir)(path);
  if (content === null) {
    if (evidence?.reason === 'not-cited') throw new Error(`Refused ${JSON.stringify(path)}: a project-relative path is required.`);
    // A private (.env, .local), escaping or symlinked path is refused by name;
    // a file that simply does not exist is an answer (docs may still cite it).
    if (['unsafe-path', 'symlink'].includes(evidence?.reason)) {
      throw new Error(`Refused ${JSON.stringify(path)}: ${evidence.reason === 'symlink' ? 'it is a symbolic link' : 'it is private or outside the project'}.`);
    }
    const exists = existsSync(resolve(projectDir, path));
    return { exists, content: null, reason: exists ? evidence?.reason || 'unavailable' : null };
  }
  return { exists: true, content, reason: null };
}

const capped = (items, cap = LIST_CAP) => ({ total: items.length, returned: Math.min(items.length, cap), truncated: items.length > cap, items: items.slice(0, cap) });

/** Blank fenced code blocks so marker and heading examples are never structure. */
function stripFences(content) {
  let fence = null;
  return String(content).split('\n').map(line => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; return ''; }
    if (m) { fence = m[1]; return ''; }
    return line;
  }).join('\n');
}

function headingAt(headings, line) {
  let current = null;
  for (const h of headings) { if (h.line <= line) current = h; else break; }
  return current ? { text: current.text, anchor: current.anchor } : null;
}

function sectionAt(sections, line) {
  const s = sections.find(sec => sec.openLine + 1 <= line && line <= sec.closeLine + 1);
  return s ? s.id : null;
}

/** `docguard_docs_for_path` (FR-002). */
export function docsForPath(projectDir, config, path) {
  const target = safeRead(projectDir, path);
  const normalized = path.replace(/^\.\//, '');
  const references = [];
  for (const doc of listCanonicalDocs(projectDir, { config })) {
    let content;
    try { content = readFileSync(doc.abs, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    const headings = extractHeadingLines(content);
    const sections = inspectSections(stripFences(content)).sections;
    for (const ref of findReferences(normalized, [[doc.rel, lines]])) {
      // The line itself is usually the answer (a table row, a sentence), so it
      // travels with the reference; read_section with `line` gives context.
      references.push({ ...ref, text: lines[ref.line - 1].trim().slice(0, LINE_TEXT_MAX), heading: headingAt(headings, ref.line), section: sectionAt(sections, ref.line) });
    }
  }
  const agentInstructions = [];
  for (const file of AGENT_FILES) {
    const abs = resolve(projectDir, file);
    if (!existsSync(abs)) continue;
    let lines;
    try { lines = readFileSync(abs, 'utf8').split('\n'); } catch { continue; }
    for (const ref of findReferences(normalized, [[file, lines]])) agentInstructions.push(ref);
  }
  const requirements = [];
  const docAnnotations = [];
  if (target.content !== null) {
    for (const m of target.content.matchAll(/@(implements|req)\s+([\w./-]+#[A-Z]+-\d+|[A-Z]+-\d+)/g)) requirements.push({ kind: m[1], id: m[2] });
    docAnnotations.push(...docAnnotationsIn(target.content));
  }
  const covers = [];
  const lock = docLockStatus(projectDir, config);
  for (const section of lock.sections) {
    for (const dep of section.deps) {
      const hit = dep.path === normalized || (/[*?[\]{}]/.test(dep.ref) && globMatch(normalized, [dep.ref]));
      if (hit) covers.push({ section: section.key, ref: dep.ref, state: section.state });
    }
  }
  const uniq = arr => [...new Map(arr.map(x => [JSON.stringify(x), x])).values()];
  return {
    path: normalized,
    exists: target.exists,
    ...(target.reason ? { unreadable: target.reason } : {}),
    references: capped(references),
    agentInstructions: capped(agentInstructions),
    requirements: capped(uniq(requirements).sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind))),
    docAnnotations: capped([...new Set(docAnnotations)].sort()),
    covers: capped(covers),
    owner: null,
    ownerReason: 'no ownership map is configured (docguard.doc-ownership-map is not implemented yet)',
  };
}

function requireMarkdown(projectDir, doc) {
  if (extname(String(doc || '')).toLowerCase() !== '.md') throw new Error(`Refused ${JSON.stringify(doc)}: doc must be a Markdown file.`);
  const read = safeRead(projectDir, doc);
  if (read.content === null) throw new Error(`Cannot read ${doc}: ${read.exists ? read.reason : 'it does not exist'}.`);
  return read.content;
}

/** `docguard_doc_structure` (FR-004). */
export function docStructure(projectDir, config, doc) {
  const content = requireMarkdown(projectDir, doc);
  const lines = content.split('\n');
  const headings = extractHeadingLines(content);
  const lineBytes = lines.map(l => Buffer.byteLength(l) + 1);
  const bytesBetween = (from, to) => lineBytes.slice(from - 1, to).reduce((a, b) => a + b, 0);
  const outline = headings.map((h, i) => {
    const next = headings.slice(i + 1).find(o => o.level <= h.level);
    const end = next ? next.line - 1 : lines.length;
    return { level: h.level, text: h.text, anchor: h.anchor, startLine: h.line, endLine: end, bytes: bytesBetween(h.line, end) };
  });
  const inspected = inspectSections(stripFences(content));
  const covered = new Map(coveredSections(content).map(s => [s.id, s.covers]));
  const sections = inspected.sections.map(s => ({
    id: s.id, source: s.source, pinned: s.attrs.pinned !== undefined, covers: covered.get(s.id) || [],
    startLine: s.openLine + 1, endLine: s.closeLine + 1,
  }));
  const facts = [...stripFences(content).matchAll(/<!--\s*docguard:fact\s+(\w+)\s+(.+?)\s*-->/g)].map(m => ({ kind: m[1], key: m[2] }));
  const reviewed = content.match(/<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/)?.[1] || null;
  return {
    doc,
    totalBytes: Buffer.byteLength(content),
    lastReviewed: reviewed,
    generated: /<!--\s*docguard:generated\b/.test(content),
    headings: capped(outline, 200),
    sections: capped(sections),
    facts: capped(facts),
    markerIssues: inspected.issues,
  };
}

/** `docguard_read_section` (FR-005): by section id, then anchor, then exact heading text. */
export function readSection(projectDir, config, { doc, id, anchor, heading, line, context = LINE_CONTEXT_DEFAULT, offset = 0, maxBytes = READ_DEFAULT_BYTES } = {}) {
  const content = requireMarkdown(projectDir, doc);
  const lines = content.split('\n');
  const limit = Math.min(Math.max(1, Number(maxBytes) || READ_DEFAULT_BYTES), READ_MAX_BYTES);
  const start = Math.max(0, Number(offset) || 0);
  let range = null;
  let matchedBy = null;
  if (id) {
    const found = inspectSections(stripFences(content)).sections.filter(s => s.id === id);
    if (found.length > 1) throw new Error(`Section id ${id} is ambiguous: lines ${found.map(s => s.openLine + 1).join(', ')}.`);
    if (found.length === 1) { range = [found[0].openLine + 2, found[0].closeLine]; matchedBy = 'id'; }
  }
  if (!range && line !== undefined && line !== null) {
    // The lines around one reference (docs_for_path gives the line): the
    // cheapest read when the answer is a table row or a sentence.
    const n = Number(line);
    if (!Number.isInteger(n) || n < 1 || n > lines.length) throw new Error(`line must be between 1 and ${lines.length}.`);
    const ctx = Math.min(Math.max(0, Number(context) || 0), LINE_CONTEXT_MAX);
    range = [Math.max(1, n - ctx), Math.min(lines.length, n + ctx)];
    matchedBy = 'line';
  }
  if (!range && (anchor || heading)) {
    const headings = extractHeadingLines(content);
    const found = anchor ? headings.filter(h => h.anchor === String(anchor).replace(/^#/, '')) : headings.filter(h => h.text === heading);
    if (found.length > 1) throw new Error(`${anchor ? 'Anchor' : 'Heading'} ${JSON.stringify(anchor || heading)} is ambiguous: lines ${found.map(h => h.line).join(', ')}.`);
    if (found.length === 1) {
      const h = found[0];
      const next = headings.find(o => o.line > h.line && o.level <= h.level);
      range = [h.line, next ? next.line - 1 : lines.length];
      matchedBy = anchor ? 'anchor' : 'heading';
    }
  }
  if (!range) {
    const candidates = extractHeadingLines(content).slice(0, 30).map(h => h.anchor);
    throw new Error(`No section ${JSON.stringify(id || anchor || heading)} in ${doc}. Anchors include: ${candidates.join(', ')}.`);
  }
  const body = Buffer.from(lines.slice(range[0] - 1, range[1]).join('\n'));
  const slice = body.subarray(start, start + limit);
  // Never split a UTF-8 sequence: back off to the last complete character.
  let text = slice.toString('utf8');
  if (text.endsWith('\uFFFD')) text = text.slice(0, -1);
  const consumed = Buffer.byteLength(text);
  const truncated = start + consumed < body.length;
  return {
    doc, matchedBy, startLine: range[0], endLine: range[1], totalBytes: body.length,
    offset: start, content: text, truncated, ...(truncated ? { nextOffset: start + consumed } : {}),
  };
}
