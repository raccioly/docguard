/**
 * Failure policy (specs/070-requirement-anchors, user story 3): under
 * `anchors.failOn: reviewed-exact`, a suspect or lost link fails guard only
 * when it was reviewed (not baselined), sits at symbol, statement or route
 * scope, and was read at an exact tier; a requirement-side suspect never
 * fails; the shipped default is the one the committed replay measured; and a
 * spec's own failing anchors never block its completion.
 *
 * @req docguard.requirement-anchors#FR-027
 * @req docguard.requirement-anchors#FR-028
 * @req docguard.requirement-anchors#FR-029
 * @req docguard.requirement-anchors#SC-005
 * @req docguard.requirement-anchors#SC-006
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ANCHOR_FAIL_DEFAULT, computeAnchorStatus, failOnPolicy, isFailingProblem } from '../cli/scanners/anchors.mjs';
import { planSpecCompletion } from '../cli/commands/specs.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const EVIDENCE = resolve('specs/070-requirement-anchors/evidence/churn-replay.json');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function write(dir, rel, content) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
function project(failOn) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-policy-'));
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter', anchors: failOn ? { failOn } : {} }));
  write(dir, 'specs/001-billing/spec.md', '# Billing\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: A module.\n- **FR-002**: Discounts.\n- **FR-003**: A server.\n- **FR-004**: A ledger.\n');
  write(dir, 'src/pricing.mjs', '/**\n * Pricing.\n * @implements acme.billing#FR-001\n */\nimport { round } from \'./math.mjs\';\n\n/** @implements acme.billing#FR-002 */\nexport function applyDiscount(total) {\n  return round(total * 0.9);\n}\n\n// @implements acme.billing#FR-004\nexport function ledger() { return 1; }\n');
  write(dir, 'src/server.go', 'package server\n\n// @implements acme.billing#FR-003\nfunc Run() int {\n\treturn 1\n}\n');
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  return dir;
}
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, CI: 'true' } });
const accept = (dir, extra) => assert.equal(cli(dir, ['anchors', 'accept', ...extra]).status, 0);
const edit = (dir, rel, from, to) => {
  const text = readFileSync(join(dir, rel), 'utf8');
  assert.ok(text.includes(from), from);
  writeFileSync(join(dir, rel), text.replace(from, to));
};
const severities = dir => {
  const out = JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout);
  const bySeverity = {};
  for (const f of out.findings.filter(f => f.code.startsWith('ANC'))) {
    const req = /acme\.billing#FR-\d+/.exec(f.message)?.[0] || '?';
    bySeverity[`${f.code} ${req}`] = f.severity;
  }
  return { status: out.status, bySeverity };
};

describe('which suspects fail under failOn: reviewed-exact (FR-028)', () => {
  it('a reviewed, symbol-scope, exact-tier suspect fails; the file-scope and pattern-tier ones only warn', () => {
    const dir = project('reviewed-exact');
    accept(dir, ['--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']);
    edit(dir, 'src/pricing.mjs', 'total * 0.9', 'total * 0.8');
    edit(dir, 'src/server.go', 'return 1', 'return 2');
    const { status, bySeverity } = severities(dir);
    assert.equal(status, 'FAIL');
    assert.deepEqual(bySeverity, {
      'ANC001 acme.billing#FR-001': 'warn', // file scope: any edit in the file changes it
      'ANC001 acme.billing#FR-002': 'error', // reviewed, symbol, babel@7
      'ANC001 acme.billing#FR-003': 'warn', // pattern tier
    });
  });

  it('the same change on a baselined link warns', () => {
    const dir = project('reviewed-exact');
    accept(dir, ['--baseline', '--bulk', '--reason', 'adopt anchors for the fixture']);
    edit(dir, 'src/pricing.mjs', 'total * 0.9', 'total * 0.8');
    assert.equal(severities(dir).bySeverity['ANC001 acme.billing#FR-002'], 'warn');
  });

  it('a requirement-side suspect never fails, even on a reviewed, symbol-scope, exact-tier link', () => {
    const dir = project('reviewed-exact');
    accept(dir, ['--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']);
    edit(dir, 'specs/001-billing/spec.md', '- **FR-002**: Discounts.', '- **FR-002**: Discounts over 100.');
    const { bySeverity } = severities(dir);
    assert.equal(bySeverity['ANC002 acme.billing#FR-002'], 'warn');
    assert.ok(!Object.values(bySeverity).includes('error'), JSON.stringify(bySeverity));
    const anc002 = computeAnchorStatus(dir, { anchors: { failOn: 'reviewed-exact' } }, { noCache: true }).problems.find(p => p.code === 'ANC002');
    assert.deepEqual([anc002.scope, anc002.reviewedState, anc002.tier], ['symbol', 'reviewed', 'babel@7']);
  });

  it('a reviewed symbol whose tag is gone fails; with failOn none it only warns', () => {
    for (const [policy, expected] of [['reviewed-exact', 'error'], ['none', 'warn']]) {
      const dir = project(policy);
      accept(dir, ['--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']);
      edit(dir, 'src/pricing.mjs', '// @implements acme.billing#FR-004\n', '');
      assert.equal(severities(dir).bySeverity['ANC003 acme.billing#FR-004'], expected, policy);
    }
  });

  it('failOn none never fails on a suspect', () => {
    const dir = project('none');
    accept(dir, ['--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']);
    edit(dir, 'src/pricing.mjs', 'total * 0.9', 'total * 0.8');
    assert.equal(severities(dir).bySeverity['ANC001 acme.billing#FR-002'], 'warn');
  });
});

