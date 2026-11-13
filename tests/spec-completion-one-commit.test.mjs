/**
 * Close a spec in one commit (specs/101-completion-one-commit).
 *
 * An adopter whose gate runs `docguard guard` on every commit, and fails on
 * warnings, could not close a spec: the task tick had to be committed before
 * `specs complete` would run (DLC002 on that commit), `canonicalDocs` and
 * `persistenceModel` were hand edits, and the recorded commit id did not survive
 * a squash merge or a rebase (SPR008). Every fixture here is a real repository
 * and every command is the real CLI.
 *
 * The 0.48.0 tests build a `git archive` of the tag in a scratch directory and
 * run its CLI as a subprocess; they skip, with a reason, when the tag is not in
 * the clone (a shallow checkout). CI checks out with `fetch-depth: 0`.
 *
 * @req docguard.completion-one-commit#FR-001
 * @req docguard.completion-one-commit#FR-002
 * @req docguard.completion-one-commit#FR-003
 * @req docguard.completion-one-commit#FR-004
 * @req docguard.completion-one-commit#FR-005
 * @req docguard.completion-one-commit#FR-006
 * @req docguard.completion-one-commit#FR-007
 * @req docguard.completion-one-commit#FR-008
 * @req docguard.completion-one-commit#FR-009
 * @req docguard.completion-one-commit#FR-010
 * @req docguard.completion-one-commit#FR-011
 * @req docguard.completion-one-commit#FR-012
 * @req docguard.completion-one-commit#FR-013
 * @req docguard.completion-one-commit#SC-001
 * @req docguard.completion-one-commit#SC-002
 * @req docguard.completion-one-commit#SC-003
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_GIT, fixtureGit } from './helpers/git.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const REGISTRY = '.docguard-specs.json';
const FAMILY = /^(DLC|SPC|SPR)/;

const git = (dir, args) => fixtureGit(dir, args).trim();
const put = (dir, path, content) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const cliAt = (cli, dir, args) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--dir', dir], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const run = (dir, args) => cliAt(CLI, dir, args);
const json = r => JSON.parse(r.out);
const registry = dir => JSON.parse(read(dir, REGISTRY));
const entry = (dir, id = 'acme.alpha') => registry(dir).specs.find(s => s.specId === id);
const guardFindings = (dir, cli = CLI) => json(cliAt(cli, dir, ['guard', '--format', 'json'])).findings;
const family = (dir, cli = CLI) => guardFindings(dir, cli).filter(f => FAMILY.test(f.code));
const codes = findings => findings.map(f => f.code).sort();
const isAncestor = (dir, sha) => spawnSync('git', [...FIXTURE_GIT, 'merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: dir }).status === 0;

/** A project whose gate runs guard on every commit: strict, one spec with T2 open, no hand-edited registry. */
function adopter(t, { second = false } = {}) {
  const dir = makeTempDir('dg-one-commit-', t);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  put(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter', enforcement: 'strict' }));
  put(dir, 'README.md', '# Fixture\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'scaffold']);
  put(dir, 'AGENTS.md', '# Agents\n');
  put(dir, 'CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n');
  put(dir, 'DRIFT-LOG.md', '# Drift\n');
  put(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  put(dir, 'specs/001-alpha/spec.md', '# Alpha\n\n**Spec ID**: `acme.alpha`\n\n- **FR-001**: alpha MUST work.\n');
  put(dir, 'specs/001-alpha/tasks.md', '# Tasks\n\n- [x] T1 Build.\n- [ ] T2 Verify.\n');
  put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 1;\n');
  put(dir, 'tests/alpha.test.js', '/** @req acme.alpha#FR-001 */\ntest("alpha", () => {});\n');
  if (second) {
    put(dir, 'specs/002-beta/spec.md', '# Beta\n\n**Spec ID**: `acme.beta`\n\n- **FR-001**: beta MUST work.\n');
    put(dir, 'specs/002-beta/tasks.md', '# Tasks\n\n- [ ] T1 Build.\n- [ ] T2 Verify.\n');
  }
  git(dir, ['add', '-A']);
  assert.equal(run(dir, ['specs', '--write']).status, 0);
  const approve = run(dir, ['specs', 'approve', '--id', 'acme.alpha', '--delivery', 'in_progress', '--persistence', 'living',
    '--canonical-doc', 'docs-canonical/ARCHITECTURE.md', '--write', '--format', 'json']);
  assert.equal(json(approve).status, 'APPROVED', approve.out + approve.err);
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'add alpha, approved in progress']);
  return dir;
}

const tick = dir => put(dir, 'specs/001-alpha/tasks.md', read(dir, 'specs/001-alpha/tasks.md').replace('- [ ] T2', '- [x] T2'));

/** The closing step of the one-commit flow, up to but not including the commit. */
function closeSpec(dir, extra = []) {
  tick(dir);
  assert.equal(run(dir, ['specs', '--write']).status, 0);
  return run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'Reviewed in the fixture', '--write', '--format', 'json', ...extra]);
}

