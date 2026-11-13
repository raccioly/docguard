/**
 * Suspect and missing reviews of agent-instruction documents under strict
 * (specs/097-strict-by-default FR-021, T025a; the issue 628 fixture, T026 /
 * SC-004).
 *
 * Freshness examines many documents in one run. An agent-instruction document
 * whose review no longer covers it (FRS006's condition holds) or that has no
 * review point at all was not examined, even though Freshness performed real
 * checks on the others. The result carries those documents in
 * `unexaminedDocuments`; strict reports them in `strict.unexamined` and exits 4,
 * while `performed` stays the true count. `standard` is unchanged.
 *
 * @req docguard.strict-by-default#FR-007
 * @req docguard.strict-by-default#FR-015
 * @req docguard.strict-by-default#FR-021
 * @req docguard.strict-by-default#SC-004
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { isolateWithWaivers } from './helpers/strict-isolation.mjs';
import { buildStrictReport, couldNotReadLines } from '../cli/enforcement.mjs';
import { agentInstructionDocsWithoutReviewPoint, agentInstructionReviewStatus } from '../cli/scanners/recorded-review-signals.mjs';
import { validateFreshness, freshnessContract } from '../cli/validators/freshness.mjs';
import { toSarif } from '../cli/writers/sarif.mjs';
import { toJUnit as toJunit } from '../cli/writers/junit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const ALL_KEYS = [
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
const onlyFreshness = Object.fromEntries(ALL_KEYS.map(k => [k, k === 'freshness']));

const code = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

function commit(dir, files, message, date) {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-q', '--allow-empty', '-m', message], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` } });
}

// A harness skill a tool installed (no generated-by header, no install record) naming the engine.
const HARNESS_SKILL = { '.agents/skills/sample-harness/SKILL.md': '---\nname: sample-harness\ndescription: Run the sample harness against the engine.\n---\n\n# Sample harness\n\nCall `src/engine.mjs` with the probe input and compare the output.\nRun `npm test` afterwards.\n' };
// AGENTS.md as it would read after a review that follows the engine's growth (no FRS006 crossing).
const CURRENT_AGENTS = '# Agents\n\n- Run `npm test` before committing.\n- Keep changes small.\n<!-- docguard:last-reviewed 2026-03-05 -->\n';
const COPILOT = { '.github/copilot-instructions.md': '# Copilot\n\nUse `npm test`. Keep `src/engine.mjs` small and documented.\nPrefer named exports.\n' };

/**
 * The issue 628 case: AGENTS.md was reviewed on 2026-01-01 and describes
 * src/engine.mjs; the engine then grew to five times its size and nobody
 * re-read AGENTS.md. A canonical document is checked in the same run, so
 * Freshness performs real checks while one document goes unexamined.
 * `extra` adds files to the first commit (another instruction file, say).
 */
function issue628(enforcement = 'strict', extra = {}, afterInit = null) {
  const dir = makeTempDir('docguard-628-');
  temporary.push(dir);
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  // Strict runs every validator (FR-003): the others are waived with reasons so only Freshness is looked at.
  // `enforcement: null` writes no key, so the run takes the default mode (strict since Stage B).
  const isolated = isolateWithWaivers({
    'package.json': JSON.stringify({ name: 'fixture-628', version: '1.0.0', scripts: { test: 'node --test' } }),
    'src/engine.mjs': code(40),
    'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Architecture\n\nThe engine lives in `src/engine.mjs`.\n',
    'AGENTS.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Agents\n\n- `src/engine.mjs` parses the input, then runs it.\n- Run `npm test` before committing.\n',
    ...extra,
  }, {
    projectName: 'fixture-628', version: '0.6', enforcement: enforcement ?? 'strict',
    requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'] },
    validators: onlyFreshness,
  });
  const config = { ...isolated.config };
  if (enforcement === null) delete config.enforcement;
  commit(dir, { ...isolated.files, '.docguard.json': JSON.stringify(config, null, 2) }, 'init', '2026-01-01');
  if (afterInit) afterInit(dir);
  commit(dir, { 'src/engine.mjs': code(120) }, 'engine grows', '2026-02-01');
  commit(dir, { 'src/engine.mjs': code(220) }, 'engine grows again', '2026-03-01');
  commit(dir, { 'NOTES.md': '# notes\n' }, 'notes', '2026-03-05');
  return dir;
}

