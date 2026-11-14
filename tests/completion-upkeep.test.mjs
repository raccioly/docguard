/**
 * Keep completions current (specs/103-completion-upkeep).
 *
 * A pull request that edits a closed spec's evidence files without closing the
 * spec again was invisible to CI: on the merge ref, the commit that landed the
 * record is main's squash commit, whose blobs match. SPR011 compares the record
 * with the files as they are now, and `specs complete --stale` closes every
 * flagged spec in one transaction. Every fixture is a real repository and every
 * command is the real CLI.
 *
 * @req docguard.completion-upkeep#FR-001
 * @req docguard.completion-upkeep#FR-002
 * @req docguard.completion-upkeep#FR-003
 * @req docguard.completion-upkeep#FR-004
 * @req docguard.completion-upkeep#FR-005
 * @req docguard.completion-upkeep#FR-006
 * @req docguard.completion-upkeep#FR-007
 * @req docguard.completion-upkeep#FR-008
 * @req docguard.completion-upkeep#FR-009
 * @req docguard.completion-upkeep#FR-010
 * @req docguard.completion-upkeep#FR-011
 * @req docguard.completion-upkeep#FR-012
 * @req docguard.completion-upkeep#FR-013
 * @req docguard.completion-upkeep#FR-014
 * @req docguard.completion-upkeep#FR-015
 * @req docguard.completion-upkeep#FR-016
 * @req docguard.completion-upkeep#FR-017
 * @req docguard.completion-upkeep#FR-018
 * @req docguard.completion-upkeep#SC-001
 * @req docguard.completion-upkeep#SC-002
 * @req docguard.completion-upkeep#SC-003
 * @req docguard.completion-upkeep#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tagOnlyChange } from '../cli/scanners/revision-anchor.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const { CI: _ci, ...AMBIENT } = process.env;
const ENV = { ...AMBIENT, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const REGISTRY = '.docguard-specs.json';
const FAMILY = /^(DLC|SPC|SPR)/;

const git = (dir, args) => fixtureGit(dir, args).trim();
const put = (dir, path, content) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const run = (dir, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const json = r => JSON.parse(r.out);
const family = dir => json(run(dir, ['guard', '--format', 'json'])).findings.filter(f => FAMILY.test(f.code));
const codes = findings => findings.map(f => f.code).sort();
const entry = (dir, id) => JSON.parse(read(dir, REGISTRY)).specs.find(s => s.specId === id);

/** A repository whose specs are approved and in progress, and whose gate runs strict. */
function adopter(t, names = ['alpha'], { shared = false } = {}) {
  const dir = makeTempDir('dg-upkeep-', t);
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
  names.forEach(name => {
    const i = ['alpha', 'beta', 'gamma', 'delta'].indexOf(name);
    put(dir, `specs/00${i + 1}-${name}/spec.md`, `# ${name}\n\n**Status**: Draft\n\n**Spec ID**: \`acme.${name}\`\n\n- **FR-001**: ${name} MUST work.\n`);
    put(dir, `specs/00${i + 1}-${name}/tasks.md`, '# Tasks\n\n- [x] T1 Build.\n- [ ] T2 Verify.\n');
    put(dir, `src/${name}.js`, `/** @implements acme.${name}#FR-001 */\nexport const ${name} = 1;\n`);
    put(dir, `tests/${name}.test.js`, `/** @req acme.${name}#FR-001 */\ntest("${name}", () => {});\n`);
  });
  // One file every spec lists as evidence: a hub.
  if (shared) put(dir, 'src/shared.js', `${names.map(name => `/** @implements acme.${name}#FR-001 */`).join('\n')}\nexport const shared = 1;\n`);
  git(dir, ['add', '-A']);
  assert.equal(run(dir, ['specs', '--write']).status, 0);
  for (const name of names) {
    const approve = run(dir, ['specs', 'approve', '--id', `acme.${name}`, '--delivery', 'in_progress', '--persistence', 'living',
      '--canonical-doc', 'docs-canonical/ARCHITECTURE.md', '--write', '--format', 'json']);
    assert.equal(json(approve).status, 'APPROVED', approve.out + approve.err);
  }
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'add specs, approved in progress']);
  return dir;
}

