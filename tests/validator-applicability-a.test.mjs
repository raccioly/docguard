/**
 * Strict by default, group A (specs/097-strict-by-default T009, T010, T012):
 * every validator of the group reports the performed-check count, decides from
 * the project's files whether its kind of check belongs to the project, and
 * says, on every empty result, why it is empty and what to do.
 *
 * Per validator: a project where it applies and is empty (one per cause it can
 * return), a project where it does not apply, and the fix applied to the first
 * empty project, after which it performs at least one check and the result
 * passes `validateResultContract`. A validator whose subject every project has,
 * or that cannot be empty while it applies, says so beside its fixtures.
 *
 * The helpers are small copies of tests/strict-by-default.test.mjs's: importing
 * that file would run its suites a second time.
 *
 * @req docguard.strict-by-default#FR-004
 * @req docguard.strict-by-default#FR-005
 * @req docguard.strict-by-default#FR-006
 * @req docguard.strict-by-default#SC-006
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURE_GIT } from './helpers/git.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { loadConfig } from '../cli/config.mjs';
import { EMPTY_CAUSES, validateResultContract } from '../cli/validator-coverage.mjs';

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

/** A fixture project; `git: false` leaves it outside a repository, `commits` adds history. */
function project(files, config, { git = true, commits = 1 } = {}) {
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

const KEYS = [
  'structure', 'docSections', 'drift', 'changelog', 'testSpec', 'environment', 'architecture', 'freshness',
  'traceability', 'docsDiff', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync',
  'specKit', 'documentLifecycle',
];
// Every other validator is switched off so a fixture measures one validator.
const ALL_KEYS = [
  ...KEYS, 'docsSync', 'security', 'apiSurface', 'specRegistry', 'docDependency', 'requirementAnchors',
  'pathScopedRules', 'docOwnership', 'evidence', 'crossReference', 'generatedStaleness', 'surfaceSync',
  'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells', 'decisionRecords', 'aidlc',
  'canonicalSync', 'metricsConsistency',
];
const only = key => Object.fromEntries(ALL_KEYS.map(k => [k, k === key]));
const cfg = (key, extra = {}) => ({ projectName: 'applies-a', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: only(key), enforcement: 'strict', ...extra });

const PKG = JSON.stringify({ name: 'svc', version: '1.2.0' });
const EXPRESS = JSON.stringify({ name: 'svc', version: '1.2.0', dependencies: { express: '4.18.2' } });
const PROSE = '# Service\n\n' + 'The service reads a request and returns a list of orders to the caller. '.repeat(8) + '\nEach order has an owner and a status. The owner approves a change before it ships. Operators watch the queue every morning.\n';

/**
 * key -> { empties: { <name>: { files, extra?, opts?, cause } }, fix, applying? }
 * `fix` is the first empty project with its fix applied. `applying` replaces it
 * for a validator that cannot be empty while it applies (the comment says why).
 */
const FIXTURES = {
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
      'layout-not-recognized': { files: { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, extra: { layers: { routes: { dir: 'src/routes', canImport: ['services'] }, services: { dir: 'src/services', canImport: [] } } }, cause: 'layout-not-recognized' },
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
      'needs-content': { files: { 'package.json': PKG, 'README.md': '# svc\n\nA service.\n' }, cause: 'needs-content' },
      'layout-not-recognized': { files: { 'pyproject.toml': '[project]\nname = "svc"\nversion = "1.2.0"\n', 'README.md': '# svc\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind': { files: { 'src/index.js': 'export const x = 1;\n' }, cause: 'nothing-of-this-kind' },
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

function run(key, fixture) {
  const dir = project(fixture.files, cfg(key, fixture.extra || {}), fixture.opts || {});
  const config = loadConfig(dir);
  const data = runGuardInternal(dir, config);
  return { dir, config, data, result: data.validators.find(v => v.key === key) };
}

const MODULE = {
  structure: 'structure', docSections: 'structure', drift: 'drift', changelog: 'changelog', testSpec: 'test-spec',
  environment: 'environment', architecture: 'architecture', freshness: 'freshness', traceability: 'traceability',
  docsDiff: 'docs-diff', metadataSync: 'metadata-sync', docsCoverage: 'docs-coverage', docQuality: 'doc-quality',
  todoTracking: 'todo-tracking', schemaSync: 'schema-sync', specKit: 'spec-kit', documentLifecycle: 'document-lifecycle',
};
// structure.mjs holds two validators, so its second one exports its decision under its own name.
const EXPORT = { docSections: 'appliesDocSections' };

describe('group A: the result contract, per validator', () => {
  it('has fixtures for every validator of the group', () => {
    assert.deepEqual(Object.keys(FIXTURES).sort(), [...KEYS].sort());
  });

  for (const key of KEYS) {
    describe(key, () => {
      for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
        it(`${name}: reports cause, fix, applies and a complete contract`, () => {
          const { result } = run(key, fixture);
          assert.deepEqual(validateResultContract(result), []);
          assert.equal(result.performed, 0);
          assert.equal(result.emptyCause, fixture.cause);
          assert.ok(EMPTY_CAUSES.includes(result.emptyCause));
          assert.equal(result.applies.applies, fixture.cause !== 'nothing-of-this-kind');
          assert.ok(result.howToConfigure.length > 40, `a real fix text: ${result.howToConfigure}`);
          assert.ok(result.applicability?.reason, 'an empty result says why');
        });
      }

      it('applying the fix makes it perform at least one check', () => {
        const fixture = FIXTURES[key].fix || FIXTURES[key].applying;
        const { result } = run(key, fixture);
        assert.deepEqual(validateResultContract(result), []);
        assert.ok(result.performed >= 1, `performed ${result.performed}`);
        assert.equal(result.emptyCause, undefined);
        assert.equal(result.applies.applies, true);
        assert.ok(['pass', 'fail'].includes(result.verdict), `verdict ${result.verdict}`);
      });

      it('exports applies(projectDir, config) with the same decision', async () => {
        const mod = await import(`../cli/validators/${MODULE[key]}.mjs`);
        const decide = mod[EXPORT[key] || 'applies'];
        assert.equal(typeof decide, 'function', `${MODULE[key]}.mjs exports ${EXPORT[key] || 'applies'}`);
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const { dir, config } = run(key, fixture);
          const a = decide(dir, config);
          assert.equal(a.applies, fixture.cause !== 'nothing-of-this-kind', name);
          assert.ok(a.evidence.length > 0, name);
        }
        const { dir, config } = run(key, FIXTURES[key].fix || FIXTURES[key].applying);
        assert.equal(decide(dir, config).applies, true, 'the applying project applies');
      });

      it('under strict, an applicable empty result blocks and a skipped one does not', () => {
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const { data, result } = run(key, fixture);
          if (fixture.cause === 'nothing-of-this-kind') {
            assert.equal(result.verdict, 'skipped', name);
            assert.ok(!data.strict.blocking.includes(key), name);
          } else {
            // A missing prerequisite document (testSpec, environment) is `inconclusive`, an empty result `empty`;
            // under strict both block an applicable validator (FR-007).
            assert.ok(['empty', 'inconclusive'].includes(result.verdict), `${name}: ${result.verdict}`);
            assert.ok(data.strict.blocking.includes(key), name);
          }
        }
      });
    });
  }

  it('no two empty results of the group share a reason sentence', () => {
    const seen = new Map();
    for (const key of KEYS) {
      for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
        const reason = run(key, fixture).result.applicability?.reason;
        assert.ok(reason, `${key}/${name} has a reason`);
        for (const [other, who] of seen) assert.notEqual(reason, other, `${key}/${name} shares its reason with ${who}`);
        seen.set(reason, `${key}/${name}`);
      }
    }
  });

  it('no empty result of the group shares its fix text with another', () => {
    const seen = new Map();
    for (const key of KEYS) {
      for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
        const how = run(key, fixture).result.howToConfigure;
        if (fixture.cause === 'nothing-of-this-kind') continue;
        for (const [other, who] of seen) assert.notEqual(how, other, `${key}/${name} shares its fix with ${who}`);
        seen.set(how, `${key}/${name}`);
      }
    }
  });
});

describe('group A: standard mode keeps its verdicts', () => {
  before(() => {});
  it('a validator that does not apply is not skipped under standard', () => {
    // FR-006: `skipped` follows `applies: false` under strict only.
    const fixture = FIXTURES.drift.empties['nothing-of-this-kind'];
    const dir = project(fixture.files, cfg('drift', { enforcement: 'standard' }));
    const result = runGuardInternal(dir, loadConfig(dir)).validators.find(v => v.key === 'drift');
    assert.notEqual(result.verdict, 'skipped');
    assert.equal(result.applies.applies, false);
  });
});
