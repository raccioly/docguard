import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { diffTechStack } from '../cli/validators/docs-diff.mjs';

describe('Docs-Diff Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles malformed package.json gracefully', () => {
    // Setup a malformed package.json and an ARCHITECTURE.md file
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'React, Node.js');
    writeFileSync(join(tmpDir, 'package.json'), '{ "name": "test", "dependencies": { "react": "^18.0.0", } }'); // Invalid JSON (trailing comma)

    const result = diffTechStack(tmpDir);

    // Testing this requires creating a malformed package.json file and expecting a null return.
    assert.strictEqual(result, null);
  });
});
