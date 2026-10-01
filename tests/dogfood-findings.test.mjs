/**
 * Fixes found by dogfooding real repositories (specs/050-dogfood-findings):
 * a string agent file, a nested canonical doc filling its role, and a
 * dependency count read only where a table says it is one.
 *
 * @req docguard.dogfood-findings#FR-001
 * @req docguard.dogfood-findings#FR-002
 * @req docguard.dogfood-findings#FR-003
 * @req docguard.dogfood-findings#FR-004
 * @req docguard.dogfood-findings#FR-005
 * @req docguard.dogfood-findings#FR-006
 * @req docguard.dogfood-findings#SC-001
 * @req docguard.dogfood-findings#SC-002
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../cli/config.mjs';
import { resolveDocRole } from '../cli/shared-doc-roles.mjs';
import { validateMetricsConsistency, isWholeSuiteClaim, isSuiteClaimFile } from '../cli/validators/metrics-consistency.mjs';
import { notesSince } from './fixtures/changelog-notes.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-050-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' } });

describe('a string agent file works everywhere (FR-001)', () => {
  const dir = () => project({
    '.docguard.json': JSON.stringify({ projectName: 'acme', requiredFiles: { agentFile: 'AGENTS.md' } }),
    'AGENTS.md': '# Agents\n\nRules.\n',
    'package.json': JSON.stringify({ name: 'acme', version: '1.0.0' }),
  });

  it('config loading turns a string into a one-element list', () => {
    assert.deepEqual(loadConfig(dir()).requiredFiles.agentFile, ['AGENTS.md']);
  });

  for (const args of [['score'], ['score', '--format', 'json'], ['fix']]) {
    it(`${args.join(' ')} does not crash`, () => {
      const r = cli(dir(), args);
      assert.doesNotMatch(r.stderr, /is not a function/);
      assert.ok(r.status !== null && r.status <= 2, `exit ${r.status}: ${r.stderr.slice(0, 300)}`);
      if (args.includes('json')) JSON.parse(r.stdout);
    });
  }

  it('an existing AGENTS.md counts as the agent file in the score', () => {
    const r = JSON.parse(cli(dir(), ['score', '--format', 'json']).stdout);
    assert.doesNotMatch(JSON.stringify(r), /missing agent file/);
  });
});

describe('a nested canonical doc fills its role (FR-002)', () => {
  const nested = 'docs-canonical/03-architecture/DATA-MODEL.md';
  it('resolves to the single same-named canonical doc when the default is missing', () => {
    const dir = project({ [nested]: '# Data Model\n' });
    assert.equal(resolveDocRole(dir, loadConfig(dir), 'dataModel'), resolve(dir, nested));
  });

  it('two same-named docs are ambiguous: the default path is kept', () => {
    const dir = project({ [nested]: '# A\n', 'docs-canonical/04-data/DATA-MODEL.md': '# B\n' });
    assert.equal(resolveDocRole(dir, loadConfig(dir), 'dataModel'), resolve(dir, 'docs-canonical/DATA-MODEL.md'));
  });

  it('an existing default path wins', () => {
    const dir = project({ 'docs-canonical/DATA-MODEL.md': '# Root\n', [nested]: '# Nested\n' });
    assert.equal(resolveDocRole(dir, loadConfig(dir), 'dataModel'), resolve(dir, 'docs-canonical/DATA-MODEL.md'));
  });

  it('an explicit docs.roles mapping wins', () => {
    const dir = project({ [nested]: '# Nested\n', 'docs/model.md': '# Mapped\n', '.docguard.json': JSON.stringify({ docs: { roles: { dataModel: 'docs/model.md' } } }) });
    assert.equal(resolveDocRole(dir, loadConfig(dir), 'dataModel'), resolve(dir, 'docs/model.md'));
  });

  it('SCH001 stays silent for a project whose DATA-MODEL.md is nested', () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 'acme', requiredFiles: { canonical: [nested] } }),
      [nested]: '# Data Model\n\n## Entities\n\n### User\n\n| Field | Type |\n|---|---|\n| id | string |\n',
      'package.json': JSON.stringify({ name: 'acme', dependencies: { mongoose: '8.0.0' } }),
      'models/User.js': "const mongoose = require('mongoose');\nconst User = new mongoose.Schema({ id: String });\nmodule.exports = mongoose.model('User', User);\n",
    });
    const r = JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout);
    assert.equal(r.findings.filter(f => f.code === 'SCH001').length, 0);
  });
});

describe('a dependency count is read only where it is one (FR-003)', () => {
  const met004 = files => validateMetricsConsistency(project({ 'package.json': JSON.stringify({ name: 'acme', dependencies: { a: '1', b: '1', c: '1' } }), ...files }), {})
    .findings.filter(f => f.code === 'MET004');

  it('a scoring table row is not a dependency count', () => {
    assert.equal(met004({ 'docs/checklist.md': '| Section | Max Points | Actual |\n|---|---|---|\n| Dependencies | 5 | |\n' }).length, 0);
  });

  it('a count table still is', () => {
    assert.equal(met004({ 'docs/facts.md': '| Metric | Count |\n|---|---|\n| Dependencies | 5 |\n' }).length, 1);
  });

  it('a label line still is', () => {
    assert.equal(met004({ 'docs/facts.md': '**Dependencies:** 5\n' }).length, 1);
  });

  it('"2 External Dependencies" in a plan is not a package count (FR-005)', () => {
    assert.equal(met004({ 'docs/plan.md': '### 2 External Dependencies\n\nVendor sign-off and network cutover.\n' }).length, 0);
  });

  it('"no npm dependency" (singular) describes a change, not the package (FR-005)', () => {
    assert.equal(met004({ 'docs/program.md': 'Use a small built-in map (no npm dependency — adding one is stop-and-ask).\n' }).length, 0);
    assert.equal(met004({ 'README.md': 'No npm dependencies at runtime.\n' }).length, 1);
  });

  it('"zero external dependencies" and a software-context count still are (FR-005)', () => {
    assert.equal(met004({ 'README.md': 'Ships with zero external dependencies.\n' }).length, 1);
    assert.equal(met004({ 'README.md': 'The package has 2 external dependencies installed from npm.\n' }).length, 1);
  });
});

describe('"N tests" is checked only as a claim about today\'s whole suite (FR-006)', () => {
  it('a commit-pinned or subset count is not a whole-suite claim', () => {
    assert.equal(isWholeSuiteClaim('Automated: 49 frontend files (606 tests) pass on `9c55dac6`'), false);
    assert.equal(isWholeSuiteClaim('All 116 tests pass at 9c55dac6e1'), false);
    assert.equal(isWholeSuiteClaim('The 12 unit tests pass'), false);
    assert.equal(isWholeSuiteClaim('The suite has 116 tests'), true);
    assert.equal(isWholeSuiteClaim('`npm test` runs 116 tests'), true);
  });

  it('spec artifacts and dated records are not suite documents', () => {
    assert.equal(isSuiteClaimFile('specs/20260928-093212-broadcast/research.md'), false);
    assert.equal(isSuiteClaimFile('docs-implementation/audits/remediation-plan-2026-07-11.md'), false);
    assert.equal(isSuiteClaimFile('docs-implementation/TESTING.md'), true);
    assert.equal(isSuiteClaimFile('README.md'), true);
  });

  it('end to end: a stale suite count fires, a subset in a spec does not', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'acme' }),
      'tests/a.test.mjs': Array.from({ length: 30 }, (_, i) => `test('t${i}', () => {});`).join('\n'),
      'README.md': 'The suite has 12 tests. Run `npm test`.\n',
      'specs/001-x/research.md': 'The suite gained 12 tests here; `npm test` passes.\n',
    };
    const found = validateMetricsConsistency(project(files), {}).findings.filter(f => f.code === 'MET003');
    assert.deepEqual(found.map(f => f.location.split(':')[0]), ['README.md']);
  });
});

describe('the CHANGELOG describes the fixes (FR-004)', () => {
  it('names the string agent file, the nested role and the scoring table', () => {
    const text = readFileSync(resolve('CHANGELOG.md'), 'utf8');
    const unreleased = notesSince(text, '0.42.1');
    assert.match(unreleased, /agentFile/);
    assert.match(unreleased, /nested DATA-MODEL\.md|nested canonical/);
    assert.match(unreleased, /scoring table/);
  });
});
