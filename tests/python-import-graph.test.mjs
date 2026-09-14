/**
 * @req docguard.language-repository-coverage#FR-002
 * @req docguard.language-repository-coverage#FR-003
 * @req docguard.language-repository-coverage#FR-004
 * @req docguard.language-repository-coverage#FR-005
 * @req docguard.language-repository-coverage#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { buildImportGraph, validateArchitecture } from '../cli/validators/architecture.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';

const HAS_PY = pyAstAvailable();

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-python-graph-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) safeWrite(join(dir, path), source);
  return dir;
}

describe('Python architecture graph', { skip: HAS_PY ? false : 'python3 not on PATH' }, () => {
  it('resolves src-layout absolute and explicit relative imports into a cycle', t => {
    const dir = fixture(t, {
      'pyproject.toml': '[project]\nname="service"\n',
      'src/service/__init__.py': '',
      'src/service/routes.py': 'from . import storage\n',
      'src/service/storage.py': 'from service.routes import handler\n',
    });
    const graph = buildImportGraph(dir, {});
    assert.deepEqual(graph.limitations, []);
    assert.deepEqual(graph.edges.map(e => [e.from, e.to, e.language]).sort(), [
      ['src/service/routes.py', 'src/service/storage.py', 'python'],
      ['src/service/storage.py', 'src/service/routes.py', 'python'],
    ]);
    const result = validateArchitecture(dir, {});
    assert.equal(result.applicability.status, 'checked');
    assert.ok(result.findings.some(f => f.code === 'ARC002'));
  });

  it('checks config layers for flat-layout Python packages', t => {
    const dir = fixture(t, {
      'services/__init__.py': '',
      'services/user.py': 'from routes import api\n',
      'routes/__init__.py': '',
      'routes/api.py': 'VALUE = 1\n',
    });
    const result = validateArchitecture(dir, {
      layers: {
        services: { dir: 'services', canImport: [] },
        routes: { dir: 'routes', canImport: ['services'] },
      },
    });
    assert.ok(result.findings.some(f => f.code === 'ARC001' && f.location === 'services/user.py'));
  });

  it('ignores third-party and standard-library imports instead of guessing local files', t => {
    const dir = fixture(t, {
      'pkg/__init__.py': '',
      'pkg/main.py': 'import os\nimport requests\nfrom json import loads\n',
    });
    const graph = buildImportGraph(dir, {});
    assert.equal(graph.edges.length, 0);
    assert.deepEqual(graph.limitations, []);
  });

  it('retains static edges but marks dynamic import and sys.path mutation partial', t => {
    const dir = fixture(t, {
      'pkg/__init__.py': '',
      'pkg/main.py': 'from . import helper\nimport importlib, sys\nsys.path.append(extra)\nimportlib.import_module(name)\n',
      'pkg/helper.py': 'VALUE = 1\n',
    });
    const graph = buildImportGraph(dir, {});
    assert.equal(graph.edges.length, 1);
    assert.deepEqual(new Set(graph.limitations.map(v => v.code)), new Set(['python-dynamic-import', 'python-path-mutation']));
    assert.equal(validateArchitecture(dir, {}).applicability.status, 'partial');
  });

  it('does not choose between duplicate namespace modules in workspace import roots', t => {
    const dir = fixture(t, {
      'package.json': '{"workspaces":["packages/*"]}',
      'packages/one/package.json': '{}',
      'packages/one/src/app.py': 'import acme.tool\n',
      'packages/one/src/acme/tool.py': 'ONE = 1\n',
      'packages/two/package.json': '{}',
      'packages/two/src/acme/tool.py': 'TWO = 2\n',
    });
    const graph = buildImportGraph(dir, {});
    assert.equal(graph.edges.length, 0);
    assert.ok(graph.limitations.some(v => v.code === 'python-ambiguous-module' && v.module === 'acme.tool'));
    assert.equal(validateArchitecture(dir, {}).applicability.status, 'partial');
  });

  it('keeps parse failures visible while analyzing neighboring valid modules', t => {
    const dir = fixture(t, {
      'pkg/__init__.py': '',
      'pkg/good.py': 'VALUE = 1\n',
      'pkg/broken.py': 'def broken(:\n',
    });
    const graph = buildImportGraph(dir, {});
    assert.ok(graph.files.includes('pkg/good.py'));
    assert.ok(graph.unsupportedFiles.includes('pkg/broken.py'));
    assert.ok(graph.limitations.some(v => v.code === 'python-parse-failed'));
    assert.equal(validateArchitecture(dir, {}).applicability.status, 'partial');
  });
});
