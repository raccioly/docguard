/**
 * Spec 105, Stage 2: finding glossary terms in a document (`termMatcher`, `checkableLines`).
 *
 * A term is a whole word (Unicode letters, a hyphen between letters joins the word), a single word
 * also matches its plural, a phrase matches across spaces, and the case rule follows the term. The
 * parts of a document that are not prose (FR-009) are blanked with spaces of equal length before
 * any term is looked for, and a Use term masks the Avoid terms inside it (FR-010).
 *
 * @req docguard.glossary-and-plain-writing#FR-004
 * @req docguard.glossary-and-plain-writing#FR-009
 * @req docguard.glossary-and-plain-writing#FR-010
 * @req docguard.glossary-and-plain-writing#FR-028
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { checkableLines, parseGlossary, readDocument, termMatcher } from '../cli/shared-glossary.mjs';
import { labelContext } from '../cli/shared-labels.mjs';

const glossary = (...rows) => parseGlossary(['| Use | Avoid |', '|---|---|', ...rows].join('\n'));
const matcher = (...rows) => termMatcher(glossary(...rows));
/** The Avoid terms found in one line of prose. */
const found = (m, text, allow) => m.hits(text, allow).map(h => h.term);

describe('whole words (FR-004)', () => {
  const m = matcher('| configuration | config |');

  it('matches a term at the start, middle and end of a line, with punctuation around it', () => {
    for (const text of ['config', 'the config', 'config.', '(config)', 'a config, b', '*config*', '"config"']) assert.deepEqual(found(m, text), ['config'], text);
  });

  it('does not match inside a longer word', () => {
    for (const text of ['configuration', 'reconfig', 'configure', 'configurable', 'myconfig', 'config2', '2config']) assert.deepEqual(found(m, text), [], text);
  });

  it('matches accented words by Unicode letters, not by ASCII boundaries', () => {
    const pt = matcher('| repositório | repo |', '| ação | acao |');
    assert.deepEqual(found(pt, 'o repo novo'), ['repo']);
    assert.deepEqual(found(pt, 'a repositório é novo'), []);
    assert.deepEqual(found(matcher('| café | cafe |'), 'um cafe e um café'), ['cafe']);
    assert.deepEqual(found(matcher('| uso | us |'), 'maçã us'), ['us']);
    assert.deepEqual(found(matcher('| x | ação |'), 'ações e a ação'), ['ação']);
    assert.deepEqual(found(matcher('| x | cao |'), 'ação'), [], 'a letter before the term is part of the word');
  });

  it('does not match when a combining mark follows or precedes the term', () => {
    assert.deepEqual(found(matcher('| x | cafe |'), 'café'), []);
  });

  it('reads a hyphen between letters as part of the word, in both directions', () => {
    for (const text of ['config-file', 'file-config', 'e-config', 'config-2']) assert.deepEqual(found(m, text), [], text);
    for (const text of ['config - file', 'config -- file', 'config—file', '-config', 'config-', 'a- config']) assert.deepEqual(found(m, text), ['config'], text);
  });

  it('matches a hyphenated term as one word', () => {
    const e = matcher('| email | e-mail |');
    assert.deepEqual(found(e, 'send an e-mail'), ['e-mail']);
    assert.deepEqual(found(e, 'send an email'), []);
    assert.deepEqual(found(e, 'a re-e-mail'), []);
  });
});

describe('case (FR-004)', () => {
  it('matches a plain term in any case', () => {
    const m = matcher('| configuration | config |');
    for (const text of ['Config', 'CONFIG', 'cOnFiG']) assert.deepEqual(found(m, text), ['config'], text);
  });

  it('matches a term with a capital after its first character only in that case', () => {
    const m = matcher('| pull request | PR |', '| GitHub | github |');
    assert.deepEqual(found(m, 'open a PR'), ['PR']);
    assert.deepEqual(found(m, 'open a pr'), []);
    assert.deepEqual(found(m, 'open a Pr'), []);
  });

  it('treats a term whose only capital is its first letter as case-insensitive', () => {
    const m = matcher('| configuration | Config |');
    assert.deepEqual(found(m, 'the config file'), ['Config']);
  });

  it('keeps PR and pr as two terms with no conflict', () => {
    const g = glossary('| pull request | PR |', '| pr-title | pr |');
    assert.deepEqual(g.issues, []);
  });
});

