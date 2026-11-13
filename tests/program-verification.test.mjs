/**
 * Specs 081–092: the documentation each spec requires, and the outcomes that
 * are measured once rather than unit-tested.
 *
 * A docs requirement is checked here by the terms each named surface must
 * carry. A measured criterion is run here when it can be (the inconclusive
 * gate on this repository, the suppression listing, the DORA view); a
 * one-time measurement (a hermetic A/B over local projects, a hand precision
 * review, an end-to-end AI-DLC run) is checked by its recorded result in the
 * spec's Verification Notes, which names the criterion it answers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLI = resolve('cli/docguard.mjs');
const read = rel => readFileSync(rel, 'utf8');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });

/** [surface, terms it must carry]: a missing term is a docs requirement left undone. */
function describes(table) {
  for (const [file, terms] of table) {
    const text = file === '--help' ? run('--help').stdout : read(file);
    for (const term of terms) assert.ok(text.includes(term), `${file} should describe ${JSON.stringify(term)}`);
  }
}

/** The spec's Verification Notes, which must answer each listed criterion. */
function recorded(dir, ids) {
  const spec = read(`specs/${dir}/spec.md`);
  const at = spec.indexOf('## Verification Notes');
  assert.ok(at >= 0, `${dir} has Verification Notes`);
  const notes = spec.slice(at, spec.indexOf('\n## ', at + 5) === -1 ? undefined : spec.indexOf('\n## ', at + 5));
  for (const id of ids) assert.match(notes, new RegExp(`\\b${id}\\b`), `${dir} records ${id}`);
}

