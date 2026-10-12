/**
 * JS/TS import edges from the syntax tree (specs/076-js-import-edges).
 *
 * The import graph read JS/TS imports with one pattern whose clause stopped at
 * the end of a line, so a Prettier-formatted multi-line import produced no
 * edge. These tests pin both tiers: the syntax tree (every import form, names
 * from the same parse, nothing from comments or strings) and the pattern
 * fallback (a clause may span lines, never statements), and what the graph's
 * consumers see: cycles, layer findings, the module diagram, `diff --since`
 * and the parser tier.
 *
 * @req docguard.js-import-edges#FR-001
 * @req docguard.js-import-edges#FR-002
 * @req docguard.js-import-edges#FR-003
 * @req docguard.js-import-edges#FR-004
 * @req docguard.js-import-edges#FR-005
 * @req docguard.js-import-edges#FR-006
 * @req docguard.js-import-edges#FR-007
 * @req docguard.js-import-edges#FR-008
 * @req docguard.js-import-edges#SC-001
 * @req docguard.js-import-edges#SC-002
 * @req docguard.js-import-edges#SC-003
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import {
  buildImportGraph, clearImportGraphCache, extractImports, extractImportsFromText,
  importNamesBySpec, readImports, reverseImportAncestors, reverseImportIndex,
} from '../cli/scanners/import-graph.mjs';
import { renderModuleGraph } from '../cli/scanners/module-diagram.mjs';
import { validateArchitecture } from '../cli/validators/architecture.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { UNPARSEABLE } from './fixtures/js-ts-projects.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => clearImportGraphCache());
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-076-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const specs = imports => imports.map(i => `${i.spec}${i.dynamic ? ' (dynamic)' : ''}`).sort();
const edges = graph => graph.edges.map(e => `${e.from}->${e.to}${e.dynamic ? ' (dynamic)' : ''}`).sort();
const names = n => n && { named: [...n.named].sort(), default: n.default, namespace: n.namespace, all: n.all };
const NONE = { named: [], default: false, namespace: null, all: false };

// Every form FR-001 lists, the multi-line ones included.
const EVERY_FORM = `import type { A } from './types';
import type {
  B,
  C,
} from './more-types';
import d, { e, f as g } from './mixed';
import {
  h,
  i,
} from './multi';
import * as ns from './ns';
import './side-effect';
export * from './barrel';
export * as nsb from './barrel-ns';
export {
  j,
} from './reexport';
export type { K } from './type-reexport';
import l = require('./ts-require');
const m = require('./cjs');
const { n, o: p } = require('./cjs-destructure');
const q = require('./cjs-member').q;
const lazy = () => import('./lazy');
let t: import('./type-query').T;
`;

const EVERY_FORM_SPECS = [
  './barrel', './barrel-ns', './cjs', './cjs-destructure', './cjs-member', './lazy (dynamic)',
  './mixed', './more-types', './multi', './ns', './reexport', './side-effect', './ts-require',
  './type-query (dynamic)', './type-reexport', './types',
];

// ── FR-001 / FR-002: the syntax-tree tier ───────────────────────────────────

describe('FR-001, FR-002: imports are read from the syntax tree', () => {
  it('reads the multi-line named import of the bug report', () => {
    const { imports, tier } = readImports('import {\n  a,\n  b,\n} from "./x.mjs";\nimport c from "./y.mjs";\n', 'a.mjs');
    assert.equal(tier, 'js-ast');
    assert.deepEqual(specs(imports), ['./x.mjs', './y.mjs']);
    assert.deepEqual(specs(extractImports('import {\n  a,\n  b,\n} from "./x.mjs";\nimport c from "./y.mjs";\n')), ['./x.mjs', './y.mjs']);
  });

  it('reads every import form, with import() and type queries dynamic and the rest static', () => {
    const { imports, tier } = readImports(EVERY_FORM, 'every.ts');
    assert.equal(tier, 'js-ast');
    assert.deepEqual(specs(imports), EVERY_FORM_SPECS);
  });

  it('reads imports inside an ambient module declaration', () => {
    const { imports } = readImports("declare module 'pkg' {\n  export * from './impl';\n  import type {\n    T,\n  } from './types';\n}\n", 'pkg.d.ts');
    assert.deepEqual(specs(imports), ['./impl', './types']);
  });

  it('reads a template literal without substitutions as a static specifier, and not one with them', () => {
    const { imports } = readImports('const a = require(`./a.js`);\nconst b = require(`./${name}.js`);\nconst c = import(`./c.js`);\n', 'a.js');
    assert.deepEqual(specs(imports), ['./a.js', './c.js (dynamic)']);
  });

  it('records nothing for text that only spells an import', () => {
    const src = [
      "const fixture = `import x from './y.js';`;",
      "// import { a } from './old.js';",
      "/* import b from './older.js'; */",
      "const s = \"require('./not-required')\";",
      "// a line comment: import('./line-comment.js')",
      'const r = require.resolve("./resolved.js");',
      'const v = require(name);',
      '',
    ].join('\n');
    assert.deepEqual(readImports(src, 'a.mjs').imports, []);
  });

  it('keeps a JSDoc import() type reference as a dynamic edge, as the pattern reader did', () => {
    const src = "/** @param {import('./types.js').Order} order */\nexport function total(order) { return order.n; }\n";
    assert.deepEqual(specs(readImports(src, 'a.mjs').imports), ['./types.js (dynamic)']);
  });
});

