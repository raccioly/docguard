import { makeTempDir } from './helpers/temp-dir.mjs';
// @implements docguard.test-temp-dirs#FR-001: this file's temporary directories come from the helper.
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { runMcp } from '../cli/commands/mcp.mjs';

describe('runMcp', () => {
  it('exits with code 1 and logs to stderr if transport is invalid', async () => {
    const dir = makeTempDir('docguard-test-runMcp-');
    const originalStderrWrite = process.stderr.write;
    const originalExitCode = process.exitCode;
    let loggedStderr = '';

    try {
      process.stderr.write = (chunk) => {
        loggedStderr += chunk.toString();
        return true;
      };

      const config = {};
      const flags = { transport: 'invalid-transport' };

      const result = runMcp(dir, config, flags);

      assert.equal(result, undefined);
      assert.equal(process.exitCode, 1);
      assert.match(loggedStderr, /unknown transport "invalid-transport"/);

    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = originalExitCode;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits with code 1 and logs to stderr if buildServedRoots throws', async () => {
    const dir = makeTempDir('docguard-test-runMcp-');
    const originalStderrWrite = process.stderr.write;
    const originalExitCode = process.exitCode;
    let loggedStderr = '';

    try {
      process.stderr.write = (chunk) => {
        loggedStderr += chunk.toString();
        return true;
      };

      const config = {};
      const nonExistent = join(dir, 'does-not-exist');
      const flags = { roots: [nonExistent] };

      const result = runMcp(dir, config, flags);

      assert.equal(result, undefined);
      assert.equal(process.exitCode, 1);
      assert.match(loggedStderr, /--root does not exist/);

    } finally {
      process.stderr.write = originalStderrWrite;
      process.exitCode = originalExitCode;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