describe('plurals and phrases (FR-004)', () => {
  it('matches the plural of a single word with s or es, and nothing else', () => {
    const m = matcher('| class | klass |', '| configuration | config |');
    assert.deepEqual(found(m, 'two configs'), ['config']);
    assert.deepEqual(found(m, 'many klasses and a klass'), ['klass']);
    assert.deepEqual(found(m, 'configing configed'), []);
    assert.deepEqual(found(m, 'configses'), []);
  });

  it('does not add a plural to a phrase', () => {
    const m = matcher('| code review | peer review |');
    assert.deepEqual(found(m, 'a peer review'), ['peer review']);
    assert.deepEqual(found(m, 'two peer reviews'), []);
  });

  it('matches a phrase across spaces and tabs on one line, not across lines', () => {
    const m = matcher('| code review | peer review |');
    assert.deepEqual(found(m, 'a peer   review'), ['peer review']);
    assert.deepEqual(found(m, 'a peer\treview'), ['peer review']);
    assert.deepEqual(found(m, 'a peer'), []);
    assert.deepEqual(found(m, 'review peer'), []);
  });

  it('treats characters with a meaning in a pattern as plain text', () => {
    const m = matcher('| plus | C++ |', '| dot | a.b |', '| paren | (x) |', '| alt | a|b |');
    assert.deepEqual(found(m, 'we write C++ here'), ['C++']);
    assert.deepEqual(found(m, 'axb'), []);
  });
});

describe('Use terms mask Avoid terms inside them (FR-010)', () => {
  it('does not report spec inside Spec Kit, and reports it elsewhere on the line', () => {
    const m = matcher('| Spec Kit | spec |');
    assert.deepEqual(found(m, 'Use Spec Kit'), []);
    assert.deepEqual(found(m, 'Use Spec Kit and write a spec'), ['spec']);
    assert.deepEqual(found(m, 'Use Spec   Kit'), []);
  });

  it('masks with a Use term of another row', () => {
    const m = matcher('| Spec Kit | | ', '| specification | spec |');
    assert.deepEqual(found(m, 'the Spec Kit and a spec'), ['spec']);
    assert.deepEqual(found(m, 'the Spec Kit'), []);
  });

  it('reports only the longer of two overlapping Avoid terms', () => {
    const m = matcher('| configuration file | config file, config |');
    assert.deepEqual(found(m, 'open the config file'), ['config file']);
    assert.deepEqual(found(m, 'open the config file and the config'), ['config file', 'config']);
  });

  it('masks an allowed term, so a shorter Avoid term inside it is not reported', () => {
    const m = matcher('| configuration file | config file, config |');
    assert.deepEqual(found(m, 'open the config file', new Set(['config file'])), []);
    assert.deepEqual(found(m, 'open the config', new Set(['config file'])), ['config']);
  });

  it('skips a conflicting term and a row with no Use term', () => {
    const m = termMatcher(parseGlossary('| Use | Avoid |\n|---|---|\n| spec | specification |\n| specification | spec |\n| | orphan |\n| one | uno |\n'));
    assert.deepEqual(found(m, 'spec specification orphan uno'), ['uno']);
  });

  it('allow lists are case-insensitive terms', () => {
    const m = matcher('| configuration | Config |');
    assert.deepEqual(found(m, 'the config', new Set(['config'])), []);
  });
});

