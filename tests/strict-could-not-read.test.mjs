/**
 * Strict mode blocks only what a project can resolve (specs/097-strict-by-default
 * FR-007 as amended, T018a): a validator that applies, performed nothing, and has
 * cause needs-declaration or needs-content, or one that could not observe at all.
 * A partial result and an unread layout go to a "could not read" list and leave the
 * exit code alone. API-Surface, Docs-Sync and Surface-Sync follow the same rules in
 * their fix text (T018b to T018d for these three validators).
 *
 * @req docguard.strict-by-default#FR-007
 * @req docguard.strict-by-default#FR-014
 * @req docguard.strict-by-default#FR-015
 * @req docguard.strict-by-default#FR-006
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { isolateWithWaivers } from './helpers/strict-isolation.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';
import * as enforcement from '../cli/enforcement.mjs';

const { buildStrictReport, strictBlocks, adoptLines } = enforcement;
const couldNotReadLines = (...a) => enforcement.couldNotReadLines(...a);
import { applies as apiApplies } from '../cli/validators/api-surface.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

const temporary = [];
function scratch(prefix) {
  const dir = makeTempDir(prefix);
  temporary.push(dir);
  return dir;
}
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

const ALL_KEYS = [
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
const only = (...keys) => Object.fromEntries(ALL_KEYS.map(k => [k, keys.includes(k)]));

/** A committed fixture project with strict (or another mode) and only the named validators on. */
function project(inputFiles, { validators, enforcement = 'strict', extra = {} } = {}) {
  const dir = scratch('docguard-cnr-');
  const isolated = isolateWithWaivers(inputFiles, { validators, enforcement });
  const files = isolated.files;
  validators = isolated.config.validators;
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  const config = {
    projectName: 'cnr-fixture', version: '0.6', requiredFiles: { canonical: [], agentFile: [] },
    ...(validators ? { validators } : {}), ...(enforcement ? { enforcement } : {}), ...extra,
  };
  write(dir, '.docguard.json', JSON.stringify(config, null, 2));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function guard(dir, args = [], cli = CLI) {
  const r = spawnSync(process.execPath, [cli, 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function guardJson(dir, extra = [], cli = CLI) {
  const r = guard(dir, ['--format', 'json', ...extra], cli);
  return { ...r, json: JSON.parse(r.out) };
}
const entry = (json, key) => json.validators.find(v => v.key === key);

// ── the rule, on synthetic results ──────────────────────────────────────────
const result = (key, verdict, extra = {}) => ({ key, name: key, verdict, findings: [], applicability: { status: 'checked', reason: `${key} reason` }, ...extra });

describe('FR-007: what strict blocks, from validator results', () => {
  const report = buildStrictReport([
    result('declare', 'empty', { emptyCause: 'needs-declaration', performed: 0, howToConfigure: 'declare it' }),
    result('content', 'empty', { emptyCause: 'needs-content', performed: 0, howToConfigure: 'write it' }),
    result('layout', 'empty', { emptyCause: 'layout-not-recognized', performed: 0, howToConfigure: 'n/a', layouts: ['src/routes'] }),
    result('partial', 'inconclusive', { performed: 3, applicability: { status: 'partial', reason: '2 routes could not be read' } }),
    result('blind', 'inconclusive', { performed: 0, applicability: { status: 'missing-prerequisite', reason: 'git unreadable' } }),
    result('broken', 'blocked', { applicability: { status: 'error', reason: 'validator crashed' } }),
    result('fine', 'pass', { performed: 4 }),
  ]);

  it('blocks needs-declaration, needs-content, zero-check inconclusive and blocked', () => {
    assert.deepEqual([...report.blocking].sort(), ['blind', 'broken', 'content', 'declare']);
    assert.equal(strictBlocks({ strict: report }), true);
  });

  it('moves a partial result and an unread layout to couldNotRead, with what was missed', () => {
    assert.deepEqual(report.couldNotRead.map(c => c.validator).sort(), ['layout', 'partial']);
    const partial = report.couldNotRead.find(c => c.validator === 'partial');
    assert.equal(partial.reason, '2 routes could not be read');
    assert.equal(partial.verdict, 'inconclusive');
    const layout = report.couldNotRead.find(c => c.validator === 'layout');
    assert.equal(layout.cause, 'layout-not-recognized');
    assert.deepEqual(layout.layouts, ['src/routes']);
  });

  it('keeps couldNotRead out of unexamined, so Adopt never asks for a fix a project cannot make', () => {
    assert.ok(report.unexamined.every(u => !['layout', 'partial'].includes(u.validator)));
    assert.ok(!adoptLines(report).join('\n').includes('layout'));
  });

  it('does not block when only a partial result and an unread layout remain', () => {
    const quiet = buildStrictReport([
      result('layout', 'empty', { emptyCause: 'layout-not-recognized', performed: 0 }),
      result('partial', 'inconclusive', { performed: 1 }),
    ]);
    assert.deepEqual(quiet.blocking, []);
    assert.equal(strictBlocks({ strict: quiet }), false);
    assert.equal(quiet.couldNotRead.length, 2);
  });

  it('renders the list as text: what was missed, and the layouts a validator reads', () => {
    const text = couldNotReadLines(report).join('\n');
    assert.match(text, /^DocGuard could not read:/);
    assert.match(text, /layout/);
    assert.match(text, /2 routes could not be read/);
    assert.match(text, /src\/routes/);
    assert.deepEqual(couldNotReadLines(buildStrictReport([result('fine', 'pass', { performed: 1 })])), []);
  });
});

// ── end to end: a partial API-Surface ───────────────────────────────────────
const PARTIAL_API = {
  'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { express: '4.18.2' } }),
  'src/app.js': "const express = require('express');\nconst app = express();\nconst dynamic = process.env.PREFIX;\napp.get('/users', (req, res) => res.json([]));\napp.get(dynamic, (req, res) => res.json([]));\nmodule.exports = app;\n",
  'docs-canonical/API-REFERENCE.md': '# API\n\n| Method | Path |\n|---|---|\n| GET | `/users` |\n',
};

describe('a partial API-Surface result under strict', () => {
  const dir = project(PARTIAL_API, { validators: only('apiSurface') });

  it('is inconclusive with a check performed, and names what could not be read', () => {
    const { json } = guardJson(dir);
    const api = entry(json, 'apiSurface');
    assert.equal(api.verdict, 'inconclusive');
    assert.ok(api.performed >= 1);
    const item = json.strict.couldNotRead.find(c => c.validator === 'apiSurface');
    assert.ok(item, 'listed as could not read');
    assert.match(item.reason, /could not be read statically/);
    assert.match(item.reason, /src\/app\.js:5/);
  });

  it('does not exit 4, and is not in strict.blocking or strict.unexamined', () => {
    const { status, json } = guardJson(dir);
    assert.notEqual(status, 4);
    assert.ok(!json.strict.blocking.includes('apiSurface'));
    assert.ok(!json.strict.unexamined.some(u => u.validator === 'apiSurface'));
  });

  it('prints the could-not-read block, after the Adopt block when there is one', () => {
    const r = guard(dir);
    assert.match(r.out, /DocGuard could not read:/);
    assert.match(r.out, /API-Surface/);
    assert.match(r.out, /src\/app\.js:5/);
    assert.ok(!/Adopt — what strict found/.test(r.out) || r.out.indexOf('Adopt —') < r.out.indexOf('DocGuard could not read:'));
  });

  it('keeps --fail-on-inconclusive exactly as before: it exits 4 for a project that asks', () => {
    assert.equal(guard(dir, ['--fail-on-inconclusive']).status, 4);
  });

  it('keeps SARIF and JUnit rendering it as inconclusive', () => {
    const sarif = JSON.parse(guard(dir, ['--format', 'sarif']).out);
    const notes = sarif.runs[0].invocations[0].toolExecutionNotifications || [];
    assert.ok(notes.some(n => /API-Surface|apiSurface/.test(JSON.stringify(n))), 'a notification names the validator');
    assert.match(guard(dir, ['--format', 'junit']).out, /apiSurface|API-Surface/);
  });

  it('under standard there is no strict block and the exit code is unchanged', () => {
    const std = project(PARTIAL_API, { validators: only('apiSurface'), enforcement: 'standard' });
    const { json, status } = guardJson(std);
    assert.equal(json.strict, undefined);
    assert.notEqual(status, 4);
    assert.equal(guard(std, ['--fail-on-inconclusive']).status, 4);
  });
});

describe('an optional parser that is missing does not block a strict run', () => {
  // A copy of the CLI without node_modules has no JS/TS parser; Architecture falls back to patterns and still
  // checks the import graph (the DocGuard scratch clone showed Architecture and Doc-Dependency inconclusive).
  const copy = scratch('docguard-noparser-');
  for (const part of ['cli', 'schemas', 'package.json']) cpSync(join(ROOT, part), join(copy, part), { recursive: true });
  const cli = join(copy, 'cli', 'docguard.mjs');
  const dir = project({
    'package.json': JSON.stringify({ name: 'lib', version: '1.0.0' }),
    'src/a.js': "import { b } from './b.js';\nexport const a = b;\n",
    'src/b.js': 'export const b = 1;\n',
  }, { validators: only('architecture') });

  it('Architecture is inconclusive with a check performed and is listed as could not read', () => {
    const { json } = guardJson(dir, [], cli);
    const arch = entry(json, 'architecture');
    assert.equal(arch.verdict, 'inconclusive');
    assert.ok(arch.performed >= 1, 'the fallback still performed the cycle check');
    assert.ok(json.strict.couldNotRead.some(c => c.validator === 'architecture'));
    assert.ok(!json.strict.blocking.includes('architecture'));
  });
});

// ── API-Surface ─────────────────────────────────────────────────────────────
describe('API-Surface does not apply to a UI project with no HTTP route', () => {
  const UI = {
    'package.json': JSON.stringify({ name: 'game', version: '1.0.0', dependencies: { react: '18.2.0', 'react-dom': '18.2.0' } }),
    'src/App.jsx': 'export const App = () => null;\n',
  };

  it('applies() says no, naming the UI framework and the missing route', () => {
    const dir = project(UI, { enforcement: null });
    const a = apiApplies(dir, { projectName: 'x' });
    assert.equal(a.applies, false);
    assert.match(a.evidence, /React/);
    assert.match(a.evidence, /no (HTTP )?route/i);
  });

  it('is skipped under strict and does not block', () => {
    const dir = project(UI, { validators: only('apiSurface') });
    const { json } = guardJson(dir);
    assert.equal(entry(json, 'apiSurface').verdict, 'skipped');
    assert.ok(!json.strict.blocking.includes('apiSurface'));
  });

  it('still applies when a UI framework sits beside a server framework in the same manifest', () => {
    const both = project({
      'package.json': JSON.stringify({ name: 'mono', version: '1.0.0', dependencies: { react: '18.2.0', express: '4.18.2' } }),
      'src/App.jsx': 'export const App = () => null;\n',
    }, { enforcement: null });
    assert.equal(apiApplies(both, { projectName: 'x' }).applies, true);
  });

  it('still applies to a Next.js project (its app/api folder holds routes)', () => {
    const next = project({
      'package.json': JSON.stringify({ name: 'web', version: '1.0.0', dependencies: { next: '14.0.0', react: '18.2.0' } }),
      'app/page.jsx': 'export default function P() { return null; }\n',
    }, { enforcement: null });
    assert.equal(apiApplies(next, { projectName: 'x' }).applies, true);
  });
});

describe('API-Surface reads the API reference where docs.roles maps it', () => {
  const ROUTES = {
    'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { express: '4.18.2' } }),
    'src/routes/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.json([]));\nmodule.exports = router;\n",
  };
  const fix = (json) => entry(json, 'apiSurface').howToConfigure;

  it('compares a mapped document that exists', () => {
    const dir = project({ ...ROUTES, 'docs/api.md': '# API\n\n| Method | Path |\n|---|---|\n| GET | `/users` |\n' },
      { validators: only('apiSurface'), extra: { docs: { roles: { apiReference: 'docs/api.md' } } } });
    const api = entry(guardJson(dir).json, 'apiSurface');
    assert.ok(api.performed >= 1, 'the mapped document was compared with the route');
    assert.equal(api.verdict, 'pass');
  });

  it('a mapped document that does not exist: the fix names the mapping before it suggests creating a file', () => {
    const dir = project(ROUTES, { validators: only('apiSurface'), extra: { docs: { roles: { apiReference: 'docs/api.md' } } } });
    const text = fix(guardJson(dir).json);
    assert.match(text, /docs\.roles/);
    assert.match(text, /docs\/api\.md/);
    assert.ok(text.indexOf('docs.roles') < text.search(/\bcreate\b/i), 'the mapping comes first');
  });

  it('an unmapped missing document: the fix offers the mapping first, then creating the default file', () => {
    const dir = project(ROUTES, { validators: only('apiSurface') });
    const text = fix(guardJson(dir).json);
    assert.match(text, /docs\.roles/);
    assert.match(text, /apiReference/);
    assert.match(text, /docs-canonical\/API-REFERENCE\.md/);
    assert.ok(text.indexOf('docs.roles') < text.search(/\bcreate\b/i), 'the mapping comes first');
  });
});

// ── Docs-Sync ───────────────────────────────────────────────────────────────
describe('Docs-Sync fix text', () => {
  const docsSync = (files, extra) => {
    const dir = project(files, { validators: only('docsSync'), extra });
    const { json } = guardJson(dir);
    return { json, v: entry(json, 'docsSync') };
  };
  const MOVE = /\b(move|relocate|rename)\b/i;

  it('a Python service under app/api is an unread layout: it says route.ts is the only file read there, and never says move', () => {
    const { json, v } = docsSync({ 'app/api/users.py': 'def users():\n    return []\n', 'README.md': '# svc\n' });
    assert.equal(v.verdict, 'empty');
    assert.equal(v.emptyCause, 'layout-not-recognized');
    assert.doesNotMatch(v.howToConfigure, MOVE);
    assert.match(v.howToConfigure, /route\.(ts|js)/);
    assert.equal(json.strict.blocking.includes('docsSync'), false);
    assert.ok(json.strict.couldNotRead.some(c => c.validator === 'docsSync'));
  });

  it('a serverless handlers directory: no setting reads it, so the text says so and does not ask for a move or a sourceRoot', () => {
    const { v } = docsSync({ 'handlers/orders.js': 'exports.handler = async () => ({});\n', 'README.md': '# svc\n' });
    assert.equal(v.emptyCause, 'layout-not-recognized');
    assert.doesNotMatch(v.howToConfigure, MOVE);
    assert.doesNotMatch(v.howToConfigure, /Setting "sourceRoot"/);
    assert.match(v.howToConfigure, /handlers/);
    assert.match(v.howToConfigure, /issues/);
  });

  it('routes under a package directory: the text names the sourceRoot that makes them readable, from the files found', () => {
    const { v } = docsSync({ 'apps/api/src/routes/users.js': 'module.exports = {};\n', 'README.md': '# svc\n' });
    assert.equal(v.emptyCause, 'layout-not-recognized');
    assert.doesNotMatch(v.howToConfigure, MOVE);
    assert.match(v.howToConfigure, /sourceRoot[^]*apps\/api/);
    // and the setting really does make it read them
    const fixed = docsSync({ 'apps/api/src/routes/users.js': 'module.exports = {};\n', 'README.md': '# svc\n' }, { sourceRoot: 'apps/api' });
    assert.notEqual(fixed.v.emptyCause, 'layout-not-recognized');
  });

  it('claims to read only what it reads: the listed directories are the ones it walks, with the Next.js route-file rule', () => {
    const { v } = docsSync({ 'handlers/orders.js': 'exports.handler = 1;\n', 'README.md': '# svc\n' });
    const text = `${v.howToConfigure}\n${v.applicability?.reason || ''}`;
    assert.match(text, /src\/routes/);
    assert.match(text, /app\/api/);
    assert.match(text, /route\.(ts|js)/);
  });
});

// ── Surface-Sync (the proof found it good: only the rules, asserted) ────────
describe('Surface-Sync fix text follows the same rules', () => {
  it('never tells a project to move code or documents, in any of its causes', () => {
    const cases = [
      [{ 'cli/commands/a.mjs': '', 'README.md': '# R\n' }, {}],
      [{ 'cli/commands/a.mjs': '', 'README.md': '# R\n' }, { surfaceSync: { surfaces: [{ name: 'commands', glob: 'bin/*.mjs', docs: ['README.md'] }] } }],
      [{ 'cli/commands/a.mjs': '' }, { surfaceSync: { surfaces: [{ name: 'commands', glob: 'cli/commands/*.mjs', docs: ['docs/COMMANDS.md'] }] } }],
    ];
    for (const [files, extra] of cases) {
      const dir = project({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }), ...files }, { validators: only('surfaceSync'), extra });
      const v = entry(guardJson(dir).json, 'surfaceSync');
      if (v.howToConfigure) assert.doesNotMatch(v.howToConfigure, /\b(move|relocate|rename)\b/i);
    }
  });

  it('an unmatched glob is an unread layout: listed as could not read, exit code untouched', () => {
    const dir = project({ 'cli/commands/a.mjs': '', 'README.md': '# R\n' },
      { validators: only('surfaceSync'), extra: { surfaceSync: { surfaces: [{ name: 'commands', glob: 'bin/*.mjs', docs: ['README.md'] }] } } });
    const { json } = guardJson(dir);
    assert.equal(entry(json, 'surfaceSync').emptyCause, 'layout-not-recognized');
    assert.ok(json.strict.couldNotRead.some(c => c.validator === 'surfaceSync'));
    assert.ok(!json.strict.blocking.includes('surfaceSync'));
  });
});
