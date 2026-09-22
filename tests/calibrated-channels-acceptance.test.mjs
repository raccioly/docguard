/**
 * Acceptance: the success criteria of docguard.calibrated-finding-channels,
 * plus the two output surfaces no other test in this feature pins — the guard
 * summary's act/escalate counts and its tier disclosure (FR-005, FR-007,
 * FR-008).
 *
 * These run the real CLI against real fixtures, because every criterion is a
 * statement about what a reader actually sees.
 *
 * @req docguard.calibrated-finding-channels#FR-005
 * @req docguard.calibrated-finding-channels#FR-007
 * @req docguard.calibrated-finding-channels#FR-008
 * @req docguard.calibrated-finding-channels#SC-001
 * @req docguard.calibrated-finding-channels#SC-002
 * @req docguard.calibrated-finding-channels#SC-003
 * @req docguard.calibrated-finding-channels#SC-004
 * @req docguard.calibrated-finding-channels#SC-005
 * @req docguard.calibrated-finding-channels#SC-006
 * @req docguard.calibrated-finding-channels#SC-007
 * @req docguard.calibrated-finding-channels#SC-008
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { derivePrecisionEvidence } from '../benchmarks/lib/precision-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const dirs = [];

function project(files, { git = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-accept-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  if (git) {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    g('config', 'commit.gpgsign', 'false'); g('config', 'core.hooksPath', '/dev/null');
    g('add', '-A');
    execFileSync('git', ['commit', '-qm', 'docs'], { cwd: dir, stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' } });
    for (let i = 1; i <= 12; i++) {
      writeFileSync(join(dir, 'src/app.js'), `export const v = ${i};\n`);
      g('add', '-A');
      execFileSync('git', ['commit', '-qm', `c${i}`], { cwd: dir, stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_DATE: `2026-09-${String(i).padStart(2, '0')}T10:00:00Z`, GIT_COMMITTER_DATE: `2026-09-${String(i).padStart(2, '0')}T10:00:00Z` } });
    }
  }
  return dir;
}

const guard = (dir, fmt) => {
  const args = ['guard', ...(fmt ? ['--format', fmt] : [])];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return fmt === 'json' || fmt === 'sarif' ? JSON.parse(r.stdout) : r.stdout;
};

const BASE = {
  'package.json': JSON.stringify({ name: 'accept', version: '1.0.0' }),
  '.docguard.json': JSON.stringify({ projectName: 'accept', profile: 'starter' }),
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nOne module in src/app.js.\n',
  'src/app.js': 'export const v = 0;\n',
};

describe('SC-001 — every channel on every finding, in both machine formats', () => {
  test('JSON', () => {
    const findings = guard(project(BASE), 'json').findings;
    assert.ok(findings.length > 0);
    for (const f of findings) {
      assert.ok(['act', 'escalate'].includes(f.disposition), f.code);
      assert.ok(['measured', 'not-measured'].includes(f.evidence.status), f.code);
      assert.ok(typeof f.parserTier === 'string', f.code);
      assert.ok(['high', 'low'].includes(f.confidence), f.code);
      assert.ok(f.location === null || typeof f.location === 'string', `${f.code} location must never be an object`);
    }
  });

  test('SARIF', () => {
    const results = guard(project(BASE), 'sarif').runs[0].results;
    assert.ok(results.length > 0);
    for (const r of results) {
      for (const key of ['confidence', 'disposition', 'evidence', 'parserTier', 'reportable']) {
        assert.notEqual(r.properties[key], undefined, `${r.ruleId} must carry ${key}`);
      }
    }
  });
});

describe('SC-002 / FR-005 — a counted fact is an escalation, not a doubt', () => {
  test('FRS002 is a high-confidence escalation that is still offered for feedback', () => {
    // Freshness is off in the starter profile, so enable it explicitly rather
    // than relying on a default that could change.
    const withFreshness = { ...BASE, '.docguard.json': JSON.stringify({ projectName: 'accept', profile: 'starter', validators: { freshness: true } }) };
    const data = guard(project(withFreshness, { git: true }), 'json');
    const frs = data.findings.find(f => f.code === 'FRS002');
    assert.ok(frs, 'fixture must produce FRS002');
    assert.equal(frs.disposition, 'escalate');
    assert.equal(frs.confidence, 'high', 'the commit count came from git log; DocGuard did not guess it');
    assert.equal(frs.evidence.status, 'not-measured');
    assert.equal(frs.reportable, true, 'offered because the code is unmeasured, not because it is doubted');
    assert.match(frs.message, /repository-wide heuristic/);
  });
});

describe('FR-008 — the summary says what the work is', () => {
  test('act and escalate are counted separately under the verdict', () => {
    const dir = project(BASE);
    const data = guard(dir, 'json');
    const act = data.findings.filter(f => f.disposition === 'act').length;
    const escalate = data.findings.length - act;
    const out = guard(dir);
    if (act > 0) assert.match(out, new RegExp(`${act} to fix`));
    if (escalate > 0) assert.match(out, new RegExp(`${escalate} to review`));
    assert.match(out, /judgement is yours/, 'the line must explain what the split means');
  });

  test('the uncertainty nudge counts CODES, not findings', () => {
    // Per-finding it reached 666 of 671 across the real sample — noise, and
    // the wrong unit, since a contribution is filed per code.
    const out = guard(project(BASE));
    const m = out.match(/↪ (\d+) code\(s\) flagged uncertain/);
    if (m) {
      const data = guard(project(BASE), 'json');
      const codes = new Set(data.findings.filter(f => f.confidence === 'low').map(f => f.code));
      assert.equal(Number(m[1]), codes.size);
    }
  });

  test('"never benchmarked" is stated once, in the evidence block', () => {
    const out = guard(project(BASE));
    assert.equal((out.match(/never been benchmarked/g) || []).length, 1,
      'saying it twice in one summary teaches the reader to skip both');
  });
});

describe('SC-005 — an adjudication is visible and moves no rate', () => {
  test('adding a policy_disagreement leaves every SEC005 ratio identical', () => {
    const b = JSON.parse(readFileSync(join(ROOT, 'benchmarks/baseline.json'), 'utf8'));
    const row = {
      id: 'adj-accept', split: 'development', repositoryGroup: 'g', causalFamily: 'f',
      parserTier: 'js-ast', classification: 'policy_disagreement', repairOutcome: 'not_evaluated',
      source: { kind: 'fixture', path: 'fixtures/js-security-control' },
      scope: { validatorKey: 'security', codes: ['SEC005'] },
      config: {}, mutations: [], expected: [], forbidden: [], oppositeControl: null,
      adjudication: { rationale: 'Reviewed: the detector behaves exactly as specified here.', adjudicatedAt: '2026-09-21' },
      actual: [], unexpected: [], missing: [], abstained: false,
    };
    const before = derivePrecisionEvidence(b).byCode.SEC005;
    const after = derivePrecisionEvidence({ ...b, core: { ...b.core, cases: [...b.core.cases, row] } }).byCode.SEC005;
    const strip = o => JSON.stringify(o, (k, v) => (k === 'adjudicated' ? undefined : v));
    assert.equal(strip(after), strip(before));
    assert.deepEqual(after.adjudicated, { policyDisagreements: 1, ambiguous: 0 });
  });
});

describe('SC-007 — the headline cannot read non-coverage as success', () => {
  test('the coverage line leads with the checked ratio and the badge respects it', () => {
    const dir = project(BASE);
    const out = guard(dir);
    assert.match(out, /Check coverage: \d+ of \d+ validator\(s\) checked/);
    const data = guard(dir, 'json');
    const incomplete = ['partial', 'missing-prerequisite', 'unsupported', 'error']
      .reduce((s, k) => s + (data.checkCoverage.counts[k] || 0), 0);
    const line = out.split('\n').find(l => l.includes('img.shields.io'));
    // Scope to the pass badge. The line also carries the unverified-claims
    // badge, whose colour reports a different measurement and is legitimately
    // green at zero; a line-wide match would read that as coverage success.
    const badge = line.match(/CDD_Guard-[^)\s]*/)[0];
    if (incomplete > 0) assert.doesNotMatch(badge, /brightgreen/);
  });
});

describe('SC-008 — the dependency floor is unchanged', () => {
  test('one pinned runtime dependency, zero dev dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies || {}), ['@babel/parser'],
      'constitution II: exactly one runtime dependency');
    assert.match(pkg.dependencies['@babel/parser'], /^\d+\.\d+\.\d+$/, 'exact-pinned, no range');
    assert.deepEqual(pkg.devDependencies || {}, {}, 'tests use node:test');
  });
});

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
