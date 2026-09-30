/**
 * Python module outlines — the shared input of the Python resolvers.
 *
 * An outline is what the route, model and settings resolvers need from one
 * module: its imports with their local names, and its module-level
 * assignments, calls, classes and functions, with every expression in a small
 * JSON form (see `enc` in py-ast.mjs). Two tiers produce it:
 *
 *   - the AST tier: the developer's `python3` (`extractPythonFiles`), exact;
 *   - the pattern tier: `outlineFromSource` below, from source text, when no
 *     interpreter is available or a file does not parse.
 *
 * The pattern tier is a tokenizer that knows strings and comments, a logical
 * line splitter, indentation blocks and a reader for the expression subset
 * the resolvers use; anything else becomes `{t:'other'}`. On the layouts the
 * framework documentation uses it reads the same facts as the AST tier, and
 * its results still carry `parserTier: regex-fallback`: it is not a parser.
 *
 * @implements docguard.python-extraction#FR-001
 * @implements docguard.python-extraction#FR-003
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS } from '../shared-ignore.mjs';

const MAX_DEPTH = 14;
const MAX_ITEMS = 500;

// ── Tokenizer ───────────────────────────────────────────────────────────────

const OPERATORS = [
  '**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '>>', '<<', '<=', '>=', '==', '!=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
];
const SINGLE = new Set('+-*/%@&|^~<>()[]{},:.;=!'.split(''));
const STRING_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/**
 * Split source into logical lines of tokens.
 * @returns {Array<{indent:number, line:number, tokens:Array<{type:string, v:string, line:number, prefix?:string}>}>}
 */
export function logicalLines(source) {
  const src = String(source).replace(/\r\n?/g, '\n');
  const lines = [];
  let tokens = [];
  let depth = 0;
  let indent = 0;
  let atLineStart = true;
  let line = 1;
  let i = 0;
  const n = src.length;
  const flush = () => {
    if (tokens.length) lines.push({ indent, line: tokens[0].line, tokens });
    tokens = [];
    atLineStart = true;
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      // Measure indentation of a new logical line; skip blank/comment lines.
      let col = 0;
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) {
        col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1;
        j++;
      }
      if (j >= n) break;
      if (src[j] === '\n') { i = j + 1; line++; continue; }
      if (src[j] === '#') {
        while (j < n && src[j] !== '\n') j++;
        i = j;
        continue;
      }
      indent = col;
      i = j;
      atLineStart = false;
    }
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
      if (depth === 0) flush();
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\f') { i++; continue; }
    if (ch === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }

    // Names (and string prefixes).
    if (/[A-Za-z_À-￿]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\wÀ-￿]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && STRING_PREFIX.test(word)) {
        const r = readString(src, j, word, line);
        tokens.push(r.token);
        line = r.line;
        i = r.end;
        continue;
      }
      tokens.push({ type: 'name', v: word, line });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const r = readString(src, i, '', line);
      tokens.push(r.token);
      line = r.line;
      i = r.end;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && (/[\w.]/.test(src[j]) || ((src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j))))) j++;
      tokens.push({ type: 'num', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (op) { tokens.push({ type: 'op', v: op, line }); i += op.length; continue; }
    if (SINGLE.has(ch)) {
      if (OPEN.has(ch)) depth++;
      else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
      tokens.push({ type: 'op', v: ch, line });
      i++;
      continue;
    }
    i++; // anything else ($, ?, backticks in broken code) is skipped
  }
  flush();
  return lines;
}

function readString(src, start, prefix, line) {
  const quote = src[start];
  const triple = src.startsWith(quote.repeat(3), start);
  const delim = triple ? quote.repeat(3) : quote;
  let j = start + delim.length;
  const n = src.length;
  let raw = '';
  let endLine = line;
  while (j < n) {
    if (src[j] === '\\') {
      raw += src.slice(j, j + 2);
      if (src[j + 1] === '\n') endLine++;
      j += 2;
      continue;
    }
    if (src.startsWith(delim, j)) { j += delim.length; break; }
    if (src[j] === '\n') {
      if (!triple) break; // unterminated single-quoted string: stop at the line end
      endLine++;
    }
    raw += src[j];
    j++;
  }
  return { token: { type: 'str', v: raw, line, prefix: prefix.toLowerCase() }, end: j, line: endLine };
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v', '\n': '' };

function decodeString(token) {
  if (token.prefix.includes('r')) return token.v;
  return token.v.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|.)/gs, (m, c) => {
    if (c in ESCAPES) return ESCAPES[c];
    if (/^[xuU]/.test(c) && c.length > 1) return String.fromCodePoint(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c)) return String.fromCodePoint(parseInt(c, 8));
    return m;
  });
}