/** Work on a PR branch, close the spec there in one commit, return the directory. */
function closedOnBranch(t, { afterClose = null } = {}) {
  const dir = adopter(t);
  git(dir, ['checkout', '-q', '-b', 'pr']);
  put(dir, 'NOTES.md', '# Notes\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
  const closed = closeSpec(dir);
  assert.equal(json(closed).status, 'VERIFIED', closed.out + closed.err);
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'close alpha']);
  if (afterClose) afterClose(dir);
  return dir;
}
const squashOntoMain = (dir, message = 'squash: alpha') => {
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '--squash', '-q', 'pr']);
  git(dir, ['commit', '-qm', message]);
};

describe('US1: one commit closes a spec, and every commit passes the gate (FR-001, SC-001)', () => {
  let dir;
  before(t => {
    dir = adopter(t);
    const closed = closeSpec(dir);
    assert.equal(json(closed).status, 'VERIFIED', closed.out + closed.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'close alpha']);
  });

  it('the tick, the record and the outcome land together with no hand edit of the registry', () => {
    const rec = entry(dir).reviewed;
    assert.equal(rec.lifecycle.delivery, 'verified');
    assert.equal(rec.lifecycle.persistenceModel, 'living');
    assert.deepEqual(rec.scope.canonicalDocs, ['docs-canonical/ARCHITECTURE.md']);
    assert.equal(rec.reconciliation.outcomes.length, 1);
    assert.match(read(dir, 'specs/001-alpha/spec.md'), /Implementation Outcomes/);
    assert.match(read(dir, 'specs/001-alpha/tasks.md'), /- \[x\] T2/);
    assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), '3', 'scaffold, approval, and exactly one closing commit');
    assert.equal(git(dir, ['status', '--porcelain']), '');
  });

  it('guard reports no DLC, SPC or SPR finding at the closing commit', () => {
    assert.deepEqual(codes(family(dir)), []);
  });

  it('guard reports none at any earlier commit either (a per-commit gate)', t => {
    const clone = makeTempDir('dg-one-commit-gate-', t);
    git(clone, ['clone', '-q', '--no-hardlinks', dir, '.']);
    const seen = [];
    for (const sha of git(dir, ['rev-list', '--reverse', 'HEAD']).split('\n')) {
      git(clone, ['checkout', '-q', sha]);
      seen.push([sha.slice(0, 7), codes(family(clone))]);
    }
    assert.equal(seen.length, 3);
    assert.deepEqual(seen.filter(([, found]) => found.length), []);
  });
});

describe('US1: what still blocks (FR-001)', () => {
  it('a tick plus another content change in the same tasks.md still blocks', t => {
    const dir = adopter(t);
    tick(dir);
    put(dir, 'specs/001-alpha/tasks.md', `${read(dir, 'specs/001-alpha/tasks.md')}- [ ] T3 One more.\n`);
    run(dir, ['specs', '--write']);
    const r = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--format', 'json']);
    assert.ok(json(r).blockers.some(b => b.code === 'SPC001' && /specs\/001-alpha\/tasks\.md/.test(b.message)), r.out);
  });

  it('a tick in a different spec\'s tasks.md still blocks', t => {
    const dir = adopter(t, { second: true });
    put(dir, 'specs/002-beta/tasks.md', read(dir, 'specs/002-beta/tasks.md').replace('- [ ] T1', '- [x] T1'));
    tick(dir);
    run(dir, ['specs', '--write']);
    const r = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--format', 'json']);
    const blocker = json(r).blockers.find(b => b.code === 'SPC001');
    assert.match(blocker?.message || '', /specs\/002-beta\/tasks\.md/, r.out);
    assert.doesNotMatch(blocker.message, /specs\/001-alpha\/tasks\.md/);
  });
});

