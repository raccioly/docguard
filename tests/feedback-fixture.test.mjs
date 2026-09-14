import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * @req docguard.precision-evidence-loop#FR-011
 * @req docguard.precision-evidence-loop#FR-012
 * @req docguard.precision-evidence-loop#FR-013
 * @req docguard.precision-evidence-loop#FR-014
 * @req docguard.precision-evidence-loop#FR-015
 * @req docguard.precision-evidence-loop#FR-016
 * @req docguard.precision-evidence-loop#SC-006
 * @req docs-canonical/REQUIREMENTS.md#FR-005
 */

import {
  assertContributionReady, buildTestOnlyContribution, feedbackDuplicateIdentity,
  feedbackSearchUrls, parseFeedbackFixture, reduceFixtureDeterministically,
} from '../cli/feedback-fixture.mjs';

const template = () => JSON.parse(readFileSync(resolve('templates/feedback-fixture.json'), 'utf8'));

describe('synthetic feedback fixture contract', () => {
  it('accepts all feedback classes without conflating false negatives with false positives', () => {
    for (const [classification, predicate] of [
      ['false_positive', 'finding_present'], ['false_negative', 'finding_absent'],
      ['unsupported_syntax', 'validator_unsupported'], ['ambiguous', 'finding_present'],
      ['policy_disagreement', 'finding_present'],
    ]) {
      const value = template();
      value.classification = classification;
      value.interestingness.predicate = predicate;
      assert.equal(parseFeedbackFixture(value).classification, classification);
    }
  });

  it('rejects unreviewed provenance, path escape, control mismatch, and unknown fields', () => {
    const cases = [];
    const provenance = template(); provenance.provenance.redactionAttested = false; cases.push(provenance);
    const escape = template(); escape.fixture.files[0].path = '../private.js'; cases.push(escape);
    const mismatch = template(); mismatch.oppositeControl.files[0].path = 'src/other.js'; cases.push(mismatch);
    const unknown = template(); unknown.privateRepository = 'customer'; cases.push(unknown);
    for (const value of cases) assert.throws(() => parseFeedbackFixture(value));
  });

  it('derives stable duplicate identity and explicit open/closed searches from synthetic shape', () => {
    const manifest = parseFeedbackFixture(template());
    assert.equal(feedbackDuplicateIdentity(manifest), feedbackDuplicateIdentity(manifest));
    const urls = feedbackSearchUrls(manifest);
    assert.match(urls.identity, /^dgf-[a-f0-9]{16}$/);
    assert.match(decodeURIComponent(urls.open), /state:open/);
    assert.match(decodeURIComponent(urls.closed), /state:closed/);
    assert.doesNotMatch(decodeURIComponent(urls.all), /state:/);
  });

  it('reduces in deterministic line order and refuses to claim an unreproduced predicate', () => {
    const manifest = parseFeedbackFixture(template());
    manifest.fixture.files[0].content = 'remove one\nKEEP\nremove two\n';
    const interesting = value => value.fixture.files[0].content.includes('KEEP');
    const first = reduceFixtureDeterministically(manifest, interesting);
    const second = reduceFixtureDeterministically(manifest, interesting);
    assert.equal(first.status, 'REDUCED');
    assert.equal(first.manifest.fixture.files[0].content, 'KEEP');
    assert.deepEqual(first, second);
    assert.equal(reduceFixtureDeterministically(manifest, () => false).status, 'NOT_REPRODUCED');
  });

  it('enforces contribution evidence and emits a syntax-valid test-only regression', t => {
    const manifest = parseFeedbackFixture(template());
    assert.equal(assertContributionReady(manifest), true);
    const source = buildTestOnlyContribution(manifest);
    assert.match(source, /fixtureHas, false/);
    assert.match(source, /controlHas, true/);
    const dir = mkdtempSync(join(tmpdir(), 'docguard-feedback-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'contribution.test.mjs');
    writeFileSync(path, source);
    const checked = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);

    const missing = structuredClone(manifest); missing.contribution = null;
    assert.throws(() => assertContributionReady(missing), /requires testOnly/);
    const policy = structuredClone(manifest); policy.classification = 'policy_disagreement';
    assert.throws(() => assertContributionReady(policy), /require adjudication/);
  });
});

describe('feedback fixture CLI', () => {
  it('reproduces, reduces, previews, and writes only on explicit non-preview use', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-feedback-cli-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'feedback.json'), JSON.stringify(template()));
    const cli = resolve('cli/docguard.mjs');
    const run = args => spawnSync(process.execPath, [cli, 'feedback', '--dir', dir, '--format', 'json', '--fixture-manifest', 'feedback.json', ...args], { encoding: 'utf8' });

    const preview = run(['--reduce', '--contribution', 'tests/case.test.mjs', '--preview']);
    assert.equal(preview.status, 0, preview.stderr);
    const candidate = JSON.parse(preview.stdout);
    assert.equal(candidate.status, 'READY');
    assert.equal(candidate.reproductionConfirmed, true);
    assert.equal(candidate.controlConfirmed, true);
    assert.equal(candidate.record, null);
    assert.equal(candidate.contribution, null);
    assert.match(candidate.contributionPreview, /node:test/);

    const write = run(['--contribution', 'tests/case.test.mjs']);
    assert.equal(write.status, 0, write.stderr);
    const saved = JSON.parse(write.stdout);
    assert.match(saved.record, /^\.docguard\/feedback\//);
    assert.equal(saved.contribution, 'tests/case.test.mjs');
    assert.ok(readFileSync(join(dir, saved.record), 'utf8').includes('redactionAttested'));
    assert.ok(readFileSync(join(dir, saved.contribution), 'utf8').includes('node:test'));
  });
});
