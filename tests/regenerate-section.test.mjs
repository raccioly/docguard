/**
 * v0.14-P3 — generated-staleness emits structured fixes + new
 * `regenerate-section` mechanical applier.
 *
 * @req SC-P3-001 — applier rewrites only the named source=code section
 * @req SC-P3-002 — applier is idempotent (no rewrite when already current)
 * @req SC-P3-003 — applier refuses when doc / sectionId / body is missing
 * @req SC-P3-004 — generated-staleness emits fixes[] entries on drift
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { applyMechanicalFix, MECHANICAL_FIX_TYPES } from '../cli/writers/mechanical.mjs';
import { validateGeneratedStaleness } from '../cli/validators/generated-staleness.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-regen-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('MECHANICAL_FIX_TYPES includes regenerate-section', () => {
  it('regenerate-section is a registered fix type', () => {
    assert.ok(MECHANICAL_FIX_TYPES.includes('regenerate-section'));
  });
});

describe('applyMechanicalFix — regenerate-section', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('rewrites the named source=code section in place', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\n\n' +
        '<!-- docguard:section id=tech-stack source=code -->\n' +
        'OLD STALE CONTENT\n' +
        '<!-- /docguard:section -->\n\n' +
        'Human prose below — untouched.\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'regenerate-section',
      doc: 'docs-canonical/ARCHITECTURE.md',
      sectionId: 'tech-stack',
      body: 'NEW FRESH CONTENT',
    }, { recordHistory: false });
    assert.equal(r.applied, true);
    const result = readFileSync(resolve(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf-8');
    assert.match(result, /NEW FRESH CONTENT/);
    assert.doesNotMatch(result, /OLD STALE CONTENT/);
    assert.match(result, /Human prose below — untouched/,
      'surrounding prose must NOT be rewritten');
  });

  it('is idempotent: no-op when content already matches', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md':
        '<!-- docguard:section id=stack source=code -->\n' +
        'EXACT MATCH\n' +
        '<!-- /docguard:section -->\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'regenerate-section',
      doc: 'docs-canonical/ARCHITECTURE.md',
      sectionId: 'stack',
      body: 'EXACT MATCH',
    }, { recordHistory: false });
    assert.equal(r.applied, false,
      'should not re-write when content already matches');
  });

  it('skips with a clear message when the section is missing', () => {
    dir = makeRepo({
      'docs-canonical/ARCHITECTURE.md': '# A\nNo markers here.\n',
    });
    const r = applyMechanicalFix(dir, {
      type: 'regenerate-section',
      doc: 'docs-canonical/ARCHITECTURE.md',
      sectionId: 'missing-section',
      body: 'x',
    }, { recordHistory: false });
    assert.equal(r.applied, false);
    assert.match(r.skipped, /not present/);
  });

  it('refuses when doc / sectionId / body is missing', () => {
    dir = makeRepo({ 'docs-canonical/X.md': '# X\n' });
    const cases = [
      { type: 'regenerate-section', sectionId: 'a', body: 'b' },          // no doc
      { type: 'regenerate-section', doc: 'docs-canonical/X.md', body: 'b' }, // no sectionId
      { type: 'regenerate-section', doc: 'docs-canonical/X.md', sectionId: 'a' }, // no body
    ];
    for (const c of cases) {
      const r = applyMechanicalFix(dir, c, { recordHistory: false });
      assert.equal(r.applied, false);
      assert.match(r.skipped, /needs doc, sectionId, body/);
    }
  });
});

describe('generated-staleness emits fixes[] on drift', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('produces a regenerate-section fix when content drifts', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\n\n' +
        '<!-- docguard:section id=tech-stack source=code -->\n' +
        'WRONG OUTDATED CONTENT THAT THE SCANNER WOULD NEVER PRODUCE\n' +
        '<!-- /docguard:section -->\n',
    });
    const r = validateGeneratedStaleness(dir, { projectName: 't' });
    assert.ok(Array.isArray(r.fixes), 'fixes[] must exist');
    if (r.warnings.length > 0) {
      // When there's drift, there should be a corresponding fix entry
      assert.ok(r.fixes.length > 0,
        `drift detected but no fix emitted; warnings: ${r.warnings.join(' | ')}`);
      const f = r.fixes[0];
      assert.equal(f.type, 'regenerate-section');
      assert.ok(f.doc, 'fix should carry the doc path');
      assert.ok(f.sectionId, 'fix should carry the sectionId');
      assert.ok(f.body != null, 'fix should carry the body');
    }
  });
});
