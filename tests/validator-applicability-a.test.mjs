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

import { ALL_KEYS, EXPRESS, FIXTURES, KEYS, PKG, PROSE, cfg, only, project, run, temporary } from './helpers/applicability-fixtures-a.mjs';

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

      it('under strict, an applicable empty result blocks (an unread layout is listed instead) and a skipped one does not', () => {
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const { data, result } = run(key, fixture);
          if (fixture.cause === 'nothing-of-this-kind') {
            assert.equal(result.verdict, 'skipped', name);
            assert.ok(!data.strict.blocking.includes(key), name);
          } else if (fixture.cause === 'layout-not-recognized') {
            // A layout DocGuard does not read is a limit of the tool, not a gap in the project (FR-007): listed, never blocking.
            assert.ok(!data.strict.blocking.includes(key), name);
            assert.ok(data.strict.couldNotRead.some(c => c.validator === key), `${name}: listed as could not read`);
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

/**
 * The proof of spec 097 Stage A on eight repositories (FR-007 amended): each case below is a defect the
 * proof found, described by the kind of project and never by name.
 */
describe('group A: defects the Stage A proof found', () => {
  const resultOf = (key, fixture) => run(key, fixture).result;
  const decideOf = async (module, name, key, fixture) => {
    const { dir, config } = run(key, fixture);
    return (await import(`../cli/validators/${module}.mjs`))[name](dir, config);
  };

  describe('Metadata-Sync decides from the manifest', () => {
    const rootNoVersion = (workspaces) => ({ 'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }), ...workspaces });
    const lib = (name, extra = {}) => JSON.stringify({ name, version: '3.1.0', ...extra });

    it('a private package does not apply, and the evidence says it is private', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': JSON.stringify({ name: 'app', version: '0.1.0', private: true }) } });
      assert.equal(a.applies, false);
      assert.match(a.evidence, /"private": true/);
      assert.match(a.evidence, /0\.1\.0/);
    });

    it('a published command-line tool whose README has install lines with no version does not apply', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': JSON.stringify({ name: 'tool', version: '1.0.0', bin: { tool: 'cli.js' } }), 'README.md': '# tool\n\n```\nnpm install -g tool\nnpx tool init\n```\n' } });
      assert.equal(a.applies, false);
      assert.match(a.evidence, /1\.0\.0/);
      assert.match(a.evidence, /no document states a version/);
    });

    it('a published workspace package whose documents state no version does not apply', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }), 'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '3.1.0' }), 'README.md': '# root\n' } });
      assert.equal(a.applies, false);
      assert.match(a.evidence, /packages\/lib\/package\.json/);
      assert.match(a.evidence, /no document states a version/);
    });

    it('a document that states the version makes it apply, and the evidence names the document', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': PKG, 'README.md': 'npm install svc@2.0.0\n' } });
      assert.equal(a.applies, true);
      assert.match(a.evidence, /README\.md/);
    });

    it('no empty result of the validator asks the project to write the version into a document', () => {
      for (const [name, fixture] of Object.entries(FIXTURES.metadataSync.empties)) {
        const how = run('metadataSync', fixture).result.howToConfigure;
        assert.doesNotMatch(how, /Name the version where readers copy|write the version/i, name);
      }
    });

    it('a version stated for this package is read in three forms: the install line, a URL that names it, a version: line in a document about it', async () => {
      for (const readme of ['npm install svc@1.2.0\n', 'https://example.com/org/svc/releases/download/v1.2.0/svc.tgz\n', '# svc\n\nversion: 1.2.0\n']) {
        const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': PKG, 'README.md': readme } });
        assert.equal(a.applies, true, readme);
      }
    });

    it('a version of another tool is not one for this package: a URL for another project, a key that ends in version:, a version: line in a document that does not name the package', async () => {
      for (const readme of ['The svc guide.\nhttps://example.com/framework/releases/download/v3.2.0/x.tgz\n', 'The svc guide.\nminimum_pre_commit_version: 3.2.0\n', '# Hooks\n\nversion: 3.2.0\n']) {
        const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': PKG, 'README.md': readme } });
        assert.equal(a.applies, false, readme);
        assert.match(a.evidence, /for this package/);
      }
    });

    it('a package with no version does not apply', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: { 'package.json': JSON.stringify({ name: 'app' }) } });
      assert.equal(a.applies, false);
    });

    it('a monorepo whose root has no version reads the one published workspace package, and names it', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: rootNoVersion({ 'packages/lib/package.json': lib('lib'), 'packages/web/package.json': lib('web', { private: true }), 'README.md': 'npm install lib@3.1.0\n' }) });
      assert.equal(a.applies, true);
      assert.match(a.evidence, /packages\/lib\/package\.json/);
      assert.match(a.evidence, /lib/);
      assert.match(a.evidence, /only published/);
    });

    it('two published workspace packages are not the project\'s version: it does not apply and names both', async () => {
      const a = await decideOf('metadata-sync', 'applies', 'metadataSync', { files: rootNoVersion({ 'packages/a/package.json': lib('a'), 'packages/b/package.json': lib('b') }) });
      assert.equal(a.applies, false);
      assert.match(a.evidence, /packages\/a\/package\.json/);
      assert.match(a.evidence, /packages\/b\/package\.json/);
    });

    it('under standard a private package still has its documents checked (no finding changes)', () => {
      const dir = project({ 'package.json': JSON.stringify({ name: 'app', version: '2.0.0', private: true }), 'README.md': '# app\n\nInstall app@2.0.0 today.\n' }, cfg('metadataSync', { enforcement: 'standard' }));
      const result = runGuardInternal(dir, loadConfig(dir)).validators.find(v => v.key === 'metadataSync');
      assert.ok(result.performed >= 1, 'it keeps comparing the references it always compared');
    });
  });

  describe('Test-Spec reads the older heading and every map section', () => {
    const SPEC = (body) => ({ files: { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n', 'src/b.js': 'export const b = 1;\n', 'tests/a.test.js': 't\n', 'tests/b.test.js': 't\n', 'docs-canonical/TEST-SPEC.md': `# Test Spec\n\n${body}` } });
    const table = (heading, rows) => `${heading}\n\n| Source File | Unit Test | Status |\n|---|---|---|\n${rows}\n\n`;

    it('accepts "Service-to-Test Map", at any heading level and with a number before it', () => {
      for (const heading of ['## Service-to-Test Map', '### 2. Service-to-Test Map', '## Source-to-Test Map']) {
        const result = resultOf('testSpec', SPEC(table(heading, '| `src/a.js` | `tests/a.test.js` | ✅ |')));
        assert.equal(result.performed, 2, heading);
      }
    });

    it('reads a second map heading appended after the first one', () => {
      const body = table('## Service-to-Test Map', '| `src/a.js` | `tests/a.test.js` | ✅ |') + table('## Source-to-Test Map', '| `src/b.js` | `tests/b.test.js` | ✅ |');
      assert.equal(resultOf('testSpec', SPEC(body)).performed, 4);
    });

    it('names the table it reads in the fix text for a document with no map', () => {
      const result = resultOf('testSpec', SPEC('We test things.\n'));
      assert.match(result.howToConfigure, /Source-to-Test Map/);
      assert.match(result.howToConfigure, /Service-to-Test Map/);
    });

    it('names both headings when the document is missing and when the table is empty', () => {
      for (const fixture of [SPEC('x').files && { files: { 'package.json': PKG, 'tests/a.test.js': 't\n' } }, SPEC(table('## Source-to-Test Map', '')) ]) {
        const how = resultOf('testSpec', fixture).howToConfigure;
        assert.match(how, /Source-to-Test Map/);
        assert.match(how, /Service-to-Test Map/);
      }
    });
  });

  describe('a document the project keeps elsewhere is named before a new one is suggested', () => {
    const TESTS = { 'package.json': PKG, 'src/a.js': 'export const a = 1;\n', 'tests/a.test.js': 't\n' };
    const before = (text, a, b) => text.indexOf(a) >= 0 && text.indexOf(a) < (text.indexOf(b) < 0 ? Infinity : text.indexOf(b));

    it('Test-Spec: a role mapped to a file that does not exist says so, and does not ask for the default path', () => {
      const r = resultOf('testSpec', { files: TESTS, extra: { docs: { roles: { testSpec: 'docs/testing/PLAN.md' } } } });
      assert.match(r.howToConfigure, /docs\.roles/);
      assert.match(r.howToConfigure, /docs\/testing\/PLAN\.md/);
      assert.doesNotMatch(r.howToConfigure, /docs-canonical\/TEST-SPEC\.md/);
    });

    it('Test-Spec: an unmapped test document elsewhere is offered as a docs.roles mapping before a new file', () => {
      const r = resultOf('testSpec', { files: { ...TESTS, 'docs-implementation/TESTING.md': '# Testing\n\nWe test.\n' } });
      assert.match(r.howToConfigure, /"testSpec": "docs-implementation\/TESTING\.md"/);
      assert.ok(before(r.howToConfigure, 'docs.roles', 'Create'), r.howToConfigure);
    });

    it('Test-Spec: a mapped document with a Service-to-Test Map clears the validator', () => {
      const r = resultOf('testSpec', { files: { ...TESTS, 'docs-implementation/TESTING.md': '# Testing\n\n## Service-to-Test Map\n\n| Source | Test | Status |\n|---|---|---|\n| `src/a.js` | `tests/a.test.js` | ✅ |\n' }, extra: { docs: { roles: { testSpec: 'docs-implementation/TESTING.md' } } } });
      assert.ok(r.performed >= 1);
      assert.equal(r.emptyCause, undefined);
    });

    it('Environment: a role mapped elsewhere is named, and the default path is not requested', () => {
      const r = resultOf('environment', { files: { 'package.json': PKG, 'src/index.js': 'export const k = process.env.API_KEY;\n' }, extra: { docs: { roles: { environment: 'docs/setup/ENV.md' } } } });
      assert.match(r.howToConfigure, /docs\.roles/);
      assert.match(r.howToConfigure, /docs\/setup\/ENV\.md/);
      assert.doesNotMatch(r.howToConfigure, /docs-canonical\/ENVIRONMENT\.md/);
    });

    it('Environment: an unmapped environment document elsewhere is offered as a mapping', () => {
      const r = resultOf('environment', { files: { 'package.json': PKG, 'src/index.js': 'export const k = process.env.API_KEY;\n', 'docs-implementation/ENVIRONMENT.md': '# Environment\n\nVars.\n' } });
      assert.match(r.howToConfigure, /"environment": "docs-implementation\/ENVIRONMENT\.md"/);
    });

    it('Docs-Diff: roles mapped elsewhere are named, and neither default path is requested', () => {
      const r = resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'tests/a.test.js': 't\n' }, extra: { docs: { roles: { architecture: 'docs/design/SYSTEM.md', testSpec: 'docs/design/TESTS.md' } } } });
      assert.match(r.howToConfigure, /docs\.roles/);
      assert.match(r.howToConfigure, /docs\/design\/SYSTEM\.md/);
      assert.doesNotMatch(r.howToConfigure, /docs-canonical\/ARCHITECTURE\.md|docs-canonical\/TEST-SPEC\.md/);
    });

    it('Docs-Diff: the mapping is offered for the architecture document even when the test spec exists', () => {
      const r = resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'docs-canonical/TEST-SPEC.md': '# Test Spec\n', 'docs-implementation/ARCHITECTURE.md': '# Architecture\n' } });
      assert.match(r.howToConfigure, /"architecture": "docs-implementation\/ARCHITECTURE\.md"/);
    });

    it('Docs-Diff: an architecture document in an architecture folder under another name is offered as a mapping', () => {
      const r = resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'docs-canonical/TEST-SPEC.md': '# Test Spec\n', 'docs/03-architecture/SYSTEM-OVERVIEW.md': '# System overview\n' } });
      assert.match(r.howToConfigure, /"architecture": "docs\/03-architecture\/SYSTEM-OVERVIEW\.md"/);
    });

    const ARCH = (files) => resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'docs-canonical/TEST-SPEC.md': '# Test Spec\n', ...files } }).howToConfigure;

    it('Docs-Diff: a folder named for the role holding four documents offers the overview, not the first three', () => {
      const how = ARCH({ 'docs/architecture/deployment-notes.md': '# d\n', 'docs/architecture/glossary.md': '# g\n', 'docs/architecture/meeting-notes.md': '# m\n', 'docs/architecture/OVERVIEW.md': '# o\n' });
      assert.match(how, /"architecture": "docs\/architecture\/OVERVIEW\.md"/);
      assert.doesNotMatch(how, /deployment-notes|glossary|meeting-notes/);
    });

    it('Docs-Diff: a file whose own name has the role word ranks above one that only sits in the folder', () => {
      const how = ARCH({ 'docs/architecture/OVERVIEW.md': '# o\n', 'docs/design/architecture-guide.md': '# g\n' });
      assert.match(how, /"architecture": "docs\/design\/architecture-guide\.md"/);
    });

    it('Docs-Diff: the best candidate is never cut from a long list of name matches', () => {
      const files = {};
      for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) files[`docs/architecture-${n}.md`] = '# x\n';
      files['docs/ARCHITECTURE.md'] = '# the one\n';
      assert.match(ARCH(files), /"architecture": "docs\/ARCHITECTURE\.md"/);
    });

    it('Docs-Diff: when it cannot tell which file is the document it offers none by name, says where it looked, and prints the placeholder snippet', () => {
      const how = ARCH({ 'docs/architecture/deployment-notes.md': '# d\n', 'docs/architecture/glossary.md': '# g\n' });
      assert.doesNotMatch(how, /"architecture": "docs\/architecture\//);
      assert.match(how, /looked in docs\/architecture\//i);
      assert.match(how, /"architecture": "<path\/to\/your-document\.md>"/);
      assert.doesNotMatch(how, /deployment-notes|glossary/);
    });

    it('Docs-Diff: several files that each have the role word in their name are not listed; it says where it looked and prints only the snippet', () => {
      const how = ARCH({ 'docs/architecture-review-notes.md': '# a\n', 'docs/architecture-diagram-export.md': '# b\n' });
      assert.doesNotMatch(how, /architecture-review-notes|architecture-diagram-export/);
      assert.match(how, /looked in docs\/ and cannot tell which file is the document, so it names none/);
      assert.match(how, /"architecture": "<path\/to\/your-document\.md>"/);
    });

    it('Docs-Diff: one file whose name only mentions the role word but is about something else is not offered', () => {
      const how = ARCH({ 'docs/architecture-review-notes.md': '# a\n' });
      assert.doesNotMatch(how, /"architecture": "docs\/architecture-review-notes\.md"/);
      assert.match(how, /"architecture": "<path\/to\/your-document\.md>"/);
    });

    it('Docs-Diff: with no candidate at all the fix text still says how to map a document by hand', () => {
      const r = resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'docs-canonical/TEST-SPEC.md': '# Test Spec\n', 'notes/thoughts.md': '# thoughts\n' } });
      assert.match(r.howToConfigure, /"architecture": "<path\/to\/your-document\.md>"/);
    });

    it('Docs-Diff: an unmapped architecture document elsewhere is offered as a mapping', () => {
      const r = resultOf('docsDiff', { files: { 'package.json': EXPRESS, 'tests/a.test.js': 't\n', 'docs-implementation/ARCHITECTURE.md': '# Architecture\n\nExpress.\n' } });
      assert.match(r.howToConfigure, /"architecture": "docs-implementation\/ARCHITECTURE\.md"/);
    });
  });

  describe('Schema-Sync does not ask a project to write a model file it does not use', () => {
    const DYNAMO = { files: { 'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { '@aws-sdk/client-dynamodb': '3.0.0' } }), 'src/db.js': 'export const t = "orders";\n' }, cause: 'layout-not-recognized' };

    it('a DynamoDB project: layout-not-recognized, names what it reads, asks for no Knex, Prisma or SQL model', () => {
      const r = resultOf('schemaSync', DYNAMO);
      assert.equal(r.emptyCause, 'layout-not-recognized');
      assert.match(r.howToConfigure, /Prisma, Drizzle, Mongoose/);
      assert.match(r.howToConfigure, /DynamoDB/);
      assert.doesNotMatch(r.howToConfigure, /keep the schema in one of those forms|for example a Knex migration/i);
      assert.doesNotMatch(r.howToConfigure, /\b(write|create|add|define|keep)\b[^.]*\b(Knex|Prisma|SQL) (model|migration|file)/i);
    });

    it('a SQL-file project still gets a fix it can complete without moving its schema', () => {
      const r = resultOf('schemaSync', { files: { 'package.json': PKG, 'db/schema.sql': 'CREATE TABLE orders (id int);\n' } });
      assert.equal(r.emptyCause, 'layout-not-recognized');
      assert.doesNotMatch(r.howToConfigure, /\bmove\b/i);
    });
  });

  describe('Architecture says plainly what it did not follow', () => {
    it('a partial result names the imports it could not follow and carries no cause, fix or cause-less reason about a runtime path', () => {
      const r = resultOf('architecture', { files: { 'package.json': PKG, 'pkg/__init__.py': '', 'pkg/main.py': 'from . import helper\nimport importlib, sys\nsys.path.append(extra)\nimportlib.import_module(name)\n', 'pkg/helper.py': 'VALUE = 1\n' } });
      const reason = r.applicability.reason;
      assert.match(reason, /could not follow/i);
      assert.match(reason, /sys\.path/);
      assert.match(reason, /not in the (?:cycle )?check/i);
      assert.doesNotMatch(reason, /^Static import findings are retained/);
      assert.equal(r.emptyCause, undefined);
      assert.equal(r.howToConfigure, undefined);
    });
  });

  describe('no fix text of the group tells a project to move code or documents', () => {
    it('the empty results of every fixture of the group', () => {
      for (const key of KEYS) {
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const how = run(key, fixture).result.howToConfigure;
          if (!how) continue;
          assert.doesNotMatch(how, /\b(move|moving|relocate|rename|restructure)\b/i, `${key}/${name}: ${how}`);
        }
      }
    });

    it('layout-not-recognized is used where the limit is DocGuard\'s: the fixtures name a validator-side limit', () => {
      for (const key of KEYS) {
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          if (fixture.cause !== 'layout-not-recognized') continue;
          const r = run(key, fixture).result;
          assert.match(r.howToConfigure, /reads|cannot read|does not read|read /i, `${key}/${name} says what the validator reads`);
        }
      }
    });
  });
});

