/**
 * The fixtures of group A of spec 097 (applies and empty, does not apply, the fix applied),
 * shared by tests/validator-applicability-a.test.mjs and the registry-wide check of
 * tests/strict-by-default.test.mjs, so both read one table.
 */
import { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURE_GIT } from './git.mjs';
import { runGuardInternal } from '../../cli/commands/guard.mjs';
import { loadConfig } from '../../cli/config.mjs';

export const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

/** A fixture project; `git: false` leaves it outside a repository, `commits` adds history. */
export function project(files, config, { git = true, commits = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-applies-a-'));
  temporary.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config, null, 2));
  if (!git) return dir;
  const run = (...args) => execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  run('init', '-q', '-b', 'main');
  run('add', '-A');
  run('commit', '-q', '-m', 'init');
  for (let i = 1; i < commits; i++) {
    writeFileSync(join(dir, 'history.txt'), `${i}\n`);
    run('add', '-A');
    run('commit', '-q', '-m', `change ${i}`);
  }
  return dir;
}

export const KEYS = [
  'structure', 'docSections', 'drift', 'changelog', 'testSpec', 'environment', 'architecture', 'freshness',
  'traceability', 'docsDiff', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync',
  'specKit', 'documentLifecycle',
];
// Every other validator is switched off so a fixture measures one validator.
export const ALL_KEYS = [
  ...KEYS, 'docsSync', 'security', 'apiSurface', 'specRegistry', 'docDependency', 'requirementAnchors',
  'pathScopedRules', 'docOwnership', 'evidence', 'crossReference', 'generatedStaleness', 'surfaceSync',
  'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells', 'decisionRecords', 'aidlc',
  'canonicalSync', 'metricsConsistency',
];
export const only = key => Object.fromEntries(ALL_KEYS.map(k => [k, k === key]));
export const cfg = (key, extra = {}) => ({ projectName: 'applies-a', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: only(key), enforcement: 'strict', ...extra });

export const PKG = JSON.stringify({ name: 'svc', version: '1.2.0' });
export const EXPRESS = JSON.stringify({ name: 'svc', version: '1.2.0', dependencies: { express: '4.18.2' } });
export const PROSE = '# Service\n\n' + 'The service reads a request and returns a list of orders to the caller. '.repeat(8) + '\nEach order has an owner and a status. The owner approves a change before it ships. Operators watch the queue every morning.\n';

/**
 * key -> { empties: { <name>: { files, extra?, opts?, cause } }, fix, applying? }
 * `fix` is the first empty project with its fix applied. `applying` replaces it
 * for a validator that cannot be empty while it applies (the comment says why).
 */
