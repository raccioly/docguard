/**
 * The slot rule of cli/shared-requirement-ids.mjs: a template slot in a requirement's text makes it a
 * template row; the same characters inside an inline code span, or inside a span that wraps past the end of
 * the line, are code. `hasPlaceholderSlot` is the slot-only test (Traceability), `isPlaceholderRequirement`
 * adds the empty-text rule (Requirement-Anchors).
 *
 * @req docguard.strict-by-default#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasPlaceholderSlot, isPlaceholderRequirement } from '../cli/shared-requirement-ids.mjs';

const def = text => ({ id: 'FR-001', file: 'specs/001-x/spec.md', text: `- **FR-001**: ${text}` });

describe('shared requirement IDs: template slots', () => {
  it('square, angle and curly slots make a row a template row', () => {
    for (const text of ['System MUST [capability]', 'System MUST <capability>', 'System MUST {{behaviour}}']) {
      assert.equal(hasPlaceholderSlot(def(text)), true, text);
      assert.equal(isPlaceholderRequirement(def(text)), true, text);
    }
  });

  it('the same characters inside an inline code span are code, not a slot', () => {
    for (const text of ['The cut MUST move the `[Unreleased]` body', 'It MUST accept `--stage [slug]`', 'It MUST print `{ mode, asOf }`', 'It MUST list `pending: [...]`']) {
      assert.equal(hasPlaceholderSlot(def(text)), false, text);
      assert.equal(isPlaceholderRequirement(def(text)), false, text);
    }
  });

  it('a code span that wraps onto the next line is code to the end of the line', () => {
    assert.equal(hasPlaceholderSlot(def('`tool approve --id <id> [--delivery')), false);
  });

  it('a bare ID has no slot but is still an empty-text row for Requirement-Anchors', () => {
    const bare = { id: 'REQ-901', file: 'REQUIREMENTS.md', text: 'REQ-901' };
    assert.equal(hasPlaceholderSlot(bare), false);
    assert.equal(isPlaceholderRequirement(bare), true);
  });
});
