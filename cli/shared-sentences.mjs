/**
 * Sentence reader: the line-aware view of a document's prose (spec 105).
 *
 * Doc-Quality's own prose extraction joins lines and drops their numbers, so it
 * cannot say where a long sentence starts. This leaf module reads Markdown by
 * line and returns each sentence with the line it starts on, its word count and
 * whether it sits inside a numbered step, and lists the numbered steps with the
 * first word of each. It reads text only: no file access, no process, no
 * imports. Every scan is linear in the size of the input (no regular expression
 * that can backtrack on a long run), because it is fuzzed.
 *
 * Not prose, and so never counted: fenced code (``` and ~~~), indented code,
 * tables, headings, HTML comments (also across lines), YAML front matter, image
 * lines, HTML-tag lines and horizontal rules.
 *
 * A word is a whitespace-separated token that holds a letter or a digit. An
 * inline code span is one word; a link counts the words of its text, not its
 * destination; an inline image counts nothing.
 *
 * A sentence ends where `splitSentences` of doc-quality.mjs ends it: after
 * `.`, `!` or `?` at the end of a token, except in a dotted file name, a
 * version number, a URL, an abbreviation (Dr., vs., etc.), e.g./i.e., a
 * name such as Node.js and a decimal. Those protections are copied here, not
 * imported, so the older function stays private and unchanged. With `unicode`
 * the full-width and Arabic marks end a sentence too.
 *
 * @implements docguard.glossary-and-plain-writing#FR-021
 * @implements docguard.glossary-and-plain-writing#FR-023
 */

/** A token longer than this is one word with no sentence-end protection work (bounded time). */
const LONG_TOKEN = 256;
/** The marks that end a sentence in a document in another language, spec 104. */
const WIDE_MARKS = /(?<=[。！？؟])/u;
const ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'vs', 'etc', 'approx', 'incl'].map(a => new RegExp(`\\b${a}\\.`, 'gi'));
const ORDERED_ITEM = /^(\s*)(\d{1,9})([.)])(?:\s+(.*))?$/;
const BULLET_ITEM = /^(\s*)([-*+])\s+(.*)$/;

/** Leading whitespace width, a tab counting four. */
function indentOf(line) {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32) width++;
    else if (c === 9) width += 4;
    else break;
  }
  return width;
}

/** `next[i]` is the smallest index at or after i holding `ch`, or -1. Built once so a scan never repeats. */
function nextIndexTable(s, ch) {
  const next = new Int32Array(s.length + 2).fill(-1);
  for (let i = s.length - 1; i >= 0; i--) next[i] = s[i] === ch ? i : next[i + 1];
  return next;
}

/** Remove inline HTML comments (`<!-- ... -->`) from one line; reports a comment left open at the end of the line. */
function stripComments(line, inComment) {
  let out = '';
  let pos = 0;
  let open = inComment;
  while (pos < line.length) {
    if (open) {
      const end = line.indexOf('-->', pos);
      if (end < 0) return { text: out, open: true };
      pos = end + 3;
      open = false;
      out += ' ';
      continue;
    }
    const start = line.indexOf('<!--', pos);
    if (start < 0) { out += line.slice(pos); break; }
    out += line.slice(pos, start);
    pos = start + 4;
    open = true;
  }
  return { text: out, open };
}

/** Replace each inline code span by one word, `CODE`. A span opens and closes with a backtick run of the same length. */
function collapseCodeSpans(line) {
  if (!line.includes('`')) return line;
  const runs = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '`') continue;
    let j = i;
    while (j < line.length && line[j] === '`') j++;
    runs.push({ start: i, end: j, len: j - i });
    i = j - 1;
  }
  const nextSame = new Array(runs.length).fill(-1);
  const seen = new Map();
  for (let k = runs.length - 1; k >= 0; k--) {
    nextSame[k] = seen.has(runs[k].len) ? seen.get(runs[k].len) : -1;
    seen.set(runs[k].len, k);
  }
  let out = '';
  let pos = 0;
  for (let k = 0; k < runs.length;) {
    const close = nextSame[k];
    if (close < 0) { k++; continue; }
    out += line.slice(pos, runs[k].start) + 'CODE';
    pos = runs[close].end;
    k = close + 1;
  }
  return out + line.slice(pos);
}

/** Drop inline images and reduce each link `[text](destination)` to its text. */
function reduceLinks(line) {
  if (!line.includes('](')) return line;
  const close = nextIndexTable(line, ']');
  const paren = nextIndexTable(line, ')');
  const parts = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '!' && line[i + 1] === '[') {
      const j = close[i + 2];
      if (j >= 0 && line[j + 1] === '(') {
        const k = paren[j + 2];
        if (k >= 0) { i = k; continue; }
      }
    } else if (c === '[') {
      const j = close[i + 1];
      if (j >= 0 && line[j + 1] === '(') {
        const k = paren[j + 2];
        if (k >= 0) { parts.push(line.slice(i + 1, j)); i = k; continue; }
      }
    }
    parts.push(c);
  }
  return parts.join('');
}

