/**
 * Python AST tier (item 2c) — extraction via the developer's own python3.
 *
 * These tests SKIP automatically when python3 isn't on PATH (the CLI's
 * documented graceful-degradation contract): the scanners fall back to regex,
 * which is covered elsewhere. When python3 IS present we assert the AST tier
 * gets routes and schema fields exactly — the accuracy the regex can't promise.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { pyAstAvailable, extractPythonFiles } from '../cli/scanners/py-ast.mjs';

const HAS_PY = pyAstAvailable();

describe('py-ast — Python AST extraction', { skip: HAS_PY ? false : 'python3 not on PATH' }, () => {
  function parse(src) {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-pyast-'));
    const file = join(dir, 'mod.py');
    writeFileSync(file, src);
    try {
      const byFile = extractPythonFiles([file]);
      return byFile ? byFile[file] : null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('extracts FastAPI/APIRouter routes with handler + docstring', () => {
    const e = parse(
      'from fastapi import APIRouter\n' +
      'router = APIRouter()\n' +
      '@router.get("/users/{id}")\n' +
      'async def get_user(id: int):\n' +
      '    """Fetch one user."""\n' +
      '    ...\n'
    );
    assert.ok(e.ok);
    assert.deepEqual(e.routes, [{ method: 'GET', path: '/users/{id}', func: 'get_user', desc: 'Fetch one user.' }]);
  });

  it('expands a Flask methods=[...] array into one route per method', () => {
    const e = parse(
      '@app.route("/legacy", methods=["GET", "POST"])\n' +
      'def legacy(): ...\n'
    );
    const set = e.routes.map(r => `${r.method} ${r.path}`).sort();
    assert.deepEqual(set, ['GET /legacy', 'POST /legacy']);
  });

  it('extracts Pydantic fields with optional detection', () => {
    const e = parse(
      'class User(BaseModel):\n' +
      '    id: int\n' +
      '    name: str\n' +
      '    nickname: Optional[str] = None\n'
    );
    const u = e.schemas.find(s => s.name === 'User');
    assert.strictEqual(u.kind, 'pydantic');
    assert.deepEqual(u.fields.map(f => f.name), ['id', 'name', 'nickname']);
    assert.strictEqual(u.fields.find(f => f.name === 'id').required, true);
    assert.strictEqual(u.fields.find(f => f.name === 'nickname').required, false);
  });

  it('extracts SQLAlchemy columns + relationships', () => {
    const e = parse(
      'class Account(Base):\n' +
      '    __tablename__ = "accounts"\n' +
      '    id = Column(Integer, primary_key=True)\n' +
      '    note = Column(String, nullable=True)\n' +
      '    owner = relationship("User")\n'
    );
    const a = e.schemas.find(s => s.name === 'Account');
    assert.strictEqual(a.kind, 'sqlalchemy');
    assert.deepEqual(a.fields.map(f => f.name).sort(), ['id', 'note', 'owner']);
    assert.strictEqual(a.fields.find(f => f.name === 'note').required, false); // nullable=True
    assert.strictEqual(a.fields.find(f => f.name === 'id').required, true);
    assert.deepEqual(a.rels, ['User']);
  });

  it('reports ok:false for an unparseable file (caller falls back to regex)', () => {
    const e = parse('def broken(:\n   not valid python');
    assert.strictEqual(e.ok, false);
  });

  it('does not misclassify a plain class as a model', () => {
    const e = parse('class Plain:\n    x = 1\n    def m(self): ...\n');
    assert.deepEqual(e.schemas, []);
  });
});

describe('py-ast — contract when python3 is absent', { skip: HAS_PY ? 'python3 is present' : false }, () => {
  it('extractPythonFiles returns null so callers fall back to regex', () => {
    assert.strictEqual(extractPythonFiles(['/whatever.py']), null);
  });
});