// ── FR-003: the pattern fallback ────────────────────────────────────────────

describe('FR-003: the fallback reads a clause across lines but never across statements', () => {
  it('returns the same specifiers as the syntax tree for every form', () => {
    assert.deepEqual(specs(extractImportsFromText(EVERY_FORM)), EVERY_FORM_SPECS);
  });

  it('reads the multi-line import of a file that does not parse', () => {
    const { imports, tier } = readImports(`${UNPARSEABLE}import {\n  a,\n  b,\n} from './x.mjs';\n`, 'broken.mjs');
    assert.equal(tier, 'regex-fallback');
    assert.deepEqual(specs(imports), ['./x.mjs']);
  });

  it('does not swallow the next statement after a side-effect import', () => {
    assert.deepEqual(specs(extractImportsFromText("import './polyfill';\nconst s = \"x\";\nimport a from './a';\n")), ['./a', './polyfill']);
    assert.deepEqual(specs(extractImportsFromText("import './polyfill'\nconst label = 'x'\nimport a from './a'\n")), ['./a', './polyfill']);
  });

  it('reads a default import whose from is on the next line, and not an identifier that starts with import', () => {
    assert.deepEqual(specs(extractImportsFromText("import def\n  from './def';\nreimport stuff from './no';\n")), ['./def']);
  });
});

// ── FR-004: the names each edge binds ───────────────────────────────────────

describe('FR-004: bound names come from the same parse', () => {
  it('reads named, default, namespace, require and re-export bindings', () => {
    const { namesBySpec } = readImports(EVERY_FORM, 'every.ts');
    const got = Object.fromEntries([...namesBySpec].map(([k, v]) => [k, names(v)]));
    assert.deepEqual(got, {
      './types': { ...NONE, named: ['A'] },
      './more-types': { ...NONE, named: ['B', 'C'] },
      './mixed': { ...NONE, named: ['e', 'f'], default: true },
      './multi': { ...NONE, named: ['h', 'i'] },
      './ns': { ...NONE, namespace: 'ns' },
      './side-effect': NONE,
      './barrel': { ...NONE, all: true },
      './barrel-ns': { ...NONE, all: true },
      './reexport': { ...NONE, all: true },
      './type-reexport': { ...NONE, all: true },
      './ts-require': { ...NONE, namespace: 'l' },
      './cjs': { ...NONE, namespace: 'm' },
      './cjs-destructure': { ...NONE, named: ['n', 'o'] },
      './cjs-member': { ...NONE, named: ['q'] },
    });
  });

  it('keeps every name of a multi-line clause that holds a comment', () => {
    const src = "import {\n  formatTotal, // keeps the caller's rounding\n  parse,\n} from './money.mjs';\n";
    assert.deepEqual(names(readImports(src, 'a.mjs').namesBySpec.get('./money.mjs')), { ...NONE, named: ['formatTotal', 'parse'] });
  });

  it('reads { default as x } as the default import', () => {
    assert.deepEqual(names(readImports("import { default as x, y } from './m';\n", 'a.mjs').namesBySpec.get('./m')), { ...NONE, named: ['y'], default: true });
  });

  it('leaves the names unknown when a form binds what the tree cannot list', () => {
    const src = [
      "import { a } from './dyn';",
      "const later = await import('./dyn');",
      "module.exports = require('./bare');",
      "const { b, ...rest } = require('./rest');",
      "const { [key]: c } = require('./computed');",
      '',
    ].join('\n');
    const { namesBySpec, imports } = readImports(src, 'a.mjs');
    assert.deepEqual(specs(imports), ['./bare', './computed', './dyn', './dyn (dynamic)', './rest']);
    for (const spec of ['./dyn', './bare', './rest', './computed']) assert.equal(namesBySpec.get(spec), undefined, spec);
  });

  it('the fallback reads multi-line clauses, and a comment no longer drops the next name', () => {
    const got = importNamesBySpec("import d, {\n  e, // the total\n  f as g,\n} from './mixed';\nimport type {\n  B,\n} from './types';\n");
    assert.deepEqual(names(got.get('./mixed')), { ...NONE, named: ['e', 'f'], default: true });
    assert.deepEqual(names(got.get('./types')), { ...NONE, named: ['B'] });
  });

  it('the graph carries the names on the edge of a multi-line import', () => {
    const dir = project({
      'src/money.mjs': 'export const formatTotal = 1;\nexport const parse = 2;\n',
      'src/cart.mjs': "import {\n  formatTotal, // keeps the caller's rounding\n  parse,\n} from './money.mjs';\nexport const c = formatTotal + parse;\n",
    });
    const edge = buildImportGraph(dir, {}).edges.find(e => e.from === 'src/cart.mjs');
    assert.deepEqual(names(edge.names), { ...NONE, named: ['formatTotal', 'parse'] });
  });
});

