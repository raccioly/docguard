import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * @req specs/006-document-lifecycle/spec.md#FR-001
 * @req specs/006-document-lifecycle/spec.md#FR-002
 * @req specs/006-document-lifecycle/spec.md#FR-008
 * @req specs/006-document-lifecycle/spec.md#SC-004
 */

import { validateDocumentLifecycle } from '../cli/validators/document-lifecycle.mjs';

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function repository(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) write(dir, path, content);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  return dir;
}

describe('Document-Lifecycle validator', () => {
  it('is not applicable outside a Git working tree', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-lifecycle-no-git-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    write(dir, 'docs/old-plan.md', '# Plan\n\n**Status:** Superseded\n');

    const result = validateDocumentLifecycle(dir);

    assert.equal(result.applicable, false);
    assert.equal(result.findings.length, 0);
  });

  it('reports an explicit terminal state with high confidence', t => {
    const dir = repository(t, {
      'docs/old-plan.md': '# Plan\n\n**Status:** Superseded\n',
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'DLC001');
    assert.equal(result.findings[0].confidence, 'high');
  });

  it('reports a fully checked draft spec as a low-confidence review signal', t => {
    const dir = repository(t, {
      'specs/001-feature/spec.md': '# Feature\n\n**Status**: Draft\n',
      'specs/001-feature/tasks.md': '# Tasks\n\n- [x] T001 Build\n- [x] T002 Test\n',
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'DLC002');
    assert.equal(result.findings[0].confidence, 'low');
  });

  it('keeps active specs with open tasks clean', t => {
    const dir = repository(t, {
      'specs/002-active/spec.md': '# Feature\n\n**Status**: Active\n',
      'specs/002-active/tasks.md': '# Tasks\n\n- [x] T001 Design\n- [ ] T002 Build\n',
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 0);
  });

  it('ignores status-like examples outside document metadata', t => {
    const filler = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n');
    const dir = repository(t, {
      'README.md': `# Guide\n${filler}\nExample: **Status:** Deprecated\n`,
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 0);
  });

  it('does not treat free-form status prose as a terminal lifecycle declaration', t => {
    const dir = repository(t, {
      'README.md': '# Guide\n\n**Status:** Deprecated API support remains documented\n',
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 0);
  });

  it('treats completed artifact maturity as review-only', t => {
    const dir = repository(t, {
      'specs/003-complete/spec.md': '# Feature\n\n**Status:** Completed\n',
    });
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'DLC002');
    assert.equal(result.findings[0].confidence, 'low');
  });

  it('does not infer completion from an untracked task list', t => {
    const dir = repository(t, {
      'specs/004-active/spec.md': '# Feature\n\n**Status:** Draft\n',
    });
    write(dir, 'specs/004-active/tasks.md', '# Tasks\n\n- [x] T001 Local experiment\n');
    const result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 0);
  });

  it('accepts manifest-backed deletions and flags manifest entries that remain active', t => {
    const dir = repository(t, {
      'docs/old.md': '# Old\n',
      '.docguard-archive.json': JSON.stringify({
        schemaVersion: 1,
        strategy: 'git-history',
        retention: { ref: 'refs/heads/main', objectFormat: 'sha1', recoverability: 'verified' },
        entries: [{
          path: 'docs/old.md',
          archivedFrom: '0'.repeat(40),
          blob: '1'.repeat(40),
          reason: 'Superseded',
        }],
      }),
    });
    let result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'DLC004');
    rmSync(join(dir, 'docs', 'old.md'));
    result = validateDocumentLifecycle(dir);
    assert.equal(result.findings.length, 0);
  });

  it('rejects an incomplete recovery entry instead of trusting its tombstones', t => {
    const dir = repository(t, {
      '.docguard-archive.json': JSON.stringify({
        schemaVersion: 1,
        strategy: 'git-history',
        entries: [{ path: 'specs/retired/spec.md', requirementIds: ['FR-901'] }],
      }),
    });

    const result = validateDocumentLifecycle(dir);

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].code, 'DLC003');
    assert.match(result.findings[0].message, /invalid recovery entry/);
  });
});
