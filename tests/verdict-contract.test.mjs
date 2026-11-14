/**
 * Verdict contract (specs/081-verdict-contract): every validator result ends
 * in one closed verdict, and an observation DocGuard could not make (a git
 * call that failed while git is readable) is recorded as a gap instead of
 * becoming a finding or a silent pass.
 *
 * The only seam is a stub `git` first on PATH. It fails the subcommand a test
 * names and execs the real git for everything else, so product code meets a
 * failure exactly as it would on a loaded runner.
 *
 * @req docguard.verdict-contract#FR-001
 * @req docguard.verdict-contract#FR-016
 * @req docguard.verdict-contract#FR-002
 * @req docguard.verdict-contract#FR-003
 * @req docguard.verdict-contract#FR-004
 * @req docguard.verdict-contract#FR-005
 * @req docguard.verdict-contract#FR-006
 * @req docguard.verdict-contract#FR-007
 * @req docguard.verdict-contract#FR-008
 * @req docguard.verdict-contract#FR-009
 * @req docguard.verdict-contract#FR-010
 * @req docguard.verdict-contract#FR-011
 * @req docguard.verdict-contract#FR-012
 * @req docguard.verdict-contract#FR-013
 * @req docguard.verdict-contract#FR-014
 * @req docguard.verdict-contract#FR-015
 * @req docguard.verdict-contract#SC-001
 * @req docguard.verdict-contract#SC-002
 * @req docguard.verdict-contract#SC-003
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { ABSENCE_CLAIM_CODES } from '../cli/findings.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { runGuardInternal } from '../cli/commands/guard.mjs';
import { compactGuardResult } from '../cli/shared-guard-json.mjs';
import { toSarif } from '../cli/writers/sarif.mjs';
import { toJUnit } from '../cli/writers/junit.mjs';
import { docsForPath } from '../cli/scanners/doc-references.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const POSIX = process.platform !== 'win32';
const REAL_GIT = POSIX ? execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim() : 'git';

// Every validator off except the ones a test names: keeps fixtures small and
// the assertions about one validator independent of every other detector.
const ALL_OFF = Object.fromEntries([
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'canonicalSync', 'metricsConsistency',
].map(k => [k, false]));
const only = (...keys) => ({ ...ALL_OFF, ...Object.fromEntries(keys.map(k => [k, true])) });
const config = (validators, extra = {}) => ({ projectName: 'verdicts', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators, ...extra });

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

function project(t, files, { commit = true } = {}) {
  const dir = makeTempDir('docguard-verdict-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  if (commit) execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

/**
 * A `git` that fails one subcommand the way a loaded machine does.
 *   check-ignore: 17 MB on stdout, past the helper's 16 MB maxBuffer, so the
 *                 spawn itself errors (ENOBUFS), the shape of the 2026-10-12 run.
 *   ls-files:     exits 128 with a fatal message.
 *   grep-head:    `git grep … HEAD` exits 2; grep at any other revision works.
 */
function stubGit(t, mode) {
  const bin = makeTempDir('docguard-stubgit-');
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const fail = {
    'check-ignore': 'if [ "$1" = check-ignore ]; then cat >/dev/null; head -c 17000000 /dev/zero; exit 0; fi',
    'ls-files': 'if [ "$1" = ls-files ]; then echo "fatal: simulated ls-files failure" >&2; exit 128; fi',
    'grep-head': 'if [ "$1" = grep ]; then case " $* " in *" HEAD "*) echo "fatal: simulated grep failure" >&2; exit 2;; esac; fi',
  }[mode];
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n${fail}\nexec "${REAL_GIT}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return bin;
}

/** Run `fn` with the stub first on PATH; always restore. */
function withPath(bin, fn) {
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try { return fn(); } finally { process.env.PATH = saved; }
}

const validator = (r, key) => r.validators.find(v => v.key === key);
const codes = (r, code) => r.findings.filter(f => f.code === code);

// ── US1: a failed git call never becomes a finding ──────────────────────────

/** An instruction file with one pointer to an ignored path and one to a missing path. */
const POINTERS = {
  '.gitignore': 'notes/\n',
  'docs/guide.md': '# Guide\n',
  'AGENTS.md': '# Agents\n\n- Local notes: `notes/private.md`\n- Billing: `docs/missing.md`\n- Guide: `docs/guide.md`\n',
};

