/**
 * Python facts for fingerprints and requirement anchors, read in ONE
 * interpreter run per batch.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 *
 * The doc lock used to spawn `python3` once per covered symbol. Here the
 * caller hands over every file it needs, as content (never a path the
 * interpreter re-reads, so what is hashed is what was read), and gets back:
 *
 *   - `v0`: `ast.dump(node, include_attributes=False)` for named symbols,
 *     byte-identical to the doc lock's original lookup (top-level def, class or
 *     assignment, then members by name), extended to any depth;
 *   - `outline` (Python 3.8+, which has `end_lineno`): comments from
 *     `tokenize`, every def and class at any depth with its decorator start,
 *     end line and docstring range, module-level assignments, and, for each
 *     candidate tag line, the statement that follows it. Every symbol and
 *     statement carries a v1 serialization: a walk of the AST's fields that
 *     leaves out positions, the symbol's own name, its docstring and empty
 *     defaults.
 *
 * A missing interpreter, a timeout or a file that does not parse returns a
 * reason, never a guess: callers fall back to another tier and say so
 * (Constitution IX).
 *
 * @implements docguard.requirement-anchors#FR-007
 * @implements docguard.requirement-anchors#FR-010
 * @implements docguard.requirement-anchors#FR-015
 */

import { spawnSync } from 'node:child_process';
import { pythonCommand } from './py-ast.mjs';

// Contains no backticks and no ${...}, so it embeds safely in a JS template.
const SCRIPT = String.raw`
import ast, io, json, sys, tokenize

def find_v0(tree, name):
    top = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            top.setdefault(node.name, node)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name): top.setdefault(t.id, node)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            top.setdefault(node.target.id, node)
    head, _, rest = name.partition('.')
    node = top.get(head)
    for member in (rest.split('.') if rest else []):
        if node is None: break
        node = next((m for m in getattr(node, 'body', []) if getattr(m, 'name', None) == member), None)
    return ast.dump(node, include_attributes=False) if node is not None else None

DEFS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)

def docstring_node(node):
    body = getattr(node, 'body', None)
    if isinstance(node, DEFS + (ast.Module,)) and body and isinstance(body[0], ast.Expr) \
            and isinstance(getattr(body[0], 'value', None), ast.Constant) and isinstance(body[0].value.value, str):
        return body[0]
    return None

VOLATILE = frozenset()

def ser(value, root=None):
    if isinstance(value, ast.AST):
        # docguard.volatile-anchor-lines: a node wholly on a marked line is the placeholder.
        line = getattr(value, 'lineno', None)
        if VOLATILE and line is not None and line == getattr(value, 'end_lineno', None) and line in VOLATILE:
            return '(\x01volatile)'
        parts = [type(value).__name__]
        doc = docstring_node(value) if value is root else None
        for field in value._fields:
            if value is root and field in ('name', 'targets', 'target'):
                continue
            item = getattr(value, field, None)
            if field == 'body' and doc is not None:
                item = item[1:]
            if item is None or item == []:
                continue
            parts.append(field + '=' + ser(item))
        return '(' + ','.join(parts) + ')'
    if isinstance(value, list):
        return '[' + ','.join(ser(v) for v in value) + ']'
    return repr(value)

def walk_defs(nodes, prefix, parent_kind, out, depth):
    for node in nodes:
        if isinstance(node, DEFS):
            qual = prefix + node.name
            start = min([d.lineno for d in node.decorator_list] + [node.lineno])
            doc = docstring_node(node)
            out.append({
                'qual': qual, 'name': node.name,
                'kind': 'class' if isinstance(node, ast.ClassDef) else ('method' if parent_kind == 'class' else 'function'),
                'line': node.lineno, 'start': start, 'end': node.end_lineno,
                'docstring': [doc.lineno, doc.end_lineno] if doc is not None else None,
                'parentKind': parent_kind, 'depth': depth, 'v1': ser(node, node),
            })
            walk_defs(node.body, qual + '.', 'class' if isinstance(node, ast.ClassDef) else 'function', out, depth + 1)
        elif depth == 0 and isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name):
                    out.append({'qual': t.id, 'name': t.id, 'kind': 'variable', 'line': node.lineno,
                                'start': node.lineno, 'end': node.end_lineno, 'docstring': None,
                                'parentKind': 'module', 'depth': 0, 'v1': ser(node, node)})
        else:
            for field in ('body', 'orelse', 'finalbody', 'handlers'):
                block = getattr(node, field, None)
                # A def under if/try/with is still a symbol of the same owner.
                if isinstance(block, list) and block and isinstance(block[0], ast.AST):
                    walk_defs(block, prefix, parent_kind, out, depth)

def statements(tree):
    found = []
    def visit(block, owner):
        for stmt in block:
            found.append((stmt, owner))
            inner = owner
            if isinstance(stmt, DEFS):
                inner = (owner + '.' if owner != '<module>' else '') + stmt.name
            for field in ('body', 'orelse', 'finalbody'):
                sub = getattr(stmt, field, None)
                if isinstance(sub, list) and sub and isinstance(sub[0], ast.stmt):
                    visit(sub, inner)
            for handler in getattr(stmt, 'handlers', []) or []:
                visit(handler.body, inner)
    visit(tree.body, '<module>')
    return found

def outline(tree, source, lines):
    comments = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(source).readline):
            if tok.type == tokenize.COMMENT:
                comments.append({'line': tok.start[0], 'col': tok.start[1], 'text': tok.string[1:]})
    except (tokenize.TokenError, IndentationError, SyntaxError) as exc:
        return {'error': 'tokenize: ' + str(exc)}
    symbols = []
    walk_defs(tree.body, '', 'module', symbols, 0)
    stmts = statements(tree)
    following = {}
    for line in lines:
        best = None
        for stmt, owner in stmts:
            first = min([d.lineno for d in getattr(stmt, 'decorator_list', [])] + [stmt.lineno])
            if first > line and (best is None or first < best[0]):
                best = (first, stmt, owner)
        if best is not None:
            first, stmt, owner = best
            if isinstance(stmt, DEFS):
                kind = 'def'
            elif owner == '<module>' and isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                kind = 'assign'
            else:
                kind = 'stmt'
            following[str(line)] = {'start': first, 'line': stmt.lineno, 'end': stmt.end_lineno, 'owner': owner,
                                    'kind': kind, 'v1': ser(stmt, stmt if kind != 'stmt' else None)}
    module_doc = docstring_node(tree)
    return {'comments': comments, 'symbols': symbols, 'following': following, 'moduleV1': ser(tree, tree),
            'moduleDocstring': [module_doc.lineno, module_doc.end_lineno] if module_doc is not None else None}

request = json.load(sys.stdin)
result = {'version': '%d.%d' % sys.version_info[:2], 'files': {}}
for item in request['files']:
    entry = {}
    VOLATILE = frozenset(item.get('volatile') or [])
    try:
        tree = ast.parse(item['content'], filename=item['key'])
    except (SyntaxError, ValueError) as exc:
        result['files'][item['key']] = {'error': 'parse: ' + str(exc)}
        continue
    if item.get('v0'):
        entry['v0'] = {name: find_v0(tree, name) for name in item['v0']}
    if item.get('outline'):
        if sys.version_info < (3, 8):
            entry['outline'] = {'error': 'Python 3.8+ is required for spans'}
        else:
            entry['outline'] = outline(tree, item['content'], item.get('lines') or [])
    result['files'][item['key']] = entry
json.dump(result, sys.stdout)
`;

