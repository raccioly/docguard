import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanComponents, scanTestInventory } from '../cli/scanners/inventory.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-inv-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('scanComponents — component map (Phase 2a)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('descends a single-package wrapper (src/<pkg>/) and lists its modules', () => {
    dir = make({
      'pyproject.toml': '[project]\nname="tool"\n',
      'src/websec_validator/__init__.py': '',
      'src/websec_validator/cli.py': 'def main(): pass\n',
      'src/websec_validator/recon.py': 'x=1\n',
      'src/websec_validator/extractors/__init__.py': '',
    });
    const paths = scanComponents(dir, {}).map(c => c.path);
    assert.ok(paths.includes('src/websec_validator/cli.py'), `got: ${paths.join(', ')}`);
    assert.ok(paths.includes('src/websec_validator/recon.py'));
    assert.ok(paths.includes('src/websec_validator/extractors'));
    assert.ok(!paths.includes('src/websec_validator'), 'wrapper folder is not a bogus single component');
    assert.ok(!paths.some(p => p.endsWith('__init__.py')), '__init__ barrels excluded');
  });

  it('lists multiple top-level dirs/files without over-descending', () => {
    dir = make({
      'package.json': '{"name":"app"}',
      'src/index.ts': 'export {}',
      'src/routes/users.ts': 'export {}',
      'src/services/auth.ts': 'export {}',
    });
    const paths = scanComponents(dir, {}).map(c => c.path);
    assert.ok(paths.includes('src/routes'));
    assert.ok(paths.includes('src/services'));
    assert.ok(!paths.includes('src/index.ts'), 'index barrel excluded');
  });

  it('excludes non-product dirs (tests/fixtures)', () => {
    dir = make({
      'package.json': '{"name":"app"}',
      'src/core.ts': 'export {}',
      'src/__tests__/core.test.ts': 'it("x",()=>{})',
      'src/fixtures/sample.ts': 'export {}',
    });
    const paths = scanComponents(dir, {}).map(c => c.path);
    assert.ok(paths.includes('src/core.ts'));
    assert.ok(!paths.some(p => p.includes('__tests__')));
    assert.ok(!paths.some(p => p.includes('fixtures')));
  });
});

describe('scanTestInventory — test counts (Phase 2a)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('counts Python test functions per file', () => {
    dir = make({
      'pyproject.toml': '[project]\nname="t"\n',
      'tests/test_recon.py': 'def test_a():\n  pass\ndef test_b():\n  pass\n',
      'tests/test_hardening.py': 'async def test_c():\n  pass\n',
    });
    const inv = scanTestInventory(dir, {});
    assert.equal(inv.totalFiles, 2);
    assert.equal(inv.totalCases, 3);
    assert.equal(inv.files.find(f => f.file.endsWith('test_recon.py')).cases, 2);
  });

  it('counts JS it()/test() and excludes fixture test files', () => {
    dir = make({
      'package.json': '{"name":"app"}',
      'tests/a.test.js': 'it("1",()=>{}); test("2",()=>{});',
      'tests/fixtures/sample_app.test.js': 'it("fixture",()=>{})',
    });
    const inv = scanTestInventory(dir, {});
    assert.equal(inv.totalFiles, 1, 'fixture test file excluded');
    assert.equal(inv.totalCases, 2);
  });

  it('returns an empty inventory when there are no tests', () => {
    dir = make({ 'package.json': '{"name":"app"}', 'src/index.ts': 'export {}' });
    const inv = scanTestInventory(dir, {});
    assert.equal(inv.totalFiles, 0);
    assert.deepEqual(inv.files, []);
  });
});
