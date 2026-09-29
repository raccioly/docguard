/**
 * Spec Kit artifacts are first-class documents — coverage tier, constitution
 * discovery, and constitution claim checks.
 *
 * @req docguard.spec-kit-artifact-coverage#FR-001
 * @req docguard.spec-kit-artifact-coverage#FR-002
 * @req docguard.spec-kit-artifact-coverage#FR-003
 * @req docguard.spec-kit-artifact-coverage#FR-004
 * @req docguard.spec-kit-artifact-coverage#FR-005
 * @req docguard.spec-kit-artifact-coverage#FR-006
 * @req docguard.spec-kit-artifact-coverage#SC-001
 * @req docguard.spec-kit-artifact-coverage#SC-002
 * @req docguard.spec-kit-artifact-coverage#SC-003
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function write(dir, rel, content) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'speckit-cov-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

function commitAll(dir, message) {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function guard(dir) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
}

const CONSTITUTION = '# Constitution\n\n## Core Principles\n\n### I. Simple\n\nKeep it simple.\n';

describe('Spec Kit coverage tier', () => {
  it('counts feature artifacts and the dot-directory constitution, not as untiered', () => {
    const dir = project({
      'specs/001-x/spec.md': '# Spec\n',
      'specs/001-x/research.md': '# Research\n',
      'specs/001-x/contracts/api.md': '# Contract\n',
      '.specify/memory/constitution.md': CONSTITUTION,
      'notes/loose.md': '# Loose\n',
    });
    const { coverage } = guard(dir);
    assert.equal(coverage.specKit, 4);
    assert.deepEqual(coverage.unclassified, ['notes/loose.md']);
  });

  it('keeps a .docguardignore match as ignored', () => {
    const dir = project({ 'specs/001-x/spec.md': '# Spec\n', 'specs/001-x/draft.md': '# Draft\n', '.docguardignore': 'specs/001-x/draft.md\n' });
    const { coverage } = guard(dir);
    assert.equal(coverage.specKit, 1);
    assert.ok(coverage.ignored >= 1);
  });

  it('does not treat a nested fixture specs/ tree as the project\'s artifacts', () => {
    const dir = project({ 'tests/fixtures/specs/001-y/spec.md': '# Fixture\n' });
    const { coverage } = guard(dir);
    assert.equal(coverage.specKit, 0);
  });
});

describe('MET004 — runtime-dependency claims', () => {
  const met004 = dir => guard(dir).findings.filter(f => f.code === 'MET004');

  it('flags the pre-v2 DocGuard constitution shape against one dependency', () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 'x', dependencies: { '@babel/parser': '7.29.8' } }),
      '.specify/memory/constitution.md': `${CONSTITUTION}\n## Technology Constraints\n\n- **Dependencies**: None. Zero. Ever.\n`,
    });
    const findings = met004(dir);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /claims 0 runtime dependencies .* package\.json declares 1/);
    assert.equal(findings[0].disposition, 'escalate');
    assert.equal(findings[0].suggestion.kind, 'review');
  });

  it('flags "zero runtime dependencies" in a governed doc and passes a true claim', () => {
    const wrong = project({
      'package.json': JSON.stringify({ name: 'x', dependencies: { a: '1.0.0', b: '1.0.0' } }),
      'README.md': '# X\n\nShips with zero runtime dependencies.\n',
    });
    assert.equal(met004(wrong).length, 1);
    const right = project({
      'package.json': JSON.stringify({ name: 'x', dependencies: { a: '1.0.0', b: '1.0.0' } }),
      'README.md': '# X\n\nShips with 2 runtime dependencies.\n',
    });
    assert.equal(met004(right).length, 0);
  });

  it('ignores module-level prose and projects without package.json', () => {
    const prose = project({
      'package.json': JSON.stringify({ name: 'x', dependencies: { a: '1.0.0' } }),
      'README.md': '# X\n\nThere are no dependencies between validators.\n',
    });
    assert.equal(met004(prose).length, 0);
    const noManifest = project({ 'README.md': '# X\n\nZero runtime dependencies.\n' });
    assert.equal(met004(noManifest).length, 0);
  });
});

describe('Reference-Existence reads the constitution', () => {
  it('reports a constitution reference to a removed identifier', () => {
    const dir = project({
      'src/writer.mjs': 'export function safeWriteFile() { return 1; }\n',
      '.specify/memory/constitution.md': `${CONSTITUTION}\nEvery write MUST go through \`safeWriteFile\`.\n`,
    });
    commitAll(dir, 'add writer');
    write(dir, 'src/writer.mjs', 'export function writeAtomically() { return 1; }\n');
    commitAll(dir, 'rename writer');
    const refs = guard(dir).findings.filter(f => f.code === 'REF001');
    assert.ok(refs.some(f => /constitution\.md/.test(f.message) && /safeWriteFile/.test(f.message)),
      JSON.stringify(refs.map(f => f.message)));
  });
});
