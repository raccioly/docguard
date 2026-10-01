/**
 * Python AST helpers — the "full support" parsing tier for Python, backed by
 * the interpreter's OWN `ast` module (no npm/pip dependency: we shell out to
 * the `python3` already on the developer's machine).
 *
 * Why a real parser here: the regex Python scanners match `@app.get("…")`
 * decorators and `class X(BaseModel):` blocks line-by-line. That misses
 * multi-line decorators, method-array Flask routes, and — most dangerously —
 * undercounts a model's fields, which makes the data-model validators falsely
 * PASS on stale docs. Python's `ast` gets every decorator and field exactly.
 *
 * Load model: OPTIONAL, exactly like the JS @babel/parser tier. If `python3`
 * (or `python`) isn't on PATH, or the subprocess errors, every entry point here
 * returns `null` and the callers transparently fall back to their regex (beta)
 * tier. Python parsing never becomes load-bearing for the CLI to run.
 * @implements docguard.language-repository-coverage#FR-001
 * @implements docguard.language-repository-coverage#FR-004
 *
 * The extractor emits a module outline (imports, module-level statements,
 * classes, functions) that the route, model and settings resolvers share with
 * the pattern tier (py-outline.mjs), and the module's public names, including
 * names assigned at the top level, for the symbol map.
 * @implements docguard.python-extraction#FR-016
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Cached interpreter probe: undefined = unchecked, null = unavailable,
// string = the working command ('python3' or 'python').
let _pyCmd;

function pyCmd() {
  if (_pyCmd !== undefined) return _pyCmd;
  for (const cmd of ['python3', 'python']) {
    try {
      const r = spawnSync(cmd, ['-c', 'import ast,sys,json'], { encoding: 'utf-8', timeout: 4000 });
      if (r.status === 0) { _pyCmd = cmd; return _pyCmd; }
    } catch { /* try the next candidate */ }
  }
  _pyCmd = null;
  return _pyCmd;
}

/** The working interpreter command ('python3' or 'python'), or null. */
export function pythonCommand() {
  return pyCmd();
}

/** True when a usable Python 3 interpreter (with ast/json) is on PATH. */
export function pyAstAvailable() {
  return pyCmd() !== null;
}

