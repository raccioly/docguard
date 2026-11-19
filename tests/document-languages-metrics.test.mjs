/**
 * Spec 104, Stage 3: text metrics skip what they cannot read.
 *
 * Doc-Quality's eight metrics depend on English word lists, English morphology
 * and an English syllable counter. For a document in another language the
 * metrics that cannot be judged are skipped and reported as skipped with the
 * reason `language-not-supported`: no number, no finding, no count in `passed`
 * or `total`. The closed-class metrics (negation, conditional, compound,
 * pronouns) run for pt and es since the native review of their lists (T033,
 * 2026-11-17; see document-languages-metrics-wordlists.test.mjs) and stay
 * skipped for every other language but English. Sentence length runs for a
 * script that separates words with spaces.
 *
 * T025, T026 (the non-English half) and T027 were red on origin/main. The
 * English halves of T026 are guards: they pass on origin/main by construction
 * (the English path is the legacy path) and pin it.
 *
 * @req docguard.document-languages#FR-017
 * @req docguard.document-languages#FR-018
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocQuality, tokenizeWords } from '../cli/validators/doc-quality.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-metrics-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const run = dir => validateDocQuality(dir, loadConfig(dir));
const skippedCodes = r => (r.skippedMetrics || []).map(s => s.code).sort();
const findingCodes = r => (r.findings || []).map(f => f.code).sort();

/** Portuguese prose: three long sentences with negations, conditionals and passives. */
const PT = [
  'O sistema não é escrito em uma linguagem que a equipe conhece, e por isso cada módulo precisa ser lido com cuidado antes de qualquer alteração, porque os dados que passam por ele não podem ser perdidos nem duplicados durante a execução de cada etapa do processo de importação.',
  'Isso foi feito porque eles disseram que nunca deve falhar, e os resultados não são guardados quando a verificação é ignorada se o cache estiver frio, mas também quando o disco estiver cheio e o agendador girar os registros todos os dias.',
  'Quando o operador não está presente o fluxo espera até que a fila seja esvaziada, a menos que o orçamento de tentativas se esgote, caso em que nada é publicado e o relatório registra a falha para que a equipe revise na manhã seguinte.',
].join('\n');

/** The English document of the golden below: every metric produces a number or a finding. */
const EN = [
  'The system is designed by the team and it is not changed unless the review is approved by the lead, and the data that passes through it cannot be lost nor duplicated during any step of the import process because it was written that way.',
  'This was done because they said that it must never fail, and the results are not stored when the check is skipped if the cache is cold.',
  'The loader reads the config and then it writes the output as well as the report, and additionally the logs are rotated daily by the scheduler when the disk is full.',
  'When the operator is not present the pipeline waits until the queue is drained, unless the retry budget is exhausted, in which case nothing is published.',
].join('\n');

/** What origin/main reports for EN with no `docs.language` (captured before this stage). */
const EN_GOLDEN = {
  passed: 3,
  total: 9, // eight metrics and the sentence limit DQ009 (spec 105); its finding is left out of `messages`, which pins DQ001-DQ008
  codes: ['DQ001', 'DQ003', 'DQ006', 'DQ007', 'DQ008', 'DQ009'],
  messages: [
    'README.md: High passive voice ratio (100% of sentences). Use active voice for clarity. Found 4/4 passive sentences. If the passive voice is intentional (sequence/flow doc), add: <!-- docguard:quality passive-voice off — your reason -->',
    'README.md: Low atomicity (50% compound sentences). Split compound sentences for easier verification (IEEE 830 §4.1)',
    'README.md: Average sentence too long (32.3 words). Target ≤30 words per sentence for readability',
    'README.md: High negation load (75% of sentences use negation). Rephrase in positive terms: "must not fail" → "must succeed" (IEEE 830 §4.3). If the negation is intentional, add: <!-- docguard:quality negation-load off — your reason -->',
    'README.md: High conditional load (100% of sentences are conditional). Simplify by splitting conditionals into separate requirements',
  ],
};

