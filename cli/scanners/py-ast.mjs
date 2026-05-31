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
 */
import { spawnSync } from 'node:child_process';

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

HTTP = {"get", "post", "put", "delete", "patch", "head", "options"}
PYD_BASES = {"BaseModel", "SQLModel"}
ORM_BASES = {"Base", "Model", "DeclarativeBase"}
ORM_COLS = {"Column", "mapped_column", "relationship"}

def str_of(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None

def routes_from_func(fn):
    out = []
    doc = ast.get_docstring(fn) or ""
    desc = doc.strip().split("\\n")[0] if doc else ""
    for dec in fn.decorator_list:
        if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
            continue
        method = dec.func.attr.lower()
        if method in HTTP:
            path = str_of(dec.args[0]) if dec.args else None
            if path and path.startswith("/"):
                out.append({"method": method.upper(), "path": path, "func": fn.name, "desc": desc})
        elif method == "route":  # Flask: @app.route("/x", methods=["GET","POST"])
            path = str_of(dec.args[0]) if dec.args else None
            methods = ["GET"]
            for kw in dec.keywords:
                if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                    ms = [str_of(e) for e in kw.value.elts]
                    ms = [m.upper() for m in ms if m]
                    if ms:
                        methods = ms
            if path and path.startswith("/"):
                for m in methods:
                    out.append({"method": m, "path": path, "func": fn.name, "desc": desc})
    return out

def base_names(cls):
    names = []
    for b in cls.bases:
        if isinstance(b, ast.Name):
            names.append(b.id)
        elif isinstance(b, ast.Attribute):
            names.append(b.attr)
    return names

def type_str(node):
    f = getattr(ast, "unparse", None)  # ast.unparse is 3.9+; degrade to "" otherwise
    if f is None or node is None:
        return ""
    try:
        return f(node)
    except Exception:
        return ""

def call_name(call):
    fn = call.func
    if isinstance(fn, ast.Attribute):
        return fn.attr
    if isinstance(fn, ast.Name):
        return fn.id
    return ""

def fields_from_class(cls):
    pyd, orm, rels = [], [], []
    for stmt in cls.body:
        # Pydantic: name: type [= default]
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            t = type_str(stmt.annotation)
            has_none_default = isinstance(stmt.value, ast.Constant) and stmt.value.value is None
            required = not ("Optional" in t or "None" in t or has_none_default)
            pyd.append({"name": stmt.target.id, "type": t, "required": required})
            if isinstance(stmt.value, ast.Call) and call_name(stmt.value) == "relationship" and stmt.value.args:
                tgt = str_of(stmt.value.args[0])
                if tgt:
                    rels.append(tgt)
        # SQLAlchemy: name = Column(Type, nullable=...) / mapped_column(...) / relationship("X")
        elif isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call):
            cname = call_name(stmt.value)
            if cname in ORM_COLS:
                t = ""
                if stmt.value.args:
                    a0 = stmt.value.args[0]
                    if isinstance(a0, ast.Name):
                        t = a0.id
                    elif isinstance(a0, ast.Attribute):
                        t = a0.attr
                    elif isinstance(a0, ast.Call):
                        t = call_name(a0)
                required = True
                for kw in stmt.value.keywords:
                    if kw.arg == "nullable" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                        required = False
                for tgt in stmt.targets:
                    if isinstance(tgt, ast.Name):
                        orm.append({"name": tgt.id, "type": t, "required": required})
                if cname == "relationship" and stmt.value.args:
                    rel = str_of(stmt.value.args[0])
                    if rel:
                        rels.append(rel)
    return pyd, orm, rels

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
    routes, schemas = [], []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            routes.extend(routes_from_func(node))
        elif isinstance(node, ast.ClassDef):
            bn = base_names(node)
            pyd, orm, rels = fields_from_class(node)
            if any(b in PYD_BASES for b in bn) and pyd:
                schemas.append({"name": node.name, "fields": pyd, "kind": "pydantic", "rels": rels})
            elif any(b in ORM_BASES for b in bn) and orm:
                schemas.append({"name": node.name, "fields": orm, "kind": "sqlalchemy", "rels": rels})
    results.append({"file": path, "ok": True, "routes": routes, "schemas": schemas})

sys.stdout.write(json.dumps(results))
`;

/**
 * Parse a batch of Python files in ONE python3 subprocess.
 *
 * @param {string[]} filePaths - absolute paths to .py files
 * @returns {Object<string, {ok:boolean, routes?, schemas?}>|null}
 *   A map keyed by the input path, or `null` when Python is unavailable / the
 *   subprocess failed / output was unparseable (caller falls back to regex).
 *   An empty input returns `{}` (nothing to do, but Python IS available).
 */
export function extractPythonFiles(filePaths) {
  const cmd = pyCmd();
  if (!cmd) return null;
  if (!filePaths || filePaths.length === 0) return {};

  let r;
  try {
    r = spawnSync(cmd, ['-c', PY_EXTRACTOR], {
      input: filePaths.join('\n'),
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

  const byFile = {};
  for (const entry of parsed) {
    if (entry && entry.file) byFile[entry.file] = entry;
  }
  return byFile;
}