export const FIXTURES = {
  // Structure always checks the drift log, so it performs a check in every project.
  structure: { empties: {}, applying: { files: { 'package.json': PKG } } },
  docSections: {
    empties: { 'needs-declaration': { files: { 'package.json': PKG }, cause: 'needs-declaration' } },
    fix: { files: { 'package.json': PKG, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Overview\n\nA service.\n' } },
  },
  // Drift applies when a `// DRIFT:` comment exists, and then it checks it against the log.
  drift: {
    empties: { 'nothing-of-this-kind': { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n' }, cause: 'nothing-of-this-kind' } },
    applying: { files: { 'package.json': PKG, 'src/a.js': '// DRIFT: uses a queue instead of the documented cron\nexport const a = 1;\n', 'DRIFT-LOG.md': '# Drift\n\n- src/a.js: queue instead of cron\n' } },
  },
  changelog: {
    empties: { 'needs-declaration': { files: { 'package.json': PKG }, cause: 'needs-declaration' } },
    fix: { files: { 'package.json': PKG, 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-01-01\n' } },
  },
  testSpec: {
    empties: {
      'needs-declaration': { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n', 'tests/a.test.js': 'test("a", () => {});\n' }, cause: 'needs-declaration' },
      'needs-declaration (no map)': { files: { 'package.json': PKG, 'tests/a.test.js': 'test("a", () => {});\n', 'docs-canonical/TEST-SPEC.md': '# Test Spec\n\nWe test things.\n' }, cause: 'needs-declaration' },
      'needs-content': { files: { 'package.json': PKG, 'tests/a.test.js': 'test("a", () => {});\n', 'docs-canonical/TEST-SPEC.md': '# Test Spec\n\n## Source-to-Test Map\n\n| Source File | Unit Test | Status |\n|---|---|---|\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: { 'package.json': PKG }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n', 'tests/a.test.js': 'test("a", () => {});\n', 'docs-canonical/TEST-SPEC.md': '# Test Spec\n\n## Source-to-Test Map\n\n| Source File | Unit Test | Status |\n|---|---|---|\n| `src/a.js` | `tests/a.test.js` | ✅ |\n' } },
  },
  environment: {
    empties: {
      'needs-declaration': { files: { 'package.json': PKG, 'src/index.js': 'export const key = process.env.API_KEY;\n' }, cause: 'needs-declaration' },
      'nothing-of-this-kind': { files: { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'src/index.js': 'export const key = process.env.API_KEY;\n', 'docs-canonical/ENVIRONMENT.md': '# Environment\n\n## Setup Steps\n\nInstall.\n\n## Environment Variables\n\n| Name | Purpose |\n|---|---|\n| `API_KEY` | key |\n' } },
  },
  architecture: {
    empties: {
      'nothing-of-this-kind': { files: { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
      // The layers name directories the project does not have: the project's declaration is wrong, not DocGuard's reading.
      'needs-declaration (layers name no existing directory)': { files: { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, extra: { layers: { routes: { dir: 'src/routes', canImport: ['services'] }, services: { dir: 'src/services', canImport: [] } } }, cause: 'needs-declaration' },
    },
    fix: { files: { 'package.json': PKG, 'src/index.js': "import { b } from './b.js';\nexport const x = b;\n", 'src/b.js': 'export const b = 1;\n' } },
  },
  freshness: {
    empties: {
      'needs-content': { files: { 'package.json': PKG, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n' }, opts: { commits: 1 }, cause: 'needs-content' },
      'needs-declaration': { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n' }, opts: { commits: 3 }, cause: 'needs-declaration' },
      'nothing-of-this-kind': { files: { 'package.json': PKG }, opts: { git: false }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n' }, opts: { commits: 3 } },
  },
  traceability: {
    empties: {
      'needs-declaration': { files: { 'package.json': PKG, 'docs-canonical/NOTES.md': '# Notes\n' }, cause: 'needs-declaration' },
      'nothing-of-this-kind': { files: { 'package.json': PKG }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'docs-canonical/NOTES.md': '# Notes\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n', 'src/index.js': 'export const x = 1;\n' }, extra: { requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: [] } } },
  },
  docsDiff: {
    empties: {
      'needs-declaration': { files: { 'package.json': EXPRESS, 'tests/a.test.js': 'test("a", () => {});\n' }, cause: 'needs-declaration' },
      'nothing-of-this-kind': { files: { 'README.md': '# Notes\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': EXPRESS, 'tests/a.test.js': 'test("a", () => {});\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe service uses Express.\n' } },
  },
  metadataSync: {
    empties: {
      // A consistency check applies only when both statements of the fact exist (spec 097 FR-006): a manifest
      // version that no document states has nothing that can drift, so the project is not asked to write it down.
      'nothing-of-this-kind (no document states a version)': { files: { 'package.json': PKG, 'README.md': '# svc\n\nInstall with `npm install svc`.\n' }, cause: 'nothing-of-this-kind' },
      // Genuinely empty: a document states a version, in a form the comparison reads, but it is another major
      // version, so the comparison (same major, older) found nothing to compare.
      'needs-content (a document states another major version)': { files: { 'package.json': PKG, 'README.md': '# svc\n\nInstall with `npm install svc@2.0.0`.\n' }, cause: 'needs-content' },
      'layout-not-recognized': { files: { 'pyproject.toml': '[project]\nname = "svc"\nversion = "1.2.0"\n', 'README.md': '# svc\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind': { files: { 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
      // A private application: a version, but nobody installs it.
      'nothing-of-this-kind (private package)': { files: { 'package.json': JSON.stringify({ name: 'app', version: '0.1.0', private: true }), 'README.md': '# app\n' }, cause: 'nothing-of-this-kind' },
      // A monorepo whose root has no version and whose only versioned package is private.
      'nothing-of-this-kind (private workspace)': { files: { 'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }), 'packages/web/package.json': JSON.stringify({ name: 'web', version: '2.0.0', private: true }), 'README.md': '# root\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'README.md': '# svc\n\nInstall with `npm install svc@1.2.0`.\n' } },
  },
  docsCoverage: {
    empties: { 'needs-declaration': { files: { 'src/index.js': 'export const x = 1;\n' }, cause: 'needs-declaration' } },
    fix: { files: { 'src/index.js': 'export const x = 1;\n', 'README.md': '# svc\n\n## Installation\n\nnpm install\n\n## Usage\n\nRun it.\n\n## License\n\nMIT\n' } },
  },
  docQuality: {
    empties: {
      'needs-content': { files: { 'README.md': '# svc\n\nShort.\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: { 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'README.md': PROSE } },
  },
  // TODO-Tracking reads every source file, so it checks something wherever there is source.
  todoTracking: {
    empties: { 'nothing-of-this-kind': { files: { 'package.json': PKG }, cause: 'nothing-of-this-kind' } },
    applying: { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n' } },
  },
  schemaSync: {
    empties: {
      'layout-not-recognized': { files: { 'package.json': JSON.stringify({ name: 'svc', dependencies: { pg: '8.11.0' } }), 'db/schema.sql': 'CREATE TABLE users (id integer);\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind': { files: { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': JSON.stringify({ name: 'svc', dependencies: { pg: '8.11.0' } }), 'migrations/001_users.js': "exports.up = knex => knex.schema.createTable('users', t => t.increments('id'));\n", 'docs-canonical/DATA-MODEL.md': '# Data Model\n\n## Entity Definitions\n\n`users`\n' } },
  },
  // Spec-Kit always reports whether the project has Spec Kit artifacts, so it checks something everywhere.
  specKit: { empties: {}, applying: { files: { 'package.json': PKG } } },
  documentLifecycle: {
    empties: {
      'nothing-of-this-kind': { files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n' }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (not a git repository)': { files: { 'README.md': '# svc\n' }, opts: { git: false }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': PKG, 'README.md': '# svc\n\nA service.\n' } },
  },
};

export function run(key, fixture) {
  const dir = project(fixture.files, cfg(key, fixture.extra || {}), fixture.opts || {});
  const config = loadConfig(dir);
  const data = runGuardInternal(dir, config);
  return { dir, config, data, result: data.validators.find(v => v.key === key) };
}