describe('the default is the measured one (FR-027, SC-005)', () => {
  it('the replay evidence is committed and covers at least 100 commits with the rule it applied', () => {
    assert.ok(existsSync(EVIDENCE), 'run node tools/anchor-churn-replay.mjs --write-default');
    const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
    assert.ok(evidence.commits >= 100, `${evidence.commits} commits`);
    assert.match(evidence.rule, /git diff -w/);
    assert.equal(evidence.failOnDefault, evidence.totals.formattingOnlyExact === 0 ? 'reviewed-exact' : 'none');
  });

  it('ANCHOR_FAIL_DEFAULT equals the committed evidence, and an unset or unknown failOn uses it', () => {
    const evidence = JSON.parse(readFileSync(EVIDENCE, 'utf8'));
    assert.equal(ANCHOR_FAIL_DEFAULT, evidence.failOnDefault);
    assert.equal(failOnPolicy({}), ANCHOR_FAIL_DEFAULT);
    assert.equal(failOnPolicy({ anchors: { failOn: 'sometimes' } }), ANCHOR_FAIL_DEFAULT);
    assert.equal(failOnPolicy({ anchors: { failOn: 'none' } }), 'none');
  });
});

describe('completion is never deadlocked by the spec\'s own anchors (FR-029, SC-006)', () => {
  function completable(failOn) {
    const dir = project(failOn);
    write(dir, 'specs/001-billing/tasks.md', '# Tasks\n\n- [x] T001 Build.\n');
    write(dir, 'tests/billing.test.mjs', '// @req acme.billing#FR-001\n// @req acme.billing#FR-002\n// @req acme.billing#FR-003\n// @req acme.billing#FR-004\ntest("x", () => {});\n');
    write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
    write(dir, 'src/math.mjs', 'export const round = n => Math.round(n);\n');
    write(dir, 'specs/002-other/spec.md', '# Other\n\n**Spec ID**: `acme.other`\n\n- **FR-001**: Other.\n');
    write(dir, 'src/other.mjs', "import { round } from './math.mjs';\n\n// @implements acme.other#FR-001\nexport function other() { return round(1); }\n");
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'tasks']);
    const registry = projectSpecRegistry(dir).registry;
    for (const spec of registry.specs) {
      spec.reviewed.lifecycle.approval = 'approved';
      spec.reviewed.lifecycle.delivery = 'implemented';
      spec.reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
    }
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    accept(dir, ['--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']);
    accept(dir, ['--spec', 'acme.other', '--bulk', '--reason', 'reviewed the other link']);
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'registry and lock']);
    return dir;
  }
  const commitAll = dir => { fixtureGit(dir, ['add', '-A']); fixtureGit(dir, ['commit', '-qm', 'change']); };

  it('the spec\'s own failing anchor findings are listed, not counted toward SPC007', () => {
    const dir = completable('reviewed-exact');
    const base = fixtureGit(dir, ['rev-parse', 'HEAD']).trim();
    edit(dir, 'src/pricing.mjs', 'total * 0.9', 'total * 0.8');
    commitAll(dir);
    const plan = planSpecCompletion(dir, { anchors: { failOn: 'reviewed-exact' } }, { id: 'acme.billing', since: base }, { guardResult: { status: 'FAIL', errors: 1, warnings: 0 } });
    assert.ok(!plan.blockers.some(b => b.code === 'SPC007'), JSON.stringify(plan.blockers));
    assert.deepEqual(plan.anchorFindings.map(f => [f.code, f.requirement]), [['ANC001', 'acme.billing#FR-002']]);
    assert.match(plan.anchorFindings[0].acceptCommand, /anchors accept --link/);
  });

  it('another spec\'s failing anchor still blocks completion', () => {
    const dir = completable('reviewed-exact');
    const base = fixtureGit(dir, ['rev-parse', 'HEAD']).trim();
    edit(dir, 'src/pricing.mjs', 'total * 0.9', 'total * 0.8');
    edit(dir, 'src/other.mjs', 'round(1)', 'round(2)');
    commitAll(dir);
    // Both changes are real failures, so the exemption is what decides SPC007.
    const failing = computeAnchorStatus(dir, { anchors: { failOn: 'reviewed-exact' } }, { noCache: true }).problems
      .filter(p => isFailingProblem(p, 'reviewed-exact')).map(p => p.requirement).sort();
    assert.deepEqual(failing, ['acme.billing#FR-002', 'acme.other#FR-001']);
    const plan = planSpecCompletion(dir, { anchors: { failOn: 'reviewed-exact' } }, { id: 'acme.billing', since: base }, { guardResult: { status: 'FAIL', errors: 2, warnings: 0 } });
    assert.ok(plan.blockers.some(b => b.code === 'SPC007' && /1 error/.test(b.message)), JSON.stringify(plan.blockers));
  });
});
