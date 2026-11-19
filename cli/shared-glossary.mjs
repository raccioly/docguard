/**
 * The project glossary (specs/105-glossary-and-plain-writing).
 *
 * A glossary is a Markdown table with a Use column and an Avoid column: one
 * term for one concept. This leaf module finds the file, reads the table, finds
 * the terms in a document's prose, picks the documents to check and writes the
 * starter file. The Glossary validator and `init`/`fix` call it; it imports no
 * command and no validator.
 *
 * Every reader here is bounded and linear in its input: a glossary or a
 * document is untrusted text, and `npm run fuzz` runs `parseGlossary` and
 * `checkableLines` on hostile input (no throw, same answer twice, bounded time).
 * The 500-row cap and the byte limits below exist for that reason.
 *
 * @implements docguard.glossary-and-plain-writing#FR-001
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { aliasesFor, foldHeading, headingIds, idForEnglishLabel, labelContext, scanHeadingMarkers } from './shared-labels.mjs';
import { agentInstructionKind } from './shared-agent-instructions.mjs';
import { fileKind } from './shared-file-kind.mjs';
import { listCanonicalDocs, relPosix, shouldIgnore, walkFiles } from './shared-ignore.mjs';
import { loadIgnorePatterns, resolveDocDirs } from './shared.mjs';

/** More rows than this are not read (FR-005): bounded time on a hostile table. */
export const MAX_GLOSSARY_ROWS = 500;
/** A glossary file larger than this is read up to here (spec edge case). */
export const MAX_GLOSSARY_BYTES = 1024 * 1024;
/** A document larger than this is read up to here. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

const DEFAULT_GLOSSARY_PATHS = Object.freeze(['docs/GLOSSARY.md', 'docs-canonical/GLOSSARY.md', 'GLOSSARY.md']);

/** Header cells (folded by `foldHeading`) that name each column (FR-002). */
const USE_HEADERS = new Set(['use', 'usar', 'term']);
const AVOID_HEADERS = new Set(['avoid', 'evitar', 'avoid terms']);
const MEANING_HEADERS = new Set(['meaning', 'significado', 'definition', 'definicao']);
const NO_TERM = new Set(['', '-', '—', '–']);

// ── The file ────────────────────────────────────────────────────────────────

const isFile = abs => { try { return statSync(abs).isFile(); } catch { return false; } };

/**
 * Where the project's glossary is, or would be (FR-001): `docs.glossary` when it
 * is a project-relative `.md` path, else the first of docs/GLOSSARY.md,
 * docs-canonical/GLOSSARY.md and GLOSSARY.md that exists. When none exists the
 * answer names the default `docs/GLOSSARY.md` (the path a starter is written to)
 * with `exists: false`. `loadConfig` already drops an invalid `docs.glossary`
 * with one stderr line, so a bad value is ignored here too.
 * @implements docguard.glossary-and-plain-writing#FR-001
 * @returns {{ rel: string, abs: string, exists: boolean, configured: boolean }}
 */
export function glossaryPath(projectDir, config = {}) {
  const value = config?.docs?.glossary;
  const parts = typeof value === 'string' ? value.replace(/\\/g, '/').split('/') : [];
  const configured = typeof value === 'string' && /\.md$/i.test(value) && !/^([A-Za-z]:|\/)/.test(value)
    && !parts.some(p => p === '..' || p.toLowerCase() === '.git');
  const candidates = configured ? [value.replace(/\\/g, '/').replace(/^\.\//, '')] : DEFAULT_GLOSSARY_PATHS;
  for (const rel of candidates) {
    const abs = resolve(projectDir, rel);
    if (isFile(abs)) return { rel, abs, exists: true, configured };
  }
  return { rel: candidates[0], abs: resolve(projectDir, candidates[0]), exists: false, configured };
}

/** Read at most `max` bytes of a file as UTF-8. Never throws: an unreadable file is `null`. */
export function readBounded(abs, max) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const size = statSync(abs).size;
    const length = Math.min(size, max);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, read);
      if (n <= 0) break;
      read += n;
    }
    return { text: buffer.subarray(0, read).toString('utf8'), truncated: size > max };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* nothing to release */ }
  }
}

// ── Terms ───────────────────────────────────────────────────────────────────

const hasInnerUpper = term => [...term].slice(1).some(ch => /\p{Lu}/u.test(ch));

/**
 * The comparison key of a term (FR-004, FR-005): NFC, one space between words,
 * lowercase unless the term has a capital after its first character (`PR`,
 * `GitHub`), which matches case-sensitively and so keeps its case.
 */
