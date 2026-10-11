/**
 * Requirement tags in source code, and what each one anchors to.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 * Contract: specs/070-requirement-anchors/contracts/tag-grammar.md.
 *
 * A tag is `@implements <specId|path>#<REQ>` or `@req <REQ>` inside a
 * COMMENT, never inside a string, template or regex literal (FR-005). Where it
 * sits decides what it anchors to (FR-002):
 *
 *   - the file's leading comment block, followed by imports or another
 *     comment: the whole file;
 *   - directly above a declaration (decorators and annotations may sit
 *     between, no blank line): that symbol, by qualified path (FR-003);
 *   - a leading header directly above a declaration: still the file, flagged
 *     ambiguous (ANC006), never silently reinterpreted;
 *   - inside a function body, or above any other top-level statement: that
 *     statement; above a recognised route registration: the route;
 *   - inside a Python docstring: the docstring's owner.
 *
 * Three tiers resolve positions: Babel for JS/TS, one batched `python3` run
 * for Python (py-anchors.mjs), and the self-checking pattern lexer for every
 * other language (pattern-lexer.mjs). A file the pattern lexer cannot balance
 * keeps every tag at file scope with the reason (FR-008); a language with no
 * lexer at all is file tier. Each anchor carries an exact fingerprint (the
 * resolving tier's) and a floor fingerprint (the pattern lexer's, computed
 * for every language so any two machines can compare; FR-011).
 *
 * @implements docguard.requirement-anchors#FR-001
 * @implements docguard.requirement-anchors#FR-002
 * @implements docguard.requirement-anchors#FR-003
 * @implements docguard.requirement-anchors#FR-004
 * @implements docguard.requirement-anchors#FR-005
 * @implements docguard.requirement-anchors#FR-007
 * @implements docguard.requirement-anchors#FR-008
 */

import { BABEL_TIER, DIRECTIVE_RE, dg1, jsFingerprintV1, pyFingerprintV1 } from './fingerprint.mjs';
import { extractJsRouteCalls, parseJsTs } from './js-ast.mjs';
import { PATTERN_TIER, floorFingerprint, languageOf, lex, outline, statementSpan } from './pattern-lexer.mjs';

export const SCOPES = Object.freeze(['file', 'symbol', 'statement', 'route']);
export const FILE_TIER = 'file';
const LOW_CONFIDENCE_LANGS = new Set(['c', 'cpp']);
const AST_KEYS_SKIP = new Set(['loc', 'start', 'end', 'range', 'extra', 'comments', 'leadingComments',
  'trailingComments', 'innerComments', 'tokens', 'errors']);

// Shapes: `@implements <specId>#<REQ>`, `@req <REQ>, <REQ>`, `@implements <specId>#<REQ> {scope=symbol}`
const TAG_RE = /@(implements|req)\b[ \t]+([^\s,{}]+)((?:[ \t]*,[ \t]*[^\s,{}]+)*)(?:[ \t]*\{([^}\n]*)\})?/g;

/** True when `id` is a whole requirement ID under the configured patterns. */
function isRequirementId(id, patterns) {
  return patterns.some(pattern => {
    pattern.lastIndex = 0;
    const m = pattern.exec(id);
    return m && m.index === 0 && m[0] === id;
  });
}

