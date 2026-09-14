import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, lstatSync, readlinkSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { safeWrite } from '../cli/writers/generate-io.mjs';

const cli = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
function snapshot(root, dir = root) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), stat = lstatSync(path);
    const relative = path.slice(root.length + 1);
    if (stat.isSymbolicLink()) entries.push([relative, 'link', readlinkSync(path)]);
    else if (stat.isDirectory()) entries.push([relative, 'directory'], ...snapshot(root, path));
    else entries.push([relative, readFileSync(path).toString('base64')]);
  }
  return entries;
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dg-agents-readonly-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project'), bin = join(root, 'bin'), log = join(root, 'specify.log');
  safeWrite(join(project, 'package.json'), '{"name":"read-only-fixture","version":"1.0.0"}');
  safeWrite(join(project, 'AGENTS.md'), '# Agent instructions\n\nFollow the documented requirements.\n');
  safeWrite(join(bin, 'specify'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCGUARD_TEST_SPECIFY_LOG"\nexit 0\n');
  chmodSync(join(bin, 'specify'), 0o755);
  safeWrite(join(bin, 'which'), '#!/bin/sh\ncommand -v "$1"\n');
  chmodSync(join(bin, 'which'), 0o755);
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    cwd: project, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: bin, DOCGUARD_TEST_SPECIFY_LOG: log },
  });
  return { project, log, run };
}
for (const state of ['unmanaged', 'fresh', 'stale']) {
  test('agents --check preserves the tree and avoids setup: ' + state, t => {
    const { project, log, run } = fixture(t);
    if (state !== 'unmanaged') {
      const synced = run(['agents', '--sync', '--quiet']);
      assert.equal(synced.status, 0, synced.stderr + synced.stdout);
    }
    if (state === 'stale') safeWrite(join(project, 'AGENTS.md'), '# Changed instructions\n');
    // Discard calls from intentional fixture setup; only the check is under test.
    rmSync(log, { force: true });
    const before = snapshot(project);
    const result = run(['agents', '--check']);
    assert.equal(result.status, state === 'stale' ? 2 : 0, result.stderr + result.stdout);
    assert.deepEqual(snapshot(project), before);
    assert.equal(existsSync(log), false, 'a check must not invoke host setup tooling');
  });
}
test('explicit agent setup retains its setup path', t => {
  const { project, log, run } = fixture(t);
  const result = run(['agents', '--sync']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(existsSync(log), true, 'setup control must exercise the installed tooling trap');
  assert.equal(existsSync(join(project, 'CLAUDE.md')), true);
});
