/**
 * Strict by default, group B (specs/097-strict-by-default T009, T010, T012):
 * every validator of the group reports the performed-check count, decides from
 * the project's files whether its kind of check belongs to the project, and
 * says, on every empty result, why it is empty and what to do.
 *
 * Per validator: a project where it applies and is empty (one per cause it can
 * return), a project where it does not apply, and the fix applied, after which
 * it performs at least one check and the result passes `validateResultContract`.
 * A validator that cannot be empty while it applies (every project that has its
 * subject has something to check) says so beside its fixtures and has no
 * applies-and-empty entry.
 *
 * The helpers are small copies of tests/strict-by-default.test.mjs's: importing
 * that file would register its suites a second time in this process.
 *
 * @req docguard.strict-by-default#FR-004
 * @req docguard.strict-by-default#FR-005
 * @req docguard.strict-by-default#FR-006
 * @req docguard.strict-by-default#SC-006
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURE_GIT } from './helpers/git.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { loadConfig } from '../cli/config.mjs';
import { EMPTY_CAUSES, validateResultContract } from '../cli/validator-coverage.mjs';

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

function put(dir, files) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}

/**
 * A fixture project. `git: false` leaves it outside a repository; `history` is a
 * list of file maps, each committed on top of the first (so a diff exists).
 * `aged` is { path: days }: the file's mtime is moved back by that many days.
 */
function project(files, config, { git = true, history = [], aged = {}, brokenGit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-applies-b-'));
  temporary.push(dir);
  put(dir, files);
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config, null, 2));
  for (const [path, days] of Object.entries(aged)) {
    const then = new Date(Date.now() - days * 86_400_000);
    utimesSync(join(dir, path), then, then);
  }
  // A `.git` that names a repository which is not there: present, and unreadable.
  if (brokenGit) { writeFileSync(join(dir, '.git'), 'gitdir: /nonexistent/docguard-test.git\n'); return dir; }
  if (!git) return dir;
  const run = (...args) => execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  run('init', '-q', '-b', 'main');
  run('add', '-A');
  run('commit', '-q', '-m', 'init');
  history.forEach((change, i) => {
    put(dir, change);
    run('add', '-A');
    run('commit', '-q', '-m', `change ${i + 1}`);
  });
  return dir;
}

