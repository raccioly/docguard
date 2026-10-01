/**
 * A project's first spec can pass preflight (specs/040-spec-preflight-first-spec).
 *
 * The mandatory `before_tasks` hook runs `specs preflight --path <draft>`. It
 * blocked every project's first spec: with no registry (SPR001), and again
 * once `specs --write` had registered the draft (SPR004 + SPR001). These tests
 * reproduce that, then the related defects: no command to approve a spec,
 * SPC codes `explain` could not explain, a spec-first hint naming DocGuard's
 * own spec, the transition `specs complete` printed, and `reanchor --to HEAD`.
 * Every case runs in a temporary git repository.
 *
 * @req docguard.first-spec-preflight#FR-001
 * @req docguard.first-spec-preflight#FR-002
 * @req docguard.first-spec-preflight#FR-003
 * @req docguard.first-spec-preflight#FR-004
 * @req docguard.first-spec-preflight#FR-005
 * @req docguard.first-spec-preflight#FR-006
 * @req docguard.first-spec-preflight#FR-007
 * @req docguard.first-spec-preflight#FR-008
 * @req docguard.first-spec-preflight#FR-009
 * @req docguard.first-spec-preflight#FR-010
 * @req docguard.first-spec-preflight#FR-011
 * @req docguard.first-spec-preflight#SC-001
 * @req docguard.first-spec-preflight#SC-002
 * @req docguard.first-spec-preflight#SC-003
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { preflightSpec, projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { approveSpec, completeSpec, planSpecCompletion, reanchorSpec } from '../cli/commands/specs.mjs';
import { resolveCommit } from '../cli/scanners/revision-anchor.mjs';
import { classifySpecFirst } from '../cli/scanners/spec-first.mjs';
import { BLOCKER_CODES, CODES } from '../cli/findings.mjs';
import { notesSince } from './fixtures/changelog-notes.mjs';

const CLI = resolve('cli/docguard.mjs');
const passingGuard = { status: 'PASS', errors: 0, warnings: 0 };
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const specText = (id, extra = '') => `# Feature ${id}\n\n**Spec ID**: \`${id}\`\n${extra}\n## Requirements\n\n- **FR-001**: The ${id} feature MUST work.\n`;

/** A Spec Kit project in a temporary git repository, with no registry. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'first-spec-'));
  temps.push(dir);
  const write = (rel, content) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); };
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'gc.auto', '0'); git('config', 'maintenance.auto', 'false');
  write('.docguard.json', JSON.stringify({ projectName: 'acme' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  const commit = msg => { git('add', '-A'); git('commit', '-qm', msg); };
  const registry = () => JSON.parse(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'));
  const setRegistry = value => write(SPEC_REGISTRY_PATH, `${JSON.stringify(value, null, 2)}\n`);
  return { dir, write, git, cli, commit, registry, setRegistry };
}

const preflight = (p, path) => p.cli('specs', 'preflight', ...(path ? ['--path', path] : []), '--format', 'json');
const codes = result => result.blockers.map(b => b.code).sort();

describe('the first spec passes the generated-spec preflight (FR-001, FR-002, SC-001)', () => {
  it('is READY with no registry when the draft is the only spec', () => {
    const p = project();
    p.write('specs/001-x/spec.md', specText('acme.x'));
    p.commit('draft');
    const run = preflight(p, 'specs/001-x/spec.md');
    const result = run.json();
    assert.deepEqual(result.blockers, [], 'a missing registry is valid when there are no prior specs');
    assert.equal(result.status, 'READY');
    assert.equal(run.status, 0);
  });

  it('is READY after `specs --write` registers the draft, and `specs --check` agrees', () => {
    const p = project();
    p.write('specs/001-x/spec.md', specText('acme.x'));
    assert.equal(p.cli('specs', '--write').status, 0);
    p.commit('draft and registry');
    const result = preflight(p, 'specs/001-x/spec.md').json();
    assert.deepEqual(result.blockers, [], 'the draft\'s own registry entry is not a spec that vanished');
    assert.equal(result.status, 'READY');
    const check = p.cli('specs', '--check', '--format', 'json');
    assert.equal(check.json().status, 'CURRENT');
    assert.equal(check.status, 0);
  });

  it('is READY when the draft changed after it was registered', () => {
    const p = project();
    p.write('specs/001-x/spec.md', specText('acme.x'));
    p.cli('specs', '--write');
    p.commit('registered');
    p.write('specs/001-x/spec.md', `${specText('acme.x')}- **FR-002**: The feature MUST also log.\n`);
    assert.equal(preflight(p, 'specs/001-x/spec.md').json().status, 'READY');
  });

  it('is READY when the registered draft\'s Spec ID was changed', () => {
    const p = project();
    p.write('specs/001-x/spec.md', specText('acme.x'));
    p.cli('specs', '--write');
    p.commit('registered');
    p.write('specs/001-x/spec.md', specText('acme.renamed'));
    const result = preflightSpec(p.dir, {}, 'specs/001-x/spec.md');
    assert.deepEqual(result.blockers, []);
  });

  it('a registered second spec is READY (it reported SPR004 before)', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.write('specs/002-b/spec.md', specText('acme.b'));
    p.cli('specs', '--write');
    p.commit('two specs');
    const result = preflightSpec(p.dir, {}, 'specs/002-b/spec.md');
    assert.deepEqual(result.blockers, []);
    assert.equal(result.status, 'READY');
  });

  it('an unregistered second spec is READY, as before', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.cli('specs', '--write');
    p.write('specs/002-b/spec.md', specText('acme.b'));
    assert.equal(preflightSpec(p.dir, {}, 'specs/002-b/spec.md').status, 'READY');
  });
});

describe('a genuinely stale registry still blocks (FR-003)', () => {
  it('blocks SPR001 when another spec changed after the registry was written', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.cli('specs', '--write');
    p.write('specs/001-a/spec.md', `${specText('acme.a')}- **FR-002**: A MUST also log.\n`);
    p.write('specs/002-b/spec.md', specText('acme.b'));
    assert.deepEqual(codes(preflightSpec(p.dir, {}, 'specs/002-b/spec.md')), ['SPR001']);
  });

  it('blocks SPR001 with no registry when another spec exists', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.write('specs/002-b/spec.md', specText('acme.b'));
    assert.deepEqual(codes(preflightSpec(p.dir, {}, 'specs/002-b/spec.md')), ['SPR001']);
  });

  it('blocks SPR001 with no registry when the archive records a retired spec', () => {
    const p = project();
    p.write('.docguard-archive.json', JSON.stringify({
      schemaVersion: 1,
      strategy: 'git-history',
      retention: { ref: 'refs/heads/main', objectFormat: 'sha1', recoverability: 'verified' },
      entries: [{ path: 'specs/000-old/spec.md', archivedFrom: '0'.repeat(40), blob: '1'.repeat(40), reason: 'Superseded', requirementIds: ['FR-001'] }],
    }));
    p.write('specs/001-x/spec.md', specText('acme.x'));
    assert.ok(codes(preflightSpec(p.dir, {}, 'specs/001-x/spec.md')).includes('SPR001'));
  });

  it('a reused Spec ID is still one SPR002', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.cli('specs', '--write');
    p.write('specs/002-b/spec.md', specText('acme.a'));
    const result = preflightSpec(p.dir, {}, 'specs/002-b/spec.md');
    assert.deepEqual(codes(result), ['SPR002']);
    assert.match(result.blockers[0].message, /already belongs to specs\/001-a\/spec\.md/);
  });
});

describe('the briefing is the same with and without --path (FR-004)', () => {
  it('lists the draft in both', () => {
    const p = project();
    p.write('specs/001-a/spec.md', specText('acme.a'));
    p.write('specs/002-b/spec.md', specText('acme.b'));
    p.cli('specs', '--write');
    p.commit('two specs');
    const plain = preflight(p).json().briefing.map(s => s.specId);
    const withPath = preflight(p, 'specs/002-b/spec.md').json().briefing.map(s => s.specId);
    assert.deepEqual(withPath, plain);
    assert.deepEqual(plain, ['acme.a', 'acme.b']);
    assert.match(p.cli('specs', 'preflight', '--path', 'specs/002-b/spec.md').stdout, /Current specs: 2/);
  });
});

/** An implemented spec with evidence, a checked task and a registry, all committed. */
function implemented() {
  const p = project();
  p.write('specs/001-x/spec.md', specText('acme.x'));
  p.write('specs/001-x/tasks.md', '# Tasks\n\n- [x] T001 Build.\n');
  p.write('src/x.js', '/** @implements acme.x#FR-001 */\nexport const x = true;\n');
  p.write('tests/x.test.js', '/** @req acme.x#FR-001 */\ntest("x", () => {});\n');
  p.write('docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  p.commit('feature');
  // The registry reads tracked files only, so it is written after the commit.
  p.cli('specs', '--write');
  p.commit('registry');
  return p;
}

describe('specs approve records approval without a hand edit (FR-005)', () => {
  it('plans by default and writes nothing', () => {
    const p = implemented();
    const before = readFileSync(join(p.dir, SPEC_REGISTRY_PATH), 'utf8');
    const plan = approveSpec(p.dir, {}, { id: 'acme.x' });
    assert.equal(plan.status, 'READY');
    assert.deepEqual(plan.transition, { approval: 'draft→approved', delivery: 'planned→planned' });
    assert.equal(plan.applied, false);
    assert.equal(readFileSync(join(p.dir, SPEC_REGISTRY_PATH), 'utf8'), before);
  });

  it('--write changes only the approval field', () => {
    const p = implemented();
    const expected = p.registry();
    expected.specs[0].reviewed.lifecycle.approval = 'approved';
    const result = p.cli('specs', 'approve', '--id', 'acme.x', '--write', '--format', 'json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json().status, 'APPROVED');
    assert.deepEqual(p.registry(), expected);
    assert.equal(projectSpecRegistry(p.dir).current, true);
  });

  it('--delivery records the delivery state', () => {
    const p = implemented();
    const result = p.cli('specs', 'approve', '--id', 'acme.x', '--delivery', 'implemented', '--write', '--format', 'json');
    assert.equal(result.json().status, 'APPROVED', result.stdout);
    assert.deepEqual(result.json().transition, { approval: 'draft→approved', delivery: 'planned→implemented' });
    assert.equal(p.registry().specs[0].reviewed.lifecycle.delivery, 'implemented');
  });

  it('is CURRENT when there is nothing to change', () => {
    const p = implemented();
    approveSpec(p.dir, {}, { id: 'acme.x', write: true });
    const before = readFileSync(join(p.dir, SPEC_REGISTRY_PATH), 'utf8');
    assert.equal(approveSpec(p.dir, {}, { id: 'acme.x', write: true }).status, 'CURRENT');
    assert.equal(readFileSync(join(p.dir, SPEC_REGISTRY_PATH), 'utf8'), before);
  });

  for (const delivery of ['verified', 'released', 'bogus']) {
    it(`refuses --delivery ${delivery} (SPC002)`, () => {
      const p = implemented();
      const result = approveSpec(p.dir, {}, { id: 'acme.x', delivery, write: true });
      assert.equal(result.status, 'BLOCKED');
      assert.deepEqual(codes(result), ['SPC002']);
      assert.equal(p.registry().specs[0].reviewed.lifecycle.approval, 'draft');
    });
  }

  it('refuses to move a verified spec back', () => {
    const p = implemented();
    const registry = p.registry();
    Object.assign(registry.specs[0].reviewed.lifecycle, { approval: 'approved', delivery: 'verified' });
    p.setRegistry(registry);
    const result = approveSpec(p.dir, {}, { id: 'acme.x', delivery: 'in_progress', write: true });
    assert.deepEqual(codes(result), ['SPC002']);
    assert.match(result.blockers[0].message, /specs complete/);
  });

  it('refuses an unknown ID and a stale registry (SPC001)', () => {
    const p = implemented();
    assert.deepEqual(codes(approveSpec(p.dir, {}, { id: 'acme.nope' })), ['SPC001']);
    assert.deepEqual(codes(approveSpec(p.dir, {}, {})), ['SPC001']);
    p.write('specs/001-x/spec.md', `${specText('acme.x')}- **FR-002**: X MUST also log.\n`);
    const stale = approveSpec(p.dir, {}, { id: 'acme.x', write: true });
    assert.ok(stale.blockers.some(b => b.code === 'SPC001' && /specs --write/.test(b.message)), JSON.stringify(stale.blockers));
  });

  it('never reads approval from the spec\'s prose', () => {
    const p = project();
    p.write('specs/001-x/spec.md', specText('acme.x', '\n**Status**: Approved\n'));
    p.cli('specs', '--write');
    assert.equal(p.registry().specs[0].reviewed.lifecycle.approval, 'draft');
  });

  it('is listed in `specs --help` and the top-level help', () => {
    const p = project();
    assert.match(p.cli('specs', '--help').stdout, /approve/);
    assert.match(p.cli('--help').stdout, /approve/);
  });
});

describe('SPC002 says how to approve (FR-006)', () => {
  it('names the approve command for approval and for delivery', () => {
    const p = implemented();
    const plan = planSpecCompletion(p.dir, {}, { id: 'acme.x', since: 'HEAD' }, { guardResult: passingGuard });
    const spc002 = plan.blockers.filter(b => b.code === 'SPC002').map(b => b.message);
    assert.equal(spc002.length, 2, JSON.stringify(plan.blockers));
    assert.match(spc002[0], /docguard specs approve --id acme\.x --write/);
    assert.match(spc002[1], /docguard specs approve --id acme\.x --delivery implemented --write/);
  });
});

describe('a spec reaches verified with no hand edit to its lifecycle (SC-002)', () => {
  it('draft → approved/implemented → verified', () => {
    const p = implemented();
    // Scope is a separate reviewed field (see Out of Scope); approval and delivery are not hand-edited.
    const registry = p.registry();
    registry.specs[0].reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
    p.setRegistry(registry);
    p.commit('scope');
    assert.equal(p.cli('specs', 'approve', '--id', 'acme.x', '--delivery', 'implemented', '--write').status, 0);
    p.commit('approve');
    const base = p.git('rev-list', '--max-parents=0', 'HEAD');
    const done = completeSpec(p.dir, {}, { id: 'acme.x', since: base, write: true, reason: 'Reviewed in the fixture.' }, { guardResult: passingGuard });
    assert.equal(done.status, 'VERIFIED', JSON.stringify(done.blockers));
    assert.equal(done.transition, 'implemented→verified');
    assert.equal(p.registry().specs[0].reviewed.lifecycle.delivery, 'verified');
  });
});

describe('every SPC code is explainable (FR-007, SC-003)', () => {
  const used = [...new Set(readdirSync('cli/commands').filter(f => f.endsWith('.mjs'))
    .flatMap(f => [...readFileSync(join('cli/commands', f), 'utf8').matchAll(/code: '(SPC\d{3})'/g)].map(m => m[1])))].sort();

  it('the CLI uses SPC001–SPC008 and each has an entry', () => {
    assert.deepEqual(used, ['SPC001', 'SPC002', 'SPC003', 'SPC004', 'SPC005', 'SPC006', 'SPC007', 'SPC008']);
    for (const code of used) assert.ok(BLOCKER_CODES[code]?.help?.length > 40, code);
  });

  for (const code of ['SPC001', 'SPC002', 'SPC003', 'SPC004', 'SPC005', 'SPC006', 'SPC007', 'SPC008']) {
    it(`docguard explain ${code}`, () => {
      const r = spawnSync(process.execPath, [CLI, 'explain', code, '--format', 'json'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout);
      const body = JSON.parse(r.stdout);
      assert.equal(body.code, code);
      assert.equal(body.title, BLOCKER_CODES[code].title);
      assert.equal(body.command, BLOCKER_CODES[code].command);
      const text = spawnSync(process.execPath, [CLI, 'explain', code.toLowerCase()], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      assert.equal(text.status, 0);
      assert.match(text.stdout, new RegExp(`${code} — `));
      assert.doesNotMatch(text.stdout, /No matching validator/);
    });
  }

  it('SPC002 explains approve', () => assert.match(BLOCKER_CODES.SPC002.help, /docguard specs approve/));

  it('the MCP explain tool answers SPC codes', () => {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docguard_explain', arguments: { code: 'spc006' } } },
    ].map(m => JSON.stringify(m)).join('\n');
    const r = spawnSync(process.execPath, [CLI, 'mcp'], { input: `${input}\n`, encoding: 'utf8', timeout: 20000 });
    const reply = r.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(m => m.id === 2);
    assert.ok(reply && !reply.result.isError, r.stdout);
    const payload = JSON.parse(reply.result.content[0].text);
    assert.equal(payload.code, 'SPC006');
    assert.equal(payload.command, BLOCKER_CODES.SPC006.command);
  });

  it('SPC codes are not finding codes: findingSeverity rejects them', () => {
    for (const code of used) assert.equal(CODES[code], undefined, `${code} must not be a finding code`);
    const p = project();
    p.write('.docguard.json', JSON.stringify({ projectName: 'acme', findingSeverity: { SPC002: 'low' } }));
    const r = p.cli('guard', '--format', 'json');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /findingSeverity\.SPC002 is not a known finding code/);
  });
});

describe('the spec-first gate speaks about the user\'s project (FR-008)', () => {
  const inventory = { dirs: new Set(['001-x']), ids: new Map([['acme.x', 'specs/001-x']]) };
  const classify = text => classifySpecFirst({ paths: ['src/a.js'], text, config: {}, inventory });

  it('lists a labelled Spec ID that matches no spec as unresolved', () => {
    for (const text of ['Spec: acme.typo', 'Spec ID: `acme.typo`', '**Spec ID**: acme.typo']) {
      const result = classify(text);
      assert.deepEqual(result.unresolved, ['acme.typo'], text);
      assert.equal(result.status, 'uncovered');
    }
  });

  it('does not treat unlabelled dotted words as references', () => {
    assert.deepEqual(classify('Touches cli/docguard.mjs and v1.2, e.g. node.js').unresolved, []);
  });

  it('a labelled ID that resolves covers the change', () => {
    const result = classify('Spec: acme.x');
    assert.equal(result.status, 'covered');
    assert.deepEqual(result.unresolved, []);
  });

  it('the fix hint names no DocGuard spec and states the reason minimum', () => {
    const p = project();
    p.write('src/a.js', 'export const a = 1;\n');
    p.commit('base');
    const base = p.git('rev-parse', 'HEAD');
    p.write('src/a.js', 'export const a = 2;\n');
    p.commit('change');
    const r = p.cli('specs', 'require', '--since', base);
    assert.equal(r.status, 1, r.stdout);
    assert.doesNotMatch(r.stdout, /015-spec-first-gate/);
    assert.match(r.stdout, /specs\/<###-feature>/);
    assert.match(r.stdout, /10\+ characters/);
  });
});

describe('specs complete reports the real transition (FR-009)', () => {
  const setLifecycle = (p, lifecycle) => {
    const registry = p.registry();
    Object.assign(registry.specs[0].reviewed.lifecycle, lifecycle);
    p.setRegistry(registry);
  };
  const transition = p => planSpecCompletion(p.dir, {}, { id: 'acme.x', since: 'HEAD' }, { guardResult: passingGuard }).transition;

  it('planned→verified, not implemented→verified', () => {
    const p = implemented();
    assert.equal(transition(p), 'planned→verified');
    assert.match(p.cli('specs', 'complete', '--id', 'acme.x', '--since', 'HEAD').stdout, /acme\.x: planned→verified/);
  });

  it('verified→verified for a verified spec that is not living', () => {
    const p = implemented();
    setLifecycle(p, { approval: 'approved', delivery: 'verified' });
    assert.equal(transition(p), 'verified→verified');
  });

  it('in_progress and implemented keep their transitions', () => {
    const p = implemented();
    setLifecycle(p, { approval: 'approved', delivery: 'in_progress' });
    assert.equal(transition(p), 'in_progress→implemented→verified');
    setLifecycle(p, { delivery: 'implemented' });
    assert.equal(transition(p), 'implemented→verified');
  });

  it('none for an unknown spec', () => {
    const p = implemented();
    assert.equal(planSpecCompletion(p.dir, {}, { id: 'acme.nope', since: 'HEAD' }, { guardResult: passingGuard }).transition, null);
  });
});

describe('reanchor --to accepts any revision git resolves (FR-010)', () => {
  it('resolveCommit returns the full SHA, or null', () => {
    const p = implemented();
    const head = p.git('rev-parse', 'HEAD');
    assert.equal(resolveCommit(p.dir, 'HEAD'), head);
    assert.equal(resolveCommit(p.dir, 'main'), head);
    assert.equal(resolveCommit(p.dir, head.slice(0, 9)), head);
    assert.equal(resolveCommit(p.dir, 'no-such-ref'), null);
    assert.equal(resolveCommit(p.dir, '--output=/tmp/x'), null);
    assert.equal(resolveCommit(p.dir, ''), null);
  });

  it('`--to HEAD` records the full SHA', () => {
    const p = implemented();
    const registry = p.registry();
    registry.specs[0].reviewed.lifecycle.approval = 'approved';
    registry.specs[0].reviewed.reconciliation.lastReviewedRevision = 'f'.repeat(40);
    p.setRegistry(registry);
    p.commit('a revision that no longer resolves');
    const head = p.git('rev-parse', 'HEAD');
    const result = reanchorSpec(p.dir, {}, { id: 'acme.x', to: 'HEAD', write: true, reason: 'HEAD carries the reviewed evidence' });
    assert.equal(result.status, 'REANCHORED', JSON.stringify(result.blockers));
    assert.equal(result.moves[0].to, head);
    assert.equal(p.registry().specs[0].reviewed.reconciliation.lastReviewedRevision, head);
  });

  it('refuses a value that git would read as an option', () => {
    const p = implemented();
    const registry = p.registry();
    registry.specs[0].reviewed.reconciliation.lastReviewedRevision = 'f'.repeat(40);
    p.setRegistry(registry);
    p.commit('dangling');
    const result = reanchorSpec(p.dir, {}, { id: 'acme.x', to: '--all', reason: 'an option, not a revision' });
    assert.equal(result.status, 'BLOCKED');
    assert.match(result.blockers[0].message, /--to --all must name a commit on HEAD's history/);
  });
});

describe('the docs describe the fix (FR-011)', () => {
  const read = path => readFileSync(path, 'utf8');
  it('docs/commands.md', () => {
    const text = read('docs/commands.md');
    assert.match(text, /specs approve --id/);
    assert.match(text, /first spec/i);
    assert.match(text, /10 characters/);
    assert.match(text, /--to <revision>.*(branch|tag|HEAD)/s);
  });
  it('README.md', () => assert.match(read('README.md'), /specs approve/));
  it('DATA-MODEL.md', () => assert.match(read('docs-canonical/DATA-MODEL.md'), /specs approve/));
  it('SECURITY.md', () => assert.match(read('docs-canonical/SECURITY.md'), /specs approve --write/));
  it('CHANGELOG.md, in the notes since 0.42.1', () => {
    const text = read('CHANGELOG.md');
    const unreleased = notesSince(text, '0.42.1');
    assert.match(unreleased, /first spec/i);
    assert.match(unreleased, /specs approve/);
  });
});
