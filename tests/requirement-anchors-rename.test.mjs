/**
 * Rename and move carry-over (specs/070-requirement-anchors, user story 4): a
 * reviewed function renamed and moved with an unchanged body keeps its review
 * as `moved`; two identical candidates, or none, make it lost; the next
 * accept rewrites the key.
 *
 * @req docguard.requirement-anchors#FR-030
 * @req docguard.requirement-anchors#SC-009
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeAnchorStatus } from '../cli/scanners/anchors.mjs';
import { readAnchorLock } from '../cli/scanners/anchor-lock.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const BODY = '(total, coupon) {\n  const rate = coupon ? 0.1 : 0;\n  return total * (1 - rate);\n}\n';
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-move-'));
  dirs.push(dir);
  write(dir, 'specs/001-billing/spec.md', '# Billing\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: Discounts.\n- **FR-002**: Totals.\n');
  write(dir, 'src/pricing.mjs', `import { x } from './x.mjs';\n\n/** @implements acme.billing#FR-001 */\nexport function applyDiscount${BODY}\n/** @implements acme.billing#FR-002 */\nexport function total() { return x; }\n`);
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  const r = spawnSync(process.execPath, [CLI, 'anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links', '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}
const status = dir => computeAnchorStatus(dir, {}, { noCache: true });
// A moved file becomes a new tracked path only once git sees it.
const stage = dir => fixtureGit(dir, ['add', '-A']);

describe('rename and move (FR-030, SC-009)', () => {
  it('renaming and moving a reviewed function with an unchanged body: moved, 0 suspect, 0 lost', () => {
    const dir = project();
    const text = readFileSync(join(dir, 'src/pricing.mjs'), 'utf8');
    write(dir, 'src/pricing.mjs', text.replace(`/** @implements acme.billing#FR-001 */\nexport function applyDiscount${BODY}\n`, ''));
    write(dir, 'src/discounts.mjs', `import { x } from './x.mjs';\n\n/** @implements acme.billing#FR-001 */\nexport function applyCouponDiscount${BODY}`);
    stage(dir);
    const s = status(dir);
    const moved = s.links.find(l => l.requirement === 'acme.billing#FR-001');
    assert.deepEqual([moved.state, moved.file, moved.anchor, moved.reviewedState], ['moved', 'src/discounts.mjs', 'applyCouponDiscount', 'reviewed']);
    assert.equal(s.links.filter(l => l.state === 'suspect').length, 0);
    assert.deepEqual(s.lost, []);
    assert.ok(s.notes.some(n => /moved from src\/pricing\.mjs applyDiscount/.test(n)));
    assert.ok(!s.problems.some(p => ['ANC001', 'ANC003', 'ANC004'].includes(p.code) && p.message.includes('FR-001')));
  });

  it('the next accept rewrites the key and drops the old entry', () => {
    const dir = project();
    const text = readFileSync(join(dir, 'src/pricing.mjs'), 'utf8');
    write(dir, 'src/pricing.mjs', text.replace('export function applyDiscount', 'export function applyCouponDiscount'));
    const moved = status(dir).links.find(l => l.requirement === 'acme.billing#FR-001');
    assert.equal(moved.state, 'moved');
    const r = spawnSync(process.execPath, [CLI, 'anchors', 'accept', '--link', moved.key, '--reason', 'renamed only, body unchanged', '--dir', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const keys = [...readAnchorLock(dir).links.keys()].filter(k => k.startsWith('acme.billing#FR-001'));
    assert.deepEqual(keys, [moved.key]);
    assert.equal(status(dir).links.find(l => l.requirement === 'acme.billing#FR-001').state, 'reviewed');
  });

  it('two identical candidate bodies: no carry-over, the review is lost', () => {
    const dir = project();
    const text = readFileSync(join(dir, 'src/pricing.mjs'), 'utf8');
    write(dir, 'src/pricing.mjs', text.replace('export function applyDiscount', 'export function applyCouponDiscount'));
    write(dir, 'src/copy.mjs', `import { x } from './x.mjs';\n\n/** @implements acme.billing#FR-001 */\nexport function anotherDiscount${BODY}`);
    stage(dir);
    const s = status(dir);
    assert.deepEqual(s.lost.map(l => [l.requirement, l.state]), [['acme.billing#FR-001', 'lost']]);
    assert.ok(s.links.filter(l => l.requirement === 'acme.billing#FR-001').every(l => l.state === 'unreviewed'));
  });

  it('deleting the only implementation of a requirement yields exactly one lost link', () => {
    const dir = project();
    const text = readFileSync(join(dir, 'src/pricing.mjs'), 'utf8');
    write(dir, 'src/pricing.mjs', text.replace(`/** @implements acme.billing#FR-001 */\nexport function applyDiscount${BODY}\n`, ''));
    const s = status(dir);
    assert.equal(s.lost.length, 1);
    assert.equal(s.lost[0].requirement, 'acme.billing#FR-001');
    assert.ok(s.problems.some(p => p.code === 'ANC003'));
  });

  it('a changed body under a new name is not carried over', () => {
    const dir = project();
    const text = readFileSync(join(dir, 'src/pricing.mjs'), 'utf8');
    write(dir, 'src/pricing.mjs', text.replace('export function applyDiscount', 'export function applyCouponDiscount').replace('0.1', '0.2'));
    const s = status(dir);
    assert.equal(s.lost.length, 1);
    assert.equal(s.links.find(l => l.requirement === 'acme.billing#FR-001').state, 'unreviewed');
  });
});
