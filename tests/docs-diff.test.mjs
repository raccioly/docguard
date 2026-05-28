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

  // Regression for hugocross Bug 4: the docs-diff warning used to emit only
  // the COUNT ("1 documented but not found in code") and not the file path,
  // which made it completely unactionable — the user couldn't tell which of
  // 52 documented tests was the offender. The warning must now name the
  // file (capped at 5 inline + "(+N more)" for long lists).
  describe('warning includes the offending file path (hugocross bug 4)', () => {
    it('names a missing tech-stack entry', async () => {
      const { validateDocsDiff } = await import('../cli/validators/docs-diff.mjs');
      // Doc declares Redis; package.json declares NONE → "Redis documented but not found"
      write(tmpDir, 'docs-canonical/ARCHITECTURE.md', 'Built with Redis.');
      write(tmpDir, 'package.json', JSON.stringify({
        name: 'x',
        dependencies: { express: '^4' },
      }));

      const { warnings } = validateDocsDiff(tmpDir, {});
      const drift = warnings.find(w => w.includes('Tech Stack drift'));
      assert.ok(drift, `expected a tech-stack drift warning, got: ${warnings.join('\n')}`);
      assert.match(drift, /documented but not found in code: `Redis`/,
        `warning must name the file/tech; got: ${drift}`);
    });
  });
});
