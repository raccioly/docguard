/**
 * Test chain (specs/070-requirement-anchors, user story 6): for a code-side
 * suspect, every test that cites the requirement needs re-verification; a
 * saved TestGuard evidence file re-verifies a test only when its revision
 * carried today's anchored code, a claim names the requirement through a
 * structured `req:` reference, the test defended that claim, and every fault
 * was killed with unchanged inputs. DocGuard reads files; it never runs tests.
 *
 * @req docguard.requirement-anchors#FR-032
 * @req docguard.requirement-anchors#FR-033
 * @req docguard.requirement-anchors#FR-045
 * @req docguard.requirement-anchors#FR-046
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { computeAnchorStatus } from '../cli/scanners/anchors.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const sha = text => createHash('sha256').update(text).digest('hex');
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const commit = (dir, message) => { fixtureGit(dir, ['add', '-A']); fixtureGit(dir, ['commit', '-qm', message]); return fixtureGit(dir, ['rev-parse', 'HEAD']).trim(); };

const PRODUCED = { producer: 'human', by: 'fixture' };
const STATEMENT = 'A discount lowers the total.';

/** A project with a reviewed FR-002 link, then a code change: the link is a code-side suspect. */
function project({ ref = 'req:acme.billing#FR-002' } = {}) {
  const dir = makeTempDir('dg-anchor-testchain-');
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  write(dir, 'specs/001-billing/spec.md', '# Billing\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: Totals.\n- **FR-002**: Discounts.\n');
  write(dir, 'src/pricing.mjs', "import { round } from './math.mjs';\n\n/** @implements acme.billing#FR-002 */\nexport function applyDiscount(total) {\n  return round(total * 0.9);\n}\n\n/** @implements acme.billing#FR-001 */\nexport function total(items) {\n  return items.length;\n}\n");
  write(dir, 'src/math.mjs', 'export const round = n => Math.round(n);\n');
  write(dir, 'tests/pricing.test.mjs', "// @req acme.billing#FR-002\nimport { test } from 'node:test';\ntest('discount', () => {});\n");
  write(dir, 'tests/other.test.mjs', "// @covers acme.billing#FR-002\nimport { test } from 'node:test';\ntest('other', () => {});\n");
  write(dir, 'testguard.claims.json', `${JSON.stringify(claimsFile(ref), null, 2)}\n`);
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  const base = commit(dir, 'base');
  const r = spawnSync(process.execPath, [CLI, 'anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links', '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  write(dir, 'src/pricing.mjs', read(dir, 'src/pricing.mjs').replace('total * 0.9', 'total * 0.8'));
  const head = commit(dir, 'change the discount');
  return { dir, base, head };
}

function claimsFile(ref, faults = ['F1']) {
  return {
    schemaVersion: 1,
    claims: [{
      id: 'PRICING-DISCOUNT', statement: STATEMENT, source: { kind: 'spec', ref }, severity: 'high', producedBy: PRODUCED,
      defendedBy: ['tests/pricing.test.mjs'],
      faults: faults.map(id => ({ id, description: 'drop the discount', faultClass: 'value-swapped', file: 'src/pricing.mjs', find: '0.8', replace: '1', producedBy: PRODUCED })),
    }],
  };
}

/** A TestGuard evidence file for the claims file as it is now, at `head`. */
function evidence(dir, head, { verdict = 'killed', confirmRuns = 3, provisional, defenders = ['tests/pricing.test.mjs'], faults = ['F1'], snapshot, closure, depHashes, issues, claimsSource, inputs: inputsPatch } = {}) {
  const claims = JSON.parse(read(dir, 'testguard.claims.json'));
  const claim = claims.claims[0];
  const doc = {
    schemaVersion: 1,
    tool: { name: 'testguard', version: '0.20.0' },
    run: { id: 'run-1', startedAt: '2026-10-11T00:00:00Z', repo: { head, dirty: false, ...(snapshot ? { snapshot } : {}) }, confirmRuns, ...(provisional ? { provisional } : {}), ...(claimsSource ? { claimsSource } : {}) },
    records: faults.map(id => ({
      fingerprint: sha(`${claim.id}\n${id}`),
      claim: { id: claim.id, statement: claim.statement, severity: claim.severity, source: claim.source, producedBy: claim.producedBy },
      subject: { kind: 'fault', id, file: 'src/pricing.mjs' },
      verdict,
      detail: {},
      defenders: { requested: defenders, resolved: defenders },
      inputs: {
        targetHash: sha(read(dir, 'src/pricing.mjs')),
        defenderHashes: Object.fromEntries(defenders.map(d => [d, sha(read(dir, d))])),
        ...(closure ? { dependencyClosure: closure } : {}),
        // The two fields require each other: an indeterminate closure still carries the (partial) hashes.
        ...(depHashes || closure === 'complete' || closure === 'indeterminate' ? { dependencyHashes: depHashes ?? (closure === 'complete' ? { 'src/math.mjs': sha(read(dir, 'src/math.mjs')) } : {}) } : {}),
        ...(issues ? { dependencyIssues: issues } : {}),
        ...inputsPatch,
      },
    })),
  };
  write(dir, '.testguard/evidence.json', JSON.stringify(doc));
  return doc;
}

const status = (dir, config = {}) => computeAnchorStatus(dir, { projectName: 'fixture', profile: 'starter', ...config }, { noCache: true, tests: true });
const testsOf = (dir, config) => {
  const link = status(dir, config).links.find(l => l.requirement === 'acme.billing#FR-002');
  assert.equal(link.state, 'suspect');
  return Object.fromEntries(link.tests.map(t => [t.file, t]));
};

describe('test chain (FR-032): tests citing a code-side suspect need re-verification', () => {
  it('lists every @req and @covers test of the requirement, and nothing for a link that did not change', () => {
    const { dir } = project();
    const result = status(dir);
    const suspect = result.links.find(l => l.requirement === 'acme.billing#FR-002');
    assert.deepEqual(suspect.tests.map(t => [t.file, t.line, t.status, t.reason]), [
      ['tests/other.test.mjs', 1, 'needs-reverification', 'no-evidence'],
      ['tests/pricing.test.mjs', 1, 'needs-reverification', 'no-evidence'],
    ]);
    const unchanged = result.links.find(l => l.requirement === 'acme.billing#FR-001');
    assert.equal(unchanged.state, 'reviewed');
    assert.equal(unchanged.tests, undefined);
  });

  it('a requirement-side suspect lists no tests: the code did not change', () => {
    const { dir } = project();
    fixtureGit(dir, ['checkout', '-q', 'HEAD~1', '--', 'src/pricing.mjs']);
    write(dir, 'specs/001-billing/spec.md', read(dir, 'specs/001-billing/spec.md').replace('Discounts.', 'Discounts over 100.'));
    const link = status(dir).links.find(l => l.requirement === 'acme.billing#FR-002');
    assert.equal(link.side, 'requirement');
    assert.equal(link.tests, undefined);
  });

  it('without the tests option nothing is read and nothing is attached', () => {
    const { dir } = project();
    const link = computeAnchorStatus(dir, {}, { noCache: true }).links.find(l => l.requirement === 'acme.billing#FR-002');
    assert.equal(link.tests, undefined);
  });
});

describe('TestGuard evidence (FR-033): re-verified only when all four conditions hold', () => {
  it('matching revision, structured claim, killed faults: the defending test is re-verified; a non-defender is not', () => {
    const { dir, head } = project();
    evidence(dir, head);
    const tests = testsOf(dir);
    assert.equal(tests['tests/pricing.test.mjs'].status, 're-verified');
    assert.equal(tests['tests/pricing.test.mjs'].evidenceHead, head);
    assert.deepEqual(tests['tests/pricing.test.mjs'].claims, ['PRICING-DISCOUNT']);
    assert.equal(tests['tests/other.test.mjs'].status, 'needs-reverification');
    assert.equal(tests['tests/other.test.mjs'].reason, 'not-a-defender');
  });

  it('evidence from before the change predates it: needs re-verification', () => {
    const { dir, base } = project();
    evidence(dir, base);
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'needs-reverification');
    assert.equal(t.reason, 'evidence-predates-change');
  });

  it('an unstructured reference needs re-verification, with the structured form to write', () => {
    const { dir, head } = project({ ref: 'specs/001-billing/spec.md#FR-002' });
    evidence(dir, head);
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'needs-reverification');
    assert.equal(t.reason, 'no-structured-claim');
    assert.match(t.message, /req:acme\.billing#FR-002/);
    assert.match(t.message, /PRICING-DISCOUNT/);
  });

  it('a fault the tests did not kill keeps the test unproven', () => {
    const { dir, head } = project();
    evidence(dir, head, { verdict: 'survived' });
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'needs-reverification');
    assert.equal(t.reason, 'fault-not-killed');
    assert.match(t.message, /F1 survived/);
  });

  it('a working-tree probe is read at its snapshot commit', () => {
    const { dir, base, head } = project();
    evidence(dir, base, { snapshot: head });
    assert.equal(testsOf(dir)['tests/pricing.test.mjs'].status, 're-verified');
  });
});

