/**
 * Symbol map in the context pack (specs/036-symbol-map), and the frozen v2
 * agent-context protocol that decides whether it ships by default.
 *
 * @req docguard.symbol-map#FR-001
 * @req docguard.symbol-map#FR-002
 * @req docguard.symbol-map#FR-003
 * @req docguard.symbol-map#FR-004
 * @req docguard.symbol-map#FR-005
 * @req docguard.symbol-map#FR-006
 * @req docguard.symbol-map#FR-008
 * @req docguard.symbol-map#FR-010
 * @req docguard.symbol-map#SC-001
 * @req docguard.symbol-map#SC-002
 * @req docguard.symbol-map#SC-003
 * @req docguard.symbol-map#FR-007
 * @req docguard.symbol-map#FR-009
 * @req docguard.symbol-map#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSymbolMap, MAX_SYMBOLS_PER_FILE, pageRank, SYMBOL_MAP_MAX_BYTES, symbolMapBudget } from '../cli/scanners/symbol-map.mjs';
import { clearImportGraphCache } from '../cli/scanners/import-graph.mjs';
import { aggregateTrials, buildResult, buildTrialPrompt, decideSymbolPromotion, loadManifest, V2_MANIFEST_DIGEST, verifyFixtures } from '../benchmarks/agent-context/run.mjs';

const CLI = resolve('cli/docguard.mjs');

function project(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-symbols-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

/** One hub imported by five modules, and eight leaves (User Story 1). */
function hubAndLeaves() {
  const files = { 'package.json': '{"name":"hub","type":"module"}\n', 'src/hub.mjs': 'export const alpha = 1;\nexport function beta() {}\nexport class Gamma {}\n' };
  for (let i = 1; i <= 5; i++) files[`src/user${i}.mjs`] = `import { alpha } from './hub.mjs';\nexport const u${i} = alpha;\n`;
  for (let i = 1; i <= 8; i++) files[`src/leaf${i}.mjs`] = `export const leaf${i} = ${i};\n`;
  files['tests/hub.test.mjs'] = "import { alpha } from '../src/hub.mjs';\n";
  return files;
}

