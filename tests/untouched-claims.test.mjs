/**
 * A checked task that names an existing file the feature never changed.
 *
 * The phantom check (SPK008) asks whether a checked task's deliverable EXISTS.
 * That leaves a hole: a task naming files which already existed satisfies it
 * immediately, whether or not the work happened. This is how, in this
 * repository, a documentation task listed six contract files, was marked [x],
 * and shipped with one of them — a SKILL.md — unmodified, still telling agents
 * to auto-fix findings a human was supposed to judge.
 *
 * SPK010 asks the other question: did this feature's history ever touch it?
 *
 * The git answer is exact, so these are high-confidence. They are ESCALATIONS
 * rather than verdicts, because "untouched" has honest explanations — a task
 * may name a file as context, invoke it rather than change it, or the work may
 * have landed under a different path. DocGuard reports what git knows and
 * leaves the conclusion to the reader.
 *
 * @req FR-021
 * @req docguard.calibrated-finding-channels#FR-021
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectUntouchedClaims, featureTouchedPaths, detectSpecKit } from '../cli/scanners/speckit.mjs';

const dirs = [];

/** A git repo whose spec was committed, then code landed in later commits. */
function repo({ tasks, alsoCommit = {}, andThen = {}, commitSpec = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-untouched-'));
  dirs.push(dir);
  const put = (p, body) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  };
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });

  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');

  // The project EXISTS before the feature does. This ordering is the whole
  // point: a file created in the same commit as the spec was genuinely touched
  // by the feature, while a file that predates it was not. Committing the
  // baseline first is what makes the fixture resemble a real repository.
  put('.docguard.json', JSON.stringify({ projectName: 'u', profile: 'starter' }));
  put('docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  for (const [p, body] of Object.entries(alsoCommit)) put(p, body);
  git('add', '-A'); git('commit', '-qm', 'project baseline');

  put('specs/001-thing/spec.md', '# Feature Specification: Thing\n\n**Status**: Active\n');
  put('specs/001-thing/plan.md', '# Implementation Plan: Thing\n');
  put('specs/001-thing/tasks.md', `# Tasks: Thing\n\n${tasks}\n`);
  if (commitSpec) { git('add', '-A'); git('commit', '-qm', 'spec'); }

  // A later commit, as a real feature would land its code.
  if (Object.keys(andThen).length) {
    for (const [p, body] of Object.entries(andThen)) put(p, body);
    git('add', '-A'); git('commit', '-qm', 'implementation');
  }
  return dir;
}

const claims = (dir) => {
  const res = detectUntouchedClaims(dir, detectSpecKit(dir).specs);
  return res.flatMap(r => r.untouched);
};

describe('SPK010 — the tier-(a) hole SPK008 leaves open', () => {
  // @req docs-canonical/REQUIREMENTS.md#FR-021 — a completed task naming an untouched file is reported
  // @req specs/013-calibrated-finding-channels/spec.md#SC-009 — verified against this repository's own history
  test('flags a checked task naming an existing file the feature never touched', () => {
    // The exact shape of the real miss: the file exists, so SPK008 is happy.
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md` with the new section.',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    const found = claims(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'T001');
    assert.deepEqual(found[0].paths, ['docs-canonical/ARCHITECTURE.md']);
  });

  test('stays silent when the feature did touch the file', () => {
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md` with the new section.',
      andThen: { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nNew section.\n' },
    });
    assert.deepEqual(claims(dir), []);
  });

  test('flags the untouched path even when a sibling path in the same task was touched', () => {
    // The real failure: five of six files changed, and the sixth shipped stale.
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md` and `docs-canonical/SECURITY.md`.',
      alsoCommit: { 'docs-canonical/SECURITY.md': '# Security\n' },
      andThen: { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nChanged.\n' },
    });
    const found = claims(dir);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].paths, ['docs-canonical/SECURITY.md'],
      'a task claims every path it names; one changed file does not vouch for the rest');
  });

  test('an unchecked task is never flagged', () => {
    const dir = repo({
      tasks: '- [ ] T001 Update `docs-canonical/ARCHITECTURE.md`.',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    assert.deepEqual(claims(dir), []);
  });
});

describe('SPK010 precision — it must not accuse honestly', () => {
  test('a missing path is SPK008 business, never this check', () => {
    const dir = repo({
      tasks: '- [x] T001 Create `docs-canonical/NOPE.md`.',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    assert.deepEqual(claims(dir), [], 'a non-existent deliverable is a phantom, not an untouched claim');
  });

  test('prose-only and bare-filename tasks are never falsifiable', () => {
    for (const tasks of [
      '- [x] T001 Review the approach with the team.',
      '- [x] T001 Consider whether CHANGELOG.md needs an entry.',
      '- [x] T001 Document the `/api/users` endpoint.',
    ]) {
      const dir = repo({ tasks, andThen: { 'src/app.js': 'export const v = 1;\n' } });
      assert.deepEqual(claims(dir), [], tasks);
    }
  });

  test('the spec\'s own directory is never a deliverable of its own tasks', () => {
    const dir = repo({
      tasks: '- [x] T001 Keep `specs/001-thing/tasks.md` current.',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    assert.deepEqual(claims(dir), []);
  });

  test('an inline suppression with a reason silences one task', () => {
    const dir = repo({
      tasks: '- [x] T001 Run `docs-canonical/ARCHITECTURE.md` checks. <!-- docguard:ignore SPK010 — task reads this file, it does not change it -->',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    assert.deepEqual(claims(dir), []);
  });

  test('uncommitted work counts as touched', () => {
    // A task can be genuinely complete in the working tree before it commits.
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md`.',
      andThen: { 'src/app.js': 'export const v = 1;\n' },
    });
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n\nEdited, not yet committed.\n');
    assert.deepEqual(claims(dir), []);
  });
});

describe('SPK010 — silent when the answer is unknowable', () => {
  test('no git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-nogit-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'specs/001-thing'), { recursive: true });
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\n');
    writeFileSync(join(dir, 'specs/001-thing/spec.md'), '# Feature Specification: Thing\n');
    writeFileSync(join(dir, 'specs/001-thing/tasks.md'), '# Tasks\n\n- [x] T001 Update `docs-canonical/ARCHITECTURE.md`.\n');
    assert.equal(featureTouchedPaths(dir, 'specs/001-thing'), null);
    assert.deepEqual(claims(dir), []);
  });

  test('a spec that has never been committed', () => {
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md`.',
      commitSpec: false,
    });
    // The spec exists only in the working tree; there is no introducing commit.
    assert.equal(featureTouchedPaths(dir, 'specs/001-thing'), null,
      'with no commit introducing the spec there is no window to compare against');
    assert.deepEqual(claims(dir), []);
  });
});

describe('the window is the feature\'s whole life', () => {
  test('a file changed in a LATER commit still counts as touched', () => {
    // An earlier draft scoped the window to commits touching the spec dir,
    // which meant a feature that commits its spec once and then lands five
    // phases of code saw nearly every real deliverable as untouched.
    const dir = repo({
      tasks: '- [x] T001 Update `docs-canonical/ARCHITECTURE.md`.',
      andThen: { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nLater commit.\n' },
    });
    const touched = featureTouchedPaths(dir, 'specs/001-thing');
    assert.ok(touched.has('docs-canonical/ARCHITECTURE.md'));
    assert.deepEqual(claims(dir), []);
  });
});

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
