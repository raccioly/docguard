import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * @req specs/006-document-lifecycle/spec.md#FR-001
 * @req specs/006-document-lifecycle/spec.md#FR-002
 * @req specs/006-document-lifecycle/spec.md#FR-003
 * @req specs/006-document-lifecycle/spec.md#FR-004
 * @req specs/006-document-lifecycle/spec.md#FR-005
 * @req specs/006-document-lifecycle/spec.md#FR-006
 * @req specs/006-document-lifecycle/spec.md#FR-007
 * @req specs/006-document-lifecycle/spec.md#FR-008
 * @req specs/006-document-lifecycle/spec.md#FR-009
 * @req specs/006-document-lifecycle/spec.md#SC-001
 * @req specs/006-document-lifecycle/spec.md#SC-002
 * @req specs/006-document-lifecycle/spec.md#SC-003
 */

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs', '001-done'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'specs', '001-done', 'spec.md'), '# Feature\n\n**Status**: Draft\n\n- **FR-701**: Build the feature.\n');
  writeFileSync(join(dir, 'specs', '001-done', 'tasks.md'), '# Tasks\n\n- [x] Build it\n');
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
  writeFileSync(join(dir, 'docs', 'old.md'), '# Old plan\n\n**Status:** Superseded\n');
  writeFileSync(join(dir, '.gitignore'), '.docguard/\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'] },
  }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'archive@example.test');
  git(dir, 'config', 'user.name', 'Archive Test');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'fixture');
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, 'retire', '--dir', dir, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('docguard retire', () => {
  it('plans without mutating and reports completed draft specs for review', t => {
    const dir = fixture(t);
    const result = run(dir, ['--plan', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'PLAN');
    assert.deepEqual(report.candidates.map(candidate => candidate.path), ['docs/old.md', 'specs/001-done']);
    assert.equal(git(dir, 'status', '--porcelain'), '');
  });

  it('makes --check fail when lifecycle candidates remain', t => {
    const result = run(fixture(t), ['--check', '--format', 'json']);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).candidates.length, 2);
  });

  it('keeps completed-task review signals non-blocking unless strict mode is requested', t => {
    const dir = fixture(t);
    git(dir, 'rm', '-q', 'docs/old.md');
    git(dir, 'commit', '-qm', 'remove explicit terminal candidate');
    const advisory = run(dir, ['--check', '--format', 'json']);
    assert.equal(advisory.status, 0, advisory.stderr);
    assert.equal(JSON.parse(advisory.stdout).candidates[0].confidence, 'review');
    const strict = run(dir, ['--check', '--fail-on-warning', '--format', 'json']);
    assert.equal(strict.status, 2);
  });

  it('retires explicit clean files to Git history with restoration metadata', t => {
    const dir = fixture(t);
    const result = run(dir, [
      '--write', '--path', 'specs/001-done', '--reason', 'Implemented and reflected in current docs',
      '--superseded-by', 'docs-canonical/ARCHITECTURE.md', '--format', 'json',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(dir, 'specs', '001-done', 'spec.md')), false);
    const manifest = JSON.parse(readFileSync(join(dir, '.docguard-archive.json'), 'utf8'));
    assert.equal(manifest.strategy, 'git-history');
    assert.equal(manifest.entries.length, 2);
    assert.equal(manifest.entries[0].reason, 'Implemented and reflected in current docs');
    assert.match(manifest.entries[0].restore, /^git restore --source='[0-9a-f]+' -- '/);
    assert.match(manifest.entries[0].blob, /^[0-9a-f]+$/);
    assert.equal(manifest.entries[0].retentionRef, 'refs/heads/main');
    assert.match(manifest.entries[0].objectFormat, /^sha(?:1|256)$/);
    assert.equal(manifest.entries[0].recoverability, 'verified');
    const specEntry = manifest.entries.find(entry => entry.path.endsWith('/spec.md'));
    assert.deepEqual(specEntry.requirementIds, ['FR-701']);
    assert.match(git(dir, 'status', '--short'), /\?\? \.docguard-archive\.json/);
  });

  it('refuses dirty files', t => {
    const dir = fixture(t);
    writeFileSync(join(dir, 'specs', '001-done', 'spec.md'), '# Changed\n');
    const result = run(dir, ['--write', '--path', 'specs/001-done', '--reason', 'Done', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /clean tracked file/);
    assert.equal(existsSync(join(dir, '.docguard-archive.json')), false);
  });

  it('refuses a directory selection that would leave untracked content behind', t => {
    const dir = fixture(t);
    writeFileSync(join(dir, 'specs', '001-done', 'notes.md'), '# Untracked notes\n');
    const result = run(dir, ['--write', '--path', 'specs/001-done', '--reason', 'Done', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /untracked or ignored files/);
    assert.equal(existsSync(join(dir, '.docguard-archive.json')), false);
  });

  it('refuses required canonical documents', t => {
    const dir = fixture(t);
    const result = run(dir, ['--write', '--path', 'docs-canonical/ARCHITECTURE.md', '--reason', 'Wrong', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /required file/);
  });

  it('refuses paths outside the repository', t => {
    const result = run(fixture(t), ['--write', '--path', '../outside.md', '--reason', 'Wrong', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /inside the repository/);
  });

  it('refuses source-code paths even when explicitly selected', t => {
    const dir = fixture(t);
    mkdirSync(join(dir, 'cli'), { recursive: true });
    writeFileSync(join(dir, 'cli', 'danger.mjs'), 'export const danger = true;\n');
    git(dir, 'add', 'cli/danger.mjs');
    git(dir, 'commit', '-qm', 'add source');
    const result = run(dir, ['--write', '--path', 'cli', '--reason', 'Wrong', '--format', 'json']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /documentation files only/);
    assert.equal(existsSync(join(dir, 'cli', 'danger.mjs')), true);
  });

  it('requires replacement and consolidation evidence to be committed and clean', t => {
    const dir = fixture(t);
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Dirty replacement\n');
    const result = run(dir, [
      '--write', '--path', 'specs/001-done', '--reason', 'Done',
      '--superseded-by', 'docs-canonical/ARCHITECTURE.md', '--format', 'json',
    ]);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /must be clean/);
    assert.equal(existsSync(join(dir, 'specs', '001-done', 'spec.md')), true);
  });

  it('requires the source revision to be reachable from the retention ref', t => {
    const dir = fixture(t);
    git(dir, 'checkout', '-qb', 'feature');
    writeFileSync(join(dir, 'docs', 'branch-only.md'), '# Branch only\n');
    git(dir, 'add', 'docs/branch-only.md');
    git(dir, 'commit', '-qm', 'branch-only docs');
    const result = run(dir, [
      '--write', '--path', 'docs/branch-only.md', '--reason', 'Wrong branch',
      '--retention-ref', 'refs/heads/main', '--format', 'json',
    ]);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /not retained/);
    assert.equal(existsSync(join(dir, 'docs', 'branch-only.md')), true);
  });

  it('refuses retirement while a current document links to the selected file', t => {
    const dir = fixture(t);
    writeFileSync(join(dir, 'docs', 'current.md'), '# Current\n\nSee [the old plan](old.md).\n');
    git(dir, 'add', 'docs/current.md');
    git(dir, 'commit', '-qm', 'add backreference');
    const result = run(dir, [
      '--write', '--path', 'docs/old.md', '--reason', 'Superseded', '--format', 'json',
    ]);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /live backreference/);
    assert.equal(existsSync(join(dir, 'docs', 'old.md')), true);
  });
});
