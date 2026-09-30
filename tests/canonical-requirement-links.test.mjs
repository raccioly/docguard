/**
 * reconcile traces a change that cites a canonical requirement
 * (`docs-canonical/REQUIREMENTS.md#FR-024`) to approved intent. Before this,
 * only spec links counted, so a test annotated with an exact canonical
 * requirement was "unsupported" and blocked `specs complete`.
 *
 * @req docguard.canonical-requirement-links#FR-001
 * @req docguard.canonical-requirement-links#FR-002
 * @req docguard.canonical-requirement-links#SC-001
 * @req docguard.canonical-requirement-links#SC-002
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReconciliationPlan } from '../cli/scanners/reconciliation.mjs';

const REQS = '# Requirements\n\n| ID | Priority | Requirement |\n|---|---|---|\n| FR-024 | P1 | A repo-wide hook must not block an unadopted tree. |\n';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-canonical-links-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (p, c) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); };
  const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  write('.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'standard' }));
  write('docs-canonical/REQUIREMENTS.md', REQS);
  write('tests/hook.test.js', 'test("hook", () => {});\n');
  git(['add', '.']); git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  const commit = msg => { git(['add', '.']); git(['commit', '-qm', msg]); };
  return { dir, base, write, commit };
}

const find = (plan, path) => plan.classifications.find(item => item.path === path);

describe('reconcile links a change to a declared canonical requirement', () => {
  it('a test citing a declared canonical requirement is approved intent, not unsupported (SC-001)', t => {
    const { dir, base, write, commit } = fixture(t);
    write('tests/hook.test.js', '// @req docs-canonical/REQUIREMENTS.md#FR-024\ntest("hook", () => {});\n');
    commit('annotate');
    const plan = buildReconciliationPlan(dir, {}, base);
    const item = find(plan, 'tests/hook.test.js');
    assert.equal(item.evidenceClass, 'approved_intent');
    assert.equal(item.disposition, 'possible_implementation_regression');
    assert.deepEqual(item.canonical, ['docs-canonical/REQUIREMENTS.md#FR-024']);
    assert.ok(plan.nodes.some(n => n.id === 'requirement:docs-canonical/REQUIREMENTS.md#FR-024' && n.type === 'canonical_requirement'));
    assert.ok(plan.edges.some(e => e.to === 'requirement:docs-canonical/REQUIREMENTS.md#FR-024' && e.kind === 'canonical_requirement'));
  });

  it('a change that edits the canonical document too is an intentional change', t => {
    const { dir, base, write, commit } = fixture(t);
    write('docs-canonical/REQUIREMENTS.md', REQS.replace('an unadopted tree', 'a tree without .docguard.json'));
    write('tests/hook.test.js', '// @req docs-canonical/REQUIREMENTS.md#FR-024\ntest("hook", () => {});\n');
    commit('intent and test');
    assert.equal(find(buildReconciliationPlan(dir, {}, base), 'tests/hook.test.js').disposition, 'intentional_behavior_change_review');
  });

  it('a citation renumbered from one declared ID to another is not unresolved (SC-002)', t => {
    const { dir, write, commit } = fixture(t);
    write('docs-canonical/REQUIREMENTS.md', `${REQS}| FR-018 | P1 | Findings carry three channels. |\n`);
    write('tests/hook.test.js', '// @req docs-canonical/REQUIREMENTS.md#FR-018\ntest("hook", () => {});\n');
    commit('old citation');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    write('tests/hook.test.js', '// @req docs-canonical/REQUIREMENTS.md#FR-024\ntest("hook", () => {});\n');
    commit('renumbered citation');
    const item = find(buildReconciliationPlan(dir, {}, before), 'tests/hook.test.js');
    assert.notEqual(item.disposition, 'unsupported_or_ambiguous');
    assert.deepEqual(item.canonical, ['docs-canonical/REQUIREMENTS.md#FR-018', 'docs-canonical/REQUIREMENTS.md#FR-024']);
  });

  it('an undeclared ID, a missing document, or a path escape stays unsupported (FR-002)', t => {
    const { dir, base, write, commit } = fixture(t);
    write('tests/a.test.js', '// @req docs-canonical/REQUIREMENTS.md#FR-099\n');
    write('tests/b.test.js', '// @req docs-canonical/NOPE.md#FR-024\n');
    // Resolves to the real document and declared ID, and must still be refused.
    write('tests/c.test.js', '// @req docs-canonical/../docs-canonical/REQUIREMENTS.md#FR-024\n');
    commit('bad refs');
    const plan = buildReconciliationPlan(dir, {}, base);
    for (const path of ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js']) {
      assert.equal(find(plan, path).disposition, 'unsupported_or_ambiguous', path);
      assert.equal(find(plan, path).canonical, undefined, path);
    }
  });

  it('a change with no canonical citation carries no canonical field (existing output unchanged)', t => {
    const { dir, base, write, commit } = fixture(t);
    write('src/x.js', 'export const x = 1;\n');
    commit('plain');
    const item = find(buildReconciliationPlan(dir, {}, base), 'src/x.js');
    assert.equal(item.disposition, 'unsupported_or_ambiguous');
    assert.equal('canonical' in item, false);
  });
});
