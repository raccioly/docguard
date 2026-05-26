/**
 * v0.14.1-S12+ — high-confidence anchor matches auto-fix via `fix --write`.
 *
 * @req SC-S12X-001 — Cross-Reference emits a replace-anchor fix for unambiguous matches
 * @req SC-S12X-002 — NO fix emitted when multiple anchors are equally close
 * @req SC-S12X-003 — NO fix emitted when the only candidate is far (distance > 2)
 * @req SC-S12X-004 — replace-anchor applier rewrites only the anchor inside link form
 * @req SC-S12X-005 — replace-anchor is idempotent (no double-apply)
 * @req SC-S12X-006 — applier won't touch raw-text occurrences of the slug
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateCrossReferences } from '../cli/validators/cross-reference.mjs';
import { applyMechanicalFix, MECHANICAL_FIX_TYPES } from '../cli/writers/mechanical.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-anchor-fix-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('replace-anchor is registered', () => {
  it('appears in MECHANICAL_FIX_TYPES', () => {
    assert.ok(MECHANICAL_FIX_TYPES.includes('replace-anchor'));
  });
});

describe('Cross-Reference emits replace-anchor for high-confidence matches', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('typo: single-char edit distance produces an auto-fix', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# A\n\nSee [setup](#authentication).\n\n## Authenticatio\nstub\n',
        // Heading "Authenticatio" slugifies to `authenticatio`. Link says `authentication` (1 char extra). Distance = 1.
    });
    const r = validateCrossReferences(dir, {});
    assert.ok(Array.isArray(r.fixes));
    const fix = r.fixes.find(f => f.type === 'replace-anchor');
    assert.ok(fix, `expected a replace-anchor fix; warnings: ${r.warnings.join(' | ')}`);
    assert.equal(fix.from, 'authentication');
    assert.equal(fix.to, 'authenticatio');
    // The warning should mark it as auto-fixable so the user sees the hint
    assert.ok(r.warnings[0].includes('[auto-fixable]'),
      'high-confidence warning should be tagged [auto-fixable]');
  });

  it('does NOT emit a fix when match distance > 2 (low confidence)', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# A\n\nSee [foo](#totally-different-name).\n\n## Setup\nstub\n',
    });
    const r = validateCrossReferences(dir, {});
    // Either no suggestion at all, or no high-confidence fix
    assert.ok(
      !r.fixes.some(f => f.type === 'replace-anchor'),
      'low-confidence match must NOT produce a fix'
    );
  });

  it('does NOT emit a fix when multiple anchors are equally close (ambiguous)', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# A\n\nSee [setup](#config).\n\n' +
        '## configg\nstub\n' +     // distance 1 from "config"
        '## configs\n' +            // also distance 1 from "config"
        'stub\n',
    });
    const r = validateCrossReferences(dir, {});
    assert.ok(
      !r.fixes.some(f => f.type === 'replace-anchor'),
      'ambiguous match (two close candidates) must NOT auto-fix'
    );
  });
});

describe('applyReplaceAnchor — mechanical', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('rewrites the anchor inside a markdown link', () => {
    dir = makeRepo({
      'docs-canonical/X.md':
        '# X\n\nSee [setup](#old-anchor).\n\n## new-anchor\nstub\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'replace-anchor',
      doc: 'docs-canonical/X.md',
      from: 'old-anchor',
      to: 'new-anchor',
    }, { recordHistory: false });
    assert.equal(r.applied, true);
    const result = readFileSync(resolve(dir, 'docs-canonical/X.md'), 'utf-8');
    assert.match(result, /\(#new-anchor\)/);
    assert.doesNotMatch(result, /\(#old-anchor\)/);
  });

  it('is idempotent: second apply is a no-op (skipped)', () => {
    dir = makeRepo({
      'docs-canonical/X.md':
        '# X\n\nSee [setup](#new-anchor).\n\n## new-anchor\nstub\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'replace-anchor',
      doc: 'docs-canonical/X.md',
      from: 'old-anchor',
      to: 'new-anchor',
    }, { recordHistory: false });
    // No #old-anchor in file → applier should report skipped
    assert.equal(r.applied, false);
    assert.match(r.skipped, /not found/);
  });

  it('does NOT touch plain-text occurrences of the slug', () => {
    dir = makeRepo({
      'docs-canonical/X.md':
        '# X\n\n' +
        'The slug `old-anchor` appears in prose here.\n' +
        'See [setup](#old-anchor).\n' +
        '## new-anchor\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'replace-anchor',
      doc: 'docs-canonical/X.md',
      from: 'old-anchor',
      to: 'new-anchor',
    }, { recordHistory: false });
    assert.equal(r.applied, true);
    const result = readFileSync(resolve(dir, 'docs-canonical/X.md'), 'utf-8');
    // The plain-text backticked `old-anchor` must STAY
    assert.match(result, /`old-anchor` appears in prose/);
    // The link anchor MUST be updated
    assert.match(result, /\(#new-anchor\)/);
  });
});
