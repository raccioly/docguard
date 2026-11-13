/**
 * The anchor lock merges cleanly (specs/102-anchor-lock-merge): a union merge
 * or rebase that keeps two lines for one link is resolved by what the code and
 * the requirement are now, never refused; every writer leaves one line per
 * link; `anchors merge` repairs a lock, including one with git conflict markers.
 *
 * @req docguard.anchor-lock-merge#FR-001
 * @req docguard.anchor-lock-merge#FR-002
 * @req docguard.anchor-lock-merge#FR-003
 * @req docguard.anchor-lock-merge#FR-004
 * @req docguard.anchor-lock-merge#FR-005
 * @req docguard.anchor-lock-merge#FR-006
 * @req docguard.anchor-lock-merge#FR-007
 * @req docguard.anchor-lock-merge#FR-008
 * @req docguard.anchor-lock-merge#SC-001
 * @req docguard.anchor-lock-merge#SC-002
 * @req docguard.anchor-lock-merge#SC-003
 * @req docguard.anchor-lock-merge#SC-005
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as lockModule from '../cli/scanners/anchor-lock.mjs';
import * as anchorsModule from '../cli/scanners/anchors.mjs';
import { CODES } from '../cli/findings.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const { ANCHOR_LOCK_PATH, LOCK_HEADER, readAnchorLock, stableLine } = lockModule;
const ROOT = resolve('.');
const CLI = resolve('cli/docguard.mjs');
const ENV = { ...process.env, CI: 'true' };

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

// filler so that the two edits below never touch neighboring lines
// filler
// filler
// filler

export class Cart {
  // @implements acme.billing#FR-003
  total() { return 1; }
}
`;

const run = (dir, args, cliPath = CLI) => spawnSync(process.execPath, [cliPath, ...args, '--dir', dir], { encoding: 'utf8', env: ENV });
const guardFindings = dir => JSON.parse(run(dir, ['guard', '--format', 'json']).stdout).findings.filter(f => f.code.startsWith('ANC'));
const codes = dir => guardFindings(dir).map(f => f.code);
const lockText = dir => readFileSync(join(dir, ANCHOR_LOCK_PATH), 'utf8');
const entriesOf = dir => lockText(dir).trim().split('\n').slice(1).map(l => JSON.parse(l));
const keyCounts = dir => entriesOf(dir).reduce((m, e) => m.set(e.key, (m.get(e.key) || 0) + 1), new Map());
const edit = (dir, from, to) => {
  const path = join(dir, 'src', 'pricing.mjs');
  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes(from), from);
  writeFileSync(path, text.replace(from, to));
};
const commit = (dir, msg) => { fixtureGit(dir, ['add', '-A']); fixtureGit(dir, ['commit', '-qm', msg]); };
const accept = (dir, reason) => {
  const r = run(dir, ['anchors', 'accept', '--file', 'src/pricing.mjs', '--bulk', '--reason', reason]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
};

/** A git project with the anchors baselined and `merge=union` declared, on `main`. */
function project({ union = true } = {}) {
  const dir = makeTempDir('dg-anchor-merge-');
  mkdirSync(join(dir, 'specs', '001-billing'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'specs', '001-billing', 'spec.md'), SPEC);
  writeFileSync(join(dir, 'src', 'pricing.mjs'), PRICING);
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  commit(dir, 'base');
  const r = run(dir, ['anchors', 'accept', '--baseline', '--bulk', ...(union ? ['--gitattributes'] : []), '--reason', 'adopt anchors for the fixture']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  commit(dir, 'lock');
  return dir;
}

/** Branch `a` and branch `b` from main, each doing its own work, then join them. */
function diverge(dir, { a, b, how }) {
  fixtureGit(dir, ['checkout', '-q', '-b', 'a']);
  a(dir);
  commit(dir, 'a');
  fixtureGit(dir, ['checkout', '-q', 'main']);
  fixtureGit(dir, ['checkout', '-q', '-b', 'b']);
  b(dir);
  commit(dir, 'b');
  if (how === 'merge') fixtureGit(dir, ['merge', '-q', 'a', '-m', 'merge a']);
  else fixtureGit(dir, ['rebase', 'a']);
}

const bothEdit = {
  a: dir => { edit(dir, '0.1 : 0', '0.2 : 0'); accept(dir, 'reviewed the discount change on a'); },
  b: dir => { edit(dir, 'return 1;', 'return 2;'); accept(dir, 'reviewed the cart change on b'); },
};
const oneEdits = {
  a: dir => { edit(dir, '0.1 : 0', '0.2 : 0'); accept(dir, 'reviewed the discount change on a'); },
  b: dir => accept(dir, 're-read the same file on b without a change'),
};

// ───────────────────────────── helpers for the unit cases ─────────────────────────────

const fp = c => `dg1:sha256:${c.repeat(64)}`;
const KEY = 'acme.billing#FR-001|src/a.mjs|*|file';
const mk = (o = {}) => ({
  key: KEY, requirement: 'acme.billing#FR-001', file: 'src/a.mjs', anchor: '*', scope: 'file', tier: 'babel@7',
  code: fp('1'), floor: fp('2'), req: fp('3'), prev: null, state: 'reviewed', revision: null, date: '2026-11-01',
  reason: 'checked against the code', bulk: false, ...o,
});
const NOW = { key: KEY, tier: 'babel@7', exact: fp('1'), floor: fp('2'), req: fp('3') };
const writeLock = (dir, entries) => writeFileSync(join(dir, ANCHOR_LOCK_PATH), `${[stableLine(LOCK_HEADER), ...entries.map(stableLine)].join('\n')}\n`);
const resolveOne = (entries, link = NOW) => {
  const dir = makeTempDir('dg-anchor-merge-unit-');
  writeLock(dir, entries);
  const lock = readAnchorLock(dir);
  assert.equal(lock.error, null);
  return anchorsModule.resolveLockLinks(lock, new Map([[link.key, link]])).get(KEY);
};

describe('FR-001: the reader keeps every line of a key and never refuses a duplicate', () => {
  it('byte-identical lines are one entry and no variant', () => {
    const dir = makeTempDir('dg-anchor-merge-unit-');
    writeLock(dir, [mk(), mk()]);
    const lock = readAnchorLock(dir);
    assert.equal(lock.error, null);
    assert.equal(lock.links.size, 1);
    assert.equal(lock.variants.size, 0);
    assert.equal(lock.collapsed, 1);
  });

  it('different lines for one key are kept as variants, and the key is still a link', () => {
    const dir = makeTempDir('dg-anchor-merge-unit-');
    writeLock(dir, [mk(), mk({ reason: 'reviewed on another branch' })]);
    const lock = readAnchorLock(dir);
    assert.equal(lock.error, null);
    assert.equal(lock.links.has(KEY), true);
    assert.equal(lock.variants.get(KEY).length, 2);
    assert.deepEqual(lock.conflicts, []);
  });
});

describe('FR-002: which line stands for a link', () => {
  it('the line whose fingerprints match the current content is the review; the other is superseded', () => {
    const stale = mk({ code: fp('9'), floor: fp('8'), date: '2026-11-05', reason: 'newer day but an older code' });
    const valid = mk({ date: '2026-11-02' });
    for (const order of [[valid, stale], [stale, valid]]) assert.equal(resolveOne(order).reason, valid.reason);
  });

  it('a requirement text that changed since one line makes the other the valid review', () => {
    const stale = mk({ req: fp('7'), date: '2026-11-05' });
    const valid = mk({ date: '2026-11-02', reason: 'the requirement as it reads now' });
    assert.equal(resolveOne([stale, valid]).reason, valid.reason);
  });

  it('none matches: the newest stands and the link is suspect through the normal comparison', () => {
    const older = mk({ code: fp('8'), floor: fp('8'), date: '2026-11-01', reason: 'older stale review' });
    const newer = mk({ code: fp('9'), floor: fp('9'), date: '2026-11-03', reason: 'newer stale review' });
    const winner = resolveOne([newer, older]);
    assert.equal(winner.reason, newer.reason);
    assert.equal(anchorsModule.compareEntry(winner, NOW).verdict, 'suspect');
  });

  it('several lines match: the newest date stands; the same date falls to the last in file order', () => {
    const a = mk({ date: '2026-11-01', reason: 'reviewed first, one machine' });
    const b = mk({ date: '2026-11-04', reason: 'reviewed last, another machine' });
    assert.equal(resolveOne([b, a]).reason, b.reason);
    assert.equal(resolveOne([a, b]).reason, b.reason);
    const sameDay = [mk({ reason: 'first on the day' }), mk({ reason: 'second on the day' })];
    assert.equal(resolveOne(sameDay).reason, 'second on the day');
    assert.equal(resolveOne([...sameDay].reverse()).reason, 'first on the day');
  });

  it('a key with no current link is decided by the newest date, then file order', () => {
    const older = mk({ date: '2026-11-01', reason: 'older review text' });
    const newer = mk({ date: '2026-11-03', reason: 'newer review text' });
    assert.equal(resolveOne([newer, older], { key: 'other', tier: 'babel@7' }).reason, 'newer review text');
  });

  it('a line recorded with a fingerprint algorithm this version cannot compute never beats a line that matches', () => {
    const future = mk({ code: 'dg2:sha256:' + 'a'.repeat(64), date: '2026-11-09', reason: 'future algorithm' });
    const valid = mk({ date: '2026-11-01', reason: 'dg1 review that matches' });
    assert.equal(resolveOne([future, valid]).reason, valid.reason);
  });
});

describe('SC-003: the result does not depend on line order, except where FR-002 lets order decide', () => {
  it('for random interleavings of two valid locks, the resolved entries are the same', () => {
    let seed = 20261113;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const keys = ['a', 'b', 'c', 'd', 'e'].map(k => `acme.billing#FR-00${k.charCodeAt(0) - 96}|src/${k}.mjs|*|file`);
    const sides = [0, 1].map(side => keys.map((key, i) => mk({
      key, file: key.split('|')[1],
      // Half the keys match the current content on side 0, half on side 1; dates are unique per line.
      code: (i + side) % 2 === 0 ? fp('1') : fp('9'), floor: (i + side) % 2 === 0 ? fp('2') : fp('8'),
      date: `2026-11-${String(10 + i * 2 + side).padStart(2, '0')}`, reason: `side ${side} reviewed ${key}`,
    })));
    const current = new Map(keys.map(key => [key, { key, tier: 'babel@7', exact: fp('1'), floor: fp('2'), req: fp('3') }]));
    const all = sides.flat();
    let expected = null;
    for (let round = 0; round < 40; round++) {
      const shuffled = [...all].sort(() => rand() - 0.5);
      const dir = makeTempDir('dg-anchor-merge-unit-');
      writeLock(dir, shuffled);
      const lock = readAnchorLock(dir);
      assert.equal(lock.error, null);
      const out = [...anchorsModule.resolveLockLinks(lock, current)].map(([k, e]) => [k, stableLine(e)]).sort();
      if (expected === null) expected = out; else assert.deepEqual(out, expected);
    }
    assert.equal(expected.length, keys.length);
  });
});

describe('US1/SC-001: two branches accept one link; union merge or rebase', () => {
  for (const how of ['merge', 'rebase']) {
    it(`${how}: the merged content matches one review for every link: no ANC finding`, () => {
      const dir = project();
      diverge(dir, { ...oneEdits, how });
      assert.ok(keyCounts(dir).size > 0 && [...keyCounts(dir).values()].some(n => n > 1), 'the union merge kept two lines for a key');
      assert.deepEqual(codes(dir), []);
    });

    it(`${how}: the merged content matches neither review for a link: that link is ANC001 with its accept command, never ANC009`, () => {
      const dir = project();
      diverge(dir, { ...bothEdit, how });
      const found = guardFindings(dir);
      assert.ok(!found.some(f => f.code === 'ANC009'), JSON.stringify(found));
      const stale = found.filter(f => f.code === 'ANC001');
      assert.equal(stale.length, 1, JSON.stringify(found));
      assert.match(stale[0].message, /FR-001/);
      assert.match(JSON.stringify(stale[0].suggestion), /anchors accept/);
      // FR-002 and FR-003 each match one branch's review: silent.
      assert.ok(!found.some(f => /FR-00[23]/.test(f.message)), JSON.stringify(found));
    });
  }

  it('after the merge, one accept of the stale link leaves one line per key and a clean guard', () => {
    const dir = project();
    diverge(dir, { ...bothEdit, how: 'merge' });
    accept(dir, 'read both edits together after the merge');
    assert.ok([...keyCounts(dir).values()].every(n => n === 1));
    assert.deepEqual(codes(dir), []);
  });
});

describe('FR-003/US2: every writer leaves one line per link and loses none', () => {
  function duplicated() {
    const dir = project({ union: false });
    const base = entriesOf(dir);
    const extra = base.map((e, i) => ({ ...e, reason: `reviewed again on another branch ${i}`, date: '2026-11-12' }));
    writeLock(dir, [...base, ...extra]);
    return { dir, base };
  }

  it('accept for one link keeps exactly one line for every other duplicated key', () => {
    const { dir, base } = duplicated();
    const target = base.find(e => e.requirement.endsWith('FR-002')).key;
    const r = run(dir, ['anchors', 'accept', '--link', target, '--reason', 'read it again after the merge']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const counts = keyCounts(dir);
    assert.equal(counts.size, base.length);
    assert.ok([...counts.values()].every(n => n === 1), JSON.stringify([...counts]));
    const keys = entriesOf(dir).map(e => e.key);
    assert.deepEqual(keys, [...keys].sort());
  });

  it('a second accept changes nothing, byte for byte', () => {
    const { dir, base } = duplicated();
    const args = ['anchors', 'accept', '--link', base[0].key, '--reason', 'read it again after the merge'];
    assert.equal(run(dir, args).status, 0);
    const once = lockText(dir);
    assert.equal(run(dir, args).status, 0);
    assert.equal(lockText(dir), once);
  });

  it('accept --remove and disposition also write the full resolved set', () => {
    const { dir, base } = duplicated();
    const r = run(dir, ['anchors', 'accept', '--remove', base[0].key, '--reason', 'implementation moved elsewhere']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const counts = keyCounts(dir);
    assert.equal(counts.size, base.length - 1);
    assert.ok([...counts.values()].every(n => n === 1));
  });

  it('a duplicated disposition resolves by the newest date', () => {
    const dir = project({ union: false });
    const d = (date, reason) => ({ key: 'disposition|src%2Fx.mjs|helper', file: 'src/x.mjs', anchor: 'helper', kind: 'dead', reason, date, revision: null, bulk: false });
    writeLock(dir, [...entriesOf(dir), d('2026-11-09', 'newer disposition text'), d('2026-11-02', 'older disposition text')]);
    const lock = readAnchorLock(dir);
    assert.equal(lock.error, null);
    assert.equal(lock.dispositions.get('disposition|src%2Fx.mjs|helper').reason, 'newer disposition text');
  });
});

describe('FR-004/FR-005/US3: docguard anchors merge', () => {
  function withDuplicates() {
    const dir = project();
    diverge(dir, { ...bothEdit, how: 'merge' });
    return dir;
  }

  it('--check exits 2 on a lock with duplicates and 0 once normalized; --write twice is byte-identical', () => {
    const dir = withDuplicates();
    const check = run(dir, ['anchors', 'merge', '--check']);
    assert.equal(check.status, 2, check.stdout + check.stderr);
    assert.match(check.stdout, /\d+ duplicate line/i);
    const w = run(dir, ['anchors', 'merge', '--write']);
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.ok([...keyCounts(dir).values()].every(n => n === 1));
    const once = lockText(dir);
    assert.equal(run(dir, ['anchors', 'merge', '--check']).status, 0);
    assert.equal(run(dir, ['anchors', 'merge', '--write']).status, 0);
    assert.equal(lockText(dir), once);
  });

  it('--write prints the lines it collapsed and each link that still needs review with its accept --file command', () => {
    const dir = withDuplicates();
    const w = JSON.parse(run(dir, ['anchors', 'merge', '--write', '--format', 'json']).stdout);
    assert.equal(w.status, 'WRITTEN');
    assert.ok(w.collapsed >= 3);
    assert.equal(w.needsReview.length, 1);
    assert.match(w.needsReview[0].requirement, /FR-001/);
    assert.match(w.needsReview[0].acceptCommand, /^docguard anchors accept --file src\/pricing\.mjs --reason /);
    const text = run(withDuplicates(), ['anchors', 'merge', '--write']).stdout;
    assert.match(text, /anchors accept --file src\/pricing\.mjs/);
  });

  it('neither flag, or both, is a usage error; a project with no lock is exit 0', () => {
    const dir = withDuplicates();
    assert.equal(run(dir, ['anchors', 'merge']).status, 1);
    assert.equal(run(dir, ['anchors', 'merge', '--check', '--write']).status, 1);
    const bare = makeTempDir('dg-anchor-merge-unit-');
    assert.equal(run(bare, ['anchors', 'merge', '--check']).status, 0);
  });

  for (const style of ['merge', 'diff3']) {
    it(`a lock with ${style} conflict markers: guard says ANC005 and names the command; --write resolves it`, () => {
      const dir = project({ union: false });
      const base = entriesOf(dir);
      const ours = base.map(e => ({ ...e, reason: 'ours reviewed this link', date: '2026-11-10' }));
      const theirs = base.map(e => ({ ...e, reason: 'theirs reviewed this link', date: '2026-11-11' }));
      const lines = [
        stableLine(LOCK_HEADER), '<<<<<<< HEAD', ...ours.map(stableLine),
        ...(style === 'diff3' ? ['||||||| base', ...base.map(stableLine)] : []),
        '=======', ...theirs.map(stableLine), '>>>>>>> a',
      ];
      writeFileSync(join(dir, ANCHOR_LOCK_PATH), `${lines.join('\n')}\n`);
      const found = guardFindings(dir);
      const err = found.find(f => f.code === 'ANC005');
      assert.ok(err, JSON.stringify(found));
      assert.match(JSON.stringify(err), /anchors merge --write/);
      const w = run(dir, ['anchors', 'merge', '--write']);
      assert.equal(w.status, 0, w.stdout + w.stderr);
      assert.ok(!/[<=>|]{7}/.test(lockText(dir)));
      assert.ok([...keyCounts(dir).values()].every(n => n === 1));
      assert.equal(keyCounts(dir).size, base.length);
      // The newer review (theirs, one day later, same fingerprints) stands.
      assert.ok(entriesOf(dir).every(e => e.reason === 'theirs reviewed this link'));
      assert.deepEqual(codes(dir), []);
    });
  }
});

describe('FR-006/FR-007: ANC009 is no longer reported; a note says duplicates were collapsed', () => {
  it('no duplicate produces ANC009, and the registry entry says so', () => {
    const dir = project();
    diverge(dir, { ...bothEdit, how: 'merge' });
    assert.ok(!codes(dir).includes('ANC009'));
    assert.match(CODES.ANC009.help, /no longer reported/i);
    const explain = run(dir, ['explain', 'ANC009']);
    assert.equal(explain.status, 0, explain.stderr + explain.stdout);
  });

  it('`anchors` notes the duplicate lines and the command that collapses them', () => {
    const dir = project();
    diverge(dir, { ...bothEdit, how: 'merge' });
    const out = JSON.parse(run(dir, ['anchors', '--format', 'json']).stdout);
    assert.ok(out.notes.some(n => /anchors merge --write/.test(n)), JSON.stringify(out.notes));
  });
});

describe('FR-008/SC-005: an older DocGuard reads what this one writes', () => {
  const TAG = 'v0.48.0';
  const tagExists = (() => { try { fixtureGit(ROOT, ['rev-parse', '--verify', '-q', `${TAG}^{commit}`]); return true; } catch { return false; } })();
  it('0.48.0 reads a lock written after a union merge was resolved, with the same links', { skip: tagExists ? false : `${TAG} is not in this clone (shallow checkout); CI fetches full history` }, () => {
    const old = makeTempDir('dg-anchor-merge-v048-');
    const tarball = join(old, '.tag.tar');
    fixtureGit(ROOT, ['archive', '-o', tarball, TAG]);
    assert.equal(spawnSync('tar', ['-x', '-f', tarball, '-C', old]).status, 0);
    rmSync(tarball, { force: true });
    // The old CLI parses at the same tier as this one only with the same parser installed.
    symlinkSync(join(ROOT, 'node_modules'), join(old, 'node_modules'), 'dir');
    const dir = project();
    diverge(dir, { ...oneEdits, how: 'merge' });
    assert.equal(run(dir, ['anchors', 'merge', '--write']).status, 0);
    const mine = JSON.parse(run(dir, ['anchors', '--format', 'json']).stdout);
    const theirs = JSON.parse(run(dir, ['anchors', '--format', 'json'], join(old, 'cli', 'docguard.mjs')).stdout);
    assert.equal(theirs.problems.some(p => p.code === 'ANC005' || p.code === 'ANC009'), false, JSON.stringify(theirs.problems));
    const states = r => r.links.map(l => `${l.key}=${l.state}`).sort();
    assert.deepEqual(states(theirs), states(mine));
  });
});