describe('documentation each spec requires', () => {
  // @req docguard.configured-canonical-paths#FR-007
  it('093: STR003 help, the canonical documents and the changelog', () => describes([
    ['docs/reference/findings.md', ['STR003']],
    ['docs-canonical/DATA-MODEL.md', ['spec 093']],
    ['docs-canonical/ARCHITECTURE.md', ['spec 093']],
    ['CHANGELOG.md', ['#625']],
  ]));

  // @req docguard.recorded-document-reviews#FR-013
  it('095: the findings reference, the canonical documents, the review help and the changelog', () => describes([
    ['docs/reference/findings.md', ['FRS006', 'FRS007']],
    ['docs-canonical/DATA-MODEL.md', ['.docguard-doc-reviews.json']],
    ['docs-canonical/ARCHITECTURE.md', ['Recorded document reviews']],
    ['CHANGELOG.md', ['spec 095']],
  ]));

  // @req docguard.verdict-contract#FR-017
  it('081: verdicts, classes, the ledger and --fail-on-inconclusive', () => describes([
    ['docs-canonical/DATA-MODEL.md', ['verdict', 'class', 'observations']],
    ['docs-canonical/ARCHITECTURE.md', ['spec 081']],
    ['docs-canonical/TEST-SPEC.md', ['tests/verdict-contract.test.mjs']],
    ['docs/commands.md', ['--fail-on-inconclusive']],
    ['docs/reference/findings.md', ['inconclusive']],
    ['action.yml', ['fail-on-inconclusive']],
    ['extensions/spec-kit-docguard/commands/guard.md', ['--fail-on-inconclusive']],
    ['CHANGELOG.md', ['docguard.verdict-contract']],
  ]));

  // @req docguard.authoring-contract#FR-007
  it('082: the authoring registry and STR007', () => describes([
    ['docs/reference/findings.md', ['STR007']],
    ['docs-canonical/TEST-SPEC.md', ['tests/authoring-contract.test.mjs']],
    ['docs-canonical/ARCHITECTURE.md', ['Authoring contract']],
    ['CHANGELOG.md', ['docguard.authoring-contract']],
  ]));

  // @req docguard.enforcement-ladder#FR-011
  it('083: requiredChecks, REQ001/REQ002 and policy', () => describes([
    ['schemas/docguard-config.schema.json', ['"requiredChecks"']],
    ['cli/findings.mjs', ['REQ001', 'REQ002']],
    ['docs/reference/findings.md', ['REQ001', 'REQ002']],
    ['--help', ['policy']],
    ['docs/commands.md', ['docguard policy']],
    ['CHANGELOG.md', ['docguard.enforcement-ladder']],
  ]));

  // @req docguard.accountable-suppressions#FR-009
  it('084: owner and expiry forms, and the waiver policies', () => describes([
    ['schemas/docguard-config.schema.json', ['"requireOwner"', '"maxDays"']],
    ['docs/configuration.md', ['owner:', 'expires:']],
    ['docs/reference/findings.md', ['IGN004', 'IGN005']],
    ['cli/findings.mjs', ['IGN004', 'IGN005']],
    ['CHANGELOG.md', ['docguard.accountable-suppressions']],
  ]));

  // @req docguard.upstream-coverage#FR-008
  it('085: SPK013 to SPK016', () => describes([
    ['cli/findings.mjs', ['SPK013', 'SPK014', 'SPK015', 'SPK016']],
    ['docs/reference/findings.md', ['SPK013', 'SPK016']],
    ['docs-canonical/TEST-SPEC.md', ['tests/upstream-coverage.test.mjs']],
    ['CHANGELOG.md', ['docguard.upstream-coverage']],
  ]));

  // @req docguard.decision-records#FR-009
  it('086: the Decision-Records validator and its switch', () => describes([
    ['cli/findings.mjs', ['DEC001', 'DEC006']],
    ['docs/reference/findings.md', ['DEC001', 'DEC006']],
    ['docs-canonical/ARCHITECTURE.md', ['spec 086']],
    ['docs-canonical/TEST-SPEC.md', ['tests/decision-records.test.mjs']],
    ['docs/configuration.md', ['decisionRecords']],
    ['CHANGELOG.md', ['docguard.decision-records']],
  ]));

  // @req docguard.release-trend-gate#FR-005
  it('087: the release gate and how to explain a change', () => describes([
    ['docs-canonical/CI-RECIPES.md', ['Release trend gate', 'Exit codes:']],
    ['docs-canonical/TEST-SPEC.md', ['tests/release-trend-gate.test.mjs']],
    ['CONTRIBUTING.md', ['tools/release-ab.mjs', 'Exit codes:']],
    ['CHANGELOG.md', ['docguard.release-trend-gate']],
  ]));

  // @req docguard.validator-fuzz#FR-005
  it('088: the fuzz harness and a deep run', () => describes([
    ['docs-canonical/TEST-SPEC.md', ['tests/validator-fuzz.test.mjs']],
    ['CONTRIBUTING.md', ['npm run fuzz', '--save']],
    ['CHANGELOG.md', ['docguard.validator-fuzz']],
  ]));

  // @req docguard.aidlc-profile#FR-008
  it('089: the AI-DLC validator and the comparison', () => describes([
    ['COMPARISONS.md', ['AI-DLC']],
    ['docs-canonical/ARCHITECTURE.md', ['spec 089']],
    ['docs-canonical/TEST-SPEC.md', ['tests/aidlc-profile.test.mjs']],
    ['docs/reference/findings.md', ['AID001', 'AID004']],
    ['docs/configuration.md', ['`aidlc`']],
    ['CHANGELOG.md', ['docguard.aidlc-profile']],
  ]));

  // @req docguard.aidlc-plugin#FR-007
  it('090: the plugin, its install guide and its sensor', () => describes([
    ['README.md', ['AI-DLC', 'docs/guides/aidlc.md']],
    ['docs/guides/aidlc.md', ['sensor --aidlc', 'aidlc engine plugin build']],
    ['docs-canonical/ARCHITECTURE.md', ['AI-DLC plugin and sensor']],
    ['docs-canonical/TEST-SPEC.md', ['tests/aidlc-plugin.test.mjs']],
    ['CHANGELOG.md', ['docguard.aidlc-plugin']],
  ]));

  // @req docguard.memory-governance#FR-006
  it('091: MEM001/MEM002 and the memory options', () => describes([
    ['docs/commands.md', ['--consolidate aidlc', '--export aidlc']],
    ['docs-canonical/ARCHITECTURE.md', ['91']],
    ['docs-canonical/DATA-MODEL.md', ['memory --consolidate aidlc']],
    ['docs-canonical/TEST-SPEC.md', ['tests/memory-governance.test.mjs']],
    ['docs/reference/findings.md', ['MEM001', 'MEM002']],
    ['CHANGELOG.md', ['docguard.memory-governance']],
  ]));

  // @req docguard.dora-evidence#FR-006
  it('092: the DORA view and the docs map', () => describes([
    ['docs/commands.md', ['--dora']],
    ['docs/ai-integration.md', ['docs.lifecycle', 'findingsBasis']],
    ['docs-canonical/ARCHITECTURE.md', ['DORA evidence']],
    ['docs-canonical/DATA-MODEL.md', ['score --dora --format json']],
    ['docs-canonical/TEST-SPEC.md', ['tests/dora-evidence.test.mjs']],
    ['CHANGELOG.md', ['docguard.dora-evidence']],
  ]));
});