function splitRequirement(token, patterns) {
  const clean = token.replace(/[.,;:)\]'"`]+$/, '');
  const hash = clean.lastIndexOf('#');
  const id = hash < 0 ? clean : clean.slice(hash + 1);
  if (!isRequirementId(id, patterns)) return null;
  const qualifier = hash < 0 ? null : clean.slice(0, hash).replaceAll('\\', '/').replace(/^\.\//, '');
  return { id, qualifier: qualifier || null };
}

/**
 * Tags in one comment body. `line` is the comment's first line; `offset` maps
 * a position inside `text` back to its line.
 * @returns {{ verb, id, qualifier, line, extra: string[], scope: string|null, problems: string[] }[]}
 */
export function tagsInComment(text, line, patterns) {
  const tags = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(text)) !== null) {
    const requirement = splitRequirement(m[2], patterns);
    if (!requirement) continue;
    const problems = [];
    const extra = m[3] ? m[3].split(',').map(s => s.trim()).filter(Boolean) : [];
    if (extra.length) problems.push(`lists ${extra.length + 1} requirements in one tag; only ${m[2]} anchors. Write one tag per requirement, one per line`);
    let scope = null;
    if (m[4] !== undefined) {
      const block = m[4].trim();
      const kv = /^scope\s*=\s*(\w+)$/.exec(block);
      if (kv && SCOPES.includes(kv[1])) scope = kv[1];
      else problems.push(`has an unknown scope block {${block}}; expected {scope=file|symbol|statement|route}. The tag counts at file scope`);
    }
    tags.push({
      verb: m[1], id: requirement.id, qualifier: requirement.qualifier,
      line: line + (text.slice(0, m.index).match(/\n/g) || []).length,
      extra, scope, invalidScopeBlock: m[4] !== undefined && scope === null, problems,
    });
  }
  return tags;
}

/** Offsets of each line start (0-based index → offset). */
function lineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineSpanOffsets(starts, content, startLine, endLine) {
  const s = starts[startLine - 1] ?? 0;
  const e = endLine < starts.length ? starts[endLine] - 1 : content.length;
  return { s, e: Math.max(s, e) };
}

/**
 * Lines that hold nothing but comment text. A trailing comment on a code line
 * (`func f() {  // note`) does not make that line part of a comment block, so
 * it cannot detach a tag from the declaration on that line.
 */
function commentOnlyLines(content, comments) {
  const starts = lineStarts(content);
  const lineEnd = line => (line < starts.length ? starts[line] - 1 : content.length);
  const lines = new Set();
  for (const c of comments) {
    const before = content.slice(starts[c.startLine - 1], c.s);
    const after = content.slice(c.e, lineEnd(c.endLine));
    if (before.trim() !== '' || after.trim() !== '') continue;
    for (let l = c.startLine; l <= c.endLine; l++) lines.add(l);
  }
  return lines;
}

/** True when every line strictly between `fromLine` and `toLine` is a comment line (no blank, no code). */
function onlyCommentsBetween(fromLine, toLine, commentLines) {
  for (let l = fromLine + 1; l < toLine; l++) if (!commentLines.has(l)) return false;
  return true;
}

/**
 * Last line of the file's leading comment block: the first run of contiguous
 * comment lines, when it comes before any code. A later comment run, still
 * before code but separated by a blank line, is not the header: it sits above
 * whatever follows it.
 */
function leadingBlockEnd(firstCommentLine, firstCodeLine, commentLines) {
  if (firstCommentLine === null || (firstCodeLine !== null && firstCommentLine >= firstCodeLine)) return 0;
  let end = firstCommentLine;
  while (commentLines.has(end + 1)) end++;
  return end;
}

function fileAnchor(tag, { tier, exact, floor, confidence, problems = [] }) {
  return { tag, scope: 'file', anchor: '*', owner: null, kind: 'file', startLine: 1, endLine: null, tier, exact, floor, confidence, problems: [...tag.problems, ...problems] };
}

/* ───────────────────────────── JS / TS (Babel) ───────────────────────────── */

const LIST_OWNERS = new Set(['Program', 'BlockStatement', 'ClassBody', 'TSModuleBlock', 'StaticBlock']);
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassMethod', 'ClassPrivateMethod', 'ObjectMethod']);
const DECLARATION_TYPES = new Set(['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration', 'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration', 'TSDeclareFunction']);

function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (AST_KEYS_SKIP.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const v of value) if (v && typeof v.type === 'string') out.push(v); }
    else if (value && typeof value.type === 'string') out.push(value);
  }
  return out;
}