describe('US2: flags replace the hand edits (FR-002, FR-003, FR-004)', () => {
  it('approve --persistence and --canonical-doc change the registry, and are not reported as unchanged', t => {
    const dir = adopter(t);
    const r = run(dir, ['specs', 'approve', '--id', 'acme.alpha', '--persistence', 'flow_forward', '--canonical-doc', 'README.md', '--write', '--format', 'json']);
    assert.equal(json(r).status, 'APPROVED', r.out);
    assert.equal(entry(dir).reviewed.lifecycle.persistenceModel, 'flow_forward');
    assert.deepEqual(entry(dir).reviewed.scope.canonicalDocs, ['README.md']);
  });

  it('--canonical-doc is repeatable, sorted, deduplicated and replaces the list', t => {
    const dir = adopter(t);
    const r = run(dir, ['specs', 'approve', '--id', 'acme.alpha', '--canonical-doc', 'README.md', '--canonical-doc', 'docs-canonical/ARCHITECTURE.md', '--canonical-doc', 'README.md', '--write', '--format', 'json']);
    assert.equal(json(r).status, 'APPROVED', r.out);
    assert.deepEqual(entry(dir).reviewed.scope.canonicalDocs, ['docs-canonical/ARCHITECTURE.md', 'README.md']);
    run(dir, ['specs', 'approve', '--id', 'acme.alpha', '--canonical-doc', 'AGENTS.md', '--write']);
    assert.deepEqual(entry(dir).reviewed.scope.canonicalDocs, ['AGENTS.md']);
  });

  it('a missing --canonical-doc path is refused and writes nothing', t => {
    const dir = adopter(t);
    const before = read(dir, REGISTRY);
    for (const command of ['approve', 'complete']) {
      const r = run(dir, ['specs', command, '--id', 'acme.alpha', '--canonical-doc', 'docs-canonical/NOPE.md', '--reason', 'x', '--since', 'HEAD~1', '--write', '--format', 'json']);
      assert.equal(r.status, 2, `${command}: ${r.out}${r.err}`);
      assert.match(r.out, /docs-canonical\/NOPE\.md/);
    }
    assert.equal(read(dir, REGISTRY), before);
  });

  it('an unsafe --canonical-doc path is refused', t => {
    const dir = adopter(t);
    const r = run(dir, ['specs', 'approve', '--id', 'acme.alpha', '--canonical-doc', '../outside.md', '--write', '--format', 'json']);
    assert.equal(r.status, 2, r.out);
  });

  it('--persistence with a value outside the schema is refused and writes nothing', t => {
    const dir = adopter(t);
    const before = read(dir, REGISTRY);
    for (const command of ['approve', 'complete']) {
      const r = run(dir, ['specs', command, '--id', 'acme.alpha', '--persistence', 'forever', '--reason', 'x', '--since', 'HEAD~1', '--write', '--format', 'json']);
      assert.equal(r.status, 2, `${command}: ${r.out}${r.err}`);
      assert.match(r.out, /flow_back/);
    }
    assert.equal(read(dir, REGISTRY), before);
  });

  it('SPC005 names the flag instead of telling people to edit the file', t => {
    const dir = adopter(t);
    const reg = registry(dir);
    reg.specs[0].reviewed.scope.canonicalDocs = [];
    put(dir, REGISTRY, `${JSON.stringify(reg, null, 2)}\n`);
    const r = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--format', 'json']);
    const blocker = json(r).blockers.find(b => b.code === 'SPC005');
    assert.match(blocker?.message || '', /--canonical-doc/, r.out);
  });

  it('a dry run applies the flags in memory and writes nothing', t => {
    const dir = adopter(t);
    const reg = registry(dir);
    reg.specs[0].reviewed.scope.canonicalDocs = [];
    put(dir, REGISTRY, `${JSON.stringify(reg, null, 2)}\n`);
    git(dir, ['commit', '-qam', 'simulate an unset list']);
    tick(dir);
    run(dir, ['specs', '--write']);
    const before = read(dir, REGISTRY);
    const r = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--canonical-doc', 'README.md', '--format', 'json']);
    assert.equal(json(r).status, 'READY', r.out);
    assert.equal(read(dir, REGISTRY), before);
  });

  it('--help and docs/commands.md describe both flags', () => {
    const help = spawnSync(process.execPath, [CLI, 'specs', '--help'], { encoding: 'utf8', env: ENV }).stdout;
    for (const text of [help, readFileSync(join(ROOT, 'docs/commands.md'), 'utf8')]) {
      assert.match(text, /--canonical-doc/);
      assert.match(text, /--persistence/);
    }
  });
});

