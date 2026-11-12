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
