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
 * @req docguard.completion-revision-anchoring#FR-005
 * @req docguard.completion-revision-anchoring#FR-006
 * @req docguard.completion-revision-anchoring#SC-003
 * @req docguard.completion-revision-anchoring#FR-007
 * @req docguard.completion-revision-anchoring#FR-008
 * @req docguard.completion-revision-anchoring#FR-009
 * @req docguard.completion-revision-anchoring#FR-010
 * @req docguard.completion-revision-anchoring#SC-004
 * @req docguard.completion-revision-anchoring#SC-005
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { completeSpec, planSpecCompletion, reanchorSpec } from '../cli/commands/specs.mjs';
import { buildReconciliationPlan } from '../cli/scanners/reconciliation.mjs';
import { projectSpecRegistry, readSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';

const passingGuard = { status: 'PASS', errors: 0, warnings: 0 };

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
const git = (dir, args) => execFileSync('git', [...FIXTURE_GIT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Two approved, implemented specs with evidence, committed on `main`. */
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-anchor-'));
  // Retry: a commit can leave a detached `git gc --auto` writing into .git.
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, ['init', '-q', '-b', 'main']);
  // No background maintenance racing the cleanup (a CI flake: ENOTEMPTY on .git).
  git(dir, ['config', 'gc.auto', '0']); git(dir, ['config', 'maintenance.auto', 'false']);
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

const complete = (dir, id, since, extra = {}) => completeSpec(dir, {}, { id, since, write: true, reason: 'Reviewed in the fixture', ...extra }, { guardResult: passingGuard });
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
function squashMerged(t, extra = {}) {
  const dir = fixture(t);
  const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', 'pr']);
  // A real PR has its own commits before the completion runs.
  write(dir, 'NOTES.md', '# Notes\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'feature work on the PR branch']);
  complete(dir, 'acme.alpha', first, extra);
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
    assert.match(refused.blockers[0].message, /Pass --reason .* to attest/);
  });

  it('a differing target can be attested, and the differing files are recorded', t => {
    const { dir, branchRevision } = squashMerged(t);
    write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = "changed after review";\n');
    git(dir, ['commit', '-qam', 'change evidence after the squash']);
    const head = git(dir, ['rev-parse', 'HEAD']);
    const done = reanchorSpec(dir, {}, { id: 'acme.alpha', to: head, write: true, reason: 'The PR kept changing after review; this merge is the reviewed feature' });
    assert.equal(done.status, 'REANCHORED');
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).reanchoredFrom, {
      revision: branchRevision, method: 'attested',
      reason: 'The PR kept changing after review; this merge is the reviewed feature',
      differing: ['src/alpha.js'],
    });
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reanchor']);
    assert.equal(projectSpecRegistry(dir).current, true);
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

  it('--from scopes an attestation to one revision when two merges each carried a review (FR-006)', t => {
    const { dir, branchRevision: first } = squashMerged(t);
    const firstSquash = git(dir, ['rev-parse', 'HEAD']);
    // A second PR completes the same spec again and is squash-merged too.
    git(dir, ['checkout', '-q', '-b', 'pr2']);
    // A living spec is completed again after later changes.
    const reg = readSpecRegistry(dir).value;
    reg.specs.find(x => x.specId === 'acme.alpha').reviewed.lifecycle.persistenceModel = 'living';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(reg, null, 2)}\n`);
    write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'change alpha on the second PR']);
    // The recorded revision is the first PR's, which still resolves here; a
    // --since unrelated to it is refused (FR-009), so reconcile from it.
    const again = complete(dir, 'acme.alpha');
    assert.equal(again.status, 'VERIFIED', JSON.stringify(again.blockers));
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha again on the second PR']);
    const second = recorded(dir, 'acme.alpha').lastReviewedRevision;
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '--squash', '-q', 'pr2']); git(dir, ['commit', '-qm', 'squash: verify alpha again']);
    const secondSquash = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['branch', '-D', 'pr2']);
    git(dir, ['reflog', 'expire', '--expire=now', '--all']);
    git(dir, ['gc', '-q', '--prune=now']);
    assert.equal(spr008(dir).length, 2);

    const reason = 'This squash merge is the PR whose tree the review checked';
    assert.match(reanchorSpec(dir, {}, { id: 'acme.alpha', from: 'abc', to: firstSquash, reason }).blockers[0].message, /--from abc must name exactly one recorded revision/);
    const one = reanchorSpec(dir, {}, { id: 'acme.alpha', from: first.slice(0, 12), to: firstSquash, reason, write: true });
    assert.equal(one.status, 'REANCHORED', JSON.stringify(one.blockers));
    assert.deepEqual(one.moves.map(m => [m.from, m.to]), [[first, firstSquash]]);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reanchor the first review']);
    assert.deepEqual(spr008(dir).map(f => f.message.match(/revision (\w{12})/)[1]), [second.slice(0, 12)], 'the second review is untouched');

    const two = reanchorSpec(dir, {}, { id: 'acme.alpha', from: second.slice(0, 12), to: secondSquash, reason, write: true });
    assert.equal(two.status, 'REANCHORED', JSON.stringify(two.blockers));
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reanchor the second review']);
    assert.deepEqual(spr008(dir), []);
    const outcomes = recorded(dir, 'acme.alpha').outcomes;
    assert.deepEqual(outcomes.map(o => [o.revision, o.reanchoredFrom.revision]), [[firstSquash, first], [secondSquash, second]]);
  });

  it('a shallow clone reports partial coverage instead of SPR008', t => {
    const { dir } = squashMerged(t);
    const shallow = mkdtempSync(join(tmpdir(), 'docguard-anchor-shallow-'));
    t.after(() => rmSync(shallow, { recursive: true, force: true }));
    execFileSync('git', [...FIXTURE_GIT, 'clone', '-q', '--depth', '1', `file://${dir}`, shallow]);
    const result = validateSpecRegistry(shallow, {});
    assert.deepEqual(result.findings.filter(f => f.code === 'SPR008'), []);
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /shallow clone/);
  });
});

