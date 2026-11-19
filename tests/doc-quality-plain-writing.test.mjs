/**
 * Spec 105, Stage 4: plain writing. The line-aware sentence reader, DQ009 (a
 * sentence over the word limit) and DQ010 (a numbered step that does not start
 * with a verb), and the proof that DQ001 to DQ008 did not move.
 *
 * @req docguard.glossary-and-plain-writing#FR-020
 * @req docguard.glossary-and-plain-writing#FR-021
 * @req docguard.glossary-and-plain-writing#FR-022
 * @req docguard.glossary-and-plain-writing#FR-023
 * @req docguard.glossary-and-plain-writing#FR-024
 * @req docguard.glossary-and-plain-writing#FR-025
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocQuality } from '../cli/validators/doc-quality.mjs';
import { proseSentences, numberedSteps } from '../cli/shared-sentences.mjs';

/** A project with one README.md; `.docguard.json` pins the standard level and carries any extra keys. */
function project(readme, extra = {}) {
  const dir = makeTempDir('docguard-plain-writing-');
  const files = { 'README.md': readme, '.docguard.json': JSON.stringify({ enforcement: 'standard', ...extra }) };
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const run = (readme, extra) => { const dir = project(readme, extra); return validateDocQuality(dir, loadConfig(dir)); };
const byCode = (r, code) => (r.findings || []).filter(f => f.code === code);

/** Six short English sentences: enough prose to be scored, none near a limit, no numbered list. */
const PROSE = [
  'The loader reads the configuration file and writes the result to the disk.',
  'The operator reviews the report that the pipeline generates every day.',
  'The team keeps the logs in a directory that is separate from the code.',
  'Each module has an owner and a reviewer who were named at the start.',
  'The data passes through a validation step before the final write.',
  'The final report lists the files that were read and the files that were written.',
].join('\n');
/** One sentence of n words, each made of letters only. */
const sentence = n => `${Array.from({ length: n }, (_, i) => `ww${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}`).join(' ')}.`;

describe('T011: proseSentences reads by line', () => {
  it('reports a sentence at its first line, and a sentence that spans lines once', () => {
    const r = proseSentences('First part of one sentence\ncontinues on the second line. Then a new one starts\nand ends here.\n');
    assert.deepEqual(r, [{ line: 1, words: 10, step: false }, { line: 2, words: 8, step: false }]);
  });

  it('counts a paragraph after a blank line from its own line number', () => {
    const r = proseSentences('One two three.\n\n\nFour five six seven.\n');
    assert.deepEqual(r.map(s => [s.line, s.words]), [[1, 3], [4, 4]]);
  });

  it('ends a paragraph at a heading, a list item and a table, and reads each list item as its own sentence', () => {
    const r = proseSentences('Intro words here\n# Heading words\nAfter heading text\n- item one\n- item two is longer\n| a | b |\n|---|---|\nTail words\n');
    assert.deepEqual(r.map(s => [s.line, s.words]), [[1, 3], [3, 3], [4, 2], [5, 4], [8, 2]]);
  });

  it('does not end a sentence at a dotted file name, a version, a URL, an abbreviation, e.g., Node.js or a decimal', () => {
    const text = 'Edit package.json and .env.local with Node.js 18 at v1.2.3 or 3.14 per https://example.com/a.b, e.g. now, vs. later, Dr. Who, etc. and done.\n';
    assert.deepEqual(proseSentences(text).map(s => s.words), [22]);
  });

  it('ends a sentence at ! and ?, and at a dotted file name that closes it', () => {
    const r = proseSentences('Is it ready? Yes it is! Open the file package.json. Done now.\n');
    assert.deepEqual(r.map(s => s.words), [3, 3, 4, 2]);
  });

  it('counts an inline code span as one word, a link as its text, and an image as nothing', () => {
    assert.equal(proseSentences('Run `npm run build --if-present` now.\n')[0].words, 3);
    assert.equal(proseSentences('Run ``a ` b`` now.\n')[0].words, 3);
    assert.equal(proseSentences('See [the full guide](https://example.com/very/long/path.md) today.\n')[0].words, 5);
    assert.equal(proseSentences('Look ![a diagram of it](img.png) here.\n')[0].words, 2);
    assert.equal(proseSentences('Dashes - and ** stars do not count as words.\n')[0].words, 8);
  });

  it('skips fenced code (``` and ~~~), indented code, tables, headings, comments, front matter, images and HTML lines', () => {
    const text = [
      '---', 'title: front matter words here', '---',
      '# A heading with many words in it',
      '```js', 'const code = here. more. words', '```',
      '~~~', 'tilde fence words. more', '~~~',
      '<!-- one comment', 'across lines. with words -->',
      '<!-- single comment line words -->',
      '![image line words](x.png)',
      '<div class="x">html line words</div>',
      '| table | row | words |', '|---|---|---|',
      '',
      '    indented code words. here',
      '',
      'Only this line is prose.',
    ].join('\n');
    assert.deepEqual(proseSentences(text), [{ line: 21, words: 5, step: false }]);
  });

  it('does not swallow the document when front matter is never closed', () => {
    assert.deepEqual(proseSentences('---\nStill prose here.\n').map(s => s.line), [2]);
  });

  it('marks the sentences of a numbered step (two or more items), not a lone ordered item or a bullet', () => {
    const r = proseSentences('1. Run the first command.\n2. Run the second command now.\n\nText after the list ends here.\n\n- bullet one here\n- bullet two here\n\n1. Alone in its list\n');
    assert.deepEqual(r.map(s => [s.line, s.step]), [[1, true], [2, true], [4, false], [6, false], [7, false], [9, false]]);
  });

  it('keeps an indented paragraph and a nested bullet inside the step they belong to', () => {
    const r = proseSentences('1. Open the file.\n\n   Then read it with care.\n   - note one here\n2. Close the file.\n\nPlain text here.\n');
    assert.deepEqual(r.map(s => s.step), [true, true, true, true, false]);
  });

  it('reads the full-width and Arabic marks as sentence ends only with unicode', () => {
    assert.equal(proseSentences('第一句。第二句 words').length, 1);
    assert.equal(proseSentences('第一句。第二句 words', { unicode: true }).length, 2);
    assert.equal(proseSentences('هذا نص؟ وهذا آخر', { unicode: true }).length, 2);
  });

  it('is total and steady: no throw, the same answer twice, linear time on adversarial input', () => {
    const inputs = [
      '', '\n\n', '```', '<!--', '|', '`'.repeat(50000), '['.repeat(50000), '[a](b'.repeat(10000), '![x](y)'.repeat(8000),
      'a.'.repeat(40000), '.'.repeat(100000), `${'a'.repeat(200000)}`, ' '.repeat(100000), '1. '.repeat(30000),
      '- '.repeat(30000), '<!-- '.repeat(20000), '> '.repeat(50000), `${'-'.repeat(100000)} x`, '\u0000￿'.repeat(1000),
      null, undefined,
    ];
    for (const input of inputs) {
      const start = Date.now();
      const a = JSON.stringify([proseSentences(input), proseSentences(input, { unicode: true }), numberedSteps(input)]);
      const b = JSON.stringify([proseSentences(input), proseSentences(input, { unicode: true }), numberedSteps(input)]);
      assert.equal(a, b);
      assert.ok(Date.now() - start < 3000, `bounded time for an input of ${String(input).length} characters`);
    }
  });
});

describe('T012: numberedSteps', () => {
  it('lists the items of an ordered list of two or more, in the 1. and 1) forms', () => {
    assert.deepEqual(numberedSteps('1. Run it\n2. Open it\n3. Close it\n'), [
      { line: 1, firstWord: 'Run' }, { line: 2, firstWord: 'Open' }, { line: 3, firstWord: 'Close' },
    ]);
    assert.deepEqual(numberedSteps('1) Run it\n2) Open it\n').map(s => s.firstWord), ['Run', 'Open']);
  });

  it('gives nothing for a lone ordered item, and keeps two lists apart', () => {
    assert.deepEqual(numberedSteps('1. Only one\n'), []);
    assert.deepEqual(numberedSteps('1. One\n\nA paragraph that ends the list.\n\n1. Another list\n'), []);
    assert.equal(numberedSteps('1. One\n2. Two\n\nA paragraph that ends the list.\n\n1. Alone\n').length, 2);
  });

  it('keeps a list going over a blank line, an indented paragraph and a fenced block', () => {
    const text = '1. First\n\n   More about the first.\n\n```sh\nnpm test\n```\n\n2. Second\n';
    assert.deepEqual(numberedSteps(text).map(s => s.line), [1, 9]);
  });

  it('ends a list at a heading', () => {
    assert.deepEqual(numberedSteps('1. One\n# Heading\n2. Two\n'), []);
  });

  it('reads past emphasis and a "Step N:" label to the first word', () => {
    const text = '1. **Run** the tests\n2. Step 2: Open it\n3. **Step 3:** Close it\n4. _Check_ it\n5. step 5 - Save it\n';
    assert.deepEqual(numberedSteps(text).map(s => s.firstWord), ['Run', 'Open', 'Close', 'Check', 'Save']);
  });

  it('gives null when the step starts with inline code, a link, a digit or a symbol', () => {
    const text = '1. `npm test` runs it\n2. [The guide](x.md) says\n3. 42 is the number\n4. **`code`** first\n5. - dash\n6. Run it\n';
    assert.deepEqual(numberedSteps(text).map(s => s.firstWord), [null, null, null, null, null, 'Run']);
  });

  it('skips an ordered list inside a fenced block', () => {
    assert.deepEqual(numberedSteps('```\n1. One\n2. Two\n```\n'), []);
  });
});

describe('T011: DQ009, a sentence over the word limit', () => {
  it('passes a document with short sentences and counts one check', () => {
    const r = run(`# T\n\n${PROSE}\n`);
    assert.deepEqual(byCode(r, 'DQ009'), []);
    assert.equal(r.total, 9, 'eight metrics and DQ009');
    assert.equal(r.passed, r.total - r.findings.length);
  });

  it('reports one finding per document with the count, the first line, and line-and-words pairs', () => {
    const r = run(`# T\n\n${PROSE}\n\n${sentence(26)}\n\n${sentence(31)} Short one here.\n`);
    const f = byCode(r, 'DQ009');
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'warn');
    assert.equal(f[0].location, 'README.md:10');
    assert.match(f[0].message, /^README\.md: 2 sentences are over the word limit \(25 words; 20 in a numbered step\): line 10 \(26 words\), line 12 \(31 words\)$/);
  });

  it('names the first five and counts the rest', () => {
    const long = Array.from({ length: 7 }, () => sentence(30)).join('\n\n');
    const f = byCode(run(`# T\n\n${PROSE}\n\n${long}\n`), 'DQ009');
    assert.equal(f.length, 1);
    assert.match(f[0].message, /^README\.md: 7 sentences are over the word limit /);
    assert.equal((f[0].message.match(/line \d+ \(30 words\)/g) || []).length, 5);
    assert.match(f[0].message, /, and 2 more$/);
  });

  it('says "1 sentence is" for a single one', () => {
    assert.match(byCode(run(`# T\n\n${PROSE}\n\n${sentence(26)}\n`), 'DQ009')[0].message, /^README\.md: 1 sentence is over the word limit/);
  });

  it('counts exactly the limit as clean, and one word more as over', () => {
    assert.deepEqual(byCode(run(`# T\n\n${PROSE}\n\n${sentence(25)}\n`), 'DQ009'), []);
    assert.equal(byCode(run(`# T\n\n${PROSE}\n\n${sentence(26)}\n`), 'DQ009').length, 1);
  });

  it('applies 20 words inside a numbered step and 25 outside', () => {
    const r = run(`# T\n\n${PROSE}\n\n1. Run it first.\n2. ${sentence(22)}\n\n${sentence(22)}\n`);
    const f = byCode(r, 'DQ009');
    assert.equal(f.length, 1);
    assert.match(f[0].message, /1 sentence is over the word limit \(25 words; 20 in a numbered step\): line 11 \(22 words\)$/, 'the step sentence is over 20 words, the plain paragraph of the same length passes');
  });

  it('reads docQuality.sentenceLimit and docQuality.stepSentenceLimit from the configuration', () => {
    const body = `# T\n\n${PROSE}\n\n1. Run it first.\n2. ${sentence(22)}\n\n${sentence(28)}\n`;
    assert.equal(byCode(run(body), 'DQ009')[0].message.includes('2 sentences'), true);
    assert.deepEqual(byCode(run(body, { docQuality: { sentenceLimit: 30, stepSentenceLimit: 25 } }), 'DQ009'), []);
    const tight = byCode(run(body, { docQuality: { sentenceLimit: 10, stepSentenceLimit: 10 } }), 'DQ009')[0].message;
    assert.match(tight, /\(10 words; 10 in a numbered step\)/);
  });

  it('ignores a configuration value that is not a positive number', () => {
    const body = `# T\n\n${PROSE}\n\n${sentence(26)}\n`;
    for (const bad of [0, -3, 'x', null, 12.5, [], {}]) {
      assert.equal(byCode(run(body, { docQuality: { sentenceLimit: bad } }), 'DQ009').length, 1, String(bad));
    }
    assert.match(byCode(run(body, { docQuality: { sentenceLimit: 'x' } }), 'DQ009')[0].message, /\(25 words;/);
  });

  it('sentence-limit <n> sets that document\'s limit, and sentence-limit off turns the check off and still counts it', () => {
    const base = `# T\n\n${PROSE}\n\n${sentence(31)}\n`;
    assert.deepEqual(byCode(run(`<!-- docguard:quality sentence-limit 35 — long reference sentences -->\n${base}`), 'DQ009'), []);
    assert.match(byCode(run(`<!-- docguard:quality sentence-limit 28 — x -->\n${base}`), 'DQ009')[0].message, /\(28 words;/);
    const off = run(`<!-- docguard:quality sentence-limit off — generated table text -->\n${base}`);
    assert.deepEqual(byCode(off, 'DQ009'), []);
    assert.equal(off.total, 9, 'a document that turns DQ009 off still counts the check as passed');
  });

  it('a per-line pragma on a sentence\'s first line waives that sentence only', () => {
    const waived = `# T\n\n${PROSE}\n\n${sentence(26)} <!-- docguard:ignore DQ009 — a quoted rule -->\n\n${sentence(27)}\n`;
    const f = byCode(run(waived), 'DQ009');
    assert.equal(f.length, 1);
    assert.match(f[0].message, /^README\.md: 1 sentence is over the word limit \(25 words; 20 in a numbered step\): line 12 \(27 words\)$/);
    const otherCode = `# T\n\n${PROSE}\n\n${sentence(26)} <!-- docguard:ignore DQ010 — wrong code -->\n`;
    assert.equal(byCode(run(otherCode), 'DQ009').length, 1);
  });

  it('keeps DQ006, the average, as it is: a document that turns DQ009 off keeps DQ006', () => {
    const body = `<!-- docguard:quality sentence-limit off — reason -->\n# T\n\n${sentence(60)}\n${sentence(60)}\n${sentence(60)}\n`;
    const r = run(body);
    assert.deepEqual(byCode(r, 'DQ009'), []);
    assert.equal(byCode(r, 'DQ006').length, 1);
  });

  it('skips a document with too little prose, as before: no DQ009, no extra check', () => {
    const r = run('# Reference\n\n| a | b |\n|---|---|\n| x | y |\n');
    assert.equal(r.total, 0);
    assert.deepEqual(r.findings ?? [], []);
  });
});

describe('T011: DQ009 in a document in another language (spec 104)', () => {
  const PT = 'O sistema lê o arquivo de configuração e grava o resultado no disco.\nO operador revisa o relatório gerado pelo fluxo todos os dias.\nA equipe guarda os registros em um diretório separado do código.\nCada módulo tem um responsável e um revisor definidos no início.\nOs dados passam por uma etapa de validação antes da gravação final.\nO relatório final lista os arquivos lidos e os arquivos gravados hoje.\n';
  const LONG_PT = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(' ') + '.';

  it('counts the words of Portuguese the same way and reports DQ009', () => {
    const r = run(`# T\n\n${PT}\n${LONG_PT}\n`, { docs: { language: 'pt-BR' } });
    const f = byCode(r, 'DQ009');
    assert.equal(f.length, 1);
    assert.match(f[0].message, /^README\.md: 1 sentence is over the word limit \(25 words; 20 in a numbered step\): line 10 \(30 words\)$/);
    assert.equal(f[0].location, 'README.md:10');
  });

  it('counts DQ009 once as a check for a language that separates words, and lists DQ010 as skipped', () => {
    const r = run(`# T\n\n${PT}`, { docs: { language: 'pt-BR' } });
    assert.equal(r.total, 6);
    assert.deepEqual(r.skippedMetrics.filter(s => s.code === 'DQ010').map(s => [s.reason, s.language]), [['language-not-supported', 'pt']]);
    assert.equal(r.skippedMetrics.some(s => s.code === 'DQ009'), false);
  });

  it('lists DQ009 and DQ010 as language-not-supported for a script without word spacing', () => {
    const zh = '系统读取配置文件并把结果写入磁盘，每天都会这样做，没有例外情况发生。\n操作员检查流程生成的报告，并把任何错误告诉团队里的每一位成员知道。\n每个模块都有一位负责人和一位审阅人，他们在项目开始时就已经确定下来了。\n数据在最终写入存储之前要经过一个验证阶段，写入之后还要再检查一次。\n最终报告列出了今天读取的所有文件和写入的所有文件，供团队在早上查看。\n';
    for (const language of ['zh', 'ja', 'th']) {
      const r = run(`# T\n\n${zh}`, { docs: { language } });
      const skipped = r.skippedMetrics.filter(s => s.code === 'DQ009' || s.code === 'DQ010');
      assert.deepEqual(skipped.map(s => s.code), ['DQ009', 'DQ010'], language);
      assert.ok(skipped.every(s => s.reason === 'language-not-supported' && s.language === language && typeof s.metric === 'string'));
      assert.equal(r.total, 0);
      assert.equal(byCode(r, 'DQ009').length, 0);
    }
  });

  it('honors the per-document marker and the per-line pragma in Portuguese', () => {
    const off = run(`<!-- docguard:quality sentence-limit off — motivo -->\n# T\n\n${PT}\n${LONG_PT}\n`, { docs: { language: 'pt-BR' } });
    assert.deepEqual(byCode(off, 'DQ009'), []);
    const waived = run(`# T\n\n${PT}\n${LONG_PT} <!-- docguard:ignore DQ009 — citação -->\n`, { docs: { language: 'pt-BR' } });
    assert.deepEqual(byCode(waived, 'DQ009'), []);
  });
});

describe('T012: DQ010, a numbered step that does not start with a verb', () => {
  it('names line 2 only for "1. Run the tests." and "2. The build starts."', () => {
    const r = run(`# T\n\n${PROSE}\n\n1. Run the tests.\n2. The build starts.\n`);
    const f = byCode(r, 'DQ010');
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'warn');
    assert.equal(f[0].location, 'README.md:11');
    assert.match(f[0].message, /^README\.md: 1 numbered step does not start with a verb: line 11$/);
    assert.equal(r.total, 10, 'eight metrics, DQ009 and DQ010');
  });

  it('counts DQ010 as passed for steps that all start with a verb, and not at all without a numbered list', () => {
    const clean = run(`# T\n\n${PROSE}\n\n1. Run the tests.\n2. Open the report.\n`);
    assert.deepEqual(byCode(clean, 'DQ010'), []);
    assert.equal(clean.total, 10);
    const none = run(`# T\n\n${PROSE}\n\n1. Only one item here.\n`);
    assert.equal(none.total, 9, 'a lone ordered item is not a step list');
  });

  it('flags the closed list: articles, pronouns, modal and auxiliary verbs, in any case', () => {
    const words = ['the', 'a', 'an', 'i', 'you', 'we', 'they', 'he', 'she', 'it', 'this', 'that', 'these', 'those', 'there', 'here',
      'should', 'must', 'can', 'could', 'will', 'would', 'may', 'might', 'shall', 'is', 'are', 'was', 'were', 'do', 'does'];
    for (const w of words) {
      const cased = w[0].toUpperCase() + w.slice(1);
      const steps = numberedSteps(`1. ${cased} thing\n2. Run it\n`);
      assert.equal(steps[0].firstWord, cased);
      const f = byCode(run(`# T\n\n${PROSE}\n\n1. ${cased} item\n2. Run it\n`), 'DQ010');
      assert.equal(f.length, 1, w);
    }
    assert.equal(byCode(run(`# T\n\n${PROSE}\n\n1. THE build\n2. Run it\n`), 'DQ010').length, 1);
  });

  it('flags a word of six or more letters ending in "ing", except bring, string, spring, swing and thing', () => {
    const flagged = ['Running', 'Setting', 'Opening', 'Installing', 'Checking'];
    const clean = ['Bring', 'String', 'Spring', 'Swing', 'Thing', 'Using', 'Sing', 'King', 'Add', 'Ring'];
    for (const w of flagged) assert.equal(byCode(run(`# T\n\n${PROSE}\n\n1. ${w} it now\n2. Run it\n`), 'DQ010').length, 1, w);
    for (const w of clean) assert.equal(byCode(run(`# T\n\n${PROSE}\n\n1. ${w} it now\n2. Run it\n`), 'DQ010').length, 0, w);
  });

  it('does not judge a step that starts with inline code, a link or a non-letter, and reads a bold verb', () => {
    const ok = run(`# T\n\n${PROSE}\n\n1. \`npm test\` runs the suite\n2. [The guide](x.md) lists them\n3. 42 steps follow\n4. **Run** the build\n`);
    assert.deepEqual(byCode(ok, 'DQ010'), []);
    const bad = run(`# T\n\n${PROSE}\n\n1. **The** build\n2. Step 2: Run it\n3. Step 3: The end\n`);
    assert.match(byCode(bad, 'DQ010')[0].message, /: line 10, line 12$/, 'the label is removed before the word is read');
  });

  it('reports one finding per document with the count and up to five lines', () => {
    const steps = Array.from({ length: 8 }, (_, i) => `${i + 1}. The step ${i + 1}`).join('\n');
    const f = byCode(run(`# T\n\n${PROSE}\n\n${steps}\n`), 'DQ010');
    assert.equal(f.length, 1);
    assert.match(f[0].message, /^README\.md: 8 numbered steps do not start with a verb: line 10, line 11, line 12, line 13, line 14, and 3 more$/);
  });

  it('honors the per-line pragma and the step-verbs off marker', () => {
    const body = `# T\n\n${PROSE}\n\n1. Run it\n2. The build <!-- docguard:ignore DQ010 — a noun step -->\n3. This one\n`;
    assert.match(byCode(run(body), 'DQ010')[0].message, /1 numbered step does not start with a verb: line 12$/);
    const off = run(`<!-- docguard:quality step-verbs off — reference list -->\n${body}`);
    assert.deepEqual(byCode(off, 'DQ010'), []);
    assert.equal(off.total, 10, 'turned off, the check still counts as passed');
  });

  it('is informational by its registered default level', async () => {
    const { codeDefaultLevel } = await import('../cli/findings.mjs');
    assert.equal(codeDefaultLevel('DQ010'), 'info');
    assert.equal(codeDefaultLevel('DQ009'), null, 'DQ009 is a warning');
  });

  it('is skipped, listed with language-not-supported, in every other language', () => {
    const PT = 'O sistema lê o arquivo de configuração e grava o resultado no disco.\nO operador revisa o relatório gerado pelo fluxo todos os dias.\nA equipe guarda os registros em um diretório separado do código.\nCada módulo tem um responsável e um revisor definidos no início.\nOs dados passam por uma etapa de validação antes da gravação final.\n';
    for (const language of ['pt-BR', 'es', 'de']) {
      const r = run(`# T\n\n${PT}\n1. O build começa\n2. A equipe revisa\n`, { docs: { language } });
      assert.deepEqual(byCode(r, 'DQ010'), [], language);
      assert.equal(r.skippedMetrics.filter(s => s.code === 'DQ010' && s.reason === 'language-not-supported').length, 1, language);
    }
  });
});

describe('T013: DQ001 to DQ008 are byte-identical', () => {
  const EN = [
    'The system is designed by the team and it is not changed unless the review is approved by the lead, and the data that passes through it cannot be lost nor duplicated during any step of the import process because it was written that way.',
    'This was done because they said that it must never fail, and the results are not stored when the check is skipped if the cache is cold.',
    'The loader reads the config and then it writes the output as well as the report, and additionally the logs are rotated daily by the scheduler when the disk is full.',
    'When the operator is not present the pipeline waits until the queue is drained, unless the retry budget is exhausted, in which case nothing is published.',
  ].join('\n');
  const GOLDEN = [
    'README.md: High passive voice ratio (100% of sentences). Use active voice for clarity. Found 4/4 passive sentences. If the passive voice is intentional (sequence/flow doc), add: <!-- docguard:quality passive-voice off — your reason -->',
    'README.md: Low atomicity (50% compound sentences). Split compound sentences for easier verification (IEEE 830 §4.1)',
    'README.md: Average sentence too long (32.3 words). Target ≤30 words per sentence for readability',
    'README.md: High negation load (75% of sentences use negation). Rephrase in positive terms: "must not fail" → "must succeed" (IEEE 830 §4.3). If the negation is intentional, add: <!-- docguard:quality negation-load off — your reason -->',
    'README.md: High conditional load (100% of sentences are conditional). Simplify by splitting conditionals into separate requirements',
  ];

  it('keeps the messages, the order and the locations of the eight metrics, and DQ006 as the average', () => {
    const r = run(`# T\n\n${EN}\n`);
    const old = r.findings.filter(f => f.code !== 'DQ009' && f.code !== 'DQ010');
    assert.deepEqual(old.map(f => f.message), GOLDEN);
    assert.deepEqual(old.map(f => f.code), ['DQ001', 'DQ003', 'DQ006', 'DQ007', 'DQ008']);
    assert.ok(old.every(f => f.location === 'README.md'), 'only the new codes carry a line');
    assert.equal(r.total, 9);
    assert.equal(r.passed, 3);
  });

  it('adds the sentence limit without touching the average: DQ006 reads the same with DQ009 off', () => {
    const on = run(`# T\n\n${EN}\n`);
    const off = run(`<!-- docguard:quality sentence-limit off — reason -->\n# T\n\n${EN}\n`);
    assert.deepEqual(byCode(off, 'DQ006').map(f => f.message), byCode(on, 'DQ006').map(f => f.message));
    assert.equal(on.findings.length - off.findings.length, 1, 'DQ009 is the only difference');
    assert.equal(byCode(on, 'DQ009').length, 1);
  });

  it('carries no new key in the result for an English project: no skip report, the same fields', () => {
    const r = run(`# T\n\n${EN}\n`);
    assert.equal(r.skippedMetrics, undefined);
    assert.deepEqual(Object.keys(r).sort(), Object.keys(run(`# T\n\n${PROSE}\n`)).sort());
  });
});