export function termKey(term) {
  const text = String(term).normalize('NFC').replace(/\s+/g, ' ').trim();
  return hasInnerUpper(text) ? text : text.toLowerCase();
}

/** A cell as one term: backticks and Markdown emphasis removed, one space between words, NFC. */
function cleanTerm(cell) {
  const text = cell.trim();
  const code = /^`+([^`]+)`+$/.exec(text);
  const bare = code ? code[1] : text.replace(/`/g, '').replace(/\*/g, '').replace(/^_+|_+$/g, '');
  return bare.replace(/\s+/g, ' ').trim().normalize('NFC');
}

// ── Structure: fences, comments, front matter ───────────────────────────────

/** Backtick runs of one line, as `{ start, len }`. */
function backtickRuns(line) {
  const runs = [];
  for (let i = 0; i < line.length;) {
    if (line.charCodeAt(i) !== 96) { i++; continue; }
    let j = i;
    while (j < line.length && line.charCodeAt(j) === 96) j++;
    runs.push({ start: i, len: j - i });
    i = j;
  }
  return runs;
}

/**
 * Inline code spans of one line as `[start, end)` pairs: a run closes at the next
 * run of the same length. Right-to-left bookkeeping keeps it linear (a naive
 * search per run is quadratic on a line of unmatched runs of growing length).
 */
function codeSpans(line) {
  if (!line.includes('`')) return [];
  const runs = backtickRuns(line);
  const next = new Array(runs.length).fill(-1);
  const last = new Map();
  for (let k = runs.length - 1; k >= 0; k--) {
    next[k] = last.has(runs[k].len) ? last.get(runs[k].len) : -1;
    last.set(runs[k].len, k);
  }
  const spans = [];
  for (let k = 0; k < runs.length;) {
    if (next[k] >= 0) { spans.push([runs[k].start, runs[next[k]].start + runs[next[k]].len]); k = next[k] + 1; } else k++;
  }
  return spans;
}

const spaces = n => ' '.repeat(n);

/** Replace each `[start, end)` range of `text` (sorted, non-overlapping) with spaces. */
function blankRanges(text, ranges) {
  if (ranges.length === 0) return text;
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue;
    out += text.slice(at, start) + spaces(end - start);
    at = end;
  }
  return out + text.slice(at);
}

/**
 * One line with HTML comments blanked (and, with `blankCode`, inline code too), carrying the
 * open-comment state across lines. Inline code protects a `<!--` inside it. Comment bodies are
 * collected for the document markers.
 */
function stripInline(line, lineNumber, state, blankCode) {
  let out = '';
  let i = 0;
  if (state.open) {
    const end = line.indexOf('-->');
    if (end < 0) { state.open.body += `${line}\n`; return spaces(line.length); }
    state.comments.push({ line: state.open.line, body: state.open.body + line.slice(0, end) });
    state.open = null;
    out += spaces(end + 3);
    i = end + 3;
  }
  const spans = codeSpans(line);
  let p = 0;
  let open = line.indexOf('<!--', i);
  while (i < line.length) {
    while (p < spans.length && spans[p][0] < i) p++;
    if (open !== -1 && open < i) open = line.indexOf('<!--', i);
    const code = p < spans.length ? spans[p][0] : -1;
    if (open === -1 && code === -1) { out += line.slice(i); break; }
    if (code !== -1 && (open === -1 || code < open)) {
      const piece = line.slice(code, spans[p][1]);
      out += line.slice(i, code) + (blankCode ? spaces(piece.length) : piece);
      i = spans[p][1];
      p++;
      continue;
    }
    out += line.slice(i, open);
    const end = line.indexOf('-->', open + 4);
    if (end < 0) {
      state.open = { line: lineNumber, body: `${line.slice(open + 4)}\n` };
      out += spaces(line.length - open);
      break;
    }
    state.comments.push({ line: lineNumber, body: line.slice(open + 4, end) });
    out += spaces(end + 3 - open);
    i = end + 3;
  }
  return out;
}

const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const indentOf = line => { let n = 0; for (const ch of line) { if (ch === ' ') n++; else if (ch === '\t') n += 4 - (n % 4); else break; } return n; };

/**
 * The shared line walk of the table reader (`full: false`: fences and comments only) and of the
 * document reader (`full: true`: also front matter, indented code, blockquotes, exempt headings,
 * link destinations, URLs, quoted text and path-like tokens). Every output line has the length of
 * its input line, with blanked text replaced by spaces, so a column in the result is a column in
 * the file.
 */