/** The name a node adds to a qualified path, or null. */
function nameOf(node) {
  switch (node.type) {
    case 'FunctionDeclaration': case 'ClassDeclaration': case 'TSModuleDeclaration': case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration': case 'TSEnumDeclaration': case 'TSDeclareFunction':
      return node.id?.name ?? node.id?.value ?? null;
    case 'VariableDeclarator':
      return node.id?.type === 'Identifier' ? node.id.name : null;
    case 'ClassMethod': case 'ClassPrivateMethod': case 'ClassProperty': case 'ClassPrivateProperty': case 'TSDeclareMethod':
      return node.key?.name ?? node.key?.value ?? node.key?.id?.name ?? null;
    case 'ExportDefaultDeclaration':
      return node.declaration?.id?.name ?? 'default';
    default:
      return null;
  }
}

const startOf = node => Math.min(node.start, ...(node.decorators || []).map(d => d.start));

/**
 * Locate the comment: the innermost statement list that holds it between two
 * elements, the element after it, and the owner chain.
 */
function locateInList(root, comment) {
  let node = root;
  const owners = [];
  for (let guard = 0; guard < 10000; guard++) {
    if (LIST_OWNERS.has(node.type)) {
      const list = node.body;
      const elements = Array.isArray(list) ? list : [];
      const inside = elements.find(el => startOf(el) <= comment.start && comment.end <= el.end);
      if (!inside) {
        const next = elements.find(el => startOf(el) >= comment.end) || null;
        return { found: true, listType: node.type, next, owners };
      }
    }
    const child = children(node).find(c => startOf(c) <= comment.start && comment.end <= c.end);
    if (!child) return { found: false, owners };
    const name = nameOf(child);
    if (name !== null && (child.type !== 'VariableDeclarator' || FUNCTION_TYPES.has(child.init?.type) || child.init?.type === 'ClassExpression')) {
      owners.push({ name, node: child });
    }
    node = child;
  }
  return { found: false, owners };
}

function unwrapExport(node) {
  if (node?.type === 'ExportNamedDeclaration' && node.declaration) return node.declaration;
  if (node?.type === 'ExportDefaultDeclaration' && node.declaration && /Declaration$/.test(node.declaration.type)) return node.declaration;
  return node;
}

const isRequireDeclaration = node => node?.type === 'VariableDeclaration'
  && node.declarations.every(d => d.init?.type === 'CallExpression' && d.init.callee?.name === 'require');

function resolveJs(content, relPath, patterns, parsed) {
  const { ast } = parsed;
  const comments = ast.comments || [];
  const commentLines = commentOnlyLines(content, comments.map(c => ({ s: c.start, e: c.end, startLine: c.loc.start.line, endLine: c.loc.end.line })));
  const lexedJs = lex(content, languageOf(relPath) || 'js');
  const floor = (s, e) => floorFingerprint(lexedJs, s, e);
  const fileExact = jsFingerprintV1(ast.program, comments);
  const fileFloor = floor(0, content.length);
  const tier = BABEL_TIER;
  let routes;
  const routeAt = (s, e) => {
    if (routes === undefined) routes = extractJsRouteCalls(content, relPath) || [];
    return routes.find(r => r.start >= s && r.start < e) || null;
  };
  const anchors = [];
  const firstStatement = ast.program.body[0] || null;
  const headerEnd = leadingBlockEnd(comments[0]?.loc.start.line ?? null, firstStatement ? lineOfOffset(content, startOf(firstStatement)) : null, commentLines);
  for (const comment of comments) {
    const tags = tagsInComment(comment.value, comment.loc.start.line, patterns);
    if (!tags.length) continue;
    // The whole run of comments this one belongs to: its last line decides adjacency.
    let blockEnd = comment.loc.end.line;
    while (commentLines.has(blockEnd + 1)) blockEnd++;
    const leading = comment.loc.start.line <= headerEnd;
    const loc = locateInList(ast.program, comment);
    for (const tag of tags) anchors.push(resolveJsTag(tag, { blockEnd, leading, loc, commentLines, comments, content, floor, fileExact, fileFloor, tier, routeAt }));
  }
  return { tier, confidence: 'high', error: null, anchors, fileExact, fileFloor };
}