describe('US3: the record survives a squash merge and a rebase (FR-005, FR-006, FR-007, SC-002)', () => {
  it('the outcome records the evidence blob of every evidence file, and the registry keeps its shape', t => {
    const dir = closedOnBranch(t);
    const line = read(dir, 'specs/001-alpha/spec.md').split('\n').find(l => l.startsWith('- `'));
    for (const path of ['src/alpha.js', 'tests/alpha.test.js', 'docs-canonical/ARCHITECTURE.md']) {
      const blob = git(dir, ['rev-parse', `HEAD~1:${path}`]);
      assert.ok(line.includes(`\`${path}\`=\`${blob}\``), `${path} blob in: ${line}`);
    }
    const outcome = entry(dir).reviewed.reconciliation.outcomes[0];
    assert.deepEqual(Object.keys(outcome).sort(), ['deviations', 'evidence', 'reason', 'revision', 'successor']);
  });

  it('on the branch the revision is an ancestor, and SPR008 is silent', t => {
    const dir = closedOnBranch(t);
    assert.deepEqual(family(dir).filter(f => f.code === 'SPR008'), []);
  });

  it('after a squash merge SPR008 is silent and no reanchor is needed', t => {
    const dir = closedOnBranch(t);
    const reviewed = entry(dir).reviewed.reconciliation.lastReviewedRevision;
    squashOntoMain(dir);
    assert.equal(isAncestor(dir, reviewed), false, 'the reviewed revision is not on main');
    assert.deepEqual(codes(family(dir)), []);
    assert.equal(json(run(dir, ['specs', 'reanchor', '--id', 'acme.alpha', '--format', 'json'])).status, 'CURRENT');
  });

  it('after a rebase onto a moved base (same evidence, new ids) SPR008 is silent', t => {
    const dir = closedOnBranch(t);
    git(dir, ['checkout', '-q', 'main']);
    put(dir, 'README.md', '# Fixture, moved on\n');
    git(dir, ['commit', '-qam', 'main moved on']);
    git(dir, ['checkout', '-q', 'pr']);
    git(dir, ['rebase', '-q', 'main']);
    const reviewed = entry(dir).reviewed.reconciliation.lastReviewedRevision;
    assert.equal(isAncestor(dir, reviewed), false);
    assert.deepEqual(codes(family(dir)), []);
  });

  it('the next completion finds its diff base with no --since, after the record moved ids', t => {
    const dir = closedOnBranch(t);
    squashOntoMain(dir);
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
    git(dir, ['commit', '-qam', 'a later change to the implementation']);
    const r = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--reason', 'Maintenance review', '--write', '--format', 'json']);
    assert.equal(json(r).status, 'VERIFIED', r.out + r.err);
    assert.equal(entry(dir).reviewed.reconciliation.outcomes.length, 2);
  });

  it('a later legitimate edit of an evidence file on main does not raise SPR008', t => {
    const dir = closedOnBranch(t);
    squashOntoMain(dir);
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 3;\n');
    git(dir, ['commit', '-qam', 'edit evidence after landing']);
    assert.deepEqual(family(dir).filter(f => f.code === 'SPR008'), []);
  });

  it('when evidence changed between review and landing, SPR008 fires and names the files', t => {
    const dir = closedOnBranch(t, {
      afterClose: d => {
        put(d, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 99;\n');
        git(d, ['commit', '-qam', 'the PR kept changing']);
      },
    });
    squashOntoMain(dir);
    const spr008 = family(dir).filter(f => f.code === 'SPR008');
    assert.ok(spr008.length >= 1, JSON.stringify(codes(family(dir))));
    assert.match(spr008[0].message, /src\/alpha\.js/);
    assert.doesNotMatch(spr008[0].message, /tests\/alpha\.test\.js/);
  });

  it('the search result is cached under .docguard/ and a broken cache changes no verdict', t => {
    const dir = closedOnBranch(t);
    squashOntoMain(dir);
    assert.deepEqual(codes(family(dir)), []);
    const cache = join(dir, '.docguard', 'revision-anchors.json');
    assert.ok(existsSync(cache), 'cache written');
    writeFileSync(cache, '{ not json');
    assert.deepEqual(codes(family(dir)), []);
    rmSync(join(dir, '.docguard'), { recursive: true, force: true });
    assert.deepEqual(codes(family(dir)), []);
  });

  it('the squash warning no longer tells people to reanchor a record that carries its evidence blobs (FR-012)', t => {
    const dir = adopter(t);
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    git(dir, ['checkout', '-q', '-b', 'pr']);
    put(dir, 'NOTES.md', '# Notes\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'work']);
    const closed = json(closeSpec(dir));
    assert.equal(closed.status, 'VERIFIED');
    const warning = (closed.warnings || []).join('\n');
    assert.match(warning, /evidence blobs/i);
    assert.doesNotMatch(warning, /specs reanchor/);
  });
});

describe('US3: records without blob ids behave as before (FR-008)', () => {
  /** A squash-landed record as 0.48.0 wrote it: the Blobs segment removed from the outcome line. */
  function oldRecord(t) {
    const dir = closedOnBranch(t);
    const path = join(dir, 'specs/001-alpha/spec.md');
    const stripped = readFileSync(path, 'utf8').split('\n').map(l => (l.startsWith('- `') ? l.replace(/ Blobs: .*$/, '') : l)).join('\n');
    writeFileSync(path, stripped);
    run(dir, ['specs', '--write']);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'the record as 0.48.0 wrote it']);
    squashOntoMain(dir);
    return dir;
  }

  it('SPR008 fires on a dangling revision, as today', t => {
    const dir = oldRecord(t);
    const found = family(dir).filter(f => f.code === 'SPR008');
    assert.ok(found.length >= 1);
    assert.match(found[0].message, /is not on this branch's history/);
  });

  it('reanchor moves it, clears SPR008, and backfills the evidence blobs', t => {
    const dir = oldRecord(t);
    const r = run(dir, ['specs', 'reanchor', '--id', 'acme.alpha', '--write', '--format', 'json']);
    assert.equal(json(r).status, 'REANCHORED', r.out + r.err);
    assert.deepEqual(family(dir).filter(f => f.code === 'SPR008'), []);
    const line = read(dir, 'specs/001-alpha/spec.md').split('\n').find(l => l.startsWith('- `'));
    assert.match(line, / Blobs: .*`src\/alpha\.js`=`[0-9a-f]{40}`/);
    assert.equal(entry(dir).reviewed.reconciliation.outcomes[0].reanchoredFrom.method, 'blob-equal');
  });
});

describe('US4: a hand-set verified state with no outcome is reported (FR-011)', () => {
  function handSet(t) {
    const dir = adopter(t);
    const reg = registry(dir);
    reg.specs[0].reviewed.lifecycle.delivery = 'verified';
    put(dir, REGISTRY, `${JSON.stringify(reg, null, 2)}\n`);
    git(dir, ['commit', '-qam', 'hand-set verified']);
    return dir;
  }

  it('guard reports SPR010 for it', t => {
    const dir = handSet(t);
    const found = family(dir).filter(f => f.code === 'SPR010');
    assert.equal(found.length, 1, JSON.stringify(codes(family(dir))));
    assert.match(found[0].message, /acme\.alpha/);
    assert.match(found[0].message, /no recorded outcome/);
  });

  it('specs --check lists it in text and in JSON', t => {
    const dir = handSet(t);
    const text = run(dir, ['specs', '--check']);
    assert.match(text.out, /acme\.alpha[^\n]*no recorded outcome|no recorded outcome[^\n]*acme\.alpha/);
    assert.deepEqual(json(run(dir, ['specs', '--check', '--format', 'json'])).unrecordedCompletions, ['acme.alpha']);
  });

  it('a completed spec, and a spec that is not verified, are not reported', t => {
    const dir = adopter(t);
    assert.deepEqual(family(dir).filter(f => f.code === 'SPR010'), []);
    assert.deepEqual(json(run(dir, ['specs', '--check', '--format', 'json'])).unrecordedCompletions, []);
    const closed = closedOnBranch(t);
    assert.deepEqual(family(closed).filter(f => f.code === 'SPR010'), []);
  });

  it('SPR010 is a registered finding code with an explanation', () => {
    const r = spawnSync(process.execPath, [CLI, 'explain', 'SPR010'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /outcome/i);
  });
});

describe('US5: 0.48.0 and this version read each other\'s registry (FR-010)', () => {
  const tagExists = spawnSync('git', [...FIXTURE_GIT, 'rev-parse', '--verify', '--quiet', 'v0.48.0^{commit}'], { cwd: ROOT }).status === 0;
  const skip = tagExists ? false : 'v0.48.0 is not in this clone (shallow checkout); CI fetches full history';
  let V048 = null;
  const old = () => {
    if (V048) return V048;
    const dir = makeTempDir('dg-v048-');
    const tarball = join(dir, '.tag.tar');
    fixtureGit(ROOT, ['archive', '-o', tarball, 'v0.48.0']);
    assert.equal(spawnSync('tar', ['-x', '-f', tarball, '-C', dir]).status, 0);
    rmSync(tarball, { force: true });
    V048 = join(dir, 'cli', 'docguard.mjs');
    return V048;
  };

  it('a registry written by this version loads in 0.48.0 with no registry error', { skip }, t => {
    const dir = adopter(t);
    const closed = closeSpec(dir);
    assert.equal(json(closed).status, 'VERIFIED', closed.out + closed.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'close alpha']);
    const r = cliAt(old(), dir, ['guard', '--format', 'json']);
    assert.doesNotMatch(r.err, /Error parsing|schema/i);
    // The finding set of 0.48.0 on the completed repository has no registry or completion finding.
    assert.deepEqual(codes(json(r).findings.filter(f => FAMILY.test(f.code))), []);
    assert.equal(cliAt(old(), dir, ['specs', '--check']).status, 0);
    // 0.48.0 completing again keeps this version's Blobs segment byte for byte.
    const blobs = read(dir, 'specs/001-alpha/spec.md').split('\n').find(l => l.startsWith('- `')).match(/ Blobs: .*$/)[0];
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 5;\n');
    git(dir, ['commit', '-qam', 'later change']);
    const second = cliAt(old(), dir, ['specs', 'complete', '--id', 'acme.alpha', '--reason', 'second', '--write', '--format', 'json']);
    assert.equal(json(second).status, 'VERIFIED', second.out + second.err);
    assert.ok(read(dir, 'specs/001-alpha/spec.md').includes(blobs), 'the earlier line is kept verbatim');
  });

  it('a registry written by 0.48.0 loads unchanged in this version', { skip }, t => {
    const dir = adopter(t);
    tick(dir);
    assert.equal(cliAt(old(), dir, ['specs', '--write']).status, 0);
    // 0.48.0 refuses the uncommitted tick (SPC001): it needs the two-commit flow this change removes.
    const blocked = cliAt(old(), dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'old', '--write', '--format', 'json']);
    assert.equal(json(blocked).status, 'BLOCKED');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'tick']);
    const second = cliAt(old(), dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~2', '--reason', 'old', '--write', '--format', 'json']);
    assert.equal(json(second).status, 'VERIFIED', second.out + second.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'record']);
    assert.deepEqual(codes(family(dir)), []);
    assert.equal(run(dir, ['specs', '--check']).status, 0);
    assert.ok(!/ Blobs: /.test(read(dir, 'specs/001-alpha/spec.md')), 'the 0.48.0 record carries none');
  });
});