function walk(text, { full, ctx = null }) {
  const source = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const raw = source.split('\n');
  const state = { open: null, comments: [] };
  const out = new Array(raw.length);
  const examined = full ? headingExemptions(source, ctx) : null;

  let fence = null;
  let prevBlank = true;
  let prevCode = false;
  let prevHeading = false;
  let inList = false;
  let start = 0;

  if (full && raw.length > 1 && /^---[ \t]*$/.test(raw[0])) {
    for (let j = 1; j < raw.length; j++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(raw[j])) {
        for (let k = 0; k <= j; k++) out[k] = spaces(raw[k].length);
        start = j + 1;
        break;
      }
    }
  }

  for (let n = start; n < raw.length; n++) {
    const line = raw[n];
    if (fence) {
      const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) { fence = null; prevCode = true; }
      out[n] = spaces(line.length);
      continue;
    }
    if (!state.open) {
      const open = FENCE_OPEN_RE.exec(line);
      if (open && (indentOf(open[1]) <= 3 || (full && inList)) && !(open[2][0] === '`' && open[3].includes('`'))) {
        fence = { char: open[2][0], len: open[2].length };
        out[n] = spaces(line.length);
        prevBlank = false;
        continue;
      }
      if (full && line.trim() !== '' && indentOf(line) >= 4 && !inList && (prevBlank || prevCode || prevHeading)) {
        out[n] = spaces(line.length);
        prevCode = true;
        prevBlank = false;
        prevHeading = false;
        continue;
      }
    }
    const trimmed = line.trim();
    if (trimmed === '') prevBlank = true;
    else {
      prevBlank = false;
      if (LIST_ITEM_RE.test(line)) inList = true;
      else if (indentOf(line) === 0) inList = false;
    }
    prevCode = false;
    prevHeading = false;

    let text1 = stripInline(line, n + 1, state, full);
    if (!full) { out[n] = text1; continue; }
    if (/^ {0,3}>/.test(text1)) { out[n] = spaces(line.length); continue; }
    const heading = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text1);
    if (heading) {
      prevHeading = true;
      if (headingIsExempt(line, n, examined)) { out[n] = spaces(line.length); continue; }
    }
    text1 = blankRanges(text1, linkDestinations(text1));
    text1 = text1.replace(/<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+)>/g, m => spaces(m.length));
    text1 = text1.replace(/(?<![A-Za-z0-9+.-])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.)[^\s<>]+/g, m => spaces(m.length));
    text1 = blankRanges(text1, quotedSpans(text1));
    text1 = text1.replace(/\S+/g, token => (token.includes('/') || /[\p{L}\p{N}]\.[\p{L}\p{N}]/u.test(token) ? spaces(token.length) : token));
    out[n] = text1;
  }
  return { raw, out, comments: state.comments };
}

/**
 * `(destination)` ranges after `](`, with balanced parentheses; an unclosed one is not a link. A
 * destination is at most 1000 characters, so a line of unclosed openers costs a bounded scan each.
 */
function linkDestinations(text) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('](', from);
    if (at === -1) break;
    let depth = 1;
    let j = at + 2;
    const limit = Math.min(text.length, at + 2 + 1000);
    while (j < limit && depth > 0) {
      const ch = text[j];
      if (ch === '\\') j++;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    if (depth === 0) { ranges.push([at + 1, j]); from = j; } else from = at + 2;
  }
  return ranges;
}

/** Double-quoted spans of one line, straight (paired 1st-2nd, 3rd-4th, ...) and curly; an unpaired quote is left alone. */
function quotedSpans(text) {
  const ranges = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (open === -1) open = i;
      else { ranges.push([open, i + 1]); open = -1; }
    }
  }
  const straight = ranges.slice();
  let from = 0;
  for (;;) {
    const a = text.indexOf('“', from);
    if (a === -1) break;
    const b = text.indexOf('”', a + 1);
    if (b === -1) break;
    straight.push([a, b + 1]);
    from = b + 1;
  }
  straight.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of straight) {
    if (merged.length && r[0] < merged[merged.length - 1][1]) continue;
    merged.push(r);
  }
  return merged;
}

// ── Exempt headings (FR-009) ────────────────────────────────────────────────

/** The folded aliases of every heading label in the document's language, and the lines a `docguard:heading` marker sits under. */
function headingExemptions(source, ctx) {
  const aliases = new Set();
  if (ctx) for (const id of headingIds()) for (const alias of aliasesFor(id, ctx)) aliases.add(foldHeading(alias));
  const marked = new Set();
  if (source.includes('docguard:heading')) for (const m of scanHeadingMarkers(source).placed) if (m.valid) marked.add(m.headingLine);
  return { aliases, marked };
}