describe('inconclusive evidence is never re-verified (FR-033)', () => {
  const cases = [
    ['unreadable JSON', (dir) => write(dir, '.testguard/evidence.json', '{ not json'), 'evidence-invalid'],
    ['a document that is not TestGuard evidence', (dir) => write(dir, '.testguard/evidence.json', JSON.stringify({ schemaVersion: 1, records: 'x' })), 'evidence-invalid'],
    ['a head that does not resolve', (dir, ctx) => evidence(dir, 'f'.repeat(40)), 'head-unresolvable'],
    ['a head that is not a commit id', (dir) => evidence(dir, '--output=/tmp/x'), 'evidence-invalid'],
    ['provisional evidence', (dir, ctx) => evidence(dir, ctx.head, { confirmRuns: 1 }), 'evidence-provisional'],
    ['a defender edited after the probe', (dir, ctx) => { evidence(dir, ctx.head); write(dir, 'tests/pricing.test.mjs', `${read(dir, 'tests/pricing.test.mjs')}// edited\n`); }, 'inputs-stale'],
    ['the target edited after the probe', (dir, ctx) => { evidence(dir, ctx.head); write(dir, 'src/pricing.mjs', `${read(dir, 'src/pricing.mjs')}// edited\n`); }, 'inputs-stale'],
    ['a fault added after the probe', (dir, ctx) => { evidence(dir, ctx.head); write(dir, 'testguard.claims.json', JSON.stringify(claimsFile('req:acme.billing#FR-002', ['F1', 'F2']))); }, 'fault-unprobed'],
    ['the claim edited after the probe', (dir, ctx) => { evidence(dir, ctx.head); const c = claimsFile('req:acme.billing#FR-002'); c.claims[0].statement = 'Changed.'; write(dir, 'testguard.claims.json', JSON.stringify(c)); }, 'claim-changed'],
    ['a missing claims file', (dir, ctx) => { evidence(dir, ctx.head); rmSync(join(dir, 'testguard.claims.json')); }, 'claims-unreadable'],
  ];
  for (const [name, arrange, reason] of cases) {
    it(`${name} → inconclusive (${reason})`, () => {
      const ctx = project();
      arrange(ctx.dir, ctx);
      const t = testsOf(ctx.dir)['tests/pricing.test.mjs'];
      assert.equal(t.status, 'inconclusive', JSON.stringify(t));
      assert.equal(t.reason, reason);
      assert.ok(t.message.length > 0);
    });
  }

  it('an evidence path outside the project is refused, not read', () => {
    const { dir, head } = project();
    evidence(dir, head);
    for (const evidencePath of ['../evidence.json', '/etc/passwd', '.testguard/../../x.json']) {
      const t = testsOf(dir, { anchors: { testguard: { evidence: evidencePath } } })['tests/pricing.test.mjs'];
      assert.equal(t.status, 'inconclusive', evidencePath);
      assert.equal(t.reason, 'evidence-unreadable', evidencePath);
    }
  });

  it('a configured evidence and claims path is read', () => {
    const { dir, head } = project();
    evidence(dir, head);
    write(dir, 'reports/tg.json', read(dir, '.testguard/evidence.json'));
    write(dir, 'config/claims.json', read(dir, 'testguard.claims.json'));
    rmSync(join(dir, '.testguard'), { recursive: true });
    rmSync(join(dir, 'testguard.claims.json'));
    const t = testsOf(dir, { anchors: { testguard: { evidence: 'reports/tg.json', claims: 'config/claims.json' } } })['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified');
  });
});

