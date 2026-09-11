/**
 * v0.18-P2 — Cross-process plan cache (.docguard/plan.cache.json).
 *
 * @req NFR-003 — repeat guard runs reuse a cross-process plan cache, invalidated on tree change.
 *
 * Verifies the disk cache (L2):
 *   - First call writes the file
 *   - Second call (in a fresh process / fresh in-memory state) reads it
 *   - Tree-state change invalidates the cache
 *   - Bad/corrupt files don't throw — cache miss is silent
 *
 * @req SC-DC-001 — first buildMemoryPlan writes .docguard/plan.cache.json
 * @req SC-DC-002 — fresh process reads the cache (faster than full build)
 * @req SC-DC-003 — tree-state change invalidates the disk cache
 * @req SC-DC-004 — corrupt cache file is silently ignored
 * @req SC-DC-005 — config.diskCache === false disables the layer
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, utimesSync, statSync, renameSync, symlinkSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { buildMemoryPlan, clearMemoryPlanCache } from '../cli/scanners/memory-plan.mjs';

const scannerURL = new URL('../cli/scanners/memory-plan.mjs', import.meta.url);
function inProcess(dir, config = {}, moduleURL = scannerURL.href) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { buildMemoryPlan } from ${JSON.stringify(moduleURL)};
    console.log(JSON.stringify(buildMemoryPlan(${JSON.stringify(dir)}, ${JSON.stringify(config)})));
  `], { encoding: 'utf-8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const cachePath = dir => join(dir, '.docguard/plan.cache.json');
const readCache = dir => JSON.parse(readFileSync(cachePath(dir), 'utf-8'));

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-disk-cache-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'disk-cache-test', version: '0.0.0',
    dependencies: { express: '^4' },
  }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.ts'), 'export const x = 1;');
  return dir;
}

describe('disk-backed plan cache', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    clearMemoryPlanCache(); // reset L1 between tests
  });

  for (const layer of ['L1', 'disk']) {
    it(`invalidates ${layer} after an ordinary source edit`, () => {
      dir = makeRepo();
      const file = join(dir, 'src/index.ts');
      writeFileSync(file, 'export const token = process.env.BEFORE_EDIT;');
      const first = buildMemoryPlan(dir);
      assert.deepEqual(first.surface.envVars, ['BEFORE_EDIT']);
      writeFileSync(file, 'export const token = process.env.AFTER_EDIT;');
      if (layer === 'disk') clearMemoryPlanCache();
      assert.deepEqual(buildMemoryPlan(dir).surface.envVars, ['AFTER_EDIT']);
    });
  }

  it('first build writes .docguard/plan.cache.json', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(
      existsSync(resolve(dir, '.docguard/plan.cache.json')),
      'disk cache file should be created after first build'
    );
  });

  it('cache content has the expected shape', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    assert.equal(data.v, '2', 'schema version stamp');
    assert.equal(typeof data.configKey, 'string');
    assert.equal(typeof data.treeHash, 'string');
    assert.ok(data.plan, 'plan body present');
    assert.ok(data.plan.profile, 'plan has profile');
  });

  it('second build in same in-process tree uses L1 (no disk re-read needed)', () => {
    dir = makeRepo();
    const first = buildMemoryPlan(dir, { projectName: 't' });
    // Without deleting the in-memory cache, same call should return same object
    const second = buildMemoryPlan(dir, { projectName: 't' });
    assert.strictEqual(first, second,
      'L1 cache should return the exact same plan object');
  });

  for (const layer of ['cold', 'disk', 'mixed']) {
    it(`bounds L1 to 32 entries when populated through ${layer} builds`, () => {
      dir = mkdtempSync(join(tmpdir(), 'docguard-cache-bound-'));
      const repos = Array.from({ length: 40 }, (_, i) => {
        const repo = join(dir, String(i));
        mkdirSync(repo);
        writeFileSync(join(repo, 'package.json'), '{}');
        buildMemoryPlan(repo); // seed disk caches
        return repo;
      });
      clearMemoryPlanCache();
      const plans = repos.map((repo, i) => buildMemoryPlan(repo, {
        diskCache: layer === 'disk' || (layer === 'mixed' && i % 2 === 0),
      }));
      assert.strictEqual(buildMemoryPlan(repos[39], { diskCache: false }), plans[39], 'newest entry retained');
      // Do not rehydrate evicted entries from disk: object identity proves L1
      // retention/eviction without exporting or instrumenting the private Map.
      for (let i = 8; i < 40; i++) {
        assert.strictEqual(buildMemoryPlan(repos[i], { diskCache: false }), plans[i], 'last 32 entries retained');
      }
      for (let i = 0; i < 8; i++) {
        assert.notStrictEqual(buildMemoryPlan(repos[i], { diskCache: false }), plans[i], 'oldest entries evicted');
      }
    });
  }

  it('fresh in-process state finds plan via disk cache', () => {
    dir = makeRepo();
    inProcess(dir);
    const data = readCache(dir);
    data.plan.notes.push('disk reuse witness');
    writeFileSync(cachePath(dir), JSON.stringify(data));
    assert.ok(inProcess(dir).notes.includes('disk reuse witness'), 'a separate process reuses the plan');
  });

  it('tree-state change invalidates the disk cache', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't' });
    const before = readCache(dir).treeHash;
    clearMemoryPlanCache();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'changed', dependencies: { fastify: '5.0.0' } }));
    // The cache file still exists but should be invalidated by tree-state mismatch
    const plan = buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(plan, 'rebuilds fresh after invalidation');
    // The on-disk cache should now reflect the new tree hash
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    assert.notEqual(data.treeHash, before, 'new tree hash stamped');
    assert.ok(plan.profile.frameworks.includes('Fastify'));
  });

  it('corrupt disk cache is silently ignored', () => {
    dir = makeRepo();
    // Create a corrupt cache file BEFORE first call
    mkdirSync(resolve(dir, '.docguard'));
    writeFileSync(resolve(dir, '.docguard/plan.cache.json'), '{not valid json');
    clearMemoryPlanCache();
    // Should NOT throw — corrupt cache is a miss, builds fresh
    const plan = buildMemoryPlan(dir, { projectName: 't' });
    assert.ok(plan, 'builds despite corrupt cache');
    // The bad file should be overwritten with a valid one
    const raw = readFileSync(resolve(dir, '.docguard/plan.cache.json'), 'utf-8');
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('config.diskCache === false disables the disk layer', () => {
    dir = makeRepo();
    buildMemoryPlan(dir, { projectName: 't', diskCache: false });
    assert.equal(existsSync(resolve(dir, '.docguard/plan.cache.json')), false,
      'disabled mode should NOT write the disk cache');
  });
  for (const layer of ['L1', 'disk']) {
    const refresh = () => { if (layer === 'disk') clearMemoryPlanCache(); };

    it(`${layer}: detects repeated same-size edits with restored timestamps`, () => {
      dir = makeRepo();
      const file = join(dir, 'src/index.ts');
      writeFileSync(file, 'export const value = process.env.FIRST;');
      const stamp = statSync(file);
      buildMemoryPlan(dir);
      for (const variable of ['OTHER', 'THIRD']) {
        writeFileSync(file, `export const value = process.env.${variable};`);
        utimesSync(file, stamp.atime, stamp.mtime);
        refresh();
        assert.deepEqual(buildMemoryPlan(dir).surface.envVars, [variable]);
      }
    });

    it(`${layer}: handles source additions, renames and deletions`, () => {
      dir = makeRepo();
      buildMemoryPlan(dir);
      const file = join(dir, 'src/added.ts');
      writeFileSync(file, 'export const token = process.env.ADDED;');
      refresh();
      assert.deepEqual(buildMemoryPlan(dir).surface.envVars, ['ADDED']);
      const before = readCache(dir).treeHash;
      renameSync(file, join(dir, 'src/renamed.ts'));
      refresh();
      const renamed = buildMemoryPlan(dir);
      assert.notEqual(readCache(dir).treeHash, before);
      assert.ok(renamed.surface.modules.some(m => m.path === 'src/renamed.ts'));
      rmSync(join(dir, 'src/renamed.ts'));
      refresh();
      assert.deepEqual(buildMemoryPlan(dir).surface.envVars, []);
    });

    it(`${layer}: tracks nested manifests and workspace source roots`, () => {
      dir = makeRepo();
      mkdirSync(join(dir, 'packages/api/src'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
      const manifest = join(dir, 'packages/api/package.json');
      writeFileSync(manifest, JSON.stringify({ dependencies: { express: '4.0.0' } }));
      const config = { sourceRoot: ['packages/api/src'] };
      buildMemoryPlan(dir, config);
      writeFileSync(manifest, JSON.stringify({ dependencies: { fastify: '5.0.0' } }));
      writeFileSync(join(dir, 'packages/api/src/service.ts'), 'export const token = process.env.NESTED;');
      refresh();
      const plan = buildMemoryPlan(dir, config);
      assert.ok(plan.profile.frameworks.includes('Fastify'));
      assert.deepEqual(plan.surface.envVars, ['NESTED']);
    });

    it(`${layer}: tracks nested OpenAPI docs and canonical/config edits`, () => {
      dir = makeRepo();
      mkdirSync(join(dir, 'docs'));
      mkdirSync(join(dir, 'docs-canonical/nested'), { recursive: true });
      const spec = path => `openapi: 3.0.0\npaths:\n  /${path}:\n    get:\n      summary: Read\n`;
      writeFileSync(join(dir, 'docs/openapi.yaml'), spec('before'));
      assert.equal(buildMemoryPlan(dir).surface.endpoints[0].path, '/before');
      writeFileSync(join(dir, 'docs/openapi.yaml'), spec('after'));
      refresh();
      assert.equal(buildMemoryPlan(dir).surface.endpoints[0].path, '/after');
      for (const file of ['docs-canonical/nested/DECISIONS.md', 'pnpm-workspace.yaml', '.docguard.json', 'tsconfig.json']) {
        const before = readCache(dir).treeHash;
        writeFileSync(join(dir, file), '{}');
        refresh();
        buildMemoryPlan(dir);
        assert.notEqual(readCache(dir).treeHash, before, file);
      }
    });

    it(`${layer}: distinguishes detection config, including in-place mutation`, () => {
      dir = makeRepo();
      mkdirSync(join(dir, 'examples'));
      writeFileSync(join(dir, 'examples/package.json'), JSON.stringify({ dependencies: { fastify: '5.0.0' } }));
      const config = { detection: { includeNonProduct: false } };
      assert.ok(!buildMemoryPlan(dir, config).profile.frameworks.includes('Fastify'));
      config.detection.includeNonProduct = true;
      refresh();
      assert.ok(buildMemoryPlan(dir, config).profile.frameworks.includes('Fastify'));
    });
  }

  it('invalidates an ordinary edit in an actual new process', () => {
    dir = makeRepo();
    writeFileSync(join(dir, 'src/index.ts'), 'export const token = process.env.FIRST;');
    assert.deepEqual(inProcess(dir).surface.envVars, ['FIRST']);
    writeFileSync(join(dir, 'src/index.ts'), 'export const token = process.env.LATER;');
    assert.deepEqual(inProcess(dir).surface.envVars, ['LATER']);
  });

  it('normalizes relative/absolute roots and config object key order', () => {
    dir = makeRepo();
    const first = buildMemoryPlan(dir, { profile: 'standard', detection: { includeNonProduct: true } });
    assert.strictEqual(buildMemoryPlan(join(dir, 'src/..'), {
      detection: { includeNonProduct: true }, profile: 'standard', changedFiles: new Set(['a.ts']),
    }), first);
  });

  it('refreshes ignore-file rules while leaving ignored/private/cache edits out of identity', () => {
    dir = makeRepo();
    for (const folder of ['ignored', '.local', 'src/.local', 'node_modules', '.wolf']) {
      mkdirSync(join(dir, folder), { recursive: true });
    }
    writeFileSync(join(dir, '.docguardignore'), 'ignored/\n');
    const config = { ignore: ['src/hidden.ts'] };
    const first = buildMemoryPlan(dir, config);
    for (const file of ['ignored/a.ts', '.local/private.ts', 'src/.local/private.ts', 'node_modules/a.ts', '.wolf/memory.md', '.docguard/other.json', 'src/hidden.ts']) {
      writeFileSync(join(dir, file), 'process.env.EXCLUDED');
    }
    assert.strictEqual(buildMemoryPlan(dir, config), first);
    writeFileSync(join(dir, 'src/index.ts'), 'export const token = process.env.VISIBLE;');
    assert.deepEqual(buildMemoryPlan(dir, config).surface.envVars, ['VISIBLE']);
    writeFileSync(join(dir, '.docguardignore'), 'ignored/\nsrc/index.ts\n');
    assert.deepEqual(buildMemoryPlan(dir, config).surface.envVars, []);
    writeFileSync(join(dir, '.docguardignore'), 'ignored/\n');
    assert.deepEqual(buildMemoryPlan(dir, config).surface.envVars, ['VISIBLE']);
  });

  it('skips cache use and writes with _skipCache; diskCache false still has fresh L1', () => {
    dir = makeRepo();
    const config = { diskCache: false };
    const first = buildMemoryPlan(dir, config);
    assert.strictEqual(buildMemoryPlan(dir, config), first);
    const bypass = buildMemoryPlan(dir, config, { _skipCache: true });
    assert.notStrictEqual(bypass, first);
    assert.equal(existsSync(cachePath(dir)), false);
    clearMemoryPlanCache();
    buildMemoryPlan(dir);
    const raw = readFileSync(cachePath(dir), 'utf-8');
    writeFileSync(join(dir, 'src/index.ts'), 'export const token = process.env.BYPASS;');
    assert.deepEqual(buildMemoryPlan(dir, {}, { _skipCache: true }).surface.envVars, ['BYPASS']);
    assert.equal(readFileSync(cachePath(dir), 'utf-8'), raw);
    assert.deepEqual(buildMemoryPlan(dir, config).surface.envVars, ['BYPASS']);
  });

  for (const field of ['v', 'configKey', 'treeHash', 'plan']) {
    it(`rejects incompatible disk ${field}`, () => {
      dir = makeRepo();
      buildMemoryPlan(dir);
      const data = readCache(dir);
      data.plan.notes.push('stale witness');
      data[field] = field === 'plan' ? {} : 'obsolete';
      writeFileSync(cachePath(dir), JSON.stringify(data));
      clearMemoryPlanCache();
      assert.deepEqual(buildMemoryPlan(dir).notes, []);
    });
  }

  const malformedPlans = [
    ['null document', p => { p.docs = [null]; }],
    ['invalid document path', p => { p.docs[0].path = null; }],
    ['escaping document path', p => { p.docs[0].path = '../outside.md'; }],
    ['null sections', p => { p.docs[0].sections = null; }],
    ['null section', p => { p.docs[0].sections = [null]; }],
    ['invalid section id', p => { p.docs[0].sections[0].id = {}; }],
    ['invalid code body', p => { p.docs[0].sections[0].body = {}; }],
    ['unknown section source', p => { p.docs[0].sections[0].source = 'unknown'; }],
    ['invalid human instruction', p => { p.docs[0].sections.find(s => s.source === 'human').task = null; }],
    ['invalid profile', p => { p.profile = []; }],
    ['invalid languages', p => { p.profile.languages = null; }],
    ['invalid framework', p => { p.profile.frameworks = [null]; }],
    ['invalid ecosystem', p => { p.profile.ecosystems = [null]; }],
    ['invalid primary ecosystem', p => { p.profile.primary = []; }],
    ['invalid surface profile', p => { p.surface.profile = {}; }],
    ['missing surface array', p => { delete p.surface.endpoints; }],
    ['invalid endpoint', p => { p.surface.endpoints = [null]; }],
    ['invalid environment variable', p => { p.surface.envVars = [{}]; }],
    ['invalid entity', p => { p.surface.entities = [{ name: 'User', fields: null }]; }],
    ['invalid tests', p => { p.surface.tests = null; }],
    ['invalid test inventory entry', p => { p.surface.tests.files = [null]; }],
    ['invalid test count', p => { p.surface.tests.totalCases = -1; }],
    ['invalid i18n', p => { p.surface.i18n = null; }],
    ['invalid frontend', p => { p.surface.frontend = null; }],
    ['null agent task', p => { p.agentTasks = [null]; }],
    ['invalid agent instruction', p => { p.agentTasks[0].instruction = []; }],
    ['invalid notes', p => { p.notes = 'not an array'; }],
    ['deeply nested grounding', p => {
      let grounding = {};
      for (let i = 0; i < 100; i++) grounding = { nested: grounding };
      p.agentTasks[0].grounding = grounding;
    }],
  ];
  for (const [name, corrupt] of malformedPlans) {
    it(`rejects cached ${name} before L1 promotion`, () => {
      dir = makeRepo();
      buildMemoryPlan(dir);
      const data = readCache(dir);
      const expected = JSON.parse(JSON.stringify(data.plan));
      data.plan.notes.push('malformed-cache witness');
      corrupt(data.plan);
      writeFileSync(cachePath(dir), JSON.stringify(data));
      clearMemoryPlanCache();
      const rebuilt = buildMemoryPlan(dir);
      assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)), expected, 'bad cache must be a miss');
      assert.deepEqual(readCache(dir).plan, expected, 'disk cache repaired');
      assert.strictEqual(buildMemoryPlan(dir), rebuilt, 'only the rebuilt plan is promoted');
    });
  }

  it('bypasses caches for non-JSON configuration without throwing', () => {
    dir = makeRepo();
    const config = { extension: new Map([['key', 'value']]) };
    assert.notStrictEqual(buildMemoryPlan(dir, config), buildMemoryPlan(dir, config));
    assert.equal(existsSync(cachePath(dir)), false);
  });

  for (const declaration of ['sourceRoot', 'workspace', 'pnpm']) {
    it(`bypasses caching for an excluded ${declaration} root`, () => {
      dir = makeRepo();
      mkdirSync(join(dir, 'build'));
      writeFileSync(join(dir, 'build/package.json'), '{}');
      const config = declaration === 'sourceRoot' ? { sourceRoot: 'build' } : {};
      if (declaration === 'workspace') writeFileSync(join(dir, 'package.json'), '{"workspaces":["build"]}');
      if (declaration === 'pnpm') writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'build'\n");
      const first = buildMemoryPlan(dir, config);
      assert.notStrictEqual(buildMemoryPlan(dir, config), first);
      assert.equal(existsSync(cachePath(dir)), false);
    });
  }

  it('bypasses caching for oversized input without reading it into memory', () => {
    dir = makeRepo();
    writeFileSync(join(dir, 'archive.bin'), Buffer.alloc(65 * 1024 * 1024));
    const first = buildMemoryPlan(dir);
    assert.notStrictEqual(buildMemoryPlan(dir), first);
    assert.equal(existsSync(cachePath(dir)), false);
  });

  for (const failure of ['unreadable', 'mid-build edit', 'private reads']) {
    it(`fails closed for ${failure}`, () => {
      dir = makeRepo();
      writeFileSync(join(dir, 'src/index.ts'), 'export const token = process.env.FIRST;');
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        import { strict as assert } from 'node:assert';
        import { buildMemoryPlan } from ${JSON.stringify(scannerURL.href)};
        const dir = ${JSON.stringify(dir)};
        const failure = ${JSON.stringify(failure)};
        const source = dir + '/src/index.ts';
        const cache = dir + '/.docguard/plan.cache.json';
        if (failure === 'unreadable') {
          buildMemoryPlan(dir);
          const oldCache = fs.readFileSync(cache, 'utf-8');
          fs.writeFileSync(source, 'export const token = process.env.LATER;');
          const original = fs.readdirSync;
          fs.readdirSync = function(path, ...args) {
            if (path === dir + '/src') {
              fs.readdirSync = original;
              syncBuiltinESMExports();
              throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
            }
            return original(path, ...args);
          };
          syncBuiltinESMExports();
          assert.deepEqual(buildMemoryPlan(dir).surface.envVars, ['LATER']);
          assert.equal(fs.readFileSync(cache, 'utf-8'), oldCache);
        } else if (failure === 'mid-build edit') {
          const original = fs.readFileSync;
          let edited = false;
          fs.readFileSync = function(path, ...args) {
            const value = original(path, ...args);
            if (path === source && !edited) {
              edited = true;
              fs.writeFileSync(source, 'export const token = process.env.LATER;');
            }
            return value;
          };
          syncBuiltinESMExports();
          buildMemoryPlan(dir);
          assert.ok(edited, 'the scanner edit was injected');
          assert.equal(fs.existsSync(cache), false, 'mixed-state plan must not be persisted');
          assert.deepEqual(buildMemoryPlan(dir).surface.envVars, ['LATER']);
        } else {
          fs.mkdirSync(dir + '/src/.local');
          fs.writeFileSync(dir + '/src/.local/private.ts', 'process.env.PRIVATE');
          fs.writeFileSync(dir + '/.env', 'TOKEN=secret');
          const attempts = [];
          for (const method of ['readdirSync', 'readFileSync', 'openSync']) {
            const original = fs[method];
            fs[method] = function(path, ...args) {
              const value = String(path);
              if (value.includes('/.local') || value === dir + '/.env') {
                attempts.push(value);
                throw new Error('private content read');
              }
              return original(path, ...args);
            };
          }
          syncBuiltinESMExports();
          buildMemoryPlan(dir);
          assert.deepEqual(attempts, []);
          assert.ok(fs.existsSync(cache));
        }
      `], { encoding: 'utf-8', timeout: 30_000 });
      assert.equal(result.status, 0, result.stderr);
    });
  }

  it('does not follow source symlinks, cycles, or private targets when fingerprinting', () => {
    dir = makeRepo();
    mkdirSync(join(dir, '.local'));
    writeFileSync(join(dir, '.local/private.txt'), 'private');
    // Non-scanner filenames isolate the fingerprint walk from legacy scanners.
    symlinkSync(join(dir, '.local/private.txt'), join(dir, 'linked.txt'));
    symlinkSync(dir, join(dir, 'cycle'));
    symlinkSync(join(dir, 'missing'), join(dir, 'broken.txt'));
    const first = buildMemoryPlan(dir);
    assert.notStrictEqual(buildMemoryPlan(dir), first);
    assert.equal(existsSync(cachePath(dir)), false);
  });

  for (const linked of ['directory', 'file']) {
    it(`does not follow a symlinked cache ${linked}`, () => {
      dir = makeRepo();
      mkdirSync(join(dir, '.local'));
      const target = join(dir, '.local/target');
      if (linked === 'directory') {
        mkdirSync(target);
        symlinkSync(target, join(dir, '.docguard'));
      } else {
        writeFileSync(target, 'untouched');
        mkdirSync(join(dir, '.docguard'));
        symlinkSync(target, cachePath(dir));
      }
      buildMemoryPlan(dir);
      clearMemoryPlanCache();
      buildMemoryPlan(dir);
      if (linked === 'directory') assert.equal(existsSync(join(target, 'plan.cache.json')), false);
      else assert.equal(readFileSync(target, 'utf-8'), 'untouched');
    });
  }

  it('invalidates disk identity on scanner version and implementation changes', () => {
    dir = makeRepo();
    const engine = mkdtempSync(join(tmpdir(), 'docguard-cache-engine-'));
    try {
      cpSync(new URL('../cli/', import.meta.url), join(engine, 'cli'), { recursive: true });
      const manifest = join(engine, 'package.json');
      writeFileSync(manifest, JSON.stringify({ type: 'module', version: '1.0.0' }));
      const moduleURL = pathToFileURL(join(engine, 'cli/scanners/memory-plan.mjs')).href;
      inProcess(dir, {}, moduleURL);
      for (const change of ['version', 'implementation']) {
        const before = readCache(dir).configKey;
        if (change === 'version') writeFileSync(manifest, JSON.stringify({ type: 'module', version: '1.0.1' }));
        else {
          const file = join(engine, 'cli/scanners/inventory.mjs');
          writeFileSync(file, readFileSync(file, 'utf-8') + '\n// Changed scanner implementation.\n');
        }
        inProcess(dir, {}, moduleURL);
        assert.notEqual(readCache(dir).configKey, before, change);
      }
    } finally { rmSync(engine, { recursive: true, force: true }); }
  });

});
