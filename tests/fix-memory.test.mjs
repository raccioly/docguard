/**
 * M-2 / S-10 — `.docguard/fixed.json` fix-history audit log.
 *
 * @req SC-M2-001 — loadFixMemory returns empty shape when file missing
 * @req SC-M2-002 — appendFixes creates .docguard/ dir if needed
 * @req SC-M2-003 — appendFixes dedupes by fingerprint
 * @req SC-M2-004 — fingerprint is stable across calls
 * @req SC-M2-005 — entries are capped at MAX_ENTRIES
 * @req SC-M2-006 — isFixRecorded returns true after appendFixes
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadFixMemory,
  appendFixes,
  fingerprintFix,
  isFixRecorded,
} from '../cli/writers/fix-memory.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'docguard-fixmem-'));
}

describe('fingerprintFix', () => {
  it('produces a stable 12-char hex digest', () => {
    const f = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };
    const id1 = fingerprintFix(f);
    const id2 = fingerprintFix(f);
    assert.equal(id1, id2);
    assert.match(id1, /^[a-f0-9]{12}$/);
  });

  it('differs by type, file, and summary', () => {
    const a = fingerprintFix({ type: 'A', file: 'x', summary: 's' });
    const b = fingerprintFix({ type: 'B', file: 'x', summary: 's' });
    const c = fingerprintFix({ type: 'A', file: 'y', summary: 's' });
    const d = fingerprintFix({ type: 'A', file: 'x', summary: 't' });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, d);
  });
});

describe('loadFixMemory', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns empty shape when no .docguard/fixed.json exists', () => {
    dir = tmp();
    const m = loadFixMemory(dir);
    assert.equal(m.schemaVersion, '1');
    assert.deepEqual(m.entries, []);
  });

  it('handles a malformed JSON file gracefully (no throw)', () => {
    dir = tmp();
    mkdirSync(join(dir, '.docguard'));
    writeFileSync(join(dir, '.docguard', 'fixed.json'), '{not valid');
    const m = loadFixMemory(dir);
    assert.deepEqual(m.entries, [],
      'malformed file should be treated as empty, never crash');
  });
});

describe('appendFixes', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('creates .docguard/ dir if needed', () => {
    dir = tmp();
    appendFixes(dir, [{ type: 'replace-version', file: 'README.md', summary: 'v1 → v2' }]);
    assert.ok(existsSync(resolve(dir, '.docguard/fixed.json')),
      '.docguard/fixed.json should be created');
  });

  it('records new fixes', () => {
    dir = tmp();
    appendFixes(dir, [
      { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' },
      { type: 'replace-count', file: 'AGENTS.md', summary: '19 → 20 validators' },
    ]);
    const m = loadFixMemory(dir);
    assert.equal(m.entries.length, 2);
    assert.ok(m.entries.every(e => e.id && e.type && e.appliedAt));
  });

  it('dedupes by fingerprint — same fix logged twice = one entry', () => {
    dir = tmp();
    const fix = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };
    appendFixes(dir, [fix]);
    const firstApplied = loadFixMemory(dir).entries[0].appliedAt;
    // Apply the same fix again later
    appendFixes(dir, [fix]);
    const m = loadFixMemory(dir);
    assert.equal(m.entries.length, 1, 'duplicate fingerprint must not add a new entry');
    // appliedAt should update (or at least not break)
    assert.ok(m.entries[0].appliedAt >= firstApplied);
  });

  it('records appliedBy so we can tell auto-fix from manual runs', () => {
    dir = tmp();
    appendFixes(dir,
      [{ type: 'replace-version', file: 'X.md', summary: 'v1 → v2' }],
      'docguard-bot'
    );
    const m = loadFixMemory(dir);
    assert.equal(m.entries[0].appliedBy, 'docguard-bot');
  });

  it('persists JSON in a parseable, human-readable form', () => {
    dir = tmp();
    appendFixes(dir, [{ type: 'replace-count', file: 'README.md', summary: '20 → 21' }]);
    const raw = readFileSync(resolve(dir, '.docguard/fixed.json'), 'utf-8');
    assert.doesNotThrow(() => JSON.parse(raw));
    assert.match(raw, /\n {2}"schemaVersion"/, 'should be pretty-printed (2-space indent)');
  });
});

describe('isFixRecorded', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns false before the fix is recorded', () => {
    dir = tmp();
    const fix = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };
    assert.equal(isFixRecorded(dir, fix), false);
  });

  it('returns true after appendFixes records the same fingerprint', () => {
    dir = tmp();
    const fix = { type: 'replace-version', file: 'README.md', summary: 'v1 → v2' };
    appendFixes(dir, [fix]);
    assert.equal(isFixRecorded(dir, fix), true);
    // Different fix: still false
    assert.equal(isFixRecorded(dir, { ...fix, summary: 'different' }), false);
  });
});