// ── Expression reader ───────────────────────────────────────────────────────

const OTHER = Object.freeze({ t: 'other' });
const COMPARISON = new Set(['==', '!=', '<', '>', '<=', '>=', 'in', 'is', 'not', 'and', 'or', 'if', 'else', 'for', 'lambda', 'await', 'yield', ':=']);
const OTHER_BINARY = new Set(['-', '*', '/', '//', '%', '@', '**', '&', '^', '<<', '>>']);

/** Top-level (bracket depth 0) indices of tokens matching `pred`. */
function topLevel(tokens, pred) {
  const out = [];
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'op' && OPEN.has(t.v)) depth++;
    else if (t.type === 'op' && CLOSE.has(t.v)) depth--;
    else if (depth === 0 && pred(t, k)) out.push(k);
  }
  return out;
}

/** Split a token list at top-level commas (dropping a trailing empty part). */
function splitCommas(tokens) {
  const cuts = topLevel(tokens, t => t.type === 'op' && t.v === ',');
  const raw = [];
  let from = 0;
  for (const c of cuts) { raw.push(tokens.slice(from, c + 1)); from = c + 1; }
  raw.push(tokens.slice(from));
  // A lambda's parameter list holds top-level commas of its own
  // (`key=lambda a, b: a`): keep them in the part that holds the lambda.
  const parts = [];
  for (const part of raw) {
    const prev = parts[parts.length - 1];
    if (prev && openLambda(prev)) parts[parts.length - 1] = [...prev, ...part];
    else parts.push(part);
  }
  return parts
    .map(p => (p.length && p[p.length - 1].type === 'op' && p[p.length - 1].v === ',' ? p.slice(0, -1) : p))
    .filter(p => p.length > 0);
}

function openLambda(part) {
  const at = topLevel(part, t => t.type === 'name' && t.v === 'lambda');
  if (!at.length) return false;
  const last = at[at.length - 1];
  return !topLevel(part.slice(last), t => t.type === 'op' && t.v === ':').length;
}

/** The index of the token that closes the bracket opened at `open`. */
function closing(tokens, open) {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === 'op' && OPEN.has(t.v)) depth++;
    else if (t.type === 'op' && CLOSE.has(t.v)) { depth--; if (depth === 0) return k; }
  }
  return tokens.length;
}

const isOperand = t => t && (t.type !== 'op' || CLOSE.has(t.v));

/** Parse an expression token slice into the outline expression form. */
export function parseExpr(tokens, depth = 0) {
  if (!tokens || tokens.length === 0) return null;
  if (depth > MAX_DEPTH) return OTHER;
  const d = depth + 1;
  if (tokens[0].type === 'name' && tokens[0].v === 'lambda') return OTHER;
  // A bare tuple (`a, b` without brackets) is a tuple display.
  const commas = topLevel(tokens, t => t.type === 'op' && t.v === ',');
  if (commas.length) return { t: 'list', items: splitCommas(tokens).slice(0, MAX_ITEMS).map(p => itemExpr(p, d)) };
  if (topLevel(tokens, t => (t.type === 'name' && COMPARISON.has(t.v)) || (t.type === 'op' && COMPARISON.has(t.v))).length) return OTHER;
  // Lowest precedence first: '|' then '+' (left-associative: split at the last).
  const bars = topLevel(tokens, t => t.type === 'op' && t.v === '|');
  if (bars.length) {
    const k = bars[bars.length - 1];
    return { t: 'bin', op: '|', l: parseExpr(tokens.slice(0, k), d), r: parseExpr(tokens.slice(k + 1), d) };
  }
  if (topLevel(tokens, t => t.type === 'op' && (t.v === '&' || t.v === '^' || t.v === '<<' || t.v === '>>')).length) return OTHER;
  const adds = topLevel(tokens, (t, k) => t.type === 'op' && (t.v === '+' || t.v === '-') && k > 0 && isOperand(tokens[k - 1]));
  if (adds.length) {
    const k = adds[adds.length - 1];
    if (tokens[k].v === '-') return OTHER;
    return { t: 'bin', op: '+', l: parseExpr(tokens.slice(0, k), d), r: parseExpr(tokens.slice(k + 1), d) };
  }
  if (topLevel(tokens, (t, k) => t.type === 'op' && OTHER_BINARY.has(t.v) && k > 0 && isOperand(tokens[k - 1])).length) return OTHER;
  const first = tokens[0];
  if (first.type === 'op' && (first.v === '-' || first.v === '+' || first.v === '~' || first.v === '*' || first.v === '**')) return OTHER;
  return parsePrimary(tokens, d);
}