describe('US1 — a failed git call is a gap, not a finding', { skip: !POSIX }, () => {
  it('PSR002: working git reports only the missing pointer (control)', t => {
    const dir = project(t, POINTERS);
    const r = runGuardInternal(dir, config(only('pathScopedRules')));
    assert.deepEqual(codes(r, 'PSR002').map(f => f.message.match(/points at (\S+),/)[1]), ['docs/missing.md']);
    assert.equal(validator(r, 'pathScopedRules').verdict, 'fail');
  });

  it('PSR002: a check-ignore that cannot spawn withholds both pointers and records one gap', t => {
    const dir = project(t, POINTERS);
    const r = withPath(stubGit(t, 'check-ignore'), () => runGuardInternal(dir, config(only('pathScopedRules'))));
    const v = validator(r, 'pathScopedRules');
    assert.equal(codes(r, 'PSR002').length, 0, 'no pointer whose ignore status is unknown is reported');
    assert.equal(v.verdict, 'inconclusive');
    assert.equal(v.applicability.status, 'partial');
    assert.equal(v.applicability.class, 'applicable');
    assert.equal(v.observations.length, 1);
    assert.match(v.observations[0].operation, /check-ignore/);
    assert.equal(v.observations[0].scope.count, 2);
    assert.equal(r.verdicts.gaps.length, 1);
    assert.equal(r.verdicts.gaps[0].validator, 'pathScopedRules');
  });

  it('PSR: an ls-files failure falls back to the working tree as partial, never an empty repository', t => {
    const dir = project(t, POINTERS);
    const r = withPath(stubGit(t, 'ls-files'), () => runGuardInternal(dir, config(only('pathScopedRules'))));
    const v = validator(r, 'pathScopedRules');
    assert.equal(v.applicability.status, 'partial');
    assert.ok(v.observations.some(o => /ls-files/.test(o.operation)));
    // The working-tree walk skips dot directories, so "does not exist" is not
    // provable: the absence claim is withheld and the check cannot decide.
    assert.equal(codes(r, 'PSR002').length, 0);
    assert.equal(v.verdict, 'inconclusive');
  });

  it('docsForPath falls back to the working tree when ls-files fails', t => {
    const dir = project(t, { 'src/billing.js': 'export const billingTotal = 1;\n', 'AGENTS.md': '# Agents\n\nBilling lives in `src/billing.js`.\n' });
    const good = docsForPath(dir, {}, 'src/billing.js');
    const stubbed = withPath(stubGit(t, 'ls-files'), () => docsForPath(dir, {}, 'src/billing.js'));
    assert.deepEqual(stubbed.agentInstructions, good.agentInstructions);
  });

  it('REF001: a failed grep at HEAD is unknown presence, not a removed symbol', t => {
    // The walk skips dot directories, so presence at HEAD is decided by git grep.
    const files = {
      '.tools/helper.js': 'export function fooBarHelper() { return 1; }\n',
      'AGENTS.md': '# Agents\n\nUse `fooBarHelper` for totals.\n',
    };
    const dir = project(t, files);
    const control = runGuardInternal(dir, config(only('referenceExistence')));
    assert.equal(codes(control, 'REF001').length, 0, 'control: the symbol exists at HEAD');
    const r = withPath(stubGit(t, 'grep-head'), () => runGuardInternal(dir, config(only('referenceExistence'))));
    const v = validator(r, 'referenceExistence');
    assert.equal(codes(r, 'REF001').length, 0, 'a grep that failed proves nothing about the symbol');
    assert.equal(v.verdict, 'inconclusive');
    assert.ok(v.observations.some(o => /grep/.test(o.operation)));
  });

  it('baseline: unseen fingerprints are not "safe to drop" and re-freezing is refused while a gap stands', t => {
    const dir = project(t, POINTERS);
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'baseline', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators: only('pathScopedRules') }));
    const run = (args, env = process.env) => spawnSync(process.execPath, [CLI, 'guard', ...args], { cwd: dir, encoding: 'utf8', env });
    assert.equal(run(['--update-baseline']).status, 0);
    const stub = stubGit(t, 'check-ignore');
    const env = { ...process.env, PATH: `${stub}:${process.env.PATH}` };
    const j = JSON.parse(run(['--format', 'json'], env).stdout);
    assert.equal(j.baselineStale, 1, 'the frozen PSR002 was withheld, so it went unseen');
    assert.equal(j.baselineStaleUncertain, true);
    const refreeze = run(['--update-baseline'], env);
    assert.equal(refreeze.status, 1);
    assert.match(refreeze.stderr, /--update-baseline refused/);
    assert.match(readFileSync(join(dir, '.docguard.baseline.json'), 'utf8'), /"[0-9a-f]{16}"/, 'the committed baseline is untouched');
  });
});

