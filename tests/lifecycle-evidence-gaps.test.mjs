/**
 * Lifecycle evidence gaps found while dogfooding specs 014–016.
 *
 * @req docguard.lifecycle-evidence-gaps#FR-001
 * @req docguard.lifecycle-evidence-gaps#FR-002
 * @req docguard.lifecycle-evidence-gaps#FR-003
 * @req docguard.lifecycle-evidence-gaps#SC-001
 * @req docguard.lifecycle-evidence-gaps#SC-002
 * @req docguard.lifecycle-evidence-gaps#SC-003
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { projectSpecRegistry } from '../cli/scanners/spec-registry.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const SPEC = '# Feature\n\n**Spec ID**: `acme.feature`\n\n## Requirements\n\n- **FR-001**: Do the thing.\n';
function repo(files, { commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-gaps-'));
  dirs.push(dir);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  if (commit) { git('add', '-A'); git('commit', '-q', '-m', 'fixture'); }
  return { dir, git };
}
const spr006 = dir => validateSpecRegistry(dir, {}).findings.filter(f => f.code === 'SPR006');

describe('SPR006 — work claimed without implementation evidence', () => {
  it('fires when a task is checked and no source carries @implements', () => {
    const { dir } = repo({
      'specs/001-feature/spec.md': SPEC,
      'specs/001-feature/tasks.md': '# Tasks\n\n## Phase 1\n\n- [x] T001 build it\n',
      'src/app.mjs': 'export const x = 1;\n',
    });
    const f = spr006(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].message, /acme\.feature: 1 task\(s\) checked/);
    assert.equal(f[0].disposition, 'escalate');
    assert.match(f[0].suggestion.text, /@implements acme\.feature#FR-001/);
  });

  it('is silent once any source annotates the spec, and when nothing is checked', () => {
    const annotated = repo({
      'specs/001-feature/spec.md': SPEC,
      'specs/001-feature/tasks.md': '# Tasks\n\n## Phase 1\n\n- [x] T001 build it\n',
      'src/app.mjs': '// @implements acme.feature#FR-001\nexport const x = 1;\n',
    });
    assert.equal(spr006(annotated.dir).length, 0);
    const unstarted = repo({
      'specs/001-feature/spec.md': SPEC,
      'specs/001-feature/tasks.md': '# Tasks\n\n## Phase 1\n\n- [ ] T001 build it\n',
    });
    assert.equal(spr006(unstarted.dir).length, 0);
  });
});

describe('YAML implementation evidence', () => {
  it('reads # @implements from a tracked workflow file', () => {
    const { dir } = repo({
      'specs/001-feature/spec.md': SPEC,
      '.github/workflows/ci.yml': 'name: ci\n# @implements acme.feature#FR-001\non: [push]\n',
    });
    const spec = projectSpecRegistry(dir, {}).registry.specs.find(s => s.specId === 'acme.feature');
    assert.ok(spec.observed.implementationEvidence.some(e => JSON.stringify(e).includes('.github/workflows/ci.yml')),
      JSON.stringify(spec.observed.implementationEvidence));
  });

  it('attributes this repository\'s action.yml to the spec-first gate (SC-002)', () => {
    const spec = projectSpecRegistry(process.cwd(), {}).registry.specs.find(s => s.specId === 'docguard.spec-first-gate');
    assert.ok(spec, 'spec 015 must be registered');
    assert.ok(spec.observed.implementationEvidence.some(e => JSON.stringify(e).includes('action.yml')));
  });
});

describe('specs --write names evidence it did not count', () => {
  it('lists an untracked annotated test file in human and JSON output', () => {
    const { dir } = repo({ 'specs/001-feature/spec.md': SPEC });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'tests/feature.test.mjs'), '// @req acme.feature#FR-001\nimport "node:test";\n');
    const json = spawnSync(process.execPath, [CLI, 'specs', '--write', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const result = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')));
    assert.deepEqual(result.untrackedEvidence, ['tests/feature.test.mjs']);
    const human = spawnSync(process.execPath, [CLI, 'specs', '--check'], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(human.stdout, /Not counted: 1 untracked test file[\s\S]*tests\/feature\.test\.mjs/);
  });
});
