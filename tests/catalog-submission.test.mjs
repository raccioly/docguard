import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../.github/scripts/speckit-submission.py', import.meta.url));
const manifestPath = fileURLToPath(new URL('../extensions/spec-kit-docguard/extension.yml', import.meta.url));
const download = 'https://example.com/docguard.zip';

function manifestCounts() {
  const manifest = readFileSync(manifestPath, 'utf8');
  const commands = manifest.match(/^  commands:\n([\s\S]*?)(?=^  \S|^hooks:)/m)?.[1]
    .match(/^    - name:/gm)?.length ?? 0;
  const hooks = manifest.match(/^hooks:\n([\s\S]*?)(?=^\S)/m)?.[1]
    .match(/^  [a-z_]+:/gm)?.length ?? 0;
  return { commands, hooks };
}

test('catalog draft does not attest to tests that have not run', () => {
  const body = execFileSync('python3', ['-B', script, '--body', '1.2.3', download], { encoding: 'utf8' });
  assert.match(body, /### Version\n\n1\.2\.3/);
  assert.match(body, /- \[ \] Extension installs successfully/);
  assert.doesNotMatch(body, /- \[x\]|The only doc-integrity|19-validator|Scenarios verified/);
  assert.match(body, /Scenarios to verify for this release/);
});

test('catalog draft derives command and hook counts from the extension manifest', () => {
  const expected = manifestCounts();
  const body = execFileSync('python3', ['-B', script, '--body', '1.2.3', download], { encoding: 'utf8' });
  assert.ok(expected.commands > 0);
  assert.ok(expected.hooks > 0);
  assert.match(body, new RegExp(`### Number of Commands\\n\\n${expected.commands}\\b`));
  assert.match(body, new RegExp(`### Number of Hooks \\(optional\\)\\n\\n${expected.hooks}\\b`));
  assert.match(body, new RegExp(`All ${expected.commands} declared .* commands resolve and run`));
  assert.match(body, new RegExp(`All ${expected.hooks} declared workflow hooks register`));
  assert.doesNotMatch(body, /\b\d+ validators\b/);
});

test('catalog form retains release identity in a bounded URL', () => {
  const text = execFileSync('python3', ['-B', script, '--url', '1.2.3', download], { encoding: 'utf8' }).trim();
  const url = new URL(text);
  const expected = manifestCounts();
  assert.ok(text.length <= 6000);
  assert.equal(url.searchParams.get('version'), '1.2.3');
  assert.equal(url.searchParams.get('download-url'), download);
  assert.equal(url.searchParams.get('template'), 'extension_submission.yml');
  assert.equal(url.searchParams.get('commands-count'), String(expected.commands));
  assert.equal(url.searchParams.get('hooks-count'), String(expected.hooks));
});

test('catalog form respects upstream description and tag bounds', () => {
  const text = execFileSync('python3', ['-B', script, '--url', '1.2.3', download], { encoding: 'utf8' }).trim();
  const url = new URL(text);
  const description = url.searchParams.get('description');
  const tags = url.searchParams.get('tags').split(',').map(tag => tag.trim()).filter(Boolean);
  assert.ok(description.length > 0 && description.length <= 200);
  assert.ok(tags.length >= 2 && tags.length <= 5);
});