describe('the listing shows the chain', () => {
  it('docguard anchors prints each test with its status, and --format json carries tests[]', () => {
    const { dir, head } = project();
    evidence(dir, head);
    const text = spawnSync(process.execPath, [CLI, 'anchors', '--dir', dir], { encoding: 'utf8' }).stdout;
    assert.match(text, /tests\/pricing\.test\.mjs:1 re-verified at [0-9a-f]{12}/);
    assert.match(text, /tests\/other\.test\.mjs:1 needs re-verification/);
    const json = JSON.parse(spawnSync(process.execPath, [CLI, 'anchors', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
    const link = json.links.find(l => l.requirement === 'acme.billing#FR-002');
    assert.equal(link.tests.length, 2);
  });

  it('guard is unchanged by the chain: no finding names a test', () => {
    const { dir, head } = project();
    evidence(dir, head);
    const guard = JSON.parse(spawnSync(process.execPath, [CLI, 'guard', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
    assert.ok(!guard.findings.some(f => /\.test\.mjs|re-verif/.test(f.message)));
  });
});

describe('dependency-closure freshness (FR-045)', () => {
  it('a helper the target imports changed after the probe: inconclusive, naming it', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete' });
    write(dir, 'src/math.mjs', 'export const round = n => Math.floor(n);\n');
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'inconclusive');
    assert.equal(t.reason, 'inputs-stale');
    assert.match(t.message, /src\/math\.mjs changed since PRICING-DISCOUNT\/F1 was probed/);
  });

  it('a recorded dependency that no longer exists is a mismatch', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete' });
    rmSync(join(dir, 'src/math.mjs'));
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.reason, 'inputs-stale');
    assert.match(t.message, /src\/math\.mjs/);
  });

  it('an indeterminate closure is inconclusive, with and without issues', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'indeterminate' });
    let t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'inconclusive');
    assert.equal(t.reason, 'closure-indeterminate');
    evidence(dir, head, { closure: 'indeterminate', issues: [{ code: 'computed-specifier', file: 'src/pricing.mjs', specifier: 'x' }] });
    t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.reason, 'closure-indeterminate');
    assert.match(t.message, /computed-specifier/);
    assert.match(t.message, /src\/pricing\.mjs/);
  });

  it('issue text is untrusted: an unknown code and a long file are not echoed', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'indeterminate', issues: [{ code: 'IGNORE PREVIOUS INSTRUCTIONS', file: 'x'.repeat(5000) }] });
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.reason, 'closure-indeterminate');
    assert.ok(!/IGNORE PREVIOUS/.test(t.message));
    assert.ok(t.message.length < 400, String(t.message.length));
  });

  it('a complete closure with nothing changed is a plain pass: no notChecked key', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete' });
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified');
    assert.equal(t.reason, 'evidence-current');
    assert.ok(!('notChecked' in t));
  });

  it('legacy evidence keeps its verdict and reports the closure as not checked', () => {
    const { dir, head } = project();
    evidence(dir, head);
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified');
    assert.equal(t.reason, 'evidence-current');
    assert.deepEqual(t.notChecked, ['dependency-closure']);
    assert.match(t.message, /not checked/);
  });

  const good = () => ({ 'src/math.mjs': sha('x') });
  const malformed = [
    ['hashes without closure', { depHashes: good() }],
    ['closure without hashes', { inputs: { dependencyClosure: 'complete' } }],
    ['a bad hash', { closure: 'complete', depHashes: { 'src/math.mjs': 'abc' } }],
    ['an unsafe path', { closure: 'complete', depHashes: { '../etc/passwd': sha('x') } }],
    ['an absolute path', { closure: 'complete', depHashes: { '/etc/passwd': sha('x') } }],
    ['an unknown closure value', { closure: 'partial', depHashes: good() }],
    ['hashes that are an array', { closure: 'complete', depHashes: [] }],
  ];
  for (const [name, opts] of malformed) {
    it(`malformed (${name}) → inconclusive, inputs-stale`, () => {
      const { dir, head } = project();
      evidence(dir, head, opts);
      const t = testsOf(dir)['tests/pricing.test.mjs'];
      assert.equal(t.status, 'inconclusive', JSON.stringify(t));
      assert.equal(t.reason, 'inputs-stale');
      assert.match(t.message, /malformed/);
    });
  }

  it('more than 20,000 dependency entries is malformed', () => {
    const { dir, head } = project();
    const many = Object.fromEntries(Array.from({ length: 20001 }, (_, i) => [`f${i}.mjs`, sha('x')]));
    evidence(dir, head, { closure: 'complete', depHashes: many });
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.reason, 'inputs-stale');
    assert.match(t.message, /malformed/);
  });
});

