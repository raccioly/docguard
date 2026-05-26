/**
 * v0.14-P1 — Fix-history ping-pong suppression.
 *
 * Verifies the `shouldSuppressFix` predicate alone (unit-level), then
 * verifies the full apply→record→re-apply→suppress loop through
 * `applyMechanicalFixes`.
 *
 * @req SC-P1-001 — never suppresses on first apply
 * @req SC-P1-002 — suppresses after threshold applies
 * @req SC-P1-003 — force: true / forceRedo: true overrides suppression
 * @req SC-P1-004 — applyCount increments per apply
 * @req SC-P1-005 — firstAppliedAt is preserved across applies
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  appendFixes,
  shouldSuppressFix,
  loadFixMemory,
} from '../cli/writers/fix-memory.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'docguard-suppress-'));
}

describe('shouldSuppressFix — ping-pong gate', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const fix = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };

  it('does NOT suppress when the fix has never been recorded', () => {
    dir = tmp();
    const decision = shouldSuppressFix(dir, fix);
    assert.equal(decision.suppressed, false);
  });

  it('does NOT suppress after a single apply (count = 1, below threshold = 2)', () => {
    dir = tmp();
    appendFixes(dir, [fix]);
    const decision = shouldSuppressFix(dir, fix);
    assert.equal(decision.suppressed, false, 'one apply should not yet suppress');
  });

  it('suppresses after two applies (count >= threshold)', () => {
    dir = tmp();
    appendFixes(dir, [fix]);   // count = 1
    appendFixes(dir, [fix]);   // count = 2 → ping-pong starts here
    const decision = shouldSuppressFix(dir, fix);
    assert.equal(decision.suppressed, true);
    assert.match(decision.reason, /applied.*time/i);
    assert.match(decision.reason, /--force-redo/);
  });

  it('respects a custom pingPongThreshold', () => {
    dir = tmp();
    appendFixes(dir, [fix]);   // count = 1
    // Strict threshold: 1 means even the first apply would be "already done"
    const strict = shouldSuppressFix(dir, fix, { pingPongThreshold: 1 });
    assert.equal(strict.suppressed, true);
    // Lax threshold: 5 means even after several applies, no suppression
    const lax = shouldSuppressFix(dir, fix, { pingPongThreshold: 5 });
    assert.equal(lax.suppressed, false);
  });

  it('force: true overrides suppression entirely', () => {
    dir = tmp();
    appendFixes(dir, [fix]);
    appendFixes(dir, [fix]);
    appendFixes(dir, [fix]); // count = 3, would normally suppress
    const decision = shouldSuppressFix(dir, fix, { force: true });
    assert.equal(decision.suppressed, false);
  });
});

describe('appendFixes — applyCount tracking', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const fix = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };

  it('starts applyCount at 1 for a fresh fix', () => {
    dir = tmp();
    appendFixes(dir, [fix]);
    const mem = loadFixMemory(dir);
    assert.equal(mem.entries[0].applyCount, 1);
  });

  it('increments applyCount on each re-apply of the same fingerprint', () => {
    dir = tmp();
    appendFixes(dir, [fix]);
    appendFixes(dir, [fix]);
    appendFixes(dir, [fix]);
    const mem = loadFixMemory(dir);
    assert.equal(mem.entries.length, 1, 'should still be one entry (deduped by fingerprint)');
    assert.equal(mem.entries[0].applyCount, 3);
  });

  it('preserves firstAppliedAt across applies', () => {
    dir = tmp();
    appendFixes(dir, [fix]);
    const first = loadFixMemory(dir).entries[0].firstAppliedAt;
    // Tiny gap so the second appliedAt timestamp would differ
    appendFixes(dir, [fix]);
    const updated = loadFixMemory(dir).entries[0];
    assert.equal(updated.firstAppliedAt, first,
      'firstAppliedAt is set once and never changed');
    assert.ok(updated.appliedAt >= first,
      'appliedAt is bumped to the latest');
  });

  it('different fixes have independent applyCount', () => {
    dir = tmp();
    const a = { type: 'replace-version', file: 'README.md', summary: 'v1' };
    const b = { type: 'replace-count', file: 'AGENTS.md', summary: '20 → 21' };
    appendFixes(dir, [a]);
    appendFixes(dir, [a]);
    appendFixes(dir, [b]);
    const mem = loadFixMemory(dir);
    const aEntry = mem.entries.find(e => e.type === 'replace-version');
    const bEntry = mem.entries.find(e => e.type === 'replace-count');
    assert.equal(aEntry.applyCount, 2);
    assert.equal(bEntry.applyCount, 1);
  });
});