function guard(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
// The same fixture on v0.47.0 (git archive of the tag), the release issue 628 was measured on.
const TAG = 'v0.47.0';
const tagExists = (() => { try { fixtureGit(ROOT, ['rev-parse', '--verify', '-q', `${TAG}^{commit}`]); return true; } catch { return false; } })();
const skipNoTag = tagExists ? false : `${TAG} is not in this clone (shallow checkout); CI fetches full history`;
function v047Guard(dir) {
  const base = makeTempDir('docguard-v047-');
  temporary.push(base);
  const tarball = join(base, '.tag.tar');
  fixtureGit(ROOT, ['archive', '-o', tarball, TAG]);
  assert.equal(spawnSync('tar', ['-x', '-f', tarball, '-C', base]).status, 0, 'tar extract failed');
  return spawnSync(process.execPath, [join(base, 'cli', 'docguard.mjs'), 'guard', '--dir', dir], { encoding: 'utf8', env: ENV });
}

const guardJson = (dir) => {
  const r = guard(dir, ['--format', 'json']);
  return { status: r.status, json: JSON.parse(r.out) };
};

describe('T026 / SC-004: the issue 628 fixture', () => {
  it('on v0.47.0 guard exits 2: the stale instructions are a warning', { skip: skipNoTag }, () => {
    const r = v047Guard(issue628('strict'));
    assert.equal(r.status, 2, r.stderr);
  });

  it('under strict, exits 4, names AGENTS.md and the re-review step, while Freshness still performed checks', () => {
    const dir = issue628('strict');
    const { status, json } = guardJson(dir);
    assert.equal(status, 4);
    assert.deepEqual(json.strict.blocking, ['freshness'], 'only the suspect review blocks');
    const freshness = json.validators.find(v => v.key === 'freshness');
    assert.ok(freshness.performed > 0, 'Freshness examined the other documents');
    assert.deepEqual(freshness.unexaminedDocuments.map(d => [d.path, d.cause]), [['AGENTS.md', 'needs-content']]);
    const entry = json.strict.unexamined.find(u => u.validator === 'freshness');
    assert.equal(entry.cause, 'needs-content');
    assert.deepEqual(entry.documents, ['AGENTS.md']);
    assert.match(entry.reason, /AGENTS\.md/);
    assert.match(entry.howToConfigure, /docguard review --accept AGENTS\.md --reason/);
    // FRS006 stays the warning that names the changed reference.
    assert.ok(json.findings.some(f => f.code === 'FRS006' && f.effectiveSeverity === 'warn' && /src\/engine\.mjs/.test(f.message)));
  });

  it('with no enforcement key the default is strict, so the same fixture exits 4', () => {
    const { status, json } = guardJson(issue628(null));
    assert.equal(json.enforcement.source, 'default');
    assert.equal(json.enforcement.mode, 'strict');
    assert.equal(status, 4);
    assert.deepEqual(json.strict.blocking, ['freshness']);
  });

  it('the text output names the file and the re-review step in the Adopt block', () => {
    const { status, out } = guard(issue628('strict'));
    assert.equal(status, 4);
    const adopt = out.slice(out.indexOf('Adopt'));
    assert.match(adopt, /AGENTS\.md/);
    assert.match(adopt, /docguard review --accept AGENTS\.md/);
  });

  it('after the review is recorded and committed, Freshness no longer blocks', () => {
    const dir = issue628('strict');
    const r = spawnSync(process.execPath, [CLI, 'review', '--dir', dir, '--accept', 'AGENTS.md', '--reason', 're-read AGENTS.md against src/engine.mjs as it is now'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    commit(dir, {}, 'record the review', '2026-03-06');
    const { status, json } = guardJson(dir);
    assert.ok(!json.strict.blocking.includes('freshness'), `still blocking: ${JSON.stringify(json.strict.unexamined)}`);
    assert.notEqual(status, 4);
  });

  it('under standard, the same facts are warnings only and the exit code is 2', () => {
    const { status, json } = guardJson(issue628('standard'));
    assert.equal(status, 2);
    assert.equal(json.strict ?? null, null);
    assert.ok(json.findings.some(f => f.code === 'FRS006' && f.effectiveSeverity === 'warn'));
  });

  it('a waiver on Freshness removes the block', () => {
    const dir = issue628('strict', {
      'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n<!-- docguard:validator freshness n/a — fixture waives history checks owner:@fixture expires:2099-01-01 -->\n# Architecture\n\nThe engine lives in `src/engine.mjs`.\n',
    });
    const { json } = guardJson(dir);
    assert.ok(!json.strict.blocking.includes('freshness'));
  });
});

describe('T025a / FR-021: per-document gaps on the Freshness result', () => {
  it('an agent-instruction document with no review point is needs-declaration, named with its review command', () => {
    const { status, json } = guardJson(issue628('strict', COPILOT));
    assert.equal(status, 4);
    const entries = json.strict.unexamined.filter(u => u.validator === 'freshness');
    assert.equal(entries.length, 1, 'one entry per validator');
    const [entry] = entries;
    assert.deepEqual([...entry.documents].sort(), ['.github/copilot-instructions.md', 'AGENTS.md']);
    // A suspect review outranks a missing one: the project declared a review that no longer holds.
    assert.equal(entry.cause, 'needs-content');
    const docs = json.validators.find(v => v.key === 'freshness').unexaminedDocuments;
    assert.deepEqual(Object.fromEntries(docs.map(d => [d.path, d.cause])), { 'AGENTS.md': 'needs-content', '.github/copilot-instructions.md': 'needs-declaration' });
    assert.match(entry.reason, /no review record/);
    assert.match(entry.howToConfigure, /docguard review --accept/);
  });

  it('the run names the same documents as the exported functions (one definition)', () => {
    const dir = issue628('strict', { ...COPILOT, ...HARNESS_SKILL });
    const config = JSON.parse(fixtureGit(dir, ['show', 'HEAD:.docguard.json']));
    const results = validateFreshness(dir, config);
    const contract = freshnessContract(dir, config, { performed: 1, found: true, facts: results.facts });
    const fromRun = Object.fromEntries(contract.unexaminedDocuments.map(d => [d.path, `${d.cause}:${d.blocking}`]));
    const missing = agentInstructionDocsWithoutReviewPoint(dir, config).map(d => [d.path, `needs-declaration:${d.root}`]);
    const listed = new Set(missing.map(([path]) => path));
    const suspect = agentInstructionReviewStatus(dir, config).filter(s => s.suspect && !listed.has(s.path)).map(s => [s.path, 'needs-content:true']);
    assert.deepEqual(fromRun, Object.fromEntries([...missing, ...suspect]));
    assert.equal(fromRun['.agents/skills/sample-harness/SKILL.md'], 'needs-declaration:false');
  });

  it('a harness skill copy with no install record and no review is listed under could-not-read and never blocks', () => {
    // The TestGuard case by kind: a tool installed its skill into the project's harness folder,
    // with no generated-by header and no install manifest, and nobody reviewed it.
    const { status, json } = guardJson(issue628('strict', { ...HARNESS_SKILL, 'AGENTS.md': CURRENT_AGENTS }));
    assert.notEqual(status, 4, JSON.stringify(json.strict));
    assert.ok(!json.strict.blocking.includes('freshness'));
    const listed = json.strict.couldNotRead.find(u => u.validator === 'freshness');
    assert.deepEqual(listed.documents, ['.agents/skills/sample-harness/SKILL.md']);
    assert.equal(listed.cause, 'needs-declaration');
    assert.match(listed.reason, /ownership is not established/);
    assert.match(listed.howToConfigure, /If the project wrote it.*docguard review --accept \.agents\/skills\/sample-harness\/SKILL\.md.*If a tool installed it, leave it to that tool/);
  });

  it('a non-root skill carrying a vendor-written marker, whose referenced file then changes, is listed and never blocks', () => {
    // A tool shipped the skill with its own last-reviewed marker; the project never recorded a review of it.
    const vendorMarked = { '.agents/skills/sample-harness/SKILL.md': `<!-- docguard:last-reviewed 2026-01-01 -->\n${HARNESS_SKILL['.agents/skills/sample-harness/SKILL.md']}` };
    const { status, json } = guardJson(issue628('strict', { 'AGENTS.md': CURRENT_AGENTS, ...vendorMarked }));
    assert.notEqual(status, 4, JSON.stringify(json.strict));
    assert.ok(!json.strict.blocking.includes('freshness'));
    // The marker-based review is suspect (FRS006 still warns), yet a marker alone establishes no ownership.
    assert.ok(json.findings.some(f => f.code === 'FRS006' && /sample-harness/.test(f.message)));
    const listed = json.strict.couldNotRead.find(u => u.validator === 'freshness');
    assert.deepEqual(listed.documents, ['.agents/skills/sample-harness/SKILL.md']);
    assert.match(listed.reason, /marker \(2026-01-01\) but no recorded review/);
  });

  it('a root file whose only review is a marker still blocks when that review no longer covers it', () => {
    const { status, json } = guardJson(issue628('strict'));
    assert.equal(status, 4);
    assert.equal(json.strict.unexamined.find(u => u.validator === 'freshness').cause, 'needs-content');
  });

  it('a non-root document with a recorded review that no longer covers it blocks', () => {
    // Recording a review is the project saying the document is its own.
    const dir = issue628('strict', { 'AGENTS.md': CURRENT_AGENTS, ...HARNESS_SKILL }, (d) => {
      const r = spawnSync(process.execPath, [CLI, 'review', '--dir', d, '--accept', '.agents/skills/sample-harness/SKILL.md', '--reason', 'the harness skill is ours; read against src/engine.mjs'], { encoding: 'utf8', env: ENV });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      commit(d, {}, 'record the skill review', '2026-01-02');
    });
    const { status, json } = guardJson(dir);
    assert.equal(status, 4);
    const entry = json.strict.unexamined.find(u => u.validator === 'freshness');
    assert.deepEqual(entry.documents, ['.agents/skills/sample-harness/SKILL.md']);
    assert.equal(entry.cause, 'needs-content');
  });

  it('nothing is unexamined when every review covers its document', () => {
    const dir = issue628('strict');
    commit(dir, { 'AGENTS.md': '<!-- docguard:last-reviewed 2026-03-05 -->\n# Agents\n\n- `src/engine.mjs` parses the input, then runs it.\n- Run `npm test` before committing.\n' }, 'review', '2026-03-05');
    const { json } = guardJson(dir);
    const freshness = json.validators.find(v => v.key === 'freshness');
    assert.equal(freshness.unexaminedDocuments, undefined);
    assert.ok(!json.strict.blocking.includes('freshness'));
  });
});

describe('buildStrictReport: a result that names unexamined documents', () => {
  const fix = p => `Read ${p} against the code, then record the review: docguard review --accept ${p} --reason "<what you checked>"`;
  const freshness = (extra = {}) => ({
    key: 'freshness', name: 'Freshness', verdict: 'fail', performed: 3, findings: [],
    unexaminedDocuments: [
      { path: 'AGENTS.md', cause: 'needs-content', blocking: true, reason: 'AGENTS.md: its 2026-01-01 review no longer covers src/engine.mjs (82% added since)', howToConfigure: fix('AGENTS.md') },
      { path: 'a.md', cause: 'needs-declaration', blocking: true, reason: 'a.md has no review record', howToConfigure: fix('a.md') },
      { path: 'b.md', cause: 'needs-declaration', blocking: true, reason: 'b.md has no review record', howToConfigure: fix('b.md') },
      { path: 'c.md', cause: 'needs-declaration', blocking: true, reason: 'c.md has no review record', howToConfigure: fix('c.md') },
    ],
    ...extra,
  });

  it('blocks on a validator that performed checks, without changing performed', () => {
    const r = freshness();
    const report = buildStrictReport([r]);
    assert.deepEqual(report.blocking, ['freshness']);
    assert.equal(r.performed, 3);
    const [entry] = report.unexamined;
    assert.equal(entry.cause, 'needs-content');
    assert.equal(entry.documents.length, 4);
    assert.match(entry.reason, /AGENTS\.md, a\.md, b\.md and 1 more/);
  });

  it('merges into the validator entry when the validator is itself empty, so there is one entry per key', () => {
    const r = freshness({ verdict: 'empty', performed: 0, emptyCause: 'needs-content', howToConfigure: 'commit more', applicability: { reason: 'too few commits' } });
    const report = buildStrictReport([r]);
    assert.equal(report.unexamined.length, 1);
    assert.equal(report.unexamined[0].documents.length, 4);
    assert.deepEqual(report.blocking, ['freshness']);
  });

  it('a non-blocking document goes to couldNotRead and leaves the exit decision alone', () => {
    const r = freshness({ unexaminedDocuments: [{ path: '.agents/skills/x/SKILL.md', cause: 'needs-declaration', blocking: false, reason: 'no review record and no install record', howToConfigure: 'If the project wrote it, record the review. If a tool installed it, leave it to that tool.' }] });
    const report = buildStrictReport([r]);
    assert.deepEqual(report.blocking, []);
    assert.deepEqual(report.unexamined, []);
    assert.deepEqual(report.couldNotRead[0].documents, ['.agents/skills/x/SKILL.md']);
    assert.match(report.couldNotRead[0].reason, /ownership is not established/);
  });

  it('a waived result and a --changed-only run do not block', () => {
    assert.deepEqual(buildStrictReport([freshness({ note: 'declared N/A: not ours' })]).blocking, []);
    const lite = buildStrictReport([freshness()], { lite: true });
    assert.deepEqual(lite.blocking, []);
    assert.equal(lite.unexamined[0].blocking, false);
  });

  it('SARIF and JUnit render the blocking Freshness entry even though its verdict is fail', () => {
    const r = freshness();
    const strict = buildStrictReport([r]);
    const data = { validators: [r], findings: [], strict, enforcement: { mode: 'strict' } };
    const notes = toSarif(data).runs[0].invocations[0].toolExecutionNotifications;
    assert.ok(notes.some(n => n.descriptor.id === 'freshness' && /AGENTS\.md/.test(n.message.text)), JSON.stringify(notes));
    const junit = toJunit(data);
    assert.match(junit, /Freshness: unexamined documents/);
    assert.match(junit, /AGENTS\.md/);
  });
});

describe('T028a: a blocking document row never says the validator is pass', () => {
  // A root instruction file with no review record, in a project whose history is otherwise clean, so
  // Freshness examined the canonical document and passed: its verdict is `pass`, and the row still blocks.
  function cleanWithUnreviewedRoot() {
    const dir = makeTempDir('docguard-row-');
    temporary.push(dir);
    fixtureGit(dir, ['init', '-q', '-b', 'main']);
    fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
    fixtureGit(dir, ['config', 'user.name', 'Fixture']);
    const isolated = isolateWithWaivers({
      'package.json': JSON.stringify({ name: 'row-fixture', version: '1.0.0' }),
      'src/engine.mjs': code(40),
      'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Architecture\n\nThe engine lives in `src/engine.mjs`.\n',
      'AGENTS.md': '# Agents\n\n- `src/engine.mjs` parses the input, then runs it.\n- Run `npm test` before committing.\n',
    }, {
      projectName: 'row-fixture', version: '0.6', enforcement: 'strict',
      requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'] },
      validators: onlyFreshness,
    });
    commit(dir, { ...isolated.files, '.docguard.json': JSON.stringify(isolated.config, null, 2) }, 'init', '2026-01-01');
    commit(dir, { 'NOTES.md': '# notes\n' }, 'notes', '2026-01-02');
    commit(dir, { 'NOTES.md': '# notes\n\nmore\n' }, 'notes', '2026-01-03');
    return dir;
  }

  it('guard: Freshness is pass, blocks for AGENTS.md, and the Adopt row says it did not examine the document', () => {
    const dir = cleanWithUnreviewedRoot();
    const { status, json } = guardJson(dir);
    assert.equal(json.validators.find(v => v.key === 'freshness').verdict, 'pass', 'the fixture reproduces a pass verdict');
    assert.equal(status, 4);
    const { out } = guard(dir);
    assert.doesNotMatch(out, /Freshness is pass/);
    assert.match(out, /Freshness did not examine 1 document\(s\) \(needs-declaration\)/);
  });

  it('upgrade: the same row in the read-only strict report', () => {
    const dir = cleanWithUnreviewedRoot();
    const r = spawnSync(process.execPath, [CLI, 'upgrade', '--schema-only'], { cwd: dir, encoding: 'utf8', env: ENV });
    assert.doesNotMatch(r.stdout, /Freshness is pass/);
    assert.match(r.stdout, /Freshness did not examine 1 document\(s\) \(needs-declaration\)/);
    assert.match(r.stdout, /docguard review --accept AGENTS\.md/);
  });

  it('the could-not-read block uses the document form too', () => {
    const report = buildStrictReport([{ key: 'freshness', name: 'Freshness', verdict: 'pass', performed: 2, findings: [],
      unexaminedDocuments: [{ path: '.agents/skills/x/SKILL.md', cause: 'needs-declaration', blocking: false, reason: 'r', howToConfigure: 'f' }] }]);
    const text = couldNotReadLines(report).join('\n');
    assert.doesNotMatch(text, /is pass/);
    assert.match(text, /Freshness did not examine 1 document\(s\) \(needs-declaration\)/);
  });
});
