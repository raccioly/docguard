/**
 * Anchor lock and suspect links (specs/070-requirement-anchors, user story 2):
 * a baselined or reviewed link turns suspect when its code or its requirement
 * changes, an accept is bound to the fingerprints it saw, a deleted tag is
 * lost, the lock merges line by line and fails closed on a conflict, and only
 * `anchors accept` writes it.
 *
 * @req docguard.requirement-anchors#FR-016
 * @req docguard.requirement-anchors#FR-017
 * @req docguard.requirement-anchors#FR-018
 * @req docguard.requirement-anchors#FR-019
 * @req docguard.requirement-anchors#FR-020
 * @req docguard.requirement-anchors#FR-022
 * @req docguard.requirement-anchors#FR-023
 * @req docguard.requirement-anchors#FR-024
 * @req docguard.requirement-anchors#FR-025
 * @req docguard.requirement-anchors#SC-004
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ANCHOR_LOCK_PATH, LOCK_HEADER, readAnchorLock, serializeAnchorLock, stableLine } from '../cli/scanners/anchor-lock.mjs';
import { computeAnchorStatus } from '../cli/scanners/anchors.mjs';
import { changedDuringRun } from '../cli/commands/anchors.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const SPEC = `# Billing

**Spec ID**: \`acme.billing\`

## Requirements

- **FR-001**: Billing is a module.
- **FR-002**: Discounts apply to totals over the threshold.
- **FR-003**: Carts have a total.
`;
const PRICING = `/**
 * Pricing.
 * @implements acme.billing#FR-001
 */
import { round } from './math.mjs';

/** @implements acme.billing#FR-002 */
export function applyDiscount(total, coupon) {
  const rate = coupon ? 0.1 : 0;
  return round(total * (1 - rate));
}

export class Cart {
  // @implements acme.billing#FR-003
  total() { return 1; }
}
`;

function project({ git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-lock-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'specs', '001-billing'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'specs', '001-billing', 'spec.md'), SPEC);
  writeFileSync(join(dir, 'src', 'pricing.mjs'), PRICING);
  if (git) {
    fixtureGit(dir, ['init', '-q']);
    fixtureGit(dir, ['config', 'user.email', 't@example.com']);
    fixtureGit(dir, ['config', 'user.name', 't']);
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'base']);
  }
  return dir;
}
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, CI: 'true' } });
const status = dir => computeAnchorStatus(dir, {}, { noCache: true });
const link = (dir, req) => status(dir).links.find(l => l.requirement === `acme.billing#${req}`);
const edit = (dir, rel, from, to) => {
  const path = join(dir, rel);
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), `${rel}: ${from}`);
  writeFileSync(path, text.replace(from, to));
};
const baseline = dir => {
  const r = cli(dir, ['anchors', 'accept', '--baseline', '--bulk', '--reason', 'adopt anchors for the fixture']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
};
const guardCodes = dir => JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout).findings.map(f => f.code).filter(c => c.startsWith('ANC'));

describe('the lock file (FR-016 to FR-018)', () => {
  it('serializes deterministically: header, entries sorted by key, sorted keys, trailing newline', () => {
    const a = { key: 'b', requirement: 'r', file: 'f', anchor: 'x', scope: 'symbol', tier: 'babel@7', code: `dg1:sha256:${'1'.repeat(64)}`, floor: `dg1:sha256:${'2'.repeat(64)}`, req: `dg1:sha256:${'3'.repeat(64)}`, prev: null, state: 'reviewed', revision: null, date: '2026-10-11', reason: 'checked against the code', bulk: false };
    const b = { ...a, key: 'a' };
    const text = serializeAnchorLock(new Map([['b', a], ['a', b]]));
    const lines = text.split('\n');
    assert.equal(lines[0], stableLine(LOCK_HEADER));
    assert.equal(JSON.parse(lines[1]).key, 'a');
    assert.equal(JSON.parse(lines[2]).key, 'b');
    assert.ok(text.endsWith('}\n'));
    assert.equal(lines[1], stableLine(JSON.parse(lines[1])));
  });

  it('reads any line order, collapses identical duplicates and a duplicated header', () => {
    const dir = project({ git: false });
    baseline(dir);
    const text = readFileSync(join(dir, ANCHOR_LOCK_PATH), 'utf8').trim().split('\n');
    const shuffled = [text[0], ...text.slice(1).reverse(), text[1], text[0]];
    writeFileSync(join(dir, ANCHOR_LOCK_PATH), `${shuffled.join('\n')}\n`);
    const lock = readAnchorLock(dir);
    assert.equal(lock.error, null);
    assert.equal(lock.links.size, text.length - 1);
    assert.deepEqual(lock.conflicts, []);
  });

  it('two different lines for one key are a conflict: ANC009, and the link reads as suspect, never current', () => {
    const dir = project({ git: false });
    baseline(dir);
    const path = join(dir, ANCHOR_LOCK_PATH);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[1]);
    lines.push(stableLine({ ...entry, reason: 'reviewed on another branch' }));
    writeFileSync(path, `${lines.join('\n')}\n`);
    const s = status(dir);
    assert.ok(s.problems.some(p => p.code === 'ANC009' && p.message.includes(entry.key)));
    assert.equal(s.links.find(l => l.key === entry.key).state, 'suspect');
    assert.ok(guardCodes(dir).includes('ANC009'));
  });

  it('a malformed line, a missing header or an unsupported version is one ANC005 error, and nothing reads as current', () => {
    for (const mutate of [
      text => `${text}{not json\n`,
      text => text.split('\n').slice(1).join('\n'),
      text => text.replace('"schemaVersion":1', '"schemaVersion":99'),
    ]) {
      const dir = project({ git: false });
      baseline(dir);
      const path = join(dir, ANCHOR_LOCK_PATH);
      writeFileSync(path, mutate(readFileSync(path, 'utf8')));
      const s = status(dir);
      assert.ok(s.problems.some(p => p.code === 'ANC005'), JSON.stringify(s.problems.map(p => p.code)));
      assert.ok(s.links.every(l => l.state === 'unverifiable'));
      const out = JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout);
      assert.equal(out.status, 'FAIL');
      assert.ok(out.findings.some(f => f.code === 'ANC005' && f.severity === 'error'));
    }
  });
});

