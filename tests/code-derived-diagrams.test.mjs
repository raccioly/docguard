/**
 * Code-derived diagrams (specs/035-code-derived-diagrams): a module graph and
 * an entity diagram drawn from code into `source=code` sections, so drift is
 * GST002 and `sync --write` redraws them.
 *
 * @req docguard.code-derived-diagrams#FR-001
 * @req docguard.code-derived-diagrams#FR-002
 * @req docguard.code-derived-diagrams#FR-003
 * @req docguard.code-derived-diagrams#FR-004
 * @req docguard.code-derived-diagrams#FR-005
 * @req docguard.code-derived-diagrams#FR-006
 * @req docguard.code-derived-diagrams#FR-007
 * @req docguard.code-derived-diagrams#FR-008
 * @req docguard.code-derived-diagrams#FR-009
 * @req docguard.code-derived-diagrams#FR-010
 * @req docguard.code-derived-diagrams#FR-011
 * @req docguard.code-derived-diagrams#SC-001
 * @req docguard.code-derived-diagrams#SC-002
 * @req docguard.code-derived-diagrams#SC-003
 * @req docguard.code-derived-diagrams#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildImportGraph, cachedImportGraphCount, clearImportGraphCache } from '../cli/scanners/import-graph.mjs';
import { buildImportGraph as reexported, validateArchitecture } from '../cli/validators/architecture.mjs';
import { MAX_EDGES, moduleGraphOptions, moduleOf, renderModuleGraph } from '../cli/scanners/module-diagram.mjs';
import { buildMemoryPlan, clearMemoryPlanCache } from '../cli/scanners/memory-plan.mjs';
import { generateERDiagram } from '../cli/scanners/schemas.mjs';
import { validateGeneratedStaleness } from '../cli/validators/generated-staleness.mjs';
import { runSync } from '../cli/commands/sync.mjs';
import { sectionTouchedByChanges } from '../cli/shared-sync-scope.mjs';
import { getSection } from '../cli/writers/sections.mjs';

const CLI = resolve('cli/docguard.mjs');
const MARKER = '<!-- docguard:section id=module-graph source=code -->\n<!-- /docguard:section -->';

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-diagrams-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) if (body !== undefined) write(dir, path, body);
  return dir;
}

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

const FOUR_MODULES = {
  'package.json': '{"name":"shop","type":"module"}\n',
  'src/api/routes.js': "import { order } from '../core/service.js';\nexport const log = () => import('../util/log.js');\nexport default order;\n",
  'src/api/helpers.js': "import routes from './routes.js';\nexport default routes;\n",
  'src/core/service.js': "import { save } from '../db/store.js';\nexport const order = () => save();\n",
  'src/db/store.js': 'export const save = () => 1;\n',
  'src/util/log.js': 'export default () => {};\n',
  'tests/api.test.js': "import routes from '../src/api/routes.js';\nimport { save } from '../src/db/store.js';\n",
  'docs-canonical/ARCHITECTURE.md': `# Architecture\n<!-- docguard:generated true -->\n\n## Modules\n\n${MARKER}\n`,
};

const EXPECTED = [
  '```mermaid',
  'graph LR',
  '  m_src_api["src/api"]',
  '  m_src_core["src/core"]',
  '  m_src_db["src/db"]',
  '  m_src_util["src/util"]',
  '  m_src_api --> m_src_core',
  '  m_src_api -.-> m_src_util',
  '  m_src_core --> m_src_db',
  '```',
  '',
  '_Module graph: a dashed edge is a dynamic `import()` only._',
].join('\n');

const config = { projectName: 'shop' };
const sectionBody = dir => getSection(readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8'), 'module-graph').body.trim();
const gst002 = dir => {
  clearMemoryPlanCache();
  return validateGeneratedStaleness(dir, config).findings.filter(f => f.code === 'GST002');
};

describe('the import graph lives in a scanner (FR-001, FR-008)', () => {
  it('the validator re-exports the scanner builder', () => {
    assert.equal(reexported, buildImportGraph);
  });

  it('an unreadable source file is a stated limitation, not a silent gap', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions as a non-root user' : false }, t => {
    const dir = fixture(t, FOUR_MODULES);
    chmodSync(join(dir, 'src/core/service.js'), 0o000);
    clearImportGraphCache();
    const graph = buildImportGraph(dir, {});
    assert.deepEqual(graph.limitations, [{ code: 'source-unreadable', file: 'src/core/service.js' }]);
    const arch = validateArchitecture(dir, {});
    assert.equal(arch.applicability.status, 'partial');
    assert.match(arch.applicability.reason, /unreadable source file/);
    assert.equal(renderModuleGraph(graph).completeness, 'partial');
  });

  it('builds once per tree state and rebuilds after an edit', t => {
    const dir = fixture(t, FOUR_MODULES);
    clearImportGraphCache();
    const first = buildImportGraph(dir, {});
    assert.equal(buildImportGraph(dir, {}), first, 'unchanged tree: the cached graph');
    write(dir, 'src/db/store.js', "import '../util/log.js';\nexport const save = () => 1;\n");
    const second = buildImportGraph(dir, {});
    assert.notEqual(second, first);
    assert.ok(second.edges.some(e => e.from === 'src/db/store.js' && e.to === 'src/util/log.js'));
  });
});

describe('a module diagram that stays true (User Story 1, SC-001)', () => {
  it('sync --write draws the expected graph byte for byte, from product files only', t => {
    const dir = fixture(t, FOUR_MODULES);
    runSync(dir, config, { write: true, silent: true });
    assert.equal(sectionBody(dir), EXPECTED);
    assert.equal(gst002(dir).length, 0, 'freshly drawn: nothing stale');
    const again = runSync(dir, config, { write: true, silent: true });
    assert.equal(again.updates.length, 0, 'second sync: already current');
  });

  it('a new cross-module import is one GST002; sync clears it; a same-module import changes nothing', t => {
    const dir = fixture(t, FOUR_MODULES);
    runSync(dir, config, { write: true, silent: true });

    write(dir, 'src/db/extra.js', "import { save } from './store.js';\nexport default save;\n");
    assert.equal(gst002(dir).length, 0, 'same-module import');

    write(dir, 'src/util/log.js', "import { save } from '../db/store.js';\nexport default save;\n");
    const stale = gst002(dir);
    assert.equal(stale.length, 1);
    assert.match(stale[0].message, /ARCHITECTURE\.md → section "module-graph" is stale/);

    runSync(dir, config, { write: true, silent: true });
    assert.equal(gst002(dir).length, 0);
    assert.match(sectionBody(dir), /m_src_util --> m_src_db/);
  });

  it('an edge is dashed only while every import behind it is dynamic', () => {
    const graph = { files: ['a/x.js', 'b/y.js', 'b/z.js'], edges: [
      { from: 'a/x.js', to: 'b/y.js', dynamic: true },
    ] };
    assert.match(renderModuleGraph(graph).body, /m_a -\.-> m_b/);
    graph.edges.push({ from: 'a/x.js', to: 'b/z.js', dynamic: false });
    assert.match(renderModuleGraph(graph).body, /m_a --> m_b/);
    assert.doesNotMatch(renderModuleGraph(graph).body, /dashed/);
  });

  it('without a marker in an existing doc, no graph is built and nothing is written', t => {
    const dir = fixture(t, {
      ...FOUR_MODULES,
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n<!-- docguard:generated true -->\n\n## Modules\n\nProse.\n',
    });
    clearImportGraphCache();
    const plan = buildMemoryPlan(dir, config, { _skipCache: true });
    const arch = plan.docs.find(d => d.path === 'docs-canonical/ARCHITECTURE.md');
    assert.ok(!arch.sections.some(s => s.id === 'module-graph'));
    assert.equal(cachedImportGraphCount(), 0, 'the import graph was never built');
    const before = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    runSync(dir, config, { write: true, silent: true });
    assert.equal(readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8'), before);
  });

  it('a doc about to be created gets the section, so generate --plan --write draws it', t => {
    const dir = fixture(t, { ...FOUR_MODULES, 'docs-canonical/ARCHITECTURE.md': undefined });
    rmSync(join(dir, 'docs-canonical'), { recursive: true, force: true });
    const plan = buildMemoryPlan(dir, config, { _skipCache: true });
    const section = plan.docs.find(d => d.path === 'docs-canonical/ARCHITECTURE.md').sections.find(s => s.id === 'module-graph');
    assert.equal(section.body, EXPECTED);
  });

  it('the plan disk cache keeps a partial flag and rejects a malformed one', t => {
    const dir = fixture(t, FOUR_MODULES);
    clearMemoryPlanCache();
    buildMemoryPlan(dir, config);
    const cachePath = join(dir, '.docguard/plan.cache.json');
    const stored = JSON.parse(readFileSync(cachePath, 'utf8'));
    assert.equal(stored.v, '3');
    const section = () => stored.plan.docs.find(d => d.path === 'docs-canonical/ARCHITECTURE.md').sections.find(x => x.id === 'module-graph');
    const reload = () => {
      writeFileSync(cachePath, JSON.stringify(stored));
      clearMemoryPlanCache();
      return buildMemoryPlan(dir, config).docs.find(d => d.path === 'docs-canonical/ARCHITECTURE.md').sections.find(x => x.id === 'module-graph');
    };
    Object.assign(section(), { completeness: 'partial', partialReason: 'from the cache' });
    assert.equal(reload().partialReason, 'from the cache', 'a valid cached plan is served');
    Object.assign(section(), { completeness: 'maybe', partialReason: 'from the cache' });
    assert.equal(reload().completeness, undefined, 'a malformed flag is a cache miss, rebuilt fresh');
  });

  it('a pinned section is never rewritten', t => {
    const dir = fixture(t, {
      ...FOUR_MODULES,
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n<!-- docguard:generated true -->\n\n<!-- docguard:section id=module-graph source=code pinned="drawn by hand" -->\nhand drawn\n<!-- /docguard:section -->\n',
    });
    runSync(dir, config, { write: true, silent: true });
    assert.equal(sectionBody(dir), 'hand drawn');
    assert.equal(gst002(dir).length, 0);
  });
});

describe('deterministic output (FR-003)', () => {
  it('ids come from paths, colliding ids take a suffix from their own path, labels are quoted', () => {
    const body = renderModuleGraph({ files: ['a-b/x.js', 'a_b/y.js', 'c"d/z.js', 'root.js'], edges: [] }).body;
    assert.match(body, /m_a_b_[0-9a-f]{6}\["a-b"\]/);
    assert.match(body, /m_a_b_[0-9a-f]{6}\["a_b"\]/);
    assert.match(body, /m_c_d\["c#quot;d"\]/);
    assert.match(body, /m_root\["\(root\)"\]/);
    const withOther = renderModuleGraph({ files: ['a-b/x.js', 'a_b/y.js', 'c"d/z.js', 'root.js', 'e/f.js'], edges: [] }).body;
    assert.ok(body.split('\n').filter(l => l.startsWith('  m_')).every(line => withOther.includes(line)),
      'adding a module adds lines; it does not rename existing nodes');
  });

  it('input order and path separators do not change the bytes', () => {
    const edges = [{ from: 'a/1.js', to: 'b/2.js' }, { from: 'b/2.js', to: 'c/3.js' }, { from: 'c/3.js', to: 'a/1.js' }];
    const one = renderModuleGraph({ files: ['a/1.js', 'b/2.js', 'c/3.js'], edges }).body;
    const two = renderModuleGraph({
      files: ['c\\3.js', 'a\\1.js', 'b\\2.js'],
      edges: [...edges].reverse().map(e => ({ from: e.from.replace('/', '\\'), to: e.to.replace('/', '\\') })),
    }).body;
    assert.equal(two, one);
  });

  it('only gaps in drawn files make the diagram partial; code-side gaps are captioned', () => {
    const base = { files: ['src/a.js', 'tests/b.py'], edges: [] };
    const hiddenTest = renderModuleGraph({ ...base, unsupportedFiles: ['tests/b.py'], limitations: [{ code: 'python-interpreter-unavailable', files: 1 }] });
    assert.equal(hiddenTest.completeness, 'complete', 'a test file the diagram never draws');
    const hiddenSource = renderModuleGraph({ files: ['src/a.js'], edges: [], unsupportedFiles: ['src/c.py'], limitations: [{ code: 'python-interpreter-unavailable', files: 1 }] });
    assert.equal(hiddenSource.completeness, 'partial');
    const unreadable = renderModuleGraph({ ...base, limitations: [{ code: 'source-unreadable', file: 'src/a.js' }] });
    assert.equal(unreadable.partialReason, 'source file unreadable (1 file)');
    const dynamic = renderModuleGraph({ files: ['src/a.py'], edges: [], limitations: [{ code: 'python-dynamic-import', file: 'src/a.py' }] });
    assert.equal(dynamic.completeness, 'complete');
    assert.match(dynamic.body, /1 Python file imports dynamically or changes `sys\.path`/);
  });

  it('a module is the first depth segments of the file directory', () => {
    assert.equal(moduleOf('cli/commands/sync.mjs', 2), 'cli/commands');
    assert.equal(moduleOf('cli/scanners/deep/x.mjs', 2), 'cli/scanners');
    assert.equal(moduleOf('cli/docguard.mjs', 2), 'cli');
    assert.equal(moduleOf('index.js', 2), '.');
  });
});

describe('large projects stay readable (User Story 2, FR-004, SC-002)', () => {
  const tree = (tops, perTop) => {
    const files = [];
    for (let t = 0; t < tops; t++) for (let m = 0; m < perTop; m++) files.push(`t${String(t).padStart(3, '0')}/m${String(m).padStart(3, '0')}/f.js`);
    const edges = files.map((f, i) => ({ from: f, to: files[(i * 7 + 3) % files.length] }))
      .concat(files.map((f, i) => ({ from: f, to: files[(i * 13 + 5) % files.length] })));
    return { files, edges };
  };

  it('groups one directory level higher, and says so', () => {
    const r = renderModuleGraph(tree(5, 10));
    assert.equal(r.nodes, 5);
    assert.match(r.body, /grouped at directory depth 1 instead of 2 to fit 30 nodes/);
  });

  it('merges the least-connected top-level modules into one counted node', () => {
    const r = renderModuleGraph(tree(45, 1));
    assert.equal(r.nodes, 30);
    assert.match(r.body, /merged_modules\["16 more modules"\]/);
    assert.match(r.body, /the 16 least-connected modules are merged into one node/);
  });

  it('500 modules: at most 60 nodes and 150 edges, in under a second', () => {
    // Each module imports its next five: dense enough that the kept 59 still
    // exceed the edge cap among themselves.
    const files = tree(500, 1).files;
    const graph = { files, edges: files.flatMap((f, i) => [1, 2, 3, 4, 5].map(k => ({ from: f, to: files[(i + k) % files.length] }))) };
    const start = performance.now();
    const r = renderModuleGraph(graph, { diagrams: { moduleGraph: { maxNodes: 500 } } });
    const ms = performance.now() - start;
    assert.equal(r.nodes, 60, 'maxNodes is capped at 60');
    assert.ok(r.edges <= MAX_EDGES);
    assert.match(r.body, /edges are not drawn \(limit 150\)/);
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
  });

  it('bounds the options', () => {
    assert.deepEqual(moduleGraphOptions({ diagrams: { moduleGraph: { depth: 0, maxNodes: 1, include: ['./src/', 7, 'src'] } } }),
      { depth: 1, maxNodes: 2, include: ['src'] });
    assert.deepEqual(moduleGraphOptions({}), { depth: 2, maxNodes: 30, include: [] });
  });
});

describe('an entity diagram that stays true (User Story 3, FR-005)', () => {
  it('sorts entities and relationships, whatever the scan order', () => {
    const entities = [
      { name: 'User', fields: [{ name: 'id', type: 'Int', primaryKey: true }] },
      { name: 'Post', fields: [{ name: 'title' }] },
    ];
    const relationships = [
      { from: 'User', to: 'Post', type: 'one-to-many', field: 'posts' },
      { from: 'Post', to: 'User', type: 'many-to-one', field: 'author' },
    ];
    const one = generateERDiagram(entities, relationships);
    assert.equal(generateERDiagram([...entities].reverse(), [...relationships].reverse()), one);
    assert.ok(one.indexOf('Post {') < one.indexOf('User {'));
    assert.match(one, /unknown title/, 'a field without a type does not throw');
  });

  it('the DATA-MODEL entity-diagram section is drawn and kept current', t => {
    const dir = fixture(t, {
      'package.json': '{"name":"blog","dependencies":{"@prisma/client":"5.0.0"}}\n',
      'prisma/schema.prisma': 'model User {\n  id Int @id\n  posts Post[]\n}\n\nmodel Post {\n  id Int @id\n  author User @relation(fields: [authorId], references: [id])\n  authorId Int\n}\n',
      'docs-canonical/DATA-MODEL.md': '# Data Model\n<!-- docguard:generated true -->\n\n<!-- docguard:section id=entity-diagram source=code -->\n<!-- /docguard:section -->\n',
    });
    runSync(dir, config, { write: true, silent: true });
    const body = getSection(readFileSync(join(dir, 'docs-canonical/DATA-MODEL.md'), 'utf8'), 'entity-diagram').body.trim();
    assert.match(body, /^```mermaid\nerDiagram\n {4}Post \{/);
    assert.match(body, /User \|\|--o\{ Post : "posts"/);
    clearMemoryPlanCache();
    assert.equal(validateGeneratedStaleness(dir, config).findings.filter(f => f.code === 'GST002').length, 0);

    write(dir, 'prisma/schema.prisma', readFileSync(join(dir, 'prisma/schema.prisma'), 'utf8').replace('authorId Int\n', 'authorId Int\n  body String\n'));
    clearMemoryPlanCache();
    assert.equal(validateGeneratedStaleness(dir, config).findings.filter(f => f.code === 'GST002').length, 1);
  });
});

describe('sync --since scopes both sections (FR-009)', () => {
  it('module-graph follows code files, entity-diagram follows code and schema files', () => {
    assert.equal(sectionTouchedByChanges('module-graph', ['src/a.ts']), true);
    assert.equal(sectionTouchedByChanges('module-graph', ['README.md']), false);
    assert.equal(sectionTouchedByChanges('entity-diagram', ['prisma/schema.prisma']), true);
    assert.equal(sectionTouchedByChanges('entity-diagram', ['docs/guide.md']), false);
  });
});

/** A PATH holding only node and git, so neither python3 nor python resolves. */
function pathWithoutPython(t) {
  const bin = mkdtempSync(join(tmpdir(), 'docguard-nopy-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  symlinkSync(process.execPath, join(bin, 'node'));
  const git = process.env.PATH.split(delimiter).map(d => join(d, 'git')).find(p => existsSync(p));
  if (git) symlinkSync(git, join(bin, 'git'));
  return bin;
}

describe('a partial graph never flips the result (FR-007, SC-004)', { skip: process.platform === 'win32' ? 'symlinked PATH shim' : false }, () => {
  it('guard reports partial instead of GST002, and sync --write leaves the file until --allow-partial', t => {
    const dir = fixture(t, {
      ...FOUR_MODULES,
      'src/py/app.py': 'import os\n',
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n<!-- docguard:generated true -->\n\n<!-- docguard:section id=module-graph source=code -->\ncommitted elsewhere\n<!-- /docguard:section -->\n',
    });
    const env = { ...process.env, PATH: pathWithoutPython(t), NO_COLOR: '1' };
    const run = (...args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { env, encoding: 'utf8' });

    const guard = JSON.parse(run('guard', '--format', 'json').stdout);
    assert.ok(!guard.findings.some(f => f.code === 'GST002'), 'no GST002 from a partial graph');
    const staleness = guard.validators.find(v => v.key === 'generatedStaleness');
    assert.equal(staleness.applicability.status, 'partial');
    assert.match(staleness.applicability.reason, /ARCHITECTURE\.md § module-graph \(Python interpreter unavailable \(1 file\)\)/);

    const before = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    const sync = JSON.parse(run('sync', '--write', '--format', 'json').stdout);
    assert.equal(readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8'), before);
    assert.ok(sync.skipped.some(s => /module-graph is partial/.test(s.reason)));

    run('sync', '--write', '--allow-partial');
    assert.match(sectionBody(dir), /partial: Python interpreter unavailable \(1 file\)/);
  });
});

describe('this repository draws its own module graph (User Story 4, FR-010, FR-011, SC-003)', () => {
  it('ARCHITECTURE has the section, the hand-drawn layer graph stays, and the committed graph is current', () => {
    const doc = readFileSync('docs-canonical/ARCHITECTURE.md', 'utf8');
    assert.match(doc, /### Layer graph/);
    const committed = getSection(doc, 'module-graph');
    assert.ok(committed, 'module-graph section present');
    const repoConfig = JSON.parse(readFileSync('.docguard.json', 'utf8'));
    const drawn = renderModuleGraph(buildImportGraph(process.cwd(), repoConfig), repoConfig);
    assert.equal(committed.body.trim(), drawn.body);
    for (const layer of ['cli/commands', 'cli/validators', 'cli/scanners', 'cli/writers', 'cli/evidence']) {
      assert.ok(committed.body.includes(`["${layer}"]`), layer);
    }
  });

  it('documents both section ids and the options', () => {
    for (const path of ['docs/doc-sections.md', 'docs/configuration.md', 'README.md']) {
      const text = readFileSync(path, 'utf8');
      assert.match(text, /module-graph/, path);
    }
    assert.match(readFileSync('docs/doc-sections.md', 'utf8'), /entity-diagram/);
    assert.match(readFileSync('docs/configuration.md', 'utf8'), /diagrams\.moduleGraph/);
    assert.match(execFileSync(process.execPath, [CLI, 'sync', '--help'], { encoding: 'utf8' }), /--allow-partial/);
  });
});