// ── Consumers: cycles, layers, diagram, diff --since ────────────────────────

describe('FR-002, FR-005: Architecture sees multi-line imports', () => {
  it('reports a cycle closed by a multi-line import, and none closed by import()', () => {
    const cyclic = project({
      'src/a.mjs': "import { b } from './b.mjs';\nexport const a = 1;\n",
      'src/b.mjs': "import {\n  a,\n} from './a.mjs';\nexport const b = a;\n",
    });
    const arc002 = validateArchitecture(cyclic, {}).findings.filter(f => f.code === 'ARC002');
    assert.equal(arc002.length, 1);
    assert.equal(arc002[0].parserTier, 'js-ast');
    clearImportGraphCache();
    const lazy = project({
      'src/a.mjs': "import { b } from './b.mjs';\nexport const a = 1;\n",
      'src/b.mjs': "export const b = async () => (await import(\n  './a.mjs'\n)).a;\n",
    });
    assert.deepEqual(edges(buildImportGraph(lazy, {})), ['src/a.mjs->src/b.mjs', 'src/b.mjs->src/a.mjs (dynamic)']);
    assert.equal(validateArchitecture(lazy, {}).findings.filter(f => f.code === 'ARC002').length, 0);
  });

  it('reports a multi-line import across a declared layer boundary (ARC003)', () => {
    const dir = project({
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Layer Boundaries\n\n| Layer | Can Import | Cannot Import |\n|---|---|---|\n| Routes | Services | Db |\n| Db | | Routes |\n',
      'src/db/store.mjs': 'export const load = 1;\nexport const save = 2;\nexport const drop = 3;\n',
      'src/routes/orders.mjs': "import {\n  load,\n  save,\n  drop,\n} from '../db/store.mjs';\nexport const r = load + save + drop;\n",
    });
    const arc003 = validateArchitecture(dir, {}).findings.filter(f => f.code === 'ARC003');
    assert.equal(arc003.length, 1);
    assert.equal(arc003[0].location, 'src/routes/orders.mjs');
    assert.equal(arc003[0].parserTier, 'js-ast');
  });

  it('reports a multi-line import across configured layers (ARC001)', () => {
    const dir = project({
      'src/db/store.mjs': 'export const load = 1;\n',
      'src/routes/orders.mjs': "import {\n  load,\n} from '../../src/db/store.mjs';\nexport const r = load;\n",
    });
    const arc001 = validateArchitecture(dir, {
      layers: { routes: { dir: 'src/routes', canImport: [] }, db: { dir: 'src/db', canImport: [] } },
    }).findings.filter(f => f.code === 'ARC001');
    assert.equal(arc001.length, 1);
    assert.equal(arc001[0].parserTier, 'js-ast');
  });
});

