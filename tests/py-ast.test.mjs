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
import { scanPythonWebRoutes } from '../cli/scanners/python-routes.mjs';
import { scanPythonModels } from '../cli/scanners/python-models.mjs';

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

  // Routes and models are resolved from the module outline the extractor
  // emits (specs/046-python-extraction); these assert through the resolvers.
  function project(src) {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-pyast-'));
    writeFileSync(join(dir, 'mod.py'), src);
    return dir;
  }

  it('extracts FastAPI/APIRouter routes with handler + docstring', () => {
    const dir = project(
      'from fastapi import APIRouter\n' +
      'router = APIRouter()\n' +
      '@router.get("/users/{id}")\n' +
      'async def get_user(id: int):\n' +
      '    """Fetch one user."""\n' +
      '    ...\n'
    );
    try {
      const routes = scanPythonWebRoutes(dir, { asgi: true });
      assert.equal(routes.scanTier.tier, 'py-ast');
      assert.deepEqual(routes.map(r => [r.method, r.path, r.handler, r.description]), [['GET', '/users/{id}', 'get_user', 'Fetch one user.']]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('expands a Flask methods=[...] array into one route per method', () => {
    const dir = project(
      'from flask import Flask\n' +
      'app = Flask(__name__)\n' +
      '@app.route("/legacy", methods=["GET", "POST"])\n' +
      'def legacy(): ...\n'
    );
    try {
      const set = scanPythonWebRoutes(dir, { asgi: true }).map(r => `${r.method} ${r.path}`).sort();
      assert.deepEqual(set, ['GET /legacy', 'POST /legacy']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('extracts Pydantic fields with optional detection', () => {
    const dir = project(
      'from pydantic import BaseModel\n' +
      'from typing import Optional\n' +
      'class User(BaseModel):\n' +
      '    id: int\n' +
      '    name: str\n' +
      '    nickname: Optional[str] = None\n'
    );
    try {
      const u = scanPythonModels(dir).entities.find(s => s.name === 'User');
      assert.strictEqual(u.source, 'pydantic');
      assert.deepEqual(u.fields.map(f => f.name), ['id', 'name', 'nickname']);
      assert.strictEqual(u.fields.find(f => f.name === 'id').required, true);
      assert.strictEqual(u.fields.find(f => f.name === 'nickname').required, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('extracts SQLAlchemy columns; a relationship attribute is a relationship, not a column', () => {
    const dir = project(
      'class Account(Base):\n' +
      '    __tablename__ = "accounts"\n' +
      '    id = Column(Integer, primary_key=True)\n' +
      '    note = Column(String, nullable=True)\n' +
      '    owner = relationship("User")\n' +
      'class User(Base):\n' +
      '    __tablename__ = "users"\n' +
      '    id = Column(Integer, primary_key=True)\n'
    );
    try {
      const r = scanPythonModels(dir);
      const a = r.entities.find(s => s.name === 'Account');
      assert.strictEqual(a.source, 'sqlalchemy');
      assert.deepEqual(a.fields.map(f => f.name).sort(), ['id', 'note']);
      assert.strictEqual(a.fields.find(f => f.name === 'note').required, false); // nullable=True
      assert.strictEqual(a.fields.find(f => f.name === 'id').required, true);
      assert.deepEqual(r.relationships.map(x => [x.from, x.to, x.field]), [['Account', 'User', 'owner']]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports ok:false for an unparseable file (caller falls back to regex)', () => {
    const e = parse('def broken(:\n   not valid python');
    assert.strictEqual(e.ok, false);
  });

  it('does not misclassify a plain class as a model', () => {
    const dir = project('class Plain:\n    x = 1\n    def m(self): ...\n');
    try {
      assert.deepEqual(scanPythonModels(dir).entities, []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  /** @req docguard.language-repository-coverage#FR-001 */
  it('extracts static imports and reports runtime import-path behavior', () => {
    const e = parse([
      'import package.module as module',
      'from . import sibling',
      'from ..shared.tools import helper',
      'import importlib, sys',
      'importlib.import_module(name)',
      'sys.path.insert(0, location)',
    ].join('\n'));
    assert.equal(e.ok, true);
    assert.deepEqual(e.imports, [
      { kind: 'import', module: 'package.module', level: 0, names: [] },
      { kind: 'from', module: '', level: 1, names: ['sibling'] },
      { kind: 'from', module: 'shared.tools', level: 2, names: ['helper'] },
      { kind: 'import', module: 'importlib', level: 0, names: [] },
      { kind: 'import', module: 'sys', level: 0, names: [] },
    ]);
    assert.equal(e.dynamicImports, true);
    assert.equal(e.pathMutation, true);
  });
});

describe('py-ast — contract when python3 is absent', { skip: HAS_PY ? 'python3 is present' : false }, () => {
  it('extractPythonFiles returns null so callers fall back to regex', () => {
    assert.strictEqual(extractPythonFiles(['/whatever.py']), null);
  });
});