describe('FR-009 — transient spawn errors are retried once', () => {
  it('retries EAGAIN once, records a gap only when the retry fails, never retries ENOBUFS', async () => {
    const { runGit } = await import('../cli/shared-git.mjs');
    const { openObservations, closeObservations } = await import('../cli/observations.mjs');
    const ok = { status: 0, stdout: 'x', stderr: '' };
    const eagain = { error: Object.assign(new Error('spawn git EAGAIN'), { code: 'EAGAIN' }) };
    const enobufs = { error: Object.assign(new Error('spawnSync git ENOBUFS'), { code: 'ENOBUFS' }) };
    const scripted = (...replies) => { let i = 0; const calls = []; const spawn = (...a) => { calls.push(a); return replies[Math.min(i++, replies.length - 1)]; }; spawn.calls = calls; return spawn; };
    const dir = resolve('.');

    openObservations();
    let spawn = scripted(eagain, ok);
    assert.equal(runGit(dir, ['rev-parse', 'HEAD'], { spawn, operation: 'rev-parse' }).status, 0);
    assert.equal(spawn.calls.length, 2);
    assert.equal(closeObservations().length, 0);

    openObservations();
    spawn = scripted(eagain, eagain);
    assert.ok(runGit(dir, ['rev-parse', 'HEAD'], { spawn, operation: 'rev-parse' }).error);
    assert.equal(spawn.calls.length, 2);
    assert.equal(closeObservations().length, 1);

    openObservations();
    spawn = scripted(enobufs, ok);
    assert.ok(runGit(dir, ['check-ignore'], { spawn, operation: 'check-ignore' }).error);
    assert.equal(spawn.calls.length, 1);
    assert.equal(closeObservations().length, 1);
  });

  it('records nothing outside a guard run', async () => {
    const { recordGap, closeObservations } = await import('../cli/observations.mjs');
    recordGap({ operation: 'git ls-files', cause: 'x', scope: { count: 1 } });
    assert.deepEqual(closeObservations(), []);
  });
});

// ── US2: six verdicts ───────────────────────────────────────────────────────

