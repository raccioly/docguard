/**
 * @req docguard.adoption-workflow-integrity#FR-007
 * @req docs-canonical/REQUIREMENTS.md#FR-012
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;

describe('findingSeverity config contract', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function fixture(findingSeverity) {
    dir = mkdtempSync(join(tmpdir(), 'docguard-finding-policy-'));
    const files = {
      'package.json': JSON.stringify({ name: 'finding-policy', version: '1.0.0' }),
      '.docguard.json': JSON.stringify({
        version: '0.6', projectName: 'finding-policy', profile: 'starter',
        requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'] }, findingSeverity,
      }),
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }

  it('normalizes code case and exposes exact-code enforcement', () => {
    fixture({ str001: 'LOW' });
    const result = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    assert.ok([0, 1, 2].includes(result.status), result.stderr);
    const finding = JSON.parse(result.stdout).findings.find(item => item.code === 'STR001');
    assert.equal(finding.effectiveSeverity, 'info');
    assert.deepEqual(finding.enforcement, { level: 'info', source: 'finding', key: 'STR001' });
  });

  it('fails closed on an unknown finding code', () => {
    fixture({ XYZ999: 'low' });
    const result = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /findingSeverity\.XYZ999 is not a known finding code/);
  });
});
