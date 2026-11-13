/**
 * Strict by default, Stage B core (specs/097-strict-by-default T019 to T023):
 * the default mode, every validator running under it, which findings fail a
 * build, the gating set derived from evidence, the rolling additions table, and
 * the baseline and uninitialized cases.
 *
 * No test here uses a hidden switch. A project that wants the lower mode writes
 * `"enforcement": "standard"` in its own `.docguard.json`, as an adopter does.
 *
 * @req docguard.strict-by-default#FR-001
 * @req docguard.strict-by-default#FR-003
 * @req docguard.strict-by-default#FR-008
 * @req docguard.strict-by-default#FR-009
 * @req docguard.strict-by-default#FR-011
 * @req docguard.strict-by-default#FR-012
 * @req docguard.strict-by-default#FR-013
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { FIXTURE_GIT } from './helpers/git.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

// The two root files a default configuration requires, so a fixture's only findings are the ones under test.
const ROOT_FILES = { 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n', 'DRIFT-LOG.md': '# Drift log\n' };
function project(files, config, { git = true } = {}) {
  const dir = makeTempDir('docguard-strict-default-');
  temporary.push(dir);
  for (const [path, body] of Object.entries({ ...(config ? ROOT_FILES : {}), ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  if (config) writeFileSync(join(dir, '.docguard.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  if (git) {
    execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
    execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  }
  return dir;
}
function guard(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function guardJson(dir, extra = []) {
  const r = guard(dir, ['--format', 'json', ...extra]);
  return { ...r, json: JSON.parse(r.out) };
}
const byKey = (json, key) => json.validators.find(v => v.key === key);
const ALL_KEYS = [
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
// The project's own file turns every other validator off, so the exit code is about the one under test.
const only = (...keys) => Object.fromEntries(ALL_KEYS.map(k => [k, keys.includes(k)]));
// Strict with every validator held pending by `asOf`: findings still resolve by FR-008, and the exit code is about them
// (not about validators of a small fixture that have nothing to examine).
const HELD = { mode: 'strict', asOf: '0.40' };
const base = extra => ({ projectName: 'sd', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, ...extra });

const PKG = JSON.stringify({ name: 'lib', version: '1.0.0' });
const ROUTES = {
  'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { express: '4.18.2' } }),
  'src/routes/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.json([]));\nmodule.exports = router;\n",
};
// A hardcoded credential in a product source file.
const LEAK = { 'package.json': PKG, 'src/config.js': "export const key = 'AKIAIOSFODNN7EXAMPLQ';\nexport const token = 'ghp_" + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8' + "';\n" };

// ── T019: the default and every validator (FR-001, FR-003) ──
describe('T019 FR-001: an absent key is strict', () => {
  it('resolveEnforcement({}) is strict from the default', async () => {
    const { resolveEnforcement } = await import('../cli/config.mjs');
    assert.deepEqual(resolveEnforcement({}), { mode: 'strict', asOf: null, source: 'default' });
    assert.deepEqual(resolveEnforcement({ enforcement: 'standard' }), { mode: 'standard', asOf: null, source: 'config' });
  });
  it('the mode line no longer says strict is coming', async () => {
    const { modeLine } = await import('../cli/enforcement.mjs');
    const line = modeLine({ mode: 'strict', asOf: null, source: 'default' });
    assert.match(line, /^Enforcement: strict/);
    assert.doesNotMatch(line, /later release/);
    assert.match(line, /standard/, 'it names the key that selects the lower mode');
  });
  it('guard on a project with no key runs strict and exits 4 for an unexamined validator', () => {
    const dir = project(ROUTES, base({ validators: { apiSurface: true } }));
    const { status, json } = guardJson(dir);
    assert.deepEqual(json.enforcement, { mode: 'strict', asOf: null, source: 'default' });
    assert.equal(status, 4);
    assert.ok(json.strict.unexamined.some(u => u.validator === 'apiSurface'));
  });
  it('"enforcement": "standard" restores the old exit code', () => {
    const dir = project(ROUTES, base({ enforcement: 'standard', validators: { apiSurface: true } }));
    assert.notEqual(guard(dir).status, 4);
  });
});

describe('T019 FR-003: every validator runs under strict; a `false` entry is not honored', () => {
  const files = { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' };
  const ran = (json, key) => byKey(json, key).status !== 'skipped';

  it('(a) a project on the starter profile runs every validator, and says which false entries it did not honor', () => {
    const dir = project(files, base({ profile: 'starter' }));
    const { json } = guardJson(dir);
    for (const key of ['security', 'architecture', 'testSpec', 'environment', 'drift', 'freshness']) assert.ok(ran(json, key), `${key} runs`);
    assert.ok(json.strict.ignoredDisabled.includes('testSpec') && json.strict.ignoredDisabled.includes('security'));
    const text = guard(dir).out;
    assert.match(text, /Not honored under strict .*"validators": false for .*security/);
    assert.match(text, /reasoned waiver/);
    assert.match(text, /"enforcement": "standard"/);
    assert.match(text, /Adopt — what strict found/, 'a starter project gets an Adopt block');
  });
  it('the default (no profile key) runs Security and Architecture, which the 0.47.0 defaults left off', () => {
    const { json } = guardJson(project(files, base()));
    assert.ok(ran(json, 'security') && ran(json, 'architecture'));
  });
  it('a false entry the project wrote itself (kebab-case too) is not honored either', () => {
    const { json } = guardJson(project(files, base({ validators: { security: false, 'test-spec': false } })));
    assert.ok(ran(json, 'security') && ran(json, 'testSpec'));
    assert.deepEqual(json.strict.ignoredDisabled.filter(k => ['security', 'testSpec'].includes(k)).sort(), ['security', 'testSpec']);
  });
  it('under standard the validators block works exactly as before, and nothing is reported', () => {
    const { json } = guardJson(project(files, base({ profile: 'starter', enforcement: 'standard', validators: { docQuality: false } })));
    assert.equal(byKey(json, 'security').status, 'skipped');
    assert.equal(byKey(json, 'docQuality').status, 'skipped');
    assert.equal(json.strict, undefined);
  });
  it('a reasoned waiver is the way to switch one off on purpose', () => {
    const waiver = '<!-- docguard:validator security n/a — fixture owner:@maintainers expires:2099-12-31 -->';
    const { json } = guardJson(project({ ...files, 'README.md': `# r\n\n${waiver}\n` }, base()));
    assert.equal(byKey(json, 'security').verdict, 'skipped');
    assert.ok(json.strict.waived.some(w => w.validator === 'security'));
  });
  it('the compact form lists keys only', () => {
    const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', project(files, base({ profile: 'starter' })), '--format', 'json', '--compact'], { encoding: 'utf8', env: ENV });
    const json = JSON.parse(r.stdout);
    assert.ok((json.strict?.ignoredDisabled || []).every(k => typeof k === 'string'));
  });
  it('--changed-only does not force validators on', () => {
    const dir = project(files, base({ profile: 'starter' }));
    const json = JSON.parse(guard(dir, ['--changed-only', '--format', 'json']).out);
    assert.equal(byKey(json, 'security').status, 'skipped', 'the lite set stays the lite set');
    assert.equal(json.strict.evaluated, false);
  });
});

// ── T020: which findings fail a build (FR-008) ──
describe('T020 FR-008: closed list and demotion', () => {
  it('the closed list is the plan list plus nothing', async () => {
    const { V047_ERROR_CODES } = await import('../cli/enforcement.mjs');
    assert.deepEqual([...V047_ERROR_CODES].sort(), ['ANC001', 'ANC003', 'ANC005', 'API004', 'DLK005', 'DRF001', 'DRF002', 'EVD001', 'EVD002', 'OWN007', 'REQ001', 'STR001', 'STR002']);
  });

  it('unit: the order is findingSeverity high, closed list, gating, then the demotion', async () => {
    const { resolveFindingEnforcement } = await import('../cli/shared.mjs');
    const { strictFindingContext } = await import('../cli/enforcement.mjs');
    const ctx = strictFindingContext({ gating: ['GAT001'] });
    const err = code => ({ code, severity: 'error' });
    const level = (config, finding, key) => resolveFindingEnforcement(config, finding, key, ctx).level;
    assert.equal(level({}, err('STR001'), 'structure'), 'error', 'a closed-list code stays an error');
    assert.equal(level({}, err('SEC001'), 'security'), 'warn', 'a Security intrinsic error is a warning');
    assert.equal(level({}, err('ARC001'), 'architecture'), 'warn', 'an Architecture intrinsic error is a warning');
    assert.equal(level({}, err('GAT001'), 'security'), 'error', 'a gating code is an error');
    assert.equal(level({}, { code: 'GAT001', severity: 'warn' }, 'docsSync'), 'error', 'a gating code fails even from a warning');
    assert.equal(level({}, { code: 'GAT001', severity: 'error', context: 'test-path' }, 'security'), 'warn', 'a test-path finding is never gating');
    assert.equal(level({ findingSeverity: { SEC001: 'high' } }, err('SEC001'), 'security'), 'error', 'high wins over the demotion');
    assert.equal(level({ findingSeverity: { STR001: 'medium' } }, err('STR001'), 'structure'), 'warn', 'medium keeps its level');
    assert.equal(level({ findingSeverity: { STR001: 'low' } }, err('STR001'), 'structure'), 'info', 'low keeps its level');
    assert.equal(level({}, { code: 'DOC001', severity: 'warn' }, 'docQuality'), 'warn', 'a plain warning is unchanged');
  });
  it('unit: without a strict context nothing changes', async () => {
    const { resolveFindingEnforcement } = await import('../cli/shared.mjs');
    assert.equal(resolveFindingEnforcement({}, { code: 'SEC001', severity: 'error' }, 'security').level, 'error');
  });

  it('e2e: a secret in a product file is a warning under the strict default (exit 2), an error under standard with Security on (exit 1)', () => {
    const strictRun = guardJson(project(LEAK, base({ enforcement: HELD })));
    const sec = strictRun.json.findings.filter(f => /^SEC00/.test(f.code));
    assert.ok(sec.length > 0, 'the fixture produces a Security finding');
    assert.ok(sec.every(f => f.effectiveSeverity === 'warn'), 'demoted');
    assert.equal(strictRun.status, 2);
    const standardRun = guardJson(project(LEAK, base({ enforcement: 'standard', validators: only('security') })));
    assert.equal(standardRun.status, 1);
  });
  it('e2e: findingSeverity high restores the failure under strict', () => {
    const r = guardJson(project(LEAK, base({ enforcement: HELD, findingSeverity: { SEC005: 'high' } })));
    assert.ok(r.json.findings.some(f => f.code === 'SEC005' && f.effectiveSeverity === 'error'));
    assert.equal(r.status, 1);
  });
  it('e2e: a code on the closed list fails the build under strict (a missing required file is STR001)', () => {
    const dir = project({ 'package.json': PKG }, base({ requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: [] }, enforcement: HELD }));
    const r = guardJson(dir);
    assert.ok(r.json.findings.some(f => f.code === 'STR001' && f.effectiveSeverity === 'error'));
    assert.equal(r.status, 1);
  });
});

// ── T021: the gating set (FR-009) ──
describe('T021 FR-009: the gating set is derived from evidence', () => {
  const row = (tp, n) => ({ status: 'measured', truePositives: tp, falsePositives: n - tp, precisionDenominator: n });
  const evidence = (byCode, toolVersion = '0.47.0') => ({ source: { toolVersion }, byCode });

  it('30 of 30 clears the bar; 29 of 30 and 29 of 29 do not', async () => {
    const { deriveGatingSet } = await import('../cli/precision-evidence.mjs');
    const set = deriveGatingSet(evidence({ AAA001: row(30, 30), AAA002: row(29, 30), AAA003: row(29, 29), AAA004: row(59, 60), AAA005: row(5, 5) }), '0.48.0');
    assert.deepEqual([...set].sort(), ['AAA001', 'AAA004']);
  });
  it('the Wilson lower bound is computed from the counts, not read from a rounded field', async () => {
    const { wilsonLower, GATING_BAR } = await import('../cli/precision-evidence.mjs');
    assert.ok(Math.abs(wilsonLower(30, 30) - 0.886) < 0.001);
    assert.ok(Math.abs(wilsonLower(29, 30) - 0.833) < 0.001);
    assert.deepEqual({ ...GATING_BAR }, { minLabeled: 30, minLowerBound: 0.85, maxMinorsBehind: 2 });
  });
  it('evidence measured more than two minor versions behind the running one does not count', async () => {
    const { deriveGatingSet } = await import('../cli/precision-evidence.mjs');
    const codes = { AAA001: row(30, 30) };
    assert.deepEqual([...deriveGatingSet(evidence(codes, '0.46.0'), '0.48.2')], ['AAA001']);
    assert.deepEqual([...deriveGatingSet(evidence(codes, '0.45.9'), '0.48.0')], []);
    assert.deepEqual([...deriveGatingSet(evidence(codes, '0.47.0'), '1.0.0')], [], 'a major version apart is never close enough');
  });
  it('a code that is not measured never gates', async () => {
    const { deriveGatingSet } = await import('../cli/precision-evidence.mjs');
    assert.deepEqual([...deriveGatingSet(evidence({ AAA001: { status: 'not-measured', truePositives: 40, precisionDenominator: 40 } }), '0.48.0')], []);
  });
  it('with the evidence that ships today the set is empty, and every member of any set meets the bar', async () => {
    const { deriveGatingSet, PRECISION_EVIDENCE, wilsonLower, GATING_BAR } = await import('../cli/precision-evidence.mjs');
    const { TOOL_VERSION } = await import('../cli/shared.mjs');
    const set = deriveGatingSet(PRECISION_EVIDENCE, TOOL_VERSION);
    assert.deepEqual([...set], [], 'no code has 30 labeled findings yet');
    for (const code of set) {
      const e = PRECISION_EVIDENCE.byCode[code];
      assert.ok(e.precisionDenominator >= GATING_BAR.minLabeled && wilsonLower(e.truePositives, e.precisionDenominator) >= GATING_BAR.minLowerBound, code);
    }
  });
  it('the strict-additions table lists exactly the derived gating codes', async () => {
    const { deriveGatingSet, PRECISION_EVIDENCE } = await import('../cli/precision-evidence.mjs');
    const { TOOL_VERSION } = await import('../cli/shared.mjs');
    const { STRICT_ADDITIONS } = await import('../cli/strict-additions.mjs');
    const listed = Object.values(STRICT_ADDITIONS).flatMap(a => a.gatingCodes || []).sort();
    assert.deepEqual(listed, [...deriveGatingSet(PRECISION_EVIDENCE, TOOL_VERSION)].sort(), 'a gating code is never listed by hand and never missing');
  });
});

// ── T022: the rolling default (FR-012, FR-013) ──
describe('T022 FR-012/FR-013: the additions table', () => {
  it('lists every registered validator, once', async () => {
    const { STRICT_ADDITIONS } = await import('../cli/strict-additions.mjs');
    const dir = project({ 'package.json': PKG }, base());
    const registered = guardJson(dir).json.validators.map(v => v.key).filter(k => k !== 'requiredChecks').sort();
    const listed = Object.values(STRICT_ADDITIONS).flatMap(a => a.validators || []);
    assert.equal(new Set(listed).size, listed.length, 'no validator is listed under two versions');
    assert.deepEqual([...listed].sort(), registered);
  });
  it('every version key is <major>.<minor>', async () => {
    const { STRICT_ADDITIONS } = await import('../cli/strict-additions.mjs');
    for (const v of Object.keys(STRICT_ADDITIONS)) assert.match(v, /^\d+\.\d+$/);
  });

  const result = (key, extra = {}) => ({ key, name: key, verdict: 'empty', emptyCause: 'needs-declaration', applicability: { reason: 'r' }, howToConfigure: 'fix', findings: [], ...extra });
  const TABLE = { '0.48': { validators: ['alpha'], gatingCodes: [] }, '0.50': { validators: ['beta'], gatingCodes: ['GAT001'] } };

  it('unit: an item added in the running or the previous minor is labeled new; an older one is not', async () => {
    const { buildStrictReport } = await import('../cli/enforcement.mjs');
    const report = buildStrictReport([result('alpha'), result('beta'), result('gamma')], { additions: { ...TABLE, '0.40': { validators: ['gamma'], gatingCodes: [] } }, runningVersion: '0.49.1', enforcement: { mode: 'strict', asOf: null, source: 'default' } });
    const by = Object.fromEntries(report.unexamined.map(u => [u.validator, u.newIn]));
    assert.equal(by.alpha, '0.48', 'the previous minor');
    assert.equal(by.beta, '0.50', 'a version the running build already lists');
    assert.equal(by.gamma, null, 'older items carry no label');
    assert.deepEqual(report.blocking.sort(), ['alpha', 'beta', 'gamma']);
  });
  it('unit: asOf holds a later item as pending, without affecting blocking', async () => {
    const { buildStrictReport } = await import('../cli/enforcement.mjs');
    const report = buildStrictReport([result('alpha'), result('beta')], { additions: TABLE, runningVersion: '0.50.0', enforcement: { mode: 'strict', asOf: '0.48', source: 'config' } });
    assert.deepEqual(report.blocking, ['alpha']);
    assert.deepEqual(report.pending.map(p => [p.kind, p.validator, p.since]), [['validator', 'beta', '0.50']]);
  });
  it('unit: without asOf every item applies', async () => {
    const { buildStrictReport } = await import('../cli/enforcement.mjs');
    const report = buildStrictReport([result('beta')], { additions: TABLE, runningVersion: '0.50.0', enforcement: { mode: 'strict', asOf: null, source: 'default' } });
    assert.deepEqual(report.pending, []);
    assert.deepEqual(report.blocking, ['beta']);
  });
  it('unit: a gating code listed under a later version is pending and its findings stay out of the exit code', async () => {
    const { buildStrictReport, strictFindingContext } = await import('../cli/enforcement.mjs');
    const ctx = strictFindingContext({ gating: ['GAT001'], additions: TABLE, enforcement: { mode: 'strict', asOf: '0.48', source: 'config' }, runningVersion: '0.50.0' });
    assert.equal(ctx.gating.has('GAT001'), false, 'not gating as of 0.48');
    assert.deepEqual(ctx.pendingCodes, ['GAT001']);
    const withFinding = { key: 'x', name: 'x', verdict: 'pass', findings: [{ code: 'GAT001', severity: 'warn', effectiveSeverity: 'warn' }] };
    const report = buildStrictReport([withFinding], { additions: TABLE, runningVersion: '0.50.0', enforcement: { mode: 'strict', asOf: '0.48', source: 'config' }, pendingCodes: ctx.pendingCodes });
    assert.deepEqual(report.pending.map(p => [p.kind, p.code, p.since, p.count]), [['code', 'GAT001', '0.50', 1]]);
  });
  it('e2e: asOf set below the version that lists a validator holds it; the exit code does not move', () => {
    const files = ROUTES;
    const held = project(files, base({ enforcement: { mode: 'strict', asOf: '0.40' }, validators: { apiSurface: true } }));
    const r = guardJson(held);
    assert.notEqual(r.status, 4);
    assert.ok(r.json.strict.pending.some(p => p.validator === 'apiSurface'));
    assert.deepEqual(r.json.strict.blocking, []);
    const open = guardJson(project(files, base({ enforcement: { mode: 'strict', asOf: '9.99' }, validators: { apiSurface: true } })));
    assert.equal(open.status, 4);
    assert.deepEqual(open.json.strict.pending, []);
  });
  it('e2e: a strict failure from an item in the running or previous minor says "new in vX.Y"', async () => {
    const { STRICT_ADDITIONS } = await import('../cli/strict-additions.mjs');
    const { TOOL_VERSION } = await import('../cli/shared.mjs');
    const dir = project(ROUTES, base({ validators: { apiSurface: true } }));
    const r = guardJson(dir);
    const u = r.json.strict.unexamined.find(x => x.validator === 'apiSurface');
    const since = Object.entries(STRICT_ADDITIONS).find(([, a]) => (a.validators || []).includes('apiSurface'))[0];
    const [maj, min] = TOOL_VERSION.split('.').map(Number);
    const [sMaj, sMin] = since.split('.').map(Number);
    const isNew = sMaj > maj || (sMaj === maj && sMin >= min - 1);
    assert.equal(u.newIn, isNew ? since : null);
    if (isNew) assert.match(guard(dir).out, new RegExp(`new in v${since.replace('.', '\\.')}`));
  });
});

// ── T023: the baseline and the uninitialized project (FR-011, US4) ──
describe('T023 FR-011: the baseline under strict', () => {
  const closed = { 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' };
  const needsDoc = base({ requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: [] }, enforcement: HELD });

  it('--update-baseline under strict freezes the findings, which then stop failing; a new one does', () => {
    const dir = project(closed, needsDoc);
    assert.equal(guard(dir).status, 1);
    const w = guard(dir, ['--update-baseline']);
    assert.equal(w.status, 0);
    assert.equal(guard(dir).status, 0, 'the frozen finding no longer fails');
    const r = guardJson(dir);
    assert.ok(r.json.baselineSuppressed >= 1);
    assert.equal(r.json.strict.baselined, r.json.baselineSuppressed, 'JSON carries the count under strict');
  });
  it('every strict run prints the number of baselined findings, including zero', () => {
    const none = project(closed, base({ enforcement: HELD }));
    assert.match(guard(none).out, /0 findings baselined/);
    assert.equal(guardJson(none).json.strict.baselined, 0);
  });
  it('the baseline does not cover an unexamined validator', () => {
    const dir = project(ROUTES, base({ validators: { apiSurface: true } }));
    assert.equal(guard(dir).status, 4);
    guard(dir, ['--update-baseline']);
    assert.equal(guard(dir).status, 4, 'only a fix or a waiver clears it');
  });
});

describe('T023 US4: an uninitialized project', () => {
  it('exits 3 as before, runs no strict rule, and says once to run `docguard init`', () => {
    const dir = project({ 'package.json': PKG, 'src/index.js': 'export const x = 1;\n' }, null);
    const r = guardJson(dir);
    assert.equal(r.status, 3);
    assert.equal(r.json.strict, undefined, 'strict adds nothing here');
    assert.equal(byKey(r.json, 'security').status, 'skipped', 'Security and Architecture stay off');
    const text = guard(dir).out;
    const lines = text.split('\n').filter(l => /Enforcement:/.test(l));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /docguard init/);
  });
});