/**
 * A heading DocGuard matches cannot be renamed without breaking STR003, so it is not prose: its
 * text is a label of the registry (English, or an alias of the document's language), or a
 * `docguard:heading` marker sits under it.
 */
function headingIsExempt(line, index, { aliases, marked }) {
  if (marked.has(index)) return true;
  const text = line.trim();
  if (idForEnglishLabel(text) !== null) return true;
  return aliases.size > 0 && aliases.has(foldHeading(text));
}

// ── Document markers (FR-012) ───────────────────────────────────────────────

/**
 * The glossary markers of a document: `<!-- docguard:glossary off — reason -->` and
 * `<!-- docguard:glossary allow term[, term] — reason -->`. A marker inside code is not one.
 * @implements docguard.glossary-and-plain-writing#FR-012
 * @returns {{ off: boolean, allow: Set<string> }} `allow` holds lowercase NFC terms
 */
function markersFrom(comments) {
  const markers = { off: false, allow: new Set() };
  for (const { body } of comments) {
    const m = /^\s*docguard:glossary\s+(off|allow)\b([\s\S]*)$/.exec(body);
    if (!m) continue;
    if (m[1] === 'off') { markers.off = true; continue; }
    const list = m[2].split(/\s[—–-]{1,2}\s|\s—|—\s/)[0];
    for (const part of list.split(/[,;]/)) {
      const term = cleanTerm(part).toLowerCase();
      if (term) markers.allow.add(term);
    }
  }
  return markers;
}

/**
 * Read a document for checking: its lines with every exempt span of FR-009 blanked, and its markers.
 * Each entry keeps the raw line too, because a per-line `docguard:ignore GLS001` pragma lives in an
 * HTML comment, which the blanked text no longer has.
 * @param {string} text the document
 * @param {object|null} ctx the document's label context (`documentLanguage`), for its heading aliases
 * @implements docguard.glossary-and-plain-writing#FR-009
 * @returns {{ lines: Array<{ line: number, text: string, raw: string }>, markers: { off: boolean, allow: Set<string> } }}
 */
export function readDocument(text, ctx = null) {
  const { raw, out, comments } = walk(text, { full: true, ctx });
  return { lines: out.map((t, i) => ({ line: i + 1, text: t, raw: raw[i] })), markers: markersFrom(comments) };
}

/**
 * The lines of a document that may be checked, with every exempt span replaced by spaces of equal
 * length: fenced and indented code, front matter, HTML comments, inline code, link destinations,
 * autolinks, bare URLs, path-like tokens, double-quoted text, blockquotes and the headings DocGuard
 * matches.
 * @implements docguard.glossary-and-plain-writing#FR-009
 */
export function checkableLines(text, ctx = null) {
  return readDocument(text, ctx).lines;
}

// ── The table (FR-002 to FR-007) ────────────────────────────────────────────

/** Cells of a table row: split on unescaped `|`, the outer pipes dropped, `\|` unescaped. */
function splitCells(line) {
  const text = line.trim();
  const cells = [];
  let cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { cell += '|'; i++; } else if (ch === '|') { cells.push(cell); cell = ''; } else cell += ch;
  }
  cells.push(cell);
  if (text.startsWith('|')) cells.shift();
  if (cells.length && text.endsWith('|') && !text.endsWith('\\|')) cells.pop();
  return cells;
}

const isSeparator = cells => cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));

function columnOf(headers, wanted) {
  return headers.findIndex(h => wanted.has(foldHeading(h)));
}

/**
 * Read the glossary table (FR-002 to FR-007): the first Markdown table, outside code and HTML
 * comments, whose header has a Use and an Avoid column. A file with no such table is `found:
 * false` (a free-form glossary: no issue, GLS004 says so). The issues are GLS002 (malformed) and
 * GLS003 (conflict) with the glossary line; a conflicting term is in `conflicted` and is not
 * checked in documents. At most 500 rows are read.
 *
 * @implements docguard.glossary-and-plain-writing#FR-002
 * @implements docguard.glossary-and-plain-writing#FR-003
 * @implements docguard.glossary-and-plain-writing#FR-005
 * @implements docguard.glossary-and-plain-writing#FR-006
 * @param {string} text
 * @returns {{ found: boolean, rows: Array<{ line: number, use: string, avoid: string[], meaning: string }>,
 *             issues: Array<{ code: 'GLS002'|'GLS003', line: number, message: string }>, conflicted: Set<string> }}
 */
