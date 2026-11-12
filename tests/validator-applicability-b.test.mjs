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

import { ALL_KEYS, BASE, CONFIG_FILES, DOCS, FIXTURES, FINAL_TEMPLATE, KEYS, NON_REQUIREMENT_IDS, PKG, SPEC, SPEC_SHORT_IDS, SPEC_TEMPLATE, SRC, cfg, only, project, put, run, temporary } from './helpers/applicability-fixtures-b.mjs';

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

describe('group B: defects of the Stage A proof (spec 097 T018b, T018d)', () => {
  it('Generated-Staleness reads a draft status only from front matter or the marker', () => {
    const { result } = run('generatedStaleness', { files: { ...BASE, 'docs-canonical/TEMPLATE.md': FINAL_TEMPLATE } });
    assert.equal(result.applies.applies, false, result.applies.evidence);
  });
  it('Generated-Staleness names the file it found', () => {
    for (const files of [
      { ...BASE, 'README.md': '# Readme\n\n<!-- docguard:section id=x source=code -->\nx\n<!-- /docguard:section -->\n' },
      { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\n<!-- docguard:section id=zzz source=code -->\nx\n<!-- /docguard:section -->\n' },
    ]) {
      const { result } = run('generatedStaleness', { files });
      assert.match(result.applies.evidence, /(README|ARCHITECTURE)\.md/);
    }
  });

  it('Spec-Registry: a spec that carries no Spec ID was still examined', () => {
    const files = { ...BASE, 'specs/001-a/spec.md': '# Feature: A\n\n- **FR-001**: The system MUST do a.\n', 'specs/002-b/spec.md': '# Feature: B\n\n- **FR-001**: The system MUST do b.\n' };
    const { result } = run('specRegistry', { files });
    assert.equal(result.performed, 2);
  });
  it('a result whose findings are all taken away (baseline, waiver) is still a complete contract', () => {
    // The class that let Spec-Registry return `empty` with no cause: performed 0 beside findings that a baseline later removed.
    for (const key of KEYS) {
      const fixture = FIXTURES[key].fix || FIXTURES[key].applying;
      const { result } = run(key, fixture);
      const stripped = { ...result, findings: [], errors: [], warnings: [] };
      if (stripped.performed === 0) assert.deepEqual(validateResultContract({ ...stripped, verdict: 'empty' }).filter(p => /emptyCause|howToConfigure/.test(p)), [], `${key}: performed 0 beside findings that a baseline can remove`);
    }
    const files = { ...BASE, 'specs/001-a/spec.md': '# Feature: A\n\n- **FR-001**: The system MUST do a.\n' };
    const { result } = run('specRegistry', { files });
    assert.ok(result.performed >= 1, 'findings beside zero performed checks');
  });

  it('Requirement-Anchors does not count a placeholder requirement line', () => {
    const { result } = run('requirementAnchors', { files: { ...BASE, ...SPEC_TEMPLATE } });
    assert.equal(result.applies.applies, false);
    assert.match(result.applies.evidence, /placeholder/i);
  });
  it('Requirement-Anchors says where a Spec ID comes from and what to do when a spec has none', () => {
    const { result } = run('requirementAnchors', FIXTURES.requirementAnchors.empties['needs-declaration']);
    assert.match(result.howToConfigure, /\*\*Spec ID\*\*/);
    assert.match(result.howToConfigure, /specs --write/);
    assert.match(result.howToConfigure, /demo\.feature#FR-001/, 'the example names the spec project actually declares');
  });
  it('Requirement-Anchors reads IDs of a form the scanner does not as layout-not-recognized, and names the setting', () => {
    const { result } = run('requirementAnchors', FIXTURES.requirementAnchors.empties['layout-not-recognized (IDs of one digit)']);
    assert.equal(result.emptyCause, 'layout-not-recognized');
    assert.match(result.howToConfigure, /requirementPattern/);
    assert.match(result.applies.evidence, /FR-1/);
  });
  it('the requirementPattern the text names reads IDs of one digit', () => {
    const files = { ...BASE, ...SPEC_SHORT_IDS, 'src/index.js': '// @implements FR-1\nexport const a = 1;\n' };
    const { result } = run('requirementAnchors', { files, extra: { anchors: { enabled: true }, traceability: { requirementPattern: '\\b(FR)-(\\d{1,4})\\b' } } });
    assert.ok(result.performed >= 1, `performed ${result.performed}`);
  });
  it('the examples of Doc-Dependency and Requirement-Anchors name product source, never a configuration file', () => {
    for (const key of ['docDependency', 'requirementAnchors']) {
      const files = key === 'docDependency' ? { ...BASE, ...CONFIG_FILES, ...DOCS } : { ...BASE, ...CONFIG_FILES, ...SPEC };
      const { result } = run(key, { files });
      assert.doesNotMatch(`${result.applies.evidence} ${result.howToConfigure}`, /\.config\./, key);
      assert.match(`${result.applies.evidence} ${result.howToConfigure}`, /src\/index\.js/, key);
    }
  });
});

describe('group B: fix texts never tell a project to move code or documents (FR-007)', () => {
  it('no applicable empty result of the group says move, relocate or restructure', () => {
    for (const key of KEYS) {
      for (const [name, fixture] of Object.entries(FIXTURES[key].empties)) {
        const { result } = run(key, fixture);
        assert.doesNotMatch(result.howToConfigure || '', /\b(move|relocate|restructure|rename the (?:directory|folder))\b|under docs-canonical/i, `${key}/${name}: ${result.howToConfigure}`);
      }
    }
  });
  it('Cross-Reference names the roles mapping, and what it reads, for documents it does not read', () => {
    const { result } = run('crossReference', FIXTURES.crossReference.empties['layout-not-recognized']);
    assert.equal(result.emptyCause, 'layout-not-recognized');
    assert.match(result.howToConfigure, /docs\.roles/);
    assert.match(result.howToConfigure, /docs-canonical/);
  });
  it('a document mapped under docs.roles is read where it lives', () => {
    const { result } = run('crossReference', FIXTURES.crossReference.fix);
    assert.ok(result.performed >= 1);
  });
  it('layout-not-recognized is used only when the limit is DocGuard\'s: a project\'s own wrong glob is needs-content', () => {
    const { result } = run('metricsConsistency', FIXTURES.metricsConsistency.empties['needs-content (a declared glob matches no file)']);
    assert.equal(result.emptyCause, 'needs-content');
  });
});

describe('group B: Requirement-Anchors counts only requirement IDs (spec 097 T018f)', () => {
  it('a project whose only IDs are decision, open-item, task and design IDs does not apply, and says which kinds it saw', () => {
    const { result } = run('requirementAnchors', { files: { ...BASE, ...NON_REQUIREMENT_IDS } });
    assert.equal(result.applies.applies, false);
    for (const kind of [/decision/, /open-item/, /task/, /design/]) assert.match(result.applies.evidence, kind);
  });
  it('a requirement is an FR, NFR, SC or REQ ID in a spec or requirement document, and the evidence names those prefixes', () => {
    const { result } = run('requirementAnchors', FIXTURES.requirementAnchors.empties['needs-declaration']);
    assert.equal(result.applies.applies, true);
    assert.match(result.applies.evidence, /requirement ID/);
  });
  it('a configured requirement pattern is the definition: its IDs count wherever they are declared', () => {
    const { result } = run('requirementAnchors', { files: { ...BASE, ...NON_REQUIREMENT_IDS }, extra: { traceability: { requirementPattern: '\\b(ARCH)-(\\d{3})\\b' } } });
    assert.equal(result.applies.applies, true);
    assert.match(result.applies.evidence, /traceability\.requirementPattern/);
  });
});
