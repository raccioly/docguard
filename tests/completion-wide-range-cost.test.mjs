/**
 * What `specs complete` costs over a wide range does not grow with the range's
 * shape (issue 684 item 4, specs/103-completion-upkeep FR-019).
 *
 * Measured on this repository before the change (593 commits, 98 specs, one run of
 * `specs complete --id <spec> --since HEAD~300`): about 210 git processes, 76 of them
 * one `git rev-parse` per spec directory in the feature history, and 2.8 s of a 4.6 s
 * reconciliation spent asking, for every changed file, whether its text contains any
 * requirement identity of any spec. The tests pin the properties that keep it flat:
 * the same answers from a bounded number of git processes, one guard run per plan,
 * and a range-readability question that does not classify the range.
 *
 * @req docguard.completion-upkeep#FR-019
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { planSpecCompletion } from '../cli/commands/specs.mjs';
import { buildReconciliationPlan, reconciliationRangeStatus } from '../cli/scanners/reconciliation.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { createFeatureHistory } from '../cli/scanners/speckit.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const passingGuard = { status: 'PASS', errors: 0, warnings: 0 };

const git = (dir, args) => execFileSync('git', [...FIXTURE_GIT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function put(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** The git processes `fn` starts, by subcommand (GIT_TRACE2_EVENT, as tests/guard-git-cost.test.mjs). */
function gitProcesses(t, fn) {
  const trace = join(makeTempDir('dg-wide-trace-', t), 'trace2.json');
  const previous = process.env.GIT_TRACE2_EVENT;
  process.env.GIT_TRACE2_EVENT = trace;
  try { fn(); } finally {
    if (previous === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = previous;
  }
  const counts = {};
  for (const line of readFileSync(trace, 'utf8').split('\n').filter(Boolean)) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.event === 'cmd_name') counts[event.name] = (counts[event.name] || 0) + 1;
  }
  return counts;
}

function repo(t) {
  const dir = makeTempDir('dg-wide-', t);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  put(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  put(dir, 'README.md', '# Fixture\n');
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'scaffold']);
  return dir;
}

const commit = (dir, message) => { git(dir, ['add', '-A']); git(dir, ['commit', '-qm', message]); return git(dir, ['rev-parse', 'HEAD']); };