describe('what is exempt (FR-009)', () => {
  const m = matcher('| configuration | config |');
  const hits = (text, ctx = null) => checkableLines(text, ctx).filter(l => found(m, l.text).length).map(l => l.line);

  it('keeps one entry per line, with each blanked span the length of the original', () => {
    const text = 'use `config` and "config" here, see config.json';
    const [entry] = checkableLines(text);
    assert.equal(entry.text.length, text.length);
    assert.equal(entry.raw, text);
    assert.equal(entry.text.trim().replace(/\s+/g, ' '), 'use and here, see');
  });

  it('skips fenced code with backticks and tildes, any fence length, and an unclosed fence', () => {
    assert.deepEqual(hits('```\nconfig\n```\nconfig'), [4]);
    assert.deepEqual(hits('~~~js\nconfig\n~~~\nconfig'), [4]);
    assert.deepEqual(hits('````\n```\nconfig\n```\nconfig\n````\nconfig'), [7]);
    assert.deepEqual(hits('config\n```\nconfig\nconfig'), [1]);
    assert.deepEqual(hits('~~~\n```\nconfig\n```\n~~~\nconfig'), [6]);
  });

  it('skips a fence that is indented inside a list item', () => {
    assert.deepEqual(hits('1. Run it:\n\n    ```sh\n    config\n    ```\n\n2. config'), [7]);
  });

  it('skips indented code after a blank line, but not a continuation line or a list paragraph', () => {
    assert.deepEqual(hits('Text\n\n    config\n    config\n\nconfig'), [6]);
    assert.deepEqual(hits('Text\n    config'), [2]);
    assert.deepEqual(hits('- item\n\n    config'), [3]);
    assert.deepEqual(hits('\tconfig\nconfig'), [2]);
  });

  it('skips YAML front matter on line 1 only', () => {
    assert.deepEqual(hits('---\ntitle: config\n---\nconfig'), [4]);
    assert.deepEqual(hits('config\n---\ntitle: config\n---\n'), [1, 3]);
    assert.deepEqual(hits('---\nconfig\nconfig'), [2, 3], 'an unclosed marker is a rule, not front matter');
  });

  it('skips HTML comments, single-line, inline and multi-line', () => {
    assert.deepEqual(hits('<!-- config -->\nconfig'), [2]);
    assert.deepEqual(hits('before <!-- config --> after config'), [1]);
    assert.deepEqual(hits('<!--\nconfig\nconfig\n-->\nconfig'), [5]);
    assert.deepEqual(hits('<!-- open\nconfig -->\nconfig'), [3]);
    assert.deepEqual(hits('a <!-- x\nconfig --> config'), [2]);
  });

  it('does not read a comment inside a code fence or inline code as a comment', () => {
    assert.deepEqual(hits('```\n<!--\n```\nconfig'), [4]);
    assert.deepEqual(hits('Write `<!--` for a comment, then config'), [1]);
  });

  it('skips inline code, with several backticks, and an unmatched backtick is plain text', () => {
    assert.deepEqual(hits('`config`'), []);
    assert.deepEqual(hits('``a ` config``'), []);
    assert.deepEqual(hits('a ` config'), [1]);
  });

  it('skips link destinations but reads the link text', () => {
    assert.deepEqual(hits('[docs](./config/x.md)'), []);
    assert.deepEqual(hits('[the config](./x.md)'), [1]);
    assert.deepEqual(hits('[x](https://example.com/Config_(old))'), []);
    assert.deepEqual(hits('![config](a.png)'), [1]);
    assert.deepEqual(hits('[x](#config)'), []);
  });

  it('skips autolinks, bare URLs and path-like tokens', () => {
    assert.deepEqual(hits('<https://example.com/config>'), []);
    assert.deepEqual(hits('<me@config.example>'), []);
    assert.deepEqual(hits('see https://config.example.com now'), []);
    assert.deepEqual(hits('see www.config.example'), []);
    assert.deepEqual(hits('open src/config and config/x'), []);
    assert.deepEqual(hits('open config.json'), []);
    assert.deepEqual(hits('Node.js config'), [1]);
  });

  it('skips double-quoted text, straight and curly, and leaves an unpaired quote alone', () => {
    assert.deepEqual(hits('say "config" now'), []);
    assert.deepEqual(hits('say “config” now'), []);
    assert.deepEqual(hits('"a" config "b"'), [1]);
    assert.deepEqual(hits('say "config'), [1]);
    assert.deepEqual(hits('say “config'), [1]);
    assert.deepEqual(hits('He said "use config.json" and then config'), [1]);
  });

  it('does not skip single-quoted text', () => {
    assert.deepEqual(hits("say 'config' now"), [1]);
  });

  it('skips blockquote lines, nested too', () => {
    assert.deepEqual(hits('> config\n>> config\n> > config\nconfig'), [4]);
  });

  it('checks a heading that DocGuard does not match, and skips one it does (English)', () => {
    assert.deepEqual(hits('## The config\n\n## Tech Stack\n\n### System Overview\n\n# Revision History'), [1]);
    const stack = termMatcher(glossary('| technology stack | stack |'));
    const stackHits = text => checkableLines(text).filter(l => found(stack, l.text).length).map(l => l.line);
    assert.deepEqual(stackHits('## Tech Stack\n\nThe stack.'), [3]);
  });

  it('skips a required heading in the document language (pt) and an alias of the project', () => {
    const camadas = termMatcher(glossary('| nível | camadas |'));
    const run = (text, config) => checkableLines(text, labelContext(config)).filter(l => found(camadas, l.text).length).map(l => l.line);
    assert.deepEqual(run('## Camadas\n\n## 5.4 Camadas\n\nAs camadas.', { docs: { language: 'pt-BR' } }), [5]);
    assert.deepEqual(run('## Camadas\n', undefined) , [1], 'without a language the heading is prose');
    assert.deepEqual(run('## Estratos\n\n## Camadas\n', { docs: { language: 'pt', labelAliases: { 'layer-boundaries': ['Camadas'] } } }), []);
  });

  it('skips a heading that carries a docguard:heading marker', () => {
    const camadas = termMatcher(glossary('| nível | camadas |'));
    const text = '## Minhas camadas\n<!-- docguard:heading layer-boundaries -->\n\n## Outras camadas\n';
    const lines = checkableLines(text).filter(l => found(camadas, l.text).length).map(l => l.line);
    assert.deepEqual(lines, [4]);
  });

  it('reads CRLF and a byte order mark like LF', () => {
    assert.deepEqual(hits('﻿config\r\n```\r\nconfig\r\n```\r\nconfig\r\n'), [1, 5]);
  });

  it('exposes the document markers, and ignores a marker written in code', () => {
    const off = readDocument('<!-- docguard:glossary off — generated text -->\nconfig');
    assert.equal(off.markers.off, true);
    const allow = readDocument('<!-- docguard:glossary allow Config, conf — the word means a file here -->\n');
    assert.deepEqual([...allow.markers.allow].sort(), ['conf', 'config']);
    assert.equal(readDocument('`<!-- docguard:glossary off -->`').markers.off, false);
    assert.equal(readDocument('```\n<!-- docguard:glossary off -->\n```').markers.off, false);
    assert.equal(readDocument('<!--\ndocguard:glossary off\n-->').markers.off, true);
  });
});

describe('the reader is bounded and deterministic (FR-028)', () => {
  it('answers the same twice and stays fast on hostile lines', () => {
    const m = matcher('| configuration | config, config file |');
    const inputs = [
      '`'.repeat(200000),
      Array.from({ length: 2000 }, (_, i) => '`'.repeat(i + 1)).join(' x '),
      '<!--'.repeat(50000),
      '[a](('.repeat(30000),
      '"'.repeat(100001),
      'config '.repeat(100000),
      '- '.repeat(100000) + 'config',
      `${'a'.repeat(200000)}://${'b'.repeat(100000)}`,
      `${'a.'.repeat(100000)}config`,
      Array.from({ length: 20000 }, () => '> ```').join('\n'),
    ];
    for (const input of inputs) {
      const start = Date.now();
      const first = JSON.stringify(checkableLines(input));
      assert.equal(first, JSON.stringify(checkableLines(input)));
      for (const l of checkableLines(input).slice(0, 50)) m.hits(l.text);
      assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`);
    }
  });

  it('never throws on odd input', () => {
    for (const input of ['', '\r', '\u0000', '---\n', '```', '<!--', '-->', '[](', '"', '“', 'a'.repeat(10)]) assert.doesNotThrow(() => checkableLines(input));
  });
});
