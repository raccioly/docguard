/**
 * Guard's git cost does not grow with the number of specs.
 *
 * The budget job runs guard 12 times on this repository inside a 6-minute
 * bound. SPK010 once asked git three questions per spec, one of them a walk of
 * history, and SPR008 asked two per recorded revision, so a guard run cost
 * specs x history: 31 specs took 6 s, 93 specs took 22 s, and the job was
 * cancelled at its bound (spec 031 SC-002, amended 2026-11-13). These tests
 * pin the two properties that keep it linear: the same answers as the
 * per-spec questions, from a bounded number of git processes.
 *
 * @req docguard.non-regression-budgets#SC-002
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { createFeatureHistory, detectUntouchedClaims, detectSpecKit } from '../cli/scanners/speckit.mjs';
import { danglingRevisions } from '../cli/scanners/revision-anchor.mjs';
import { trackedAndCleanChecker, trackedAndCleanOne } from '../cli/scanners/spec-registry.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function makeTraceDir() {
  const d = makeTempDir('dg-gitcost-trace-');
  dirs.push(d);
  return d;
}

function makeRepo(sub = '') {
  const dir = makeTempDir('dg-gitcost-');
  dirs.push(dir);
  const git = (...a) => execFileSync('git', [...FIXTURE_GIT, ...a], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  const put = (p, body) => { mkdirSync(dirname(join(dir, sub, p)), { recursive: true }); writeFileSync(join(dir, sub, p), body); };
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');
  const commit = msg => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD').trim(); };
  return { dir, project: join(dir, sub), git, put, commit };
}

/** The per-feature answer, exactly as it was computed before the history was shared. */
function perFeatureReference(dir, specDirRel) {
  const run = args => { try { return execFileSync('git', [...FIXTURE_GIT, ...args], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }); } catch { return null; } };
  const adds = (run(['log', '--format=%H', '--diff-filter=A', '--', `:(literal)${specDirRel}`]) || '').split('\n').map(s => s.trim()).filter(Boolean);
  const first = adds[adds.length - 1];
  if (!first) return null;
  const touched = new Set();
  const names = run(['log', '--name-only', '--format=', `${first}^..HEAD`]) ?? run(['log', '--name-only', '--format=', 'HEAD']);
  for (const line of (names || '').split('\n')) if (line.trim()) touched.add(line.trim());
  for (const args of [['diff', '--name-only', 'HEAD'], ['ls-files', '--others', '--exclude-standard']]) {
    for (const line of (run(args) || '').split('\n')) if (line.trim()) touched.add(line.trim());
  }
  return touched;
}

const sorted = set => (set === null ? null : [...set].sort());

