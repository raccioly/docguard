/**
 * Completion revision anchoring (specs/028-completion-revision-anchoring).
 *
 * `specs complete` records the revision it reviewed. Under squash merges a
 * revision recorded on a PR branch never reaches the default branch, and a
 * batch of completions could not share one revision because each needed a
 * clean tree. These tests reproduce both, then prove the fixes.
 *
 * @req docguard.completion-revision-anchoring#FR-001
 * @req docguard.completion-revision-anchoring#FR-002
 * @req docguard.completion-revision-anchoring#FR-003
 * @req docguard.completion-revision-anchoring#FR-004
 * @req docguard.completion-revision-anchoring#SC-001
 * @req docguard.completion-revision-anchoring#SC-002
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { completeSpec, reanchorSpec } from '../cli/commands/specs.mjs';
import { projectSpecRegistry, readSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';

const passingGuard = { status: 'PASS', errors: 0, warnings: 0 };

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Two approved, implemented specs with evidence, committed on `main`. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-anchor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  for (const [n, name] of [['001', 'alpha'], ['002', 'beta']]) {
    write(dir, `specs/${n}-${name}/spec.md`, `# ${name}\n\n**Spec ID**: \`acme.${name}\`\n\n- **FR-001**: ${name} MUST work.\n`);
    write(dir, `specs/${n}-${name}/tasks.md`, '# Tasks\n\n- [x] T001 Build.\n');
    write(dir, `src/${name}.js`, `/** @implements acme.${name}#FR-001 */\nexport const ${name} = true;\n`);
    write(dir, `tests/${name}.test.js`, `/** @req acme.${name}#FR-001 */\ntest("${name}", () => {});\n`);
  }
  write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'initial']);
  const registry = projectSpecRegistry(dir).registry;
  for (const spec of registry.specs) {
    spec.reviewed.lifecycle.approval = 'approved';
    spec.reviewed.lifecycle.delivery = 'implemented';
    spec.reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
  }
  write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'registry']);
  return dir;
}

const complete = (dir, id, since) => completeSpec(dir, {}, { id, since, write: true, reason: 'Reviewed in the fixture' }, { guardResult: passingGuard });
const recorded = (dir, id) => readSpecRegistry(dir).value.specs.find(s => s.specId === id).reviewed.reconciliation;
const spr008 = dir => validateSpecRegistry(dir, {}).findings.filter(f => f.code === 'SPR008');

describe('several completions share one revision and one commit (FR-001, SC-001)', () => {
  it('two completions back to back record the same HEAD, and the registry is CURRENT after one commit', t => {
    const dir = fixture(t);
    const head = git(dir, ['rev-parse', 'HEAD']);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    assert.equal(complete(dir, 'acme.alpha', first).status, 'VERIFIED');
    const second = complete(dir, 'acme.beta', first);
    assert.equal(second.status, 'VERIFIED', JSON.stringify(second.blockers));
    assert.equal(recorded(dir, 'acme.alpha').lastReviewedRevision, head);
    assert.equal(recorded(dir, 'acme.beta').lastReviewedRevision, head);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify both']);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('a change outside the lifecycle files still blocks', t => {
    const dir = fixture(t);
    write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
    const plan = completeSpec(dir, {}, { id: 'acme.alpha', since: 'HEAD~1' }, { guardResult: passingGuard });
    assert.equal(plan.status, 'BLOCKED');
    assert.match(plan.blockers.find(b => b.code === 'SPC001').message, /changed: src\/alpha\.js/);
  });

  it('a spec prose edit outside the outcomes block still blocks', t => {
    const dir = fixture(t);
    const path = join(dir, 'specs/001-alpha/spec.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('MUST work', 'MUST work fast'));
    const plan = completeSpec(dir, {}, { id: 'acme.beta', since: 'HEAD~1' }, { guardResult: passingGuard });
    assert.ok(plan.blockers.some(b => b.code === 'SPC001' && /changed: specs\/001-alpha\/spec\.md/.test(b.message)), JSON.stringify(plan.blockers));
  });
});

/** Complete on a PR branch, commit there, then squash-merge it into main. */
function squashMerged(t) {
  const dir = fixture(t);
  const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'pr']);
  // A real PR has its own commits before the completion runs.
  write(dir, 'NOTES.md', '# Notes\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
  complete(dir, 'acme.alpha', first);
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha on the PR branch']);
  const branchRevision = recorded(dir, 'acme.alpha').lastReviewedRevision;
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['merge', '--squash', '-q', 'pr']); git(dir, ['commit', '-qm', 'squash: verify alpha']);
  git(dir, ['branch', '-D', 'pr']);
  return { dir, branchRevision };
}

describe('a revision a squash merge discarded is reported and re-anchored (FR-002, FR-003, SC-002)', () => {
  it('SPR008 names the spec and the dangling revision', t => {
    const { dir, branchRevision } = squashMerged(t);
    const found = spr008(dir);
    assert.equal(found.length, 1);
    assert.match(found[0].message, new RegExp(`acme\\.alpha: recorded review revision ${branchRevision.slice(0, 12)} is not on this branch's history`));
  });

  it('reanchor moves the anchor to the first commit with byte-identical evidence and clears SPR008', t => {
    const { dir, branchRevision } = squashMerged(t);
    const plan = reanchorSpec(dir, {}, { id: 'acme.alpha' });
    assert.equal(plan.status, 'READY');
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.moves[0].from, branchRevision);
    assert.equal(plan.moves[0].method, 'blob-equal');
    const result = reanchorSpec(dir, {}, { id: 'acme.alpha', write: true });
    assert.equal(result.status, 'REANCHORED');
    const rec = recorded(dir, 'acme.alpha');
    assert.equal(rec.lastReviewedRevision, plan.moves[0].to);
    assert.deepEqual(rec.outcomes.at(-1).reanchoredFrom, { revision: branchRevision, method: 'blob-equal' });
    assert.match(readFileSync(join(dir, 'specs/001-alpha/spec.md'), 'utf8'), new RegExp(`- \`${plan.moves[0].to}\``));
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reanchor']);
    assert.deepEqual(spr008(dir), []);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('refuses a --to whose evidence differs from the reviewed bytes, and writes nothing', t => {
    const { dir } = squashMerged(t);
    write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = "changed after review";\n');
    git(dir, ['commit', '-qam', 'change evidence after the squash']);
    // The squash commit itself still carries the reviewed bytes, so it is found.
    assert.equal(reanchorSpec(dir, {}, { id: 'acme.alpha' }).status, 'READY');
    const before = readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8');
    const refused = reanchorSpec(dir, {}, { id: 'acme.alpha', to: git(dir, ['rev-parse', 'HEAD']), write: true });
    assert.equal(refused.status, 'BLOCKED');
    assert.match(refused.blockers[0].message, /Evidence differs .*src\/alpha\.js/);
    assert.equal(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'), before);
  });

  it('a revision that no longer resolves needs --to and an attested --reason', t => {
    const { dir, branchRevision } = squashMerged(t);
    git(dir, ['reflog', 'expire', '--expire=now', '--all']);
    git(dir, ['gc', '-q', '--prune=now']);
    assert.match(spr008(dir)[0].message, /does not resolve/);
    assert.match(reanchorSpec(dir, {}, { id: 'acme.alpha' }).blockers[0].message, /no longer resolves; pass --to/);
    const head = git(dir, ['rev-parse', 'HEAD']);
    assert.match(reanchorSpec(dir, {}, { id: 'acme.alpha', to: head, write: true }).blockers[0].message, /--reason \(8-500 characters\) must attest/);
    const done = reanchorSpec(dir, {}, { id: 'acme.alpha', to: head, write: true, reason: 'The squash commit is the reviewed PR tree' });
    assert.equal(done.status, 'REANCHORED');
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).reanchoredFrom,
      { revision: branchRevision, method: 'attested', reason: 'The squash commit is the reviewed PR tree' });
  });

  it('a shallow clone reports partial coverage instead of SPR008', t => {
    const { dir } = squashMerged(t);
    const shallow = mkdtempSync(join(tmpdir(), 'docguard-anchor-shallow-'));
    t.after(() => rmSync(shallow, { recursive: true, force: true }));
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, shallow]);
    const result = validateSpecRegistry(shallow, {});
    assert.deepEqual(result.findings.filter(f => f.code === 'SPR008'), []);
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /shallow clone/);
  });
});

describe('completion warns when its revision will not survive (FR-004)', () => {
  it('warns off the remote default branch, and not on it', t => {
    const dir = fixture(t);
    const remote = mkdtempSync(join(tmpdir(), 'docguard-anchor-remote-'));
    t.after(() => rmSync(remote, { recursive: true, force: true }));
    git(remote, ['init', '-q', '--bare']);
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['push', '-q', 'origin', 'main']);
    git(dir, ['remote', 'set-head', 'origin', 'main']);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    const onMain = complete(dir, 'acme.alpha', first);
    assert.deepEqual(onMain.warnings, []);
    git(dir, ['checkout', '-q', '-b', 'pr']);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha']);
    const offMain = complete(dir, 'acme.beta', first);
    assert.equal(offMain.status, 'VERIFIED');
    assert.match(offMain.warnings[0], /not on the remote default branch; a squash merge will discard it/);
  });
});
