/**
 * Regression: canonical docs in SUBFOLDERS must be seen by every consumer.
 *
 * Five call sites independently enumerated `docs-canonical/` with a flat
 * `readdirSync(...).filter(f => f.endsWith('.md'))`. A project that groups its
 * canonical docs (`docs-canonical/01-architecture/MODULE-MAP.md`) was invisible
 * to all of them, and every failure was silent and pointed the wrong way:
 *   - docs-sync flagged services as undocumented while the docs sat right there
 *     (unfixable DSY002 — editing the nested doc could never clear it),
 *   - `docguard:validator … n/a` markers in nested docs were dropped, so a
 *     declared-N/A validator ran anyway,
 *   - readability and ALCOA freshness scored an empty document set.
 *
 * The invariant these tests pin: for identical content, a NESTED layout and a
 * FLAT layout must produce the same answer.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { validateDocsSync } from '../cli/validators/docs-sync.mjs';
import { loadValidatorSuppressions } from '../cli/validator-markers.mjs';
import { extractSemanticClaims } from '../cli/scanners/semantic-claims.mjs';
import { assessAgentReadability } from '../cli/scanners/agent-readability.mjs';
import { computeAlcoaCompliance } from '../cli/commands/score.mjs';

let tmpDir;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-nested-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

/** Write a file, creating parent dirs. Path is project-relative POSIX. */
function put(rel, content) {
  const abs = join(tmpDir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe('listCanonicalDocs — recursive canonical enumeration', () => {
  it('finds docs in subfolders, not just the top level', () => {
    put('docs-canonical/ARCHITECTURE.md', '# Arch');
    put('docs-canonical/01-architecture/MODULE-MAP.md', '# Modules');
    put('docs-canonical/02-data/SCHEMA.md', '# Schema');

    const rels = listCanonicalDocs(tmpDir).map(d => d.rel);

    assert.deepEqual(rels, [
      'docs-canonical/01-architecture/MODULE-MAP.md',
      'docs-canonical/02-data/SCHEMA.md',
      'docs-canonical/ARCHITECTURE.md',
    ], 'sorted, project-relative POSIX paths');
  });

  it('is unchanged for a flat tree (backward compatibility)', () => {
    put('docs-canonical/ARCHITECTURE.md', '# Arch');
    put('docs-canonical/SECURITY.md', '# Sec');

    const rels = listCanonicalDocs(tmpDir).map(d => d.rel);

    assert.deepEqual(rels, ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/SECURITY.md']);
  });

  it('ignores non-markdown files at any depth', () => {
    put('docs-canonical/ARCHITECTURE.md', '# Arch');
    put('docs-canonical/01-architecture/diagram.png', 'not markdown');
    put('docs-canonical/01-architecture/notes.txt', 'not markdown');

    assert.deepEqual(listCanonicalDocs(tmpDir).map(d => d.rel), ['docs-canonical/ARCHITECTURE.md']);
  });

  it('applies the .docguardignore predicate to nested subtrees', () => {
    put('docs-canonical/ARCHITECTURE.md', '# Arch');
    put('docs-canonical/99-archive/OLD-AUDIT.md', '# Old');

    const isIgnored = (rel) => rel.startsWith('docs-canonical/99-archive/');
    const rels = listCanonicalDocs(tmpDir, { isIgnored }).map(d => d.rel);

    assert.deepEqual(rels, ['docs-canonical/ARCHITECTURE.md']);
  });

  it('skips dot-directories but keeps dot-markdown files', () => {
    put('docs-canonical/.hidden.md', '# Hidden but flat-visible before');
    put('docs-canonical/.git/config.md', 'should never be read');

    assert.deepEqual(listCanonicalDocs(tmpDir).map(d => d.rel), ['docs-canonical/.hidden.md']);
  });

  it('returns [] when docs-canonical/ is absent, and never throws', () => {
    assert.deepEqual(listCanonicalDocs(tmpDir), []);
  });
});

describe('nested canonical docs — consumer regressions', () => {
  it('docs-sync: a service documented only in a nested doc is not flagged', () => {
    // The MergerSync shape: a top-level doc EXISTS (so canonicalContent is
    // non-empty and there is no early return), but the module map is nested.
    put('docs-canonical/ARCHITECTURE.md', '# Architecture\n\nDetails in the module map.\n');
    put('docs-canonical/01-architecture/MODULE-MAP.md', '- src/services/billing.ts — billing\n');
    put('src/services/billing.ts', 'export const bill = () => {};');

    const result = validateDocsSync(tmpDir, {});

    assert.equal(result.total, 1);
    assert.equal(result.passed, 1, 'service is documented — must not be flagged');
    assert.deepEqual(result.warnings, []);
  });

  it('validator-markers: an n/a marker in a nested doc is honored', () => {
    put('docs-canonical/01-architecture/MODULE-MAP.md',
      '# Modules\n\n<!-- docguard:validator testSpec n/a — POC, no automated tests yet -->\n');

    const { suppressed } = loadValidatorSuppressions(tmpDir, ['testSpec', 'traceability']);

    assert.equal(suppressed.has('testSpec'), true);
    assert.equal(suppressed.get('testSpec'), 'POC, no automated tests yet');
  });

  it('semantic-claims: claims in a nested doc are extracted', () => {
    put('docs-canonical/01-architecture/MODULE-MAP.md',
      '# Modules\n\nThe billing job times out after 30 seconds.\n');

    const claims = extractSemanticClaims(tmpDir, {});

    assert.equal(claims.length, 1);
    assert.equal(claims[0].doc, 'docs-canonical/01-architecture/MODULE-MAP.md');
    assert.equal(claims[0].value, '30');
    assert.equal(claims[0].unit, 'seconds');
  });

  it('agent-readability: nested docs are scored, not treated as an empty set', () => {
    const body = '# Module Map\n\n## Billing\n\nThe billing service owns invoice state.\n';
    put('docs-canonical/01-architecture/MODULE-MAP.md', body);

    const nested = assessAgentReadability(tmpDir, {});

    // Same content, flat — the two layouts must agree.
    const flatDir = mkdtempSync(join(tmpdir(), 'docguard-nested-flat-'));
    try {
      mkdirSync(join(flatDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(flatDir, 'docs-canonical/MODULE-MAP.md'), body);
      const flat = assessAgentReadability(flatDir, {});
      assert.equal(nested.score, flat.score, 'nested layout must score like the flat one');
    } finally {
      rmSync(flatDir, { recursive: true, force: true });
    }
  });

  it('ALCOA freshness: a STALE nested doc is seen (was invisible, scored green)', () => {
    const abs = put('docs-canonical/01-architecture/MODULE-MAP.md', '# Modules\n');
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(abs, sixtyDaysAgo, sixtyDaysAgo);

    const { attributes } = computeAlcoaCompliance(tmpDir, {}, { docQuality: 80 });
    const contemporaneous = attributes.find(a => a.name === 'Contemporaneous');

    assert.equal(contemporaneous.met, false,
      'a 60-day-old nested doc must fail Contemporaneous — the flat read reported "all docs updated within 30 days" against an empty set');
  });

  it('ALCOA freshness: a fresh nested doc still passes', () => {
    put('docs-canonical/01-architecture/MODULE-MAP.md', '# Modules\n');

    const { attributes } = computeAlcoaCompliance(tmpDir, {}, { docQuality: 80 });

    assert.equal(attributes.find(a => a.name === 'Contemporaneous').met, true);
  });
});
