/**
 * A removed file is attributed to the spec that names its removal
 * (specs/069-removed-file-attribution).
 *
 * @req docguard.removed-file-attribution#FR-001
 * @req docguard.removed-file-attribution#FR-002
 * @req docguard.removed-file-attribution#FR-003
 * @req docguard.removed-file-attribution#FR-004
 * @req docguard.removed-file-attribution#SC-001
 * @req docguard.removed-file-attribution#SC-002
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReconciliationPlan } from '../cli/scanners/reconciliation.mjs';
import { BLOCKER_CODES } from '../cli/findings.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const ALPHA = [
  '# Feature Specification: Alpha',
  '',
  '**Spec ID**: `acme.alpha`',
  '',
  '## Requirements',
  '',
  '- **FR-001**: The root `scripts/old.sh` MUST be removed, and so must everything under `legacy/`.',
  '- **FR-002**: `src/keep.mjs` keeps working, and the helpers in `tools/` stay.',
  '',
].join('\n');
const BETA = '# Feature Specification: Beta\n\n**Spec ID**: `acme.beta`\n\n## Requirements\n\n- **FR-001**: Remove `src/beta-old.mjs`.\n';

/** A Spec Kit project: alpha approved and current, beta a draft. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'removed-files-'));
  temps.push(dir);
  const write = (rel, content) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); };
  const git = (...args) => fixtureGit(dir, args);
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'gc.auto', '0');
  write('.docguard.json', JSON.stringify({ projectName: 'acme' }));
  write('.specify/memory/constitution.md', '# Constitution\n');
  write('specs/001-alpha/spec.md', ALPHA);
  write('specs/002-beta/spec.md', BETA);
  for (const file of ['scripts/old.sh', 'scripts/old.sh.mjs', 'x/scripts/old.sh', 'legacy/a.mjs', 'legacy-two/b.mjs', 'src/keep.mjs', 'src/gone.mjs', 'src/beta-old.mjs', 'tools/a.mjs', 'tools/b.mjs']) {
    write(file, file.endsWith('.sh') ? '#!/bin/sh\necho hi\n' : 'export const x = 1;\n');
  }
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  cli('specs', '--write');
  const approved = cli('specs', 'approve', '--id', 'acme.alpha', '--write');
  assert.equal(approved.status, 0, approved.stdout + approved.stderr);
  git('add', '-A'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const commit = msg => { git('add', '-A'); git('commit', '-qm', msg); };
  return { dir, base, write, commit, remove: rel => unlinkSync(join(dir, rel)) };
}

const item = (plan, path) => plan.classifications.find(c => c.path === path);
const unresolved = (plan, path) => item(plan, path)?.disposition === 'unsupported_or_ambiguous';

describe('a deleted file named by the spec that removes it is attributed (FR-001)', () => {
  it('links an exact path and a file under a named directory', () => {
    const { dir, base, remove, commit } = project();
    remove('scripts/old.sh');
    remove('legacy/a.mjs');
    commit('remove');
    const plan = buildReconciliationPlan(dir, {}, base);
    for (const path of ['scripts/old.sh', 'legacy/a.mjs']) {
      assert.deepEqual(item(plan, path)?.specs, ['acme.alpha'], path);
      assert.equal(unresolved(plan, path), false, path);
    }
  });

  it('leaves a deletion no spec names unresolved', () => {
    const { dir, base, remove, commit } = project();
    remove('src/gone.mjs');
    commit('remove');
    assert.equal(unresolved(buildReconciliationPlan(dir, {}, base), 'src/gone.mjs'), true);
  });
});

describe('naming a path is not evidence for a file that still exists (FR-002)', () => {
  it('a modified file named only in prose stays unresolved', () => {
    const { dir, base, write, commit } = project();
    write('src/keep.mjs', 'export const x = 2;\n');
    commit('change');
    const plan = buildReconciliationPlan(dir, {}, base);
    assert.equal(unresolved(plan, 'src/keep.mjs'), true);
  });

  it('an added file at a named path stays unresolved', () => {
    const { dir, base, remove, write, commit } = project();
    remove('scripts/old.sh');
    commit('remove');
    const middle = fixtureGit(dir, ['rev-parse', 'HEAD']).trim();
    write('scripts/old.sh', '#!/bin/sh\necho back\n');
    commit('re-add');
    assert.equal(unresolved(buildReconciliationPlan(dir, {}, middle), 'scripts/old.sh'), true);
    assert.ok(base);
  });
});

describe('only a current, approved spec, and only the whole path (FR-003)', () => {
  it('a draft spec naming the path does not link', () => {
    const { dir, base, remove, commit } = project();
    remove('src/beta-old.mjs');
    commit('remove');
    assert.equal(unresolved(buildReconciliationPlan(dir, {}, base), 'src/beta-old.mjs'), true);
  });

  it('a named directory that still exists does not claim a deletion under it', () => {
    const { dir, base, remove, commit } = project();
    remove('tools/a.mjs');
    commit('remove one helper');
    assert.equal(unresolved(buildReconciliationPlan(dir, {}, base), 'tools/a.mjs'), true);
  });

  it('near-miss names do not link', () => {
    const { dir, base, remove, commit } = project();
    for (const path of ['scripts/old.sh.mjs', 'x/scripts/old.sh', 'legacy-two/b.mjs']) remove(path);
    commit('remove');
    const plan = buildReconciliationPlan(dir, {}, base);
    for (const path of ['scripts/old.sh.mjs', 'x/scripts/old.sh', 'legacy-two/b.mjs']) {
      assert.equal(unresolved(plan, path), true, `${path} must not match a different named path`);
    }
  });
});

describe('the rule is documented (FR-004)', () => {
  it('the SPC006 help and the reconciliation docs name it', () => {
    assert.match(BLOCKER_CODES.SPC006.help, /removed file/i);
    assert.match(readFileSync('docs-canonical/ARCHITECTURE.md', 'utf8'), /a deleted file to a current, approved spec that names it/);
  });
});
