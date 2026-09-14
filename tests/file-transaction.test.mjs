import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { commitFileTransaction } from '../cli/writers/file-transaction.mjs';

/** @req docguard.document-lifecycle#FR-013 */

describe('Lifecycle file transaction', () => {
  it('commits replacements, additions, and deletions as one set', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-transaction-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const keep = join(dir, 'keep.json');
    const remove = join(dir, 'remove.md');
    const add = join(dir, 'nested', 'add.json');
    writeFileSync(keep, 'old');
    writeFileSync(remove, 'retired');
    commitFileTransaction([
      { path: keep, content: 'new' },
      { path: add, content: '{}' },
      { path: remove, content: null },
    ]);
    assert.equal(readFileSync(keep, 'utf8'), 'new');
    assert.equal(readFileSync(add, 'utf8'), '{}');
    assert.throws(() => readFileSync(remove));
  });

  it('restores every original when a later mutation fails', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-transaction-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const first = join(dir, 'first.json');
    const second = join(dir, 'second.json');
    writeFileSync(first, 'first-old');
    writeFileSync(second, 'second-old');
    assert.throws(() => commitFileTransaction([
      { path: first, content: 'first-new' },
      { path: second, content: 'second-new' },
    ], { afterMutation: (_entry, count) => { if (count === 2) throw new Error('injected failure'); } }), /rolled back/);
    assert.equal(readFileSync(first, 'utf8'), 'first-old');
    assert.equal(readFileSync(second, 'utf8'), 'second-old');
  });

  it('rolls back when post-commit validation rejects the resulting set', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-transaction-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'nested'));
    const file = join(dir, 'nested', 'state.json');
    writeFileSync(file, 'valid-old');
    assert.throws(() => commitFileTransaction([{ path: file, content: 'invalid-new' }], {
      validate: () => { throw new Error('invalid projection'); },
    }), /rolled back/);
    assert.equal(readFileSync(file, 'utf8'), 'valid-old');
  });

  it('cleans already-staged files when preparation fails', t => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-transaction-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'state.json');
    writeFileSync(file, 'old');
    assert.throws(() => commitFileTransaction([
      { path: file, content: 'new' },
      { path: file, content: 'duplicate' },
    ]), /preparation failed/);
    assert.equal(readFileSync(file, 'utf8'), 'old');
    assert.deepEqual(readdirSync(dir), ['state.json']);
  });
});
