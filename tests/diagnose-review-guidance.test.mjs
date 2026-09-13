import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { safeWrite } from '../cli/writers/generate-io.mjs';

const cli = resolve('cli/docguard.mjs');

test('diagnose keeps freshness as review for conventional and custom documents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-diagnose-review-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    safeWrite(join(dir, 'src/index.mjs'), 'export const ready = true;\n');
    execFileSync('git', ['add', 'src/index.mjs'], { cwd: dir });
    for (let i = 0; i < 3; i++) execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'Synthetic source'], { cwd: dir });
    safeWrite(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n');
    safeWrite(join(dir, 'handbook/guide.md'), '# Operating guide\n');
    safeWrite(join(dir, '.docguard.json'), JSON.stringify({ docs: { dirs: ['handbook'] } }));
    const output = execFileSync(process.execPath, [cli, 'diagnose', '--dir', dir, '--format', 'json'], { encoding: 'utf8' });
    const result = JSON.parse(output);
    const reviews = result.issues.filter(issue => issue.validator === 'Freshness');
    assert.ok(reviews.some(issue => issue.message.includes('ARCHITECTURE.md')));
    assert.ok(reviews.some(issue => issue.message.includes('guide.md')));
    for (const issue of reviews) {
      assert.equal(issue.command, null);
      assert.equal(issue.docTarget, null);
      assert.match(issue.action, /Review document evidence/);
    }
    const prompt = execFileSync(process.execPath, [cli, 'diagnose', '--dir', dir, '--format', 'prompt'], { encoding: 'utf8' });
    assert.match(prompt, /explain remaining review signals and unsupported checks/);
    assert.doesNotMatch(prompt, /Expected result: All checks pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