/** The text of a line as words see it: code spans and links reduced. */
function inlineText(line) {
  return reduceLinks(collapseCodeSpans(line));
}

/** How many of the last characters of a token are `.`, `!` or `?`. */
function trailingTerminals(token) {
  let n = 0;
  while (n < token.length && '.!?'.includes(token[token.length - 1 - n])) n++;
  return n;
}

/**
 * Dotted file names (package.json, .env.local): a run of word characters, dots and hyphens that ends in a dot and one to
 * four letters, at the end of the token or before one of `,;:)]|`. Same match as the pattern in `splitSentences`, read
 * run by run so the work stays linear.
 */
function protectFileNames(token) {
  return token.replace(/[\w.-]+/g, (run, offset) => {
    const after = token[offset + run.length];
    if (after !== undefined && !',;:)]|'.includes(after)) return run;
    const dot = run.lastIndexOf('.');
    if (dot < 1 || run.length - dot - 1 < 1 || run.length - dot - 1 > 4 || !/^[a-z]+$/i.test(run.slice(dot + 1))) return run;
    return run.replace(/\./g, '≈');
  });
}

/** A token with the dots that do not end a sentence turned into a placeholder, as `splitSentences` does. */
function protectToken(token) {
  if (token.length > LONG_TOKEN) {
    const tail = trailingTerminals(token);
    return token.slice(0, token.length - tail).replace(/\./g, '≈') + token.slice(token.length - tail);
  }
  let t = token;
  t = protectFileNames(t);
  t = t.replace(/\bv?\d+\.\d+(?:\.\d+)*\b/g, m => m.replace(/\./g, '≈'));
  t = t.replace(/https?:\/\/[^\s)]+/g, m => m.replace(/\./g, '≈'));
  for (const abbr of ABBREVIATIONS) t = t.replace(abbr, m => m.replace(/\./g, '≈'));
  t = t.replace(/\be\.g\./gi, 'e≈g≈');
  t = t.replace(/\bi\.e\./gi, 'i≈e≈');
  t = t.replace(/\b(\w+)\.js\b/gi, '$1≈js');
  t = t.replace(/(\d)\.(\d)/g, '$1≈$2');
  return t;
}

const WORD = /[\p{L}\p{N}]/u;

/** Sentences of one paragraph: tokens carry their line, and a sentence reports the line of its first word. */
function paragraphSentences(paragraph, unicode, step) {
  const out = [];
  let words = 0;
  let firstLine = 0;
  const end = () => {
    if (words > 0) out.push({ line: firstLine, words, step });
    words = 0;
    firstLine = 0;
  };
  for (const { n, text } of paragraph.lines) {
    for (const token of text.split(/\s+/)) {
      if (!token) continue;
      const protectedToken = protectToken(token);
      const pieces = unicode ? protectedToken.split(WIDE_MARKS) : [protectedToken];
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p];
        if (!piece) continue;
        if (WORD.test(piece)) {
          if (words === 0) firstLine = n;
          words++;
        }
        const last = p === pieces.length - 1;
        const wide = unicode && /[。！？؟]$/u.test(piece);
        if (wide || (last && trailingTerminals(piece) > 0)) end();
      }
    }
  }
  end();
  return out;
}

/** A row of a table's separator line: dashes, colons, pipes and spaces, with a pipe. */
function isSeparatorRow(line) {
  const t = line.trim();
  if (!t.includes('|') || !t.includes('-')) return false;
  for (let i = 0; i < t.length; i++) if (!'|:- \t'.includes(t[i])) return false;
  return true;
}

/**
 * Read the document into paragraphs (each with its lines and numbers) and the ordered lists found.
 * A paragraph belongs to the ordered list it sits in, if any; a list is a step list from two items.
 */
