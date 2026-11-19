/**
 * Spec 105, Stage 2: the glossary table reader (`parseGlossary`).
 *
 * The first Markdown table with a Use and an Avoid column is the glossary (header words in
 * English, Portuguese or Spanish, any column order); a file without one is free-form and is not
 * malformed. GLS002 (a malformed row) and GLS003 (rows that contradict each other) carry the
 * glossary line, and a conflicting term is not checked.
 *
 * @req docguard.glossary-and-plain-writing#FR-002
 * @req docguard.glossary-and-plain-writing#FR-003
 * @req docguard.glossary-and-plain-writing#FR-005
 * @req docguard.glossary-and-plain-writing#FR-006
 * @req docguard.glossary-and-plain-writing#FR-007
 * @req docguard.glossary-and-plain-writing#FR-028
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseGlossary, termKey } from '../cli/shared-glossary.mjs';

const table = (...rows) => ['# Glossary', '', '| Use | Avoid | Meaning |', '|---|---|---|', ...rows, ''].join('\n');
const codes = parsed => parsed.issues.map(i => `${i.code}@${i.line}`);

describe('header aliases and column order (FR-002)', () => {
  it('reads English headers and the meaning column', () => {
    const g = parseGlossary(table('| configuration | config, conf | How the tool is set up |'));
    assert.equal(g.found, true);
    assert.deepEqual(g.rows, [{ line: 5, use: 'configuration', avoid: ['config', 'conf'], meaning: 'How the tool is set up' }]);
  });

  it('reads Portuguese headers with accents folded', () => {
    const g = parseGlossary('| Usar | Evitar | Definição |\n|---|---|---|\n| repositório | repo | A pasta do projeto |\n');
    assert.equal(g.found, true);
    assert.deepEqual(g.rows.map(r => [r.use, r.avoid, r.meaning]), [['repositório', ['repo'], 'A pasta do projeto']]);
  });

  it('reads Spanish headers', () => {
    const g = parseGlossary('| Usar | Evitar | Significado |\n|---|---|---|\n| configuración | config | x |\n');
    assert.deepEqual(g.rows.map(r => r.use), ['configuración']);
  });

  it('accepts Term for Use, Avoid terms for Avoid and Definition for Meaning', () => {
    const g = parseGlossary('| Term | Avoid terms | Definition |\n|---|---|---|\n| spec | specification | x |\n');
    assert.equal(g.rows[0].use, 'spec');
    assert.deepEqual(g.rows[0].avoid, ['specification']);
  });

  it('takes the columns in any order and ignores other columns', () => {
    const g = parseGlossary('| Owner | Avoid | Meaning | Use |\n|---|---|---|---|\n| me | config | settings | configuration |\n');
    assert.deepEqual(g.rows.map(r => [r.use, r.avoid, r.meaning]), [['configuration', ['config'], 'settings']]);
  });

  it('works without a Meaning column', () => {
    const g = parseGlossary('| Use | Avoid |\n|---|---|\n| configuration | config |\n');
    assert.equal(g.rows[0].meaning, '');
  });

  it('skips a table without both columns and reads the next one', () => {
    const g = parseGlossary('| Name | Role |\n|---|---|\n| a | b |\n\n| Use | Avoid |\n|---|---|\n| one | uno |\n');
    assert.equal(g.found, true);
    assert.deepEqual(g.rows.map(r => r.use), ['one']);
  });

  it('reads only the first glossary table', () => {
    const g = parseGlossary('| Use | Avoid |\n|---|---|\n| one | uno |\n\n| Use | Avoid |\n|---|---|\n| two | dos |\n');
    assert.deepEqual(g.rows.map(r => r.use), ['one']);
  });
});

describe('cells (FR-003)', () => {
  it('splits Avoid on commas and semicolons and trims', () => {
    assert.deepEqual(parseGlossary(table('| configuration | config ; conf,  cfg |')).rows[0].avoid, ['config', 'conf', 'cfg']);
  });

  it('reads an empty cell, a hyphen, an en dash and an em dash as no Avoid term', () => {
    for (const none of ['', ' ', '-', '–', '—']) {
      const g = parseGlossary(table(`| one | ${none} |`));
      assert.deepEqual(g.rows[0].avoid, [], JSON.stringify(none));
      assert.deepEqual(g.issues, []);
    }
  });

  it('removes backticks and Markdown emphasis around a term', () => {
    const g = parseGlossary(table('| **`Spec Kit`** | `spec`, *specs*, _spec-kit_ |'));
    assert.equal(g.rows[0].use, 'Spec Kit');
    assert.deepEqual(g.rows[0].avoid, ['spec', 'specs', 'spec-kit']);
  });

  it('keeps underscores inside a code identifier', () => {
    assert.equal(parseGlossary(table('| `snake_case` | camel |')).rows[0].use, 'snake_case');
  });

  it('collapses spaces inside a phrase and normalizes to NFC', () => {
    const g = parseGlossary(table(`| pull   request | pr, caf${'e'}́ |`));
    assert.equal(g.rows[0].use, 'pull request');
    assert.equal(g.rows[0].avoid[1], 'café');
  });

  it('unescapes a pipe in a cell', () => {
    assert.equal(parseGlossary(table('| a\\|b | c |')).rows[0].use, 'a|b');
  });

  it('works with CRLF line endings, a byte order mark and a table without outer pipes', () => {
    const g = parseGlossary('﻿| Use | Avoid |\r\n|---|---|\r\n| one | uno |\r\n');
    assert.deepEqual(g.rows.map(r => [r.use, r.avoid]), [['one', ['uno']]]);
    const bare = parseGlossary('Use | Avoid\n--- | ---\none | uno\n');
    assert.deepEqual(bare.rows.map(r => r.use), ['one']);
  });
});

describe('what is not a table (FR-002, FR-007)', () => {
  it('ignores a table inside a fenced block (backticks and tildes)', () => {
    for (const fence of ['```', '~~~']) {
      const g = parseGlossary(`${fence}\n| Use | Avoid |\n|---|---|\n| one | uno |\n${fence}\n`);
      assert.equal(g.found, false, fence);
    }
  });

  it('ignores a table inside an HTML comment, single-line cells and multi-line', () => {
    const g = parseGlossary('<!--\n| Use | Avoid |\n|---|---|\n| one | uno |\n-->\n');
    assert.equal(g.found, false);
    const mixed = parseGlossary('<!-- proposals\n| Use | Avoid |\n|---|---|\n| x | y |\n-->\n\n| Use | Avoid |\n|---|---|\n| real | fake |\n');
    assert.deepEqual(mixed.rows.map(r => r.use), ['real']);
  });

  it('keeps reading the table past a row that is hidden in a comment', () => {
    const g = parseGlossary('| Use | Avoid |\n|---|---|\n| one | uno |\n<!-- | two | dos | -->\n| three | tres |\n');
    assert.deepEqual(g.rows.map(r => r.use), ['one', 'three']);
  });

  it('reads a free-form glossary as found: false with no issue', () => {
    const g = parseGlossary('# Glossary\n\n## Config\n\nThe settings file.\n\n## Spec\n\nA specification.\n');
    assert.deepEqual({ found: g.found, rows: g.rows, issues: g.issues }, { found: false, rows: [], issues: [] });
  });

  it('reads the starter (header, no row) as a glossary with no rows', () => {
    const g = parseGlossary('# Glossary\n\n| Use | Avoid | Meaning |\n|---|---|---|\n\n<!-- docguard:glossary-proposals\n| spec | specification | x |\n-->\n');
    assert.equal(g.found, true);
    assert.deepEqual(g.rows, []);
  });

  it('never throws on empty or non-string input', () => {
    for (const input of ['', '\n', '|', '| |\n|-|\n', undefined, null, 42]) assert.doesNotThrow(() => parseGlossary(input));
  });
});

describe('GLS002: a malformed row (FR-005)', () => {
  it('reports an Avoid cell with an empty Use cell, at its line', () => {
    const g = parseGlossary(table('| ok | fine |', '|  | config |'));
    assert.deepEqual(codes(g), ['GLS002@6']);
    assert.match(g.issues[0].message, /Use cell is empty/);
  });

  it('reports the second row of a repeated Use term', () => {
    const g = parseGlossary(table('| configuration | config |', '| Configuration | conf |'));
    assert.deepEqual(codes(g), ['GLS002@6']);
  });

  it('reports an Avoid term listed twice, in one cell and in two rows with the same Use term', () => {
    assert.deepEqual(codes(parseGlossary(table('| one | uno, uno |'))), ['GLS002@5']);
    assert.deepEqual(codes(parseGlossary(table('| one | uno |', '| one | uno |'))), ['GLS002@6']);
  });

  it('does not report a blank row or a Use-only row', () => {
    assert.deepEqual(parseGlossary(table('| | |', '| Spec Kit | |')).issues, []);
  });

  it('reads 500 rows, reports the rest once, and does not read them', () => {
    const rows = Array.from({ length: 700 }, (_, i) => `| term${i} | old${i} |`);
    const g = parseGlossary(table(...rows));
    assert.equal(g.rows.length, 500);
    assert.deepEqual(codes(g), ['GLS002@505']);
    assert.match(g.issues[0].message, /more than 500 rows/);
  });
});

describe('GLS003: rows that contradict each other (FR-006)', () => {
  it('reports both lines when a term is Use in one row and Avoid in another, and marks both terms', () => {
    const g = parseGlossary(table('| spec | specification |', '| specification | spec |'));
    assert.deepEqual(codes(g), ['GLS003@5', 'GLS003@6']);
    assert.deepEqual([...g.conflicted].sort(), ['spec', 'specification']);
  });

  it('reports an Avoid term under two different Use terms', () => {
    const g = parseGlossary(table('| configuration | config |', '| settings | config |'));
    assert.deepEqual(codes(g), ['GLS003@5', 'GLS003@6']);
    assert.deepEqual([...g.conflicted], ['config']);
  });

  it('reports a term that is both Use and Avoid in its own row', () => {
    const g = parseGlossary(table('| one | one, uno |'));
    assert.deepEqual(codes(g), ['GLS003@5']);
    assert.deepEqual([...g.conflicted], ['one']);
  });

  it('names the other lines in the message', () => {
    const g = parseGlossary(table('| spec | specification |', '| specification | spec |'));
    assert.match(g.issues[0].message, /lines 5, 6/);
  });
});

describe('termKey (FR-004)', () => {
  it('lowercases a plain term and keeps the case of a term with a later capital', () => {
    assert.equal(termKey('Config'), 'config');
    assert.equal(termKey('PR'), 'PR');
    assert.equal(termKey('GitHub'), 'GitHub');
    assert.equal(termKey(' Spec   kit '), 'spec kit');
  });
});

describe('the parser is bounded and deterministic (FR-028)', () => {
  it('answers the same twice and stays fast on adversarial tables', () => {
    const inputs = [
      `| Use | Avoid |\n|---|---|\n${'| a | b, '.repeat(20000)}\n`,
      `| Use | Avoid |\n|---|---|\n${'|'.repeat(200000)}\n`,
      `${'<!--'.repeat(50000)}\n| Use | Avoid |\n|---|---|\n`,
      `${'`'.repeat(100000)}\n`,
      `| Use | Avoid |\n|---|---|\n| ${'a'.repeat(300000)} | ${'`'.repeat(1000)}b |\n`,
    ];
    for (const input of inputs) {
      const start = Date.now();
      const a = JSON.stringify(parseGlossary(input), (k, v) => (v instanceof Set ? [...v] : v));
      const b = JSON.stringify(parseGlossary(input), (k, v) => (v instanceof Set ? [...v] : v));
      assert.equal(a, b);
      assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
    }
  });
});
