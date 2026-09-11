import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../.github/scripts/speckit-submission.py', import.meta.url));
const download = 'https://example.com/docguard.zip';
test('catalog draft does not attest to tests that have not run', () => {
  const body = execFileSync('python3', ['-B', script, '--body', '1.2.3', download], { encoding: 'utf8' });
  assert.match(body, /### Version\n\n1\.2\.3/);
  assert.match(body, /- \[ \] Extension installs successfully/);
  assert.doesNotMatch(body, /- \[x\]|The only doc-integrity|19-validator|Scenarios verified/);
  assert.match(body, /Scenarios to verify for this release/);
});
test('catalog form retains release identity in a bounded URL', () => {
  const text = execFileSync('python3', ['-B', script, '--url', '1.2.3', download], { encoding: 'utf8' }).trim();
  const url = new URL(text);
  assert.ok(text.length <= 6000);
  assert.equal(url.searchParams.get('version'), '1.2.3');
  assert.equal(url.searchParams.get('download-url'), download);
  assert.equal(url.searchParams.get('template'), 'extension_submission.yml');
});