describe('suspect links (user story 2)', () => {
  it('baseline stamps every link as baselined; five formatting edits make nothing suspect', () => {
    const dir = project();
    baseline(dir);
    assert.deepEqual([...new Set(status(dir).links.map(l => l.state))], ['baselined']);
    edit(dir, 'src/pricing.mjs', 'export function applyDiscount(total, coupon) {\n  const rate = coupon ? 0.1 : 0;',
      'export function applyDiscount(total, coupon,) {\n\n    // a note\n    const rate = (coupon ? 0.1 : 0);');
    edit(dir, 'src/pricing.mjs', '  total() { return 1; }', '  total() {\n    return 1;\n  }');
    assert.deepEqual(status(dir).links.filter(l => l.state === 'suspect'), []);
    assert.deepEqual(guardCodes(dir), []);
  });

  it('a one-token edit makes that symbol\'s link suspect (ANC001), and the file-scope link of the same file, never another symbol', () => {
    const dir = project();
    baseline(dir);
    edit(dir, 'src/pricing.mjs', 'coupon ? 0.1 : 0', 'coupon ? 0.2 : 0');
    const suspects = status(dir).links.filter(l => l.state === 'suspect');
    // FR-001 is file scope: its fingerprint covers the whole file, which is why
    // the failure policy (story 3) never fails on file-scope links.
    assert.deepEqual(suspects.map(l => [l.requirement, l.scope, l.side]), [['acme.billing#FR-001', 'file', 'code'], ['acme.billing#FR-002', 'symbol', 'code']]);
    assert.equal(link(dir, 'FR-003').state, 'baselined');
    const finding = JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout).findings.find(f => f.code === 'ANC001');
    assert.ok(finding);
    assert.match(finding.suggestion.text, /git diff [0-9a-f]{12} -- src\/pricing\.mjs/);
    assert.match(finding.suggestion.text, /anchors accept --link/);
  });

  it('an accept clears exactly the accepted link, and a later change re-flags it (SC-004)', () => {
    const dir = project();
    baseline(dir);
    edit(dir, 'src/pricing.mjs', 'coupon ? 0.1 : 0', 'coupon ? 0.2 : 0');
    const key = link(dir, 'FR-002').key;
    const ok = cli(dir, ['anchors', 'accept', '--link', key, '--reason', 'rate change keeps FR-002']);
    assert.equal(ok.status, 0, ok.stderr);
    const accepted = link(dir, 'FR-002');
    assert.equal(accepted.state, 'reviewed');
    assert.ok(accepted.entry.prev, 'the replaced fingerprints are recorded');
    assert.equal(link(dir, 'FR-003').state, 'baselined');
    edit(dir, 'src/pricing.mjs', 'coupon ? 0.2 : 0', 'coupon ? 0.3 : 0');
    assert.equal(link(dir, 'FR-002').state, 'suspect');
  });

  it('editing a requirement makes its links suspect on the requirement side (ANC002); whitespace does not', () => {
    const dir = project();
    baseline(dir);
    edit(dir, 'specs/001-billing/spec.md', 'over the threshold.', 'over the  threshold.');
    assert.equal(link(dir, 'FR-002').state, 'baselined');
    edit(dir, 'specs/001-billing/spec.md', 'over the  threshold.', 'over the threshold of 100.');
    const l = link(dir, 'FR-002');
    assert.deepEqual([l.state, l.side], ['suspect', 'requirement']);
    assert.ok(guardCodes(dir).includes('ANC002'));
  });

  it('a deleted tag of a baselined link is lost (ANC003); --remove deletes the entry with a reason', () => {
    const dir = project();
    baseline(dir);
    edit(dir, 'src/pricing.mjs', '  // @implements acme.billing#FR-003\n', '');
    const s = status(dir);
    assert.deepEqual(s.lost.map(l => [l.requirement, l.state]), [['acme.billing#FR-003', 'lost']]);
    assert.ok(guardCodes(dir).includes('ANC003'));
    const key = s.lost[0].key;
    assert.equal(cli(dir, ['anchors', 'accept', '--remove', key, '--reason', 'tag dropped, FR-003 is covered elsewhere']).status, 0);
    assert.deepEqual(status(dir).lost, []);
  });

  it('a tag citing a retired requirement is ANC008, not unknown and not suspect', () => {
    const dir = project();
    writeFileSync(join(dir, '.docguard-archive.json'), JSON.stringify({
      schemaVersion: 1, strategy: 'git-history',
      retention: { ref: 'refs/heads/main', objectFormat: 'sha1', recoverability: 'verified' },
      entries: [{ path: 'specs/000-old/spec.md', archivedFrom: '0'.repeat(40), blob: '1'.repeat(40), reason: 'Superseded', requirementIds: ['FR-009'] }],
    }));
    edit(dir, 'src/pricing.mjs', 'export class Cart {', '// @implements specs/000-old/spec.md#FR-009\nexport function legacy() {}\n\nexport class Cart {');
    baseline(dir);
    const s = status(dir);
    assert.equal(s.links.find(l => l.requirement === 'specs/000-old/spec.md#FR-009').state, 'retired-target');
    assert.ok(s.problems.some(p => p.code === 'ANC008'));
    assert.ok(!s.problems.some(p => p.code === 'ANC007'));
  });
});

