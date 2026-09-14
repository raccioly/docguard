import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateSchemaSync } from '../cli/validators/schema-sync.mjs';

describe('schema-sync scope', () => {
  let dir;
  const model = name => 'class ' + name + '(models.Model):\n    pass\n';
  const put = (path, content) => safeWrite(join(dir, path), content);
  const scan = config => validateSchemaSync(dir, config || {});
  const expectCount = (result, count) => {
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'SCH001');
    assert.ok(result.findings[0].message.startsWith('Found ' + count + ' database model(s)'));
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-schema-scope-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('includes test models unless explicitly excluded', () => {
    put('tests/models.py', model('Fixture'));
    expectCount(scan(), 1);
  });

  it('excludes configured test paths while retaining production models', () => {
    put('tests/models.py', model('Fixture'));
    put('product/models.py', model('Product'));
    const result = scan({ ignore: ['tests/**'] });
    expectCount(result, 1);
    assert.match(result.findings[0].message, /Product/);
    assert.doesNotMatch(result.findings[0].message, /Fixture/);
  });

  it('honors .docguardignore through loaded configuration', () => {
    put('tests/models.py', model('Fixture'));
    put('product/models.py', model('Product'));
    put('.docguardignore', '# Test models are excluded\ntests/**\n');
    const result = scan(loadConfig(dir));
    expectCount(result, 1);
    assert.doesNotMatch(result.findings[0].message, /Fixture/);
  });

  it('does not warn when all models are excluded or no declaration exists', () => {
    put('tests/models.py', model('Fixture'));
    put('product/models.py', '# No model declaration.\n');
    assert.deepEqual(scan({ ignore: ['tests/**'] }).findings, []);
  });

  it('counts a nested app file once across overlapping source roots', () => {
    put('app/models.py', model('Product'));
    expectCount(scan({ sourceRoot: ['app', './app'] }), 1);
  });

  it('preserves same-named models in distinct files with source locations', () => {
    put('app/models.py', model('Product'));
    put('apps/shop/models.py', model('Product'));
    put('docs-canonical/DATA-MODEL.md', '# Entity Definitions\n');
    const result = scan({ sourceRoot: ['app', 'apps'] });
    assert.equal(result.total, 2);
    assert.equal(result.findings.length, 2);
    assert.ok(result.findings.every(f => f.code === 'SCH002'));
    assert.deepEqual(result.findings.map(f => f.location).sort(), ['app/models.py', 'apps/shop/models.py']);
  });

  it('uses project-relative exclusions for configured source roots and exact files', () => {
    put('backend/app/models.py', model('Fixture'));
    put('backend/product/models.py', model('Product'));
    const result = scan({ sourceRoot: 'backend', ignore: ['backend/app/models.py'] });
    expectCount(result, 1);
    assert.doesNotMatch(result.findings[0].message, /Fixture/);
  });

  it('uses shared build-output exclusions even for explicitly selected roots', () => {
    put('target/models.py', model('Generated'));
    put('out/models.py', model('Bundled'));
    put('product/models.py', model('Product'));
    const result = scan({ sourceRoot: ['target', 'out'] });
    expectCount(result, 1);
    assert.match(result.findings[0].message, /Product/);
  });
});