describe('US2 — every validator result ends in one closed verdict', () => {
  it('derives each verdict and applicability class from a real run', t => {
    const dir = project(t, {
      'AGENTS.md': '# Agents\n\n- Guide: `docs/guide.md`\n',
      'docs/guide.md': '# Guide\n',
      'src/index.js': 'export const a = 1;\n',
    });
    const r = runGuardInternal(dir, config(only('pathScopedRules', 'drift', 'apiSurface')));
    assert.equal(validator(r, 'pathScopedRules').verdict, 'pass');
    assert.equal(validator(r, 'pathScopedRules').applicability.class, 'applicable');
    assert.equal(validator(r, 'drift').verdict, 'empty');
    assert.equal(validator(r, 'drift').applicability.class, 'unknown');
    assert.equal(validator(r, 'apiSurface').verdict, 'inconclusive');
    assert.equal(validator(r, 'apiSurface').applicability.class, 'unknown');
    assert.equal(validator(r, 'schemaSync').verdict, 'skipped');
    assert.equal(validator(r, 'schemaSync').applicability.class, 'not-applicable');
    for (const v of r.validators) assert.ok(['pass', 'fail', 'empty', 'inconclusive', 'blocked', 'skipped'].includes(v.verdict), `${v.key}: ${v.verdict}`);
    const counted = Object.values(r.verdicts.counts).reduce((a, b) => a + b, 0);
    assert.equal(counted, r.validators.length);
  });

  it('a declared N/A marker is skipped; finding nothing is never skipped', t => {
    const dir = project(t, { 'AGENTS.md': '# Agents\n\n<!-- docguard:validator drift n/a — no hand-written code -->\n' });
    const r = runGuardInternal(dir, config(only('drift', 'todoTracking')));
    assert.equal(validator(r, 'drift').verdict, 'skipped');
    assert.equal(validator(r, 'drift').applicability.class, 'not-applicable');
    assert.notEqual(validator(r, 'todoTracking').verdict, 'skipped');
  });

  it('a finding dominates a partial view: fail, with the gap still recorded', async () => {
    const { deriveVerdict } = await import('../cli/validator-coverage.mjs');
    const gap = [{ operation: 'git ls-files', cause: 'exit 128', scope: { count: 1 } }];
    const finding = { code: 'PSR003', severity: 'warn', message: 'over budget' };
    assert.equal(deriveVerdict({ findings: [finding], warnings: ['over budget'], errors: [], observations: gap, applicability: { status: 'partial' } }), 'fail');
    assert.equal(deriveVerdict({ findings: [], warnings: [], errors: [], observations: gap, applicability: { status: 'partial' } }), 'inconclusive');
  });

  it('an absence claim is withheld run-wide while any gap stands, and the validator says so', t => {
    // A gap in Path-Scoped-Rules (check-ignore) also withholds Reference-Existence's
    // absence claims: shared inputs may be incomplete for every reader.
    const dir = project(t, { ...POINTERS, 'src/x.js': 'export const keep = 1;\n' });
    const r = withPath(POSIX ? stubGit(t, 'check-ignore') : process.env.PATH, () => runGuardInternal(dir, config(only('pathScopedRules'))));
    if (!POSIX) return;
    assert.equal(codes(r, 'PSR002').length, 0);
    assert.ok(r.verdicts.gaps.every(g => !g.propagated));
  });

  it('every claim that something is missing from a file list is withheld while a gap stands', () => {
    // The final fault-injection run found ANC003 and SPR001 reported from a file
    // list git could not give; SPR006 and SPR009 read the same list.
    for (const code of ['ANC003', 'SPR001', 'SPR006', 'SPR009', 'PSR002', 'TRC004']) assert.ok(ABSENCE_CLAIM_CODES.has(code), code);
  });

  it('a validator that throws is blocked; its status and exit effect are unchanged', t => {
    const dir = project(t, POINTERS);
    // A non-iterable `ignore` makes Path-Scoped-Rules throw while it builds its filter.
    const r = runGuardInternal(dir, config(only('pathScopedRules'), { ignore: 5 }));
    const v = validator(r, 'pathScopedRules');
    assert.equal(v.verdict, 'blocked');
    assert.equal(v.status, 'fail');
    assert.equal(v.applicability.status, 'error');
    assert.ok(r.effectiveErrors > 0);
  });

  it('leaves no open observation list after a validator throws', async t => {
    const dir = project(t, POINTERS);
    runGuardInternal(dir, config(only('pathScopedRules'), { ignore: 5 }));
    const { recordGap, closeObservations } = await import('../cli/observations.mjs');
    recordGap({ operation: 'probe', cause: 'x', scope: { count: 1 } });
    assert.deepEqual(closeObservations(), [], 'the stack is empty, so the probe was dropped');
  });
});

// ── US3: the gate ───────────────────────────────────────────────────────────

