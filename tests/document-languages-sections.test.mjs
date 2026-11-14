/**
 * Documents in any language, Stage 0 (specs/104-document-languages): the
 * section marker parser. A `docguard:section` comment with no `id=` is not the
 * open marker of a bounded block, and `docguard:heading` is never a section.
 *
 * @req docguard.document-languages#FR-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertOwnedCodeSection, inspectSections } from '../cli/writers/sections.mjs';

const BLOCK = '<!-- docguard:section id=api source=code -->\n| a |\n<!-- /docguard:section -->';
const NA = '<!-- docguard:section authentication n/a — CLI, no auth layer -->';
const BARE = '<!-- docguard:section tech-stack -->';
const HEADING = '<!-- docguard:heading tech-stack -->';
const codes = doc => inspectSections(doc).issues.map(i => i.code);

describe('FR-002: a section marker without id= opens no bounded block', () => {
  for (const [name, marker] of [['an n/a marker', NA], ['a bare id marker', BARE], ['a section-id marker', '<!-- docguard:section-id tech-stack -->']]) {
    it(`${name} alone reports no issue and no section`, () => {
      const r = inspectSections(`# Doc\n\n${marker}\n\nText.\n`);
      assert.deepEqual(r.issues, []);
      assert.deepEqual(r.sections, []);
    });

    it(`${name} before a bounded block yields no nested-or-unclosed, and the block is writable`, () => {
      const doc = `# Doc\n\n${marker}\n\n${BLOCK}\n`;
      assert.deepEqual(codes(doc), []);
      assert.equal(inspectSections(doc).sections.length, 1);
      assert.equal(assertOwnedCodeSection(doc, 'api', 'DOC.md').id, 'api');
    });

    it(`${name} after a bounded block changes nothing`, () => {
      const doc = `# Doc\n\n${BLOCK}\n\n${marker}\n`;
      assert.deepEqual(codes(doc), []);
      assert.doesNotThrow(() => assertOwnedCodeSection(doc, 'api', 'DOC.md'));
    });
  }

  it('a docguard:heading marker is never a section marker', () => {
    const r = inspectSections(`# Doc\n\n## Pilha\n${HEADING}\n\n${BLOCK}\n`);
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.sections.map(s => s.id), ['api']);
  });
});

describe('FR-002: a bounded block with id= behaves as before', () => {
  it('a well-formed block parses with its id, source and body', () => {
    const r = inspectSections(`# Doc\n\n${BLOCK}\n`);
    assert.deepEqual(r.issues, []);
    assert.equal(r.sections[0].id, 'api');
    assert.equal(r.sections[0].source, 'code');
    assert.equal(r.sections[0].body, '| a |');
    assert.equal(assertOwnedCodeSection(`${BLOCK}\n`, 'api').id, 'api');
  });

  it('a real unclosed block is still reported as unclosed', () => {
    const doc = '<!-- docguard:section id=api source=code -->\n| a |\n';
    assert.deepEqual(codes(doc), ['unclosed']);
    assert.throws(() => assertOwnedCodeSection(doc, 'api', 'DOC.md'), /malformed or duplicate/);
  });

  it('an open whose close was deleted is still nested-or-unclosed when another block follows', () => {
    const doc = `<!-- docguard:section id=one source=code -->\ntext\n\n${BLOCK}\n`;
    assert.ok(codes(doc).includes('nested-or-unclosed'));
    assert.throws(() => assertOwnedCodeSection(doc, 'api', 'DOC.md'), /malformed or duplicate/);
  });

  it('a duplicate id and an unmatched close are still reported', () => {
    assert.ok(codes(`${BLOCK}\n${BLOCK}\n`).includes('duplicate-id'));
    assert.deepEqual(codes('<!-- /docguard:section -->\n'), ['unmatched-close']);
  });
});