describe('claims supplied from outside the repository (FR-046)', () => {
  const EXTERNAL = { external: true, sha256: 'a'.repeat(64) };

  it('no claims file configured: the default file is not read, and the gap is recorded', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete', claimsSource: EXTERNAL });
    rmSync(join(dir, 'testguard.claims.json'));
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified', JSON.stringify(t));
    assert.equal(t.reason, 'claims-not-compared');
    assert.deepEqual(t.notChecked, ['claim-changed', 'fault-unprobed']);
    assert.match(t.message, /not checked/);
  });

  it('a stale default claims file is ignored too, and legacy closure adds its gap', () => {
    const { dir, head } = project();
    evidence(dir, head, { claimsSource: EXTERNAL });
    const stale = claimsFile('req:acme.billing#FR-002', ['F1', 'F2']);
    stale.claims[0].statement = 'Not what was probed.';
    write(dir, 'testguard.claims.json', JSON.stringify(stale));
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified', JSON.stringify(t));
    assert.equal(t.reason, 'claims-not-compared');
    assert.deepEqual(t.notChecked, ['claim-changed', 'dependency-closure', 'fault-unprobed']);
  });

  it('every other check still applies: a fault not killed needs re-verification', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete', claimsSource: EXTERNAL, verdict: 'survived' });
    rmSync(join(dir, 'testguard.claims.json'));
    const t = testsOf(dir)['tests/pricing.test.mjs'];
    assert.equal(t.status, 'needs-reverification');
    assert.equal(t.reason, 'fault-not-killed');
  });

  it('every other check still applies: a changed target is stale', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete', claimsSource: EXTERNAL });
    rmSync(join(dir, 'testguard.claims.json'));
    write(dir, 'tests/pricing.test.mjs', `${read(dir, 'tests/pricing.test.mjs')}// edited\n`);
    assert.equal(testsOf(dir)['tests/pricing.test.mjs'].reason, 'inputs-stale');
  });

  it('a configured claims path behaves as today, including claim-changed', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete', claimsSource: EXTERNAL });
    const copy = JSON.parse(read(dir, 'testguard.claims.json'));
    write(dir, 'config/claims.json', JSON.stringify(copy));
    const config = { anchors: { testguard: { claims: 'config/claims.json' } } };
    let t = testsOf(dir, config)['tests/pricing.test.mjs'];
    assert.equal(t.status, 're-verified');
    assert.equal(t.reason, 'evidence-current');
    assert.ok(!('notChecked' in t));
    copy.claims[0].statement = 'Changed.';
    write(dir, 'config/claims.json', JSON.stringify(copy));
    t = testsOf(dir, config)['tests/pricing.test.mjs'];
    assert.equal(t.reason, 'claim-changed');
  });

  it('external: false reads the default claims file as before', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete', claimsSource: { external: false } });
    rmSync(join(dir, 'testguard.claims.json'));
    assert.equal(testsOf(dir)['tests/pricing.test.mjs'].reason, 'claims-unreadable');
  });

  for (const [name, claimsSource] of [
    ['a non-object', 'x'], ['no boolean external', { sha256: 'a'.repeat(64) }],
    ['external without a hash', { external: true }], ['external with a bad hash', { external: true, sha256: 'zz' }],
    ['a path instead of a hash', { external: true, sha256: 'a'.repeat(64), path: '/x' }],
  ]) {
    if (name === 'a path instead of a hash') continue; // extra properties are tolerated, not read
    it(`malformed claimsSource (${name}) → evidence-invalid`, () => {
      const { dir, head } = project();
      evidence(dir, head, { claimsSource: claimsSource === 'x' ? undefined : claimsSource });
      if (claimsSource === 'x') { const d = JSON.parse(read(dir, '.testguard/evidence.json')); d.run.claimsSource = 'x'; write(dir, '.testguard/evidence.json', JSON.stringify(d)); }
      const t = testsOf(dir)['tests/pricing.test.mjs'];
      assert.equal(t.status, 'inconclusive');
      assert.equal(t.reason, 'evidence-invalid');
    });
  }
});