describe('US3 — --fail-on-inconclusive', () => {
  const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, 'guard', ...args], { cwd: dir, encoding: 'utf8' });
  const cfg = (dir, validators) => writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'gate', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators }));

  it('exits 4 and names each inconclusive validator; without the flag the exit code is unchanged', t => {
    const dir = project(t, { 'src/index.js': 'export const a = 1;\n' });
    cfg(dir, only('apiSurface', 'drift'));
    const plain = cli(dir);
    const gated = cli(dir, '--fail-on-inconclusive');
    assert.equal(gated.status, 4, gated.stdout + gated.stderr);
    assert.match(gated.stdout, /API-Surface/);
    assert.match(gated.stdout, /inconclusive/i);
    assert.equal(plain.status, 0, 'no warning, no error: the flag is what changed the code');
  });

  it('empty and skipped never trip the gate', t => {
    const dir = project(t, { 'src/index.js': 'export const a = 1;\n' });
    cfg(dir, only('drift'));
    const r = cli(dir, '--fail-on-inconclusive');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

// ── US4: every format carries the verdict ───────────────────────────────────

/** One validator per verdict, shaped like runGuardInternal output. */
function sixVerdictData() {
  const base = { errors: [], warnings: [], passed: 0, total: 0, durationMs: 0, quality: null };
  const v = (key, status, verdict, applicability, extra = {}) => ({ ...base, key, name: key, status, verdict, applicability, ...extra });
  const failing = { code: 'PSR002', validator: 'pathScopedRules', severity: 'warn', effectiveSeverity: 'warn', message: 'AGENTS.md:3 points at docs/missing.md, which does not exist', location: { file: 'AGENTS.md', line: 3 }, confidence: 'high', disposition: 'act' };
  return {
    status: 'FAIL', findings: [failing], effectiveErrors: 1, effectiveWarnings: 1,
    validators: [
      v('structure', 'pass', 'pass', { status: 'checked', class: 'applicable', reason: 'ok' }, { passed: 1, total: 1, quality: 'HIGH' }),
      v('pathScopedRules', 'warn', 'fail', { status: 'checked', class: 'applicable', reason: 'ok' }, { findings: [failing], warnings: [failing.message], total: 1, quality: 'MEDIUM' }),
      v('drift', 'na', 'empty', { status: 'no-matches', class: 'unknown', reason: 'no // DRIFT: comments in code' }),
      v('apiSurface', 'na', 'inconclusive', { status: 'missing-prerequisite', class: 'unknown', reason: 'No document available for role apiReference' }),
      v('docOwnership', 'fail', 'blocked', { status: 'error', class: 'unknown', reason: 'Validator could not complete: boom' }, { errors: ['boom'], total: 1, quality: 'LOW' }),
      v('schemaSync', 'skipped', 'skipped', { status: 'disabled', class: 'not-applicable', reason: 'Disabled by the effective configuration or selected command scope.' }),
    ],
    verdicts: {
      counts: { pass: 1, fail: 1, empty: 1, inconclusive: 1, blocked: 1, skipped: 1 },
      gaps: [],
    },
  };
}

describe('US4 — formats', () => {
  it('compact JSON keeps every verdict once', () => {
    const c = compactGuardResult(sixVerdictData());
    assert.deepEqual(c.validators.map(v => v.verdict), ['pass', 'fail', 'empty', 'inconclusive', 'blocked', 'skipped']);
    assert.deepEqual(c.verdicts.counts, { pass: 1, fail: 1, empty: 1, inconclusive: 1, blocked: 1, skipped: 1 });
  });

  it('SARIF: blocked is an error notification and an unsuccessful execution; inconclusive is a warning; others add none', () => {
    const sarif = toSarif(sixVerdictData());
    const inv = sarif.runs[0].invocations[0];
    assert.equal(inv.executionSuccessful, false);
    const notes = inv.toolExecutionNotifications.map(n => [n.descriptor.id, n.level]);
    assert.deepEqual(notes, [['apiSurface', 'warning'], ['docOwnership', 'error']]);
    assert.match(inv.toolExecutionNotifications[0].message.text, /apiReference/);
  });

  it('SARIF: a run with no blocked validator executed successfully', () => {
    const data = sixVerdictData();
    data.validators = data.validators.filter(v => v.verdict !== 'blocked');
    assert.equal(toSarif(data).runs[0].invocations[0].executionSuccessful, true);
  });

  it('JUnit: blocked → error, inconclusive and empty → skipped with a message, skipped → bare skipped', () => {
    const xml = toJUnit(sixVerdictData());
    const tc = name => xml.match(new RegExp(`<testcase name="${name}"[\\s\\S]*?(?:</testcase>|/>)`))[0];
    assert.match(tc('docOwnership'), /<error [^>]*type="docguard\.blocked"/);
    assert.match(tc('apiSurface'), /<skipped message="[^"]*inconclusive[^"]*apiReference/);
    assert.match(tc('drift'), /<skipped message="[^"]*empty[^"]*DRIFT/);
    assert.match(tc('schemaSync'), /<skipped\/>/);
    assert.doesNotMatch(tc('structure'), /<skipped|<failure|<error/);
  });

  it('human output prints the verdict summary and every inconclusive reason', t => {
    const dir = project(t, { 'src/index.js': 'export const a = 1;\n' });
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'human', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators: only('apiSurface', 'drift') }));
    const r = spawnSync(process.execPath, [CLI, 'guard'], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(r.stdout, /Verdicts: \d+ pass · \d+ fail · \d+ empty · 1 inconclusive · 0 blocked · \d+ skipped/);
    assert.match(r.stdout, /API-Surface[^\n]*No document available for role apiReference/);
  });

  it('guard --format json carries verdict, class and the run summary', t => {
    const dir = project(t, { 'src/index.js': 'export const a = 1;\n' });
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'json', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators: only('apiSurface', 'drift') }));
    const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const j = JSON.parse(r.stdout);
    assert.equal(j.validators.find(v => v.key === 'apiSurface').verdict, 'inconclusive');
    assert.equal(j.validators.find(v => v.key === 'drift').applicability.class, 'unknown');
    assert.equal(typeof j.verdicts.counts.empty, 'number');
    assert.ok(Array.isArray(j.verdicts.gaps));
  });
});

