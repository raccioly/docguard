/**
 * v0.24 — section-heading matching is synonym- and number-tolerant
 * (field report #2, Issues 3 & 12).
 *
 * The bug: required canonical sections were matched by literal string, so an
 * arc42/C4 doc with "## 5.4 Layer boundaries" or "## Building Block View" was
 * scored as if the section were absent — the validator made well-structured
 * docs look WORSE than the skeleton, and only "alias" headings fixed it.
 *
 * docHasSection accepts the exact heading, a known synonym, or the same text
 * behind an arc42-style section number — while still rejecting docs that
 * genuinely lack the section (so it never becomes a rubber stamp).
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { docHasSection } from '../cli/shared.mjs';

describe('docHasSection — synonym + section-number tolerance', () => {
  it('matches the exact canonical heading', () => {
    assert.ok(docHasSection('# Doc\n## Component Map\nx', '## Component Map'));
  });

  it('matches an arc42-style numbered heading ("## 5.4 Layer boundaries")', () => {
    assert.ok(docHasSection('## 5.4 Layer boundaries\n| a | b |', '## Layer Boundaries'));
    assert.ok(docHasSection('### 3. System Context\nx', '## System Overview'));
  });

  it('matches known synonyms (C4 / arc42 vocabulary)', () => {
    assert.ok(docHasSection('## Building Block View\nx', '## Component Map'));
    assert.ok(docHasSection('## Technology Stack\nx', '## Tech Stack'));
    assert.ok(docHasSection('## Secrets\nx', '## Secrets Management'));
    assert.ok(docHasSection('## Getting Started\nx', '## Setup Steps'));
  });

  it('tolerates extra trailing words in the heading', () => {
    assert.ok(docHasSection('## Layer boundaries and rules\nx', '## Layer Boundaries'));
  });

  it('still reports genuinely missing sections (not a rubber stamp)', () => {
    assert.ok(!docHasSection('## Introduction\nsome text', '## Tech Stack'));
    assert.ok(!docHasSection('Just prose, no headings at all.', '## Component Map'));
  });

  it('only matches real headings, not prose mentioning the words', () => {
    // The phrase appears in body text but not as a heading → not a match.
    assert.ok(!docHasSection('See the component map below for details.', '## Component Map'));
  });

  it('ignores the document title (H1) and matches section level headings', () => {
    assert.ok(docHasSection('## Authentication\nJWT', '## Authentication'));
  });
});