describe('the listing shows what was not checked (FR-045, FR-046)', () => {
  it('text prints a re-verified test with a gap in yellow with the list; json carries notChecked', () => {
    const { dir, head } = project();
    evidence(dir, head, { claimsSource: { external: true, sha256: 'a'.repeat(64) } });
    rmSync(join(dir, 'testguard.claims.json'));
    const env = { ...process.env, FORCE_COLOR: '1' };
    const text = spawnSync(process.execPath, [CLI, 'anchors', '--dir', dir], { encoding: 'utf8', env }).stdout;
    assert.match(text, /not checked: claim-changed, dependency-closure, fault-unprobed/);
    assert.match(text, /\u001b\[33mre-verified at [0-9a-f]{12}/);
    const json = JSON.parse(spawnSync(process.execPath, [CLI, 'anchors', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
    const link = json.links.find(l => l.requirement === 'acme.billing#FR-002');
    const t = link.tests.find(x => x.file === 'tests/pricing.test.mjs');
    assert.equal(t.reason, 'claims-not-compared');
    assert.deepEqual(t.notChecked, ['claim-changed', 'dependency-closure', 'fault-unprobed']);
  });

  it('a clean pass prints in green with no gap', () => {
    const { dir, head } = project();
    evidence(dir, head, { closure: 'complete' });
    const env = { ...process.env, FORCE_COLOR: '1' };
    const text = spawnSync(process.execPath, [CLI, 'anchors', '--dir', dir], { encoding: 'utf8', env }).stdout;
    assert.match(text, /\u001b\[32mre-verified at/);
    assert.ok(!/not checked:/.test(text));
  });
});