/** The registry, with every spec approved and implemented (a removal is attributed only to an approved, current spec). */
function approveAll(dir) {
  const registry = projectSpecRegistry(dir).registry;
  for (const spec of registry.specs) {
    spec.reviewed.lifecycle.approval = 'approved';
    spec.reviewed.lifecycle.delivery = 'implemented';
    spec.reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
  }
  put(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

function addSpec(dir, name, { requirements = ['FR-001'], extra = '' } = {}) {
  put(dir, `specs/${name}/spec.md`, `# ${name}\n\n**Spec ID**: \`acme.${name}\`\n\n${requirements.map(id => `- **${id}**: ${name} MUST work.`).join('\n')}\n${extra}`);
  put(dir, `specs/${name}/tasks.md`, '# Tasks\n\n- [x] T001 Build.\n');
}

describe('a requirement mention is found as before, from fewer scans (FR-019)', () => {
  it('keeps substring semantics and ignores other specs and bare identifiers', t => {
    const dir = repo(t);
    addSpec(dir, 'alpha');
    addSpec(dir, 'beta', { requirements: ['FR-001', 'FR-002'] });
    for (const name of ['a', 'b', 'c', 'd']) put(dir, `src/${name}.js`, `export const ${name} = 1;\n`);
    const base = commit(dir, 'base');
    // `acme.alpha#FR-001` is a substring of `acme.alpha#FR-0012`: the original scan counted it, so does this one.
    put(dir, 'src/a.js', '// acme.alpha#FR-0012\nexport const a = 2;\n');
    put(dir, 'src/b.js', '// acme.beta#FR-002 and acme.alpha#FR-001\nexport const b = 2;\n');
    put(dir, 'src/c.js', '// #FR-001 with no spec id, and acme.gamma#FR-001 of a spec that does not exist\nexport const c = 2;\n');
    put(dir, 'src/d.js', 'export const d = 2;\n');
    commit(dir, 'edit');
    const plan = buildReconciliationPlan(dir, {}, base);
    const specsOf = path => plan.classifications.find(item => item.path === path)?.specs;
    assert.deepEqual(specsOf('src/a.js'), ['acme.alpha']);
    assert.deepEqual(specsOf('src/b.js'), ['acme.alpha', 'acme.beta']);
    assert.deepEqual(specsOf('src/c.js'), []);
    assert.deepEqual(specsOf('src/d.js'), []);
  });
});

describe('the feature history asks git for the introducing commits once (FR-019)', () => {
  function specHistory(t, count) {
    const dir = repo(t);
    const dirs = [];
    for (let i = 0; i < count; i++) {
      const name = `s${String(i).padStart(2, '0')}`;
      addSpec(dir, name);
      put(dir, `src/s${i}.js`, `export const s${i} = ${i};\n`);
      commit(dir, `spec ${i}`);
      dirs.push(`specs/${name}`);
    }
    return { dir, dirs };
  }

  it('costs the same number of rev-parse processes for 3 specs as for 12, with the same answers', t => {
    const small = specHistory(t, 3);
    const large = specHistory(t, 12);
    const run = ({ dir, dirs }) => {
      const answers = [];
      const counts = gitProcesses(t, () => {
        const history = createFeatureHistory(dir, { specDirs: dirs });
        for (const specDir of dirs) answers.push([...history.touchedPaths(specDir)].sort());
      });
      return { counts, answers };
    };
    const a = run(small);
    const b = run(large);
    assert.equal(a.counts['rev-parse'], b.counts['rev-parse'], `rev-parse: ${JSON.stringify(a.counts)} vs ${JSON.stringify(b.counts)}`);
    // The one introducing-commit call, and the repository check; it was one call per spec (12 more here).
    assert.ok(b.counts['rev-parse'] <= 2, JSON.stringify(b.counts));
    // The window of the oldest spec reaches every later commit; the newest spec's window holds its own commit only.
    assert.ok(b.answers[0].includes('src/s11.js'));
    assert.deepEqual(b.answers[11].filter(path => path.startsWith('src/')), ['src/s11.js']);
  });

  it('falls back to the whole history when an introducing commit has no parent', t => {
    const dir = makeTempDir('dg-wide-root-', t);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    addSpec(dir, 'root');
    put(dir, 'src/root.js', 'export const root = 1;\n');
    commit(dir, 'root commit adds the spec');
    put(dir, 'src/later.js', 'export const later = 1;\n');
    commit(dir, 'later');
    const touched = createFeatureHistory(dir, { specDirs: ['specs/root'] }).touchedPaths('specs/root');
    assert.ok(touched.has('src/root.js') && touched.has('src/later.js'), [...touched].join(','));
  });
});

describe('a reconciliation lists the index once, however many directories were deleted (FR-019)', () => {
  function withDeletedDirectories(t, count) {
    const dir = repo(t);
    addSpec(dir, 'alpha', { extra: '\nThe `legacy/` directory is retired by this change.\n' });
    put(dir, 'legacy/keep.js', 'export const keep = 1;\n');
    for (let i = 0; i < count; i++) put(dir, `gone/d${i}/deep/file.js`, `export const f${i} = 1;\n`);
    put(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
    approveAll(dir);
    const base = commit(dir, 'base');
    for (let i = 0; i < count; i++) git(dir, ['rm', '-qr', `gone/d${i}`]);
    git(dir, ['rm', '-qr', 'legacy']);
    commit(dir, 'delete the directories');
    return { dir, base };
  }

  it('runs the same number of ls-files processes for 2 deleted directories as for 8', t => {
    const small = withDeletedDirectories(t, 2);
    const large = withDeletedDirectories(t, 8);
    const plan = ({ dir, base }) => { let result; const counts = gitProcesses(t, () => { result = buildReconciliationPlan(dir, {}, base); }); return { result, counts }; };
    const a = plan(small);
    const b = plan(large);
    assert.equal(a.counts['ls-files'], b.counts['ls-files'], `ls-files: ${JSON.stringify(a.counts)} vs ${JSON.stringify(b.counts)}`);
    // The same attribution as the per-directory question gave: a directory the spec names, gone entirely, links its files.
    assert.deepEqual(b.result.classifications.find(item => item.path === 'legacy/keep.js').specs, ['acme.alpha']);
    assert.deepEqual(b.result.classifications.find(item => item.path === 'gone/d3/deep/file.js').specs, []);
  });

  it('does not call a directory gone while a tracked file remains under it', t => {
    const dir = repo(t);
    addSpec(dir, 'alpha', { extra: '\nThe `shared/` directory is retired by this change.\n' });
    put(dir, 'shared/a.js', 'export const a = 1;\n');
    put(dir, 'shared/b.js', 'export const b = 1;\n');
    put(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
    approveAll(dir);
    const base = commit(dir, 'base');
    git(dir, ['rm', '-q', 'shared/a.js']);
    commit(dir, 'delete one file');
    const plan = buildReconciliationPlan(dir, {}, base);
    assert.deepEqual(plan.classifications.find(item => item.path === 'shared/a.js').specs, []);
  });
});

describe('the readability of a range is answered without classifying it (FR-019)', () => {
  function history(t) {
    const dir = repo(t);
    addSpec(dir, 'alpha');
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 1;\n');
    const base = commit(dir, 'base');
    for (const name of ['a', 'b', 'c']) put(dir, `data/${name}.txt`, Array.from({ length: 120 }, (_, i) => `line ${i} of unrelated data`).join('\n'));
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 2;\n');
    commit(dir, 'change');
    return { dir, base };
  }

  it('agrees with the full plan on the status and the reason for every limit', t => {
    const { dir, base } = history(t);
    for (const limits of [{}, { maxPatchBytes: 4096 }, { maxPatchBytes: 100 }, { maxChangedFiles: 1 }, { maxPatchBytes: 4096, maxBatchPaths: 1, maxRangePatchBytes: 2000 }]) {
      const full = buildReconciliationPlan(dir, {}, base, { diffLimits: limits });
      const asked = reconciliationRangeStatus(dir, base, { diffLimits: limits });
      const expected = full.status === 'BLOCKED' && full.range ? full.range.status : 'ok';
      assert.equal(asked.status, expected, JSON.stringify(limits));
      if (full.status === 'BLOCKED') assert.equal(asked.reason, full.coverage.reason, JSON.stringify(limits));
    }
    assert.equal(reconciliationRangeStatus(dir, 'no-such-ref', {}).status, 'unsupported');
  });

  it('classifies nothing: the registry is not projected for the answer', t => {
    const { dir, base } = history(t);
    const counts = gitProcesses(t, () => { reconciliationRangeStatus(dir, base, { diffLimits: { maxPatchBytes: 4096 } }); });
    // The full plan projects the registry, which lists the tracked files: the range question does not.
    assert.equal(counts['ls-files'] || 0, 0, JSON.stringify(counts));
  });
});

describe('a completion plan runs guard once (FR-019)', () => {
  it('plans a spec with one guard run, however wide the range', t => {
    const dir = repo(t);
    addSpec(dir, 'alpha');
    put(dir, 'src/alpha.js', '/** @implements acme.alpha#FR-001 */\nexport const alpha = 1;\n');
    put(dir, 'tests/alpha.test.js', '/** @req acme.alpha#FR-001 */\ntest("alpha", () => {});\n');
    put(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
    const root = commit(dir, 'initial');
    approveAll(dir);
    commit(dir, 'registry');
    for (let i = 0; i < 6; i++) { put(dir, `data/f${i}.txt`, `${i}\n`); commit(dir, `data ${i}`); }
    const shared = () => ({ reconcile: new Map(), anchorStatus: null, stats: { guardRuns: 0, reconciliations: 0 }, projection: projectSpecRegistry(dir, {}) });
    const own = shared();
    const plan = planSpecCompletion(dir, {}, { id: 'acme.alpha', since: root }, { shared: own });
    assert.equal(own.stats.guardRuns, 1);
    assert.equal(own.stats.reconciliations, 1);
    assert.equal(plan.reconciliation.range.commitCount, 7);
    // A guard result handed in is not recomputed.
    const reused = shared();
    planSpecCompletion(dir, {}, { id: 'acme.alpha', since: root }, { shared: reused, guardResult: passingGuard });
    assert.equal(reused.stats.guardRuns, 0);
  });
});
