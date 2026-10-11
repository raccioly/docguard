/**
 * Requirement blocks (specs/070-requirement-anchors FR-014): a requirement's
 * fingerprint must cover every line of it, not the first line only, while
 * `text` (read by the TF-IDF test hint and preflight overlap detection) keeps
 * its first-line meaning.
 *
 * @req docguard.requirement-anchors#FR-014
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { collectRequirementIdsFromContent } from '../cli/shared-requirements.mjs';
import { projectSpecRegistry } from '../cli/scanners/spec-registry.mjs';

const SPEC = `# Feature

## Requirements

- **FR-001**: The system MUST do one thing.
  - with a nested detail;
  - and another one.

  A continuation paragraph inside the item.
- **FR-002**: A one-line requirement.

### FR-003: A heading requirement

Its body paragraph.

| ID | Requirement |
|----|-------------|
| SC-001 | A table row |
| SC-002 | Another row |

FR-004: a plain-paragraph requirement
that wraps onto a second line.

Unrelated paragraph.
`;

const get = id => collectRequirementIdsFromContent(SPEC, 'spec.md').get(`spec.md#${id}`);

describe('requirement block (FR-014)', () => {
  it('a list item runs through its nested bullets and indented continuation', () => {
    assert.equal(get('FR-001').text, '- **FR-001**: The system MUST do one thing.');
    assert.equal(get('FR-001').block, [
      '- **FR-001**: The system MUST do one thing.',
      '  - with a nested detail;',
      '  - and another one.',
      '',
      '  A continuation paragraph inside the item.',
    ].join('\n'));
  });

  it('the next requirement ends the block', () => {
    assert.equal(get('FR-002').block, '- **FR-002**: A one-line requirement.');
  });

  it('a heading requirement runs until the next heading or declaration', () => {
    assert.equal(get('FR-003').block, '### FR-003: A heading requirement\n\nIts body paragraph.\n\n| ID | Requirement |\n|----|-------------|');
  });

  it('a table row is its own block', () => {
    assert.equal(get('SC-001').block, '| SC-001 | A table row |');
    assert.equal(get('SC-002').block, '| SC-002 | Another row |');
  });

  it('a plain paragraph runs to the blank line', () => {
    assert.equal(get('FR-004').block, 'FR-004: a plain-paragraph requirement\nthat wraps onto a second line.');
  });

  it('the spec registry projection never carries the block', () => {
    const { registry } = projectSpecRegistry(resolve('.'));
    const serialized = JSON.stringify(registry);
    assert.equal(serialized.includes('"block"'), false);
    for (const spec of registry.specs) {
      for (const requirement of spec.intent.requirements) assert.equal(typeof requirement, 'string');
    }
  });
});