describe('completion records the outcome in the form the registry projects (FR-007)', () => {
  const outcomeLine = dir => readFileSync(join(dir, 'specs/001-alpha/spec.md'), 'utf8').split('\n').find(line => line.startsWith('- `'));

  it('deviations given in reverse order complete, and are recorded sorted', t => {
    const dir = fixture(t);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    const done = complete(dir, 'acme.alpha', first, { deviations: ['B kept the old flag', 'A skipped the cache'] });
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).deviations, ['A skipped the cache', 'B kept the old flag']);
    assert.deepEqual(done.outcome.deviations, ['A skipped the cache', 'B kept the old flag']);
    assert.match(outcomeLine(dir), /Accepted deviations: A skipped the cache; B kept the old flag\./);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha']);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('deviations that differ only in whitespace are one deviation, and the outcome line uses the registry order', t => {
    const dir = fixture(t);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    const done = complete(dir, 'acme.alpha', first, { deviations: ['b  lower', 'C upper', 'b lower', ' a lower '] });
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    // Code-unit order would put "C upper" first; the projection's order does not.
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).deviations, ['a lower', 'b lower', 'C upper']);
    assert.match(outcomeLine(dir), /Accepted deviations: a lower; b lower; C upper\./);
  });

  it('more than 20 distinct deviations are refused and nothing is written', t => {
    const dir = fixture(t);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    const before = readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8');
    const deviations = Array.from({ length: 21 }, (_, i) => `deviation ${String(i).padStart(2, '0')}`);
    assert.throws(() => complete(dir, 'acme.alpha', first, { deviations }), /at most 20 deviations/);
    assert.equal(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'), before);
    // A duplicate does not count against the bound.
    assert.equal(complete(dir, 'acme.alpha', first, { deviations: [...deviations.slice(0, 20), deviations[0]] }).status, 'VERIFIED');
  });

  it('evidence whose code-unit and projection orders differ completes, and the plan shows the recorded order', t => {
    const dir = fixture(t);
    const first = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    write(dir, 'src/Zeta.js', '/** @implements acme.alpha#FR-001 */\nexport const zeta = true;\n');
    git(dir, ['add', '-A']);
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'add Zeta']);
    const expected = ['docs-canonical/ARCHITECTURE.md', 'src/alpha.js', 'src/Zeta.js', 'tests/alpha.test.js'];
    const plan = completeSpec(dir, {}, { id: 'acme.alpha', since: first }, { guardResult: passingGuard });
    assert.equal(plan.status, 'READY', JSON.stringify(plan.blockers));
    assert.deepEqual(plan.evidence, expected);
    const done = complete(dir, 'acme.alpha', first);
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).evidence, expected);
    assert.match(outcomeLine(dir), /Evidence: `docs-canonical\/ARCHITECTURE\.md`, `src\/alpha\.js`, `src\/Zeta\.js`, `tests\/alpha\.test\.js`\./);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha']);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('re-anchoring keeps the recorded deviations and leaves the registry current', t => {
    const { dir } = squashMerged(t, { deviations: ['B kept the old flag', 'A skipped the cache'] });
    const result = reanchorSpec(dir, {}, { id: 'acme.alpha', write: true });
    assert.equal(result.status, 'REANCHORED', JSON.stringify(result.blockers));
    assert.deepEqual(recorded(dir, 'acme.alpha').outcomes.at(-1).deviations, ['A skipped the cache', 'B kept the old flag']);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'reanchor']);
    assert.equal(projectSpecRegistry(dir).current, true);
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