function parsePrimary(tokens, d) {
  let k = 0;
  let expr;
  const t = tokens[0];
  if (t.type === 'name') {
    if (t.v === 'True' || t.v === 'False') expr = { t: 'const', v: t.v === 'True' };
    else if (t.v === 'None') expr = { t: 'const', v: null };
    else expr = { t: 'ref', v: t.v };
    k = 1;
  } else if (t.type === 'num') {
    const v = Number(t.v.replace(/_/g, ''));
    expr = Number.isFinite(v) && /^(?:0[xXoObB][0-9a-fA-F_]+|[0-9_.eE+-]+)$/.test(t.v) ? { t: 'num', v } : OTHER;
    k = 1;
  } else if (t.type === 'str') {
    // Implicit concatenation of adjacent literals, as the compiler does.
    const parts = [];
    while (k < tokens.length && tokens[k].type === 'str') { parts.push(tokens[k]); k++; }
    expr = stringExpr(parts, d);
  } else if (t.type === 'op' && t.v === '...') {
    expr = { t: 'const', v: '...' };
    k = 1;
  } else if (t.type === 'op' && OPEN.has(t.v)) {
    const end = closing(tokens, 0);
    const inner = tokens.slice(1, end);
    expr = display(t.v, inner, d);
    k = end + 1;
  } else {
    return OTHER;
  }
  // Trailers: .name, (args), [index].
  while (k < tokens.length) {
    const tk = tokens[k];
    if (tk.type === 'op' && tk.v === '.' && tokens[k + 1]?.type === 'name') {
      const attr = tokens[k + 1].v;
      expr = expr.t === 'ref' ? { t: 'ref', v: `${expr.v}.${attr}` } : { t: 'attr', value: expr, attr };
      k += 2;
    } else if (tk.type === 'op' && tk.v === '(') {
      const end = closing(tokens, k);
      expr = { t: 'call', fn: expr, ...callArgs(tokens.slice(k + 1, end), d) };
      k = end + 1;
    } else if (tk.type === 'op' && tk.v === '[') {
      const end = closing(tokens, k);
      let inner = tokens.slice(k + 1, end);
      // x[(a, b)] indexes with the tuple's items, as x[a, b] does.
      if (inner[0]?.type === 'op' && inner[0].v === '(' && closing(inner, 0) === inner.length - 1) inner = inner.slice(1, -1);
      const index = topLevel(inner, x => x.type === 'op' && x.v === ':').length
        ? [OTHER]
        : splitCommas(inner).slice(0, MAX_ITEMS).map(p => parseExpr(p, d));
      expr = { t: 'sub', value: expr, index };
      k = end + 1;
    } else {
      return OTHER; // juxtaposed tokens this reader does not model
    }
  }
  return expr;
}

function display(open, inner, d) {
  if (topLevel(inner, t => t.type === 'name' && (t.v === 'for' || t.v === 'async')).length) return OTHER; // comprehension
  const parts = splitCommas(inner);
  if (open === '(') {
    const trailingComma = inner.length && inner[inner.length - 1].type === 'op' && inner[inner.length - 1].v === ',';
    if (parts.length === 1 && !trailingComma) return parseExpr(parts[0], d); // parenthesized
    return { t: 'list', items: parts.slice(0, MAX_ITEMS).map(p => itemExpr(p, d)) };
  }
  if (open === '[') return { t: 'list', items: parts.slice(0, MAX_ITEMS).map(p => itemExpr(p, d)) };
  // '{': a dict when its first item has a top-level ':', else a set.
  if (parts.length === 0) return { t: 'dict', keys: [], values: [] };
  const isDict = parts.some(p => topLevel(p, t => t.type === 'op' && t.v === ':').length || (p[0]?.type === 'op' && p[0].v === '**'));
  if (!isDict) return { t: 'list', items: parts.slice(0, MAX_ITEMS).map(p => itemExpr(p, d)) };
  const keys = [];
  const values = [];
  for (const p of parts.slice(0, MAX_ITEMS)) {
    if (p[0]?.type === 'op' && p[0].v === '**') continue;
    const [colon] = topLevel(p, t => t.type === 'op' && t.v === ':');
    if (colon === undefined) continue;
    keys.push(parseExpr(p.slice(0, colon), d));
    values.push(parseExpr(p.slice(colon + 1), d));
  }
  return { t: 'dict', keys, values };
}