const tickOf = (dir, name) => {
  const path = `specs/00${['alpha', 'beta', 'gamma', 'delta'].indexOf(name) + 1}-${name}/tasks.md`;
  put(dir, path, read(dir, path).replace('- [ ] T2', '- [x] T2'));
};

/** One closing commit per spec: tick, refresh the registry, complete, commit. */
function closeEach(dir, names, since) {
  for (const name of names) {
    tickOf(dir, name);
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const done = run(dir, ['specs', 'complete', '--id', `acme.${name}`, '--since', since, '--reason', `Reviewed ${name}`, '--write', '--format', 'json']);
    assert.equal(json(done).status, 'VERIFIED', done.out + done.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', `close ${name}`]);
  }
}

const squashOntoMain = (dir, branch, message) => {
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '--squash', '-q', branch]);
  git(dir, ['commit', '-qm', message]);
};

/**
 * The pull-request shape of the report: specs closed on one branch and squash
 * merged; another branch, cut before that squash, edits their implementation
 * files; guard runs on the merge of that branch into main.
 */
function mergeRef(t, { names = ['alpha'], edit = ['alpha'], open = [], shared = false } = {}) {
  const dir = adopter(t, [...names, ...open], { shared });
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'closer']);
  put(dir, 'FEATURE.md', '# Feature work on the PR branch\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
  closeEach(dir, names, base);
  squashOntoMain(dir, 'closer', 'squash: close specs');
  git(dir, ['checkout', '-q', '-b', 'editor', base]);
  for (const name of edit) put(dir, `src/${name}.js`, `${read(dir, `src/${name}.js`)}export const ${name}Two = 2;\n`);
  put(dir, 'NOTES.md', '# Notes\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit evidence']);
  git(dir, ['checkout', '-q', '-b', 'merge-ref', 'main']);
  git(dir, ['merge', '--no-ff', '-q', '-m', 'merge ref', 'editor']);
  return { dir, base };
}

