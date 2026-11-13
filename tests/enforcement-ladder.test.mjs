/**
 * Required checks and evidence-based rule promotion (specs/083-enforcement-ladder).
 *
 * @req docguard.enforcement-ladder#FR-001
 * @req docguard.enforcement-ladder#FR-002
 * @req docguard.enforcement-ladder#FR-003
 * @req docguard.enforcement-ladder#FR-004
 * @req docguard.enforcement-ladder#FR-005
 * @req docguard.enforcement-ladder#FR-006
 * @req docguard.enforcement-ladder#FR-007
 * @req docguard.enforcement-ladder#FR-008
 * @req docguard.enforcement-ladder#FR-009
 * @req docguard.enforcement-ladder#FR-010
 * @req docguard.enforcement-ladder#FR-012
 * @req docguard.enforcement-ladder#SC-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { FIXTURE_GIT } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');

const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };

function project(t, files, config) {
  const dir = makeTempDir('docguard-ladder-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'ladder', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, ...config }));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const json = (dir, ...args) => { const r = run(dir, ...args, '--format', 'json'); return { status: r.status, data: JSON.parse(r.stdout) }; };

const OFF = ['structure', 'docSections', 'docsSync', 'changelog', 'testSpec', 'environment', 'security', 'architecture', 'freshness', 'traceability', 'docsDiff', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry', 'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference', 'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells', 'canonicalSync', 'metricsConsistency'];
const validators = (...on) => Object.fromEntries(OFF.map(k => [k, on.includes(k)]).concat([['apiSurface', on.includes('apiSurface')], ['drift', on.includes('drift')]]));
const SRC = { 'src/index.js': 'export const a = 1;\n' };

describe('US1 — required checks', () => {
  it('an undecided required check exits 4 and is named; the control is unaffected', t => {
    const dir = project(t, SRC, { validators: validators('apiSurface', 'drift'), requiredChecks: ['apiSurface'] });
    const r = run(dir, 'guard');
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.match(r.stdout, /API-Surface is inconclusive \(required check\)/);
    const control = project(t, SRC, { validators: validators('apiSurface', 'drift') });
    assert.equal(run(control, 'guard').status, 0);
  });

  it('empty does not satisfy a required check; a reasoned N/A marker does', t => {
    const dir = project(t, SRC, { validators: validators('drift'), requiredChecks: ['drift'] });
    assert.equal(run(dir, 'guard').status, 4);
    const declared = project(t, { ...SRC, 'AGENTS.md': '# Agents\n\n<!-- docguard:validator drift n/a — generated code only, nothing hand-written to drift -->\n' }, { validators: validators('drift'), requiredChecks: ['drift'] });
    assert.equal(run(declared, 'guard').status, 0);
  });

  it('a required check that config disables is REQ001; an unknown key is REQ002 and the rest still apply', t => {
    const dir = project(t, SRC, { validators: validators('apiSurface'), requiredChecks: ['drift', 'apiSurfce', 'apiSurface'] });
    const { status, data } = json(dir, 'guard');
    assert.equal(status, 1);
    const req1 = data.findings.filter(f => f.code === 'REQ001');
    const req2 = data.findings.filter(f => f.code === 'REQ002');
    assert.equal(req1.length, 1); assert.match(req1[0].message, /drift/);
    assert.equal(req2.length, 1); assert.match(req2[0].message, /apiSurfce/); assert.match(req2[0].message, /apiSurface/);
    assert.ok(data.requiredChecks.undecided.some(u => u.key === 'apiSurface'));
  });

  it('without requiredChecks the validator list carries no requiredChecks result', t => {
    const dir = project(t, SRC, { validators: validators('apiSurface') });
    const { data } = json(dir, 'guard');
    assert.equal(data.validators.some(v => v.key === 'requiredChecks'), false);
    assert.equal(data.requiredChecks, undefined);
  });

  it('ci blocks readiness on an undecided required check', t => {
    const dir = project(t, SRC, { validators: validators('apiSurface'), requiredChecks: ['apiSurface'] });
    const { status, data } = json(dir, 'ci', '--no-history');
    assert.equal(status, 1);
    assert.ok(data.assessment.reasons.includes('CI_REQUIRED_CHECK_UNDECIDED'));
    assert.deepEqual(data.assessment.requiredUndecided.map(u => u.key), ['apiSurface']);
  });
});

describe('US3 — history records what promotion needs', () => {
  it('each ci entry carries docguardVersion, codes {n, level} and verdicts', t => {
    const dir = project(t, { ...SRC, 'AGENTS.md': '# Agents\n\n- Billing: `docs/missing.md`\n' }, { validators: validators('pathScopedRules') });
    run(dir, 'ci', '--format', 'json');
    run(dir, 'ci', '--format', 'json');
    const lines = readFileSync(join(dir, '.docguard/history.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 2);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const e of lines) {
      assert.equal(e.docguardVersion, pkg.version);
      assert.deepEqual(e.codes.PSR002, { n: 1, level: 'warn' });
      assert.equal(typeof e.verdicts.pass, 'number');
      assert.equal(e.verdicts.gaps, 0);
    }
  });
});

describe('US2 — policy', () => {
  const entry = (codes, extra = {}) => JSON.stringify({ timestamp: '2026-11-01T00:00:00Z', score: 90, status: 'PASS', docguardVersion: '0.46.0', codes, verdicts: { pass: 1, fail: 0, empty: 0, inconclusive: 0, blocked: 0, skipped: 0, gaps: 0 }, ...extra });
  const history = (dir, lines) => write(dir, '.docguard/history.jsonl', lines.join('\n') + '\n');

  it('promotes an advisory code silent for the window after it was seen; flags a noisy blocking code', async t => {
    const { buildPolicyReport } = await import('../cli/commands/policy.mjs');
    const dir = project(t, SRC, {});
    history(dir, [
      entry({ PSR001: { n: 2, level: 'warn' }, SEC001: { n: 1, level: 'error' } }),
      ...Array.from({ length: 6 }, (_, i) => entry(i % 2 ? { SEC001: { n: 1, level: 'error' } } : {})),
    ]);
    const report = buildPolicyReport(dir, { requiredChecks: [] }, { window: 5 });
    const psr = report.codes.find(c => c.code === 'PSR001');
    assert.equal(psr.category, 'ready-to-promote');
    assert.equal(psr.runs, 5); assert.equal(psr.hits, 0);
    assert.match(psr.promote, /"findingSeverity": \{ "PSR001": "high" \}/);
    const sec = report.codes.find(c => c.code === 'SEC001');
    assert.equal(sec.category, 'noisy-blocking');
  });

  it('too few runs is insufficient evidence; gap runs and pre-0.46 entries are not counted', async t => {
    const { buildPolicyReport } = await import('../cli/commands/policy.mjs');
    const dir = project(t, SRC, {});
    history(dir, [
      JSON.stringify({ timestamp: 'x', score: 1, status: 'PASS' }),
      entry({ PSR001: { n: 1, level: 'warn' } }),
      entry({}, { verdicts: { pass: 1, fail: 0, empty: 0, inconclusive: 1, blocked: 0, skipped: 0, gaps: 2 } }),
      entry({}), entry({}),
    ]);
    const report = buildPolicyReport(dir, {}, { window: 5 });
    assert.equal(report.history.usable, 3);
    assert.equal(report.history.withoutCodes, 1);
    assert.equal(report.history.withGaps, 1);
    assert.equal(report.codes.find(c => c.code === 'PSR001').category, 'insufficient-evidence');
    assert.match(report.note, /2 more usable runs/);
  });

  it('policy --format json reports every defined code and writes nothing', async t => {
    const { CODES } = await import('../cli/findings.mjs');
    const dir = project(t, SRC, {});
    const before = existsSync(join(dir, '.docguard'));
    const { status, data } = json(dir, 'policy');
    assert.equal(status, 0);
    assert.equal(data.codes.length, Object.keys(CODES).length);
    assert.equal(existsSync(join(dir, '.docguard')), before);
    assert.match(data.note, /no history/i);
  });
});

describe('FR-012 — advisory-only validators are not shown as warnings', () => {
  it('a row whose findings are all informational is informational; the same finding at warn is a warning', t => {
    const files = { ...SRC, 'AGENTS.md': '# Agents\n\n- Billing: `docs/missing.md`\n' };
    const advisory = project(t, files, { validators: validators('pathScopedRules'), findingSeverity: { PSR002: 'low' } });
    const out = run(advisory, 'guard').stdout;
    assert.match(out, /ℹ️ {2}Path-Scoped-Rules .*advisory findings only/);
    assert.doesNotMatch(out, /⚠️ {2}Path-Scoped-Rules/);
    assert.match(out, /• \[PSR002\]/, 'the finding is still listed');
    const warned = project(t, files, { validators: validators('pathScopedRules') });
    assert.match(run(warned, 'guard').stdout, /⚠️ {2}Path-Scoped-Rules/);
    const v = json(advisory, 'guard').data.validators.find(x => x.key === 'pathScopedRules');
    assert.deepEqual([v.status, v.effectiveStatus], ['warn', 'pass'], 'JSON keeps both statuses');
  });
});