describe('group A: Traceability traces requirements', () => {
  const FR = '# Requirements\n\n- **FR-001**: The system MUST list the orders of a customer.\n- **FR-002**: The system MUST [capability]\n- **FR-003**: The system MUST cancel an order.\n';
  const files = (extra = {}) => ({ 'package.json': PKG, 'docs-canonical/REQUIREMENTS.md': FR, ...extra });

  it('performed is the number of requirements traced, and a template row is not one', () => {
    const { result } = run('traceability', { files: files({ 'tests/a.test.js': '// @req FR-001\ntest("a", () => {});\n' }) });
    assert.equal(result.performed, 2, 'FR-001 and FR-003; the placeholder row FR-002 is neither traced nor reported');
    assert.ok(!(result.findings || []).some(f => /FR-002/.test(f.message)), 'no TRC004 on the template row');
    assert.equal((result.findings || []).filter(f => f.code === 'TRC004').length, 1, 'only FR-003 has no test');
  });

  it('a requirement that mentions brackets inside a code span is a requirement, not a template row', () => {
    const { result } = run('traceability', { files: { 'package.json': PKG, 'docs-canonical/REQUIREMENTS.md': '# Requirements\n\n- **FR-001**: The cut MUST move the `[Unreleased]` body and accept `--stage [slug]`.\n' } });
    assert.equal(result.performed, 1);
    assert.equal(result.applies.applies, true);
  });

  it('a requirement whose code span wraps onto the next line is a requirement', () => {
    const { result } = run('traceability', { files: { 'package.json': PKG, 'docs-canonical/REQUIREMENTS.md': '# Requirements\n\n- **FR-001**: `tool approve --id <id> [--delivery\n  planned]` MUST record the approval.\n' } });
    assert.equal(result.performed, 1);
  });

  it('keeps `total` as the checks it counted under standard (requirements plus orphan references plus document checks)', () => {
    const dir = project(files({ 'tests/a.test.js': '// @req FR-001\ntest("a", () => {});\n' }), cfg('traceability', { enforcement: 'standard' }));
    const result = runGuardInternal(dir, loadConfig(dir)).validators.find(v => v.key === 'traceability');
    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
  });

  it('a project with documents and no requirement does not apply, and says no requirement ID is declared', async () => {
    const { dir, config, result } = run('traceability', { files: { 'package.json': PKG, 'docs-canonical/NOTES.md': '# Notes\n' } });
    assert.equal(result.applies.applies, false);
    assert.match(result.applies.evidence, /no requirement ID is declared/);
    const a = (await import('../cli/validators/traceability.mjs')).applies(dir, config);
    assert.equal(a.applies, false);
  });

  it('a project whose only IDs are tasks or decisions is not applicable either', () => {
    const { result } = run('traceability', { files: { 'package.json': PKG, 'specs/001-x/tasks.md': '- [ ] T001 do it\n' } });
    assert.equal(result.applies.applies, false);
  });
});