describe('criteria measured on this repository', () => {
  // @req docguard.verdict-contract#SC-006
  it('081: guard --fail-on-inconclusive does not stop on this repository', () => {
    const r = run('guard', '--fail-on-inconclusive', '--format', 'json');
    assert.notEqual(r.status, 4, 'no validator left undecided');
    assert.equal(JSON.parse(r.stdout).verdicts.counts.inconclusive, 0);
  });

  // @req docguard.accountable-suppressions#SC-003
  it('084: every suppression lists its owner field', () => {
    const r = run('ignore', '--format', 'json');
    assert.equal(r.status, 0, r.stderr);
    const entries = JSON.parse(r.stdout).entries;
    assert.ok(entries.length > 0);
    for (const e of entries) assert.ok(Object.hasOwn(e, 'owner'), `${e.source || e.kind}: owner field`);
  });

  // @req docguard.dora-evidence#SC-002
  it('092: at least 6 of 8 documentation items scored, each with evidence', () => {
    const r = run('score', '--dora', '--format', 'json');
    assert.equal(r.status, 0, r.stderr);
    const scored = JSON.parse(r.stdout).dora.documentation.filter(i => i.score !== null);
    assert.ok(scored.length >= 6, `${scored.length} scored`);
    for (const i of scored) assert.ok(i.evidence.length > 0, i.id);
  });
});

describe('this repository collects its own promotion evidence', () => {
  // @req docguard.enforcement-ladder#SC-003
  it('CI restores the history on every run and saves it only on a push to main', () => {
    const ci = read('.github/workflows/ci.yml');
    const restore = ci.indexOf('uses: actions/cache/restore@');
    const gate = ci.indexOf('node cli/docguard.mjs ci ');
    const save = ci.indexOf('uses: actions/cache/save@');
    assert.ok(restore > 0 && restore < gate && gate < save, 'restore, then ci, then save');
    assert.match(ci, /node cli\/docguard\.mjs policy/);
    const saveStep = ci.slice(ci.lastIndexOf('- name:', save), save);
    assert.match(saveStep, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.equal((ci.match(/path: \.docguard\/history\.jsonl/g) || []).length, 2);
  });
});

describe('one-time measurements, recorded', () => {
  // @req docguard.verdict-contract#SC-004
  // @req docguard.verdict-contract#SC-005
  it('081: the hermetic A/B and the fault-injection run', () => recorded('081-verdict-contract', ['SC-004', 'SC-005']));
  // @req docguard.authoring-contract#SC-002
  it('082: the A/B with score', () => recorded('082-authoring-contract', ['SC-002']));
  // @req docguard.enforcement-ladder#SC-002
  // @req docguard.enforcement-ladder#SC-003
  it('083: the A/B without requiredChecks, and the policy run checked by hand', () => recorded('083-enforcement-ladder', ['SC-002', 'SC-003']));
  // @req docguard.accountable-suppressions#SC-002
  it('084: the A/B', () => recorded('084-accountable-suppressions', ['SC-002']));
  // @req docguard.upstream-coverage#SC-002
  // @req docguard.upstream-coverage#SC-003
  it('085: hand precision and the A/B', () => recorded('085-upstream-coverage', ['SC-002', 'SC-003']));
  // @req docguard.decision-records#SC-002
  it('086: the A/B and DEC precision', () => recorded('086-decision-records', ['SC-002']));
  // @req docguard.release-trend-gate#SC-002
  // @req docguard.release-trend-gate#SC-003
  it('087: the gate between v0.45.2 and this program, and its time on the v0.46.0 release', () => recorded('087-release-trend-gate', ['SC-002', 'SC-003']));
  // @req docguard.validator-fuzz#SC-002
  it('088: six deep seeds', () => recorded('088-validator-fuzz', ['SC-002']));
  // @req docguard.aidlc-profile#SC-002
  // @req docguard.aidlc-profile#SC-003
  it('089: the seeded scratch project and the A/B', () => recorded('089-aidlc-profile', ['SC-002', 'SC-003']));
  // @req docguard.aidlc-plugin#SC-001
  // @req docguard.aidlc-plugin#SC-003
  it('090: the end-to-end fires and validate/build locally and in CI', () => recorded('090-aidlc-plugin', ['SC-001', 'SC-003']));
  // @req docguard.memory-governance#SC-003
  it('091: the A/B', () => recorded('091-memory-governance', ['SC-003']));
  // @req docguard.configured-canonical-paths#SC-002
  it('093: the A/B over local projects', () => recorded('093-configured-canonical-paths', ['SC-002']));
  // @req docguard.agent-instruction-role#SC-002
  // @req docguard.agent-instruction-role#SC-003
  it('094: the A/B and the budget run', () => recorded('094-agent-instruction-role', ['SC-002', 'SC-003']));
  // @req docguard.recorded-document-reviews#SC-002
  // @req docguard.recorded-document-reviews#SC-003
  // @req docguard.recorded-document-reviews#SC-004
  it('095: the TestGuard reproduction, the history replay and the A/B', () => recorded('095-recorded-document-reviews', ['SC-002', 'SC-003', 'SC-004']));
  // @req docguard.file-kinds#SC-002
  // @req docguard.file-kinds#SC-003
  it('100: the A/B at each stage and the gates', () => recorded('100-file-kinds', ['SC-002', 'SC-003']));
});
