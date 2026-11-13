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
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { buildStrictReport } from '../cli/enforcement.mjs';
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

const COPILOT = { '.github/copilot-instructions.md': '# Copilot\n\nUse `npm test`. Keep `src/engine.mjs` small and documented.\nPrefer named exports.\n' };

/**
 * The issue 628 case: AGENTS.md was reviewed on 2026-01-01 and describes
 * src/engine.mjs; the engine then grew to five times its size and nobody
 * re-read AGENTS.md. A canonical document is checked in the same run, so
 * Freshness performs real checks while one document goes unexamined.
 * `extra` adds files to the first commit (another instruction file, say).
 */
function issue628(enforcement = 'strict', extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-628-'));
  temporary.push(dir);
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  const config = {
    projectName: 'fixture-628', version: '0.6',
    ...(enforcement ? { enforcement } : {}),
    requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'] },
    validators: onlyFreshness,
  };
  commit(dir, {
    '.docguard.json': JSON.stringify(config, null, 2),
    'package.json': JSON.stringify({ name: 'fixture-628', version: '1.0.0', scripts: { test: 'node --test' } }),
    'src/engine.mjs': code(40),
    'docs-canonical/ARCHITECTURE.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Architecture\n\nThe engine lives in `src/engine.mjs`.\n',
    'AGENTS.md': '<!-- docguard:last-reviewed 2026-01-01 -->\n# Agents\n\n- `src/engine.mjs` parses the input, then runs it.\n- Run `npm test` before committing.\n',
    ...extra,
  }, 'init', '2026-01-01');
  commit(dir, { 'src/engine.mjs': code(120) }, 'engine grows', '2026-02-01');
  commit(dir, { 'src/engine.mjs': code(220) }, 'engine grows again', '2026-03-01');
  commit(dir, { 'README.md': '# fixture\n' }, 'readme', '2026-03-05');
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
  const base = mkdtempSync(join(tmpdir(), 'docguard-v047-'));
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
    const dir = issue628('strict', COPILOT);
    const config = JSON.parse(spawnSync('git', ['show', 'HEAD:.docguard.json'], { cwd: dir, encoding: 'utf8' }).stdout);
    const results = validateFreshness(dir, config);
    const contract = freshnessContract(dir, config, { performed: 1, found: true, facts: results.facts });
    const fromRun = Object.fromEntries(contract.unexaminedDocuments.map(d => [d.path, d.cause]));
    const missing = agentInstructionDocsWithoutReviewPoint(dir, config).map(d => [d.path, 'needs-declaration']);
    const suspect = agentInstructionReviewStatus(dir, config).filter(s => s.suspect).map(s => [s.path, 'needs-content']);
    assert.deepEqual(fromRun, Object.fromEntries([...missing, ...suspect]));
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
      { path: 'AGENTS.md', cause: 'needs-content', reason: 'AGENTS.md: its 2026-01-01 review no longer covers src/engine.mjs (82% added since)', howToConfigure: fix('AGENTS.md') },
      { path: 'a.md', cause: 'needs-declaration', reason: 'a.md has no review record', howToConfigure: fix('a.md') },
      { path: 'b.md', cause: 'needs-declaration', reason: 'b.md has no review record', howToConfigure: fix('b.md') },
      { path: 'c.md', cause: 'needs-declaration', reason: 'c.md has no review record', howToConfigure: fix('c.md') },
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