describe('US2: the module diagram and diff --since follow the same edges', () => {
  it('draws the module edge of a multi-line import', () => {
    const dir = project({
      'src/core/service.mjs': 'export const run = 1;\nexport const stop = 2;\n',
      'src/api/routes.mjs': "import {\n  run,\n  stop,\n} from '../core/service.mjs';\nexport const r = run + stop;\n",
    });
    const diagram = renderModuleGraph(buildImportGraph(dir, {}), {});
    assert.equal(diagram.completeness, 'complete');
    assert.match(diagram.body, /m_src_api --> m_src_core/);
  });

  it('lists a doc as indirectly affected through a multi-line import', () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
      'src/core.mjs': 'export function a() { return 1; }\nexport function b() { return 2; }\n',
      'src/adapter.mjs': "import {\n  a,\n  b,\n} from './core.mjs';\nexport const c = () => a() + b();\n",
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nThe adapter is `src/adapter.mjs`.\n',
    });
    const { reverseEdges } = reverseImportIndex(buildImportGraph(dir, {}));
    assert.deepEqual([...reverseImportAncestors('src/core.mjs', reverseEdges)], [['src/adapter.mjs', 1]]);
    fixtureGit(dir, ['init', '-q']);
    fixtureGit(dir, ['config', 'user.email', 't@example.com']);
    fixtureGit(dir, ['config', 'user.name', 't']);
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'base']);
    writeFileSync(join(dir, 'src/core.mjs'), 'export function a() { return 3; }\nexport function b() { return 2; }\n');
    fixtureGit(dir, ['commit', '-qam', 'change core']);
    const r = spawnSync(process.execPath, [CLI, 'diff', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(r.stdout);
    assert.deepEqual(data.indirectDocs.map(d => [d.doc, d.chains.map(ch => ch.via)]), [['ARCHITECTURE.md', ['src/adapter.mjs']]], r.stdout);
  });
});

// ── FR-008: tiers and limitations ───────────────────────────────────────────

describe('FR-008: the graph says which tier read each file', () => {
  it('tags edges with their tier and makes a parse failure a limitation that leaves the diagram complete', () => {
    const dir = project({
      'src/a.mjs': "import { b } from './b.mjs';\nexport const a = 1;\n",
      'src/b.mjs': `${UNPARSEABLE}import {\n  a,\n} from './a.mjs';\nexport const b = a;\n`,
    });
    const graph = buildImportGraph(dir, {});
    assert.deepEqual(graph.edges.map(e => [e.from, e.tier]).sort(), [['src/a.mjs', 'js-ast'], ['src/b.mjs', 'regex-fallback']]);
    assert.deepEqual(graph.limitations.map(l => [l.code, l.file]), [['js-parse-failed', 'src/b.mjs']]);
    const result = validateArchitecture(dir, {});
    assert.equal(result.applicability.status, 'partial');
    assert.match(result.applicability.reason, /pattern fallback/);
    assert.equal(result.findings.find(f => f.code === 'ARC002').parserTier, 'mixed');
    assert.equal(renderModuleGraph(graph, {}).completeness, 'complete');
  });

  it('without the parser, every file falls back, the graph says so once, and the diagram is partial', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docguard-076-noparser-'));
    dirs.push(tmp);
    cpSync(resolve('cli'), join(tmp, 'cli'), { recursive: true });
    const dir = project({
      'src/api/routes.mjs': "import {\n  run,\n} from '../core/service.mjs';\nexport const r = run;\n",
      'src/core/service.mjs': 'export const run = 1;\n',
    });
    const script = `
      const url = p => ${JSON.stringify(pathToFileURL(join(tmp, 'cli')).href)} + p;
      const { astTierAvailable } = await import(url('/scanners/js-ast.mjs'));
      const { buildImportGraph } = await import(url('/scanners/import-graph.mjs'));
      const { renderModuleGraph } = await import(url('/scanners/module-diagram.mjs'));
      const { validateArchitecture } = await import(url('/validators/architecture.mjs'));
      const graph = buildImportGraph(${JSON.stringify(dir)}, {});
      console.log(JSON.stringify({
        ast: astTierAvailable(),
        edges: graph.edges.map(e => [e.from, e.to, e.tier]),
        limitations: graph.limitations,
        diagram: renderModuleGraph(graph, {}).completeness,
        applicability: validateArchitecture(${JSON.stringify(dir)}, {}).applicability,
      }));`;
    const env = { ...process.env };
    delete env.NODE_PATH;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: tmp, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ast, false);
    assert.deepEqual(out.edges, [['src/api/routes.mjs', 'src/core/service.mjs', 'regex-fallback']]);
    assert.deepEqual(out.limitations, [{ code: 'js-parser-unavailable', files: 2 }]);
    assert.equal(out.diagram, 'partial');
    assert.equal(out.applicability.status, 'partial');
    assert.match(out.applicability.reason, /parser unavailable/);
  });

  it('Python findings carry py-ast', { skip: pyAstAvailable() ? false : 'python3 not on PATH' }, () => {
    const dir = project({
      'pyproject.toml': '[project]\nname="service"\n',
      'src/service/__init__.py': '',
      'src/service/routes.py': 'from . import storage\n',
      'src/service/storage.py': 'from service.routes import handler\n',
    });
    assert.ok(buildImportGraph(dir, {}).edges.every(e => e.tier === 'py-ast'));
    assert.equal(validateArchitecture(dir, {}).findings.find(f => f.code === 'ARC002').parserTier, 'py-ast');
  });
});

