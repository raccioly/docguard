import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { diffTechStack } from '../cli/validators/docs-diff.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

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

  it('detects tech declared only in a sourceRoot package (monorepo)', () => {
    // Backend deps live in backend/package.json, not the root — must still be detected.
    write(tmpDir, 'docs-canonical/ARCHITECTURE.md', 'Built with Express and DynamoDB and Redis.');
    write(tmpDir, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    write(tmpDir, 'backend/package.json', JSON.stringify({
      dependencies: { express: '^4', '@aws-sdk/client-dynamodb': '^3', ioredis: '^5' },
    }));
    write(tmpDir, 'backend/src/server.ts', 'export {};');

    const result = diffTechStack(tmpDir, { sourceRoot: 'backend/src' });
    // Express, DynamoDB, Redis are documented AND in code → not false "documented but not found"
    assert.ok(!result.onlyInDocs.includes('Express'));
    assert.ok(!result.onlyInDocs.includes('DynamoDB'));
    assert.ok(!result.onlyInDocs.includes('Redis'));
  });

  it('detects Docker via a Dockerfile (not an npm dependency)', () => {
    write(tmpDir, 'docs-canonical/ARCHITECTURE.md', 'Deployed with Docker.');
    write(tmpDir, 'package.json', JSON.stringify({ dependencies: {} }));
    write(tmpDir, 'Dockerfile', 'FROM node:20');

    const result = diffTechStack(tmpDir, {});
    assert.ok(!result.onlyInDocs.includes('Docker'), 'Docker should be detected via Dockerfile');
  });
});