describe('T025: Portuguese prose gets sentence length and the reviewed metrics, and a skip entry for passive voice and Flesch', () => {
  const dir = project({ 'README.md': `# Titulo\n\n${PT}\n` }, { language: 'pt-BR' });
  const r = run(dir);

  it('reports sentence length (DQ006), negation (DQ007) and conditional (DQ008) as findings; passive voice and Flesch yield none', () => {
    assert.deepEqual(findingCodes(r), ['DQ006', 'DQ007', 'DQ008', 'DQ009']); // DQ009 is spec 105: the sentence limit runs where words are spaced
  });

  it('reports passive voice and both Flesch scores as skipped, each with the reason language-not-supported', () => {
    assert.deepEqual(skippedCodes(r), ['DQ001', 'DQ004', 'DQ005', 'DQ010']); // DQ010 (spec 105) is English only
    for (const s of r.skippedMetrics) {
      assert.equal(s.reason, 'language-not-supported');
      assert.equal(s.language, 'pt');
      assert.equal(s.document, 'README.md');
      assert.equal(typeof s.metric, 'string');
    }
  });

  it('a skipped metric yields no number: no count in passed or total', () => {
    assert.equal(r.total, 6, 'sentence length, the four reviewed metrics and the sentence limit (DQ009) were judged');
    assert.equal(r.passed, 2, 'pronouns and compound sentences passed; the other three failed');
    for (const s of r.skippedMetrics) assert.equal('value' in s || 'ratio' in s || 'score' in s, false);
  });

  it('the closed-class metrics run for pt and es (reviewed lists, T033) and stay skipped for every other language', () => {
    for (const language of ['pt', 'es', 'es-MX', 'pt-PT']) {
      const result = run(project({ 'README.md': `# T\n\n${PT}\n` }, { language }));
      for (const code of ['DQ002', 'DQ003', 'DQ007', 'DQ008']) assert.ok(!skippedCodes(result).includes(code), `${language}: ${code} must run`);
    }
    for (const language of ['de', 'fr', 'ru']) {
      const result = run(project({ 'README.md': `# T\n\n${PT}\n` }, { language }));
      for (const code of ['DQ002', 'DQ003', 'DQ007', 'DQ008']) assert.ok(skippedCodes(result).includes(code), `${language}: ${code} must be skipped`);
    }
  });

  it('a document that passes every judged check counts them as passed and has no finding', () => {
    const short = 'O sistema lê o arquivo de configuração e grava o resultado no disco.\nO operador revisa o relatório gerado pelo fluxo todos os dias.\nA equipe guarda os registros em um diretório separado do código.\nCada módulo tem um responsável e um revisor definidos no início.\nOs dados passam por uma etapa de validação antes da gravação final.\nO relatório final lista os arquivos lidos e os arquivos gravados hoje.\n';
    const result = run(project({ 'README.md': `# T\n\n${short}` }, { language: 'pt-BR' }));
    assert.equal(result.total, 6);
    assert.equal(result.passed, 6);
    assert.deepEqual(findingCodes(result), []);
    assert.equal(skippedCodes(result).length, 4);
  });

  it('the Score does not count a skipped metric: its Doc Quality dimension is the same with and without the prose', () => {
    // The Score's Doc Quality dimension reads sections and content, never DQ numbers; a skip must not move it.
    const sections = '## System Overview\n\nx\n\n## Component Map\n\nx\n\n## Tech Stack\n\nNode\n';
    const withProse = project({ 'docs-canonical/ARCHITECTURE.md': `# A\n\n${sections}\n${PT}\n` }, { language: 'pt-BR' });
    const withoutProse = project({ 'docs-canonical/ARCHITECTURE.md': `# A\n\n${sections}\n${PT}\n` }, { language: 'de' });
    assert.equal(runScoreInternal(withProse, loadConfig(withProse)).categories.docQuality, runScoreInternal(withoutProse, loadConfig(withoutProse)).categories.docQuality);
  });
});