describe('accept refuses what it cannot vouch for (FR-022 to FR-025)', () => {
  it('more than one link without --bulk, a short reason, or no selection writes nothing', () => {
    const dir = project();
    const before = existsSync(join(dir, ANCHOR_LOCK_PATH));
    for (const args of [
      ['anchors', 'accept', '--spec', 'acme.billing', '--reason', 'checked every link'],
      ['anchors', 'accept', '--baseline', '--reason', 'adopt anchors now'],
      ['anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'short'],
      ['anchors', 'accept', '--reason', 'no selection given here'],
    ]) {
      const r = cli(dir, args);
      assert.equal(r.status, 1, args.join(' '));
    }
    assert.equal(existsSync(join(dir, ANCHOR_LOCK_PATH)), before);
  });

  it('--spec selects the spec\'s links and marks the entries bulk', () => {
    const dir = project();
    assert.equal(cli(dir, ['anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed all of billing']).status, 0);
    const lock = readAnchorLock(dir);
    assert.equal(lock.links.size, 3);
    assert.ok([...lock.links.values()].every(e => e.bulk === true && e.state === 'reviewed'));
  });

  it('.gitattributes changes only with --gitattributes, exactly once; the listing names the missing line', () => {
    const dir = project();
    baseline(dir);
    assert.equal(existsSync(join(dir, '.gitattributes')), false);
    const listing = JSON.parse(cli(dir, ['anchors', '--format', 'json']).stdout);
    assert.ok(listing.notes.some(n => n.includes('merge=union')));
    edit(dir, 'src/pricing.mjs', 'coupon ? 0.1 : 0', 'coupon ? 0.2 : 0');
    const key = link(dir, 'FR-002').key;
    for (let i = 0; i < 2; i++) {
      assert.equal(cli(dir, ['anchors', 'accept', '--link', key, '--gitattributes', '--reason', 'rate change keeps FR-002']).status, 0);
    }
    const attrs = readFileSync(join(dir, '.gitattributes'), 'utf8');
    assert.equal(attrs.split('\n').filter(l => l.includes('merge=union')).length, 1);
    assert.ok(!JSON.parse(cli(dir, ['anchors', '--format', 'json']).stdout).notes.some(n => n.includes('merge=union')));
  });

  it('refuses when a file changed between fingerprinting and writing', () => {
    const dir = project();
    const s = status(dir);
    const selected = s.links.filter(l => l.file === 'src/pricing.mjs');
    assert.deepEqual(changedDuringRun(dir, selected, s.files), []);
    edit(dir, 'src/pricing.mjs', 'return 1;', 'return 2;');
    assert.deepEqual(changedDuringRun(dir, selected, s.files), ['src/pricing.mjs']);
  });

  it('only anchors accept writes the lock: guard, anchors, specs --write and sync leave it byte-identical', () => {
    const dir = project();
    baseline(dir);
    const before = readFileSync(join(dir, ANCHOR_LOCK_PATH), 'utf8');
    for (const args of [['guard'], ['anchors'], ['specs', '--write'], ['sync', '--write'], ['fix', '--write']]) cli(dir, args);
    assert.equal(readFileSync(join(dir, ANCHOR_LOCK_PATH), 'utf8'), before);
  });

  it('the listing says DocGuard authenticates nobody', () => {
    const dir = project();
    baseline(dir);
    const listing = JSON.parse(cli(dir, ['anchors', '--format', 'json']).stdout);
    assert.ok(listing.notes.some(n => /authenticates nobody/.test(n) && /CODEOWNERS/.test(n)));
    assert.equal(listing.summary.baselinedShare, 1);
  });
});