function countGitCommands(dir, fn) {
  const trace = join(makeTraceDir(), 'trace2.json');
  const previous = process.env.GIT_TRACE2_EVENT;
  process.env.GIT_TRACE2_EVENT = trace;
  try { fn(); } finally {
    if (previous === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = previous;
  }
  const counts = {};
  for (const line of readFileSync(trace, 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.event === 'cmd_name') counts[e.name] = (counts[e.name] || 0) + 1;
  }
  return counts;
}


describe('the shared feature history answers as the per-feature git questions did', () => {
  test('linear history, a merge, a file added later, and uncommitted work', () => {
    const { dir, git, put, commit } = makeRepo();
    put('README.md', '# r\n');
    commit('baseline');
    put('specs/001-alpha/spec.md', '# A\n'); put('specs/001-alpha/tasks.md', '# T\n');
    commit('spec alpha');

    // A side branch that adds a second spec and is merged with a merge commit.
    git('checkout', '-q', '-b', 'side');
    put('specs/002-beta/spec.md', '# B\n'); put('src/beta.js', 'b\n');
    commit('spec beta on a side branch');
    git('checkout', '-q', 'main');
    put('src/alpha.js', 'a\n');
    commit('alpha code');
    git('merge', '-q', '--no-ff', '-m', 'merge side', 'side');

    put('specs/003-gamma/spec.md', '# G\n');
    commit('spec gamma');
    put('specs/001-alpha/plan.md', '# P\n'); // added to an older spec later
    commit('alpha plan');
    git('mv', 'specs/003-gamma', 'specs/005-gamma'); // a spec directory moved wholesale
    commit('rename gamma');
    put('uncommitted.txt', 'u\n'); // untracked, and a tracked edit below
    put('README.md', '# r changed\n');

    const history = createFeatureHistory(dir);
    for (const spec of ['specs/001-alpha', 'specs/002-beta', 'specs/003-gamma', 'specs/005-gamma', 'specs/004-never-committed']) {
      assert.deepEqual(sorted(history.touchedPaths(spec)), sorted(perFeatureReference(dir, spec)), spec);
    }
  });

  test('a project directory below the repository root answers as the per-feature questions did', () => {
    const { dir, project, git, put, commit } = makeRepo('packages/app');
    put('README.md', '# r\n');
    commit('baseline');
    put('specs/001-alpha/spec.md', '# A\n');
    commit('spec alpha');
    put('src/a.js', 'a\n');
    commit('code');
    const history = createFeatureHistory(project);
    assert.deepEqual(sorted(history.touchedPaths('specs/001-alpha')), sorted(perFeatureReference(project, 'specs/001-alpha')));
    assert.notEqual(history.touchedPaths('specs/001-alpha'), null);
    void dir; void git;
  });

  test('a repository that is not a git repository answers null', () => {
    const dir = makeTempDir('dg-gitcost-nogit-');
    dirs.push(dir);
    assert.equal(createFeatureHistory(dir).touchedPaths('specs/001-x'), null);
  });
});

describe('git process count is bounded, not per spec', () => {
  test('SPK010 reads history with two git log calls whatever the number of specs', () => {
    const { dir, put, commit } = makeRepo();
    put('README.md', '# r\n');
    commit('baseline');
    for (let i = 1; i <= 12; i++) {
      const id = String(i).padStart(3, '0');
      put(`specs/${id}-s/spec.md`, `# Feature Specification: S${i}\n\n**Status**: Active\n`);
      put(`specs/${id}-s/tasks.md`, `# Tasks\n\n- [x] T001 Update \`README.md\`.\n`);
      commit(`spec ${id}`);
    }
    let results;
    const counts = countGitCommands(dir, () => { results = detectUntouchedClaims(dir, detectSpecKit(dir).specs); });
    assert.equal(results.length, 12, 'every spec with checked tasks is evaluated');
    assert.ok((counts.log || 0) <= 2, `git log ran ${counts.log} times for 12 specs`);
    assert.ok((counts.diff || 0) <= 1 && (counts['ls-files'] || 0) <= 2, `working-tree reads: ${JSON.stringify(counts)}`);
  });

  test('SPR008 asks git once per distinct recorded revision, not once per spec naming it', () => {
    const { dir, put, commit } = makeRepo();
    put('README.md', '# r\n');
    const sha = commit('baseline');
    const registry = { specs: Array.from({ length: 10 }, (_, i) => ({ specId: `s.${i}`, reviewed: { reconciliation: { lastReviewedRevision: sha } } })) };
    let dangling;
    const counts = countGitCommands(dir, () => { dangling = danglingRevisions(dir, registry); });
    assert.deepEqual(dangling, []);
    assert.equal(counts['cat-file'], 1);
    assert.equal(counts['merge-base'], 1);

    const missing = '0123456789abcdef0123456789abcdef01234567';
    const stale = { specs: [{ specId: 'a', reviewed: { reconciliation: { lastReviewedRevision: missing } } }, { specId: 'b', reviewed: { reconciliation: { lastReviewedRevision: missing } } }] };
    assert.deepEqual(danglingRevisions(dir, stale).map(d => [d.specId, d.reason]), [['a', 'missing'], ['b', 'missing']]);
  });
});

describe('SPR008 over many recorded revisions', () => {
  test('one cat-file and one rev-list answer what two processes per revision answered', () => {
    const { dir, git, put, commit } = makeRepo();
    put('README.md', '# r\n');
    const onHistory = commit('baseline');
    git('checkout', '-q', '-b', 'side');
    put('side.txt', 's\n');
    const offHistory = commit('side only');
    git('checkout', '-q', 'main');
    put('more.txt', 'm\n');
    const head = commit('more');
    git('tag', '-a', '-m', 'annotated', 'v1', onHistory);
    const tagObject = git('rev-parse', 'v1').trim();
    const missing = '0123456789abcdef0123456789abcdef01234567';
    const revisions = [onHistory, head, offHistory, missing, tagObject, 'main', 'not a revision'];
    const registry = { specs: revisions.map((revision, i) => ({ specId: `s.${i}`, reviewed: { reconciliation: { lastReviewedRevision: revision } } })) };

    const reference = revisions.flatMap((revision, i) => danglingRevisions(dir, { specs: [registry.specs[i]] }));
    let batched;
    const counts = countGitCommands(dir, () => { batched = danglingRevisions(dir, registry); });
    assert.deepEqual(batched, reference);
    assert.deepEqual(batched.map(d => [d.revision === offHistory ? 'off' : d.revision === missing ? 'missing' : d.revision, d.reason]),
      [['off', 'not-ancestor'], ['missing', 'missing'], ['main', 'missing'], ['not a revision', 'missing']]); // only a full commit id is a recorded revision
    assert.equal(counts['cat-file'], 1);
    assert.equal(counts['rev-list'], 1);
    assert.equal(counts['merge-base'], undefined);
  });
});

describe('the batched tracked-and-clean answer equals the per-path one', () => {
  test('a project directory below the repository root', () => {
    const { project, git, put, commit } = makeRepo('packages/app');
    for (const p of ['specs/a/spec.md', 'specs/b/spec.md', 'specs/c/spec.md']) put(p, '# s\n');
    put('.docguard/spec-registry.json', '{}\n');
    commit('baseline');
    put('specs/b/spec.md', '# edited\n');
    put('specs/c/spec.md', '# staged\n'); git('add', 'packages/app/specs/c/spec.md');
    put('.docguard/spec-registry.json', '{"x":1}\n');
    const check = trackedAndCleanChecker(project);
    for (const p of ['specs/a/spec.md', 'specs/b/spec.md', 'specs/c/spec.md', '.docguard/spec-registry.json', 'specs/none.md']) {
      assert.equal(check(p), trackedAndCleanOne(project, p), p);
    }
    assert.equal(check('specs/b/spec.md'), false);
    assert.equal(check('.docguard/spec-registry.json'), false);
    assert.equal(check('specs/a/spec.md'), true);
  });

  test('clean, modified, staged, deleted, untracked, ignored, nested and pathspec-looking paths', () => {
    const { dir, git, put, commit } = makeRepo();
    for (const p of ['specs/a/spec.md', 'specs/b/spec.md', 'specs/c/spec.md', 'specs/d/spec.md', 'specs/e f/spec.md', 'specs/g*/spec.md']) put(p, '# s\n');
    put('.gitignore', 'ignored.md\n');
    commit('baseline');
    put('specs/b/spec.md', '# edited, unstaged\n');
    put('specs/c/spec.md', '# edited, staged\n'); git('add', 'specs/c/spec.md');
    rmSync(join(dir, 'specs/d/spec.md'));
    put('specs/untracked.md', 'u\n');
    put('ignored.md', 'i\n');
    const check = trackedAndCleanChecker(dir);
    const paths = ['specs/a/spec.md', 'specs/b/spec.md', 'specs/c/spec.md', 'specs/d/spec.md', 'specs/e f/spec.md', 'specs/g*/spec.md',
      'specs/untracked.md', 'ignored.md', 'specs/missing.md', './specs/a/spec.md', 'specs/a', 'specs/a/../b/spec.md'];
    for (const p of paths) assert.equal(check(p), trackedAndCleanOne(dir, p), p);
    assert.equal(check('specs/a/spec.md'), true);
    assert.equal(check('specs/b/spec.md'), false);
    assert.equal(check('specs/c/spec.md'), false);
    assert.equal(check('specs/d/spec.md'), false);
  });

  test('reads the index and the changed paths once, not once per path', () => {
    const { dir, put, commit } = makeRepo();
    const paths = Array.from({ length: 15 }, (_, i) => `specs/${i}/spec.md`);
    for (const p of paths) put(p, '# s\n');
    commit('baseline');
    const trace = join(makeTraceDir(), 'trace2.json');
    const previous = process.env.GIT_TRACE2_EVENT;
    process.env.GIT_TRACE2_EVENT = trace;
    try { const check = trackedAndCleanChecker(dir); for (const p of paths) assert.equal(check(p), true); } finally {
      if (previous === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = previous;
    }
    const started = readFileSync(trace, 'utf8').split('\n').filter(l => l.includes('"event":"cmd_name"')).length;
    assert.ok(started <= 3, `${started} git processes for ${paths.length} paths`);
  });
});