export function parseGlossary(text) {
  const { out } = walk(text, { full: false });
  const result = { found: false, rows: [], issues: [], conflicted: new Set() };
  let at = -1;
  let columns = null;
  for (let i = 0; i + 1 < out.length; i++) {
    if (!out[i].includes('|')) continue;
    const separator = splitCells(out[i + 1]);
    if (!out[i + 1].includes('|') || !isSeparator(separator)) continue;
    const headers = splitCells(out[i]);
    const use = columnOf(headers, USE_HEADERS);
    const avoid = columnOf(headers, AVOID_HEADERS);
    if (use < 0 || avoid < 0 || use === avoid) { i++; continue; }
    columns = { use, avoid, meaning: columnOf(headers, MEANING_HEADERS) };
    at = i + 2;
    break;
  }
  if (!columns) return result;
  result.found = true;

  const avoidSeen = []; // { key, term, line, useKey }
  const useSeen = new Map(); // key -> first line
  const repeatedRows = new Set(); // lines whose Use term repeats an earlier row: that one report covers the row
  const issue = (code, line, message) => {
    if (!result.issues.some(x => x.code === code && x.line === line && x.message === message)) result.issues.push({ code, line, message });
  };

  let count = 0;
  for (let i = at; i < out.length; i++) {
    const line = out[i];
    if (line.trim() === '') {
      // A row hidden in a comment or code does not end the table; a truly blank line does.
      if (String(text).split('\n')[i]?.trim()) continue;
      break;
    }
    if (!line.includes('|')) break;
    if (++count > MAX_GLOSSARY_ROWS) {
      issue('GLS002', i + 1, `The glossary table has more than ${MAX_GLOSSARY_ROWS} rows; the rest are not read`);
      break;
    }
    const cells = splitCells(line);
    const use = cleanTerm(cells[columns.use] ?? '');
    const avoid = [];
    for (const part of (cells[columns.avoid] ?? '').split(/[,;]/)) {
      const term = cleanTerm(part);
      if (!NO_TERM.has(term)) avoid.push(term);
    }
    const meaning = columns.meaning >= 0 ? (cells[columns.meaning] ?? '').trim() : '';
    const useTerm = NO_TERM.has(use) ? '' : use;
    if (!useTerm && avoid.length === 0) continue;
    result.rows.push({ line: i + 1, use: useTerm, avoid, meaning });

    if (!useTerm) {
      issue('GLS002', i + 1, `The Use cell is empty but the Avoid cell lists ${avoid.map(t => `"${t}"`).join(', ')}; name the term to use`);
      continue;
    }
    const useKey = termKey(useTerm);
    if (useSeen.has(useKey)) {
      issue('GLS002', i + 1, `"${useTerm}" is already the Use term of line ${useSeen.get(useKey)}; keep one row per concept`);
      repeatedRows.add(i + 1);
    } else useSeen.set(useKey, i + 1);
    const inRow = new Set();
    for (const term of avoid) {
      const key = termKey(term);
      if (inRow.has(key)) { issue('GLS002', i + 1, `"${term}" is listed twice in this row`); continue; }
      inRow.add(key);
      avoidSeen.push({ key, term, line: i + 1, useKey });
    }
  }

  // GLS003: a term that is Use in one row and Avoid in another (or in its own), and an Avoid term under two Use terms.
  const conflictLines = new Map(); // line -> messages
  const conflict = (line, message) => {
    if (!conflictLines.has(line)) conflictLines.set(line, []);
    if (!conflictLines.get(line).includes(message)) conflictLines.get(line).push(message);
  };
  const byKey = new Map();
  for (const a of avoidSeen) {
    if (!byKey.has(a.key)) byKey.set(a.key, []);
    byKey.get(a.key).push(a);
  }
  for (const [key, list] of byKey) {
    const uses = new Set(list.map(a => a.useKey));
    if (uses.size > 1) {
      result.conflicted.add(key);
      const lines = [...new Set(list.map(a => a.line))].sort((x, y) => x - y);
      for (const a of list) conflict(a.line, `"${a.term}" is an Avoid term under different Use terms (lines ${lines.join(', ')}); DocGuard cannot tell which one the project chose`);
    } else if (list.length > 1) {
      for (const a of list.slice(1)) {
        if (!repeatedRows.has(a.line) && list.findIndex(b => b.line === a.line) === list.indexOf(a)) issue('GLS002', a.line, `"${a.term}" is already an Avoid term on line ${list[0].line}`);
      }
    }
    if (useSeen.has(key)) {
      result.conflicted.add(key);
      const term = list[0].term;
      const lines = [...new Set([useSeen.get(key), ...list.map(a => a.line)])].sort((x, y) => x - y);
      for (const line of lines) conflict(line, `"${term}" is a Use term and an Avoid term (lines ${lines.join(', ')}); keep it in one role`);
    }
  }
  for (const [line, messages] of conflictLines) issue('GLS003', line, messages.join('; '));
  result.issues.sort((x, y) => x.line - y.line || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  return result;
}

// ── Matching (FR-004, FR-010) ───────────────────────────────────────────────

const WORD_BEFORE = '(?<![\\p{L}\\p{N}\\p{M}])(?<![\\p{L}\\p{N}]-)';
const WORD_AFTER = '(?![\\p{L}\\p{N}\\p{M}])(?!-[\\p{L}\\p{N}])';
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One term as a whole-word pattern: no Unicode letter, digit or combining mark next to it, a hyphen
 * between letters joins the word, a single word also matches its plural (`s`, `es`), a phrase
 * matches across spaces and tabs, case-insensitive unless the term has a capital after its first
 * character.
 * @implements docguard.glossary-and-plain-writing#FR-004
 */
export function termPattern(term) {
  const words = String(term).normalize('NFC').split(/\s+/).filter(Boolean);
  const body = words.map(escapeRegex).join('[ \\t]+');
  return new RegExp(`${WORD_BEFORE}${body}${words.length === 1 ? '(?:e?s)?' : ''}${WORD_AFTER}`, hasInnerUpper(words.join(' ')) ? 'gu' : 'giu');
}

const firstRun = term => (/[\p{L}\p{N}\p{M}]+/u.exec(term)?.[0] ?? '').toLowerCase();

/**
 * The matcher of a parsed glossary. Terms in `conflicted` are neither reported nor masked; a row
 * with an empty Use cell has nothing to suggest, so its Avoid terms are not checked. `hits(text)`
 * returns the Avoid terms found in one blanked line: Use terms are masked first (so `spec` is not
 * found in `Spec Kit`), then Avoid terms longest first, each masked once found (so only the longer
 * of two overlapping Avoid terms is reported). A word index keeps the cost of a line to one pass
 * over its words, not one pattern per term.
 * @implements docguard.glossary-and-plain-writing#FR-010
 * @param {ReturnType<typeof parseGlossary>} parsed
 */
export function termMatcher(parsed) {
  const entries = [];
  for (const row of parsed.rows) {
    if (!row.use || parsed.conflicted.has(termKey(row.use))) continue;
    entries.push({ role: 'use', term: row.use, use: row.use, line: row.line });
    for (const term of row.avoid) {
      if (parsed.conflicted.has(termKey(term))) continue;
      entries.push({ role: 'avoid', term, use: row.use, line: row.line, key: termKey(term) });
    }
  }
  entries.sort((a, b) => b.term.length - a.term.length);
  const index = new Map();
  const always = [];
  for (const entry of entries) {
    entry.re = termPattern(entry.term);
    const key = firstRun(entry.term);
    if (!key) { always.push(entry); continue; }
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  }
  const avoidCount = entries.filter(e => e.role === 'avoid').length;

  return {
    avoidCount,
    entries,
    /**
     * @param {string} text one blanked line
     * @param {Set<string>} [allow] lowercase terms this document allows: masked, not reported
     * @returns {Array<{ term: string, use: string, line: number, key: string }>}
     */
    hits(text, allow = new Set()) {
      if (avoidCount === 0) return [];
      const runs = text.match(/[\p{L}\p{N}\p{M}]+/gu);
      if (!runs && always.length === 0) return [];
      const candidates = new Set(always);
      for (const run of runs || []) {
        const lower = run.toLowerCase();
        for (const key of [lower, lower.endsWith('es') ? lower.slice(0, -2) : null, lower.endsWith('s') ? lower.slice(0, -1) : null]) {
          const bucket = key && index.get(key);
          if (bucket) for (const e of bucket) candidates.add(e);
        }
      }
      if (candidates.size === 0) return [];
      let masked = text.normalize('NFC');
      const ordered = [...candidates].sort((a, b) => b.term.length - a.term.length || a.line - b.line);
      const found = [];
      for (const e of ordered.filter(x => x.role === 'use')) masked = masked.replace(e.re, m => spaces(m.length));
      for (const e of ordered.filter(x => x.role === 'avoid')) {
        if (masked.search(e.re) === -1) continue;
        masked = masked.replace(e.re, m => spaces(m.length));
        if (!allow.has(e.term.toLowerCase())) found.push(e);
      }
      return found;
    },
  };
}

// ── The documents (FR-008) ──────────────────────────────────────────────────

const HISTORY_FILE_RE = /^(?:changelog|drift-log)(?:\.[A-Za-z0-9_-]+)?\.md$/i;
const DECISION_HOME_RE = /(?:^|\/)(?:adrs?|decisions?)\//i;
const DECISION_NAME_RE = /(?:^|[-_. ])adrs?(?:$|[-_. \d])|decision/i;
const README_RE = /^README(?:\.[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?)?\.md$/i;

/** A record of history or intent, or a file DocGuard does not own: never rewritten to fit a glossary (Decision 6). */
function leftOut(rel, config) {
  const segments = rel.split('/');
  const base = basename(rel);
  if (HISTORY_FILE_RE.test(base)) return true;
  if (segments.slice(0, -1).some(s => s.toLowerCase() === 'specs')) return true;
  // The decision-records validator's path rule: an ADR home folder, or a decision/ADR file name.
  if (DECISION_HOME_RE.test(rel) || DECISION_NAME_RE.test(base.replace(/\.md$/i, ''))) return true;
  if (agentInstructionKind(rel)) return true;
  return fileKind(rel, config, { kinds: ['backup', 'generated'] }).kind !== 'own';
}

/**
 * The documents the Glossary validator checks (FR-008): the canonical documents (and `docs.roles`
 * mappings), the root README.md and README.<lang>.md, and the Markdown files of the documentation
 * homes (`resolveDocDirs`), minus the glossary itself, CHANGELOG.md, DRIFT-LOG.md, `specs/`,
 * decision records, agent-instruction files, backup and generated files and `.docguardignore`.
 * Sorted by path, no duplicates.
 * @implements docguard.glossary-and-plain-writing#FR-008
 * @returns {Array<{ abs: string, rel: string }>}
 */
export function glossaryDocuments(projectDir, config = {}) {
  const root = resolve(projectDir);
  const glossary = glossaryPath(root, config);
  const ignored = loadIgnorePatterns(root);
  const seen = new Map();
  const add = abs => {
    const rel = relPosix(root, abs);
    if (!rel || rel.startsWith('..') || seen.has(rel) || !/\.md$/i.test(rel)) return;
    if (abs === glossary.abs || ignored(rel) || shouldIgnore(rel, config) || leftOut(rel, config)) return;
    seen.set(rel, { abs, rel });
  };

  for (const doc of listCanonicalDocs(root, { config, isIgnored: ignored })) add(doc.abs);
  try {
    for (const name of readdirSync(root)) if (README_RE.test(name) && isFile(resolve(root, name))) add(resolve(root, name));
  } catch { /* an unreadable root has no README to read */ }
  for (const dir of resolveDocDirs(root, config)) {
    const abs = resolve(root, dir);
    if (relPosix(root, abs).startsWith('..') || !existsSync(abs)) continue;
    walkFiles(abs, add, { root, config, skipKinds: ['backup', 'generated'] });
  }
  return [...seen.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// ── The starter (FR-018) ────────────────────────────────────────────────────

/** Built-in English synonym pairs [short, long]; a pair is proposed when both forms occur in prose (Decision 9). */
const SYNONYM_PAIRS = Object.freeze([
  ['spec', 'specification'], ['config', 'configuration'], ['repo', 'repository'], ['env', 'environment'],
  ['dir', 'directory'], ['app', 'application'], ['info', 'information'], ['auth', 'authentication'],
  ['args', 'arguments'], ['param', 'parameter'], ['docs', 'documentation'], ['e-mail', 'email'], ['PR', 'pull request'],
]);

const STOPWORDS = new Set(('a an and are as at be but by can could do does for from has have how i if in is it its may might must no not of on or our '
  + 'should so that the their then there these they this those to up was we were what when where which who why will with would you your also all any each '
  + 'here just more most new now one only other see some such than use used using via yes').split(' '));

const STARTER_HEADERS = Object.freeze({
  pt: { title: '# Glossário', header: '| Usar | Evitar | Significado |' },
  es: { title: '# Glosario', header: '| Usar | Evitar | Significado |' },
  en: { title: '# Glossary', header: '| Use | Avoid | Meaning |' },
});

function countMatches(lines, term) {
  const re = termPattern(term);
  let n = 0;
  for (const line of lines) {
    const found = line.match(re);
    if (found) n += found.length;
  }
  return n;
}

/** The one word a token is (punctuation around it allowed), or null: a token with more letters after its first word is not a plain word. */
function wordOf(token) {
  const core = token.replace(/^[^\p{L}\p{N}]+/u, '');
  const word = /^[\p{L}\p{N}'’-]+/u.exec(core);
  return word && !/[\p{L}\p{N}]/u.test(core.slice(word[0].length)) ? word[0] : null;
}

/**
 * Capitalized words and phrases that occur three or more times and never at the start of a
 * sentence, ten at most (FR-018 b). A single word that also occurs in lowercase is an ordinary word
 * that was capitalized, not a name, so it is not proposed. Read token by token: no pattern here
 * can backtrack, whatever the document holds.
 */
function capitalizedTerms(lines) {
  const lower = new Set();
  const bodies = lines.map(line => {
    let body = line.trim();
    for (let m = /^(?:#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/.exec(body); m; m = /^(?:#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/.exec(body)) body = body.slice(m[0].length);
    const tokens = body.split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      const w = wordOf(t);
      if (w && /^\p{Ll}/u.test(w)) lower.add(w);
    }
    return tokens;
  });
  const counts = new Map();
  for (const tokens of bodies) {
    let start = true;
    let run = [];
    let runStart = true;
    // A run that opens a sentence is ambiguous: its first word is capitalized by position. When that word is
    // an ordinary one ("Then", or a word that also occurs in lowercase) the rest of the run is mid-sentence.
    const flush = () => {
      let words = run;
      run = [];
      if (words.length === 0) return;
      if (runStart) {
        const first = words[0].toLowerCase();
        if (words.length < 2 || !(STOPWORDS.has(first) || lower.has(first))) return;
        words = words.slice(1);
      }
      const first = words[0];
      if ([...first].length < 2 || STOPWORDS.has(first.toLowerCase()) || (words.length === 1 && lower.has(first.toLowerCase()))) return;
      const phrase = words.join(' ');
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    };
    for (const t of tokens) {
      const w = wordOf(t);
      if (w && /^\p{Lu}/u.test(w)) {
        if (run.length === 0) runStart = start;
        run.push(w);
      } else flush();
      if (/[,;:.!?)|]$/.test(t)) flush();
      start = t === '|' || /[.!?:]$/.test(t);
    }
    flush();
  }
  return [...counts].filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10);
}

/**
 * The text of a starter glossary (FR-018): a title, an explanation in an HTML comment, the table
 * header in the project's language (Portuguese and Spanish, else English) and no active row.
 * Proposals taken from the project's own documents sit inside one HTML comment, so the checker
 * ignores them until a person moves a row into the table.
 * @implements docguard.glossary-and-plain-writing#FR-018
 */
export function starterGlossary(projectDir, config = {}) {
  const language = labelContext(config)?.language;
  const { title, header } = STARTER_HEADERS[language] || STARTER_HEADERS.en;
  const lines = [];
  for (const doc of glossaryDocuments(projectDir, config)) {
    const read = readBounded(doc.abs, MAX_DOCUMENT_BYTES);
    if (!read) continue;
    const ctx = labelContext(config);
    for (const l of checkableLines(read.text, ctx)) if (/\p{L}/u.test(l.text)) lines.push(l.text);
  }

  const pairs = [];
  for (const [short, long] of SYNONYM_PAIRS) {
    const a = countMatches(lines, short);
    const b = countMatches(lines, long);
    if (a === 0 || b === 0) continue;
    const [use, avoid, useCount, avoidCount] = b >= a ? [long, short, b, a] : [short, long, a, b];
    pairs.push(`| ${use} | ${avoid} | Both forms occur: "${use}" ${useCount} times, "${avoid}" ${avoidCount} times |`);
  }
  const names = capitalizedTerms(lines).map(([phrase, n]) => `| ${phrase} | | Appears ${n} times, never at the start of a sentence; say what it means |`);

  const proposals = [];
  if (pairs.length) proposals.push('Words used two ways. The more frequent form is the Use term:', header, '|---|---|---|', ...pairs, '');
  if (names.length) proposals.push('Names and phrases that recur. Add an Avoid term if the project uses another word for the same thing:', header, '|---|---|---|', ...names, '');
  if (proposals.length === 0) proposals.push('No proposals: no pair of words used two ways and no recurring name was found in the documents.', '');

  return [
    title,
    '',
    '<!--',
    'One term for one concept. Add a row to the table below for each concept:',
    '- Use: the one term the project writes.',
    '- Avoid: the other words for it, separated by commas. DocGuard reports a document that uses one of them in prose.',
    '- Meaning: what the term means in this project (optional).',
    'Code blocks, inline code, links, file paths, quoted text and HTML comments are not checked.',
    '-->',
    '',
    header,
    '|---|---|---|',
    '',
    '<!-- docguard:glossary-proposals',
    'DocGuard ignores everything in this comment. Copy a row into the table above to turn it on.',
    '',
    ...proposals,
    '-->',
    '',
  ].join('\n');
}
