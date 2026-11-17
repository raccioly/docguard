/**
 * Spec 104: the outcomes that are measured once rather than unit-tested.
 *
 * FR-026 (the hermetic English A/B) and SC-007 (the full suite, guard and the
 * benchmark comparison) are results of a run, not behavior of code: they are
 * checked by their recorded result in the spec's Verification Notes, which
 * names the criterion each answers (the pattern of `program-verification`).
 *
 * @req docguard.document-languages#FR-026
 * @req docguard.document-languages#SC-007
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The spec's Verification Notes, which must answer each listed criterion. */
function recorded(dir, ids) {
  const spec = readFileSync(`specs/${dir}/spec.md`, 'utf8');
  const at = spec.indexOf('## Verification Notes');
  assert.ok(at >= 0, `${dir} has Verification Notes`);
  const end = spec.indexOf('\n## ', at + 5);
  const notes = spec.slice(at, end === -1 ? undefined : end);
  for (const id of ids) assert.match(notes, new RegExp(`\\b${id}\\b`), `${dir} records ${id}`);
  return notes;
}

describe('spec 104 verification notes', () => {
  it('records the English A/B (FR-026) and the gates (SC-007)', () => {
    const notes = recorded('104-document-languages', ['FR-026', 'SC-007']);
    assert.match(notes, /identical/);
    assert.match(notes, /benchmarks\/run\.mjs/);
  });
});
