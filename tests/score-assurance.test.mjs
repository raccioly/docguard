import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildScoreAssurance, computeAlcoaCompliance, runScoreInternal } from '../cli/commands/score.mjs';
import { loadConfig } from '../cli/config.mjs';
import { buildReport, toMarkdown } from '../cli/commands/report.mjs';

// @req FR-001 — structural scores never assert a measured factual accuracy.
// @req FR-003 — score consumers preserve the same evidence limitations.
describe('score assurance', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  function fixture(text = 'A documented service.') {
    dir = mkdtempSync(join(tmpdir(), 'docguard-assurance-'));
    mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n' + text);
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'assurance', profile: 'starter', diskCache: false }));
    return loadConfig(dir);
  }
  it('does not treat zero extracted claims as verified prose', () => {
    const config = fixture();
    const a = buildScoreAssurance(dir, config);
    assert.equal(a.factualAccuracy, null);
    assert.equal(a.unverifiedClaims, 0);
    assert.equal(a.status, 'unverified');
    const scores = Object.fromEntries(['structure','docQuality','testing','security','environment','drift','changelog','architecture'].map(k => [k,100]));
    const accurate = computeAlcoaCompliance(dir, config, scores).attributes.find(a => a.name === 'Accurate');
    assert.equal(accurate.met, false);
    assert.equal(accurate.status, 'unverified');
  });
  it('counts candidate claims without asserting their correctness', () => {
    const config = fixture('Requests expire after 30 days.');
    const a = buildScoreAssurance(dir, config);
    assert.equal(a.unverifiedClaims, 1);
    assert.equal(a.factualAccuracy, null);
  });
  it('propagates assurance through score, diagnose, CI, and reports', () => {
    const config = fixture('Requests expire after 30 days.');
    const expected = runScoreInternal(dir, config);
    for (const command of ['score', 'diagnose', 'ci', 'report']) {
      const r = spawnSync(process.execPath, [join(process.cwd(),'cli/docguard.mjs'), command, '--dir', dir, '--format','json','--no-history'], {encoding:'utf8'});
      assert.ok([0,1,2].includes(r.status), r.stderr);
      const data = JSON.parse(r.stdout);
      const score = command === 'report' ? data.score : data;
      assert.equal(score.score, expected.score);
      assert.equal(score.scoreKind, 'structural-maturity');
      assert.deepEqual(score.assurance, expected.assurance);
      if (command === 'score') {
        assert.equal(data.memory.accuracy, null);
        assert.equal(typeof data.memory.structuralAlignment, 'number');
      }
    }
  });
  it('does not certify correctness when no checks emit findings', () => {
    const config = fixture('Requests expire after 30 days.');
    config.validators = new Proxy({}, { get: () => false });
    const report = buildReport(dir, config);
    assert.equal(report.findings.length, 0);
    assert.equal(report.guard.total, 0);
    assert.equal(report.score.assurance.unverifiedClaims, 1);
    const markdown = toMarkdown(report);
    assert.match(markdown, /No findings were emitted by the configured checks/);
    assert.match(markdown, /Factual accuracy remains unverified/);
    assert.doesNotMatch(markdown, /documentation matches the implementation/);
  });
  it('renders unverified ALCOA accuracy separately from unmet attributes', () => {
    const config = fixture();
    const report = buildReport(dir, config);
    const scores = Object.fromEntries(['structure','docQuality','testing','security','environment','drift','changelog','architecture'].map(k => [k,100]));
    report.alcoa = computeAlcoaCompliance(dir, config, scores);
    const markdown = toMarkdown(report);
    assert.match(markdown, /\| Accurate \| 🔍 unverified \|/);
    assert.match(markdown, /\| Attributable \| ❌ unmet \|/);
    assert.match(markdown, /\| Original \| ✅ met \|/);
    assert.doesNotMatch(markdown, /\| Accurate \| ❌/);
  });

});