// The extractor runs INSIDE python3. It reads newline-separated file paths on
// stdin and writes a JSON array — one entry per file — to stdout. A file that
// can't be parsed yields { ok: false } so the caller can fall back for THAT
// file instead of silently treating it as "scanned, found nothing".
//
// Contains no backticks and no ${...}, so it embeds safely in a JS template.
const PY_EXTRACTOR = `
import ast, sys, json

MAX_DEPTH = 14
MAX_ITEMS = 500

def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None

# The outline encodes an expression in a small JSON form that the pattern
# tier (cli/scanners/py-outline.mjs) produces from source text too, so both
# tiers feed the same resolvers. Anything outside the form is "other".
def enc(node, depth=0):
    if node is None:
        return None
    if depth > MAX_DEPTH:
        return {"t": "other"}
    depth += 1
    if isinstance(node, ast.Constant):
        v = node.value
        if isinstance(v, str):
            return {"t": "str", "v": v}
        if isinstance(v, bytes):
            return {"t": "str", "v": v.decode("utf-8", "replace")}
        if v is True or v is False or v is None:
            return {"t": "const", "v": v}
        if v is Ellipsis:
            return {"t": "const", "v": "..."}
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return {"t": "num", "v": v}
        return {"t": "other"}
    if isinstance(node, ast.JoinedStr):
        parts = []
        for p in node.values:
            parts.append(enc(p.value if isinstance(p, ast.FormattedValue) else p, depth))
        return {"t": "fstr", "parts": parts}
    name = dotted(node)
    if name is not None:
        return {"t": "ref", "v": name}
    if isinstance(node, ast.Attribute):
        return {"t": "attr", "value": enc(node.value, depth), "attr": node.attr}
    if isinstance(node, ast.Call):
        args = [{"t": "other"} if isinstance(a, ast.Starred) else enc(a, depth) for a in node.args[:MAX_ITEMS]]
        kw = {}
        for k in node.keywords:
            if k.arg:
                kw[k.arg] = enc(k.value, depth)
        return {"t": "call", "fn": enc(node.func, depth), "args": args, "kw": kw}
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return {"t": "list", "items": [{"t": "other"} if isinstance(e, ast.Starred) else enc(e, depth) for e in node.elts[:MAX_ITEMS]]}
    if isinstance(node, ast.Dict):
        keys, values = [], []
        for k, v in list(zip(node.keys, node.values))[:MAX_ITEMS]:
            if k is None:
                continue
            keys.append(enc(k, depth))
            values.append(enc(v, depth))
        return {"t": "dict", "keys": keys, "values": values}
    if isinstance(node, ast.Subscript):
        sl = node.slice
        if hasattr(ast, "Index") and isinstance(sl, getattr(ast, "Index")):
            sl = sl.value
        if isinstance(sl, ast.Slice):
            index = [{"t": "other"}]
        elif isinstance(sl, ast.Tuple):
            index = [enc(e, depth) for e in sl.elts[:MAX_ITEMS]]
        else:
            index = [enc(sl, depth)]
        return {"t": "sub", "value": enc(node.value, depth), "index": index}
    if isinstance(node, ast.BinOp):
        op = "+" if isinstance(node.op, ast.Add) else "|" if isinstance(node.op, ast.BitOr) else None
        if op is None:
            return {"t": "other"}
        return {"t": "bin", "op": op, "l": enc(node.left, depth), "r": enc(node.right, depth)}
    return {"t": "other"}

def params_of(a):
    out = []
    pos = list(getattr(a, "posonlyargs", [])) + list(a.args)
    defaults = [None] * (len(pos) - len(a.defaults)) + list(a.defaults)
    for p, d in zip(pos, defaults):
        out.append({"name": p.arg, "ann": enc(p.annotation), "default": enc(d)})
    for p, d in zip(a.kwonlyargs, a.kw_defaults):
        out.append({"name": p.arg, "ann": enc(p.annotation), "default": enc(d)})
    return out

def doc_line(fn):
    doc = ast.get_docstring(fn) or ""
    return doc.strip().split("\\n")[0] if doc else ""

BLOCKS = (ast.If, ast.For, ast.While, ast.With, ast.Try, ast.AsyncFor, ast.AsyncWith)
if hasattr(ast, "TryStar"):
    BLOCKS = BLOCKS + (getattr(ast, "TryStar"),)

# scope: "module" keeps assignments, calls, classes and functions; "class"
# keeps assignments, methods and nested classes; "function" keeps nested
# definitions and the assignments and calls whose value is a call (a factory
# that builds an app and registers its routers). Compound statements are
# flattened into the enclosing scope, since a guarded "urlpatterns +=" or an
# app built inside a try block is still part of the module.
def outline_of(body, scope, depth=0):
    out = []
    for s in body:
        line = getattr(s, "lineno", 0)
        if isinstance(s, BLOCKS):
            inner = list(getattr(s, "body", []))
            for h in getattr(s, "handlers", []):
                inner.extend(h.body)
            inner += list(getattr(s, "orelse", [])) + list(getattr(s, "finalbody", []))
            out.extend(outline_of(inner, scope, depth))
        elif isinstance(s, ast.ClassDef):
            out.append({
                "k": "class", "name": s.name, "line": line,
                "bases": [enc(b) for b in s.bases],
                "keywords": dict((k.arg, enc(k.value)) for k in s.keywords if k.arg),
                "decorators": [enc(d) for d in s.decorator_list],
                "body": outline_of(s.body, "class", depth + 1) if depth < 4 else [],
            })
        elif isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append({
                "k": "def", "name": s.name, "line": line,
                "decorators": [enc(d) for d in s.decorator_list],
                "params": params_of(s.args), "doc": doc_line(s),
                "body": outline_of(s.body, "function", depth + 1) if depth < 4 else [],
            })
        elif isinstance(s, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            if isinstance(s, ast.Assign):
                targets = [dotted(t) for t in s.targets]
            else:
                targets = [dotted(s.target)]
            targets = [t for t in targets if t]
            if not targets:
                continue
            value = enc(s.value) if s.value is not None else None
            if scope == "function" and (value is None or value.get("t") != "call"):
                continue
            aug = None
            if isinstance(s, ast.AugAssign):
                aug = "+" if isinstance(s.op, ast.Add) else "other"
            out.append({
                "k": "assign", "targets": targets, "line": line, "aug": aug,
                "ann": enc(s.annotation) if isinstance(s, ast.AnnAssign) else None,
                "value": value,
            })
        elif isinstance(s, ast.Expr) and isinstance(s.value, ast.Call) and scope != "class":
            out.append({"k": "expr", "line": line, "value": enc(s.value)})
    return out

def aliases_of(tree):
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for nm in node.names:
                if nm.asname:
                    out.append({"local": nm.asname, "module": nm.name, "name": None, "level": 0})
                else:
                    top = nm.name.split(".")[0]
                    out.append({"local": top, "module": top, "name": None, "level": 0})
        elif isinstance(node, ast.ImportFrom):
            for nm in node.names:
                if nm.name == "*":
                    continue
                out.append({"local": nm.asname or nm.name, "module": node.module or "", "name": nm.name, "level": node.level or 0})
    return out

def imports_from_tree(tree):
    imports = []
    dynamic = False
    path_mutation = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for name in node.names:
                imports.append({"kind": "import", "module": name.name, "level": 0, "names": []})
        elif isinstance(node, ast.ImportFrom):
            imports.append({
                "kind": "from", "module": node.module or "", "level": node.level or 0,
                "names": [name.name for name in node.names]
            })
        elif isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name) and fn.id == "__import__":
                dynamic = True
            elif isinstance(fn, ast.Attribute):
                if isinstance(fn.value, ast.Name) and fn.value.id == "importlib" and fn.attr == "import_module":
                    dynamic = True
                if fn.attr in {"append", "insert", "extend"} and isinstance(fn.value, ast.Attribute):
                    if isinstance(fn.value.value, ast.Name) and fn.value.value.id == "sys" and fn.value.attr == "path":
                        path_mutation = True
        elif isinstance(node, (ast.Assign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
                    if target.value.id == "sys" and target.attr == "path":
                        path_mutation = True
    return imports, dynamic, path_mutation

results = []
for path in sys.stdin.read().splitlines():
    path = path.strip()
    if not path:
        continue
    try:
        with open(path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=path)
    except Exception:
        results.append({"file": path, "ok": False})
        continue
    imports, dynamic_imports, path_mutation = imports_from_tree(tree)
    # Top-level names, for the symbol map: __all__ when declared, else public
    # top-level functions, classes and assigned names, in source order.
    symbols, declared_all = [], None
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not stmt.name.startswith("_"):
            symbols.append(stmt.name)
        elif isinstance(stmt, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in stmt.targets):
            if isinstance(stmt.value, (ast.List, ast.Tuple)):
                declared_all = [e.value for e in stmt.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            for t in (stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]):
                if isinstance(t, ast.Name) and not t.id.startswith("_") and t.id not in symbols:
                    symbols.append(t.id)
    results.append({
        "file": path, "ok": True,
        "outline": {"aliases": aliases_of(tree), "body": outline_of(tree.body, "module")},
        "imports": imports, "dynamicImports": dynamic_imports, "pathMutation": path_mutation,
        "symbols": declared_all if declared_all is not None else symbols
    })

sys.stdout.write(json.dumps(results))
`;

