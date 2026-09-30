/**
 * SPK010 and directories (#458): a checked task that names a directory as
 * context is not "untouched" when the feature changed files inside it.
 *
 * @req docguard.spk010-directory-claims#FR-001
 * @req docguard.spk010-directory-claims#FR-002
 * @req docguard.spk010-directory-claims#SC-001
 * @req docguard.spk010-directory-claims#SC-002
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectUntouchedClaims, detectSpecKit, touchedWithin } from '../cli/scanners/speckit.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Baseline project, then the spec commit, then the implementation commit. */
function repo({ tasks, baseline = {}, andThen = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-spk010-dir-'));
  dirs.push(dir);
  const put = (p, body) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  };
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '/dev/null');
  put('.docguard.json', JSON.stringify({ projectName: 'd', profile: 'starter' }));
  for (const [p, body] of Object.entries(baseline)) put(p, body);
  git('add', '-A'); git('commit', '-qm', 'baseline');
  put('specs/001-thing/spec.md', '# Feature Specification: Thing\n\n**Status**: Active\n');
  put('specs/001-thing/tasks.md', `# Tasks: Thing\n\n${tasks}\n`);
  git('add', '-A'); git('commit', '-qm', 'spec');
  if (Object.keys(andThen).length) {
    for (const [p, body] of Object.entries(andThen)) put(p, body);
    git('add', '-A'); git('commit', '-qm', 'implementation');
  }
  return dir;
}

const untouched = dir => detectUntouchedClaims(dir, detectSpecKit(dir).specs).flatMap(r => r.untouched);

describe('SPK010 treats a named directory as touched when a file inside it changed (#458)', () => {
  test('the #458 reproduction: a context directory beside the changed deliverable is not flagged (SC-001)', () => {
    const dir = repo({
      tasks: '- [x] T013 Implement the pure judge `src/game/liveness.js`: read it from `src/game/` (the same source `ambient.test` uses).',
      baseline: { 'src/game/agentApi.js': 'export const a = 1;\n' },
      andThen: { 'src/game/liveness.js': 'export const live = true;\n' },
    });
    assert.deepEqual(untouched(dir), []);
  });

  test('a change to an existing file deep inside the directory counts', () => {
    const dir = repo({
      tasks: '- [x] T001 Refactor `src/game/` helpers.',
      baseline: { 'src/game/deep/util.js': 'export const u = 1;\n' },
      andThen: { 'src/game/deep/util.js': 'export const u = 2;\n' },
    });
    assert.deepEqual(untouched(dir), []);
  });

  test('a directory in which the feature changed nothing is still flagged (SC-002)', () => {
    const dir = repo({
      tasks: '- [x] T001 Update the handlers in `src/game/`.',
      baseline: { 'src/game/agentApi.js': 'export const a = 1;\n' },
      andThen: { 'src/other.js': 'export const o = 1;\n' },
    });
    const found = untouched(dir);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].paths, ['src/game']);
  });

  test('a sibling directory sharing the prefix does not vouch for it', () => {
    const dir = repo({
      tasks: '- [x] T001 Update `src/game/`.',
      baseline: { 'src/game/a.js': 'export const a = 1;\n', 'src/gameplay/b.js': 'export const b = 1;\n' },
      andThen: { 'src/gameplay/b.js': 'export const b = 2;\n' },
    });
    assert.deepEqual(untouched(dir).flatMap(t => t.paths), ['src/game']);
  });

  test('a file claim still needs its own change, even when its directory changed', () => {
    const dir = repo({
      tasks: '- [x] T001 Update `src/game/agentApi.js`.',
      baseline: { 'src/game/agentApi.js': 'export const a = 1;\n' },
      andThen: { 'src/game/liveness.js': 'export const live = true;\n' },
    });
    assert.deepEqual(untouched(dir).flatMap(t => t.paths), ['src/game/agentApi.js']);
  });
});

describe('touchedWithin', () => {
  test('matches only paths strictly under the directory', () => {
    const touched = new Set(['src/gameplay/b.js', 'src/game']);
    assert.equal(touchedWithin(touched, 'src/game'), false);
    assert.equal(touchedWithin(new Set(['src/game/x.js']), 'src/game/'), true);
  });
});