describe('the pack names the code that matters most (User Story 1, SC-001)', () => {
  it('ranks the hub first, lists its exported names, and is byte-identical across runs', t => {
    const dir = project(t, hubAndLeaves());
    clearImportGraphCache();
    const runs = [1, 2, 3].map(() => buildSymbolMap(dir, {}).text);
    assert.equal(runs[1], runs[0]);
    assert.equal(runs[2], runs[0]);
    const lines = runs[0].split('\n').filter(l => l.startsWith('- `'));
    assert.equal(lines[0], '- `src/hub.mjs`: alpha, beta, Gamma');
    assert.ok(lines.every(l => !l.includes('tests/')), 'test files are never ranked');
    assert.match(runs[0], /^## Symbol map\n/);
  });

  it('stops at a whole line within the budget and says how many files it left out (FR-003)', t => {
    const dir = project(t, hubAndLeaves());
    const map = buildSymbolMap(dir, {}, { maxBytes: 420 });
    assert.ok(Buffer.byteLength(map.text) <= 420, `${Buffer.byteLength(map.text)} bytes`);
    assert.ok(map.omitted > 0);
    assert.match(map.text, new RegExp(`_${map.omitted} more ranked files? not shown \\(budget 420 bytes\\)\\._`));
    assert.ok(map.text.split('\n').every(l => !l.startsWith('- `') || /\.mjs`/.test(l)), 'no line is cut mid-way');
  });

  it('bounds the budget option', () => {
    assert.equal(symbolMapBudget({}), 4096);
    assert.equal(symbolMapBudget({ memory: { symbolMap: { maxBytes: 999999 } } }), SYMBOL_MAP_MAX_BYTES);
    assert.equal(symbolMapBudget({ memory: { symbolMap: { maxBytes: 10 } } }), 256);
  });

  it('lists a file it cannot parse without symbols and names the degraded tier', t => {
    const dir = project(t, { ...hubAndLeaves(), 'src/broken.mjs': "import { alpha } from './hub.mjs';\nexport const = ;\n" });
    const map = buildSymbolMap(dir, {});
    assert.match(map.text, /^- `src\/broken\.mjs`$/m);
    assert.match(map.text, /_Listed without symbols: 1 \(js-parse-failed\)\._/);
  });

  it('caps each file at 12 names with a count of the rest', t => {
    const many = Array.from({ length: 15 }, (_, i) => `export const n${i} = ${i};`).join('\n');
    const dir = project(t, { 'src/a.mjs': "import './b.mjs';\n", 'src/b.mjs': many });
    const line = buildSymbolMap(dir, {}).text.split('\n').find(l => l.startsWith('- `src/b.mjs`'));
    assert.equal(line.split(': ')[1].split(', ').length, MAX_SYMBOLS_PER_FILE);
    assert.match(line, /\+3 more$/);
  });

  it('a module that exports nothing lists its top-level functions and classes', t => {
    const dir = project(t, { 'src/cli.mjs': "import { run } from './lib.mjs';\nfunction main() { run(); }\nclass Runner {}\nmain();\n", 'src/lib.mjs': 'export function run() {}\n' });
    assert.match(buildSymbolMap(dir, {}).text, /^- `src\/cli\.mjs`: main, Runner$/m);
  });

  it('without import edges, ranks by exported names and says so', t => {
    const dir = project(t, { 'src/one.mjs': 'export const a = 1;\n', 'src/three.mjs': 'export const a = 1, b = 2, c = 3;\n' });
    const map = buildSymbolMap(dir, {});
    assert.equal(map.ranking, 'symbol-count');
    assert.match(map.text, /No import edges were found/);
    assert.ok(map.text.indexOf('three.mjs') < map.text.indexOf('one.mjs'));
  });
});

describe('the ranking (FR-002)', () => {
  it('is PageRank with dangling mass spread, rounded, ties broken by path, and ends on a cycle', () => {
    const cycle = pageRank(['b', 'a', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    assert.deepEqual(cycle.map(r => r.path), ['a', 'b', 'c'], 'a symmetric cycle ties, and ties break by path');
    const star = pageRank(['hub', 'x', 'y', 'z'], [['x', 'hub'], ['y', 'hub'], ['z', 'hub']]);
    assert.equal(star[0].path, 'hub');
    const total = star.reduce((n, r) => n + r.score, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `scores sum to ${total}`);
    assert.ok(star.every(r => Number.isInteger(Math.round(r.score * 1e9)) && r.score === Math.round(r.score * 1e9) / 1e9));
  });
});

describe('opt-in until the benchmark decides (FR-004, SC-002, SC-003)', () => {
  it('memory --pack adds the section only with --symbols', t => {
    const dir = project(t, { ...hubAndLeaves(), '.docguard.json': '{"projectName":"hub"}\n' });
    const plain = spawnSync(process.execPath, [CLI, 'memory', '--pack', '--stdout', '--dir', dir], { encoding: 'utf8' }).stdout;
    const withMap = spawnSync(process.execPath, [CLI, 'memory', '--pack', '--stdout', '--symbols', '--dir', dir], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(plain, /## Symbol map/);
    assert.match(withMap, /## Symbol map/);
    const strip = s => s.replace(/Generated by `docguard memory --pack` [^—]+—/, '').replace(/## Symbol map[\s\S]*?\n(?=---)/, '');
    assert.equal(strip(withMap), strip(plain), 'the flag adds the section and nothing else');
  });

  it('on this repository the section fits its default budget', () => {
    const repoConfig = JSON.parse(readFileSync('.docguard.json', 'utf8'));
    const map = buildSymbolMap(process.cwd(), repoConfig);
    assert.ok(Buffer.byteLength(map.text) <= 4096);
    assert.ok(map.listed > 10);
  });
});

/** A PATH holding only node and git, so no Python interpreter resolves. */
function pathWithoutPython(t) {
  const bin = mkdtempSync(join(tmpdir(), 'docguard-nopy-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  symlinkSync(process.execPath, join(bin, 'node'));
  const git = process.env.PATH.split(delimiter).map(d => join(d, 'git')).find(p => existsSync(p));
  if (git) symlinkSync(git, join(bin, 'git'));
  return bin;
}

describe('degraded Python tier (User Story 1, scenario 3)', { skip: process.platform === 'win32' ? 'symlinked PATH shim' : false }, () => {
  it('lists Python files without symbols when no interpreter is available', t => {
    const dir = project(t, { 'app/core.py': 'def run():\n    pass\n', 'app/cli.py': 'from app.core import run\n', '.docguard.json': '{"projectName":"py"}\n' });
    const out = spawnSync(process.execPath, [CLI, 'memory', '--pack', '--stdout', '--symbols', '--dir', dir], { encoding: 'utf8', env: { ...process.env, PATH: pathWithoutPython(t) } }).stdout;
    assert.match(out, /python-interpreter-unavailable/);
  });
});

describe('the v2 protocol decides (User Story 2, FR-005, FR-006, FR-008)', () => {
  const manifest = loadManifest(resolve('benchmarks/agent-context/manifest-v2.json'));

  it('is frozen by digest, with six tasks of which three are navigation-bound', () => {
    assert.equal(manifest.protocol.id, 'docguard-agent-context-v2');
    assert.deepEqual(manifest.conditions, ['task-only', 'context-pack', 'context-pack-symbols']);
    assert.equal(manifest.tasks.length, 6);
    assert.equal(manifest.tasks.filter(task => task.navigationBound).length, 3);
    assert.match(V2_MANIFEST_DIGEST, /^sha256:[a-f0-9]{64}$/);
    assert.equal(loadManifest().protocol.id, 'docguard-agent-context-v1', 'v1 loads unchanged');
  });

  it('the context-pack-symbols prompt carries the symbol map and the plain pack does not', t => {
    const task = manifest.tasks.find(x => x.id === 'ledger-rounding');
    const dir = mkdtempSync(join(tmpdir(), 'docguard-v2-prompt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(resolve('benchmarks/agent-context', task.fixture), dir, { recursive: true });
    assert.match(buildTrialPrompt(task, 'context-pack-symbols', dir), /## Symbol map[\s\S]*src\/currency\/rounding\.mjs/);
    assert.doesNotMatch(buildTrialPrompt(task, 'context-pack', dir), /## Symbol map/);
    assert.doesNotMatch(task.prompt, /rounding\.mjs|src\//, 'a navigation-bound prompt names the requirement, not the file');
  });

  it('is calibrated: every reference passes its hidden checks, and every starting state fails as declared', () => {
    const summaries = verifyFixtures(manifest);
    assert.deepEqual(summaries.map(s => [s.id, s.initial.passed, s.initial.failures.length]), manifest.tasks.map(t => [t.id, t.expectedInitial.passed, t.expectedInitial.failed]));
  });

  it('rejects the manifest after any change to a frozen field', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-v2-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const change of [
      m => { m.protocol.seed = 'other'; },
      m => { m.promotion.benefit.minimumMedianReductionPercent = 10; },
      m => { m.tasks[3].prompt += ' Hint: look in src/currency.'; },
      m => { m.conditions.reverse(); },
      m => { m.tasks[4].evaluatorDigest = `sha256:${'0'.repeat(64)}`; },
    ]) {
      const copy = JSON.parse(readFileSync('benchmarks/agent-context/manifest-v2.json', 'utf8'));
      change(copy);
      const path = join(dir, 'manifest-v2.json');
      writeFileSync(path, JSON.stringify(copy));
      assert.throws(() => loadManifest(path), /changed after it was frozen/);
    }
    copyFileSync('benchmarks/agent-context/manifest-v2.json', join(dir, 'same.json'));
    assert.doesNotThrow(() => loadManifest(join(dir, 'same.json')));
  });

  const trial = (task, condition, over = {}) => ({ task, condition, status: 'completed', success: true, requirementViolations: 0, unnecessaryEdits: 0, steps: 10, latencyMs: 1000, usage: { uncachedInputTokens: 1000 }, ...over });
  const matrix = over => manifest.tasks.flatMap(task => manifest.conditions.flatMap(condition => [1, 2, 3].map(r => trial(task.id, condition, over(task, condition, r) || {}))));
  const decide = trials => {
    const nav = new Set(manifest.tasks.filter(t => t.navigationBound).map(t => t.id));
    return decideSymbolPromotion(manifest, aggregateTrials(manifest, trials), aggregateTrials(manifest, trials.filter(t => nav.has(t.task)))).status;
  };

  it('promotes only with no regression and a predeclared benefit', () => {
    assert.equal(decide(matrix((task, condition) => (condition === 'context-pack-symbols' && task.navigationBound ? { steps: 8, latencyMs: 800 } : null))), 'promote');
  });

  it('keeps --symbols opt-in when there is no regression and no benefit', () => {
    assert.equal(decide(matrix(() => null)), 'opt-in');
  });

  it('does not release on a regression', () => {
    assert.equal(decide(matrix((task, condition, r) => (condition === 'context-pack-symbols' && r === 1 && ['ledger-rounding', 'status-alias'].includes(task.id) ? { success: false } : null))), 'not-released');
    assert.equal(decide(matrix((task, condition) => (condition === 'context-pack-symbols' ? { usage: { uncachedInputTokens: 1100 } } : null))), 'not-released');
  });

  it('records every trial under the v2 result schema, with the decision computed from them (FR-007, SC-004)', () => {
    const trials = matrix((task, condition) => (condition === 'context-pack-symbols' && task.navigationBound ? { steps: 8, latencyMs: 800 } : null))
      .map((t, i) => ({ ...t, id: `${t.task}:${t.condition}:${(i % 3) + 1}`, repetition: (i % 3) + 1 }));
    const fixtures = manifest.tasks.map(task => ({ id: task.id, fixtureDigest: task.fixtureDigest }));
    const result = buildResult(manifest, fixtures, trials, 'test');
    assert.equal(result.$schema, 'https://raccioly.github.io/docguard/schemas/docguard-agent-context-result-v2.schema.json');
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.core.protocolId, 'docguard-agent-context-v2');
    assert.equal(result.core.trialOrder.length, 54);
    assert.equal(result.observations.trials.length, 54, 'every run is kept');
    assert.ok(result.core.navigationAggregate['context-pack-symbols']);
    assert.equal(result.core.decision.status, decide(trials), 'the recorded decision is the computed one');
    assert.equal(result.core.decision.status, 'promote');
  });

  it('documents that promotion must be recorded as a Budget-Exempt with the v2 result (FR-009)', () => {
    const readme = readFileSync('benchmarks/agent-context/results/README-v2.md', 'utf8');
    assert.match(readme, /Budget-Exempt: memory-pack-bytes/);
    assert.match(readFileSync('specs/036-symbol-map/tasks.md', 'utf8'), /T010[\s\S]*Budget-Exempt: memory-pack-bytes/);
  });

  it('is incomplete while any trial is missing or failed on infrastructure', () => {
    const full = matrix(() => null);
    assert.equal(decide(full.slice(1)), 'incomplete');
    assert.equal(decide(full.map((t, i) => (i === 0 ? { ...t, status: 'infrastructure-failed', success: false } : t))), 'incomplete');
  });
});
