/**
 * Pattern-tier lexer, outline and floor fingerprint for requirement anchors
 * (specs/070-requirement-anchors).
 *
 * Why this exists: DocGuard reads JS/TS with Babel and Python with its own
 * `ast`, but has no parser for Go, Rust, Java, Kotlin, C#, PHP, Ruby, Swift,
 * C or C++, and it does not ship tree-sitter by default (research §3: ~305 MB
 * of native grammars with no provenance). A requirement tag still has to be
 * read only from real comments, never from inside a string, template, regex,
 * heredoc or character literal (FR-005), and has to be tied to the declaration
 * below it. A line regex cannot tell `"http://x // …"` from a comment, so each
 * language gets a small lexer that knows its literal forms, and a symbol
 * finder that works on the resulting tokens instead of on lines.
 *
 * The lexer checks itself (FR-008). When `() [] {}` do not balance, or a
 * literal or comment never closes, `error` is set and `outline` returns no
 * symbols, so callers fall back to file scope instead of trusting a span that
 * could run to the end of the file. Every failure probed in research §3
 * (interpolation, PHP inline HTML, C preprocessor branches, C++ raw strings)
 * surfaces this way.
 *
 * The floor fingerprint (`pattern@1`, contracts/fingerprint.md) is the token
 * stream over a span with comments and whitespace removed and directive
 * comments kept. Where a newline ends a statement, the lexer emits a virtual
 * `;` (FR-013: exactly per the Go specification; best effort for Kotlin,
 * Swift and Ruby; exactly for Python, which also gets indent/dedent markers),
 * so `return\nfoo()` and `return foo()` differ while re-indentation does not.
 *
 * Known limits: C and C++ are low confidence (a brace duplicated across
 * `#if`/`#else` makes the file fall back); JSX text is not modelled, so an
 * apostrophe in it reports an error; declarations produced by macros (Rust
 * `macro_rules!`, Ruby `define_method`) are invisible; Kotlin, Swift and Ruby
 * statement ends are heuristics; a Python or Kotlin span ends at its last
 * token, so a comment trailing that line lies outside it.
 *
 * @implements docguard.requirement-anchors#FR-005
 * @implements docguard.requirement-anchors#FR-007
 * @implements docguard.requirement-anchors#FR-008
 * @implements docguard.requirement-anchors#FR-013
 */

import { createHash } from 'node:crypto';
import { NO_VOLATILE, VOLATILE_PLACEHOLDER, maskVolatileLines } from './fingerprint.mjs';

/** Bump on any change to the floor token rules: every stored floor depends on them. */
export const PATTERN_ALGO = 1;
export const PATTERN_TIER = `pattern@${PATTERN_ALGO}`;

/**
 * Comment bodies that change how a tool treats the code, so they stay in the
 * fingerprint (contracts/fingerprint.md, spec Edge Cases). Matched against a
 * comment's `text`, which has its delimiters removed.
 */
export const DIRECTIVE_RE = /^\s*(?:@ts-(?:ignore|expect-error|nocheck)\b|eslint-disable|go:build\b|\+build\b|go:generate\b|[#@]__PURE__|type:\s*ignore\b|noqa\b|pragma:\s*no\s+cover\b)/;

/** Python layout markers: `semi` tokens whose value is not `;`. */
const INDENT = '\u0002indent';
const DEDENT = '\u0002dedent';

// ── Languages ────────────────────────────────────────────────────────────────

const EXTENSIONS = new Map(Object.entries({
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts',
  py: 'python', pyi: 'python',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', php: 'php',
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby', swift: 'swift',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', 'c++': 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp', ipp: 'cpp', inl: 'cpp',
}));
const RUBY_FILES = new Set(['Rakefile', 'Gemfile', 'Guardfile', 'Capfile', 'Vagrantfile', 'Podfile', 'Fastfile', 'Brewfile', 'Dangerfile', 'Berksfile']);

/**
 * The pattern-tier language of a path, or null when DocGuard has no lexer for
 * it (YAML, shell, Markdown, JSON, unknown): those files use the file tier.
 * @param {string} relPath
 * @returns {'js'|'ts'|'python'|'go'|'rust'|'java'|'kotlin'|'csharp'|'php'|'ruby'|'swift'|'c'|'cpp'|null}
 */
export function languageOf(relPath) {
  if (typeof relPath !== 'string' || !relPath) return null;
  const base = relPath.replace(/\\/g, '/').split('/').pop();
  if (RUBY_FILES.has(base)) return 'ruby';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSIONS.get(base.slice(dot + 1).toLowerCase()) ?? null;
}

// ── Characters and lines ─────────────────────────────────────────────────────

const NL = 10;
const UNI_START = /[\p{L}\p{Nl}]/u;
const UNI_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;
const isDigit = c => c >= 48 && c <= 57;
const isHex = c => isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
function isIdStart(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36
    || (c > 127 && UNI_START.test(String.fromCharCode(c)));
}
function isIdPart(c) {
  return isIdStart(c) || isDigit(c) || (c > 127 && UNI_PART.test(String.fromCharCode(c)));
}
function isSpace(c) {
  return c === 32 || c === 9 || c === NL || c === 13 || c === 11 || c === 12
    || c === 0xA0 || c === 0xFEFF || c === 0x2028 || c === 0x2029;
}

function lineStartsOf(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === NL) starts.push(i + 1);
  return starts;
}

/** 1-based line of an offset. */
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** First index whose item starts at or after `pos` (items sorted by `.s`). */
function lowerBound(items, pos) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].s < pos) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

/** Mutable state of one lexing pass. Never throws on its own; errors are recorded. */
class Scanner {
  constructor(src, lang) {
    this.src = src;
    this.n = src.length;
    this.lang = lang;
    this.starts = lineStartsOf(src);
    this.tokens = [];
    this.comments = [];
    this.error = null;
    this.cont = new Set();  // lines ended by a backslash continuation (Python, Ruby)
    this.heredocs = [];     // Ruby heredocs whose bodies start on the next line
  }

  line(pos) { return lineOf(this.starts, pos); }

  fail(message, pos) { if (!this.error) this.error = `${message} at line ${this.line(pos)}`; }

  token(t, s, e, extra) {
    const tok = { t, v: this.src.slice(s, e), s, e, line: this.line(s) };
    if (extra) Object.assign(tok, extra);
    this.tokens.push(tok);
    return tok;
  }

  comment(kind, s, e, text) {
    this.comments.push({ s, e, line: this.line(s), endLine: this.line(Math.max(s, e - 1)), text, raw: this.src.slice(s, e), kind });
    return e;
  }

  last() { return this.tokens.length ? this.tokens[this.tokens.length - 1] : null; }
}

function lineEnd(S, i) {
  const j = S.src.indexOf('\n', i);
  return j < 0 ? S.n : j;
}

function atLineStart(S, i) {
  let j = i - 1;
  while (j >= 0 && (S.src[j] === ' ' || S.src[j] === '\t')) j--;
  return j < 0 || S.src[j] === '\n';
}

function lineComment(S, i, open, kind = 'line') {
  const e = lineEnd(S, i);
  return S.comment(kind, i, e, S.src.slice(i + open, e).replace(/\r$/, ''));
}

/** End of a `/* … *\/` comment opened at `i`; nested when the language nests them. */
function blockEnd(S, i, nested) {
  const { src, n } = S;
  let depth = 1;
  let j = i + 2;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (c === 42 && src.charCodeAt(j + 1) === 47) {
      j += 2;
      if (--depth === 0) return j;
      continue;
    }
    if (nested && c === 47 && src.charCodeAt(j + 1) === 42) { depth++; j += 2; continue; }
    j++;
  }
  S.fail('unterminated block comment', i);
  return n;
}

/** Body of a block comment: delimiters removed, and the ` * ` that leads each later line. */
function stripBlock(body) {
  return body.split('\n')
    .map((l, k) => (k === 0 ? l : l.replace(/^\s*\*(?!\/)\s?/, '')).replace(/\s+$/, ''))
    .join('\n');
}

function blockComment(S, i, nested) {
  const e = blockEnd(S, i, nested);
  const raw = S.src.slice(i, e);
  const doc = /^\/\*[*!](?![*/])/.test(raw);
  const closed = raw.length >= 4 && raw.endsWith('*/');
  return S.comment(doc ? 'doc' : 'block', i, e, stripBlock(raw.slice(doc ? 3 : 2, closed ? -2 : undefined)));
}

/** A C-family comment at `i`, recorded; -1 when none starts there. */
function cComment(S, i, { nested = false, docLines = false } = {}) {
  const { src } = S;
  if (src.charCodeAt(i) !== 47) return -1;
  const d = src.charCodeAt(i + 1);
  if (d === 47) {
    if (docLines && (src[i + 2] === '!' || (src[i + 2] === '/' && src[i + 3] !== '/'))) return lineComment(S, i, 3, 'doc');
    return lineComment(S, i, 2);
  }
  if (d === 42) return blockComment(S, i, nested);
  return -1;
}

/** End of a C-family comment at `j` without recording it (inside interpolation holes). */
function skipComment(S, j, nested) {
  const { src } = S;
  if (src[j] !== '/') return -1;
  if (src[j + 1] === '/') return lineEnd(S, j);
  if (src[j + 1] === '*') return blockEnd(S, j, nested);
  return -1;
}

/**
 * End of a quoted literal whose opening delimiter `open` starts at `i`.
 * `esc`: backslash escapes the next character. `multi`: may span lines.
 * `hole(j)`: index after an interpolation hole starting at `j`, or -1.
 */
function quoted(S, i, open, { close = open, esc = true, multi = false, hole = null } = {}) {
  const { src, n } = S;
  const c0 = close.charCodeAt(0);
  let j = i + open.length;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (esc && c === 92) { j += 2; continue; }
    if (c === c0 && src.startsWith(close, j)) return j + close.length;
    if (c === NL && !multi) { S.fail('unterminated string', i); return j; }
    if (hole) {
      const k = hole(j);
      if (k > j) { j = k; continue; }
    }
    j++;
  }
  S.fail('unterminated string', i);
  return n;
}

/** Index after the `close` that balances the `open` at `i`; `inner(j)` skips nested literals and comments. */
function balanced(S, i, open, close, inner) {
  const { src, n } = S;
  let depth = 0;
  let j = i;
  while (j < n) {
    if (j > i) {
      const k = inner(j);
      if (k > j) { j = k; continue; }
    }
    const ch = src[j];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return j + 1;
    j++;
  }
  S.fail('unterminated interpolation', i);
  return n;
}

/** `\` + newline: the line continues (Python, Ruby). */
function continuation(S, i) {
  const { src } = S;
  if (src[i] !== '\\') return -1;
  if (src[i + 1] === '\n') { S.cont.add(S.line(i)); return i + 2; }
  if (src[i + 1] === '\r' && src[i + 2] === '\n') { S.cont.add(S.line(i)); return i + 3; }
  return -1;
}

/** A `` `name` `` identifier (Kotlin, Swift). */
function backtickId(S, i) {
  const e = S.src.indexOf('`', i + 1);
  if (e < 0 || e > lineEnd(S, i)) {
    S.fail('unterminated backtick identifier', i);
    S.token('punct', i, i + 1);
    return i + 1;
  }
  S.token('id', i, e + 1);
  return e + 1;
}

/**
 * A preprocessor directive (C, C++, C#) as one token, including its
 * backslash-continued lines, so a `{` in `#define X {` cannot unbalance the
 * file. A block comment inside it is recorded and left out of the token's
 * text; a `//` comment ends it.
 */
function directiveLine(S, i) {
  const { src, n } = S;
  let j = i + 1;
  let text = '';
  let from = i;
  while (j < n) {
    const c = src[j];
    if (c === '\\' && (src[j + 1] === '\n' || (src[j + 1] === '\r' && src[j + 2] === '\n'))) { j += src[j + 1] === '\r' ? 3 : 2; continue; }
    if (c === '\n') break;
    if (c === '/' && src[j + 1] === '/') break;
    if (c === '/' && src[j + 1] === '*') {
      text += `${src.slice(from, j)} `;
      j = blockComment(S, j, false);
      from = j;
      continue;
    }
    if (c === '"' || c === "'") {
      // a string or character literal; `#error don't` has no closing quote and is plain text
      let k = j + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      j = src[k] === c ? k + 1 : j + 1;
      continue;
    }
    j++;
  }
  let e = j;
  while (e > from && isSpace(src.charCodeAt(e - 1))) e--;
  text += src.slice(from, e);
  const tok = S.token('punct', i, Math.max(e, i + 1), { pp: true });
  tok.v = text.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return Math.max(j, i + 1);
}

function readNumber(S, i, digitQuote) {
  const { src, n } = S;
  let j = i;
  const run = test => {
    while (j < n) {
      const c = src.charCodeAt(j);
      if (test(c) || c === 95 || (digitQuote && c === 39 && j > i && isHex(src.charCodeAt(j + 1)))) j++;
      else break;
    }
  };
  if (src[j] === '0' && /[xXbBoO]/.test(src[j + 1] || '')) {
    j += 2;
    run(isHex);
    if (src[j] === '.' && isHex(src.charCodeAt(j + 1))) { j++; run(isHex); }
    if (/[pP]/.test(src[j] || '') && /[-+\d]/.test(src[j + 1] || '')) { j += 2; run(isDigit); }
  } else {
    run(isDigit);
    if (src[j] === '.' && isDigit(src.charCodeAt(j + 1))) { j++; run(isDigit); }
    if (/[eE]/.test(src[j] || '') && (isDigit(src.charCodeAt(j + 1)) || (/[-+]/.test(src[j + 1] || '') && isDigit(src.charCodeAt(j + 2))))) {
      j += 2;
      run(isDigit);
    }
  }
  while (j < n && isIdPart(src.charCodeAt(j))) j++;  // suffixes: u32, L, f, n, i, ULL
  return j;
}

/** Identifier, number or one punctuation character: what every language shares. */
function generic(S, i, P) {
  const { src, n } = S;
  const c = src.charCodeAt(i);
  if (isIdStart(c)) {
    let j = i + 1;
    while (j < n && isIdPart(src.charCodeAt(j))) j++;
    if (P.idTail) j = P.idTail(S, i, j);
    S.token('id', i, j);
    return j;
  }
  if (isDigit(c)) {
    const j = readNumber(S, i, P.digitQuote);
    S.token('num', i, j);
    return j;
  }
  const j = c >= 0xD800 && c <= 0xDBFF && i + 1 < n ? i + 2 : i + 1;
  S.token('punct', i, j);
  return j;
}

// ── Literal forms per language ───────────────────────────────────────────────
//
// Each `step(S, i)` consumes a comment or literal starting at `i` and returns
// the index after it, or -1 so the generic reader takes over. A `*Literal`
// function only measures (it is reused inside interpolation holes).

const JS_REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.t === 'num' || prev.t === 'str') return false;
  if (prev.t === 'id') return JS_REGEX_AFTER.has(prev.v);
  return prev.v !== ')' && prev.v !== ']';  // after `}` a block ended more often than an object literal
}

function jsRegex(S, i) {
  const { src, n } = S;
  if (src[i + 1] === '/' || src[i + 1] === '*') return -1;
  let j = i + 1;
  let inClass = false;
  while (j < n) {
    const c = src[j];
    if (c === '\n' || c === '\r') return -1;  // not a regex: `/` is division
    if (c === '\\') { j += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      return j;
    }
    j++;
  }
  return -1;
}

function jsLiteral(S, i, nested) {
  const c = S.src[i];
  if (c === '"' || c === "'") return quoted(S, i, c);
  if (c === '`') {
    return quoted(S, i, '`', {
      multi: true,
      hole: j => (S.src[j] === '$' && S.src[j + 1] === '{' ? balanced(S, j + 1, '{', '}', jsInner(S)) : -1),
    });
  }
  if (c === '/' && !nested) return jsRegex(S, i);
  return -1;
}

/** Inside `${…}` there are no tokens yet, so a regex is told from division by the character before it. */
function regexAllowedAt(S, j) {
  const { src } = S;
  let q = j - 1;
  while (q >= 0 && isSpace(src.charCodeAt(q))) q--;
  if (q < 0 || '(,=:[!&|?{};+-*%<>~^'.includes(src[q])) return true;
  let w = q;
  while (w >= 0 && isIdPart(src.charCodeAt(w))) w--;
  return w < q && JS_REGEX_AFTER.has(src.slice(w + 1, q + 1));
}
const jsInner = S => j => {
  const k = skipComment(S, j, false);
  if (k >= 0) return k;
  if (S.src[j] === '/' && regexAllowedAt(S, j)) {
    const r = jsRegex(S, j);
    if (r > j) return r;
  }
  return jsLiteral(S, j, true);
};