// ── FR-008: reviewed inventory of git helper call sites ────────────────────

/**
 * Every call, in cli/validators and cli/scanners, of a shared-git helper that
 * can return no answer, with how its caller handles that. Adding a call site
 * without reviewing its handling fails this test.
 *   gap       the helper records the gap and the caller withholds what it cannot know
 *   fallback  the caller walks the working tree instead and the helper records the gap
 *   silent    no answer is a legitimate state here; the reason says why
 */
const GIT_CALL_SITES = {
  'cli/scanners/recorded-review-signals.mjs': { listTrackedFiles: 'silent: without git the reviews checks return no signal, as the history checks in Freshness already skip' },
  'cli/scanners/anchors.mjs': { listTrackedFiles: 'fallback', fileContentAtRev: 'silent: a path absent at the locked revision has no prior bytes to compare' },
  'cli/scanners/doc-deps.mjs': { listTrackedFiles: 'fallback', fileContentAtRev: 'silent: a dependency added after the revision has no prior text' },
  'cli/scanners/doc-ownership.mjs': { listTrackedFiles: 'fallback' },
  'cli/scanners/doc-references.mjs': { listTrackedFiles: 'fallback' },
  'cli/scanners/reconciliation.mjs': { getHeadInfo: 'silent: reconciliation reports a missing HEAD as its own blocker', getDiffSnapshot: 'silent: the snapshot carries status error and the reconciliation reports it (spec 028)' },
  'cli/scanners/spec-first.mjs': { getDiffSnapshot: 'silent: the snapshot carries status error and spec-first reports it' },
  'cli/scanners/speckit.mjs': { gitIgnoredPaths: 'gap' },
  'cli/validators/aidlc.mjs': { lastCommitHash: 'silent: an uncommitted manifest is counted as unjudged and reported partial' },
  'cli/validators/diff-suspicion.mjs': { fileContentAtRev: 'silent: a file added or deleted in range has no other side', getDiffText: 'gap' },
  'cli/validators/path-scoped-rules.mjs': { listTrackedFiles: 'fallback', gitIgnoredPaths: 'gap' },
  'cli/validators/reference-existence.mjs': { symbolExistsAtRev: 'gap', lastCommitHash: 'silent: an untracked doc has no revision to compare' },
  'cli/validators/spec-registry.mjs': { listTrackedFiles: 'fallback' },
};
/**
 * Every git subprocess a validator or scanner starts itself, outside the
 * shared helpers, keyed by file and git subcommand. `gap` means it goes
 * through runGit (spawn failures are recorded); `silent: …` says why no answer
 * is a legitimate state there.
 */