describe('this repository follows its own one-commit flow (FR-013, SC-003)', () => {
  const text = path => readFileSync(join(ROOT, path), 'utf8');

  it('AGENTS.md, CONTRIBUTING.md and the guides describe the one-commit flow with the flags', () => {
    for (const path of ['AGENTS.md', 'CONTRIBUTING.md', 'docs-canonical/CI-RECIPES.md', 'docs/guides/spec-kit.md']) {
      assert.match(text(path), /--canonical-doc/, path);
    }
    for (const path of ['AGENTS.md', 'CONTRIBUTING.md']) assert.match(text(path), /one\s+commit/i, path);
  });

  it('no workflow text still tells people to edit canonicalDocs by hand', () => {
    for (const path of ['AGENTS.md', 'CONTRIBUTING.md', 'docs/guides/spec-kit.md', 'docs-canonical/CI-RECIPES.md']) {
      assert.doesNotMatch(text(path), /List the updated docs in `reviewed\.scope\.canonicalDocs`/, path);
    }
  });

  it('spec 101 itself, once verified, records the evidence blobs on its outcome line', () => {
    const reg = JSON.parse(text(REGISTRY));
    const own = reg.specs.find(s => s.specId === 'docguard.completion-one-commit');
    assert.ok(own, 'registered');
    if (own.reviewed.lifecycle.delivery !== 'verified') return;
    assert.equal(own.reviewed.lifecycle.persistenceModel, 'living');
    assert.ok(own.reviewed.reconciliation.outcomes.length >= 1);
    assert.match(text(own.path).split('\n').find(l => l.startsWith('- `')) || '', / Blobs: `/);
  });
});