describe('US1: a pull request that edits a closed spec\'s evidence is warned (FR-001, FR-002, FR-003, SC-001)', () => {
  it('SPR011 names the spec, the file and the command on the merge ref, where SPR008 stays silent', t => {
    const { dir } = mergeRef(t);
    const findings = family(dir);
    const found = findings.find(f => f.code === 'SPR011');
    assert.ok(found, `SPR011 expected, got ${codes(findings)}`);
    assert.equal(found.severity, 'warn');
    assert.match(found.message, /acme\.alpha/);
    assert.match(found.message, /src\/alpha\.js/);
    assert.match(`${found.message} ${found.suggestion?.text} ${found.suggestion?.command}`, /specs complete --stale/);
    assert.ok(!codes(findings).includes('SPR008'), 'the landing commit matches, so SPR008 stays silent');
  });

  it('an edit of a canonical document the spec lists is not reported', t => {
    const { dir } = mergeRef(t, { edit: [] });
    git(dir, ['checkout', '-q', 'editor']);
    put(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nA new paragraph.\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit canonical doc']);
    git(dir, ['checkout', '-q', 'merge-ref']);
    git(dir, ['merge', '--no-ff', '-q', '-m', 'merge again', 'editor']);
    assert.ok(!codes(family(dir)).includes('SPR011'));
  });

  it('a record without blobs is not judged', t => {
    const { dir } = mergeRef(t, { edit: [] });
    git(dir, ['checkout', '-q', 'main']);
    put(dir, 'specs/001-alpha/spec.md', read(dir, 'specs/001-alpha/spec.md').replace(/ Blobs: [^\n]*\.\n/, '\n'));
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'drop blobs']);
    put(dir, 'src/alpha.js', `${read(dir, 'src/alpha.js')}export const alphaTwo = 2;\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit evidence']);
    assert.ok(!codes(family(dir)).includes('SPR011'));
  });

  it('a deleted evidence file is reported, and the edit is found in a shallow clone', t => {
    const { dir } = mergeRef(t);
    const shallow = join(makeTempDir('dg-upkeep-shallow-', t), 'clone');
    git(dir, ['clone', '-q', '--depth', '1', '--no-local', dir, shallow]);
    const findings = json(run(shallow, ['guard', '--format', 'json'])).findings;
    assert.ok(codes(findings).includes('SPR011'), `SPR011 expected in a shallow clone, got ${codes(findings)}`);
    git(dir, ['rm', '-q', 'src/alpha.js']); git(dir, ['commit', '-qm', 'remove evidence']);
    assert.match(family(dir).find(f => f.code === 'SPR011').message, /src\/alpha\.js/);
  });

  it('SPR011 is registered and explained, and has no inline suppression', () => {
    const explained = run(ROOT, ['explain', 'SPR011']);
    assert.equal(explained.status, 0, explained.err);
    assert.match(explained.out, /specs complete --stale/);
  });
});

describe('US2: one command closes every spec that drifted (FR-004, FR-005, FR-006, SC-001, SC-002)', () => {
  it('closes each spec again in one transaction, keeps its scope, and leaves guard clean after a squash', t => {
    const { dir } = mergeRef(t, { names: ['alpha', 'beta'], edit: ['alpha', 'beta'] });
    git(dir, ['checkout', '-q', 'editor']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    assert.deepEqual(codes(family(dir)).filter(code => code === 'SPR011'), ['SPR011', 'SPR011']);
    const dry = run(dir, ['specs', 'complete', '--stale', '--reason', 'Reviewed the edits', '--format', 'json']);
    assert.equal(json(dry).status, 'READY', dry.out + dry.err);
    assert.deepEqual(json(dry).specs.map(s => s.specId).sort(), ['acme.alpha', 'acme.beta']);
    const done = run(dir, ['specs', 'complete', '--stale', '--reason', 'Reviewed the edits', '--write', '--format', 'json']);
    assert.equal(json(done).status, 'VERIFIED', done.out + done.err);
    assert.equal(json(done).stats.guardRuns, 1, 'one guard run for the batch');
    for (const id of ['acme.alpha', 'acme.beta']) {
      const rec = entry(dir, id).reviewed;
      assert.deepEqual(rec.scope.canonicalDocs, ['docs-canonical/ARCHITECTURE.md']);
      assert.equal(rec.lifecycle.persistenceModel, 'living');
      assert.equal(rec.reconciliation.outcomes.length, 2);
    }
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'close the specs again']);
    assert.deepEqual(codes(family(dir)), [], 'clean on the branch');
    squashOntoMain(dir, 'editor', 'squash: edit evidence');
    assert.deepEqual(codes(family(dir)), [], 'clean after the squash (no SPR008, no SPR011)');
    const again = run(dir, ['specs', 'complete', '--stale', '--reason', 'Nothing to do', '--write', '--format', 'json']);
    assert.equal(json(again).status, 'CURRENT');
  });

  it('a batch with one blocked spec writes nothing and lists every blocker', t => {
    const { dir } = mergeRef(t, { names: ['alpha', 'beta'], edit: ['alpha', 'beta'] });
    git(dir, ['checkout', '-q', 'editor']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    put(dir, 'specs/002-beta/tasks.md', '# Tasks\n\n- [x] T1 Build.\n- [ ] T2 Verify.\n');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reopen a task of beta']);
    const before = ['.docguard-specs.json', 'specs/001-alpha/spec.md', 'specs/002-beta/spec.md', '.docguard/current-context.json'].map(path => read(dir, path));
    const done = run(dir, ['specs', 'complete', '--stale', '--reason', 'Reviewed the edits', '--write', '--format', 'json']);
    assert.equal(done.status, 2, done.out + done.err);
    const result = json(done);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.applied, false);
    assert.ok(result.blockers.some(b => b.specId === 'acme.beta' && b.code === 'SPC003'), JSON.stringify(result.blockers));
    const after = ['.docguard-specs.json', 'specs/001-alpha/spec.md', 'specs/002-beta/spec.md', '.docguard/current-context.json'].map(path => read(dir, path));
    assert.deepEqual(after, before, 'no byte written');
    assert.equal(git(dir, ['status', '--porcelain']), '');
  });

  it('refuses the flags that name one spec, and reports CURRENT when nothing drifted', t => {
    const { dir } = mergeRef(t, { edit: [] });
    git(dir, ['checkout', '-q', 'main']);
    const nothing = run(dir, ['specs', 'complete', '--stale', '--reason', 'x', '--write', '--format', 'json']);
    assert.equal(json(nothing).status, 'CURRENT');
    const named = run(dir, ['specs', 'complete', '--stale', '--id', 'acme.alpha', '--reason', 'x', '--format', 'json']);
    assert.equal(named.status, 1);
    assert.match(json(named).error, /--stale/);
  });

  it('a branch that merged main closes a spec again without --since (FR-015)', t => {
    const { dir } = mergeRef(t, { edit: ['alpha'] });
    git(dir, ['checkout', '-q', 'editor']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    const dry = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--format', 'json']));
    assert.equal(dry.status, 'READY', JSON.stringify(dry.blockers));
    const done = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--reason', 'Reviewed the edit', '--write', '--format', 'json']));
    assert.equal(done.status, 'VERIFIED');
  });

  it('--stale accepts a tick in a spec of the batch, and still blocks a tick in a spec outside it (FR-016)', t => {
    const { dir } = mergeRef(t, { edit: ['alpha'], open: ['gamma'] });
    git(dir, ['checkout', '-q', 'editor']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    put(dir, 'specs/001-alpha/tasks.md', read(dir, 'specs/001-alpha/tasks.md').replace('- [x] T2', '- [ ] T2'));
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reopen the last task of alpha']);
    tickOf(dir, 'alpha');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const inBatch = json(run(dir, ['specs', 'complete', '--stale', '--reason', 'x', '--format', 'json']));
    assert.equal(inBatch.status, 'READY', JSON.stringify(inBatch.blockers));
    tickOf(dir, 'gamma');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const outside = json(run(dir, ['specs', 'complete', '--stale', '--reason', 'x', '--format', 'json']));
    assert.equal(outside.status, 'BLOCKED');
    assert.ok(outside.blockers.some(b => b.code === 'SPC001' && /003-gamma/.test(b.message)), JSON.stringify(outside.blockers));
  });

  it('plans against one reconciliation per distinct base (FR-006)', t => {
    const { dir } = mergeRef(t, { names: ['alpha', 'beta'], edit: ['alpha', 'beta'] });
    git(dir, ['checkout', '-q', 'editor']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    const dry = json(run(dir, ['specs', 'complete', '--stale', '--reason', 'x', '--format', 'json']));
    assert.equal(dry.stats.specs, 2);
    assert.equal(dry.stats.guardRuns, 1);
    assert.ok(dry.stats.reconciliations <= dry.stats.bases, `${dry.stats.reconciliations} reconciliations for ${dry.stats.bases} base(s)`);
  });
});

describe('US3: tagging and closing take one commit (FR-007)', () => {
  /** alpha is closed on a branch whose test file does not carry its tag yet. */
  function untagged(t) {
    const dir = adopter(t);
    put(dir, 'tests/alpha.test.js', 'test("alpha", () => {});\n');
    put(dir, 'tests/alpha-extra.test.js', 'test("extra", () => {});\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'untag the test']);
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'registry']);
    git(dir, ['checkout', '-q', '-b', 'pr']);
    tickOf(dir, 'alpha');
    return dir;
  }

  it('an uncommitted change that only adds tags does not block, and the blobs are the committed content', t => {
    const dir = untagged(t);
    put(dir, 'tests/alpha.test.js', '/** @req acme.alpha#FR-001 */\ntest("alpha", () => {});\n');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const done = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'Tagged and closed', '--write', '--format', 'json']);
    assert.equal(json(done).status, 'VERIFIED', done.out + done.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'tag and close alpha']);
    assert.deepEqual(codes(family(dir)), []);
    squashOntoMain(dir, 'pr', 'squash');
    assert.deepEqual(codes(family(dir)), [], 'no SPR008 and no SPR011 after the squash');
  });

  it('any other edit of a file still blocks with SPC001', t => {
    const dir = untagged(t);
    put(dir, 'tests/alpha-extra.test.js', 'test("extra", () => { /* changed */ });\n');
    put(dir, 'tests/alpha.test.js', '/** @req acme.alpha#FR-001 */\ntest("alpha", () => {});\n');
    const refused = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--format', 'json']);
    assert.ok(json(refused).blockers.some(b => b.code === 'SPC001'), refused.out);
  });

  it('a tag for another spec is not accepted', t => {
    const dir = untagged(t);
    put(dir, 'tests/alpha.test.js', '/** @req acme.alpha#FR-001 */\n/** @req acme.other#FR-009 */\ntest("alpha", () => {});\n');
    const refused = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~1', '--reason', 'x', '--format', 'json']);
    assert.ok(json(refused).blockers.some(b => b.code === 'SPC001'), refused.out);
  });
});

describe('tagOnlyChange accepts the addition of the spec\'s own tags and nothing else (FR-007)', () => {
  const only = (committed, current) => tagOnlyChange(committed, current, 'acme.alpha');
  it('accepts a tag line, a tag block, a tag inside a described block, an inline tag and several tags', () => {
    assert.ok(only('test(1)\n', '/** @req acme.alpha#FR-001 */\ntest(1)\n'));
    assert.ok(only('x\n', '/**\n * @implements acme.alpha#FR-001\n */\nx\n'));
    assert.ok(only('/**\n * Does x.\n */\nx\n', '/**\n * Does x.\n * @implements acme.alpha#FR-001\n */\nx\n'));
    assert.ok(only('x = 1;\n', 'x = 1; // @req acme.alpha#FR-001\n'));
    assert.ok(only('a: 1\n', '# @implements acme.alpha#FR-001\na: 1\n'));
    assert.ok(only('x\n', '/** @implements acme.alpha#FR-001, acme.alpha#FR-002 */\nx\n'));
  });
  it('rejects an edit that adds no tag, however small', () => {
    assert.ok(!only('x\n', 'x\n\n'), 'a blank line');
    assert.ok(!only('/* note\n*/\nrun();\n', '/* note\nrun();\n'), 'a deleted closing marker comments out code');
  });
  it('rejects a tag added together with any other change', () => {
    assert.ok(!only('/* note\n*/\nrun();\n', '/* note\nrun(); // @req acme.alpha#FR-001\n'), 'a deleted closing marker');
    assert.ok(!only('run();\n', '/* @req acme.alpha#FR-001\nrun();\n'), 'an unbalanced opening marker');
    assert.ok(!only('test(1)\n', '/** @req acme.alpha#FR-001 */\ntest(2)\n'), 'an edited statement');
    assert.ok(!only('x\n', '/** @req acme.alpha#FR-001 */\n\nx\n'), 'a blank line');
    assert.ok(!only('x\n', '/** @req acme.other#FR-001 */\nx\n'), 'another spec\'s tag');
    assert.ok(!only('/** @req acme.alpha#FR-001 */\nx\n', 'x\n'), 'a removed tag');
  });
  it('blocks a completion on a tag-less blank-line edit and on an unbalanced comment opener', t => {
    const dir = adopter(t);
    put(dir, 'tests/alpha.test.js', 'run();\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'plain test']);
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'registry']);
    tickOf(dir, 'alpha');
    for (const edited of ['run();\n\n', '/* @req acme.alpha#FR-001\nrun();\n']) {
      put(dir, 'tests/alpha.test.js', edited);
      const refused = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~2', '--reason', 'x', '--format', 'json']);
      assert.ok(json(refused).blockers.some(b => b.code === 'SPC001' && /tests\/alpha\.test\.js/.test(b.message)), refused.out);
    }
  });
});

describe('US4: the first-use friction (FR-008 to FR-012)', () => {
  it('SPC006 names the earliest ref after which no unresolved file remains (FR-009)', t => {
    const dir = adopter(t);
    const base = git(dir, ['rev-parse', 'HEAD']);
    put(dir, 'lib/untraced.js', 'export const x = 1;\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'add an untraced file']);
    const culprit = git(dir, ['rev-parse', 'HEAD']);
    put(dir, 'NOTES.md', '# Notes\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'notes']);
    tickOf(dir, 'alpha');
    const blocked = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', base, '--reason', 'x', '--format', 'json']));
    const message = blocked.blockers.find(b => b.code === 'SPC006' && /Unresolved/.test(b.message))?.message || '';
    assert.match(message, /lib\/untraced\.js/);
    assert.ok(message.includes(culprit.slice(0, 12)), message);
    assert.match(message, /--since/);
  });

  it('complete --write prints what it wrote, sets the Status header, and the written tree is not a change (FR-010, FR-011)', t => {
    const dir = adopter(t);
    const base = git(dir, ['rev-parse', 'HEAD~1']);
    tickOf(dir, 'alpha');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const text = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', base, '--reason', 'Reviewed', '--write']);
    assert.equal(text.status, 0, text.out + text.err);
    assert.match(text.out, /lastReviewedRevision/);
    assert.match(text.out, /delivery .*verified/);
    assert.match(text.out, /3 evidence blobs recorded|evidence blobs recorded: 3/);
    assert.match(read(dir, 'specs/001-alpha/spec.md'), /\*\*Status\*\*: Active/);
    const again = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--format', 'json']));
    assert.ok(!again.blockers.some(b => b.code === 'SPC001'), `the Status line is not a change: ${JSON.stringify(again.blockers)}`);
  });

  it('a value other than a draft one is left alone (FR-011)', t => {
    const dir = adopter(t);
    put(dir, 'specs/001-alpha/spec.md', read(dir, 'specs/001-alpha/spec.md').replace('**Status**: Draft', '**Status**: Superseded'));
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'superseded']);
    tickOf(dir, 'alpha');
    assert.equal(run(dir, ['specs', '--write']).status, 0);
    const done = run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~2', '--reason', 'Reviewed', '--write', '--format', 'json']);
    assert.equal(json(done).status, 'VERIFIED', done.out + done.err);
    assert.match(read(dir, 'specs/001-alpha/spec.md'), /\*\*Status\*\*: Superseded/);
  });

  it('an unknown spec ID lists the closest recorded IDs in complete, approve and reanchor (FR-012)', t => {
    const dir = adopter(t, ['alpha', 'beta']);
    for (const action of ['complete', 'approve', 'reanchor']) {
      const result = json(run(dir, ['specs', action, '--id', 'acme.alph', '--format', 'json']));
      const message = result.blockers.find(b => /Unknown spec ID/.test(b.message))?.message || '';
      assert.match(message, /Did you mean[^.]*acme\.alpha/, `${action}: ${message}`);
    }
  });

  it('the recipe for a requirement with no code target is in AGENTS.md and in SPC004 (FR-008)', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    for (const term of ['describes()', 'recorded()', 'tests/program-verification.test.mjs']) assert.ok(agents.includes(term), `AGENTS.md should describe ${term}`);
    const help = run(ROOT, ['explain', 'SPC004']).out;
    for (const term of ['describes()', 'recorded()']) assert.ok(help.includes(term), `SPC004 help should describe ${term}`);
  });

  it('docs/commands.md documents --stale and SPR011 (FR-013)', () => {
    const commands = readFileSync(join(ROOT, 'docs/commands.md'), 'utf8');
    assert.match(commands, /--stale/);
    assert.match(commands, /SPR011/);
    assert.match(readFileSync(join(ROOT, 'docs/reference/findings.md'), 'utf8'), /SPR011/);
  });

  it('the plan records what made a wide range slow and what changed (FR-014)', () => {
    const plan = readFileSync(join(ROOT, 'specs/103-completion-upkeep/plan.md'), 'utf8');
    for (const term of ['Why a wide range is slow', 'one guard run', 'one reconciliation per distinct base']) assert.ok(plan.includes(term), `plan.md should say ${JSON.stringify(term)}`);
  });

  it('this specification is closed with the flow it describes, and the spec it amends was closed again with --stale (SC-003)', () => {
    const registry = JSON.parse(readFileSync(join(ROOT, REGISTRY), 'utf8'));
    const own = registry.specs.find(spec => spec.specId === 'docguard.completion-upkeep');
    assert.equal(own.reviewed.lifecycle.delivery, 'verified');
    assert.match(readFileSync(join(ROOT, own.path), 'utf8'), / Blobs: /);
    const amended = registry.specs.find(spec => spec.specId === 'docguard.completion-one-commit');
    assert.ok(amended.reviewed.reconciliation.outcomes.some(outcome => /spec 103/.test(outcome.reason)), 'spec 101 records its re-close for spec 103');
  });
});

/** guard at every commit of `dir`, in a clone: the codes of the DLC, SPC and SPR family found at each. */
function perCommitGate(t, dir) {
  const clone = makeTempDir('dg-upkeep-gate-', t);
  git(clone, ['clone', '-q', '--no-hardlinks', dir, '.']);
  return git(dir, ['rev-list', '--reverse', 'main..HEAD']).split('\n').filter(Boolean).map(sha => {
    git(clone, ['checkout', '-q', sha]);
    return [sha.slice(0, 7), codes(family(clone))];
  });
}

describe('US5: the code edit and the completion land in one commit, and a per-commit gate never fails (FR-017, SC-004)', () => {
  /** alpha is closed on main; a branch does unrelated work, then edits src/alpha.js, uncommitted. */
  function closedThenEdited(t, extra = []) {
    const dir = adopter(t, ['alpha', ...extra]);
    const base = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'closer']);
    closeEach(dir, ['alpha'], base);
    squashOntoMain(dir, 'closer', 'squash: close alpha');
    git(dir, ['checkout', '-q', '-b', 'edit', 'main']);
    put(dir, 'NOTES.md', '# Notes\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'unrelated work']);
    put(dir, 'src/alpha.js', `${read(dir, 'src/alpha.js')}export const alphaTwo = 2;\n`);
    return dir;
  }
  const reason = ['--reason', 'Reviewed the edit', '--write', '--format', 'json'];

  it('complete --id takes the uncommitted edit; every commit of the branch passes guard; so does the squash', t => {
    const dir = closedThenEdited(t);
    const done = run(dir, ['specs', 'complete', '--id', 'acme.alpha', ...reason]);
    assert.equal(json(done).status, 'VERIFIED', done.out + done.err);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit alpha and close it again']);
    const gate = perCommitGate(t, dir);
    assert.equal(gate.length, 2);
    assert.deepEqual(gate.filter(([, found]) => found.length), [], 'warnings as failures: no DLC, SPC or SPR finding at any commit');
    squashOntoMain(dir, 'edit', 'squash: edit alpha');
    assert.deepEqual(codes(family(dir)), []);
  });

  it('complete --stale finds the uncommitted edit and closes it in the same commit', t => {
    const dir = closedThenEdited(t);
    const dry = json(run(dir, ['specs', 'complete', '--stale', '--reason', 'x', '--format', 'json']));
    assert.equal(dry.status, 'READY', JSON.stringify(dry.blockers));
    assert.deepEqual(dry.specs.map(item => item.specId), ['acme.alpha']);
    assert.equal(json(run(dir, ['specs', 'complete', '--stale', ...reason])).status, 'VERIFIED');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit alpha and close it again']);
    assert.deepEqual(perCommitGate(t, dir).filter(([, found]) => found.length), []);
    squashOntoMain(dir, 'edit', 'squash: edit alpha');
    assert.deepEqual(codes(family(dir)), []);
  });

  it('an edit of a file that is not the spec\'s evidence still blocks with SPC001', t => {
    const dir = closedThenEdited(t);
    put(dir, 'README.md', '# Fixture, edited\n');
    const refused = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--reason', 'x', '--format', 'json']));
    assert.ok(refused.blockers.some(b => b.code === 'SPC001' && /README\.md/.test(b.message)), JSON.stringify(refused.blockers));
  });
});

describe('US6: a file shared by many specs is not byte-compared (FR-018)', () => {
  const four = ['alpha', 'beta', 'gamma', 'delta'];

  it('an edit of a hub flags nobody, an edit of one spec\'s own file flags that spec, and guard JSON names the hubs', t => {
    const { dir } = mergeRef(t, { names: four, edit: ['shared'], shared: true });
    assert.deepEqual(codes(family(dir)).filter(code => code === 'SPR011'), [], 'src/shared.js is evidence of four specs');
    const report = json(run(dir, ['guard', '--format', 'json']));
    const hubs = report.files.completionHubs;
    assert.equal(hubs.threshold, 4);
    assert.deepEqual(hubs.files.map(hub => [hub.path, hub.specs]), [['src/shared.js', 4]]);
    git(dir, ['checkout', '-q', 'editor']);
    put(dir, 'src/beta.js', `${read(dir, 'src/beta.js')}export const betaTwo = 2;\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit beta']);
    git(dir, ['checkout', '-q', 'merge-ref']);
    git(dir, ['merge', '--no-ff', '-q', '-m', 'merge again', 'editor']);
    const flagged = family(dir).filter(f => f.code === 'SPR011');
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].message, /acme\.beta/);
  });
});