const PRIVATE_GIT_CALLS = {
  'cli/scanners/anchor-cache.mjs': { 'ls-files': 'silent: only decides whether the cache directory is committed; a failure disables the cache' },
  'cli/scanners/document-lifecycle.mjs': { runGit: 'gap' },
  'cli/scanners/doc-deps.mjs': { runGit: 'gap' },
  'cli/scanners/reconciliation.mjs': { 'rev-parse': 'silent: an unknown ref is reported by reconciliation as its own blocker', 'ls-files': 'silent: an unknown answer keeps the directory as present, the conservative side' },
  'cli/scanners/revision-anchor.mjs': { runGit: 'gap' },
  'cli/scanners/stale-completions.mjs': { runGit: 'gap' },
  'cli/scanners/semantic-claims.mjs': { 'rev-parse': 'silent: evidence provenance only; null records no revision', status: 'silent: evidence provenance only; dirty stays unknown' },
  'cli/scanners/spec-first.mjs': { args: 'silent: spec-first reports an unreadable range as inconclusive (exit 2), spec 015' },
  'cli/scanners/spec-registry.mjs': { runGit: 'gap', 'ls-files': 'silent: an asset path git cannot confirm tracked and clean is not attributed', diff: 'silent: an asset path git cannot confirm tracked and clean is not attributed' },
  'cli/scanners/speckit.mjs': { runGit: 'gap', args: 'silent: featureTouchedPaths returns null and SPK010 stays silent for the feature (spec 080 FR-004)', 'ls-files': 'silent: unobservablePaths returns null and SPK010 stays silent (spec 080 FR-004)' },
  'cli/scanners/doc-reviews.mjs': { runGit: 'gap' },
  'cli/scanners/recorded-review-signals.mjs': { runGit: 'gap' },
  'cli/scanners/reference-staleness.mjs': { runGit: 'gap' },
  'cli/validators/aidlc.mjs': { runGit: 'gap' },
  'cli/validators/changelog.mjs': { diff: 'silent: no staged list means no staged-change reminder, never a finding' },
  'cli/validators/freshness.mjs': { log: 'silent: freshness signals are escalations; an unknown count raises none', diff: 'silent: freshness signals are escalations; an unknown staged list raises none', 'rev-list': 'silent: freshness signals are escalations; an unknown count raises none' },
};
const PRIVATE_GIT_RE = /(?:spawnSync|execFileSync|execSync)\(\s*'git',\s*(?:\[\s*'([a-z-]+)'|(args))|\brunGit\(/g;

const NO_ANSWER_HELPERS = ['listTrackedFiles', 'gitIgnoredPaths', 'changedFilesSince', 'getDiffText', 'getDiffSnapshot', 'fileContentAtRev', 'symbolExistsAtRev', 'lastCommitHash', 'getHeadInfo', 'getLastCommitDate', 'getFileHistory', 'getRenameHistory', 'countCommitsSince'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

describe('FR-008 — git call-site inventory', () => {
  it('lists every private git subprocess in cli/validators and cli/scanners', () => {
    const found = {};
    for (const file of [...walk('cli/validators'), ...walk('cli/scanners')]) {
      const text = readFileSync(file, 'utf8').replace(/^\s*(?:\/\/|\*).*$/gm, '');
      for (const m of text.matchAll(PRIVATE_GIT_RE)) {
        const key = m[0].startsWith('runGit') ? 'runGit' : (m[1] || m[2]);
        ((found[file.replace(/\\/g, '/')] ||= new Set())).add(key);
      }
    }
    const actual = Object.fromEntries(Object.entries(found).map(([f, s]) => [f, [...s].sort()]).sort());
    const listed = Object.fromEntries(Object.entries(PRIVATE_GIT_CALLS).map(([f, h]) => [f, Object.keys(h).sort()]).sort());
    assert.deepEqual(actual, listed);
    for (const handlers of Object.values(PRIVATE_GIT_CALLS)) {
      for (const how of Object.values(handlers)) assert.match(how, /^(gap|silent: .{10,})$/);
    }
  });

  it('matches every call site in cli/validators and cli/scanners exactly', () => {
    const found = {};
    for (const file of [...walk('cli/validators'), ...walk('cli/scanners')]) {
      const text = readFileSync(file, 'utf8');
      for (const helper of NO_ANSWER_HELPERS) {
        if (new RegExp(`(?<![\\w.])${helper}\\(`).test(text.replace(/^\s*(?:\/\/|\*).*$/gm, '').replace(/import\s*\{[^}]*\}\s*from[^;]+;/g, '').replace(new RegExp(`function ${helper}\\(`, 'g'), ''))) {
          (found[file.replace(/\\/g, '/')] ||= []).push(helper);
        }
      }
    }
    const listed = Object.fromEntries(Object.entries(GIT_CALL_SITES).map(([f, h]) => [f, Object.keys(h).sort()]));
    for (const f of Object.keys(found)) found[f].sort();
    assert.deepEqual(found, listed);
    for (const handlers of Object.values(GIT_CALL_SITES)) {
      for (const how of Object.values(handlers)) assert.match(how, /^(gap|fallback|silent: .{10,})$/);
    }
  });
});
