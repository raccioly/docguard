/**
 * Frontmatter subset reader — the part of YAML that agent instruction files
 * use for their scope fields (docguard.path-scoped-rules#FR-001).
 *
 * Supported, per top-level key: plain scalars, single- and double-quoted
 * strings, `true`/`false`, flow lists of scalars (`[a, "b"]`) and block lists
 * (`- a`). Anything else is reported per key instead of guessed, so a caller
 * reading a scope field can say "unknown" rather than "matches nothing".
 * Keys the caller does not read (a skill's nested `metadata:` block, say)
 * carry their issue but never block the keys that parsed.
 *
 * Zero dependencies. A YAML package would read more, but a scope field that
 * only one parser accepts is itself the bug worth reporting.
 */

const KEY_RE = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*?))?\s*$/;
// A plain scalar may not start with a YAML indicator: `*` is an alias, `&` an
// anchor, `!` a tag, `@` and backtick are reserved, `%` a directive, `|`/`>`
// block scalars, `{` a flow mapping.
const INDICATOR_RE = /^[*&!@`%|>{]/;

/**
 * @returns {{ present: boolean, data: Record<string, any>, lines: Record<string, number>,
 *   issues: { key: string|null, line: number, message: string, fix?: string }[], bodyStart: number }}
 *   `bodyStart` is the 0-based line index where the body begins.
 */
export function readFrontmatter(content) {
  const lines = String(content).replace(/^﻿/, '').split(/\r?\n/);
  const empty = { present: false, data: {}, lines: {}, issues: [], bodyStart: 0 };
  if (lines[0] !== '---') return empty;
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    return { ...empty, present: true, issues: [{ key: null, line: 1, message: 'frontmatter opens with --- but never closes' }] };
  }
  const data = {};
  const at = {};
  const issues = [];
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const m = raw.match(KEY_RE);
    if (!m || /^\s/.test(raw)) {
      issues.push({ key: null, line: i + 1, message: `unsupported frontmatter line: ${raw.trim().slice(0, 60)}` });
      continue;
    }
    const [, key, rest = ''] = m;
    at[key] = i + 1;
    if (Object.hasOwn(data, key)) issues.push({ key, line: i + 1, message: `duplicate key ${key}` });
    if (rest === '') {
      // A block list, a nested mapping, or an empty value.
      const items = [];
      let j = i + 1;
      let nested = false;
      for (; j < end && (/^\s/.test(lines[j]) || !lines[j].trim()); j++) {
        const item = lines[j].match(/^\s+-\s+(.*?)\s*$/);
        if (item) {
          const value = scalar(item[1]);
          if (value.error) issues.push({ key, line: j + 1, message: value.error, fix: value.fix });
          else items.push(value.value);
        } else if (lines[j].trim() && !/^\s*#/.test(lines[j])) nested = true;
      }
      if (nested) issues.push({ key, line: i + 1, message: `${key} holds a nested mapping, which this reader does not interpret` });
      else data[key] = items.length ? items : null;
      i = j - 1;
      continue;
    }
    if (rest.startsWith('[')) {
      const list = flowList(rest);
      if (list.error) issues.push({ key, line: i + 1, message: list.error });
      else data[key] = list.value;
      continue;
    }
    // A plain scalar may continue on indented lines (YAML folds them with a
    // space), as long skill descriptions do.
    let text = rest;
    let j = i + 1;
    for (; j < end && /^\s+\S/.test(lines[j]) && !/^\s+-\s/.test(lines[j]); j++) text += ` ${lines[j].trim()}`;
    if (j > i + 1 && /^["'\[]/.test(rest)) {
      issues.push({ key, line: i + 1, message: `${key} continues a quoted or flow value over several lines, which this reader does not interpret` });
      i = j - 1;
      continue;
    }
    i = j - 1;
    const value = scalar(text);
    if (value.error) issues.push({ key, line: at[key], message: value.error, fix: value.fix });
    else data[key] = value.value;
  }
  return { present: true, data, lines: at, issues, bodyStart: end + 1 };
}

function scalar(text) {
  const t = text.trim();
  if (t.startsWith('"')) {
    const m = t.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
    if (!m) return { error: `unterminated or trailing text after a double-quoted string: ${t.slice(0, 40)}` };
    return { value: m[1].replace(/\\(["\\/])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t') };
  }
  if (t.startsWith("'")) {
    const m = t.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
    if (!m) return { error: `unterminated or trailing text after a single-quoted string: ${t.slice(0, 40)}` };
    return { value: m[1].replace(/''/g, "'") };
  }
  if (INDICATOR_RE.test(t)) {
    return {
      error: `unquoted value starts with "${t[0]}", which YAML reads as ${t[0] === '*' ? 'an alias' : 'syntax'}, not text: ${t.slice(0, 40)}`,
      fix: `quote it: "${t.replace(/\s+#.*$/, '').replace(/"/g, '\\"')}"`,
    };
  }
  const plain = t.replace(/\s+#.*$/, '');
  if (plain === 'true') return { value: true };
  if (plain === 'false') return { value: false };
  return { value: plain };
}

function flowList(text) {
  const t = text.trim().replace(/\s+#.*$/, '');
  if (!t.endsWith(']')) return { error: `flow list does not close on its line: ${t.slice(0, 40)}` };
  const inner = t.slice(1, -1).trim();
  if (!inner) return { value: [] };
  const items = [];
  let current = '';
  let quote = null;
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (quote) {
      current += ch;
      if (ch === quote && inner[k - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '[' || ch === '{') {
      return { error: 'nested flow collections are not supported' };
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else current += ch;
  }
  if (quote) return { error: 'unterminated quote in flow list' };
  items.push(current);
  const values = [];
  for (const item of items) {
    const value = scalar(item);
    if (value.error) return { error: value.error };
    values.push(value.value);
  }
  return { value: values };
}