describe('FR-015: the any-ancestry search cannot pick a base reachable only through an unrelated branch', () => {
  it('picks the commit that carries the reviewed files, not an unrelated side branch merged into main', t => {
    const dir = adopter(t);
    const base = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'side']);
    put(dir, 'SIDE.md', '# A side branch that never saw the completion\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'side work']);
    const side = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '--no-ff', '-q', '-m', 'merge side', 'side']);
    git(dir, ['checkout', '-q', '-b', 'closer', base]);
    put(dir, 'FEATURE.md', '# Feature work\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
    closeEach(dir, ['alpha'], base);
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '--squash', '-q', 'closer']);
    git(dir, ['commit', '-qm', 'squash: close alpha']);
    const landing = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'editor', base]);
    put(dir, 'src/alpha.js', `${read(dir, 'src/alpha.js')}export const alphaTwo = 2;\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit alpha']);
    git(dir, ['merge', '-q', '-m', 'merge main', 'main']);
    const plan = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--format', 'json']));
    assert.equal(plan.status, 'READY', JSON.stringify(plan.blockers));
    assert.equal(plan.since, landing, 'the diff base is the squash commit that carries the reviewed files');
    assert.notEqual(plan.since, side);
  });

  it('a record whose reviewed files are in no commit of this history stays lost, and --since stays required', t => {
    const dir = adopter(t);
    const base = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'closer']);
    put(dir, 'FEATURE.md', '# Feature work\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
    closeEach(dir, ['alpha'], base);
    const closed = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'other', base]);
    put(dir, 'src/alpha.js', `${read(dir, 'src/alpha.js')}export const alphaTwo = 2;\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'edit alpha on a branch that never saw the completion']);
    // The record arrives with a file change the reviewed blobs do not have: only the closing commit's registry, not its files.
    git(dir, ['checkout', closed, '--', REGISTRY, 'specs/001-alpha']);
    git(dir, ['commit', '-qm', 'bring in the record without its files']);
    const plan = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--format', 'json']));
    assert.ok(plan.blockers.some(b => b.code === 'SPC006' && /--since/.test(b.message)), JSON.stringify(plan.blockers));
  });
});

describe('FR-011: a status that is not a draft value is never rewritten', () => {
  it('Implemented, Complete and Active stay as they are', t => {
    for (const value of ['Implemented', 'Complete', 'Active']) {
      const dir = adopter(t);
      put(dir, 'specs/001-alpha/spec.md', read(dir, 'specs/001-alpha/spec.md').replace('**Status**: Draft', `**Status**: ${value}`));
      assert.equal(run(dir, ['specs', '--write']).status, 0);
      git(dir, ['add', '-A']); git(dir, ['commit', '-qm', `status ${value}`]);
      tickOf(dir, 'alpha');
      assert.equal(run(dir, ['specs', '--write']).status, 0);
      const done = json(run(dir, ['specs', 'complete', '--id', 'acme.alpha', '--since', 'HEAD~2', '--reason', 'Reviewed', '--write', '--format', 'json']));
      assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
      assert.match(read(dir, 'specs/001-alpha/spec.md'), new RegExp(`\\*\\*Status\\*\\*: ${value}`));
    }
  });
});
