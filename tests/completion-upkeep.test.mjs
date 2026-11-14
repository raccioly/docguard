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
 * @req docguard.completion-upkeep#SC-001
 * @req docguard.completion-upkeep#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function adopter(t, names = ['alpha']) {
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
  names.forEach((name, i) => {
    put(dir, `specs/00${i + 1}-${name}/spec.md`, `# ${name}\n\n**Status**: Draft\n\n**Spec ID**: \`acme.${name}\`\n\n- **FR-001**: ${name} MUST work.\n`);
    put(dir, `specs/00${i + 1}-${name}/tasks.md`, '# Tasks\n\n- [x] T1 Build.\n- [ ] T2 Verify.\n');
    put(dir, `src/${name}.js`, `/** @implements acme.${name}#FR-001 */\nexport const ${name} = 1;\n`);
    put(dir, `tests/${name}.test.js`, `/** @req acme.${name}#FR-001 */\ntest("${name}", () => {});\n`);
  });
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
  const path = `specs/00${['alpha', 'beta'].indexOf(name) + 1}-${name}/tasks.md`;
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
function mergeRef(t, { names = ['alpha'], edit = ['alpha'] } = {}) {
  const dir = adopter(t, names);
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
});