const KEYS = [
  'specRegistry', 'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence',
  'crossReference', 'generatedStaleness', 'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells',
  'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
// Every other validator is switched off so a fixture measures one validator.
const ALL_KEYS = [
  ...KEYS, 'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'surfaceSync',
];
const only = key => Object.fromEntries(ALL_KEYS.map(k => [k, k === key]));
const cfg = (key, extra = {}) => ({ projectName: 'applies-b', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: only(key), enforcement: 'strict', ...extra });

const PKG = JSON.stringify({ name: 'svc', version: '1.2.0' });
const SRC = { 'src/index.js': 'export const a = 1;\n' };
const BASE = { 'package.json': PKG, ...SRC };
const DOCS = { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nA small service that returns a list.\n' };
const SPEC = {
  'specs/001-demo/spec.md': '# Feature: Demo\n\n**Spec ID**: demo.feature\n\n## Requirements\n\n- **FR-001**: The service MUST return the list.\n',
};

/**
 * key -> { empties: { <name>: { files, extra?, opts?, cause } }, fix?, applying?, why? }
 * `fix` is the first applies-and-empty project with its fix applied. `applying`
 * replaces it for a validator that cannot be empty while it applies (`why` says
 * so). Both may carry `extra` (configuration) and `opts` (git history, file age).
 */
const FIXTURES = {
  // A project with specs is never empty here: a spec without registry evidence is a finding (SPR001), not silence.
  specRegistry: {
    empties: { 'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, ...SPEC } },
    why: 'every project that has specs has a registry to compare, or a finding that says it is missing',
  },
  docDependency: {
    empties: {
      'needs-declaration': { files: { ...BASE, ...DOCS }, cause: 'needs-declaration' },
      'needs-declaration (lock covers nothing)': { files: { ...BASE, ...DOCS, '.docguard-doc-lock.json': JSON.stringify({ schemaVersion: 1, sections: {} }) }, cause: 'needs-declaration' },
      'nothing-of-this-kind (no source)': { files: { 'package.json': PKG, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:section id=entry source=human covers="src/index.js" -->\nThe entry point exports a constant.\n<!-- /docguard:section -->\n' } },
  },
  requirementAnchors: {
    empties: {
      'needs-declaration': { files: { ...BASE, ...SPEC }, cause: 'needs-declaration' },
      'needs-content': { files: { ...BASE, ...SPEC }, extra: { anchors: { enabled: true } }, cause: 'needs-content' },
      'nothing-of-this-kind (no requirements)': { files: BASE, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no source)': { files: { 'package.json': PKG, ...SPEC }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, ...SPEC, 'src/index.js': '// @implements demo.feature#FR-001\nexport const a = 1;\n' }, extra: { anchors: { enabled: true } } },
  },
  // A project with an instruction file that has no scope and no path pointer has nothing for this validator to read.
  pathScopedRules: {
    empties: {
      'nothing-of-this-kind (no instruction files)': { files: BASE, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (prose only)': { files: { ...BASE, 'AGENTS.md': '# Agents\n\nBe kind to the reader.\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'AGENTS.md': '# Agents\n\nThe entry point is `src/index.js`.\n' } },
  },
  docOwnership: {
    // Declared-only (coordinator's decision on FR-006): no map, no subject; a declared empty block is needs-content.
    empties: {
      'nothing-of-this-kind (not declared)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'needs-content': { files: { ...BASE, ...DOCS }, extra: { ownership: { entries: [] } }, cause: 'needs-content' },
    },
    fix: { files: { ...BASE, ...DOCS }, extra: { ownership: { roots: ['src'], entries: [{ doc: 'docs-canonical/ARCHITECTURE.md', purpose: 'Explains the entry point', paths: ['src/**'] }] } } },
  },
  // Declared-only (coordinator's decision on FR-006). A manifest always declares something (the strict loader
  // refuses an empty one with EVD001), so there is no declared-and-empty fixture.
  evidence: {
    empties: {
      'nothing-of-this-kind (not declared, a claim exists)': { files: { ...BASE, 'docs-canonical/LIMITS.md': '# Limits\n\n## Retention\n\nSessions expire after 30 days.\n' }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (not declared)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
    },
    fix: {
      files: {
        ...BASE,
        'docs-canonical/LIMITS.md': '# Limits\n\n## Retention\n\nSessions expire after 30 days.\n',
        'config.json': JSON.stringify({ retentionDays: 30 }),
        '.docguard-evidence.json': JSON.stringify({
          $schema: 'https://raccioly.github.io/docguard/schemas/docguard-evidence.schema.json',
          schemaVersion: 1,
          declarations: [{
            id: 'retention-days', applicability: { mode: 'always' },
            target: { document: 'docs-canonical/LIMITS.md', heading: 'Retention', statement: 'Sessions expire after {{value}} days.' },
            source: { adapter: 'json-pointer', path: 'config.json', pointer: '/retentionDays' },
            predicate: { kind: 'equals', valueType: 'number' },
          }],
        }),
      },
    },
  },
  crossReference: {
    empties: {
      'layout-not-recognized': { files: { ...BASE, 'docs/GUIDE.md': '# Guide\n\nSee [the setup](./SETUP.md).\n', 'docs/SETUP.md': '# Setup\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind (no links)': { files: { ...BASE, 'README.md': '# Readme\n\nA small service.\n' }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'docs-canonical/GUIDE.md': '# Guide\n\nSee [the setup](./SETUP.md).\n', 'docs-canonical/SETUP.md': '# Setup\n' } },
  },
  generatedStaleness: {
    empties: {
      // The generator's own draft marker is `<!-- docguard:status draft -->`; a current doc carries no draft marker.
      'layout-not-recognized': { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:section id=no-such-section source=code -->\nx\n<!-- /docguard:section -->\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
    },
    fix: {
      files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '<!-- docguard:status draft -->\n# Architecture\n\nA small service.\n' },
      opts: { aged: { 'docs-canonical/ARCHITECTURE.md': 40 } },
    },
  },
  suppressions: {
    empties: { 'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, '.docguardignore': 'dist/ # build output\n' } },
    why: 'a project that has a suppression has one to judge',
  },
  // A revision range that changes no documented code is the normal case, not a gap in the project.
  diffSuspicion: {
    empties: {
      'nothing-of-this-kind (one commit)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no git)': { files: { ...BASE, ...DOCS }, opts: { git: false }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (the change is not documented)': { files: { ...BASE, ...DOCS }, opts: { history: [{ 'src/index.js': 'export const b = 2;\n' }] }, cause: 'nothing-of-this-kind' },
    },
    applying: {
      files: { 'package.json': PKG, 'src/pricing.mjs': 'export const discountPercentage = 10;\nexport const loyaltyTier = "gold";\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Pricing\n\nThe `src/pricing.mjs` module sets the discountPercentage and the loyaltyTier.\n' },
      opts: { history: [{ 'src/pricing.mjs': 'export const rebate = 5;\n' }] },
    },
    why: 'a documented, changed file is a pair checked; without one there is nothing of this kind',
  },
  referenceExistence: {
    empties: {
      'nothing-of-this-kind (no references)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no git)': { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\nThe `computeTotal` helper.\n' }, opts: { git: false }, cause: 'nothing-of-this-kind' },
    },
    applying: { files: { 'package.json': PKG, 'src/index.js': 'export function computeTotal() { return 1; }\n', 'docs-canonical/ARCHITECTURE.md': '# A\n\nThe `computeTotal` helper.\n' } },
    why: 'a backticked code identifier in a document, or an ADR citation in code, is a reference checked',
  },
  apiDocSmells: {
    empties: {
      'nothing-of-this-kind (no API headings)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    applying: { files: { ...BASE, 'docs-canonical/API.md': '# API\n\n### GET /users\n\nReturns the list of users, newest first, with the owner and the status of each one.\n' } },
    why: 'a document with an API-shaped heading has a unit to size',
  },
  decisionRecords: {
    empties: { 'nothing-of-this-kind': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, 'docs-canonical/adr/0001-use-queue.md': '# 0001 Use a queue\n\n**Status**: accepted\n\nWe use a queue.\n' } },
    why: 'a decision record is a record to judge',
  },
  aidlc: {
    empties: {
      'needs-content': { files: { ...BASE, 'aidlc-docs/aidlc-state.md': '# State\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'aidlc-docs/inception/traceability.json': JSON.stringify({ stage: 'inception', upstream_ids: [], coverage: [{ id: 'REQ-1', status: 'OK', target: 'src/index.js' }] }) } },
  },
  canonicalSync: {
    empties: {
      'needs-content': { files: { 'package.json': JSON.stringify({ name: 'docguard-cli' }), 'cli/commands/a.mjs': '', 'cli/validators/b.mjs': '', 'README.md': '# Readme\n\nNothing counted here.\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': JSON.stringify({ name: 'docguard-cli' }), 'cli/commands/a.mjs': '', 'cli/validators/b.mjs': '', 'README.md': '# Readme\n\nDocGuard ships 1 commands and has all 1 validators.\n' } },
  },
  metricsConsistency: {
    empties: {
      'layout-not-recognized': { files: { ...BASE, 'README.md': '# Readme\n\nThe service has 16 extractors.\n' }, extra: { collections: { extractors: 'src/extractors/*.js' } }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind': { files: { ...BASE, 'README.md': '# Readme\n\nA small service.\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'src/extractors/one.js': 'export const one = 1;\n', 'README.md': '# Readme\n\nThe service has 1 extractor.\n' }, extra: { collections: { extractors: 'src/extractors/*.js' } } },
  },
};

function run(key, fixture) {
  const dir = project(fixture.files, cfg(key, fixture.extra || {}), fixture.opts || {});
  const config = loadConfig(dir);
  const data = runGuardInternal(dir, config);
  return { dir, config, data, result: data.validators.find(v => v.key === key) };
}

const MODULE = {
  specRegistry: 'spec-registry', docDependency: 'doc-dependency', requirementAnchors: 'requirement-anchors',
  pathScopedRules: 'path-scoped-rules', docOwnership: 'doc-ownership', evidence: 'evidence',
  crossReference: 'cross-reference', generatedStaleness: 'generated-staleness', suppressions: 'suppressions',
  diffSuspicion: 'diff-suspicion', referenceExistence: 'reference-existence', apiDocSmells: 'api-doc-smells',
  decisionRecords: 'decision-records', aidlc: 'aidlc', canonicalSync: 'canonical-sync', metricsConsistency: 'metrics-consistency',
};

describe('group B: the result contract, per validator', () => {
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
          assert.equal(result.verdict === 'empty' || result.verdict === 'skipped', true, `verdict ${result.verdict}`);
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
        assert.equal(typeof mod.applies, 'function', `${MODULE[key]}.mjs exports applies`);
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const { dir, config } = run(key, fixture);
          const a = mod.applies(dir, config);
          assert.equal(a.applies, fixture.cause !== 'nothing-of-this-kind', name);
          assert.ok(a.evidence.length > 0, name);
        }
        const { dir, config } = run(key, FIXTURES[key].fix || FIXTURES[key].applying);
        assert.equal(mod.applies(dir, config).applies, true, 'the applying project applies');
      });

      it('under strict, an applicable empty result blocks and a skipped one does not', () => {
        for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
          const { data, result } = run(key, fixture);
          if (fixture.cause === 'nothing-of-this-kind') {
            assert.equal(result.verdict, 'skipped', name);
            assert.ok(!data.strict.blocking.includes(key), name);
          } else {
            assert.equal(result.verdict, 'empty', name);
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

  it('no applicable empty result of the group shares its fix text with another', () => {
    const seen = new Map();
    for (const key of KEYS) {
      for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
        if (fixture.cause === 'nothing-of-this-kind') continue;
        const how = run(key, fixture).result.howToConfigure;
        // One validator may give the same fix for the same cause on two fixtures; two validators may not share one.
        for (const [other, who] of seen) if (!who.startsWith(`${key}/`)) assert.notEqual(how, other, `${key}/${name} shares its fix with ${who}`);
        seen.set(how, `${key}/${name}`);
      }
    }
  });

  it('no fix text leads to a pass that checks nothing', () => {
    // A drafted ownership block is the known trap: its purpose is a placeholder (OWN008).
    const { result } = run('docOwnership', FIXTURES.docOwnership.empties['needs-content']);
    assert.match(result.howToConfigure, /edit|write/i);
    assert.doesNotMatch(result.howToConfigure, /--suggest(?![^.]*(edit|before))/i);
  });
});

describe('group B: the draft marker DocGuard writes is the one Generated-Staleness reads', () => {
  it('a document carrying the generator\'s own draft marker is counted as a draft check', () => {
    const { result } = run('generatedStaleness', FIXTURES.generatedStaleness.fix);
    assert.equal(result.performed, 1);
    assert.deepEqual(result.findings.map(f => f.code), ['GST001']);
  });
});

describe('group B: standard mode keeps its verdicts', () => {
  it('a validator that does not apply is not skipped under standard', () => {
    // FR-006: `skipped` follows `applies: false` under strict only.
    const fixture = FIXTURES.suppressions.empties['nothing-of-this-kind'];
    const dir = project(fixture.files, cfg('suppressions', { enforcement: 'standard' }));
    const result = runGuardInternal(dir, loadConfig(dir)).validators.find(v => v.key === 'suppressions');
    assert.notEqual(result.verdict, 'skipped');
    assert.equal(result.applies.applies, false);
  });

  it('a padded total still prints: counts and the badge do not move', () => {
    const fixture = FIXTURES.requirementAnchors.empties['needs-content'];
    const dir = project(fixture.files, cfg('requirementAnchors', { ...fixture.extra, enforcement: 'standard' }));
    const result = runGuardInternal(dir, loadConfig(dir)).validators.find(v => v.key === 'requirementAnchors');
    assert.equal(result.total, 1);
    assert.equal(result.performed, 0);
    assert.equal(result.verdict, 'empty');
  });
});

describe('group B: an observation gap is not an empty result', () => {
  const gapped = { key: 'k', performed: 0, applies: { applies: true, evidence: 'x' }, findings: [], errors: [], warnings: [] };
  it('validateResultContract does not ask a gap for a cause or a fix', () => {
    assert.deepEqual(validateResultContract({ ...gapped, applicability: { status: 'missing-prerequisite', reason: 'git unreadable' } }), []);
    assert.deepEqual(validateResultContract({ ...gapped, applicability: { status: 'partial', reason: 'a part was not read' } }), []);
    assert.deepEqual(validateResultContract({ ...gapped, observations: [{ operation: 'git', cause: 'unreadable', scope: { count: 1 } }] }), []);
  });
  it('an empty result with no gap still needs both', () => {
    assert.match(validateResultContract({ ...gapped, applicability: { status: 'no-matches', reason: 'x' } }).join(), /emptyCause/);
    assert.match(validateResultContract(gapped).join(), /howToConfigure/);
  });
  it('a gap that carries a cause is still held to the cause rules', () => {
    assert.match(validateResultContract({ ...gapped, applicability: { status: 'partial', reason: 'x' }, emptyCause: 'nothing-of-this-kind' }).join(), /nothing-of-this-kind/);
  });
  for (const key of ['diffSuspicion', 'referenceExistence']) {
    it(`${key} with unreadable git is inconclusive, carries no cause, and passes the contract`, () => {
      const { result, data } = run(key, { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\nThe `computeTotal` helper.\n' }, opts: { brokenGit: true } });
      assert.equal(result.verdict, 'inconclusive');
      assert.equal(result.emptyCause, undefined);
      assert.equal(result.howToConfigure, undefined);
      assert.equal(result.applies.applies, true);
      assert.equal(result.performed, 0);
      assert.deepEqual(validateResultContract(result), []);
      assert.ok(data.strict.blocking.includes(key), 'an inconclusive validator that applies still blocks under strict');
    });
  }
});