describe('the behaviour is documented (FR-005)', () => {
  it('commands, DATA-MODEL and CI-RECIPES explain re-anchoring and the squash-merge workflow', () => {
    const read = p => readFileSync(p, 'utf8');
    assert.match(read('docs/commands.md'), /specs reanchor[\s\S]*SPR008/);
    assert.match(read('docs-canonical/DATA-MODEL.md'), /reanchoredFrom[\s\S]*blob-equal[\s\S]*attested/);
    assert.match(read('docs-canonical/CI-RECIPES.md'), /Under squash merges, run completions on a branch whose HEAD is the default\s+branch's tip/);
  });
});

describe('this repository keeps every recorded revision on its history (SC-003)', () => {
  it('reports no dangling review revision', () => {
    const dangling = validateSpecRegistry(process.cwd(), {}).findings.filter(f => f.code === 'SPR008');
    assert.deepEqual(dangling.map(f => f.message), []);
  });
});

// A recorded revision far enough behind HEAD that the range's patch exceeds
// the per-call budget (FR-008, FR-009, SC-004). The budget is shrunk to 8 KiB
// so a fixture of a few files crosses it; the code path is the one the 5 MB
// default takes.
describe('a recorded range past the diff budget (FR-008, FR-009, SC-004)', () => {
  const limits = { maxPatchBytes: 8192 };
  const plan = (dir, since) => planSpecCompletion(dir, {}, { id: 'acme.alpha', since }, { guardResult: passingGuard, diffLimits: limits });
  const maintain = (dir, since) => completeSpec(dir, {}, { id: 'acme.alpha', since, write: true, reason: 'Reviewed maintenance in the fixture' }, { guardResult: passingGuard, diffLimits: limits });
  const outcomeLine = dir => readFileSync(join(dir, 'specs/001-alpha/spec.md'), 'utf8').split('\n').filter(line => line.startsWith('- `')).at(-1);
  const filler = n => Array.from({ length: n }, (_, i) => `line ${i} of unrelated data`).join('\n');

  /** acme.alpha is a verified living spec recorded at `recordedAt`; `commits` follow it. */
  function verifiedLiving(t) {
    const dir = fixture(t);
    const registry = readSpecRegistry(dir).value;
    registry.specs.find(spec => spec.specId === 'acme.alpha').reviewed.lifecycle.persistenceModel = 'living';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'living alpha']);
    const root = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    assert.equal(complete(dir, 'acme.alpha', root).status, 'VERIFIED');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha']);
    // Completion records the revision it reviewed, the parent of its own commit.
    const recordedAt = recorded(dir, 'acme.alpha').lastReviewedRevision;
    const verifiedAt = git(dir, ['rev-parse', 'HEAD']);
    // Unlinked data, each file under the budget, together over it.
    for (const name of ['a', 'b', 'c', 'd']) write(dir, `data/${name}.txt`, filler(120));
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'unrelated data']);
    const afterData = git(dir, ['rev-parse', 'HEAD']);
    // A linked change that qualifies the living spec for maintenance.
    write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'alpha changes']);
    return { dir, root, recordedAt, verifiedAt, afterData };
  }

  it('reads an over-budget range in batches with complete coverage, the same as one read', t => {
    const { dir, recordedAt } = verifiedLiving(t);
    const batched = buildReconciliationPlan(dir, {}, recordedAt, { diffLimits: limits });
    assert.equal(batched.coverage.status, 'complete', batched.coverage.reason);
    assert.ok(batched.range.batches > 1, `expected several batches, got ${batched.range.batches}`);
    const single = buildReconciliationPlan(dir, {}, recordedAt);
    assert.equal(single.range.batches, 1);
    assert.deepEqual(batched.classifications, single.classifications);
    assert.equal(batched.range.patchBytes, single.range.patchBytes);
  });

  it('completes maintenance from the recorded revision without --since', t => {
    const { dir, recordedAt } = verifiedLiving(t);
    const done = maintain(dir);
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    assert.equal(done.reconciliation.baseRevision, recordedAt);
    assert.equal(recorded(dir, 'acme.alpha').outcomes.at(-1).narrowedFrom, undefined);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'maintain alpha']);
    assert.equal(projectSpecRegistry(dir).current, true);
  });

  it('refuses a newer --since while the recorded range can be reconciled, and writes nothing', t => {
    const { dir, afterData } = verifiedLiving(t);
    const before = readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8');
    const result = maintain(dir, afterData);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(b => b.code === 'SPC006' && /can be reconciled; omit --since/.test(b.message)), JSON.stringify(result.blockers));
    assert.equal(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'), before);
  });

  it('an older --since widens the review and records nothing extra', t => {
    const { dir, root } = verifiedLiving(t);
    const done = maintain(dir, root);
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    assert.equal(done.reconciliation.baseRevision, root);
    assert.equal(recorded(dir, 'acme.alpha').outcomes.at(-1).narrowedFrom, undefined);
  });

  it('refuses a --since unrelated to the recorded revision', t => {
    const { dir } = verifiedLiving(t);
    const tree = git(dir, ['rev-parse', 'HEAD^{tree}']);
    const orphan = git(dir, ['commit-tree', tree, '-m', 'unrelated history']);
    const result = plan(dir, orphan);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(b => b.code === 'SPC006' && /neither an ancestor nor a descendant/.test(b.message)), JSON.stringify(result.blockers));
  });

  it('refuses --since when the recorded revision does not resolve, and names reanchor', t => {
    const { dir, root } = verifiedLiving(t);
    const registry = readSpecRegistry(dir).value;
    registry.specs.find(spec => spec.specId === 'acme.alpha').reviewed.reconciliation.lastReviewedRevision = 'f'.repeat(40);
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'lost revision']);
    const result = plan(dir, root);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(b => b.code === 'SPC006' && /docguard specs reanchor --id acme\.alpha/.test(b.message)), JSON.stringify(result.blockers));
  });

  describe('one file over the per-call budget', () => {
    function oversized(t) {
      const fixtureState = verifiedLiving(t);
      const { dir, verifiedAt } = fixtureState;
      // Rewrite history so the oversized file lands right after the completion commit.
      git(dir, ['reset', '-q', '--hard', verifiedAt]);
      write(dir, 'data/huge.txt', filler(600));
      git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'huge data']);
      const afterHuge = git(dir, ['rev-parse', 'HEAD']);
      write(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
      git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'alpha changes']);
      return { ...fixtureState, afterHuge };
    }

    it('blocks without --since and names the file', t => {
      const { dir } = oversized(t);
      const result = plan(dir);
      assert.equal(result.status, 'BLOCKED');
      assert.ok(result.blockers.some(b => b.code === 'SPC006' && /unsupported or blocked/.test(b.message)));
      assert.equal(result.reconciliation.range.status, 'too-large');
      assert.match(result.reconciliation.coverage.reason, /data\/huge\.txt/);
    });

    it('completes from a newer --since and records the range it did not reconcile', t => {
      const { dir, recordedAt, afterHuge } = oversized(t);
      const done = maintain(dir, afterHuge.slice(0, 12));
      assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
      const narrowed = recorded(dir, 'acme.alpha').outcomes.at(-1).narrowedFrom;
      assert.deepEqual({ ...narrowed, reason: undefined }, { revision: recordedAt, since: afterHuge, skippedCommits: 2, reason: undefined });
      assert.match(narrowed.reason, /data\/huge\.txt/);
      assert.match(outcomeLine(dir), new RegExp(`Not reconciled: \`${recordedAt.slice(0, 12)}\`\\.\\.\`${afterHuge.slice(0, 12)}\` \\(2 commits\\)`));
      git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'maintain alpha']);
      assert.equal(projectSpecRegistry(dir).current, true);
      assert.deepEqual(projectSpecRegistry(dir).issues, []);
    });
  });
});

