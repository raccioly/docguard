import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  parseSections,
  getSection,
  listSections,
  renderSection,
  replaceSection,
  upsertSection,
} from '../cli/writers/sections.mjs';

const DOC = [
  '# Data Model',
  '',
  'This entity model is **hand-written rationale** that must survive regeneration.',
  '',
  '<!-- docguard:section id=entities source=code -->',
  '| Entity | Fields |',
  '|--------|--------|',
  '| User | id, email |',
  '<!-- /docguard:section -->',
  '',
  '## Why we model it this way',
  'More precious human prose.',
  '',
  '<!-- docguard:section id=indexes source=code -->',
  '- gsi1: byEmail',
  '<!-- /docguard:section -->',
  '',
].join('\n');

describe('sections: parse / get / list', () => {
  it('parses all sections with id, source, and body', () => {
    const secs = parseSections(DOC);
    assert.equal(secs.length, 2);
    assert.equal(secs[0].id, 'entities');
    assert.equal(secs[0].source, 'code');
    assert.ok(secs[0].body.includes('| User | id, email |'));
    assert.deepEqual(listSections(DOC), ['entities', 'indexes']);
  });

  it('getSection returns one section or null', () => {
    assert.ok(getSection(DOC, 'entities'));
    assert.equal(getSection(DOC, 'nope'), null);
  });

  it('ignores a malformed open marker without a close (no corruption)', () => {
    const bad = '# T\n<!-- docguard:section id=x source=code -->\nbody never closed\n';
    assert.deepEqual(parseSections(bad), []);
  });
});

describe('sections: replaceSection preserves human prose', () => {
  it('replaces only the section body, leaving everything else byte-for-byte', () => {
    const { content, replaced } = replaceSection(DOC, 'entities', '| Entity | Fields |\n|--------|--------|\n| User | id, email, name |');
    assert.equal(replaced, true);
    assert.ok(content.includes('| User | id, email, name |'), 'new body present');
    assert.ok(content.includes('hand-written rationale'), 'prose before section kept');
    assert.ok(content.includes('Why we model it this way'), 'prose after section kept');
    assert.ok(content.includes('byEmail'), 'other section kept');
    // markers still intact
    assert.equal(parseSections(content).length, 2);
  });

  it('is idempotent — replacing with identical body changes nothing', () => {
    const body = '| Entity | Fields |\n|--------|--------|\n| User | id, email |';
    const r = replaceSection(DOC, 'entities', body);
    assert.equal(r.replaced, false);
    assert.equal(r.content, DOC);
  });

  it('returns unchanged when the section id does not exist', () => {
    const r = replaceSection(DOC, 'ghost', 'x');
    assert.equal(r.replaced, false);
    assert.equal(r.content, DOC);
  });
});

describe('sections: upsertSection', () => {
  it('replaces when the section exists', () => {
    const { content, action } = upsertSection(DOC, 'indexes', '- gsi1: byEmail\n- gsi2: byStatus');
    assert.equal(action, 'replaced');
    assert.ok(content.includes('byStatus'));
    assert.equal(parseSections(content).length, 2);
  });

  it('inserts a new section at end by default', () => {
    const { content, action } = upsertSection(DOC, 'env-vars', 'FOO=bar', { source: 'code' });
    assert.equal(action, 'inserted');
    assert.deepEqual(listSections(content), ['entities', 'indexes', 'env-vars']);
    assert.ok(getSection(content, 'env-vars').body.includes('FOO=bar'));
  });

  it('inserts after a named section with position=after:<id>', () => {
    const { content } = upsertSection(DOC, 'relationships', 'User -> Order', { position: 'after:entities' });
    assert.deepEqual(listSections(content), ['entities', 'relationships', 'indexes']);
  });

  it('inserts after the first heading with position=top', () => {
    const { content } = upsertSection(DOC, 'summary', 'Overview text', { position: 'top' });
    assert.equal(listSections(content)[0], 'summary');
    // H1 still first line
    assert.ok(content.startsWith('# Data Model'));
  });
});

describe('sections: renderSection', () => {
  it('produces a well-formed, re-parseable block', () => {
    const block = renderSection('foo', 'hello', { source: 'code' });
    const secs = parseSections(block);
    assert.equal(secs.length, 1);
    assert.equal(secs[0].id, 'foo');
    assert.equal(secs[0].body, 'hello');
  });
});