function resolveJsTag(tag, ctx) {
  const { blockEnd, leading, loc, commentLines, fileExact, fileFloor, tier, routeAt } = ctx;
  const file = (problems = []) => fileAnchor(tag, { tier, exact: fileExact, floor: fileFloor, confidence: 'high', problems });
  if (tag.scope === 'file' || tag.invalidScopeBlock) return file();
  const next = loc.found ? unwrapExport(loc.next) : null;
  const nextStart = loc.next ? startOf(loc.next) : null;
  const nextLine = loc.next ? lineOfOffset(ctx.content, nextStart) : null;
  const adjacent = loc.next && nextLine > blockEnd && onlyCommentsBetween(blockEnd, nextLine, commentLines);
  const owner = loc.owners.map(o => o.name).join('.') || '<module>';

  if (!loc.found) {
    // Inside an expression (an object literal, a call argument): the nearest named owner.
    if (loc.owners.length) {
      const target = loc.owners[loc.owners.length - 1].node;
      return symbolAnchor(tag, target, loc.owners.map(o => o.name).join('.'), ctx, [`sits inside an expression, so it anchors to the enclosing ${owner}; move it directly above a declaration or statement for a narrower anchor`]);
    }
    return file();
  }
  if (leading && loc.listType === 'Program') {
    if (!next || next.type === 'ImportDeclaration' || isRequireDeclaration(next) || !adjacent) return file();
    if (DECLARATION_TYPES.has(next.type)) {
      return file([`is in the file's leading comment block directly above ${describeJs(next)}, so it is read as file scope. Add {scope=symbol} to anchor it to the declaration, or {scope=file} to confirm`]);
    }
    return file();
  }
  if (!next) {
    if (loc.owners.length) {
      const target = loc.owners[loc.owners.length - 1].node;
      return symbolAnchor(tag, target, owner, ctx, ['follows the last statement of its block, so it anchors to the enclosing symbol']);
    }
    return file(['follows the last statement of the file; it is read as file scope']);
  }
  // A module header that sits among or above imports describes the module (FR-002).
  if (next.type === 'ImportDeclaration' || isRequireDeclaration(next)) return tag.scope && tag.scope !== 'file' ? file([`asks for {scope=${tag.scope}} but sits above imports`]) : file();
  if (!adjacent) {
    if (tag.scope) return file([`asks for {scope=${tag.scope}} but is not directly above a declaration or statement (a blank line separates them)`]);
    return file(['is not directly above a declaration or statement (a blank line separates them), so it is read as file scope']);
  }
  const declaration = isSymbolNode(next, loc.listType);
  if (tag.scope === 'statement') return statementAnchor(tag, loc.next, owner, ctx);
  const route = routeAt(nextStart, loc.next.end);
  if (tag.scope === 'route') {
    return route ? routeAnchor(tag, loc.next, route, owner, ctx) : file([`asks for {scope=route} but no route registration follows it`]);
  }
  if (declaration) {
    const name = nameOfDeclaration(next);
    if (name) return symbolAnchor(tag, next, [...loc.owners.map(o => o.name), name].join('.'), ctx);
  }
  if (tag.scope === 'symbol') return file([`asks for {scope=symbol} but ${describeJs(next)} is not a named declaration`]);
  if (route) return routeAnchor(tag, loc.next, route, owner, ctx);
  return statementAnchor(tag, loc.next, owner, ctx);
}

function isSymbolNode(node, listType) {
  if (listType === 'ClassBody') return true;
  if (DECLARATION_TYPES.has(node.type)) {
    if (node.type !== 'VariableDeclaration') return true;
    if (listType === 'Program' || listType === 'TSModuleBlock') return node.declarations[0]?.id?.type === 'Identifier';
    // Inside a function body, a variable is a symbol only when it holds a function or class.
    const init = node.declarations[0]?.init;
    return node.declarations[0]?.id?.type === 'Identifier' && (FUNCTION_TYPES.has(init?.type) || init?.type === 'ClassExpression');
  }
  return false;
}

function nameOfDeclaration(node) {
  if (node.type === 'VariableDeclaration') return node.declarations[0]?.id?.name || null;
  return nameOf(node);
}

function describeJs(node) {
  const name = nameOfDeclaration(node);
  return name ? `${node.type.replace(/Declaration$/, '').toLowerCase()} ${name}` : `a ${node.type}`;
}

function lineOfOffset(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content[i] === '\n') line++;
  return line;
}