describe('a spec-text amendment alone does not qualify maintenance (edge case)', () => {
  it('a new requirement in spec.md with no linked source, test or canonical change stays blocked', t => {
    const dir = fixture(t);
    const registry = readSpecRegistry(dir).value;
    registry.specs.find(spec => spec.specId === 'acme.alpha').reviewed.lifecycle.persistenceModel = 'living';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'living alpha']);
    const root = git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
    assert.equal(complete(dir, 'acme.alpha', root).status, 'VERIFIED');
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'verify alpha']);
    const spec = readFileSync(join(dir, 'specs/001-alpha/spec.md'), 'utf8');
    write(dir, 'specs/001-alpha/spec.md', spec.replace('- **FR-001**: alpha MUST work.\n', '- **FR-001**: alpha MUST work.\n- **FR-002**: alpha MUST also log.\n'));
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'amend alpha']);
    const result = planSpecCompletion(dir, {}, { id: 'acme.alpha' }, { guardResult: passingGuard });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(b => /new linked source, test, canonical-document, or decision change/.test(b.message)));
  });
});

describe('the budget behaviour is documented (FR-010)', () => {
  it('help, commands and DATA-MODEL describe batched reading and narrowedFrom', () => {
    const read = p => readFileSync(p, 'utf8');
    assert.match(read('cli/docguard.mjs'), /narrowedFrom/);
    assert.match(read('docs/commands.md'), /batches[\s\S]*narrowedFrom/);
    assert.match(read('docs-canonical/DATA-MODEL.md'), /narrowedFrom[\s\S]*skippedCommits/);
  });
});