let runs = 0;
let version;

/** How many interpreter runs this process has made (a test seam for "one run per batch"). */
export function pythonRuns() {
  return runs;
}

/** `major.minor` of the interpreter, or null. Cached; not counted in pythonRuns. */
export function pythonVersion() {
  if (version !== undefined) return version;
  const py = pythonCommand();
  version = null;
  if (py) {
    const r = spawnSync(py, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', timeout: 4000 });
    if (r.status === 0 && /^\d+\.\d+$/.test(r.stdout.trim())) version = r.stdout.trim();
  }
  return version;
}

/** The python-ast tier label for anchors, e.g. `python-ast@3.12`, or null. */
export function pythonTier() {
  const v = pythonVersion();
  return v ? `python-ast@${v}` : null;
}

/**
 * Run one batch.
 * @param {{key: string, content: string, v0?: string[], outline?: boolean, lines?: number[]}[]} files
 * @returns {{ ok: true, version: string, files: Record<string, object> } | { ok: false, reason: string }}
 */
export function pythonBatch(files) {
  const py = pythonCommand();
  if (!py) return { ok: false, reason: 'python3 is unavailable' };
  if (!files.length) return { ok: true, version: pythonVersion(), files: {} };
  const input = JSON.stringify({ files });
  runs++;
  const timeout = 15000 + Math.ceil(input.length / 65536) * 1000;
  const r = spawnSync(py, ['-c', SCRIPT], { input, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { ok: false, reason: `python3 did not finish: ${r.error.code || r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `python3 exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}` };
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, version: parsed.version, files: parsed.files };
  } catch (e) {
    return { ok: false, reason: `python3 output was not JSON: ${e.message}` };
  }
}