function jsExact(node, comments) {
  if (node.type === 'VariableDeclaration') {
    // Leave the variable's own name out (FR-010), keep `const`/`let` and the initializer.
    const synthetic = { type: node.type, kind: node.kind, declare: node.declare, start: node.start, end: node.end,
      declarations: node.declarations.map(d => ({ type: d.type, init: d.init, definite: d.definite, typeAnnotation: d.id?.typeAnnotation })) };
    return jsFingerprintV1(synthetic, comments);
  }
  return jsFingerprintV1(node, comments);
}

function spanOf(node, content) {
  const s = startOf(node);
  return { s, e: node.end, startLine: lineOfOffset(content, s), endLine: node.loc?.end?.line ?? lineOfOffset(content, node.end) };
}

function symbolAnchor(tag, node, qual, ctx, problems = []) {
  const span = spanOf(node, ctx.content);
  return { tag, scope: 'symbol', anchor: qual, owner: null, kind: node.type, startLine: span.startLine, endLine: span.endLine,
    tier: ctx.tier, exact: jsExact(node, ctx.comments), floor: ctx.floor(span.s, span.e), confidence: 'high', problems: [...tag.problems, ...problems] };
}

function statementAnchor(tag, node, owner, ctx) {
  const span = spanOf(node, ctx.content);
  return { tag, scope: 'statement', anchor: null, owner, kind: node.type, startLine: span.startLine, endLine: span.endLine,
    tier: ctx.tier, exact: jsExact(node, ctx.comments), floor: ctx.floor(span.s, span.e), confidence: 'high', problems: [...tag.problems] };
}

function routeAnchor(tag, node, route, owner, ctx) {
  const span = spanOf(node, ctx.content);
  return { tag, scope: 'route', anchor: `route:${route.method} ${route.path}`, owner, kind: node.type, startLine: span.startLine, endLine: span.endLine,
    tier: ctx.tier, exact: jsExact(node, ctx.comments), floor: ctx.floor(span.s, span.e), confidence: 'high', problems: [...tag.problems] };
}

/* ───────────────────────────── Python ───────────────────────────── */

const PY_IMPORT = /^\s*(?:import|from)\s/;

