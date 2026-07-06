import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

describe('hooks with core.hooksPath=/dev/null', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  it('does not crash when core.hooksPath is /dev/null', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-hooks-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'v020-test', version: '0.0.1' }));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    spawnSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir });

    const r = spawnSync('node', [CLI, 'hooks'], {
      cwd: dir,
      encoding: 'utf-8',
    });

    assert.equal(r.status, 0, `Expected 0 exit, got ${r.status}\n${r.stderr}\n${r.stdout}`);
  });
});