const itemExpr = (p, d) => (p[0]?.type === 'op' && (p[0].v === '*' || p[0].v === '**') ? OTHER : parseExpr(p, d));

function callArgs(inner, d) {
  const args = [];
  const kw = {};
  // A bare generator argument (`f(x for k, v in y)`) is the only argument.
  if (topLevel(inner, t => t.type === 'name' && t.v === 'for').length) return { args: [OTHER], kw };
  for (const p of splitCommas(inner)) {
    if (p[0]?.type === 'op' && p[0].v === '**') continue;
    if (p[0]?.type === 'op' && p[0].v === '*') { if (args.length < MAX_ITEMS) args.push(OTHER); continue; }
    if (p[0]?.type === 'name' && p[1]?.type === 'op' && p[1].v === '=') { kw[p[0].v] = parseExpr(p.slice(2), d); continue; }
    if (args.length < MAX_ITEMS) args.push(parseExpr(p, d));
  }
  return { args, kw };
}

function stringExpr(parts, d) {
  if (!parts.some(p => p.prefix.includes('f'))) {
    return { t: 'str', v: parts.map(decodeString).join('') };
  }
  // f-strings: literal text and {expression} fields, with {{ and }} escapes.
  const out = [];
  let text = '';
  const pushText = () => { if (text) { out.push({ t: 'str', v: text }); text = ''; } };
  for (const p of parts) {
    const body = p.prefix.includes('f') ? decodeString(p) : decodeString(p).replace(/[{}]/g, c => c + c);
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (c === '{' && body[k + 1] === '{') { text += '{'; k++; continue; }
      if (c === '}' && body[k + 1] === '}') { text += '}'; k++; continue; }
      if (c === '{') {
        let depth = 1;
        let j = k + 1;
        while (j < body.length && depth > 0) {
          if (body[j] === '{') depth++;
          else if (body[j] === '}') depth--;
          if (depth > 0) j++;
        }
        let field = body.slice(k + 1, j);
        field = field.replace(/![rsa]\s*$/, '').replace(/![rsa]?:[^:]*$/, '');
        const colon = topLevel(logicalTokens(field), t => t.type === 'op' && t.v === ':');
        if (colon.length) field = field.slice(0, field.lastIndexOf(':'));
        pushText();
        out.push(parseExpr(logicalTokens(field.replace(/=\s*$/, '')), d) || OTHER);
        k = j;
        continue;
      }
      text += c;
    }
  }
  pushText();
  return { t: 'fstr', parts: out };
}

function logicalTokens(text) {
  return logicalLines(text).flatMap(l => l.tokens);
}

// ── Statements and blocks ───────────────────────────────────────────────────

