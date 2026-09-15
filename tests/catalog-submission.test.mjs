import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const script = fileURLToPath(new URL('../.github/scripts/speckit-submission.py', import.meta.url));
const reminderScript = fileURLToPath(new URL('../.github/scripts/upsert-catalog-reminder.sh', import.meta.url));
const manifestPath = fileURLToPath(new URL('../extensions/spec-kit-docguard/extension.yml', import.meta.url));
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const catalogWorkflow = readFileSync(new URL('../.github/workflows/sync-speckit-catalog.yml', import.meta.url), 'utf8');
const download = 'https://example.com/docguard.zip';

function runReminder(existing = '') {
  const root = mkdtempSync(join(tmpdir(), 'docguard-catalog-reminder-'));
  const bin = join(root, 'bin');
  const log = join(root, 'gh.log');
  const body = join(root, 'body.md');
  mkdirSync(bin);
  writeFileSync(body, 'current reminder\n');
  const fakeGh = join(bin, 'gh');
  writeFileSync(fakeGh, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "issue" && "$2" == "list" ]]; then
  printf '%s' "\${FAKE_ISSUES:-}"
  exit 0
fi
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
`);
  chmodSync(fakeGh, 0o755);
  try {
    execFileSync('bash', [reminderScript, '1.2.3', body], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_ISSUES: existing,
        FAKE_GH_LOG: log,
        GH_TOKEN: 'test-token',
        GITHUB_REPOSITORY: 'raccioly/docguard',
      },
      encoding: 'utf8',
    });
    return readFileSync(log, 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

test('catalog workflows share one reminder upsert path', () => {
  for (const workflow of [releaseWorkflow, catalogWorkflow]) {
    assert.match(workflow, /bash \.github\/scripts\/upsert-catalog-reminder\.sh "\$VERSION" \/tmp\/reminder\.md/);
    assert.doesNotMatch(workflow, /Idempotent per-version|contains\(\\"v\$\{VERSION\}\\"\)/);
  }
});

test('catalog reminder refreshes the newest issue and closes stale duplicates', () => {
  const calls = runReminder('359\n363\n387\n');
  assert.match(calls, /issue edit 387 .* --title 📦 Submit DocGuard v1\.2\.3/);
  assert.match(calls, /issue close 359 .*Superseded .*#387/);
  assert.match(calls, /issue close 363 .*Superseded .*#387/);
  assert.doesNotMatch(calls, /issue close 387|issue create/);
});

test('catalog reminder opens one issue when none exists', () => {
  const calls = runReminder();
  assert.match(calls, /issue create .* --title 📦 Submit DocGuard v1\.2\.3/);
  assert.doesNotMatch(calls, /issue edit|issue close/);
});