/** Line numbers py-anchors must resolve "what follows" for. */
export function pythonCandidateLines(content) {
  const lines = content.split('\n');
  const wanted = new Set([0]);
  for (let i = 0; i < lines.length; i++) {
    if (!/@(?:implements|req)\b/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && /^\s*#/.test(lines[end])) end++;
    wanted.add(end); // the last comment line of the run (1-based = end)
    wanted.add(i);   // an inline comment: the statement on its own line
  }
  return [...wanted].sort((a, b) => a - b);
}

function resolvePython(content, relPath, patterns, py, pyTier) {
  const outline = py.outline;
  const starts = lineStarts(content);
  const rawLines = content.split('\n');
  const lexed = lex(content, 'python');
  const floor = (startLine, endLine) => { const { s, e } = lineSpanOffsets(starts, content, startLine, endLine); return floorFingerprint(lexed, s, e); };
  const directives = (startLine, endLine) => outline.comments
    .filter(c => c.line >= startLine && c.line <= endLine && DIRECTIVE_RE.test(c.text)).map(c => c.text);
  const fileExact = pyFingerprintV1(outline.moduleV1 || '', directives(1, rawLines.length));
  const fileFloor = floorFingerprint(lexed, 0, content.length);
  const commentLines = new Set(outline.comments.filter(c => rawLines[c.line - 1].slice(0, c.col).trim() === '').map(c => c.line));
  const first = outline.following['0'] || null;
  const firstCommentLine = outline.comments.length ? Math.min(...outline.comments.filter(c => commentLines.has(c.line)).map(c => c.line)) : null;
  const headerEnd = leadingBlockEnd(Number.isFinite(firstCommentLine) ? firstCommentLine : null, first ? first.start : null, commentLines);
  const anchors = [];
  const file = (tag, problems = []) => fileAnchor(tag, { tier: pyTier, exact: fileExact, floor: fileFloor, confidence: 'high', problems });
  const symbolFor = (tag, sym, problems = []) => ({
    tag, scope: 'symbol', anchor: sym.qual, owner: null, kind: sym.kind, startLine: sym.start, endLine: sym.end,
    tier: pyTier, exact: pyFingerprintV1(sym.v1, directives(sym.start, sym.end)), floor: floor(sym.start, sym.end), confidence: 'high',
    problems: [...tag.problems, ...problems],
  });
  for (const c of outline.comments) {
    const tags = tagsInComment(c.text, c.line, patterns);
    if (!tags.length) continue;
    const inline = !commentLines.has(c.line);
    let blockEnd = c.line;
    while (!inline && commentLines.has(blockEnd + 1)) blockEnd++;
    for (const tag of tags) {
      if (tag.scope === 'file' || tag.invalidScopeBlock) { anchors.push(file(tag)); continue; }
      // Between a decorator and its def: that symbol.
      const decorated = outline.symbols.find(s => s.start <= c.line && c.line < s.line);
      if (decorated) { anchors.push(symbolFor(tag, decorated)); continue; }
      if (!inline && c.line <= headerEnd) {
        const adjacent = first && first.start === blockEnd + 1;
        if (!adjacent || PY_IMPORT.test(rawLines[first.line - 1]) || first.kind === 'stmt') { anchors.push(file(tag)); continue; }
        anchors.push(file(tag, ['is in the file\'s leading comment block directly above a declaration, so it is read as file scope. Add {scope=symbol} to anchor it to the declaration, or {scope=file} to confirm']));
        continue;
      }
      const next = outline.following[String(inline ? c.line - 1 : blockEnd)] || null;
      if (next && PY_IMPORT.test(rawLines[next.line - 1])) { anchors.push(file(tag)); continue; }
      const adjacent = next && (inline ? next.start === c.line : next.start === blockEnd + 1);
      if (!next || !adjacent) {
        anchors.push(file(tag, [next ? 'is not directly above a declaration or statement (a blank line separates them), so it is read as file scope' : 'follows the last statement of the file; it is read as file scope']));
        continue;
      }
      const sym = (next.kind === 'def' || next.kind === 'assign')
        ? outline.symbols.find(s => s.start === next.start && s.line === next.line) : null;
      if (sym && tag.scope !== 'statement' && tag.scope !== 'route') { anchors.push(symbolFor(tag, sym)); continue; }
      if (tag.scope === 'symbol' || tag.scope === 'route') { anchors.push(file(tag, [`asks for {scope=${tag.scope}} but what follows is not a ${tag.scope === 'symbol' ? 'named declaration' : 'route registration DocGuard recognises in Python'}`])); continue; }
      anchors.push({
        tag, scope: 'statement', anchor: null, owner: next.owner, kind: next.kind, startLine: next.start, endLine: next.end,
        tier: pyTier, exact: pyFingerprintV1(next.v1, directives(next.start, next.end)), floor: floor(next.start, next.end), confidence: 'high', problems: [...tag.problems],
      });
    }
  }
  // Tags inside docstrings belong to the docstring's owner.
  const docTags = (from, to, onTag) => {
    for (let l = from; l <= to; l++) for (const tag of tagsInComment(rawLines[l - 1] || '', l, patterns)) onTag(tag);
  };
  if (outline.moduleDocstring) docTags(outline.moduleDocstring[0], outline.moduleDocstring[1], tag => anchors.push(file(tag)));
  for (const sym of outline.symbols) {
    if (sym.docstring) docTags(sym.docstring[0], sym.docstring[1], tag => anchors.push(tag.scope === 'file' ? file(tag) : symbolFor(tag, sym)));
  }
  return { tier: pyTier, confidence: 'high', error: null, anchors, fileExact, fileFloor };
}

/* ───────────────────────────── Pattern tier ───────────────────────────── */

const IMPORT_KEYWORDS = new Set(['package', 'import', 'use', 'using', 'require', 'require_once', 'include', 'include_once', 'extern', 'namespace', 'module', '#include', 'from']);

function resolvePattern(content, relPath, patterns, lang) {
  const lexed = lex(content, lang);
  const confidence = LOW_CONFIDENCE_LANGS.has(lang) ? 'low' : 'medium';
  const tier = PATTERN_TIER;
  const fileFloor = floorFingerprint(lexed, 0, content.length);
  const anchors = [];
  const comments = lexed.comments || [];
  const commentLines = commentOnlyLines(content, comments.map(c => ({ s: c.s, e: c.e, startLine: c.line, endLine: c.endLine })));
  const file = (tag, problems = []) => fileAnchor(tag, { tier, exact: fileFloor, floor: fileFloor, confidence, problems });
  if (lexed.error) {
    for (const c of comments) for (const tag of tagsInComment(c.text, c.line, patterns)) {
      anchors.push(file(tag, [`cannot be placed precisely: the ${lang} pattern lexer could not balance this file (${lexed.error}), so every tag in it is read as file scope`]));
    }
    return { tier, confidence, error: lexed.error, anchors, fileExact: fileFloor, fileFloor };
  }
  const { symbols } = outline(content, lang);
  const tokens = lexed.tokens;
  const firstToken = tokens[0] || null;
  const tokenAfter = offset => tokens.find(t => t.s >= offset && t.t !== 'semi') || null;
  const headerEnd = leadingBlockEnd(comments[0]?.line ?? null, firstToken ? firstToken.line : null, commentLines);
  // Overloads and trait impls share a qualified name; only then does the signature join the anchor (FR-003).
  const qualCount = new Map();
  for (const sym of symbols) qualCount.set(sym.qual, (qualCount.get(sym.qual) || 0) + 1);
  const anchorName = sym => (qualCount.get(sym.qual) > 1 && sym.sig ? `${sym.qual}(${sym.sig})` : sym.qual);
  for (const c of comments) {
    const tags = tagsInComment(c.text, c.line, patterns);
    if (!tags.length) continue;
    let blockEnd = c.endLine;
    while (commentLines.has(blockEnd + 1)) blockEnd++;
    const next = tokenAfter(c.e);
    const leading = c.line <= headerEnd;
    const adjacent = next && next.line > blockEnd && onlyCommentsBetween(blockEnd, next.line, commentLines);
    for (const tag of tags) {
      if (tag.scope === 'file' || tag.invalidScopeBlock || !next) { anchors.push(file(tag)); continue; }
      const sym = symbols.find(s => s.start === next.s);
      if (leading) {
        if (!adjacent || IMPORT_KEYWORDS.has(next.v) || !sym) { anchors.push(file(tag)); continue; }
        anchors.push(file(tag, ['is in the file\'s leading comment block directly above a declaration, so it is read as file scope. Add {scope=symbol} to anchor it to the declaration, or {scope=file} to confirm']));
        continue;
      }
      if (IMPORT_KEYWORDS.has(next.v)) { anchors.push(file(tag)); continue; }
      if (!adjacent) { anchors.push(file(tag, ['is not directly above a declaration or statement (a blank line separates them), so it is read as file scope'])); continue; }
      if (sym && tag.scope !== 'statement' && tag.scope !== 'route') {
        anchors.push({
          tag, scope: 'symbol', anchor: anchorName(sym), owner: null, kind: sym.kind,
          startLine: sym.startLine, endLine: sym.endLine, tier, exact: floorFingerprint(lexed, sym.start, sym.end),
          floor: floorFingerprint(lexed, sym.start, sym.end), confidence, problems: [...tag.problems],
        });
        continue;
      }
      if (tag.scope === 'symbol' || tag.scope === 'route') {
        anchors.push(file(tag, [`asks for {scope=${tag.scope}} but what follows is not a ${tag.scope === 'symbol' ? 'declaration the pattern tier recognises' : 'route registration DocGuard recognises in this language'}`]));
        continue;
      }
      const span = statementSpan(lexed, next.s);
      if (!span) { anchors.push(file(tag, ['is above code the pattern tier cannot delimit, so it is read as file scope'])); continue; }
      const enclosing = symbols.filter(s => s.start <= span.s && span.e <= s.end).sort((a, b) => (b.start - a.start))[0];
      anchors.push({
        tag, scope: 'statement', anchor: null, owner: enclosing ? enclosing.qual : '<module>', kind: 'statement',
        startLine: lineOfOffset(content, span.s), endLine: lineOfOffset(content, span.e), tier,
        exact: floorFingerprint(lexed, span.s, span.e), floor: floorFingerprint(lexed, span.s, span.e), confidence, problems: [...tag.problems],
      });
    }
  }
  return { tier, confidence, error: null, anchors, fileExact: fileFloor, fileFloor };
}

/* ───────────────────────────── No lexer: file tier ───────────────────────────── */

/** `#` and `//` comments outside quotes, for YAML, shell and other languages DocGuard cannot lex. */
export function plainComments(content, { hash = true, slashes = false } = {}) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let quote = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (quote) { if (ch === '\\' && quote === '"') j++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      const startsComment = (hash && ch === '#' && (j === 0 || /\s/.test(line[j - 1])))
        || (slashes && ch === '/' && line[j + 1] === '/');
      if (startsComment) { out.push({ line: i + 1, text: line.slice(j + (ch === '#' ? 1 : 2)) }); break; }
    }
  }
  return out;
}