// ── SC-002, FR-006, FR-007: this repository and its docs ────────────────────

describe('SC-002: DocGuard\'s own graph', () => {
  const repoConfig = JSON.parse(readFileSync(resolve('.docguard.json'), 'utf8'));
  const cliFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory()
    ? cliFiles(join(dir, d.name)) : /\.mjs$/.test(d.name) ? [join(dir, d.name)] : []));

  it('has an edge for every multi-line import and every re-export in cli/', () => {
    // Read line by line, independently of both tiers: an `import {` or
    // `export {` line with no `from`, closed by a `} from '…';` line, and any
    // one-line re-export.
    const expected = [];
    for (const file of cliFiles(resolve('cli'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        let spec = null;
        if (/^(?:import|export)(?: type)? \{$/.test(line) || /^import \w+, \{$/.test(line)) {
          const close = lines.slice(i + 1).find(l => /^\}/.test(l));
          spec = close && /^\} from '(\.[^']+)';$/.exec(close)?.[1];
        } else {
          spec = /^export (?:\*|\* as \w+|\{[^}]*\}) from '(\.[^']+)';$/.exec(line)?.[1];
        }
        if (!spec) return;
        const target = resolve(dirname(file), spec);
        if (existsSync(target)) expected.push(`${relative(process.cwd(), file)}->${relative(process.cwd(), target)}`);
      });
    }
    assert.ok(expected.length >= 15, `found ${expected.length}`);
    const graph = edges(buildImportGraph(process.cwd(), repoConfig));
    assert.deepEqual(expected.filter(e => !graph.includes(e)), []);
  });

  it('has no edge from the test-file source cli/feedback-fixture.mjs writes into a template literal', () => {
    assert.match(readFileSync(resolve('cli/feedback-fixture.mjs'), 'utf8'), /from '\.\.\/cli\/commands\/guard\.mjs'/);
    const graph = edges(buildImportGraph(process.cwd(), repoConfig));
    assert.deepEqual(graph.filter(e => e.startsWith('cli/feedback-fixture.mjs->')), []);
  });
});

describe('FR-006, FR-007, SC-003: the docs and the CHANGELOG say what changed', () => {
  const read = rel => readFileSync(resolve(rel), 'utf8');

  it('the CHANGELOG records the effect on this repository under ### Fixed, with the adopter note', () => {
    const lines = read('CHANGELOG.md').split('\n');
    const at = lines.findIndex(l => l.includes('specs/076-js-import-edges'));
    assert.ok(at > 0, 'entry present');
    const heading = lines.slice(0, at).reverse().find(l => /^#{2,3} /.test(l));
    assert.equal(heading, '### Fixed');
    const next = lines.findIndex((l, i) => i > at && /^(- \*\*|#{2,3} )/.test(l));
    const entry = lines.slice(at, next).join(' ');
    assert.match(entry, /What changes for adopters/);
    assert.match(entry, /ARC002/);
    assert.match(entry, /GST002/);
    assert.match(entry, /What changes on DocGuard itself/);
    assert.match(entry, /Architecture\s+finding before or after/);
    assert.match(entry, /module-graph section/);
  });

  it('ARCHITECTURE.md, the language reference and TEST-SPEC describe the two tiers', () => {
    const arch = read('docs-canonical/ARCHITECTURE.md');
    assert.match(arch, /JS\/TS imports come from the Babel syntax tree/);
    assert.match(arch, /`js-parser-unavailable`/);
    assert.match(arch, /`js-parse-failed`/);
    const languages = read('docs/reference/languages.md');
    assert.match(languages, /never a `;` or a quote/);
    assert.match(languages, /`import type` is a static edge/);
    assert.match(read('docs-canonical/TEST-SPEC.md'), /tests\/js-import-edges\.test\.mjs/);
  });
});
