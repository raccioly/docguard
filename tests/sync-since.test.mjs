/**
 * L-1 / S-1 — `sync --since <ref>` surgical refresh.
 *
 * Verifies the section→file matcher logic. The actual sync execution is
 * tested end-to-end in tests/sync.test.mjs; here we focus on the new
 * scoping predicate.
 *
 * @req SC-L1-001 — when --since is provided and only docs changed, sync is a no-op
 * @req SC-L1-002 — when route files changed, the endpoints section is in scope
 * @req SC-L1-003 — when models changed, the entities section is in scope
 * @req SC-L1-004 — unknown section IDs default to "in scope" (conservative)
 * @req SC-L1-005 — null/empty changed-files list means "sync everything"
 * @req docguard.sync-section-scope#FR-001
 * @req docguard.sync-section-scope#SC-001
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// We test the internal matcher via a tiny re-implementation that mirrors
// sync.mjs's SECTION_FILE_MATCHERS. Keeping the matcher TABLE inline in
// sync.mjs (not exported) is fine — we exercise it via end-to-end tests
// in sync.test.mjs and the subprocess test below.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mechanicalSectionsForChanges, SECTION_FILE_MATCHERS, sectionTouchedByChanges } from '../cli/shared-sync-scope.mjs';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-sync-since-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function gitInit(dir) {
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
}

function commitAll(dir, msg) {
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg], { cwd: dir });
}

describe('sync --since — banner reflects scoping', () => {
  it('runs cleanly when --since target is invalid (no crash)', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# A\nstub.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    try {
      gitInit(dir);
      const r = spawnSync('node', [CLI, 'sync', '--since', 'nonexistent-ref'], { cwd: dir, encoding: 'utf-8' });
      // No crash; output mentions git unavailable OR the (empty) diff
      assert.ok(r.status === 0 || r.status === 2, `expected clean exit, got ${r.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports changed-file count from real git history', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'src/routes/users.ts': 'export const x = 1;',
      'docs-canonical/ARCHITECTURE.md': '# A\nstub.\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    try {
      gitInit(dir);
      // Modify one file
      writeFileSync(join(dir, 'src/routes/users.ts'), 'export const x = 2;');
      commitAll(dir, 'change route');

      const r = spawnSync('node', [CLI, 'sync', '--since', 'HEAD~1'], { cwd: dir, encoding: 'utf-8' });
      // Banner should mention "1 file(s) changed since HEAD~1"
      assert.match(r.stdout, /file\(s\) changed since HEAD~1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('section→file matcher (docguard.sync-section-scope)', () => {
  // The table was keyed `endpoints-table`, `entities-table`, … while the plan
  // emits `endpoints`, `entities`, …, so eight of ten sections never narrowed,
  // and this test asserted nothing. It now reads the plan's own section IDs.
  const planSource = readFileSync(join(process.cwd(), 'cli/scanners/memory-plan.mjs'), 'utf8');
  const planCodeIds = [...planSource.matchAll(/id: '([a-z-]+)',\s*\n\s*source: 'code'/g)].map(m => m[1]).sort();

  it('has exactly one matcher per source=code section the memory plan emits', () => {
    assert.ok(planCodeIds.length >= 10, `expected the plan's code sections, found ${planCodeIds.join(', ')}`);
    assert.deepEqual(Object.keys(SECTION_FILE_MATCHERS).sort(), planCodeIds);
  });

  it('a docs-only change refreshes nothing; a code change refreshes its sections', () => {
    assert.deepEqual(mechanicalSectionsForChanges(['docs-canonical/ARCHITECTURE.md', 'README.md']), []);
    const routeChange = mechanicalSectionsForChanges(['src/server.js']);
    for (const id of ['endpoints', 'entities', 'env-vars', 'component-map']) assert.ok(routeChange.includes(id), id);
    assert.equal(routeChange.includes('tech-stack'), false);
    assert.deepEqual(mechanicalSectionsForChanges(['package.json']), ['integrations', 'tech-stack']);
  });

  it('keeps the conservative defaults: unknown IDs and an empty change set stay in scope', () => {
    assert.equal(sectionTouchedByChanges('not-a-section', ['README.md']), true);
    assert.equal(sectionTouchedByChanges('endpoints', []), true);
    assert.equal(sectionTouchedByChanges('endpoints', ['README.md']), false);
    assert.equal(sectionTouchedByChanges('endpoints', ['api/openapi.yaml']), true);
    assert.equal(sectionTouchedByChanges('test-inventory', ['tests/a.test.mjs']), true);
    assert.equal(sectionTouchedByChanges('env-vars', ['.env.example']), true);
  });
});