// Parsed files, keyed by path and content digest, for the life of the
// process. Routes, schemas, the import graph and the symbol map each ask for
// the same files in one run; each ask used to be a separate interpreter run.
const _parsed = new Map(); // path → { digest, entry }
const _MAX_CACHED = 20000;

function digestOf(path) {
  try { return createHash('sha1').update(readFileSync(path)).digest('hex'); } catch { return null; }
}

/** Forget cached parses (tests that rewrite a file in place within one tick). */
export function clearPythonParseCache() {
  _parsed.clear();
}

/**
 * Parse a batch of Python files in ONE python3 subprocess.
 *
 * @param {string[]} filePaths - absolute paths to .py files
 * @returns {Object<string, {ok:boolean, outline?, imports?, dynamicImports?, pathMutation?, symbols?}>|null}
 *   A map keyed by the input path, or `null` when Python is unavailable / the
 *   subprocess failed / output was unparseable (caller falls back to regex).
 *   An empty input returns `{}` (nothing to do, but Python IS available).
 *   `outline` is the module outline both tiers share (see py-outline.mjs).
 */
export function extractPythonFiles(filePaths) {
  const cmd = pyCmd();
  if (!cmd) return null;
  if (!filePaths || filePaths.length === 0) return {};

  const byFile = {};
  const digests = new Map();
  const missing = [];
  for (const path of filePaths) {
    const digest = digestOf(path);
    const hit = digest && _parsed.get(path);
    if (hit && hit.digest === digest) byFile[path] = hit.entry;
    else { digests.set(path, digest); missing.push(path); }
  }
  if (missing.length === 0) return byFile;

  let r;
  try {
    r = spawnSync(cmd, ['-c', PY_EXTRACTOR], {
      input: missing.join('\n'),
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30000,
    });
  } catch {
    return null;
  }
  if (!r || r.status !== 0 || !r.stdout) return null;

  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { return null; }
  if (!Array.isArray(parsed)) return null;

  if (_parsed.size + missing.length > _MAX_CACHED) _parsed.clear();
  for (const entry of parsed) {
    if (!entry || !entry.file) continue;
    byFile[entry.file] = entry;
    const digest = digests.get(entry.file);
    if (digest) _parsed.set(entry.file, { digest, entry });
  }
  return byFile;
}
