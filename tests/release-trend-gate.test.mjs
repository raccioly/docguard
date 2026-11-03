/**
 * Release trend gate (specs/087-release-trend-gate): two synthetic CLI trees
 * whose `guard --format json` prints a fixed result, over a one-directory corpus.
 *
 * @req docguard.release-trend-gate#FR-001
 * @req docguard.release-trend-gate#FR-002
 * @req docguard.release-trend-gate#FR-004
 * @req docguard.release-trend-gate#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { changelogSection, compareRuns, expandCorpus, judge, loadGateConfig } from '../tools/release-ab.mjs';

const TOOL = resolve('tools/release-ab.mjs');
const STUB = "import { readFileSync } from 'node:fs';\nconst out = JSON.parse(readFileSync(new URL('./out.json', import.meta.url), 'utf8'));\nprocess.stdout.write(JSON.stringify(out.json));\nprocess.exit(out.exit);\n";
const finding = (code, file, message) => ({ code, severity: 'warn', location: { file }, message });

function cliTree(root, name, { version, findings, exit = 0, changelog = null }) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'cli/writers'), { recursive: true });
  mkdirSync(join(dir, 'fixtures/app'), { recursive: true });
  writeFileSync(join(dir, 'fixtures/app/README.md'), '# App\n');
  copyFileSync(resolve('cli/writers/baseline.mjs'), join(dir, 'cli/writers/baseline.mjs'));
  writeFileSync(join(dir, 'cli/docguard.mjs'), STUB);
  writeFileSync(join(dir, 'cli/out.json'), JSON.stringify({ exit, json: { findings, validators: [{ key: 'drift', status: findings.length ? 'warn' : 'pass', verdict: findings.length ? 'fail' : 'pass' }] } }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(dir, 'release-gate.json'), JSON.stringify({ schemaVersion: 1, corpus: ['fixtures/*'], volatileCodes: { FRS001: 'messages carry the days since last review' } }));
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog ?? `# Changelog\n\n## [Unreleased]\n\n## [${version}]\n\n- Nothing.\n`);
  return dir;
}
function gate(t, base, head) {
  const root = mkdtempSync(join(tmpdir(), 'docguard-release-ab-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const b = cliTree(root, 'base', { version: '1.0.0', ...base });
  const h = cliTree(root, 'head', { version: '1.1.0', ...head });
  const out = join(root, 'report.json');
  const r = spawnSync(process.execPath, [TOOL, '--base', b, '--head', h, '--out', out], { cwd: h, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report: r.status < 2 ? JSON.parse(readFileSync(out, 'utf8')) : null };
}
const NEW = finding('PSR002', 'AGENTS.md', 'Pointer to docs/missing.md does not resolve');

describe('US1 — every finding change between releases is explained', () => {
  it('a new finding whose code the changelog never names fails, naming fixture, code, location and message', t => {
    const r = gate(t, { findings: [] }, { findings: [NEW] });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(r.report.verdict.unexplained, ['PSR002']);
    assert.match(r.stdout, /### fixtures\/app/);
    assert.match(r.stdout, /added PSR002 AGENTS\.md: Pointer to docs\/missing\.md does not resolve/);
  });

  it('the section being released naming the code passes and still lists the change', t => {
    const r = gate(t, { findings: [] }, { findings: [NEW], changelog: '# Changelog\n\n## [Unreleased]\n\n## [1.1.0]\n\n- PSR002 now reads nested agent files.\n\n## [1.0.0]\n' });
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.report.section, '1.1.0');
    assert.match(r.stdout, /added PSR002/);
  });

  it('a removed finding is a change too', t => {
    const r = gate(t, { findings: [NEW] }, { findings: [] });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /removed PSR002/);
  });

  it('an exit-code change fails without an Exit codes: line and passes with one', t => {
    const plain = gate(t, { findings: [], exit: 0 }, { findings: [], exit: 2 });
    assert.equal(plain.status, 1);
    assert.deepEqual(plain.report.verdict.exitChanges, [{ dir: 'fixtures/app', base: 0, head: 2 }]);
    const explained = gate(t, { findings: [], exit: 0 }, { findings: [], exit: 2, changelog: '# Changelog\n\n## [1.1.0]\n\n- **Exit codes:** warnings now exit 2 on fixtures with stale docs.\n' });
    assert.equal(explained.status, 0, explained.stdout);
  });

  it('identical runs pass with no change listed', t => {
    const r = gate(t, { findings: [NEW] }, { findings: [NEW] });
    assert.equal(r.status, 0);
    assert.deepEqual(r.report.verdict.changedCodes, {});
  });

  it('a volatile code is compared by count, not by message', t => {
    const a = finding('FRS001', 'docs/A.md', 'Not reviewed for 40 days');
    const b = finding('FRS001', 'docs/A.md', 'Not reviewed for 41 days');
    assert.equal(gate(t, { findings: [a] }, { findings: [b] }).status, 0);
  });
});

describe('FR-002 / FR-004 — judging and configuration', () => {
  it('finds a Keep a Changelog section and matches codes as words', () => {
    const text = '# C\n\n## [Unreleased]\n\n- SPK013 info.\n\n## [0.1.0]\n\n- Old.\n';
    assert.equal(changelogSection(text, 'Unreleased').trim(), '- SPK013 info.');
    assert.equal(changelogSection(text, '9.9.9'), null);
    const results = [{ dir: 'x', changes: { added: [{ code: 'SPK0130', n: 1 }], removed: [], volatile: [], exit: null } }];
    assert.deepEqual(judge(results, '- SPK013 info.').unexplained, ['SPK0130'], 'a code is matched as a word, not a prefix');
  });

  it('a release that adds the verdict field changes no validator; a status change is listed; an ignored code is reported, not judged', () => {
    const fp = f => `${f.code}|${f.message}`;
    const base = { exit: 0, data: { findings: [{ code: 'MET001', message: 'says 36' }], validators: [{ key: 'drift', status: 'pass' }, { key: 'docs', status: 'pass' }] } };
    const head = { exit: 0, data: { findings: [], validators: [{ key: 'drift', status: 'pass', verdict: 'pass' }, { key: 'docs', status: 'warn', verdict: 'fail' }, { key: 'aidlc', status: 'na', verdict: 'empty' }] } };
    const c = compareRuns(base, head, fp, {}, { MET001: 'the docs describe the candidate by design' });
    assert.deepEqual(c.validators, [{ key: 'docs', base: 'pass', head: 'warn/fail' }]);
    assert.deepEqual(c.removed, []);
    assert.deepEqual(c.ignored, [{ code: 'MET001', n: 1, reason: 'the docs describe the candidate by design' }]);
  });

  it('a directory that could not be compared fails the gate', () => {
    const v = judge([{ dir: 'x', changes: { added: [], removed: [], volatile: [], exit: null, error: 'no JSON output' } }], '');
    assert.equal(v.pass, false);
  });

  it('the committed release-gate.json is valid; a volatile code needs a reason', t => {
    const cfg = loadGateConfig(resolve('release-gate.json'));
    const dirs = expandCorpus(resolve('.'), cfg.corpus);
    assert.ok(dirs.some(d => d.dir === '.'), 'the repository itself is in the corpus');
    assert.ok(dirs.filter(d => d.dir.startsWith('benchmarks/fixtures/')).length >= 5, 'the benchmark fixtures are in the corpus');
    for (const [code, reason] of Object.entries(dirs.find(d => d.dir === '.').ignoreCodes)) assert.match(reason, /by design|does not have/, code);
    const dir = mkdtempSync(join(tmpdir(), 'docguard-gate-cfg-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'g.json'), JSON.stringify({ schemaVersion: 1, corpus: ['.'], volatileCodes: { FRS001: '' } }));
    assert.throws(() => loadGateConfig(join(dir, 'g.json')), /needs a reason/);
  });
});
