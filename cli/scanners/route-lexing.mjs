/**
 * Lexing shared by the Go and Spring route readers.
 *
 * DocGuard has no Go, Java or Kotlin parser. These readers still need three
 * things a line regex cannot give them: comments must not count, a string
 * must not be mistaken for code (a `{` or `//` inside `"http://…"`), and
 * brackets must pair so a call's arguments and a block's extent are known.
 * `lexCLike` masks comments and string bodies without moving any offset;
 * `matchPairs` pairs the brackets that remain.
 *
 * @implements docguard.go-spring-rails-routes#FR-002
 * @implements docguard.go-spring-rails-routes#FR-004
 */

/** Stands in for every character inside a string literal in the masked code. */
export const STRING_FILL = '\u0001';

/**
 * Mask comments and string bodies in C-family source, keeping every offset.
 *
 * In the returned `code`, a comment becomes spaces (newlines kept) and a
 * string literal becomes `"` + STRING_FILL… + `"`, so no regex over `code` can
 * match inside either. `lits` maps the offset of each literal's opening quote
 * to `{ value, end }`: `value` is the decoded text, or `null` when the literal
 * is a template (`"$x/…"` in Kotlin) whose text is not known.
 *
 * @param {string} src
 * @param {object} [opts]
 * @param {boolean} [opts.backtickRaw]    Go raw strings (`` `…` ``)
 * @param {boolean} [opts.tripleQuote]    Java text blocks / Kotlin raw strings (`"""…"""`)
 * @param {boolean} [opts.nestedComments] Kotlin block comments nest
 * @param {boolean} [opts.templates]      Kotlin `$name` / `${…}` makes a literal unknown
 * @returns {{ code: string, lits: Map<number, { value: string|null, end: number }> }}
 */
export function lexCLike(src, { backtickRaw = false, tripleQuote = false, nestedComments = false, templates = false } = {}) {
  const n = src.length;
  const out = src.split('');
  const lits = new Map();
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const literal = (start, end, value) => {
    out[start] = '"';
    for (let k = start + 1; k < end - 1; k++) out[k] = STRING_FILL;
    out[end - 1] = '"';
    lits.set(start, { value, end });
  };
  const isTemplate = raw => templates && /(^|[^\\])\$(\{|[A-Za-z_])/.test(raw);
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
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; }
        else if (nestedComments && src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; }
        else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (tripleQuote && src.startsWith('"""', i)) {
      const close = src.indexOf('"""', i + 3);
      const end = close < 0 ? n : close + 3;
      const raw = src.slice(i + 3, close < 0 ? n : close);
      literal(i, end, isTemplate(raw) ? null : raw);
      i = end;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\' && j + 1 < n) {
          const e = src[j + 1];
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
        } else {
          value += src[j];
          j++;
        }
      }
      const end = Math.min(n, j + 1);
      const raw = src.slice(i + 1, j);
      literal(i, end, isTemplate(raw) ? null : value);
      i = end;
      continue;
    }
    if (backtickRaw && c === '`') {
      const close = src.indexOf('`', i + 1);
      const end = close < 0 ? n : close + 1;
      literal(i, end, src.slice(i + 1, close < 0 ? n : close));
      i = end;
      continue;
    }
    if (c === "'") {
      // A rune / char literal: short, may escape its quote. Mask it so a `'{'`
      // cannot unbalance the braces.
      const m = /^'(?:\\.[^'\n]{0,8}|[^'\\\n])'/.exec(src.slice(i, i + 12));
      if (m) {
        for (let k = i; k < i + m[0].length; k++) out[k] = STRING_FILL;
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return { code: out.join(''), lits };
}

/**
 * Pair the brackets of masked code. Returns a Map from each `(`, `[`, `{` to
 * its closer and from each closer back to its opener. An unbalanced bracket
 * is left unpaired.
 * @param {string} code
 * @returns {Map<number, number>}
 */
export function matchPairs(code) {
  const pairs = new Map();
  const stack = [];
  const opener = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') stack.push(i);
    else if (c === ')' || c === ']' || c === '}') {
      // Pop to the nearest matching opener; skip a stray closer.
      for (let k = stack.length - 1; k >= 0; k--) {
        if (code[stack[k]] === opener[c]) {
          const open = stack[k];
          stack.length = k;
          pairs.set(open, i);
          pairs.set(i, open);
          break;
        }
      }
    }
  }
  return pairs;
}

/** Shrink `[s, e)` past surrounding whitespace. */
export function trimRange(code, s, e) {
  while (s < e && /\s/.test(code[s])) s++;
  while (e > s && /\s/.test(code[e - 1])) e--;
  return [s, e];
}

/**
 * Split `[s, e)` at depth-0 occurrences of `sep`, jumping over paired brackets.
 * Returns trimmed ranges; an empty input yields no ranges.
 */
export function splitTopLevel(code, pairs, s, e, sep = ',') {
  const parts = [];
  let start = s;
  for (let i = s; i < e; i++) {
    const c = code[i];
    if ((c === '(' || c === '[' || c === '{') && pairs.has(i) && pairs.get(i) < e) { i = pairs.get(i); continue; }
    if (c === sep) { parts.push(trimRange(code, start, i)); start = i + 1; }
  }
  const last = trimRange(code, start, e);
  if (last[1] > last[0] || parts.length) parts.push(last);
  return parts.filter(([a, b]) => b > a);
}

/** The decoded string when `[s, e)` is exactly one literal; `undefined` when it is not a literal, `null` when it is a template. */
export function literalIn(code, lits, s, e) {
  [s, e] = trimRange(code, s, e);
  const lit = lits.get(s);
  if (!lit || lit.end !== e) return undefined;
  return lit.value;
}

/** Join a route prefix and a path into one `/a/b` path (`''` stays `''`). */
export function joinRoutePath(prefix, p) {
  if (!prefix) return p;
  const left = prefix.replace(/\/+$/, '');
  const right = (p === '/' || p === '') ? '' : ('/' + p.replace(/^\/+/, ''));
  return (left + right) || '/';
}