function jsStep(S, i) {
  if (i === 0 && S.src.startsWith('#!')) return lineComment(S, 0, 2);
  const k = cComment(S, i);
  if (k >= 0) return k;
  if (S.src[i] === '/' && !regexAllowed(S.last())) return -1;
  const e = jsLiteral(S, i, false);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const PY_QUOTE = /([rRbBuUfFtT]{0,2})('''|"""|'|")/y;
const PY_PREFIX = /^(?:|r|u|b|f|t|br|rb|fr|rf|tr|rt)$/;

function pyLiteral(S, i) {
  const { src } = S;
  const c = src.charCodeAt(i);
  if (c !== 34 && c !== 39 && !/[rRbBuUfFtT]/.test(src[i])) return -1;
  PY_QUOTE.lastIndex = i;
  const m = PY_QUOTE.exec(src);
  if (!m || !PY_PREFIX.test(m[1].toLowerCase())) return -1;
  const fmt = /[fFtT]/.test(m[1]);
  const hole = fmt ? j => {
    if (src[j] !== '{') return -1;
    if (src[j + 1] === '{') return j + 2;
    return balanced(S, j, '{', '}', k => pyLiteral(S, k));
  } : null;
  return quoted(S, i + m[1].length, m[2], { multi: m[2].length === 3, hole });
}

function pyStep(S, i) {
  if (S.src[i] === '#') return lineComment(S, i, 1);
  const k = continuation(S, i);
  if (k >= 0) return k;
  const e = pyLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

function goStep(S, i) {
  const k = cComment(S, i);
  if (k >= 0) return k;
  const c = S.src[i];
  let e = -1;
  if (c === '"' || c === "'") e = quoted(S, i, c);
  else if (c === '`') e = quoted(S, i, '`', { esc: false, multi: true });
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const RUST_RAW = /[bc]?r(#*)"/y;
const RUST_CHAR = /'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]{1,6}\}|[nrt0\\'"])|[^'\\\n\r])'/uy;

function rustChar(S, i) {
  RUST_CHAR.lastIndex = i;
  const m = RUST_CHAR.exec(S.src);
  return m ? i + m[0].length : -1;
}

function rustLiteral(S, i) {
  const { src } = S;
  const c = src[i];
  if (c === 'r' || c === 'b' || c === 'c') {
    RUST_RAW.lastIndex = i;
    const m = RUST_RAW.exec(src);
    if (m) return quoted(S, i + m[0].length - 1, '"', { close: `"${m[1]}`, esc: false, multi: true });
    if ((c === 'b' || c === 'c') && src[i + 1] === '"') return quoted(S, i + 1, '"', { multi: true });
    if (c === 'b' && src[i + 1] === "'") return rustChar(S, i + 1);
    return -1;
  }
  if (c === '"') return quoted(S, i, '"', { multi: true });
  if (c === "'") return rustChar(S, i);
  return -1;
}

function rustStep(S, i) {
  const k = cComment(S, i, { nested: true, docLines: true });
  if (k >= 0) return k;
  const { src, n } = S;
  const e = rustLiteral(S, i);
  if (e >= 0) { S.token('str', i, e); return e; }
  // a lifetime or loop label (`'a`, `'static`): what is left of a `'` that is not a char literal
  if (src[i] === "'" && isIdStart(src.charCodeAt(i + 1))) {
    let j = i + 2;
    while (j < n && isIdPart(src.charCodeAt(j))) j++;
    S.token('id', i, j);
    return j;
  }
  // a raw identifier: r#type
  if (src[i] === 'r' && src[i + 1] === '#' && isIdStart(src.charCodeAt(i + 2))) {
    let j = i + 3;
    while (j < n && isIdPart(src.charCodeAt(j))) j++;
    S.token('id', i, j);
    return j;
  }
  return -1;
}

function javaStep(S, i) {
  const k = cComment(S, i);
  if (k >= 0) return k;
  const { src } = S;
  let e = -1;
  if (src.startsWith('"""', i)) e = quoted(S, i, '"""', { multi: true });
  else if (src[i] === '"' || src[i] === "'") e = quoted(S, i, src[i]);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

function ktLiteral(S, i) {
  const { src } = S;
  const hole = j => (src[j] === '$' && src[j + 1] === '{' ? balanced(S, j + 1, '{', '}', ktInner(S)) : -1);
  if (src.startsWith('"""', i)) {
    let e = quoted(S, i, '"""', { esc: false, multi: true, hole });
    while (src[e] === '"') e++;  // `""""` closes on the last quote of the run
    return e;
  }
  if (src[i] === '"') return quoted(S, i, '"', { hole });
  if (src[i] === "'") return quoted(S, i, "'");
  return -1;
}
const ktInner = S => j => { const k = skipComment(S, j, true); return k >= 0 ? k : ktLiteral(S, j); };

function ktStep(S, i) {
  const k = cComment(S, i, { nested: true });
  if (k >= 0) return k;
  if (S.src[i] === '`') return backtickId(S, i);
  const e = ktLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

/** C# strings: regular, verbatim `@"…"`, interpolated `$"…{x}…"` (and `$@`/`@$`), raw `"""…"""`. */
function csLiteral(S, i) {
  const { src, n } = S;
  const c = src[i];
  if (c === "'") return quoted(S, i, "'");
  if (c !== '"' && c !== '$' && c !== '@') return -1;
  let j = i;
  let dollars = 0;
  let verbatim = false;
  while (src[j] === '$') { dollars++; j++; }
  if (src[j] === '@') {
    verbatim = true;
    j++;
    while (src[j] === '$') { dollars++; j++; }
  }
  if (src[j] !== '"') return -1;
  if (src.startsWith('"""', j)) {
    let q = 3;
    while (src[j + q] === '"') q++;
    const close = src.indexOf('"'.repeat(q), j + q);
    if (close < 0) { S.fail('unterminated raw string', i); return n; }
    return close + q;
  }
  const hole = dollars ? k => {
    if (src[k] !== '{') return -1;
    if (src[k + 1] === '{') return k + 2;
    return balanced(S, k, '{', '}', csInner(S));
  } : null;
  if (!verbatim) return quoted(S, j, '"', { hole });
  let k = j + 1;
  while (k < n) {
    if (src[k] === '"') {
      if (src[k + 1] === '"') { k += 2; continue; }
      return k + 1;
    }
    if (hole) {
      const h = hole(k);
      if (h > k) { k = h; continue; }
    }
    k++;
  }
  S.fail('unterminated string', i);
  return n;
}
const csInner = S => j => { const k = skipComment(S, j, false); return k >= 0 ? k : csLiteral(S, j); };

function csStep(S, i) {
  if (S.src[i] === '#' && atLineStart(S, i)) return directiveLine(S, i);
  const k = cComment(S, i, { docLines: true });
  if (k >= 0) return k;
  const e = csLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

/** Swift strings: `"…\(x)…"`, `"""…"""`, raw `#"…\#(x)…"#`, and `#/regex/#`. */
function swiftLiteral(S, i) {
  const { src, n } = S;
  let j = i;
  let hashes = 0;
  while (src[j] === '#') { hashes++; j++; }
  if (hashes > 0 && src[j] === '/') {
    const close = `/${'#'.repeat(hashes)}`;
    const k = src.indexOf(close, j + 1);
    if (k < 0) { S.fail('unterminated regex', i); return n; }
    return k + close.length;
  }
  if (src[j] !== '"') return -1;
  const multi = src.startsWith('"""', j);
  const quote = multi ? '"""' : '"';
  const close = quote + '#'.repeat(hashes);
  const esc = `\\${'#'.repeat(hashes)}`;
  let k = j + quote.length;
  while (k < n) {
    if (src.startsWith(esc, k)) {
      const after = k + esc.length;
      if (src[after] === '(') { k = balanced(S, after, '(', ')', swiftInner(S)); continue; }
      k = after + 1;
      continue;
    }
    if (src.startsWith(close, k)) return k + close.length;
    if (src[k] === '\n' && !multi) { S.fail('unterminated string', i); return k; }
    k++;
  }
  S.fail('unterminated string', i);
  return n;
}
const swiftInner = S => j => { const k = skipComment(S, j, true); return k >= 0 ? k : swiftLiteral(S, j); };

function swiftStep(S, i) {
  const k = cComment(S, i, { nested: true, docLines: true });
  if (k >= 0) return k;
  const c = S.src[i];
  if (c === '`') return backtickId(S, i);
  if (c !== '"' && c !== '#') return -1;
  const e = swiftLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const PHP_OPEN = /<\?(?:php\b|=)?/gi;
const PHP_HEREDOC = /<<<[ \t]*(["']?)([A-Za-z_]\w*)\1\r?\n/y;

/** Text before the first `<?php` is inline HTML: one literal, so its braces do not count. */
function phpStart(S) {
  PHP_OPEN.lastIndex = 0;
  const m = PHP_OPEN.exec(S.src);
  if (!m) {
    if (S.n) S.token('str', 0, S.n, { html: true });
    return S.n;
  }
  const after = m.index + m[0].length;
  if (m.index > 0) S.token('str', 0, after, { html: true });
  return after;
}

/** `?> … <?php`: inline HTML between PHP blocks, as one literal. */
function phpHtml(S, i) {
  PHP_OPEN.lastIndex = i + 2;
  const m = PHP_OPEN.exec(S.src);
  const e = m ? m.index + m[0].length : S.n;
  S.token('str', i, e, { html: true });
  return e;
}

function phpLiteral(S, i) {
  const { src, n } = S;
  const c = src[i];
  if (c === "'") return quoted(S, i, "'", { multi: true });
  if (c === '"' || c === '`') {
    return quoted(S, i, c, {
      multi: true,
      hole: j => {
        if (src[j] === '{' && src[j + 1] === '$') return balanced(S, j, '{', '}', phpInner(S));
        if (src[j] === '$' && src[j + 1] === '{') return balanced(S, j + 1, '{', '}', phpInner(S));
        return -1;
      },
    });
  }
  if (c === '<' && src.startsWith('<<<', i)) {
    PHP_HEREDOC.lastIndex = i;
    const m = PHP_HEREDOC.exec(src);
    if (!m) return -1;
    const closer = new RegExp(`\\n[ \\t]*${m[2]}(?![A-Za-z0-9_\\x80-\\uffff])`, 'g');
    closer.lastIndex = i + m[0].length - 1;
    const r = closer.exec(src);
    if (!r) { S.fail('unterminated heredoc', i); return n; }
    return r.index + r[0].length;
  }
  return -1;
}
const phpInner = S => j => { const k = skipComment(S, j, false); return k >= 0 ? k : phpLiteral(S, j); };

function phpStep(S, i) {
  const { src } = S;
  const c = src[i];
  const d = src[i + 1];
  if (c === '?' && d === '>') return phpHtml(S, i);
  if ((c === '/' && d === '/') || (c === '#' && d !== '[')) {
    let e = lineEnd(S, i);
    const tag = src.indexOf('?>', i);
    if (tag >= 0 && tag < e) e = tag;  // `?>` ends a line comment
    return S.comment('line', i, e, src.slice(i + (c === '#' ? 1 : 2), e).replace(/\r$/, ''));
  }
  if (c === '/' && d === '*') return blockComment(S, i, false);
  const e = phpLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const RB_CLOSERS = { '(': ')', '[': ']', '{': '}', '<': '>' };
const RB_PERCENT = /%([qQwWiIrsx]?)([^\w\s])/y;
const RB_OP_SYMBOL = /\[\]=?|<=>|===?|=~|!=|!~|\*\*|<<|>>|<=|>=|[+-]@|[`+\-*/%<>!~^&|]/y;
const RB_HEREDOC = /<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/y;
const RB_VALUE_AFTER = new Set(['if', 'unless', 'while', 'until', 'and', 'or', 'not', 'return', 'when', 'then', 'else', 'elsif', 'case', 'in', 'do', 'begin', 'yield', 'puts', 'print', 'p', 'raise']);

/** A value (not an operator) is expected at `i`: decides `/regex/`, `%w[…]`, heredocs and `?c`. */
function rubyValueCtx(S, i, prev) {
  if (!prev) return true;
  if (S.src.lastIndexOf('\n', i - 1) >= prev.e) return true;  // first token on its line
  if (prev.t === 'num' || prev.t === 'str') return false;
  if (prev.t === 'punct') return !(prev.v === ')' || prev.v === ']' || prev.v === '}');
  if (prev.t === 'id') {
    if (RB_VALUE_AFTER.has(prev.v)) return true;
    // `get /x/` vs `a / b`: an argument follows when spaced before and not after
    return isSpace(S.src.charCodeAt(i - 1)) && !isSpace(S.src.charCodeAt(i + 1));
  }
  return false;
}

const rubyHole = S => j => (S.src[j] === '#' && S.src[j + 1] === '{' ? balanced(S, j + 1, '{', '}', rubyInner(S)) : -1);
const rubyInner = S => j => rubyLiteral(S, j, null, true);

function rubyDelimited(S, i, j, open, close, interpolates) {
  const { src, n } = S;
  let depth = 1;
  while (j < n) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (interpolates && ch === '#' && src[j + 1] === '{') { j = balanced(S, j + 1, '{', '}', rubyInner(S)); continue; }
    if (open !== close && ch === open) depth++;
    else if (ch === close && --depth === 0) return j + 1;
    j++;
  }
  S.fail('unterminated literal', i);
  return n;
}

function rubyLiteral(S, i, prev, nested) {
  const { src, n } = S;
  const c = src[i];
  if (c === "'") return quoted(S, i, "'", { multi: true });
  if (c === '"' || c === '`') return quoted(S, i, c, { multi: true, hole: rubyHole(S) });
  if (c === ':') {
    const d = src[i + 1];
    if (src[i - 1] === ':' || d === ':') return -1;
    if (d === '"' || d === "'") return quoted(S, i + 1, d, { multi: true, hole: d === '"' ? rubyHole(S) : null });
    RB_OP_SYMBOL.lastIndex = i + 1;
    const op = RB_OP_SYMBOL.exec(src);
    if (op) {  // an operator symbol such as :/, :`, :<=>, :[]=
      const e = i + 1 + op[0].length;
      if (e >= n || /[\s,)\]};.]/.test(src[e])) return e;
    }
    if (isIdStart(src.charCodeAt(i + 1))) {
      let j = i + 2;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      if ((src[j] === '?' || src[j] === '!' || src[j] === '=') && src[j + 1] !== '=' && src[j + 1] !== '>' && src[j + 1] !== '~') j++;
      return j;
    }
    return -1;
  }
  if (nested) return -1;
  if (c !== '%' && c !== '/') return -1;
  if (src[i + 1] === '=' && prev && prev.t === 'id') return -1;  // `dir /= x`, `n %= 3`
  if (!rubyValueCtx(S, i, prev)) return -1;
  const flags = e => { while (e < n && /[a-z]/.test(src[e])) e++; return e; };
  if (c === '/') return flags(quoted(S, i, '/', { multi: true, hole: rubyHole(S) }));
  RB_PERCENT.lastIndex = i;
  const m = RB_PERCENT.exec(src);
  if (!m) return -1;
  const open = m[2];
  const e = rubyDelimited(S, i, i + m[0].length, open, RB_CLOSERS[open] || open, m[1] === '' || /[QWIrx]/.test(m[1]));
  return m[1] === 'r' ? flags(e) : e;
}

function rubyHeredoc(S, i, prev) {
  RB_HEREDOC.lastIndex = i;
  const m = RB_HEREDOC.exec(S.src);
  if (!m || (!m[1] && !m[2] && !rubyValueCtx(S, i, prev))) return -1;
  const e = i + m[0].length;
  const tok = S.token('str', i, e);
  S.heredocs.push({ tok, id: m[3], indented: m[1] !== '' });
  return e;
}

/** At the newline that ends a heredoc opener's line: consume each pending body into its token. */
function rubyHeredocBodies(S, i) {
  const { src, n } = S;
  let j = i + 1;
  for (const h of S.heredocs) {
    const body = j;
    let found = false;
    while (j < n) {
      const le = lineEnd(S, j);
      const line = src.slice(j, le).replace(/\r$/, '');
      j = le < n ? le + 1 : n;
      if ((h.indented ? line.trim() : line) === h.id) { found = true; break; }
    }
    if (!found) S.fail('unterminated heredoc', h.tok.s);
    h.tok.v += `\n${src.slice(body, j)}`;
    h.tok.bodyS = body;
    h.tok.bodyE = j;
  }
  S.heredocs = [];
  return j;
}

function rubyIdTail(S, i, j) {
  const { src } = S;
  if ((src[j] === '?' || src[j] === '!') && src[j + 1] !== '=') return j + 1;  // empty?, save!
  if (src[j] === ':' && src[j + 1] !== ':') return j + 1;  // label: `key: value`
  return j;
}

function rubyStep(S, i) {
  const { src, n } = S;
  const c = src[i];
  if (c === '#') return lineComment(S, i, 1);
  const k = continuation(S, i);
  if (k >= 0) return k;
  const lineStart = i === 0 || src[i - 1] === '\n';
  if (lineStart && c === '=' && src.startsWith('=begin', i) && (i + 6 >= n || isSpace(src.charCodeAt(i + 6)))) {
    const re = /\n=end(?=\s|$)[^\n]*/g;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) S.fail('unterminated =begin comment', i);
    const e = m ? m.index + m[0].length : n;
    const bodyStart = Math.min(lineEnd(S, i) + 1, e);
    return S.comment('block', i, e, src.slice(bodyStart, m ? m.index + 1 : n));
  }
  if (lineStart && c === '_' && /^__END__(?:\r?\n|$)/.test(src.slice(i, i + 9))) return n;  // data, not code
  if (c === '@') {
    let j = i;
    while (src[j] === '@' && j - i < 2) j++;
    if (!isIdStart(src.charCodeAt(j))) return -1;
    j++;
    while (j < n && isIdPart(src.charCodeAt(j))) j++;
    S.token('id', i, j);
    return j;
  }
  const prev = S.last();
  if (prev && prev.t === 'id' && prev.v === 'def' && !isIdStart(src.charCodeAt(i))) return -1;  // `def /(o)`, `def `(cmd)`: an operator method name
  if (c === '<' && src[i + 1] === '<') {
    const e = rubyHeredoc(S, i, prev);
    if (e >= 0) return e;
  }
  if (c === '?' && i + 1 < n && !isSpace(src.charCodeAt(i + 1)) && rubyValueCtx(S, i, prev)) {
    const e = src[i + 1] === '\\' ? i + 3 : i + 2;  // ?a, ?\n
    if (e <= n && !isIdPart(src.charCodeAt(e))) { S.token('str', i, e); return e; }
  }
  const e = rubyLiteral(S, i, prev, false);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const C_RAW = /(?:u8|[LuU])?R"([^()\\\s"]{0,16})\(/y;
const C_QUOTE = /(?:u8|[LuU])?(["'])/y;

function cLiteral(S, i) {
  const { src } = S;
  const c = src[i];
  if (c === 'R' || c === 'u' || c === 'U' || c === 'L') {
    C_RAW.lastIndex = i;
    const m = C_RAW.exec(src);
    if (m) {
      const close = `)${m[1]}"`;
      const k = src.indexOf(close, i + m[0].length);
      if (k < 0) { S.fail('unterminated raw string', i); return S.n; }
      return k + close.length;
    }
  }
  if (c === '"' || c === "'" || c === 'u' || c === 'U' || c === 'L') {
    C_QUOTE.lastIndex = i;
    const m = C_QUOTE.exec(src);
    if (m) return quoted(S, i + m[0].length - 1, m[1]);
  }
  return -1;
}

function cStep(S, i) {
  if (S.src[i] === '#' && atLineStart(S, i)) return directiveLine(S, i);
  const k = cComment(S, i, { docLines: true });
  if (k >= 0) return k;
  const e = cLiteral(S, i);
  if (e < 0) return -1;
  S.token('str', i, e);
  return e;
}

const PROFILES = {
  js: { step: jsStep },
  ts: { step: jsStep },
  python: { step: pyStep, layout: 'python' },
  go: { step: goStep, layout: 'go' },
  rust: { step: rustStep },
  java: { step: javaStep },
  kotlin: { step: ktStep, layout: 'soft' },
  csharp: { step: csStep },
  php: { step: phpStep, start: phpStart },
  ruby: { step: rubyStep, idTail: rubyIdTail, layout: 'soft' },
  swift: { step: swiftStep, layout: 'soft' },
  c: { step: cStep, digitQuote: true },
  cpp: { step: cStep, digitQuote: true },
};

function scan(src, lang, P) {
  const S = new Scanner(src, lang);
  let i = P.start ? P.start(S) : 0;
  while (i < S.n) {
    const c = src.charCodeAt(i);
    if (isSpace(c)) {
      i = c === NL && S.heredocs.length ? rubyHeredocBodies(S, i) : i + 1;
      continue;
    }
    const k = P.step(S, i);
    i = k > i ? k : generic(S, i, P);
  }
  if (S.heredocs.length) {
    S.fail('unterminated heredoc', S.heredocs[0].tok.s);
    S.heredocs = [];
  }
  return S;
}

// ── Layout: where a newline ends a statement ─────────────────────────────────

const GO_KEYWORDS = new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']);
const GO_ENDERS = new Set(['break', 'continue', 'fallthrough', 'return']);
const SOFT_NONENDERS = {
  kotlin: new Set(['as', 'is', 'in', 'fun', 'class', 'interface', 'object', 'val', 'var', 'typealias', 'constructor', 'if', 'else', 'when', 'try', 'catch', 'finally', 'for', 'while', 'do', 'throw', 'package', 'import', 'where', 'by', 'out', 'vararg', 'override', 'open', 'private', 'public', 'protected', 'internal', 'data', 'sealed', 'abstract', 'final', 'enum', 'inner', 'annotation', 'companion', 'suspend', 'inline', 'operator', 'infix', 'tailrec', 'lateinit', 'const', 'external']),
  // Swift parses `return` + newline + expression as one statement, so `return` does not end a line.
  // `async`, `throws` and `rethrows` close a signature (`func f() async throws` in a protocol), so they do.
  swift: new Set(['as', 'is', 'in', 'func', 'class', 'struct', 'enum', 'protocol', 'extension', 'let', 'var', 'if', 'else', 'guard', 'switch', 'case', 'for', 'while', 'repeat', 'do', 'catch', 'throw', 'import', 'where', 'return', 'try', 'await', 'some', 'any', 'static', 'private', 'public', 'internal', 'fileprivate', 'open', 'final', 'override', 'mutating', 'lazy', 'weak', 'typealias', 'init', 'deinit', 'subscript']),
  ruby: new Set(['and', 'or', 'not', 'then', 'do', 'else', 'elsif', 'begin', 'when', 'in', 'if', 'unless', 'while', 'until', 'case', 'def', 'class', 'module', 'ensure', 'rescue']),
};

function endLine(S, t) {
  return t.t === 'str' && t.e - t.s > 1 ? S.line(t.e - 1) : t.line;
}

function virtualSemi(at, line, v = ';') {
  return { t: 'semi', v, s: at, e: at, line, virtual: true };
}

/** Go: after an identifier, literal, break/continue/fallthrough/return, `++`, `--`, `)`, `]` or `}` at line end. */
function goEnds(T, k) {
  const t = T[k];
  if (t.t === 'num' || t.t === 'str') return true;
  if (t.t === 'id') return !GO_KEYWORDS.has(t.v) || GO_ENDERS.has(t.v);
  if (t.t !== 'punct') return false;
  if (t.v === ')' || t.v === ']' || t.v === '}') return true;
  const p = T[k - 1];
  return (t.v === '+' || t.v === '-') && !!p && p.v === t.v && p.e === t.s;
}

function softEnds(T, k, lang, generics) {
  const t = T[k];
  if (t.t === 'num' || t.t === 'str') return true;
  if (t.t === 'id') return !SOFT_NONENDERS[lang].has(t.v);
  if (t.t !== 'punct' || t.pp) return false;
  if (t.v === ')' || t.v === ']' || t.v === '}') return true;
  if (t.v === '>' && generics && generics.has(k)) return true;  // fun f(): List<String>
  const p = T[k - 1];
  const adj = !!p && p.e === t.s;
  if ((t.v === '+' || t.v === '-') && adj && p.v === t.v) return true;  // x++ / x--
  return (t.v === '!' || t.v === '?') && adj && (p.t === 'id' || p.v === ')' || p.v === ']' || p.v === '!');  // x!!, x?
}

/** The next line continues this statement: a leading `.`, `?.`, `?:`, `&&`, `||`, `&.`, or (Kotlin/Swift) `{` / else / catch / finally. */
function softContinues(T, k, lang) {
  const t = T[k];
  const nx = T[k + 1];
  const adj = !!nx && nx.s === t.e;
  if (t.t === 'punct') {
    if (t.v === '.') return true;
    if (t.v === '&' && adj && (nx.v === '&' || (lang === 'ruby' && nx.v === '.'))) return true;
    if (t.v === '|' && adj && nx.v === '|') return true;
    if (t.v === '?' && adj && (nx.v === '.' || nx.v === ':')) return true;
    return lang !== 'ruby' && t.v === '{';
  }
  return lang !== 'ruby' && t.t === 'id' && (t.v === 'else' || t.v === 'catch' || t.v === 'finally');
}

/** Kotlin/Swift: an annotation alone on its line does not end a statement (`@Test` + newline + `fun`). */
function annotationEnds(T, lang) {
  const ends = new Set();
  if (lang !== 'kotlin' && lang !== 'swift') return ends;
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t.t !== 'punct' || t.v !== '@') continue;
    const p = T[k - 1];
    if (p && p.t === 'id' && p.e === t.s) continue;  // a label reference: return@forEach
    let j = k + 1;
    if (!T[j] || T[j].t !== 'id' || T[j].s !== t.e) continue;
    while (T[j + 2] && (T[j + 1].v === '.' || T[j + 1].v === ':') && T[j + 2].t === 'id') j += 2;
    if (T[j + 1] && T[j + 1].v === '(' && T[j + 1].s === T[j].e) {
      let depth = 0;
      let q = j + 1;
      for (; q < T.length; q++) {
        if (T[q].v === '(') depth++;
        else if (T[q].v === ')' && --depth === 0) break;
      }
      if (q >= T.length) continue;
      j = q;
    }
    ends.add(j);
  }
  return ends;
}

/**
 * Kotlin/Swift: the `>` tokens that close a generic argument list (`List<T>`,
 * `Map<K, V>`, `Array<Array<Int>>`), told from comparisons by the `<` that
 * opens them touching a type name. A `>` like that ends a line; `a >` does not.
 */
function genericCloses(T, lang) {
  const closes = new Set();
  if (lang !== 'kotlin' && lang !== 'swift') return closes;
  const open = [];
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t.t !== 'punct' || t.pp) continue;
    const p = T[k - 1];
    if (t.v === '<' && p && p.t === 'id' && p.e === t.s) open.push(k);
    else if (t.v === '>' && open.length && !(p && p.e === t.s && (p.v === '-' || p.v === '='))) { open.pop(); closes.add(k); }
    else if (t.v === '{' || t.v === '}' || t.v === ';' || t.v === '=') open.length = 0;
  }
  return closes;
}

/** Python columns: tabs advance to the next multiple of 8, as the tokenizer does. */
function indentOf(S, tok) {
  let col = 0;
  for (let q = S.starts[tok.line - 1]; q < tok.s; q++) {
    const ch = S.src[q];
    if (ch === '\t') col = (Math.floor(col / 8) + 1) * 8;
    else if (ch === '\f') col = 0;
    else col++;
  }
  return col;
}

function pythonLayout(S, T) {
  const out = [];
  const indents = [0];
  let depth = 0;
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    out.push(t);
    if (t.t === 'punct') {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if ((t.v === ')' || t.v === ']' || t.v === '}') && depth > 0) depth--;
    }
    const nx = T[k + 1];
    const end = endLine(S, t);
    if (nx && (nx.line <= end || depth > 0 || S.cont.has(end))) continue;
    out.push(virtualSemi(t.e, end));
    const col = nx ? indentOf(S, nx) : 0;
    let top = indents[indents.length - 1];
    if (col > top) {
      indents.push(col);
      out.push(virtualSemi(t.e, end, INDENT));
      continue;
    }
    while (col < top) {
      indents.pop();
      out.push(virtualSemi(t.e, end, DEDENT));
      top = indents[indents.length - 1];
    }
    if (col !== top) S.fail('inconsistent dedent', nx.s);
  }
  return out;
}

function layout(S, P) {
  const T = S.tokens;
  if (!P.layout || !T.length) return T;
  if (P.layout === 'python') return pythonLayout(S, T);
  const go = P.layout === 'go';
  const annos = go ? null : annotationEnds(T, S.lang);
  const generics = go ? null : genericCloses(T, S.lang);
  const out = [];
  const stack = [];
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    out.push(t);
    if (t.t === 'punct' && !t.pp) {
      if (t.v === '(' || t.v === '[' || t.v === '{') stack.push(t.v);
      else if ((t.v === ')' || t.v === ']' || t.v === '}') && stack.length) stack.pop();
    }
    const nx = T[k + 1];
    const end = endLine(S, t);
    if (nx && nx.line <= end) continue;
    if (go) {
      if (goEnds(T, k)) out.push(virtualSemi(t.e, end));
      continue;
    }
    if (!softEnds(T, k, S.lang, generics)) continue;
    // Kotlin and Swift ignore newlines inside ( ) and [ ]; Ruby does not
    // (`T.let(begin` + newline + statements), and a trailing `,` already continues its line.
    const bracketed = S.lang !== 'ruby' && stack.length && stack[stack.length - 1] !== '{';
    if (nx && (S.cont.has(end) || bracketed || annos.has(k) || softContinues(T, k + 1, S.lang))) continue;
    out.push(virtualSemi(t.e, end));
  }
  return out;
}

/** Pair `() [] {}` by token index; the first mismatch or leftover opener becomes the error. */
function pairUp(S, T) {
  const pairs = new Int32Array(T.length).fill(-1);
  const stack = [];
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t.t !== 'punct' || t.pp) continue;
    const v = t.v;
    if (v === '(' || v === '[' || v === '{') { stack.push(k); continue; }
    if (v !== ')' && v !== ']' && v !== '}') continue;
    const want = v === ')' ? '(' : v === ']' ? '[' : '{';
    if (stack.length && T[stack[stack.length - 1]].v === want) {
      const o = stack.pop();
      pairs[o] = k;
      pairs[k] = o;
      continue;
    }
    S.fail(`unbalanced '${v}'`, t.s);
    for (let q = stack.length - 1; q >= 0; q--) {
      if (T[stack[q]].v !== want) continue;
      const o = stack[q];
      stack.length = q;
      pairs[o] = k;
      pairs[k] = o;
      break;
    }
  }
  if (stack.length) S.fail(`unclosed '${T[stack[0]].v}'`, T[stack[0]].s);
  return pairs;
}

/**
 * Lex `content` as `lang`.
 *
 * Tokens are `{ t, v, s, e, line }`: `t` is 'id' | 'num' | 'str' | 'punct' |
 * 'semi'. Every literal kind is one 'str' token (a Ruby heredoc token sits at
 * its opener and its `v` carries the body). A preprocessor line is one 'punct'
 * token with `pp: true`. 'semi' tokens are virtual and zero-width: `v` is ';'
 * where a newline ends a statement, or (Python) an indent/dedent marker.
 * Comments are `{ s, e, line, endLine, text, raw, kind }`, kind 'line' |
 * 'block' | 'doc'. `error` is non-null when delimiters do not balance or a
 * literal or comment never closes. `pairs[k]` is the token index of the
 * bracket that matches token `k`, or -1. Never throws.
 *
 * @param {string} content
 * @param {string} lang one of the languages `languageOf` returns
 * @returns {{ lang: string, tokens: object[], comments: object[], error: string|null, pairs: Int32Array, lineStarts: number[] }}
 */
export function lex(content, lang) {
  const src = typeof content === 'string' ? content : String(content ?? '');
  // Without a token stream the whole text is one literal, so a floor over it still changes when the file does.
  const opaque = error => ({
    lang, comments: [], error, opaque: true, lineStarts: lineStartsOf(src),
    tokens: src ? [{ t: 'str', v: src, s: 0, e: src.length, line: 1 }] : [],
    pairs: new Int32Array(src ? 1 : 0).fill(-1),
  });
  const P = PROFILES[lang];
  if (!P) return opaque(`no pattern lexer for ${lang}`);
  try {
    const S = scan(src, lang, P);
    const tokens = layout(S, P);
    const pairs = pairUp(S, tokens);
    return { lang, tokens, comments: S.comments, error: S.error, pairs, lineStarts: S.starts };
  } catch (err) {
    return opaque(`lexer failure: ${err && err.message}`);
  }
}

// ── Floor fingerprint ────────────────────────────────────────────────────────

/**
 * The floor token stream over `[s, e)`: every token that lies wholly inside
 * the range, plus each directive comment as `\u0001directive:<text>`, in
 * source order. Whitespace and other comments are dropped; literals stay
 * verbatim (with `\r\n` read as `\n`, so a checkout's line endings do not
 * matter); virtual statement ends stay as `;`.
 *
 * On a line marked `docguard:volatile`, the tokens that lie wholly on it are
 * one placeholder; a token that crosses onto another line, and layout (virtual
 * statement ends, indent and dedent), stay as they are. A stream with no lexer
 * (one opaque token) has its marked lines replaced in the text.
 * @implements docguard.volatile-anchor-lines#FR-002
 * @returns {string[]}
 */
export function floorTokens(lexed, s, e, volatile = NO_VOLATILE) {
  const out = [];
  if (!lexed || !Array.isArray(lexed.tokens)) return out;
  const T = lexed.tokens;
  const C = Array.isArray(lexed.comments) ? lexed.comments : [];
  let ti = lowerBound(T, s);
  let ci = lowerBound(C, s);
  const placed = new Set();
  for (;;) {
    const t = ti < T.length && T[ti].s < e ? T[ti] : null;
    const c = ci < C.length && C[ci].s < e ? C[ci] : null;
    if (!t && !c) break;
    if (t && (!c || t.s <= c.s)) {
      if (t.e <= e) {
        if (volatile.size && lexed.opaque) out.push({ v: maskVolatileLines(t.v, volatile).replace(/\r\n/g, '\n'), layout: false });
        else if (volatile.size && t.t !== 'semi' && volatile.has(t.line) && lineOf(lexed.lineStarts, Math.max(t.s, t.e - 1)) === t.line) {
          if (!placed.has(t.line)) { placed.add(t.line); out.push({ v: VOLATILE_PLACEHOLDER, layout: false }); }
        } else out.push({ v: t.t === 'str' ? t.v.replace(/\r\n/g, '\n') : t.v, layout: t.t === 'semi' });
      }
      ti++;
    } else {
      if (c.e <= e && DIRECTIVE_RE.test(c.text)) out.push({ v: `\u0001directive:${c.text.replace(/\r\n/g, '\n').trim()}`, layout: false });
      ci++;
    }
  }
  // Virtual terminators and indent markers at the EDGES of a span are layout:
  // whether a trailing comment sits on the last line decides if the final
  // newline's `;`/dedent lands inside the span, and that must not change the
  // floor. Inside the span they stay, because there they separate statements.
  let first = 0;
  let last = out.length;
  while (first < last && out[first].layout) first++;
  while (last > first && out[last - 1].layout) last--;
  return out.slice(first, last).map(x => x.v);
}

/** `dg1:sha256:<hex>` of the floor tokens over `[s, e)` joined by NUL. */
export function floorFingerprint(lexed, s, e, volatile = NO_VOLATILE) {
  return `dg1:sha256:${createHash('sha256').update(floorTokens(lexed, s, e, volatile).join('\u0000')).digest('hex')}`;
}

/**
 * Whether everything fingerprinted over `[s, e)` lies on marked lines, so an
 * anchor there can never change (ANC011). In a stream with no lexer, every
 * line that is not blank must be marked.
 * @implements docguard.volatile-anchor-lines#FR-005
 */
export function volatileOnly(lexed, s, e, volatile = NO_VOLATILE) {
  if (!volatile.size || !lexed) return false;
  if (lexed.opaque) {
    const text = (lexed.tokens[0]?.v || '').slice(s, e);
    const lines = text.split('\n');
    const first = lineOf(lexed.lineStarts, s);
    return lines.some(l => l.trim()) && lines.every((l, i) => !l.trim() || volatile.has(first + i));
  }
  const tokens = floorTokens(lexed, s, e, volatile);
  return tokens.length > 0 && tokens.every(t => t === VOLATILE_PLACEHOLDER);
}

// ── Token helpers for the outline ────────────────────────────────────────────

const isP = (t, v) => !!t && t.t === 'punct' && !t.pp && t.v === v;
const isId = (t, v) => !!t && t.t === 'id' && (v === undefined || t.v === v);
const isTerm = t => !!t && t.v === ';' && (t.t === 'semi' || (t.t === 'punct' && !t.pp));
const isOpen = t => !!t && t.t === 'punct' && !t.pp && (t.v === '(' || t.v === '[' || t.v === '{');
const isClose = t => !!t && t.t === 'punct' && !t.pp && (t.v === ')' || t.v === ']' || t.v === '}');
const adjacent = (a, b) => !!a && !!b && a.e === b.s;
const unBacktick = v => (v.length > 1 && v[0] === '`' && v[v.length - 1] === '`' ? v.slice(1, -1) : v);
const rawName = v => (v.startsWith('r#') ? v.slice(2) : v);

const WORDY = /[\w$'"`\u0080-\uffff]/;

/** Token text joined with a space only where two words would otherwise fuse. */
function joinTokens(T, a, b) {
  let out = '';
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (!t || t.t === 'semi') continue;
    const v = t.t === 'str' ? t.v.replace(/\s+/g, ' ') : t.v;
    if (out && WORDY.test(out[out.length - 1]) && WORDY.test(v[0])) out += ' ';
    out += v;
  }
  return out;
}

/** Index after the `>` that closes the `<` at `k`, or -1 when this is not a generic list. */
function anglesFwd(E, k, hi) {
  const { T, P } = E;
  let depth = 0;
  for (; k < hi; k++) {
    const t = T[k];
    if (isTerm(t)) return -1;
    if (t.t !== 'punct') continue;
    if (t.v === '(' || t.v === '[') {
      if (P[k] < 0) return -1;
      k = P[k];
      continue;
    }
    if (t.v === '<') depth++;
    else if (t.v === '>') {
      const p = T[k - 1];
      if (adjacent(p, t) && (p.v === '-' || p.v === '=')) continue;  // -> and => inside a type
      if (--depth === 0) return k + 1;
    } else if (t.v === '{' || t.v === '}' || t.v === ')' || t.v === ']') return -1;
  }
  return -1;
}

/** Index of the `<` that opens the `>` at `k`, or -1. */
function anglesBack(E, k, lo) {
  const { T, P } = E;
  let depth = 0;
  for (; k >= lo; k--) {
    const t = T[k];
    if (isTerm(t)) return -1;
    if (t.t !== 'punct') continue;
    if (t.v === ')' || t.v === ']') {
      if (P[k] < lo) return -1;
      k = P[k];
      continue;
    }
    if (t.v === '>') {
      const p = T[k - 1];
      if (adjacent(p, t) && (p.v === '-' || p.v === '=')) continue;
      depth++;
    } else if (t.v === '<') {
      if (--depth === 0) return k;
    } else if (t.v === '{' || t.v === '}' || t.v === '(' || t.v === '[') return -1;
  }
  return -1;
}

/** First depth-0 terminator in `[k, hi)`, or -1 when a closer comes first. */
function termAfter(E, k, hi) {
  const { T, P } = E;
  for (; k < hi; k++) {
    const t = T[k];
    if (isTerm(t)) return k;
    if (isOpen(t)) {
      if (P[k] < 0) return -1;
      k = P[k];
      continue;
    }
    if (isClose(t)) return -1;
  }
  return -1;
}

const CONTINUE_KW = new Set(['else', 'catch', 'finally']);
const JS_NOT_ENDER = new Set(['in', 'of', 'instanceof', 'typeof', 'new', 'delete', 'void', 'await', 'case', 'extends', 'implements']);

function jsEnder(T, k) {
  const t = T[k];
  if (!t) return false;
  if (t.t === 'num' || t.t === 'str') return true;
  if (t.t === 'id') return !JS_NOT_ENDER.has(t.v);
  if (t.v === ')' || t.v === ']' || t.v === '}') return true;
  const p = T[k - 1];
  return (t.v === '+' || t.v === '-') && adjacent(p, t) && p.v === t.v;
}
const jsStatementStart = t => !!t && (t.t === 'id' || t.t === 'num' || (t.t === 'str' && t.v[0] !== '`'));

/**
 * The statement that starts at token `k`, up to `hi`: `{ last, next }` where
 * `last` is the index of its last token and `next` where scanning resumes.
 * A real `;` belongs to the statement; a virtual one does not. Languages with
 * explicit semicolons end a block statement at its `}` unless `else`, `catch`,
 * `finally` or `;` continues it; JS also ends at a newline where ASI would.
 */
function stmtEnd(E, k, hi) {
  const { T, P } = E;
  const layout = !!PROFILES[E.lang].layout;
  const asi = E.lang === 'js' || E.lang === 'ts';
  let last = k - 1;
  let j = k;
  while (j < hi) {
    const t = T[j];
    if (isTerm(t)) return t.virtual ? { last, next: j + 1 } : { last: j, next: j + 1 };
    if (asi && j > k && t.line > T[last].line && jsEnder(T, last) && jsStatementStart(t)) return { last, next: j };
    if (t.t === 'punct' && !t.pp) {
      const v = t.v;
      if (v === ')' || v === ']' || v === '}') return { last, next: j };
      if (v === '(' || v === '[' || v === '{') {
        const c = P[j];
        if (c < 0) return { last: hi - 1, next: hi };
        if (v === '{' && !layout) {
          const nx = T[c + 1];
          if (!nx || c + 1 >= hi) return { last: c, next: c + 1 };
          if (isTerm(nx)) return { last: c + 1, next: c + 2 };
          const sameLine = nx.line === T[c].line;
          if (isId(nx) && (CONTINUE_KW.has(nx.v) || (nx.v === 'while' && sameLine))) { last = c; j = c + 1; continue; }
          if (!sameLine) return { last: c, next: c + 1 };
          if (nx.t === 'punct' && !nx.pp && !['{', '@', '#', '['].includes(nx.v)) { last = c; j = c + 1; continue; }
          return { last: c, next: c + 1 };
        }
        last = c;
        j = c + 1;
        continue;
      }
    }
    last = j;
    j++;
  }
  return { last, next: j };
}

/**
 * The end of an expression body (`=> expr;`, `= expr;`). In C#, braces inside
 * one belong to the expression (switch expressions, initializers, lambdas),
 * so it runs to its `;`. Elsewhere it ends like a statement.
 */
function exprEnd(E, k, hi) {
  if (E.lang === 'csharp') {
    const term = termAfter(E, k, hi);
    if (term >= 0 && !E.T[term].virtual) return { last: term, next: term + 1 };
  }
  return stmtEnd(E, k, hi);
}

// ── Statement spans ──────────────────────────────────────────────────────────

const PY_CLAUSES = new Set(['elif', 'else', 'except', 'finally']);
const RB_CLAUSES = new Set(['end', 'else', 'elsif', 'when', 'in', 'rescue', 'ensure', 'then']);

/**
 * `{ s, e }` of the statement that begins at the first significant token at
 * or after `offset`, or null when that token closes a block (or there is none).
 * @param {ReturnType<typeof lex>} lexed
 * @param {number} offset
 * @returns {{ s: number, e: number } | null}
 */
export function statementSpan(lexed, offset) {
  if (!lexed || !Array.isArray(lexed.tokens) || !PROFILES[lexed.lang]) return null;
  try {
    const E = engine(lexed);
    const T = E.T;
    let k = lowerBound(T, offset);
    while (k < T.length && T[k].t === 'semi') k++;
    if (k >= T.length || isClose(T[k])) return null;
    if (E.lang === 'python') {
      if (isId(T[k]) && PY_CLAUSES.has(T[k].v)) return null;
      return pyStatement(E, k);
    }
    if (E.lang === 'ruby') {
      if (isId(T[k]) && RB_CLAUSES.has(T[k].v)) return null;
      const r = rbStmtEnd(E, k);
      return { s: T[k].s, e: T[Math.max(r.last, k)].e };
    }
    const r = stmtEnd(E, k, T.length);
    return { s: T[k].s, e: T[Math.max(r.last, k)].e };
  } catch {
    return null;
  }
}

function pyStatement(E, k) {
  const { T } = E;
  const s = T[k].s;
  let j = k;
  for (;;) {
    let nl = j;
    while (nl < T.length && !(T[nl].t === 'semi' && T[nl].v === ';')) nl++;
    if (nl >= T.length) return { s, e: T[T.length - 1].e };
    if (isP(T[nl - 1], ':') && T[nl + 1] && T[nl + 1].v === INDENT) {
      let depth = 0;
      let q = nl + 1;
      for (; q < T.length; q++) {
        if (T[q].v === INDENT) depth++;
        else if (T[q].v === DEDENT && --depth === 0) break;
      }
      if (q >= T.length) return { s, e: T[T.length - 1].e };
      const nx = T[q + 1];
      if (isId(nx) && PY_CLAUSES.has(nx.v)) { j = q + 1; continue; }
      return { s, e: T[q].s };
    }
    if (isP(T[j], '@')) { j = nl + 1; continue; }  // a decorator belongs to what it decorates
    return { s, e: T[nl].s };
  }
}

// ── Outline engine (brace languages) ─────────────────────────────────────────

const NOT_TYPE = new Set(['return', 'new', 'throw', 'else', 'case', 'goto', 'delete', 'sizeof', 'typeof', 'await', 'yield', 'in', 'is', 'as', 'instanceof', 'do', 'if', 'for', 'while', 'switch', 'catch', 'using', 'lock', 'foreach', 'fixed', 'checked', 'unchecked', 'synchronized', 'try', 'co_return', 'co_await', 'co_yield', 'and', 'or', 'not']);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'using', 'lock', 'foreach', 'return', 'new', 'else', 'do', 'try', 'fixed', 'checked', 'unchecked', 'sizeof', 'typeof', 'nameof', 'alignof', 'decltype', 'when', 'throw', 'case', 'goto', 'delete', 'await', 'yield', 'function', 'assert', 'super', 'this']);
const AFTER_PARAMS_BAD = new Set([...CONTROL].filter(v => v !== 'new'));
const AFTER_PARAMS_PUNCT = new Set([',', '.', ':', '-', '>', '<', '&', '*', '?', '~', '^']);
const TYPE_PUNCT = new Set(['.', ':', '*', '&', '?', '~', '^']);
const CALL_MODS = new Set(['pub', '__attribute__', '__attribute', '__declspec', 'alignas', '_Alignas']);
const ACCESS_LABELS = new Set(['public', 'private', 'protected', 'signals', 'slots', 'Q_SIGNALS', 'Q_SLOTS']);

function engine(lx) {
  return { lx, T: lx.tokens, P: lx.pairs, lang: lx.lang, rules: RULES[lx.lang] || { mods: new Set() }, syms: [], lastEnd: -1 };
}

/** Add a symbol; `d.start` and `d.nameIdx` are token indexes, `d.end` an offset. Returns its index. */
function addSym(E, ctx, d) {
  const { T, lx } = E;
  const s = T[d.start].s;
  const end = Math.max(d.end, T[d.nameIdx].e);
  E.syms.push({
    qual: [...(d.path ?? ctx.path), d.name].join('.'),
    name: d.name,
    kind: d.kind,
    start: s,
    end,
    startLine: T[d.start].line,
    endLine: lineOf(lx.lineStarts, Math.max(s, end - 1)),
    nameLine: T[d.nameIdx].line,
    bodyOpen: d.bodyIdx != null && d.bodyIdx >= 0 ? T[d.bodyIdx].s : null,
    parent: ctx.parent ?? null,
    topLevel: !!ctx.top,
    sig: d.sig ?? null,
  });
  return E.syms.length - 1;
}

/** The scope inside symbol `idx`: its members are qualified by it; only a module's members stay top-level. */
function child(E, ctx, idx, mode, container) {
  const sym = E.syms[idx];
  return {
    path: [sym.qual], parent: idx, mode,
    top: !!ctx.top && sym.kind === 'module' && E.lang !== 'ruby',
    container: container ?? { name: sym.name, kind: sym.kind },
  };
}

function walkBlock(E, lo, hi, ctx) {
  ctx = { ...ctx, lo };
  const { T, P, rules } = E;
  let i = lo;
  while (i < hi) {
    const r = rules.decl(E, i, hi, ctx);
    if (r) {
      E.lastEnd = r.next - 1;
      i = r.next > i ? r.next : i + 1;
      continue;
    }
    const t = T[i];
    if (isOpen(t) && P[i] > i && P[i] < hi) {
      if (rules.nested !== false) walkBlock(E, i + 1, P[i], { ...ctx, mode: 'code', top: false });
      i = P[i] + 1;
      continue;
    }
    i++;
  }
}

/** Start of an annotation whose (last) name token is `j`: `@A`, `@a.b.C`, `@field:A`; -1 when none. */
function annotationBack(E, j, lo) {
  const { T } = E;
  let q = j;
  while (q - 2 >= lo && (isP(T[q - 1], '.') || isP(T[q - 1], ':')) && isId(T[q - 2])) q -= 2;
  return q - 1 >= lo && isP(T[q - 1], '@') ? q - 1 : -1;
}

function isAccessLabel(E, j) {
  const { T } = E;
  return isP(T[j], ':') && isId(T[j - 1]) && ACCESS_LABELS.has(T[j - 1].v) && !isP(T[j + 1], ':') && !isP(T[j - 2], ':');
}

function isBoundary(E, j, lo) {
  if (j < lo) return true;
  const t = E.T[j];
  if (isTerm(t) || t.pp || t.html) return true;
  if (t.t === 'punct' && (t.v === '{' || t.v === '}')) return true;
  if (E.rules.accessLabels && isAccessLabel(E, j)) return true;
  if (j === E.lastEnd) return true;
  return !!E.rules.asi && !!E.T[j + 1] && t.line < E.T[j + 1].line;
}

/**
 * Walk back from the declaration token `k` over what belongs to it — modifiers,
 * annotations, attributes, `template<…>` and, in `typeMode`, a return type — to
 * the statement boundary before it. Returns the first token's index, or -1 when
 * no boundary is reached (then `k` is not a declaration).
 */
function declStart(E, k, lo, typeMode) {
  const { T, P, rules } = E;
  let j = k - 1;
  let start = k;
  while (j >= lo) {
    const t = T[j];
    if (t.t === 'id') {
      const a = annotationBack(E, j, lo);
      if (a >= 0) { start = a; j = a - 1; continue; }
      if (rules.mods.has(rules.ci ? t.v.toLowerCase() : t.v) || (typeMode && !NOT_TYPE.has(t.v))) { start = j; j--; continue; }
      break;
    }
    if (t.t === 'str') {
      if (j - 1 >= lo && isId(T[j - 1], 'extern')) { start = j - 1; j -= 2; continue; }  // extern "C"
      break;
    }
    if (t.t !== 'punct' || t.pp) break;
    const v = t.v;
    if (v === ')') {
      const o = P[j];
      if (o < lo) break;
      const before = T[o - 1];
      if (o - 1 >= lo && isId(before)) {
        const a = annotationBack(E, o - 1, lo);
        if (a >= 0) { start = a; j = a - 1; continue; }
        if (CALL_MODS.has(before.v)) { start = o - 1; j = o - 2; continue; }  // pub(crate), __attribute__((x))
      }
      if (typeMode) { start = o; j = o - 1; continue; }
      break;
    }
    if (v === ']') {
      const o = P[j];
      if (o < lo) break;
      const before = T[o - 1];
      if (o - 1 >= lo && isP(before, '#')) { start = o - 1; j = o - 2; continue; }  // #[attr]
      if (isP(before, '!')) break;  // #![inner] belongs to the enclosing item
      if (rules.bracketAttrs || typeMode) { start = o; j = o - 1; continue; }
      break;
    }
    if (v === '>') {
      const o = anglesBack(E, j, lo);
      if (o < 0) break;
      if (o - 1 >= lo && isId(T[o - 1], 'template')) { start = o - 1; j = o - 2; continue; }
      if (typeMode) { start = o; j = o - 1; continue; }
      break;
    }
    if (v === ':' && rules.accessLabels && isAccessLabel(E, j)) break;
    if (typeMode && TYPE_PUNCT.has(v)) { start = j; j--; continue; }
    break;
  }
  return isBoundary(E, j, lo) ? start : -1;
}

/** Tokens before the name other than modifiers, annotations and attributes: a return type. */
function hasTypeTokens(E, a, b) {
  const { T, P, rules } = E;
  for (let q = a; q < b; q++) {
    const t = T[q];
    if (isP(t, '@') && isId(T[q + 1])) {
      q++;
      while (q + 2 < b && (isP(T[q + 1], '.') || isP(T[q + 1], ':')) && isId(T[q + 2])) q += 2;
      if (isP(T[q + 1], '(') && P[q + 1] > q) q = P[q + 1];
      continue;
    }
    if (isP(t, '#') && isP(T[q + 1], '[') && P[q + 1] > q) { q = P[q + 1]; continue; }
    if (isP(t, '[') && P[q] > q && rules.bracketAttrs) { q = P[q]; continue; }
    if (isId(t, 'template') && isP(T[q + 1], '<')) {
      const z = anglesFwd(E, q + 1, b);
      if (z > 0) { q = z - 1; continue; }
    }
    if (t.t === 'id' && rules.mods.has(rules.ci ? t.v.toLowerCase() : t.v)) continue;
    return true;
  }
  return false;
}

/**
 * From `k`, the declaration's body: `{ open }` for a `{`, `{ term }` for a
 * terminator (no body), `{ eq }` / `{ arrow }` for an expression body when
 * asked, else `{ stop }` where a closer or `hi` was reached.
 */
function findBody(E, k, hi, opts = {}) {
  const { T, P } = E;
  const res = (o = {}) => ({ open: -1, term: -1, eq: -1, arrow: -1, stop: k, ...o });
  for (; k < hi; k++) {
    const t = T[k];
    if (isTerm(t)) return res({ term: k });
    if (t.t !== 'punct' || t.pp) continue;
    const v = t.v;
    if (v === '{') {
      if (P[k] < 0) return res();
      if (opts.goTypes && (isId(T[k - 1], 'struct') || isId(T[k - 1], 'interface'))) { k = P[k]; continue; }
      return res({ open: k });
    }
    if (v === '(' || v === '[') {
      if (P[k] < 0) return res();
      k = P[k];
      continue;
    }
    if (v === ')' || v === ']' || v === '}') return res();
    if (v === '=') {
      const nx = T[k + 1];
      const pv = T[k - 1];
      if (adjacent(t, nx) && nx.v === '>') {
        if (opts.arrow) return res({ arrow: k });
        k++;
        continue;
      }
      if ((adjacent(t, nx) && nx.v === '=') || (adjacent(pv, t) && pv.t === 'punct' && '=!<>+-*/%&|^'.includes(pv.v))) continue;
      if (opts.eq) return res({ eq: k });
      continue;
    }
    if (v === ':' && opts.initList && !(adjacent(t, T[k + 1]) && T[k + 1].v === ':') && !(adjacent(T[k - 1], t) && T[k - 1].v === ':')) {
      // a C++ constructor's member initializers: name(args) or name{args}, comma separated
      let q = k + 1;
      for (;;) {
        while (q < hi && (T[q].t === 'id' || isP(T[q], ':') || isP(T[q], '.'))) q++;
        if (isP(T[q], '<')) {
          q = anglesFwd(E, q, hi);
          if (q < 0) return res();
        }
        if ((isP(T[q], '(') || isP(T[q], '{')) && P[q] > q) q = P[q] + 1;
        else return res();
        if (isP(T[q], '.') && isP(T[q + 1], '.') && isP(T[q + 2], '.')) q += 3;
        if (isP(T[q], ',')) { q++; continue; }
        break;
      }
      k = q - 1;
    }
  }
  return res({ stop: Math.min(k, hi) });
}

/**
 * Record a function-like declaration and walk its body. `d.body` is a
 * `findBody` result; an expression body (`= expr`, `=> expr;`) ends at its
 * statement end, and a declaration without a body at its terminator.
 */
function finishFn(E, ctx, d) {
  const { T, P } = E;
  const b = d.body;
  if (b.open >= 0) {
    const close = P[b.open];
    const idx = addSym(E, ctx, { ...d, end: T[close].e, bodyIdx: b.open });
    if (E.rules.nested !== false) walkBlock(E, b.open + 1, close, child(E, ctx, idx, 'code'));
    return { next: close + 1 };
  }
  if (b.eq >= 0 || b.arrow >= 0) {
    const at = b.eq >= 0 ? b.eq : b.arrow;
    const r = exprEnd(E, at + (b.eq >= 0 ? 1 : 2), d.hi);
    addSym(E, ctx, { ...d, end: T[Math.max(r.last, at)].e, bodyIdx: at });
    return { next: r.next };
  }
  const last = b.term >= 0 ? b.term : Math.max(b.stop - 1, d.nameIdx);
  addSym(E, ctx, { ...d, end: T[last].e, bodyIdx: -1 });
  return { next: b.term >= 0 ? b.term + 1 : Math.max(b.stop, d.nameIdx + 1) };
}

/** A type-like declaration (`class`, `struct`, `interface`, …) whose name is at `o.nameIdx`. */
function typeDecl(E, i, hi, ctx, o) {
  const { T, P } = E;
  if (!isId(T[o.nameIdx])) return null;
  const start = declStart(E, o.kwIdx ?? i, ctx.lo, false);
  if (start < 0) return null;
  const name = o.name ?? unBacktick(T[o.nameIdx].v);
  const b = findBody(E, o.from ?? o.nameIdx + 1, hi);
  if (b.open >= 0) {
    const close = P[b.open];
    const idx = addSym(E, ctx, { name, kind: o.kind, start, nameIdx: o.nameIdx, end: T[close].e, bodyIdx: b.open, sig: o.sig });
    if (o.walk !== false) walkBlock(E, b.open + 1, close, child(E, ctx, idx, o.bodyMode ?? 'member'));
    return { next: close + 1 };
  }
  const last = b.term >= 0 ? b.term : b.stop - 1;
  if (last < o.nameIdx) return null;
  addSym(E, ctx, { name, kind: o.kind, start, nameIdx: o.nameIdx, end: T[last].e, bodyIdx: -1, sig: o.sig });
  return { next: b.term >= 0 ? b.term + 1 : b.stop };
}

/** `kw name … ;`: a declaration that runs to its statement end (type aliases, typealias). */
function simpleDecl(E, kwIdx, nameIdx, hi, ctx, kind) {
  const { T } = E;
  const start = declStart(E, kwIdx, ctx.lo, false);
  if (start < 0) return null;
  const r = stmtEnd(E, nameIdx + 1, hi);
  addSym(E, ctx, { name: unBacktick(T[nameIdx].v), kind, start, nameIdx, end: T[Math.max(r.last, nameIdx)].e, bodyIdx: -1 });
  return { next: r.next };
}

/**
 * `namespace A.B { … }` (a module symbol), `namespace A.B;` (C# file-scoped,
 * PHP statement form: no symbol, it qualifies what follows up to the next
 * one), or an anonymous `namespace { … }` (transparent).
 */
function nsDecl(E, i, hi, ctx, ci = false) {
  const { T, P } = E;
  let k = i + 1;
  const parts = [];
  while (k < hi && (T[k].t === 'id' || isP(T[k], '.') || isP(T[k], ':') || isP(T[k], '\\'))) {
    if (T[k].t === 'id') parts.push(T[k].v);
    k++;
  }
  const name = parts.join('.');
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  if (isP(T[k], '{') && P[k] > k) {
    const close = P[k];
    if (!name) {
      walkBlock(E, k + 1, close, ctx);
      return { next: close + 1 };
    }
    const idx = addSym(E, ctx, { name, kind: 'module', start, nameIdx: i + 1, end: T[close].e, bodyIdx: k });
    walkBlock(E, k + 1, close, child(E, ctx, idx, 'top'));
    return { next: close + 1 };
  }
  if (!isTerm(T[k]) || !name) return null;
  let end = hi;
  for (let q = k + 1; q < hi; q++) {
    if (isOpen(T[q]) && P[q] > q) { q = P[q]; continue; }
    if (isId(T[q]) && (ci ? T[q].v.toLowerCase() : T[q].v) === 'namespace' && !isP(T[q + 1], '(')) { end = q; break; }
  }
  walkBlock(E, k + 1, end, { ...ctx, path: [...ctx.path, name] });
  return { next: end };
}

// ── Signatures ───────────────────────────────────────────────────────────────

/** Depth-0 comma-separated ranges of `[a, b)`; generic `<…>` lists are not split unless `angles` is false. */
function splitParams(E, a, b, angles = true) {
  const { T, P } = E;
  const out = [];
  let s = a;
  let depth = 0;
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (t.t === 'semi') continue;
    if (isOpen(t) && P[k] > k && P[k] < b) { k = P[k]; continue; }
    if (!angles || t.t !== 'punct') {
      if (isP(t, ',') && depth === 0) { out.push([s, k]); s = k + 1; }
      continue;
    }
    if (t.v === '<') depth++;
    else if (t.v === '>' && depth > 0 && !(adjacent(T[k - 1], t) && (T[k - 1].v === '-' || T[k - 1].v === '='))) depth--;
    else if (t.v === ',' && depth === 0) { out.push([s, k]); s = k + 1; }
  }
  if (b > s) out.push([s, b]);
  return out;
}

/** First depth-0 `:` in `[a, b)` that is not half of `::`. */
function topColon(E, a, b) {
  const { T, P } = E;
  for (let k = a; k < b; k++) {
    if (isOpen(T[k]) && P[k] > k) { k = P[k]; continue; }
    if (isP(T[k], ':') && !(adjacent(T[k], T[k + 1]) && T[k + 1].v === ':') && !(adjacent(T[k - 1], T[k]) && T[k - 1].v === ':')) return k;
  }
  return -1;
}

const C_TYPE_WORDS = new Set(['int', 'char', 'long', 'short', 'double', 'float', 'unsigned', 'signed', 'bool', 'void', 'size_t', 'auto']);

/** The type text of one parameter `[a, b)`, by the language's parameter style. */
function paramType(E, a, b, style) {
  const { T, P } = E;
  for (let k = a; k < b; k++) {  // a default value is not part of the type
    if (isOpen(T[k]) && P[k] > k) { k = P[k]; continue; }
    if (isP(T[k], '=') && !(adjacent(T[k], T[k + 1]) && (T[k + 1].v === '=' || T[k + 1].v === '>'))
      && !(adjacent(T[k - 1], T[k]) && T[k - 1].t === 'punct' && '=!<>'.includes(T[k - 1].v))) { b = k; break; }
  }
  while (a < b) {  // annotations and attributes on the parameter
    if (isP(T[a], '@') && isId(T[a + 1])) {
      a += 2;
      while (a + 1 < b && (isP(T[a], '.') || isP(T[a], ':')) && isId(T[a + 1])) a += 2;
      if (isP(T[a], '(') && P[a] > a) a = P[a] + 1;
      continue;
    }
    if (isP(T[a], '#') && isP(T[a + 1], '[') && P[a + 1] > a) { a = P[a + 1] + 1; continue; }
    if (E.lang === 'csharp' && isP(T[a], '[') && P[a] > a) { a = P[a] + 1; continue; }
    break;
  }
  if (a >= b) return '';
  switch (style) {
    case 'colon':
    case 'python':
    case 'swift': {
      const c = topColon(E, a, b);
      if (c < 0) return joinTokens(T, a, b);
      const type = joinTokens(T, c + 1, b);
      return style === 'swift' ? `${unBacktick(T[a].v)}:${type}` : type;
    }
    case 'go':
      return b - a >= 2 && isId(T[a]) && !isP(T[a + 1], '.') ? joinTokens(T, a + 1, b) : joinTokens(T, a, b);
    case 'php': {
      let out = '';
      for (let k = a; k < b; k++) {
        if (T[k].t === 'id' && T[k].v[0] === '$') continue;
        out += joinTokens(T, k, k + 1).replace(/^(?=\w)/, out && /\w$/.test(out) ? ' ' : '');
      }
      return out || 'mixed';
    }
    case 'typeFirst': {
      const lastTok = T[b - 1];
      if (isP(lastTok, ']') && P[b - 1] - 1 > a && isId(T[P[b - 1] - 1])) {  // int a[] → int[]
        return joinTokens(T, a, P[b - 1] - 1) + joinTokens(T, P[b - 1], b);
      }
      if (b - a >= 2 && isId(lastTok) && !C_TYPE_WORDS.has(lastTok.v)) return joinTokens(T, a, b - 1);
      return joinTokens(T, a, b);
    }
    default:
      return joinTokens(T, a, b);
  }
}

/** Parameter types of the `(` at `open`, comma-joined without the parentheses. */
function paramSig(E, open, style) {
  const close = E.P[open];
  if (close < 0) return null;
  return splitParams(E, open + 1, close, style !== 'python' && style !== 'ruby')
    .map(([a, b]) => paramType(E, a, b, style))
    .join(', ');
}

// ── Languages: Rust ──────────────────────────────────────────────────────────

const RUST_MODS = new Set(['pub', 'async', 'const', 'unsafe', 'default', 'extern', 'safe']);
const RUST_KINDS = { struct: 'struct', enum: 'enum', union: 'struct', trait: 'trait', mod: 'module', type: 'type' };

/** The base name of a type in `[a, b)`: `&mut dyn a::B<T>` → B. */
function typeBaseName(T, a, b) {
  let k = a;
  while (k < b && (isP(T[k], '&') || isP(T[k], '*') || (isId(T[k]) && ['mut', 'dyn', 'impl', 'const'].includes(T[k].v)) || (T[k].t === 'id' && T[k].v[0] === "'"))) k++;
  let name = null;
  let idx = -1;
  for (; k < b; k++) {
    if (isId(T[k])) { name = rawName(T[k].v); idx = k; continue; }
    if (isP(T[k], ':') || isP(T[k], '.')) continue;
    break;
  }
  return name ? { name, idx } : null;
}

function rustFn(E, i, hi, ctx) {
  const { T, P } = E;
  const nameIdx = i + 1;
  if (!isId(T[nameIdx])) return null;
  let k = nameIdx + 1;
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  if (!isP(T[k], '(') || P[k] < 0) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const trait = ctx.container && ctx.container.trait;
  return finishFn(E, ctx, {
    name: rawName(T[nameIdx].v), nameIdx, start, hi,
    kind: ctx.mode === 'member' ? 'method' : 'function',
    sig: trait || paramSig(E, k, 'colon'),
    body: findBody(E, P[k] + 1, hi),
  });
}

function rustImpl(E, i, hi, ctx) {
  const { T, P } = E;
  let k = i + 1;
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  const b = findBody(E, k, hi);
  if (b.open < 0) return null;
  let head = b.open;
  for (let q = k; q < b.open; q++) {
    if (isOpen(T[q]) && P[q] > q) { q = P[q]; continue; }
    if (isId(T[q], 'where')) { head = q; break; }
  }
  let forIdx = -1;
  for (let q = k; q < head; q++) {
    if (isOpen(T[q]) && P[q] > q) { q = P[q]; continue; }
    if (isP(T[q], '<')) {
      const z = anglesFwd(E, q, head + 1);
      if (z > 0) { q = z - 1; continue; }
    }
    if (isId(T[q], 'for') && !isP(T[q + 1], '<')) { forIdx = q; break; }
  }
  const trait = forIdx >= 0 ? joinTokens(T, k, forIdx) : null;
  const target = typeBaseName(T, forIdx >= 0 ? forIdx + 1 : k, head);
  if (!target) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const close = P[b.open];
  const idx = addSym(E, ctx, { name: target.name, kind: 'impl', start, nameIdx: target.idx, end: T[close].e, bodyIdx: b.open, sig: trait });
  walkBlock(E, b.open + 1, close, child(E, ctx, idx, 'member', { name: target.name, kind: 'impl', trait }));
  return { next: close + 1 };
}

function rustItem(E, i, hi, ctx, kw) {
  const { T, P } = E;
  const nameIdx = i + 1;
  if (!isId(T[nameIdx])) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const name = rawName(T[nameIdx].v);
  const kind = RUST_KINDS[kw];
  let k = nameIdx + 1;
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  if (kw === 'type') {
    const r = stmtEnd(E, k, hi);
    addSym(E, ctx, { name, kind, start, nameIdx, end: T[Math.max(r.last, nameIdx)].e, bodyIdx: -1 });
    return { next: r.next };
  }
  const b = findBody(E, k, hi);
  if (b.open >= 0) {
    const close = P[b.open];
    const idx = addSym(E, ctx, { name, kind, start, nameIdx, end: T[close].e, bodyIdx: b.open });
    if (kw === 'trait' || kw === 'mod') walkBlock(E, b.open + 1, close, child(E, ctx, idx, kw === 'mod' ? 'top' : 'member'));
    return { next: close + 1 };
  }
  const last = b.term >= 0 ? b.term : Math.max(b.stop - 1, nameIdx);
  addSym(E, ctx, { name, kind, start, nameIdx, end: T[last].e, bodyIdx: -1 });
  return { next: b.term >= 0 ? b.term + 1 : Math.max(b.stop, nameIdx + 1) };
}

function rustConst(E, i, hi, ctx) {
  const { T } = E;
  let k = i + 1;
  if (T[i].v === 'const' && isId(T[k]) && ['fn', 'unsafe', 'async', 'extern'].includes(T[k].v)) return null;  // const fn
  if (T[i].v === 'static' && isId(T[k], 'mut')) k++;
  if (!isId(T[k]) || !isP(T[k + 1], ':') || isP(T[k + 2], ':')) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const r = stmtEnd(E, k, hi);
  addSym(E, ctx, { name: rawName(T[k].v), kind: 'variable', start, nameIdx: k, end: T[Math.max(r.last, k)].e, bodyIdx: -1 });
  return { next: r.next };
}

function rustMacroRules(E, i, hi, ctx) {
  const { T, P } = E;
  if (!isP(T[i + 1], '!') || !isId(T[i + 2])) return null;
  const g = i + 3;
  if (!isOpen(T[g]) || P[g] < 0) return null;
  let last = P[g];
  if (T[g].v !== '{' && isTerm(T[last + 1])) last++;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  addSym(E, ctx, { name: `${T[i + 2].v}!`, kind: 'function', start, nameIdx: i + 2, end: T[last].e, bodyIdx: g });
  return { next: last + 1 };
}

function rustDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t !== 'id') return null;
  const nx = T[i + 1];
  switch (t.v) {
    case 'fn': return rustFn(E, i, hi, ctx);
    case 'impl': return rustImpl(E, i, hi, ctx);
    case 'struct': case 'enum': case 'trait': case 'mod': case 'type': return rustItem(E, i, hi, ctx, t.v);
    case 'union': return isId(nx) && (isP(T[i + 2], '{') || isP(T[i + 2], '<')) ? rustItem(E, i, hi, ctx, 'union') : null;
    case 'static': case 'const': return ctx.mode === 'code' ? null : rustConst(E, i, hi, ctx);
    case 'macro_rules': return rustMacroRules(E, i, hi, ctx);
    case 'extern': {
      let k = i + 1;
      if (T[k] && T[k].t === 'str') k++;
      if (!isP(T[k], '{') || P[k] < 0) return null;
      walkBlock(E, k + 1, P[k], ctx);  // foreign items keep the enclosing scope
      return { next: P[k] + 1 };
    }
    default: break;
  }
  // A macro invocation `name! {…}` / `name!(…)`: what it expands to is invisible here.
  if (isP(nx, '!') && adjacent(t, nx) && isOpen(T[i + 2]) && P[i + 2] > i + 2) return { next: P[i + 2] + 1 };
  return null;
}

// ── Languages: Go ────────────────────────────────────────────────────────────

function goReceiver(E, a, b) {
  const { T, P } = E;
  let name = null;
  for (let q = a; q < b; q++) {
    if (isP(T[q], '[') && P[q] > q) { q = P[q]; continue; }
    if (isId(T[q])) name = T[q].v;
  }
  return name;
}

/** `[T any]` is a type-parameter list; `[4]int` and `[N]int` are array types. */
function goTypeParams(T, a, b) {
  return b - a >= 3 && isId(T[a + 1]) && !isP(T[a + 2], '.') && !isP(T[a + 2], ']');
}

function goFunc(E, i, hi, ctx) {
  const { T, P } = E;
  let k = i + 1;
  let recv = null;
  if (isP(T[k], '(')) {
    if (P[k] < 0) return null;
    recv = goReceiver(E, k + 1, P[k]);
    k = P[k] + 1;
  }
  if (!isId(T[k])) return null;
  const nameIdx = k++;
  if (isP(T[k], '[')) {
    if (P[k] < 0) return null;
    k = P[k] + 1;
  }
  if (!isP(T[k], '(') || P[k] < 0) return null;
  return finishFn(E, ctx, {
    name: T[nameIdx].v, nameIdx, start: i, hi,
    kind: recv ? 'method' : 'function',
    path: recv ? [...ctx.path, recv] : null,
    sig: paramSig(E, k, 'go'),
    body: findBody(E, P[k] + 1, hi, { goTypes: true }),
  });
}

function goSpec(E, ctx, kw, startIdx, a, last) {
  const { T, P } = E;
  if (!isId(T[a]) || last < a) return;
  let kind = 'variable';
  let bodyIdx = -1;
  if (kw === 'type') {
    let k = a + 1;
    if (isP(T[k], '[') && P[k] > k && goTypeParams(T, k, P[k])) k = P[k] + 1;
    if (isP(T[k], '=')) k++;
    kind = isId(T[k], 'struct') ? 'struct' : isId(T[k], 'interface') ? 'interface' : 'type';
    if (kind !== 'type' && isP(T[k + 1], '{')) bodyIdx = k + 1;
  }
  addSym(E, ctx, { name: T[a].v, kind, start: startIdx, nameIdx: a, end: T[last].e, bodyIdx });
}

function goGeneral(E, i, hi, ctx, kw) {
  const { T, P } = E;
  if (isP(T[i + 1], '(')) {
    const close = P[i + 1];
    if (close < 0) return null;
    let a = i + 2;
    while (a < close) {
      if (isTerm(T[a])) { a++; continue; }
      const r = stmtEnd(E, a, close);
      goSpec(E, ctx, kw, a, a, r.last);
      a = Math.max(r.next, a + 1);
    }
    return { next: close + 1 };
  }
  const r = stmtEnd(E, i + 1, hi);
  goSpec(E, ctx, kw, i, i + 1, r.last);
  return { next: r.next };
}

function goDecl(E, i, hi, ctx) {
  const t = E.T[i];
  if (t.t !== 'id' || ctx.mode !== 'top') return null;
  if (t.v === 'func') return goFunc(E, i, hi, ctx);
  if (t.v === 'type' || t.v === 'var' || t.v === 'const') return goGeneral(E, i, hi, ctx, t.v);
  return null;
}

// ── Languages without a declaration keyword for methods: Java, C#, C, C++ ───

/** The callee-looking name before the `(` at `i`: `f`, `F<T>`, `~Foo`, `operator==`, `A::B::f`. */
function memberName(E, i, lo) {
  const { T } = E;
  let n = i - 1;
  if (n < lo) return null;
  if (isP(T[n], '>')) {
    const o = anglesBack(E, n, lo);
    if (o < 0) return null;
    n = o - 1;
  }
  const t = T[n];
  if (!t || n < lo) return null;
  if (isId(t, 'operator') && isP(T[i + 1], ')') && isP(T[i + 2], '(')) return null;  // `operator()(…)`: the next `(` is the list
  let name;
  let first;
  let op = -1;
  for (let q = n; q >= Math.max(lo, n - 3); q--) if (isId(T[q], 'operator')) { op = q; break; }
  // `operator+=`, `operator()`, `operator""_usd` (a user-defined literal: an empty string, then the suffix)
  if (op >= 0 && (op === n || T.slice(op + 1, n + 1).every(x => x.t === 'punct' || x.t === 'id' || (x.t === 'str' && x.v === '""')))) {
    const literal = T[op + 1]?.t === 'str' && T[op + 1].v === '""';
    const rest = literal ? `""${T.slice(op + 2, n + 1).map(x => x.v).join('')}` : joinTokens(T, op + 1, n + 1);
    name = `operator${/^\w/.test(rest) ? ' ' : ''}${rest}`;
    first = op;
  } else if (t.t === 'id') {
    if (CONTROL.has(t.v)) return null;
    name = t.v;
    first = n;
    if (n - 1 >= lo && isP(T[n - 1], '~') && adjacent(T[n - 1], t)) { name = `~${name}`; first = n - 1; }
  } else return null;
  const qualifiers = [];
  while (first - 3 >= lo && isP(T[first - 1], ':') && isP(T[first - 2], ':') && adjacent(T[first - 2], T[first - 1])) {
    let q = first - 3;
    if (isP(T[q], '>')) {
      const o = anglesBack(E, q, lo);
      if (o < 0) break;
      q = o - 1;
    }
    if (q < lo || !isId(T[q])) break;
    qualifiers.unshift(T[q].v);
    first = q;
  }
  const before = T[first - 1];
  if (first - 1 >= lo && (isP(before, '.') || isP(before, '@') || isP(before, '#') || (isP(before, '>') && isP(T[first - 2], '-')))) return null;
  return { name, nameIdx: n, first, qualifiers };
}

/** Between a parameter list and its body only qualifiers may appear: throws, const, noexcept, where, -> T, = 0. */
function afterParamsOk(E, a, b) {
  const { T, P, lang } = E;
  for (let k = a; k < b; k++) {
    const t = T[k];
    if (t.t === 'semi') continue;
    if (t.t === 'id') {
      // An annotation element's default value (`String name() default "x";`) ends the qualifiers.
      if (lang === 'java' && t.v === 'default') return true;
      // `Foo(const Foo &) = delete;`, `~Foo() = default;`
      if ((lang === 'c' || lang === 'cpp') && (t.v === 'delete' || t.v === 'default') && isP(T[k - 1], '=')) continue;
      if (AFTER_PARAMS_BAD.has(t.v)) return false;
      continue;
    }
    if (t.t === 'num') {
      if (!isP(T[k - 1], '=')) return false;
      continue;
    }
    if (t.t !== 'punct' || t.pp) return false;
    if (isOpen(t)) {
      if (P[k] < 0) return false;
      k = P[k];
      continue;
    }
    if (t.v === '=') {
      if (lang !== 'c' && lang !== 'cpp') return false;
      continue;
    }
    if (!AFTER_PARAMS_PUNCT.has(t.v)) return false;
  }
  return true;
}

function memberFn(E, i, hi, ctx) {
  const { P, lang } = E;
  const close = P[i];
  if (close < 0 || close >= hi) return null;
  const nm = memberName(E, i, ctx.lo);
  if (!nm) return null;
  const body = findBody(E, close + 1, hi, { arrow: lang === 'csharp', initList: lang === 'c' || lang === 'cpp' });
  const until = body.open >= 0 ? body.open : body.arrow >= 0 ? body.arrow : body.term;
  if (until < 0 || !afterParamsOk(E, close + 1, until)) return null;
  const start = declStart(E, nm.first, ctx.lo, true);
  if (start < 0) return null;
  const owner = nm.qualifiers.length ? nm.qualifiers[nm.qualifiers.length - 1] : ctx.container && ctx.container.name;
  const isCtor = !!owner && (nm.name === owner || nm.name === `~${owner}`);
  if (!isCtor && !nm.name.startsWith('operator') && !hasTypeTokens(E, start, nm.first)) return null;
  return finishFn(E, ctx, {
    name: nm.name, nameIdx: nm.nameIdx, start, hi, body,
    kind: ctx.mode === 'member' || nm.qualifiers.length ? 'method' : 'function',
    path: nm.qualifiers.length ? [...ctx.path, ...nm.qualifiers] : null,
    sig: paramSig(E, i, 'typeFirst'),
  });
}

const JAVA_MODS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'native', 'synchronized', 'transient', 'volatile', 'strictfp', 'default', 'sealed']);

function javaDecl(E, i, hi, ctx) {
  const { T } = E;
  const t = T[i];
  if (t.t === 'id') {
    if (isP(T[i - 1], '.')) return null;
    const v = t.v;
    const record = v === 'record' && isId(T[i + 1]) && (isP(T[i + 2], '(') || isP(T[i + 2], '<'));
    // A record's compact constructor: `[modifiers] Name { ... }`.
    if (ctx.mode === 'member' && ctx.container?.kind === 'class' && v === ctx.container.name && isP(T[i + 1], '{') && E.P[i + 1] > i + 1) {
      const start = declStart(E, i, ctx.lo, true);
      if (start < 0) return null;
      const close = E.P[i + 1];
      addSym(E, ctx, { name: v, kind: 'method', start, nameIdx: i, end: T[close].e, bodyIdx: i + 1, sig: '' });
      return { next: close + 1 };
    }
    if (v !== 'class' && v !== 'interface' && v !== 'enum' && !record) return null;
    const annotationType = v === 'interface' && isP(T[i - 1], '@') && adjacent(T[i - 1], t);
    return typeDecl(E, i, hi, ctx, { kind: v === 'record' ? 'class' : v, nameIdx: i + 1, kwIdx: annotationType ? i - 1 : i });
  }
  if (isP(t, '(') && ctx.mode !== 'code') return memberFn(E, i, hi, ctx);
  return null;
}

const CS_MODS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'virtual', 'override', 'abstract', 'sealed', 'async', 'extern', 'unsafe', 'new', 'partial', 'const', 'volatile', 'required', 'file', 'implicit', 'explicit', 'fixed', 'ref', 'scoped']);

function csAccessorBlock(E, open) {
  const { T, P } = E;
  let q = open + 1;
  while (q < P[open]) {
    if (isP(T[q], '[') && P[q] > q) { q = P[q] + 1; continue; }
    if (isId(T[q]) && CS_MODS.has(T[q].v)) { q++; continue; }
    break;
  }
  return isId(T[q]) && /^(?:get|set|init|add|remove)$/.test(T[q].v);
}

/** `Type Name { get; set; } [= init;]` or `Type Name => expr;` */
function csProperty(E, i, hi, ctx) {
  const { T, P } = E;
  const nx = T[i + 1];
  let bodyIdx;
  let last;
  if (isP(nx, '{') && P[i + 1] > i + 1 && csAccessorBlock(E, i + 1)) {
    bodyIdx = i + 1;
    last = P[i + 1];
    if (isP(T[last + 1], '=')) last = stmtEnd(E, last + 1, hi).last;
  } else if (isP(nx, '=') && isP(T[i + 2], '>') && adjacent(nx, T[i + 2])) {
    bodyIdx = i + 1;
    last = exprEnd(E, i + 3, hi).last;
  } else return null;
  const start = declStart(E, i, ctx.lo, true);
  if (start < 0 || !hasTypeTokens(E, start, i)) return null;
  addSym(E, ctx, { name: T[i].v, kind: 'variable', start, nameIdx: i, end: T[Math.max(last, i)].e, bodyIdx });
  return { next: Math.max(last, i) + 1 };
}

function csDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t === 'id') {
    const p = T[i - 1];
    if (isP(p, '.') || (isP(p, '@') && adjacent(p, t))) return null;
    switch (t.v) {
      case 'namespace': return nsDecl(E, i, hi, ctx);
      case 'class': case 'struct': case 'interface': case 'enum': case 'record': {
        if (isP(p, ':') || isP(p, ',') || isId(p, 'record')) return null;  // `where T : class`, `record struct`
        let nameIdx = i + 1;
        if (t.v === 'record' && (isId(T[nameIdx], 'struct') || isId(T[nameIdx], 'class'))) nameIdx++;
        const kind = t.v === 'record' ? (isId(T[i + 1], 'struct') ? 'struct' : 'class') : t.v;
        return typeDecl(E, i, hi, ctx, { kind, nameIdx });
      }
      case 'delegate': {
        if (ctx.mode === 'code') return null;
        let q = i + 1;
        while (q < hi && !isP(T[q], '(') && !isTerm(T[q])) {
          if (isP(T[q], '<')) { const z = anglesFwd(E, q, hi); if (z < 0) return null; q = z; continue; }
          q++;
        }
        if (!isP(T[q], '(') || P[q] < 0) return null;
        let nameIdx = q - 1;
        if (isP(T[nameIdx], '>')) nameIdx = anglesBack(E, nameIdx, i) - 1;
        if (nameIdx <= i || !isId(T[nameIdx])) return null;
        const start = declStart(E, i, ctx.lo, false);
        if (start < 0) return null;
        const r = stmtEnd(E, q, hi);
        addSym(E, ctx, { name: T[nameIdx].v, kind: 'type', start, nameIdx, end: T[Math.max(r.last, q)].e, bodyIdx: -1, sig: paramSig(E, q, 'typeFirst') });
        return { next: r.next };
      }
      default: break;
    }
    return ctx.mode === 'member' ? csProperty(E, i, hi, ctx) : null;
  }
  if (isP(t, '(') && ctx.mode !== 'code') return memberFn(E, i, hi, ctx);
  return null;
}

const C_MODS = new Set(['static', 'inline', 'extern', 'const', 'volatile', 'register', 'virtual', 'explicit', 'constexpr', 'consteval', 'constinit', 'friend', 'mutable', 'thread_local', 'typename', '_Noreturn', '__inline', '__forceinline', 'noexcept']);
const C_NOT_DECL = new Set(['return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'goto', 'break', 'continue', 'template', 'static_assert', 'using', 'typedef', 'namespace', 'class', 'struct', 'union', 'enum', 'extern', 'public', 'private', 'protected', 'friend', 'operator', 'sizeof', 'delete', 'new', 'throw']);

const C_RECORD_ATTRS = new Set(['alignas', '_Alignas', '__declspec', '__attribute__', '__attribute']);

/** `class|struct|union|enum [class] [attrs] Name [final] [: bases] { … }` or a forward declaration. */
function cRecord(E, i, hi, ctx) {
  const { T, P } = E;
  let k = i + 1;
  if (T[i].v === 'enum' && (isId(T[k], 'class') || isId(T[k], 'struct'))) k++;
  let nameIdx = -1;
  let ids = 0;
  for (; k < hi; k++) {
    const t = T[k];
    if (isP(t, '[') && P[k] > k) { k = P[k]; continue; }  // [[attr]]
    // alignas(8), __declspec(x): only these take parentheses here; `struct token make_token(` is a function
    if (isId(t) && C_RECORD_ATTRS.has(t.v) && isP(T[k + 1], '(') && P[k + 1] > k) { k = P[k + 1]; continue; }
    if (isId(t)) {
      if (t.v === 'final' && nameIdx >= 0) continue;
      nameIdx = k;
      ids++;
      continue;
    }
    break;
  }
  if (nameIdx < 0) return null;
  const t = T[k];
  const opensBody = isP(t, '{') || (isP(t, ':') && !isP(T[k + 1], ':')) || isP(t, '<');
  if (!opensBody && !(isTerm(t) && ids === 1)) return null;  // `struct stat st;` declares a variable
  const kind = T[i].v === 'enum' ? 'enum' : T[i].v === 'class' ? 'class' : 'struct';
  return typeDecl(E, i, hi, ctx, { kind, nameIdx, from: k });
}

function cTypedef(E, i, hi, ctx) {
  const { T, P } = E;
  const term = termAfter(E, i + 1, hi);
  if (term < 0) return null;
  let lastId = -1;
  let fnPtr = -1;
  let body = -1;
  for (let q = i + 1; q < term; q++) {
    if (isOpen(T[q]) && P[q] > q) {
      if (isP(T[q], '{') && body < 0) body = q;
      if (fnPtr < 0 && isP(T[q], '(') && isP(T[q + 1], '*')) for (let z = q + 1; z < P[q]; z++) if (isId(T[z])) fnPtr = z;
      q = P[q];
      continue;
    }
    if (isId(T[q])) lastId = q;
  }
  const nameIdx = fnPtr >= 0 ? fnPtr : lastId;
  if (nameIdx < 0) return null;
  const tag = T[i + 1].v;
  const kind = tag === 'struct' || tag === 'union' ? 'struct' : tag === 'enum' ? 'enum' : 'type';
  addSym(E, ctx, { name: T[nameIdx].v, kind, start: i, nameIdx, end: T[term].e, bodyIdx: body });
  return { next: term + 1 };
}

/** A global variable at file or namespace scope (best effort): `[mods] type name [= init];`. */
function cGlobal(E, i, hi, ctx) {
  const { T } = E;
  if (C_NOT_DECL.has(T[i].v)) return null;
  let nameIdx = -1;
  let k = i;
  for (; k < hi; k++) {
    const t = T[k];
    if (isTerm(t) || isP(t, '=') || isP(t, ',') || isP(t, '[') || isP(t, '{')) break;
    if (isP(t, '(')) return null;  // a function, or a macro call: handled at the `(`
    if (isP(t, '<')) {
      const z = anglesFwd(E, k, hi);
      if (z < 0) return null;
      k = z - 1;
      continue;
    }
    if (isId(t)) nameIdx = k;
    else if (t.t !== 'punct' || !TYPE_PUNCT.has(t.v)) return null;
  }
  if (nameIdx <= i || k >= hi) return null;
  const term = termAfter(E, k, hi);
  if (term < 0) return null;
  addSym(E, ctx, { name: T[nameIdx].v, kind: 'variable', start: i, nameIdx, end: T[term].e, bodyIdx: -1 });
  return { next: term + 1 };
}

function cDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t === 'id') {
    const p = T[i - 1];
    if (isP(p, '.') || (isP(p, '>') && isP(T[i - 2], '-'))) return null;
    switch (t.v) {
      case 'namespace': return isP(T[i + 2], '=') ? null : nsDecl(E, i, hi, ctx);
      case 'inline': return isId(T[i + 1], 'namespace') && !isP(T[i + 3], '=') ? nsDecl(E, i + 1, hi, ctx) : null;  // inline namespace v2 { … }
      case 'class': case 'struct': case 'union': case 'enum': return cRecord(E, i, hi, ctx);
      case 'extern':
        if (T[i + 1] && T[i + 1].t === 'str' && isP(T[i + 2], '{') && P[i + 2] > i + 2) {
          walkBlock(E, i + 3, P[i + 2], ctx);  // extern "C" { … } keeps the enclosing scope
          return { next: P[i + 2] + 1 };
        }
        return null;
      case 'typedef': return ctx.mode === 'code' ? null : cTypedef(E, i, hi, ctx);
      case 'using': return ctx.mode !== 'code' && isId(T[i + 1]) && isP(T[i + 2], '=') ? simpleDecl(E, i, i + 1, hi, ctx, 'type') : null;
      default: break;
    }
    if (ctx.mode === 'top' && isBoundary(E, i - 1, ctx.lo)) return cGlobal(E, i, hi, ctx);
    return null;
  }
  if (isP(t, '(') && ctx.mode !== 'code') return memberFn(E, i, hi, ctx);
  return null;
}

// ── Languages: PHP ───────────────────────────────────────────────────────────

const PHP_MODS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'readonly', 'var']);

function phpDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t !== 'id') return null;
  const p = T[i - 1];
  if (isP(p, '>') || isP(p, '\\') || (isP(p, ':') && isP(T[i - 2], ':'))) return null;  // ->class, ::class, \namespace
  const v = t.v.toLowerCase();
  switch (v) {
    case 'namespace': return isP(T[i + 1], '(') ? null : nsDecl(E, i, hi, ctx, true);
    case 'class': case 'interface': case 'trait': case 'enum':
      if (!isId(T[i + 1]) || /^(?:extends|implements)$/i.test(T[i + 1].v)) return null;  // an anonymous class
      return typeDecl(E, i, hi, ctx, { kind: v, nameIdx: i + 1 });
    case 'function': {
      let k = i + 1;
      if (isP(T[k], '&')) k++;
      if (!isId(T[k]) || !isP(T[k + 1], '(') || P[k + 1] < 0) return null;  // a closure
      const start = declStart(E, i, ctx.lo, false);
      if (start < 0) return null;
      return finishFn(E, ctx, {
        name: T[k].v, nameIdx: k, start, hi,
        kind: ctx.mode === 'member' ? 'method' : 'function',
        sig: paramSig(E, k + 1, 'php'),
        body: findBody(E, P[k + 1] + 1, hi),
      });
    }
    case 'const': {
      if (ctx.mode === 'code') return null;
      const term = termAfter(E, i + 1, hi);
      if (term < 0) return null;
      let nameIdx = -1;
      for (let q = i + 1; q < term && !isP(T[q], '='); q++) if (isId(T[q])) nameIdx = q;
      if (nameIdx < 0) return null;
      const start = declStart(E, i, ctx.lo, false);
      if (start < 0) return null;
      addSym(E, ctx, { name: T[nameIdx].v, kind: 'variable', start, nameIdx, end: T[term].e, bodyIdx: -1 });
      return { next: term + 1 };
    }
    default: return null;
  }
}

// ── Languages: Kotlin ────────────────────────────────────────────────────────

const KT_MODS = new Set(['public', 'private', 'protected', 'internal', 'open', 'final', 'abstract', 'sealed', 'override', 'data', 'inner', 'enum', 'annotation', 'companion', 'lateinit', 'const', 'suspend', 'inline', 'noinline', 'crossinline', 'tailrec', 'operator', 'infix', 'external', 'expect', 'actual', 'value', 'fun']);

function ktFun(E, i, hi, ctx) {
  const { T, P } = E;
  let k = i + 1;
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  // [Receiver.]name( — the name is the identifier right before the parameter list
  let nameIdx = -1;
  for (let q = k; q < hi; q++) {
    const t = T[q];
    if (isP(t, '(')) {
      if (q > k && isId(T[q - 1])) { nameIdx = q - 1; break; }
      if (P[q] < 0) return null;
      q = P[q];
      continue;
    }
    if (isP(t, '<')) {
      const z = anglesFwd(E, q, hi);
      if (z < 0) return null;
      q = z - 1;
      continue;
    }
    if (isTerm(t) || isP(t, '{') || isP(t, '=') || isClose(t)) return null;
  }
  if (nameIdx < 0) return null;
  const recv = nameIdx > k + 1 ? typeBaseName(T, k, nameIdx - 1) : null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const open = nameIdx + 1;
  return finishFn(E, ctx, {
    name: unBacktick(T[nameIdx].v), nameIdx, start, hi,
    kind: ctx.mode === 'member' ? 'method' : 'function',
    path: recv ? [...ctx.path, recv.name] : null,
    sig: paramSig(E, open, 'colon'),
    body: findBody(E, P[open] + 1, hi, { eq: true }),
  });
}

function ktProperty(E, i, hi, ctx) {
  const { T } = E;
  let k = i + 1;
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  if (isP(T[k], '(')) return null;  // destructuring
  let nameIdx = -1;
  for (let q = k; q < hi; q++) {
    const t = T[q];
    if (isId(t) && t.v !== 'by') { nameIdx = q; continue; }
    if (isP(t, '.') || isP(t, '?')) continue;
    if (isP(t, '<')) {
      const z = anglesFwd(E, q, hi);
      if (z < 0) return null;
      q = z - 1;
      continue;
    }
    break;
  }
  if (nameIdx < 0) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  const r = stmtEnd(E, nameIdx + 1, hi);
  addSym(E, ctx, { name: unBacktick(T[nameIdx].v), kind: 'variable', start, nameIdx, end: T[Math.max(r.last, nameIdx)].e, bodyIdx: -1 });
  return { next: r.next };
}

function ktDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t !== 'id') return null;
  const p = T[i - 1];
  if (isP(p, '.') || (isP(p, ':') && isP(T[i - 2], ':') && adjacent(T[i - 2], p))) return null;
  switch (t.v) {
    case 'fun': return isId(T[i + 1], 'interface') ? null : ktFun(E, i, hi, ctx);
    case 'class': case 'interface': {
      const kind = t.v === 'interface' ? 'interface' : isId(p, 'enum') ? 'enum' : 'class';
      return typeDecl(E, i, hi, ctx, { kind, nameIdx: i + 1 });
    }
    case 'object':
      if (isId(T[i + 1])) return typeDecl(E, i, hi, ctx, { kind: 'class', nameIdx: i + 1 });
      if (isId(p, 'companion')) return typeDecl(E, i, hi, ctx, { kind: 'class', nameIdx: i, name: 'Companion' });
      return null;
    case 'typealias': return isId(T[i + 1]) ? simpleDecl(E, i, i + 1, hi, ctx, 'type') : null;
    case 'val': case 'var': return ctx.mode === 'code' ? null : ktProperty(E, i, hi, ctx);
    case 'constructor': {
      if (ctx.mode !== 'member' || !isP(T[i + 1], '(') || P[i + 1] < 0) return null;
      const start = declStart(E, i, ctx.lo, false);
      if (start < 0) return null;
      return finishFn(E, ctx, { name: 'constructor', nameIdx: i, start, hi, kind: 'method', sig: paramSig(E, i + 1, 'colon'), body: findBody(E, P[i + 1] + 1, hi) });
    }
    default: return null;
  }
}

// ── Languages: Swift ─────────────────────────────────────────────────────────

const SWIFT_MODS = new Set(['public', 'private', 'fileprivate', 'internal', 'open', 'package', 'final', 'static', 'class', 'override', 'mutating', 'nonmutating', 'dynamic', 'lazy', 'weak', 'unowned', 'optional', 'required', 'convenience', 'indirect', 'prefix', 'postfix', 'infix', 'nonisolated', 'isolated', 'distributed', 'consuming', 'borrowing']);
const SWIFT_CLASS_MOD_NEXT = new Set(['func', 'var', 'let', 'subscript', 'override', 'final', 'static', 'private', 'public', 'internal', 'fileprivate', 'open', 'required', 'convenience', 'init']);

function swiftFunc(E, i, hi, ctx) {
  const { T, P } = E;
  let k = i + 1;
  const nameIdx = k;
  let name = '';
  if (isId(T[k])) {
    name = unBacktick(T[k].v);
    k++;
  } else {
    // an operator function: `func == (…)`, `func <*>(…)`
    while (T[k] && T[k].t === 'punct' && !T[k].pp && !isOpen(T[k]) && (name === '' || adjacent(T[k - 1], T[k]))) { name += T[k].v; k++; }
    if (!name) return null;
  }
  if (isP(T[k], '<')) {
    k = anglesFwd(E, k, hi);
    if (k < 0) return null;
  }
  if (!isP(T[k], '(') || P[k] < 0) return null;
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  return finishFn(E, ctx, {
    name, nameIdx, start, hi,
    kind: ctx.mode === 'member' ? 'method' : 'function',
    sig: paramSig(E, k, 'swift'),
    body: findBody(E, P[k] + 1, hi),
  });
}

function swiftVar(E, i, hi, ctx) {
  const { T, P } = E;
  const nameIdx = i + 1;
  if (!isId(T[nameIdx])) return null;  // `let (a, b) = …`
  const start = declStart(E, i, ctx.lo, false);
  if (start < 0) return null;
  // a computed property or observers: `{` before any `=`
  let last = -1;
  let bodyIdx = -1;
  for (let k = nameIdx + 1; k < hi; k++) {
    const t = T[k];
    if (isTerm(t) || isP(t, '=') || isP(t, ',') || isClose(t)) break;
    if (isP(t, '{')) {
      if (P[k] < 0) return null;
      bodyIdx = k;
      last = P[k];
      break;
    }
    if ((isP(t, '(') || isP(t, '[')) && P[k] > k) { k = P[k]; continue; }
    if (isP(t, '<')) {
      const z = anglesFwd(E, k, hi);
      if (z > 0) k = z - 1;
    }
  }
  if (last < 0) last = Math.max(stmtEnd(E, nameIdx + 1, hi).last, nameIdx);
  addSym(E, ctx, { name: unBacktick(T[nameIdx].v), kind: 'variable', start, nameIdx, end: T[last].e, bodyIdx });
  return { next: last + 1 };
}

function swiftDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t !== 'id') return null;
  if (isP(T[i - 1], '.')) return null;
  switch (t.v) {
    case 'func': return swiftFunc(E, i, hi, ctx);
    case 'init': case 'subscript': {
      if (ctx.mode !== 'member') return null;
      let k = i + 1;
      if ((isP(T[k], '?') || isP(T[k], '!')) && adjacent(t, T[k])) k++;
      if (isP(T[k], '<')) {
        k = anglesFwd(E, k, hi);
        if (k < 0) return null;
      }
      if (!isP(T[k], '(') || P[k] < 0) return null;
      const start = declStart(E, i, ctx.lo, false);
      if (start < 0) return null;
      return finishFn(E, ctx, { name: t.v, nameIdx: i, start, hi, kind: 'method', sig: paramSig(E, k, 'swift'), body: findBody(E, P[k] + 1, hi) });
    }
    case 'deinit': {
      if (ctx.mode !== 'member' || !isP(T[i + 1], '{') || P[i + 1] < 0) return null;
      const start = declStart(E, i, ctx.lo, false);
      if (start < 0) return null;
      return finishFn(E, ctx, { name: 'deinit', nameIdx: i, start, hi, kind: 'method', sig: '', body: findBody(E, i + 1, hi) });
    }
    case 'class':
      if (T[i + 1] && SWIFT_CLASS_MOD_NEXT.has(T[i + 1].v)) return null;  // `class func`: a modifier
      return typeDecl(E, i, hi, ctx, { kind: 'class', nameIdx: i + 1 });
    case 'struct': return typeDecl(E, i, hi, ctx, { kind: 'struct', nameIdx: i + 1 });
    case 'enum': return typeDecl(E, i, hi, ctx, { kind: 'enum', nameIdx: i + 1 });
    case 'protocol': return typeDecl(E, i, hi, ctx, { kind: 'interface', nameIdx: i + 1 });
    case 'actor':
      return isId(T[i + 1]) && (isP(T[i + 2], '{') || isP(T[i + 2], ':') || isP(T[i + 2], '<')) ? typeDecl(E, i, hi, ctx, { kind: 'class', nameIdx: i + 1 }) : null;
    case 'extension': {
      const parts = [];
      let k = i + 1;
      while (isId(T[k])) {
        parts.push(T[k].v);
        if (isP(T[k + 1], '.') && isId(T[k + 2])) k += 2;
        else break;
      }
      if (!parts.length) return null;
      return typeDecl(E, i, hi, ctx, { kind: 'impl', nameIdx: i + 1, name: parts.join('.') });
    }
    case 'typealias': return isId(T[i + 1]) ? simpleDecl(E, i, i + 1, hi, ctx, 'type') : null;
    case 'let': case 'var': return ctx.mode === 'code' ? null : swiftVar(E, i, hi, ctx);
    default: return null;
  }
}

// ── Languages: JS / TS (best-effort fallback; Babel is the exact tier) ───────

const JS_MODS = new Set(['export', 'default', 'async', 'declare', 'abstract', 'public', 'private', 'protected', 'static', 'readonly', 'override', 'accessor', 'get', 'set']);

/**
 * The body after a parameter list, past a TS return type: `(): Promise<{ a: T }> {`
 * and `(): { a: T } | null {` open their body at the last `{`, not the first.
 */
function jsBody(E, k, hi) {
  const { T, P } = E;
  if (!isP(T[k], ':')) return findBody(E, k, hi);
  let angle = 0;
  let q = k + 1;
  for (; q < hi; q++) {
    const t = T[q];
    if (isTerm(t)) break;
    if (t.t !== 'punct' || t.pp) continue;
    const prev = T[q - 1];
    const arrow = adjacent(prev, t) && prev.v === '=';
    if (t.v === '<') { angle++; continue; }
    if (t.v === '>') { if (!arrow && angle > 0) angle--; continue; }
    if (t.v === '(' || t.v === '[') {
      if (P[q] < 0) break;
      q = P[q];
      continue;
    }
    if (t.v === '{') {
      const typeLiteral = angle > 0 || q === k + 1 || ['|', '&', ',', '(', '['].includes(prev.v)
        || (prev.v === '>' && adjacent(T[q - 2], prev) && T[q - 2].v === '=');
      if (!typeLiteral || P[q] < 0) break;
      q = P[q];
      continue;
    }
    if (t.v === '}' || t.v === ')' || t.v === ']') break;
    if (t.v === '=' && angle === 0 && !(adjacent(t, T[q + 1]) && T[q + 1].v === '>')) break;
  }
  return findBody(E, q, hi);
}

/** The initializer after the first depth-0 `=` of `[k, hi)` is a function or an arrow. */
function jsFunctionInit(E, k, hi) {
  const { T, P } = E;
  let q = k;
  for (; q < hi; q++) {
    if (isOpen(T[q]) && P[q] > q) { q = P[q]; continue; }
    if (isTerm(T[q])) return false;
    if (isP(T[q], '=') && !(adjacent(T[q], T[q + 1]) && (T[q + 1].v === '=' || T[q + 1].v === '>'))) break;
  }
  q++;
  if (isId(T[q], 'async')) q++;
  if (isId(T[q], 'function')) return true;
  const arrowAt = j => isP(T[j], '=') && isP(T[j + 1], '>') && adjacent(T[j], T[j + 1]);
  if (isP(T[q], '(') && P[q] > q) return arrowAt(P[q] + 1);
  return isId(T[q]) && arrowAt(q + 1);
}

function jsMethod(E, i, hi, ctx) {
  const { T, P } = E;
  if (P[i] < 0) return null;
  let n = i - 1;
  if (isP(T[n], '>')) {
    const o = anglesBack(E, n, ctx.lo);
    if (o < 0) return null;
    n = o - 1;
  }
  const t = T[n];
  if (!t || n < ctx.lo) return null;
  let name;
  let first = n;
  if (t.t === 'id') {
    if (CONTROL.has(t.v)) return null;
    name = t.v;
    if (isP(T[n - 1], '#') && adjacent(T[n - 1], t)) { name = `#${name}`; first = n - 1; }
  } else if (t.t === 'str') name = t.v.slice(1, -1);
  else if (isP(t, ']') && P[n] >= ctx.lo) { first = P[n]; name = joinTokens(T, P[n], n + 1); } else return null;
  if (isP(T[first - 1], '*')) first--;
  if (isP(T[first - 1], '.')) return null;
  const start = declStart(E, first, ctx.lo, false);
  if (start < 0) return null;
  return finishFn(E, ctx, { name, nameIdx: n, start, hi, kind: 'method', sig: paramSig(E, i, 'colon'), body: jsBody(E, P[i] + 1, hi) });
}

function jsField(E, i, hi, ctx) {
  const { T } = E;
  const nx = T[i + 1];
  const ok = (isP(nx, '=') && !(adjacent(nx, T[i + 2]) && (T[i + 2].v === '=' || T[i + 2].v === '>')))
    || isP(nx, ':') || ((isP(nx, '?') || isP(nx, '!')) && isP(T[i + 2], ':')) || isTerm(nx);
  if (!ok) return null;
  const first = isP(T[i - 1], '#') && adjacent(T[i - 1], T[i]) ? i - 1 : i;
  const start = declStart(E, first, ctx.lo, false);
  if (start < 0) return null;
  const r = stmtEnd(E, i + 1, hi);
  addSym(E, ctx, { name: (first < i ? '#' : '') + T[i].v, kind: 'variable', start, nameIdx: i, end: T[Math.max(r.last, i)].e, bodyIdx: -1 });
  return { next: r.next };
}

function jsDecl(E, i, hi, ctx) {
  const { T, P } = E;
  const t = T[i];
  if (t.t === 'id') {
    if (isP(T[i - 1], '.')) return null;
    const ts = E.lang === 'ts';
    switch (t.v) {
      case 'function': {
        let k = i + 1;
        if (isP(T[k], '*')) k++;
        if (!isId(T[k])) return null;
        const nameIdx = k++;
        if (isP(T[k], '<')) {
          k = anglesFwd(E, k, hi);
          if (k < 0) return null;
        }
        if (!isP(T[k], '(') || P[k] < 0) return null;
        const start = declStart(E, i, ctx.lo, false);
        if (start < 0) return null;
        return finishFn(E, ctx, { name: T[nameIdx].v, nameIdx, start, hi, kind: 'function', sig: paramSig(E, k, 'colon'), body: jsBody(E, P[k] + 1, hi) });
      }
      case 'class':
        return isId(T[i + 1]) && !/^(?:extends|implements)$/.test(T[i + 1].v) ? typeDecl(E, i, hi, ctx, { kind: 'class', nameIdx: i + 1 }) : null;
      case 'interface': return ts && isId(T[i + 1]) ? typeDecl(E, i, hi, ctx, { kind: 'interface', nameIdx: i + 1, walk: false }) : null;
      case 'enum': return isId(T[i + 1]) ? typeDecl(E, i, hi, ctx, { kind: 'enum', nameIdx: i + 1, walk: false }) : null;
      case 'type':
        return ts && ctx.mode !== 'code' && isId(T[i + 1]) && (isP(T[i + 2], '=') || isP(T[i + 2], '<')) ? simpleDecl(E, i, i + 1, hi, ctx, 'type') : null;
      case 'namespace': return ts && isId(T[i + 1]) ? nsDecl(E, i, hi, ctx) : null;
      case 'const': case 'let': case 'var': {
        if (ctx.mode === 'code' || !isId(T[i + 1]) || T[i + 1].v === 'enum') return null;
        const start = declStart(E, i, ctx.lo, false);
        if (start < 0) return null;
        const r = stmtEnd(E, i + 2, hi);
        const kind = jsFunctionInit(E, i + 2, hi) ? 'function' : 'variable';
        addSym(E, ctx, { name: T[i + 1].v, kind, start, nameIdx: i + 1, end: T[Math.max(r.last, i + 1)].e, bodyIdx: -1 });
        return { next: r.next };
      }
      default: break;
    }
    return ctx.mode === 'member' ? jsField(E, i, hi, ctx) : null;
  }
  if (ctx.mode === 'member' && isP(t, '(')) return jsMethod(E, i, hi, ctx);
  return null;
}

// ── Languages: Python (indentation) ──────────────────────────────────────────

const PY_KEYWORDS = new Set(['if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'return', 'pass', 'break', 'continue', 'raise', 'import', 'from', 'global', 'nonlocal', 'del', 'assert', 'yield', 'lambda', 'match', 'case', 'async', 'await', 'class', 'def', 'print']);

function pyAssignment(T, k, nl) {
  if (!isId(T[k]) || PY_KEYWORDS.has(T[k].v)) return false;
  const nx = T[k + 1];
  if (isP(nx, '=')) return !(adjacent(nx, T[k + 2]) && T[k + 2].v === '=');
  return isP(nx, ':') && k + 2 < nl;
}

function headerColon(E, j, nl) {
  const { T, P } = E;
  for (let q = j; q < nl; q++) {
    if (isOpen(T[q]) && P[q] > q) { q = P[q]; continue; }
    if (isP(T[q], ':')) return q;
  }
  return -1;
}

function setEnd(E, idx, pos) {
  const sym = E.syms[idx];
  sym.end = Math.max(pos, sym.start);
  sym.endLine = lineOf(E.lx.lineStarts, Math.max(sym.start, sym.end - 1));
}

function pyOutline(E) {
  const { T, P } = E;
  const root = { kind: 'module', path: [], top: true, parent: null, sym: -1 };
  const frames = [root];
  let decorator = -1;
  let expect = null;  // the frame to open at the next INDENT
  let k = 0;
  while (k < T.length) {
    const t = T[k];
    if (t.t === 'semi') {
      if (t.v === INDENT) {
        frames.push(expect || { ...frames[frames.length - 1], sym: -1 });
        expect = null;
      } else if (t.v === DEDENT) {
        const f = frames.pop();
        if (!frames.length) return `unbalanced indentation at line ${t.line}`;
        if (f.sym >= 0) setEnd(E, f.sym, t.s);
      }
      k++;
      continue;
    }
    let nl = k;
    while (nl < T.length && !(T[nl].t === 'semi' && T[nl].v === ';')) {
      if (isOpen(T[nl]) && P[nl] > nl) nl = P[nl];
      nl++;
    }
    const cur = frames[frames.length - 1];
    const opensBlock = isP(T[nl - 1], ':') && !!T[nl + 1] && T[nl + 1].v === INDENT;
    expect = null;
    if (isP(t, '@')) {
      if (decorator < 0) decorator = k;
      k = nl + 1;
      continue;
    }
    let d = k;
    if (isId(T[d], 'async')) d++;
    const kw = isId(T[d], 'def') ? 'def' : isId(T[d], 'class') ? 'class' : null;
    const ctx = { path: cur.path, parent: cur.parent, top: cur.top };
    if (kw && isId(T[d + 1])) {
      const nameIdx = d + 1;
      const name = T[nameIdx].v;
      const kind = kw === 'class' ? 'class' : cur.kind === 'class' ? 'method' : 'function';
      const sig = kw === 'def' && isP(T[nameIdx + 1], '(') ? paramSig(E, nameIdx + 1, 'python') : null;
      const idx = addSym(E, ctx, { name, kind, start: decorator >= 0 ? decorator : k, nameIdx, end: T[Math.max(nl - 1, nameIdx)].e, bodyIdx: headerColon(E, nameIdx + 1, nl), sig });
      if (opensBlock) expect = { kind: kw === 'class' ? 'class' : 'function', path: [E.syms[idx].qual], top: false, parent: idx, sym: idx };
    } else {
      if (cur.kind !== 'function' && pyAssignment(T, k, nl)) {
        addSym(E, ctx, { name: t.v, kind: 'variable', start: k, nameIdx: k, end: T[nl - 1].e, bodyIdx: -1 });
      }
      if (opensBlock) expect = { ...cur, sym: -1 };
    }
    decorator = -1;
    k = nl + 1;
  }
  return null;
}

// ── Languages: Ruby (`end`-delimited blocks) ─────────────────────────────────

const RB_NONENDER = new Set(['and', 'or', 'not', 'then', 'do', 'else', 'elsif', 'begin', 'when', 'in', 'if', 'unless', 'while', 'until', 'case', 'def', 'class', 'module', 'ensure', 'rescue']);

/** `x.end`, `obj.class`, `Foo::Bar`: a keyword spelling used as a name. */
function rbAfterDot(T, k) {
  const p = T[k - 1];
  return !!p && adjacent(p, T[k]) && (isP(p, '.') || isP(p, ':'));
}

/**
 * `stmt if cond`: the keyword follows a complete expression with no statement
 * end between (the same line, or a line continued with `\`).
 */
function rbModifier(T, k) {
  const p = T[k - 1];
  if (!p || isTerm(p)) return false;
  if (p.t === 'num' || p.t === 'str') return true;
  if (p.t === 'id') return !RB_NONENDER.has(p.v);
  return isP(p, ')') || isP(p, ']') || isP(p, '}');
}

/** `def [recv.]name[(params)]` → name, signature, and whether it is an endless `def x = expr`. */
function rbDef(E, k) {
  const { T, P } = E;
  let q = k + 1;
  let singleton = false;
  if ((isId(T[q]) || isP(T[q], ')')) && isP(T[q + 1], '.') && adjacent(T[q], T[q + 1]) && T[q + 2]) { singleton = true; q += 2; }
  const nameIdx = q;
  let name = '';
  if (isId(T[q])) {
    name = T[q].v;
    q++;
    if (isP(T[q], '=') && adjacent(T[q - 1], T[q]) && (isP(T[q + 1], '(') || isId(T[q + 1]))) { name += '='; q++; }  // a setter
  } else {
    while (T[q] && T[q].t === 'punct' && !(name && isP(T[q], '(')) && (name === '' || adjacent(T[q - 1], T[q]))) { name += T[q].v; q++; }
  }
  if (!name || !T[nameIdx]) return null;
  let sig = null;
  if (isP(T[q], '(') && P[q] > q && adjacent(T[q - 1], T[q])) {
    sig = paramSig(E, q, 'ruby');
    q = P[q] + 1;
  } else {
    let z = q;
    while (z < T.length && !isTerm(T[z]) && !(isP(T[z], '=') && !adjacent(T[z], T[z + 1]))) z++;
    if (z > q) sig = joinTokens(T, q, z);
    q = z;
  }
  if (singleton) sig = `self.${sig ?? ''}`;
  if (isP(T[q], '=') && !(adjacent(T[q], T[q + 1]) && (T[q + 1].v === '=' || T[q + 1].v === '~'))) {
    const r = rbStmtEnd(E, q + 1);
    return { name, nameIdx, sig, endless: true, last: Math.max(r.last, q), bodyIdx: q };
  }
  return { name, nameIdx, sig, endless: false, headerLast: q - 1 };
}

/** `Foo::Bar` after `class`/`module` → { name: 'Foo.Bar', last }. */
function rbConstPath(T, q) {
  if (isP(T[q], ':') && isP(T[q + 1], ':')) q += 2;
  if (!isId(T[q])) return null;
  const parts = [T[q].v];
  let last = q;
  while (isP(T[last + 1], ':') && isP(T[last + 2], ':') && isId(T[last + 3])) { parts.push(T[last + 3].v); last += 3; }
  return { name: parts.join('.'), last };
}

/** Ruby-aware statement end: blocks opened inside the statement close before it can end. */
/**
 * `Const = Struct.new(...) do`, `Data.define(...) do`, `Class.new(Base) do`,
 * `Module.new do`: the index of the `do` that opens a class body, or -1.
 */
function rbClassBlockDo(E, k) {
  const { T, P } = E;
  const factory = T[k + 2];
  if (!factory || factory.t !== 'id' || !isP(T[k + 3], '.')) return -1;
  const method = T[k + 4];
  const known = (factory.v === 'Struct' && method?.v === 'new') || (factory.v === 'Data' && method?.v === 'define')
    || ((factory.v === 'Class' || factory.v === 'Module') && method?.v === 'new');
  if (!known) return -1;
  let j = k + 5;
  if (isP(T[j], '(') && P[j] >= 0) j = P[j] + 1;
  return T[j] && T[j].t === 'id' && T[j].v === 'do' && T[j].line === T[k].line ? j : -1;
}

function rbStmtEnd(E, k) {
  const { T, P } = E;
  let depth = 0;
  let loopDo = false;
  let last = k - 1;
  for (let j = k; j < T.length; j++) {
    const t = T[j];
    if (isTerm(t)) {
      loopDo = false;
      if (depth === 0) return t.virtual ? { last, next: j + 1 } : { last: j, next: j + 1 };
      continue;
    }
    if (isOpen(t)) {
      if (P[j] < 0) return { last: T.length - 1, next: T.length };
      last = P[j];
      j = P[j];
      continue;
    }
    if (isClose(t)) {
      if (depth === 0) return { last, next: j };
      last = j;
      continue;
    }
    if (t.t === 'id' && !rbAfterDot(T, j)) {
      switch (t.v) {
        case 'def': {
          const d = rbDef(E, j);
          if (d && d.endless) { last = d.last; j = d.last; continue; }
          depth++;
          break;
        }
        case 'class': case 'module': case 'case': case 'begin': depth++; break;
        case 'if': case 'unless': if (!rbModifier(T, j)) depth++; break;
        case 'while': case 'until': if (!rbModifier(T, j)) { depth++; loopDo = true; } break;
        case 'for': depth++; loopDo = true; break;
        case 'do': if (loopDo) loopDo = false; else depth++; break;
        case 'end':
          if (depth === 0) return { last, next: j };
          depth--;
          break;
        default: break;
      }
    }
    last = j;
  }
  return { last, next: T.length };
}

function rubyOutline(E) {
  const { T } = E;
  const root = { kind: 'root', path: [], top: true, parent: null, sym: -1 };
  const stack = [];
  const scope = () => {
    for (let q = stack.length - 1; q >= 0; q--) if (stack[q].kind !== 'block') return stack[q];
    return root;
  };
  const inDef = () => stack.some(f => f.kind === 'def');
  const ctxOf = sc => ({ path: sc.path, parent: sc.sym >= 0 ? sc.sym : null, top: sc === root });
  let loopDo = false;
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (isTerm(t)) { loopDo = false; continue; }
    if (t.t !== 'id' || rbAfterDot(T, k)) continue;
    switch (t.v) {
      case 'def': {
        const d = rbDef(E, k);
        if (!d) { stack.push({ kind: 'block', sym: -1 }); break; }
        const sc = scope();
        const kind = sc.kind === 'class' || sc.kind === 'module' ? 'method' : 'function';
        if (d.endless) {
          addSym(E, ctxOf(sc), { name: d.name, kind, start: k, nameIdx: d.nameIdx, end: T[d.last].e, bodyIdx: d.bodyIdx, sig: d.sig });
          k = d.last;
          break;
        }
        const idx = addSym(E, ctxOf(sc), { name: d.name, kind, start: k, nameIdx: d.nameIdx, end: T[d.headerLast].e, bodyIdx: d.headerLast + 1 < T.length ? d.headerLast + 1 : -1, sig: d.sig });
        stack.push({ kind: 'def', sym: idx, path: [E.syms[idx].qual] });
        k = d.headerLast;
        break;
      }
      case 'class': case 'module': {
        if (t.v === 'class' && isP(T[k + 1], '<') && isP(T[k + 2], '<')) { stack.push({ kind: 'block', sym: -1 }); k += 2; break; }  // class << self
        const nm = rbConstPath(T, k + 1);
        if (!nm) { stack.push({ kind: 'block', sym: -1 }); break; }
        const sc = scope();
        const idx = addSym(E, ctxOf(sc), { name: nm.name, kind: t.v === 'class' ? 'class' : 'module', start: k, nameIdx: k + 1, end: T[nm.last].e, bodyIdx: -1 });
        stack.push({ kind: t.v, sym: idx, path: [E.syms[idx].qual] });
        k = nm.last;
        break;
      }
      case 'if': case 'unless': case 'while': case 'until':
        if (rbModifier(T, k)) break;
        stack.push({ kind: 'block', sym: -1 });
        if (t.v === 'while' || t.v === 'until') loopDo = true;
        break;
      case 'for': stack.push({ kind: 'block', sym: -1 }); loopDo = true; break;
      case 'case': case 'begin': stack.push({ kind: 'block', sym: -1 }); break;
      case 'do':
        if (loopDo) { loopDo = false; break; }
        stack.push({ kind: 'block', sym: -1 });
        break;
      case 'end': {
        const f = stack.pop();
        if (!f) return `unexpected 'end' at line ${t.line}`;
        if (f.sym >= 0) setEnd(E, f.sym, t.e);
        break;
      }
      default:
        // `Entry = Struct.new(:a) do ... end`: a class whose body is the block.
        if (/^[A-Z]/.test(t.v) && (k === 0 || isTerm(T[k - 1])) && isP(T[k + 1], '=') && !inDef()) {
          const doIdx = rbClassBlockDo(E, k);
          if (doIdx >= 0) {
            const sc = scope();
            const idx = addSym(E, ctxOf(sc), { name: t.v, kind: 'class', start: k, nameIdx: k, end: T[doIdx].e, bodyIdx: -1 });
            stack.push({ kind: 'class', sym: idx, path: [E.syms[idx].qual] });
            k = doIdx;
            break;
          }
        }
        // a constant at class, module or file level: `TAX = 0.2`
        if (/^[A-Z]/.test(t.v) && (k === 0 || isTerm(T[k - 1])) && isP(T[k + 1], '=') && !(adjacent(T[k + 1], T[k + 2]) && /^[=~>]$/.test(T[k + 2].v)) && !inDef()) {
          const r = rbStmtEnd(E, k + 2);
          const last = Math.max(r.last, k + 1);
          addSym(E, ctxOf(scope()), { name: t.v, kind: 'variable', start: k, nameIdx: k, end: T[last].e, bodyIdx: -1 });
          k = last;
        }
        break;
    }
  }
  if (stack.length) {
    const open = stack.find(f => f.sym >= 0);
    return `missing 'end' for a block opened at line ${open ? E.syms[open.sym].startLine : T[T.length - 1].line}`;
  }
  return null;
}

// ── Outline ──────────────────────────────────────────────────────────────────

const RULES = {
  go: { decl: goDecl, mods: new Set(), nested: false },
  rust: { decl: rustDecl, mods: RUST_MODS },
  java: { decl: javaDecl, mods: JAVA_MODS },
  kotlin: { decl: ktDecl, mods: KT_MODS },
  csharp: { decl: csDecl, mods: CS_MODS, bracketAttrs: true },
  php: { decl: phpDecl, mods: PHP_MODS, ci: true },
  swift: { decl: swiftDecl, mods: SWIFT_MODS },
  c: { decl: cDecl, mods: C_MODS, bracketAttrs: true, accessLabels: true },
  cpp: { decl: cDecl, mods: C_MODS, bracketAttrs: true, accessLabels: true },
  js: { decl: jsDecl, mods: JS_MODS, asi: true },
  ts: { decl: jsDecl, mods: JS_MODS, asi: true },
};
const OUTLINERS = { python: pyOutline, ruby: rubyOutline };

/**
 * Declarations in `content`, in source order (a parent before its members).
 *
 * Each symbol is `{ qual, name, kind, start, end, startLine, endLine,
 * nameLine, bodyOpen, parent, topLevel, sig }`: `start` is the first
 * decorator, annotation, attribute or modifier (never a preceding comment);
 * `end` is just after the closing token, or after the terminator of a
 * declaration with no body; `qual` joins enclosing types, impls, modules and
 * namespaces with '.'; `parent` is the enclosing symbol's index; `topLevel` is
 * true when every enclosing symbol is a module or namespace; `sig` is the
 * parameter types joined by ', ' (for a Rust trait impl, the trait), used to
 * tell overloads apart. When the file does not balance, or (Ruby) an `end` is
 * missing, `error` is set and `symbols` is empty: callers use file scope.
 * C and C++ results are best effort. Never throws.
 *
 * @param {string} content
 * @param {string} lang
 * @returns {{ symbols: object[], error: string|null, lex: ReturnType<typeof lex> }}
 */
export function outline(content, lang) {
  const lx = lex(content, lang);
  if (lx.error) return { symbols: [], error: lx.error, lex: lx };
  if (!RULES[lang] && !OUTLINERS[lang]) return { symbols: [], error: null, lex: lx };
  try {
    const E = engine(lx);
    const error = OUTLINERS[lang]
      ? OUTLINERS[lang](E)
      : (walkBlock(E, 0, lx.tokens.length, { path: [], parent: null, top: true, mode: 'top', container: null }), null);
    if (error) return { symbols: [], error, lex: lx };
    return { symbols: E.syms, error: null, lex: lx };
  } catch (err) {
    return { symbols: [], error: `outline failure: ${err && err.message}`, lex: lx };
  }
}
