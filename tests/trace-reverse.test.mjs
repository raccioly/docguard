/**
 * L-2 / S-3 — `trace --reverse <code-path>` reverse traceability.
 *
 * @req SC-L2-001 — reverse trace finds direct path references
 * @req SC-L2-002 — reverse trace finds basename references
 * @req SC-L2-003 — reverse trace finds module-name references (backticked stem)
 * @req SC-L2-004 — reverse trace emits an actionable warning when zero hits
 * @req SC-L2-005 — JSON mode emits structured output
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-trace-rev-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('trace --reverse', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('errors with usage when no positional arg is given', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md': '# A\n',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    const r = spawnSync('node', [CLI, 'trace', '--reverse'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /requires a target path/);
  });

  it('finds direct path references', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\nThe user route lives at `src/routes/users.ts` and handles auth.\n',
      'src/routes/users.ts': 'export const x = 1;',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    const r = spawnSync('node', [CLI, 'trace', '--reverse', 'src/routes/users.ts'],
      { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /ARCHITECTURE\.md/);
    assert.match(r.stdout, /reference\(s\)/);
  });

  it('finds basename-only references', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\nSee `users.ts` for the user routes implementation.\n',
      'src/routes/users.ts': 'x',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    const r = spawnSync('node', [CLI, 'trace', '--reverse', 'src/routes/users.ts'],
      { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /ARCHITECTURE\.md/);
    assert.match(r.stdout, /basename/);
  });

  it('warns when the file has no canonical references', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nNothing about user routes here.\n',
      'src/routes/users.ts': 'x',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    const r = spawnSync('node', [CLI, 'trace', '--reverse', 'src/routes/users.ts'],
      { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /No canonical doc references/);
  });

  it('emits JSON when --format json is set', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md': '# A\nSee `src/routes/users.ts`.\n',
      'src/routes/users.ts': 'x',
      '.docguard.json': JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }),
    });
    const r = spawnSync('node', [CLI, 'trace', '--reverse', 'src/routes/users.ts', '--format', 'json'],
      { cwd: dir, encoding: 'utf-8' });
    // JSON should parse without crashing — banner + ensureSkills must be suppressed.
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.target, 'src/routes/users.ts');
    assert.ok(Array.isArray(parsed.matches));
    assert.ok(parsed.matches.length >= 1);
    assert.ok(parsed.matches[0].doc);
    assert.ok(parsed.matches[0].kind);
  });
});
