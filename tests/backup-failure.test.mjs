/**
 * DocGuard CLI Tests — Backup failure handling
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

const run = (args, cwd) => execSync(`node ${CLI} ${args}`, {
  encoding: 'utf-8',
  cwd: cwd || join(__dirname, '..'),
  env: { ...process.env, NO_COLOR: '1' },
});

describe('docguard generate backup failure', () => {
  it('continues generating docs even if backup fails', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-backup-fail-'));
    try {
      // 1. Setup: Create docs-canonical directory
      const docsDir = join(tmpDir, 'docs-canonical');
      mkdirSync(docsDir, { recursive: true });

      // 2. Setup: Create an existing ARCHITECTURE.md with content
      const archPath = join(docsDir, 'ARCHITECTURE.md');
      const initialContent = 'initial content';
      writeFileSync(archPath, initialContent);

      // 3. Setup: Create a directory where the backup file should be
      // This will cause copyFileSync(archPath, archPath + '.bak') to fail
      // because it cannot overwrite a directory with a file.
      const backupPath = archPath + '.bak';
      mkdirSync(backupPath);

      // 4. Action: Run generate --force
      // --force is required to trigger overwrite of existing files
      const output = run(`generate --dir ${tmpDir} --force`);

      // 5. Verify: Command should succeed
      assert.match(output, /Generated:/);

      // 6. Verify: ARCHITECTURE.md should be overwritten despite backup failure
      const newContent = readFileSync(archPath, 'utf-8');
      assert.notEqual(newContent, initialContent, 'ARCHITECTURE.md should have been overwritten');
      assert.match(newContent, /# Architecture/, 'ARCHITECTURE.md should contain generated content');

      // 7. Verify: Backup directory still exists (backup failed but didn't crash)
      assert.ok(existsSync(backupPath), 'Backup path (directory) should still exist');
      assert.ok(statSync(backupPath).isDirectory(), 'Backup path should still be a directory');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