function resolveFileTier(content, relPath, patterns) {
  const exact = dg1(content);
  const anchors = [];
  for (const c of plainComments(content, { hash: true, slashes: false })) {
    for (const tag of tagsInComment(c.text, c.line, patterns)) anchors.push(fileAnchor(tag, { tier: FILE_TIER, exact, floor: exact, confidence: 'low' }));
  }
  return { tier: FILE_TIER, confidence: 'low', error: null, anchors, fileExact: exact, fileFloor: exact };
}

/* ───────────────────────────── Entry point ───────────────────────────── */

/**
 * Every tag in one file and what it anchors to.
 * @param {string} content
 * @param {string} relPath  project-relative POSIX path
 * @param {RegExp[]} patterns  requirement ID patterns
 * @param {{ python?: { outline?: object, error?: string } | null, pythonTier?: string|null, pythonReason?: string|null }} [options]
 * @returns {{ tier, confidence, error, anchors: object[], fileExact, fileFloor, degraded?: string }}
 */
export function resolveFileAnchors(content, relPath, patterns, options = {}) {
  const lang = languageOf(relPath);
  if (lang === 'js' || lang === 'ts') {
    const parsed = parseJsTs(content, relPath);
    if (parsed.ok && parsed.ast && !parsed.ast.errors?.length) return resolveJs(content, relPath, patterns, parsed);
    const fallback = resolvePattern(content, relPath, patterns, lang);
    return { ...fallback, degraded: parsed.ok ? 'Babel recovered from syntax errors, so the pattern tier was used' : (parsed.error || 'Babel is unavailable') };
  }
  if (lang === 'python') {
    const py = options.python;
    if (py?.outline && !py.outline.error && options.pythonTier) return resolvePython(content, relPath, patterns, py, options.pythonTier);
    const fallback = resolvePattern(content, relPath, patterns, 'python');
    return { ...fallback, degraded: py?.error || py?.outline?.error || options.pythonReason || 'python3 is unavailable' };
  }
  if (lang) return resolvePattern(content, relPath, patterns, lang);
  return resolveFileTier(content, relPath, patterns);
}

/**
 * Comments that may hold requirement tags, string-aware in every tier
 * (FR-005): Babel's comment list for JS/TS, the pattern lexer for every
 * language it knows, and a quote-aware scanner for YAML and shell.
 * @returns {{ text: string, line: number }[]}
 */
export function realComments(content, relPath) {
  const lang = languageOf(relPath);
  if (lang === 'js' || lang === 'ts') {
    const parsed = parseJsTs(content, relPath);
    if (parsed.ok && parsed.ast && !parsed.ast.errors?.length) return (parsed.ast.comments || []).map(c => ({ text: c.value, line: c.loc.start.line }));
  }
  if (lang) {
    const lexed = lex(content, lang);
    return (lexed.comments || []).map(c => ({ text: c.text, line: c.line }));
  }
  return plainComments(content, { hash: true, slashes: false });
}