describe('T026: the Unicode tokenizer, and the English path unchanged', () => {
  it('a non-English language keeps "não" as one token', () => {
    assert.deepEqual(tokenizeWords('Isso não é verdade', { unicode: true }), ['isso', 'não', 'é', 'verdade']);
  });

  it('a decomposed accent (na + combining tilde + o) is one token too', () => {
    assert.deepEqual(tokenizeWords('não sei', { unicode: true }).map(w => w.normalize('NFC')), ['não', 'sei']);
  });

  it('non-Latin letters are tokens, not dropped (Cyrillic, Greek)', () => {
    assert.deepEqual(tokenizeWords('Система не работает', { unicode: true }), ['система', 'не', 'работает']);
    assert.deepEqual(tokenizeWords('Το σύστημα δουλεύει', { unicode: true }), ['το', 'σύστημα', 'δουλεύει']);
  });

  it('without the option the English tokenizer is unchanged (guard: green on origin/main)', () => {
    assert.deepEqual(tokenizeWords('Isso não é verdade'), ['isso', 'n', 'o', 'verdade']);
    assert.deepEqual(tokenizeWords("Don't Stop-Now 42 times!"), ["don't", 'stop-now', '42', 'times']);
  });

  it('English numbers are byte-identical with no docs.language and with "en" (guard: green on origin/main)', () => {
    for (const docs of [undefined, { language: 'en' }]) {
      const r = run(project({ 'README.md': `# T\n\n${EN}\n` }, docs));
      assert.equal(r.passed, EN_GOLDEN.passed);
      assert.equal(r.total, EN_GOLDEN.total);
      assert.deepEqual(findingCodes(r), EN_GOLDEN.codes);
      assert.deepEqual(r.findings.filter(f => f.code !== 'DQ009').map(f => f.message).sort(), [...EN_GOLDEN.messages].sort());
      assert.equal(r.skippedMetrics, undefined, 'an English project carries no skip report');
    }
  });

  it('Cyrillic prose is prose: a Russian document is scored for sentence length, not dropped as insufficient', () => {
    const ru = 'Система читает файл настройки и записывает результат на диск каждый день без исключения.\nОператор проверяет отчет, который создает процесс, и сообщает команде о любых ошибках.\nКаждый модуль имеет ответственного и проверяющего, назначенных в начале работы над проектом.\nДанные проходят этап проверки до окончательной записи в хранилище и после нее.\nИтоговый отчет перечисляет прочитанные файлы и записанные файлы за текущий день работы.\n';
    const r = run(project({ 'README.md': `# T\n\n${ru}` }, { language: 'ru' }));
    assert.equal(r.total, 2);
    assert.equal(skippedCodes(r).length, 8);
  });

  it('DQ006 is skipped for a script without word spacing (Chinese, Japanese, Thai): nothing is scored', () => {
    const zh = '系统读取配置文件并把结果写入磁盘，每天都会这样做，没有例外情况发生。\n操作员检查流程生成的报告，并把任何错误告诉团队里的每一位成员知道。\n每个模块都有一位负责人和一位审阅人，他们在项目开始时就已经确定下来了。\n数据在最终写入存储之前要经过一个验证阶段，写入之后还要再检查一次。\n最终报告列出了今天读取的所有文件和写入的所有文件，供团队在早上查看。\n';
    for (const language of ['zh', 'zh-Hans', 'ja', 'th']) {
      const r = run(project({ 'README.md': `# T\n\n${zh}` }, { language }));
      assert.equal(r.total, 0, `${language}: nothing is scored`);
      assert.deepEqual(skippedCodes(r), ['DQ001', 'DQ002', 'DQ003', 'DQ004', 'DQ005', 'DQ006', 'DQ007', 'DQ008', 'DQ009', 'DQ010'], language);
      assert.equal(r.emptyCause, 'language-not-supported', `${language}: an empty result names the cause`);
      assert.deepEqual(r.findings, []);
    }
  });
});

describe('T027: a language with no built-in set reports each metric as skipped', () => {
  it('docs.language "de": no passive, readability or negation number, each skipped for language-not-supported', () => {
    const de = 'Das System liest die Konfigurationsdatei nicht und schreibt das Ergebnis nicht auf die Festplatte, wenn der Betreiber den Bericht, den der Prozess jeden Tag erzeugt, nicht geprüft hat.\nDie Daten durchlaufen vor dem endgültigen Schreiben eine Prüfphase, und danach wird noch einmal geprüft, ob alles vollständig und richtig gespeichert wurde.\nDer Abschlussbericht listet alle gelesenen und alle geschriebenen Dateien des laufenden Tages auf, damit das Team sie am nächsten Morgen in Ruhe durchsehen kann.\n';
    const r = run(project({ 'README.md': `# T\n\n${de}` }, { language: 'de' }));
    for (const code of ['DQ001', 'DQ004', 'DQ005', 'DQ007']) {
      assert.ok(skippedCodes(r).includes(code), `${code} is reported as skipped`);
      assert.ok(!findingCodes(r).includes(code), `${code} yields no finding`);
    }
    assert.ok(r.skippedMetrics.every(s => s.reason === 'language-not-supported' && s.language === 'de'));
    assert.equal(r.total, 2, 'sentence length and the sentence limit still run: German separates words with spaces');
  });

  it('English prose under docs.language "de" is skipped too: the language is configuration, never content', () => {
    const r = run(project({ 'README.md': `# T\n\n${EN}\n` }, { language: 'de' }));
    assert.equal(r.total, 2);
    assert.equal(skippedCodes(r).length, 8);
  });
});
