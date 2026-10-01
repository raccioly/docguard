/**
 * Fixes found by dogfooding real repositories (specs/050-dogfood-findings):
 * a string agent file, a nested canonical doc filling its role, and a
 * dependency count read only where a table says it is one.
 *
 * @req docguard.dogfood-findings#FR-001
 * @req docguard.dogfood-findings#FR-002
 * @req docguard.dogfood-findings#FR-003
 * @req docguard.dogfood-findings#FR-004
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
import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';

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
});

describe('the CHANGELOG describes the fixes (FR-004)', () => {
  it('names the string agent file, the nested role and the scoring table', () => {
    const text = readFileSync(resolve('CHANGELOG.md'), 'utf8');
    const unreleased = text.slice(text.indexOf('## [Unreleased]'), text.indexOf('\n## [', text.indexOf('## [Unreleased]') + 5));
    assert.match(unreleased, /agentFile/);
    assert.match(unreleased, /nested DATA-MODEL\.md|nested canonical/);
    assert.match(unreleased, /scoring table/);
  });
});