function scan(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const paragraphs = [];
  const lists = [];
  let stack = [];
  let cur = null;
  let fence = null;
  let inComment = false;
  let inTable = false;
  let prevBlank = true;
  let prevCode = false;

  let frontEnd = -1;
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === '---' || t === '...') { frontEnd = j; break; }
    }
  }

  const startParagraph = (n, content, list) => {
    cur = { lines: [{ n, text: content }], list };
    paragraphs.push(cur);
  };

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    if (i <= frontEnd) continue;
    const original = lines[i];
    const wasBlank = original.trim() === '';

    if (fence) {
      const t = original.trimStart();
      if (t[0] === fence.ch) {
        let run = 0;
        while (run < t.length && t[run] === fence.ch) run++;
        if (run >= fence.len && t.slice(run).trim() === '') { fence = null; prevBlank = true; }
      }
      continue;
    }

    const stripped = stripComments(original, inComment);
    inComment = stripped.open;
    const raw = stripped.text;
    const commentOnly = !wasBlank && raw.trim() === '';
    if (commentOnly) continue;
    if (raw.trim() === '') { cur = null; prevBlank = true; prevCode = false; inTable = false; continue; }

    const indent = indentOf(raw);
    const trimmed = raw.trim();

    const fenceOpen = indent < 4 || stack.length > 0 ? /^(`{3,}|~{3,})/.exec(trimmed) : null;
    if (fenceOpen) {
      fence = { ch: fenceOpen[1][0], len: fenceOpen[1].length };
      cur = null;
      prevCode = false;
      continue;
    }
    if (indent >= 4 && (prevBlank || prevCode) && stack.length === 0) { cur = null; prevCode = true; continue; }
    prevCode = false;

    if (indent < 4 && /^#{1,6}(?:\s|$)/.test(trimmed)) { cur = null; stack = []; prevBlank = true; continue; }
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) { cur = null; prevBlank = true; continue; }

    const next = i + 1 < lines.length ? lines[i + 1] : '';
    if (trimmed[0] === '|' || (inTable && trimmed.includes('|')) || (trimmed.includes('|') && isSeparatorRow(next))) {
      cur = null; inTable = true; prevBlank = false; continue;
    }
    inTable = false;
    if (trimmed.startsWith('![') || /^<\/?[A-Za-z][^>]*>/.test(trimmed)) { cur = null; prevBlank = false; continue; }

    // A block quote is someone else's words or a metadata note (`> **Reference**: ...`), not the
    // author's sentence: not prose, as for the glossary (spec 105 FR-009, FR-021).
    if (trimmed[0] === '>') { cur = null; prevBlank = false; continue; }
    const body = raw;

    const ordered = ORDERED_ITEM.exec(body);
    const bullet = !ordered ? BULLET_ITEM.exec(body) : null;
    prevBlank = false;

    if (ordered) {
      const itemIndent = indentOf(ordered[1]);
      while (stack.length && stack[stack.length - 1].indent > itemIndent + 1) stack.pop();
      let entry = stack[stack.length - 1];
      if (!entry || Math.abs(entry.indent - itemIndent) > 1) {
        entry = { indent: itemIndent, list: { items: [] } };
        stack.push(entry);
        lists.push(entry.list);
      }
      const content = ordered[4] ?? '';
      entry.list.items.push({ line: n, text: content });
      startParagraph(n, content, entry.list);
      continue;
    }
    if (bullet) {
      const itemIndent = indentOf(bullet[1]);
      while (stack.length && stack[stack.length - 1].indent >= itemIndent) stack.pop();
      startParagraph(n, bullet[3], stack.length ? stack[stack.length - 1].list : null);
      continue;
    }
    if (cur) { cur.lines.push({ n, text: body.trim() }); continue; }
    if (indent === 0) stack = [];
    startParagraph(n, body.trim(), stack.length ? stack[stack.length - 1].list : null);
  }
  return { paragraphs, lists };
}

/**
 * The sentences of the prose of a document: `{ line, words, step }[]`. `line` is the
 * 1-based line the sentence starts on; `step` is true inside a numbered step.
 * Never throws; the same text gives the same answer.
 */
export function proseSentences(text, { unicode = false } = {}) {
  const { paragraphs } = scan(text);
  const out = [];
  for (const paragraph of paragraphs) {
    const step = Boolean(paragraph.list && paragraph.list.items.length >= 2);
    const cleaned = { lines: paragraph.lines.map(l => ({ n: l.n, text: inlineText(l.text) })) };
    for (const s of paragraphSentences(cleaned, unicode, step)) out.push(s);
  }
  return out;
}

/** The first word of a step: emphasis and a leading `Step N:` label removed; null when it is code, a link or not a letter. */
function stepFirstWord(content) {
  let t = content.trimStart();
  const strip = () => { t = t.replace(/^[*_~\s]+/, ''); };
  strip();
  const label = /^step\s+\d{1,9}\s*[:.)\-–—]*/i.exec(t);
  if (label) { t = t.slice(label[0].length); strip(); }
  const word = /^\p{L}[\p{L}\p{M}'’]*/u.exec(t);
  return word ? word[0] : null;
}

/**
 * The numbered steps of a document: `{ line, firstWord }[]`, the items of every ordered list
 * (`1.` or `1)`) that has two or more items, in order. `firstWord` is null when the step
 * starts with inline code, a link or a character that is not a letter.
 */
export function numberedSteps(text) {
  const { lists } = scan(text);
  const out = [];
  for (const list of lists) {
    if (list.items.length < 2) continue;
    for (const item of list.items) out.push({ line: item.line, firstWord: stepFirstWord(item.text) });
  }
  return out.sort((a, b) => a.line - b.line);
}
