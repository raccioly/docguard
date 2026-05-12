import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocQuality } from '../cli/validators/doc-quality.mjs';

describe('Doc-Quality Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty results when no docs exist', () => {
    const result = validateDocQuality(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('skips documents with insufficient prose', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    // Less than 50 words and/or less than 3 sentences.
    writeFileSync(join(tmpDir, 'docs-canonical', 'REFERENCE.md'), '# API Reference\n| Method | Description |\n|---|---|\n| `foo()` | Does foo |');

    const result = validateDocQuality(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('reports warnings for poor quality documents', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });

    // Construct a document with poor readability, high passive voice, high negation, ambiguous pronouns, etc.
    const poorContent = `
# Poor Document

It was decided by the committee that this must not be done by the system unless it cannot find the file and if it does not work.
That is an issue. It was created by them. This was destroyed by it.
It should not do that if it cannot find the other thing, provided that the system is not offline.
The system was restarted by the user. The database was corrupted by the update. The data was lost.
Furthermore, the remarkably extraordinarily complicated functionality was instantiated by the incredibly sophisticated architectural mechanism.
It is not known why this was done. The file was deleted by the process. The error was not handled by the catch block.
This was seen by the operator. It was ignored by them. The warning was not displayed by the UI.

It was this that they did. These are those that it was. Theirs is them. Its this that they are.
It is this. It is that. They are them. These are those.
    `.trim();

    writeFileSync(join(tmpDir, 'docs-canonical', 'POOR.md'), poorContent);

    const result = validateDocQuality(tmpDir, {});

    assert.strictEqual(result.errors.length, 0);
    // Should have multiple warnings
    assert.ok(result.warnings.length > 0);
    assert.ok(result.total > 0);
    // At least one warning about passive voice should be present
    assert.ok(result.warnings.some(w => w.includes('passive voice')));
    // At least one warning about ambiguous pronouns should be present
    assert.ok(result.warnings.some(w => w.includes('ambiguous pronoun ratio')));
  });

  it('passes high quality documents without warnings', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });

    // Construct a document with simple, active voice sentences and clear language
    const goodContent = `
# High Quality Document

The system saves the file to the disk. The user clicks the button.
The application displays the success message. The database stores the new record.
The background job processes the queue. The API returns a JSON response.
The client application parses the data. The server logs the transaction.
The developer deploys the new code. The automated tests verify the changes.
The continuous integration pipeline builds the artifact. The monitoring system tracks the performance.
The team reviews the pull request. The designer creates the new interface.
The manager approves the budget. The customer buys the product.
    `.trim();

    writeFileSync(join(tmpDir, 'docs-canonical', 'GOOD.md'), goodContent);

    const result = validateDocQuality(tmpDir, {});

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.warnings.length, 0);
    assert.strictEqual(result.passed, result.total);
    assert.ok(result.total > 0);
  });
});