const COMPOUND = new Set(['if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'match', 'case']);
const SKIP = new Set(['return', 'pass', 'raise', 'del', 'global', 'nonlocal', 'assert', 'break', 'continue', 'yield']);

/** The first top-level ':' of a compound statement header, or -1. */
function headerColon(tokens) {
  const colons = topLevel(tokens, t => t.type === 'op' && t.v === ':');
  if (!colons.length) return -1;
  const head = tokens[0].v === 'async' ? tokens[1]?.v : tokens[0].v;
  if (head === 'lambda') return -1;
  // `x: int = 1` is an annotation, not a block, unless the line is a header.
  if (!(tokens[0].type === 'name' && (COMPOUND.has(head) || head === 'class' || head === 'def'))) return -1;
  if (head === 'match' || head === 'case') {
    // Soft keywords: `match = 1` or `match: T = x` are ordinary statements; a
    // header has a subject before its colon and nothing after it.
    if (colons[0] < 2 || colons[0] !== tokens.length - 1) return -1;
  }
  // A lambda inside the header (`if f(lambda: 1):`) sits in brackets, so the
  // first top-level colon is the block colon.
  return colons[0];
}

function buildTree(lines) {
  const root = { children: [], indent: -1 };
  const stack = [root];
  for (const ln of lines) {
    while (stack.length > 1 && ln.indent <= stack[stack.length - 1].indent) stack.pop();
    const node = { tokens: ln.tokens, line: ln.line, indent: ln.indent, children: [] };
    stack[stack.length - 1].children.push(node);
    const colon = headerColon(ln.tokens);
    if (colon >= 0) {
      node.header = ln.tokens.slice(0, colon);
      const rest = ln.tokens.slice(colon + 1);
      if (rest.length) {
        // One-line body: `class A(B): pass`, `if x: y = 1`.
        for (const part of splitSemicolons(rest)) node.children.push({ tokens: part, line: part[0].line, indent: ln.indent + 1, children: [] });
      } else {
        stack.push(node);
      }
    }
  }
  return root.children;
}

function splitSemicolons(tokens) {
  const cuts = topLevel(tokens, t => t.type === 'op' && t.v === ';');
  const parts = [];
  let from = 0;
  for (const c of cuts) { parts.push(tokens.slice(from, c)); from = c + 1; }
  parts.push(tokens.slice(from));
  return parts.filter(p => p.length);
}

function dottedOf(tokens) {
  if (!tokens.length || tokens[0].type !== 'name') return null;
  let name = tokens[0].v;
  let k = 1;
  while (k < tokens.length) {
    if (tokens[k].type === 'op' && tokens[k].v === '.' && tokens[k + 1]?.type === 'name') { name += `.${tokens[k + 1].v}`; k += 2; }
    else return null;
  }
  return name;
}

function parseParams(tokens, d) {
  const out = [];
  for (const p of splitCommas(tokens)) {
    const q = p;
    // `*args`, `**kwargs` and the bare `*` / `/` separators are not named
    // parameters (the AST tier lists positional and keyword-only ones).
    if (q[0]?.type === 'op' && (q[0].v === '*' || q[0].v === '**' || q[0].v === '/')) continue;
    if (q[0]?.type !== 'name') continue;
    const name = q[0].v;
    const [eq] = topLevel(q, t => t.type === 'op' && t.v === '=');
    const [colon] = topLevel(q, t => t.type === 'op' && t.v === ':');
    const annEnd = eq === undefined ? q.length : eq;
    out.push({
      name,
      ann: colon !== undefined && colon < annEnd ? parseExpr(q.slice(colon + 1, annEnd), d) : null,
      default: eq !== undefined ? parseExpr(q.slice(eq + 1), d) : null,
    });
  }
  return out;
}

function docOf(children) {
  const first = children[0];
  if (!first || first.header || !first.tokens.every(t => t.type === 'str')) return '';
  const text = first.tokens.map(decodeString).join('');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return lines[0] || '';
}

function importAliases(tokens, aliases) {
  if (tokens[0].v === 'import') {
    for (const part of splitCommas(tokens.slice(1))) {
      const asAt = part.findIndex(t => t.type === 'name' && t.v === 'as');
      const mod = dottedOf(asAt >= 0 ? part.slice(0, asAt) : part);
      if (!mod) continue;
      if (asAt >= 0 && part[asAt + 1]) aliases.push({ local: part[asAt + 1].v, module: mod, name: null, level: 0 });
      else { const top = mod.split('.')[0]; aliases.push({ local: top, module: top, name: null, level: 0 }); }
    }
    return;
  }
  // from [.]*module import a [as b], ...
  const importAt = tokens.findIndex(t => t.type === 'name' && t.v === 'import');
  if (importAt < 0) return;
  let level = 0;
  let k = 1;
  while (k < importAt && tokens[k].type === 'op' && (tokens[k].v === '.' || tokens[k].v === '...')) { level += tokens[k].v.length; k++; }
  const module = k < importAt ? dottedOf(tokens.slice(k, importAt)) || '' : '';
  let names = tokens.slice(importAt + 1);
  if (names[0]?.type === 'op' && names[0].v === '(') names = names.slice(1, closing(names, 0));
  for (const part of splitCommas(names)) {
    if (part[0]?.type !== 'name') continue;
    const asAt = part.findIndex(t => t.type === 'name' && t.v === 'as');
    aliases.push({ local: asAt >= 0 && part[asAt + 1] ? part[asAt + 1].v : part[0].v, module, name: part[0].v, level });
  }
}

function simpleStatement(tokens, scope, line, d) {
  const head = tokens[0];
  if (head.type === 'name' && SKIP.has(head.v)) return null;
  const eqs = topLevel(tokens, t => t.type === 'op' && t.v === '=');
  const augs = topLevel(tokens, t => t.type === 'op' && /^(?:\+|-|\*|\/|\/\/|%|@|&|\||\^|>>|<<|\*\*)=$/.test(t.v));
  if (eqs.length || augs.length) {
    let targets = [];
    let ann = null;
    let value;
    let aug = null;
    if (augs.length) {
      const k = augs[0];
      targets = [dottedOf(tokens.slice(0, k))];
      aug = tokens[k].v === '+=' ? '+' : 'other';
      value = parseExpr(tokens.slice(k + 1), d);
    } else {
      const segs = [];
      let from = 0;
      for (const k of eqs) { segs.push(tokens.slice(from, k)); from = k + 1; }
      value = parseExpr(tokens.slice(from), d);
      for (const seg of segs) {
        const [colon] = topLevel(seg, t => t.type === 'op' && t.v === ':');
        if (colon !== undefined) {
          targets.push(dottedOf(seg.slice(0, colon)));
          ann = parseExpr(seg.slice(colon + 1), d);
        } else {
          targets.push(dottedOf(seg));
        }
      }
    }
    targets = targets.filter(Boolean);
    if (!targets.length) return null;
    if (scope === 'function' && (!value || value.t !== 'call')) return null;
    return { k: 'assign', targets, line, aug, ann, value };
  }
  const [colon] = topLevel(tokens, t => t.type === 'op' && t.v === ':');
  if (colon !== undefined) {
    const target = dottedOf(tokens.slice(0, colon));
    if (!target || scope === 'function') return null;
    return { k: 'assign', targets: [target], line, aug: null, ann: parseExpr(tokens.slice(colon + 1), d), value: null };
  }
  if (scope === 'class') return null;
  const value = parseExpr(tokens, d);
  if (!value || value.t !== 'call') return null;
  return { k: 'expr', line, value };
}

function statements(nodes, scope, aliases, depth) {
  const out = [];
  let decorators = [];
  for (const node of nodes) {
    const tokens = node.header || node.tokens;
    const head = tokens[0];
    if (head.type === 'op' && head.v === '@') {
      decorators.push(parseExpr(tokens.slice(1), 0));
      continue;
    }
    const kw = head.type === 'name' ? head.v : null;
    const isAsync = kw === 'async' && tokens[1]?.type === 'name';
    const word = isAsync ? tokens[1].v : kw;
    if (word === 'class' && node.header) {
      const name = tokens[1]?.v;
      let bases = [];
      let keywords = {};
      if (tokens[2]?.type === 'op' && tokens[2].v === '(') {
        const r = callArgs(tokens.slice(3, closing(tokens, 2)), 0);
        bases = r.args;
        keywords = r.kw;
      }
      if (name) {
        out.push({
          k: 'class', name, line: node.line, bases, keywords, decorators,
          body: depth < 4 ? statements(node.children, 'class', aliases, depth + 1) : [],
        });
      }
      decorators = [];
      continue;
    }
    if (word === 'def' && node.header) {
      const at = isAsync ? 1 : 0;
      const name = tokens[at + 1]?.v;
      const open = at + 2;
      let params = [];
      if (tokens[open]?.type === 'op' && tokens[open].v === '(') params = parseParams(tokens.slice(open + 1, closing(tokens, open)), 0);
      if (name) {
        out.push({
          k: 'def', name, line: node.line, decorators, params, doc: docOf(node.children),
          body: depth < 4 ? statements(node.children, 'function', aliases, depth + 1) : [],
        });
      }
      decorators = [];
      continue;
    }
    decorators = [];
    if (node.header && (COMPOUND.has(word) || isAsync)) {
      out.push(...statements(node.children, scope, aliases, depth));
      continue;
    }
    if (kw === 'import' || kw === 'from') {
      importAliases(node.tokens, aliases);
      continue;
    }
    for (const part of splitSemicolons(node.tokens)) {
      if (part[0].type === 'name' && (part[0].v === 'import' || part[0].v === 'from')) { importAliases(part, aliases); continue; }
      const stmt = simpleStatement(part, scope, part[0].line, 0);
      if (stmt) out.push(stmt);
    }
  }
  return out;
}

/**
 * The pattern-tier outline of one module.
 * @returns {{aliases: object[], body: object[]}}
 */
export function outlineFromSource(source) {
  const aliases = [];
  const body = statements(buildTree(logicalLines(source)), 'module', aliases, 0);
  return { aliases, body };
}

// ── Module index and name resolution ────────────────────────────────────────

/**
 * Resolve dotted module names, imports and module-level names across a set of
 * outlines. A module resolves by its full dotted path from the project root,
 * or by a dotted suffix that exactly one file has (a `src/` layout); a suffix
 * two files share does not resolve.
 */
export class PythonIndex {
  constructor(dir, byFile) {
    this.dir = dir;
    this.byFile = byFile;
    this.modules = new Map(); // dotted → file
    this.info = new Map(); // file → { module, isPackage }
    this._suffix = new Map();
    for (const file of byFile.keys()) {
      const rel = relative(dir, file).replace(/\\/g, '/').replace(/\.py$/, '');
      const parts = rel.split('/');
      const isPackage = parts[parts.length - 1] === '__init__';
      if (isPackage) parts.pop();
      const module = parts.join('.');
      this.info.set(file, { module, isPackage });
      if (module) this.modules.set(module, file);
    }
  }

  outline(file) {
    return this.byFile.get(file)?.outline || null;
  }

  /** The file of a dotted module name, or null (external or ambiguous). */
  moduleFile(name) {
    if (!name) return null;
    if (this.modules.has(name)) return this.modules.get(name);
    if (this._suffix.has(name)) return this._suffix.get(name);
    const hits = [];
    for (const [mod, file] of this.modules) if (mod.endsWith(`.${name}`)) hits.push(file);
    const found = hits.length === 1 ? hits[0] : null;
    this._suffix.set(name, found);
    return found;
  }

  /** The absolute dotted module an import names, from `file`. */
  absoluteModule(file, module, level) {
    if (!level) return module;
    const { module: mod, isPackage } = this.info.get(file) || { module: '', isPackage: false };
    const pkg = mod ? mod.split('.') : [];
    if (!isPackage) pkg.pop();
    const keep = pkg.length - (level - 1);
    if (keep < 0) return null;
    return [...pkg.slice(0, keep), ...(module ? [module] : [])].join('.');
  }

  /** Module-level statements that assign `name` in `file`, last one first. */
  assignment(file, name) {
    const body = this.outline(file)?.body || [];
    for (let k = body.length - 1; k >= 0; k--) {
      const s = body[k];
      if (s.k === 'assign' && !s.aug && s.targets.includes(name)) return s;
    }
    return null;
  }

  definition(file, name) {
    const body = this.outline(file)?.body || [];
    for (let k = body.length - 1; k >= 0; k--) {
      const s = body[k];
      if ((s.k === 'class' || s.k === 'def') && s.name === name) return s;
    }
    return null;
  }

  /**
   * What a name bound at module level in `file` refers to.
   * @returns {{kind:'module', file}|{kind:'assign'|'class'|'def', file, stmt}|{kind:'external', module, name}|null}
   */
  resolveName(file, name, seen = 0) {
    if (seen > 8) return null;
    const def = this.definition(file, name);
    const asg = this.assignment(file, name);
    const local = def && asg ? (def.line > asg.line ? def : asg) : def || asg;
    if (local) return { kind: local.k === 'assign' ? 'assign' : local.k, file, stmt: local };
    const aliases = this.outline(file)?.aliases || [];
    const alias = [...aliases].reverse().find(a => a.local === name);
    if (!alias) return null;
    const base = this.absoluteModule(file, alias.module, alias.level);
    if (base === null) return null;
    if (alias.name === null) {
      const target = this.moduleFile(alias.module);
      return target ? { kind: 'module', file: target, module: alias.module } : { kind: 'external', module: alias.module, name: null };
    }
    const sub = this.moduleFile(base ? `${base}.${alias.name}` : alias.name);
    if (sub) return { kind: 'module', file: sub, module: base ? `${base}.${alias.name}` : alias.name };
    const owner = this.moduleFile(base);
    if (owner && owner !== file) {
      const inner = this.resolveName(owner, alias.name, seen + 1);
      if (inner) return inner;
    }
    return { kind: 'external', module: base, name: alias.name };
  }

  /**
   * Resolve a dotted reference (`users.router`, `views.PostViewSet`) from
   * `file`. Attribute access past a non-module binding is returned in `rest`.
   */
  resolveRef(file, dotted) {
    const parts = String(dotted).split('.');
    let binding = this.resolveName(file, parts[0]);
    let k = 1;
    while (binding && k < parts.length) {
      if (binding.kind === 'module') {
        const subName = `${binding.module}.${parts[k]}`;
        const sub = this.moduleFile(subName) || (this.info.get(binding.file) ? this.moduleFile(`${this.info.get(binding.file).module}.${parts[k]}`) : null);
        if (sub) binding = { kind: 'module', file: sub, module: this.info.get(sub).module };
        else binding = this.resolveName(binding.file, parts[k]);
        k++;
      } else if (binding.kind === 'external') {
        binding = { kind: 'external', module: binding.module, name: [binding.name, ...parts.slice(k)].filter(Boolean).join('.') };
        k = parts.length;
      } else {
        return { ...binding, rest: parts.slice(k) };
      }
    }
    return binding ? { ...binding, rest: [] } : null;
  }
}

/** Last dotted segment of a reference expression, or null. */
export function refTail(expr) {
  if (!expr) return null;
  if (expr.t === 'ref') return expr.v.split('.').pop();
  if (expr.t === 'attr') return expr.attr;
  return null;
}

/** A readable rendering of an outline expression, for messages. */
export function exprText(expr) {
  if (!expr) return '';
  switch (expr.t) {
    case 'str': return JSON.stringify(expr.v);
    case 'fstr': return `f"${expr.parts.map(p => (p?.t === 'str' ? p.v : `{${exprText(p)}}`)).join('')}"`;
    case 'num': return String(expr.v);
    case 'const': return expr.v === null ? 'None' : expr.v === true ? 'True' : expr.v === false ? 'False' : String(expr.v);
    case 'ref': return expr.v;
    case 'attr': return `${exprText(expr.value)}.${expr.attr}`;
    case 'call': return `${exprText(expr.fn)}(${[...expr.args.map(exprText), ...Object.entries(expr.kw || {}).map(([k, v]) => `${k}=${exprText(v)}`)].join(', ')})`;
    case 'list': return `[${expr.items.map(exprText).join(', ')}]`;
    case 'dict': return '{…}';
    case 'sub': return `${exprText(expr.value)}[${expr.index.map(exprText).join(', ')}]`;
    case 'bin': return `${exprText(expr.l)} ${expr.op} ${exprText(expr.r)}`;
    default: return '…';
  }
}

/**
 * Evaluate an outline expression to a string: literals, f-strings, `+`,
 * module constants and class attribute defaults (`settings.API_V1_STR` when
 * `settings = Settings()`). Returns null when any part is unknown.
 */
export function evalString(index, file, expr, depth = 0) {
  if (!expr || depth > 12) return null;
  switch (expr.t) {
    case 'str': return expr.v;
    case 'fstr': {
      let s = '';
      for (const p of expr.parts) { const v = evalString(index, file, p, depth + 1); if (v === null) return null; s += v; }
      return s;
    }
    case 'bin': {
      if (expr.op !== '+') return null;
      const l = evalString(index, file, expr.l, depth + 1);
      const r = l === null ? null : evalString(index, file, expr.r, depth + 1);
      return l === null || r === null ? null : l + r;
    }
    case 'ref': {
      const b = index.resolveRef(file, expr.v);
      return b ? evalBinding(index, b, depth + 1) : null;
    }
    default: return null;
  }
}

function evalBinding(index, b, depth) {
  if (b.kind === 'assign') {
    if (b.rest.length === 0) return evalString(index, b.file, b.stmt.value, depth);
    // `settings.X` where `settings = Settings(...)`: the class attribute default.
    const v = b.stmt.value;
    if (v?.t !== 'call' || v.fn?.t !== 'ref' || b.rest.length !== 1) return null;
    const cls = index.resolveRef(b.file, v.fn.v);
    return cls?.kind === 'class' && cls.rest.length === 0 ? classAttr(index, cls, b.rest[0], depth) : null;
  }
  if (b.kind === 'class' && b.rest.length === 1) return classAttr(index, b, b.rest[0], depth);
  return null;
}

function classAttr(index, cls, name, depth) {
  for (const s of cls.stmt.body || []) {
    if (s.k === 'assign' && s.targets.includes(name) && s.value) return evalString(index, cls.file, s.value, depth + 1);
  }
  return null;
}


/** Python files under `dir`, skipping ignored and dot directories. */
export function findPythonFiles(dir, maxDepth = 12) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > maxDepth || !existsSync(d)) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith('.py')) out.push(full);
    }
  };
  walk(dir, 0);
  return out.sort();
}
