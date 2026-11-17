/**
 * Spec 104, T033: the text-quality metrics for Portuguese and Spanish.
 *
 * Negation (DQ007), conditional (DQ008), ambiguous pronouns (DQ002) and compound
 * sentences (DQ003) run for `pt` (pt-BR, pt-PT) and `es` (every es-*) with the
 * word lists the maintainer, a native Portuguese speaker, approved on
 * 2026-11-17. The lists below are written out here a second time, from the
 * approved review, so that a word added to or dropped from the shipped data
 * fails a test. Every other non-English language stays skipped.
 *
 * Every test here fails on origin/main: the module `cli/shared-prose-words.mjs`
 * does not exist there, and a pt or es document reported these four metrics as
 * skipped with the reason `language-not-supported`.
 *
 * @req docguard.document-languages#FR-017
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocQuality } from '../cli/validators/doc-quality.mjs';
import { PROSE_WORDS, PROSE_WORD_LANGUAGES, proseMatchers } from '../cli/shared-prose-words.mjs';

// ── The approved lists, as written in the review of 2026-11-17 ──
const APPROVED = {
  pt: {
    negation: ['não', 'nunca', 'jamais', 'nenhum', 'nenhuma', 'nenhuns', 'nenhumas', 'nem', 'ninguém', 'nada', 'tampouco'],
    conditional: ['caso', 'quando', 'sempre que', 'a menos que', 'a não ser que', 'salvo se', 'exceto se', 'contanto que', 'desde que', 'somente se', 'apenas se', 'só se', 'até que', 'caso contrário', 'senão'],
    pronouns: ['isso', 'isto', 'aquilo', 'ele', 'ela', 'eles', 'elas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'seu', 'sua', 'seus', 'suas', 'dele', 'dela', 'deles', 'delas'],
    compoundPhrases: ['e também', 'e depois', 'e então', 'assim como', 'bem como', 'além de', 'além disso', 'adicionalmente', 'ademais', 'outrossim'],
  },
  es: {
    negation: ['no', 'nunca', 'jamás', 'ningún', 'ninguno', 'ninguna', 'ningunos', 'ningunas', 'ni', 'nadie', 'nada', 'tampoco'],
    conditional: ['si', 'cuando', 'siempre que', 'a menos que', 'salvo que', 'excepto si', 'en caso de', 'en caso de que', 'con tal de que', 'solo si', 'sólo si', 'hasta que', 'de lo contrario', 'si no'],
    pronouns: ['esto', 'eso', 'aquello', 'él', 'ella', 'ellos', 'ellas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'su', 'sus'],
    compoundPhrases: ['y también', 'y luego', 'y después', 'así como', 'además de', 'además', 'adicionalmente', 'asimismo', 'a su vez'],
  },
};

const pt = proseMatchers('pt');
const es = proseMatchers('es');

describe('the shipped lists are exactly the approved ones', () => {
  for (const language of ['pt', 'es']) {
    for (const key of ['negation', 'conditional', 'pronouns', 'compoundPhrases']) {
      it(`${language} ${key}: no word added, none dropped`, () => {
        const shipped = [...PROSE_WORDS[language][key]];
        // Portuguese "se" is a rule, not a list word: it is tested below.
        assert.deepEqual([...shipped].sort(), [...APPROVED[language][key]].sort());
      });
    }
  }
  it('the conjunctions of the non-atomic rule: "e" for pt, "y" and "e" for es', () => {
    assert.deepEqual([...PROSE_WORDS.pt.conjunctions], ['e']);
    assert.deepEqual([...PROSE_WORDS.es.conjunctions], ['y', 'e']);
  });
  it('only pt and es have reviewed lists; English never goes through this module', () => {
    assert.deepEqual([...PROSE_WORD_LANGUAGES], ['pt', 'es']);
    for (const language of ['en', 'de', 'fr', 'ja']) assert.equal(proseMatchers(language), null);
  });
});

describe('Portuguese: every list entry counts', () => {
  for (const w of APPROVED.pt.negation) it(`negation: "${w}"`, () => assert.ok(pt.negation(`O sistema ${w} grava o valor final.`)));
  for (const w of APPROVED.pt.conditional) it(`conditional: "${w}"`, () => assert.ok(pt.conditional(`O sistema grava o valor ${w} o operador confirme.`)));
  for (const w of APPROVED.pt.pronouns) it(`pronoun: "${w}"`, () => assert.equal(pt.pronounCount(`O sistema grava ${w} no disco.`), 1));
  for (const w of APPROVED.pt.compoundPhrases) it(`compound: "${w}"`, () => assert.ok(pt.compound(`O sistema grava o valor ${w} o operador confirma.`)));
  it('compound: two "e" in one sentence; one is not enough', () => {
    assert.ok(pt.compound('O sistema lê o arquivo e grava o valor e fecha a conexão.'));
    assert.ok(!pt.compound('O sistema lê o arquivo e grava o valor no disco.'));
  });
  it('case does not matter: "NÃO", "Quando", "ISSO"', () => {
    assert.ok(pt.negation('O SISTEMA NÃO GRAVA.'));
    assert.ok(pt.conditional('Quando o operador confirma, grava.'));
    assert.equal(pt.pronounCount('ISSO é tudo.'), 1);
  });
  it('a phrase matches across any whitespace, not across punctuation', () => {
    assert.ok(pt.conditional('Grava a menos   que o operador cancele.'));
    assert.ok(pt.conditional('Grava a menos\nque o operador cancele.'));
    assert.ok(!pt.conditional('Grava a menos, que o operador cancele.'));
  });
});

describe('Portuguese: what is left out does not count', () => {
  it('"sem" is not a negation', () => assert.ok(!pt.negation('O sistema roda sem arquivo local.')));
  it('"enquanto" is not a conditional', () => assert.ok(!pt.conditional('O sistema espera enquanto a fila esvazia.')));
  it('the articles o, a, os, as and the clitic lhe are not pronouns', () => {
    assert.equal(pt.pronounCount('O operador lê a fila, os dados e as notas, e dá-lhe tempo, lhe disse.'), 0);
  });
  it('an accented "é" is not the conjunction "e"', () => {
    assert.ok(!pt.compound('O sistema é rápido, é simples e grava o valor.'));
  });
  it('whole words only: "nada" inside "enunciada", "ele" inside "elevar" do not count', () => {
    assert.ok(!pt.negation('A regra enunciada é clara.'));
    assert.equal(pt.pronounCount('Vamos elevar o nível.'), 0);
  });
});

describe('Portuguese "se": a conditional only at the start of a sentence or after a comma, never after a hyphen', () => {
  it('"Se o arquivo não existir, ..." counts', () => assert.ok(pt.conditional('Se o arquivo não existir, o sistema cria um novo.')));
  it('"..., se houver" counts', () => assert.ok(pt.conditional('O sistema grava os dados, se houver espaço no disco.')));
  it('a comma with spaces before "se" counts', () => assert.ok(pt.conditional('O sistema grava os dados  ,   se houver espaço.')));
  it('a quote before the first word still counts: "Se ...', () => assert.ok(pt.conditional('"Se o arquivo falhar", o sistema avisa o operador.')));
  it('"o arquivo se encontra" does not count (reflexive)', () => assert.ok(!pt.conditional('O arquivo se encontra no diretório principal do projeto.')));
  it('"configura-se" does not count (hyphen)', () => assert.ok(!pt.conditional('Configura-se o módulo no arquivo principal.')));
  it('"Configura-se" at the start of the sentence does not count', () => assert.ok(!pt.conditional('Configura-se o módulo antes do uso.')));
  it('a hyphen after a comma-less clause does not count either: "grava dados, abre-se"', () => assert.ok(!pt.conditional('O sistema grava dados, abre-se o arquivo e fecha.')));
  it('"se" is not a rule for Spanish: "se" there is not a conditional', () => assert.ok(!es.conditional('Se guarda el archivo en el disco local.')));
});

describe('a hyphen between letters is part of the word (pt and es)', () => {
  it('"e-mail" adds no "e" to the compound count', () => {
    assert.ok(!pt.compound('Envie o e-mail e grave o e-mail no disco.'));
    assert.ok(!es.compound('Envía el e-mail y guarda el e-mail en el disco.'));
    assert.ok(pt.compound('Envie o e-mail e grave o arquivo e feche.'), 'a normal "e" still counts, twice here');
  });
  it('"requisito não-funcional" is a compound adjective, not a negation; a normal "não" counts', () => {
    assert.ok(!pt.negation('Este é um requisito não-funcional do sistema.'));
    assert.ok(!es.negation('Es un requisito no-funcional del sistema.'));
    assert.ok(pt.negation('O requisito não funcional falha.'));
    assert.ok(pt.negation('O requisito não é funcional.'));
  });
  it('"configura-se" and "dá-se" stay excluded, also after a comma', () => {
    assert.ok(!pt.conditional('Configura-se o módulo antes do uso.'));
    assert.ok(!pt.conditional('Aqui, configura-se o módulo.'));
    assert.ok(!pt.conditional('Quando falha, dá-se o aviso'.replace('Quando', 'Ao')));
  });
  it('a pronoun or phrase word inside a hyphenated word does not count', () => {
    assert.equal(pt.pronounCount('Veja o ex-ele e o pós-isso.'), 0);
    assert.ok(!pt.conditional('O pré-quando é raro.'));
  });
  it('a spaced dash is still a boundary: "não - e" counts', () => {
    assert.ok(pt.negation('O sistema - não grava.'));
  });
});

describe('Portuguese: accents are optional in the text, never invented', () => {
  it('"nao" counts as "não"', () => assert.ok(pt.negation('O sistema nao grava o valor.')));
  it('"ninguem", "ate que", "so se", "alem de", "senao" count', () => {
    assert.ok(pt.negation('Ninguem grava o valor.'));
    assert.ok(pt.conditional('Espera ate que a fila esvazie.'));
    assert.ok(pt.conditional('Grava so se o operador confirmar.'));
    assert.ok(pt.compound('O sistema grava alem de ler o valor.'));
    assert.ok(pt.conditional('Confirme, senao o sistema falha.'));
  });
  it('a decomposed accent (a + combining tilde) is read like the composed one', () => {
    assert.ok(pt.negation('O sistema na\u0303o grava.'));
    assert.ok(es.negation('Jama\u0301s grava el valor.'));
  });
});

describe('Spanish: every list entry counts', () => {
  for (const w of APPROVED.es.negation) it(`negation: "${w}"`, () => assert.ok(es.negation(`El sistema ${w} guarda el valor final.`)));
  for (const w of APPROVED.es.conditional) it(`conditional: "${w}"`, () => assert.ok(es.conditional(`El sistema guarda el valor ${w} el operador confirme.`)));
  for (const w of APPROVED.es.pronouns) it(`pronoun: "${w}"`, () => assert.equal(es.pronounCount(`El sistema guarda ${w} en el disco.`), 1));
  for (const w of APPROVED.es.compoundPhrases) it(`compound: "${w}"`, () => assert.ok(es.compound(`El sistema guarda el valor ${w} el operador confirma.`)));
  it('compound: two "y", or "y" and "e", in one sentence; one is not enough', () => {
    assert.ok(es.compound('El sistema lee el archivo y guarda el valor y cierra la conexión.'));
    assert.ok(es.compound('El sistema lee el archivo y guarda el valor e informa al operador.'));
    assert.ok(es.compound('Padres e hijos e hijas.'));
    assert.ok(!es.compound('El sistema lee el archivo y guarda el valor en el disco.'));
  });
});

describe('Spanish: what is left out does not count, and the two accent rules', () => {
  it('"sin" is not a negation', () => assert.ok(!es.negation('El sistema corre sin archivo local.')));
  it('"mientras" is not a conditional', () => assert.ok(!es.conditional('El sistema espera mientras la cola se vacía.')));
  it('the articles and clitics lo, la, los, las, le, les are not pronouns', () => {
    assert.equal(es.pronounCount('El operador lo lee, la guarda, los abre, las cierra, le avisa y les dice.'), 0);
  });
  it('"el" without the accent is the article: not a pronoun', () => assert.equal(es.pronounCount('El operador revisa el informe.'), 0));
  it('"él" with the accent is a pronoun', () => assert.equal(es.pronounCount('Eso lo dijo él.'), 2));
  it('"sí" with the accent is "yes": not a conditional', () => assert.ok(!es.conditional('Sí, el sistema guarda el valor.')));
  it('"si" without the accent is a conditional', () => assert.ok(es.conditional('Si el archivo falla, el sistema avisa.')));
  it('an accented "é" is not the conjunction "e", and "é" of Portuguese never leaks in', () => {
    assert.ok(!es.compound('Guarda el valor é guarda el otro é más.'));
  });
  it('accent-insensitive: "jamas", "ningun", "asi como", "ademas de", "despues" count', () => {
    assert.ok(es.negation('Jamas guarda el valor.'));
    assert.ok(es.negation('Ningun valor se guarda.'));
    assert.ok(es.compound('Guarda el valor asi como el nombre.'));
    assert.ok(es.compound('Guarda el valor ademas de leerlo.'));
    assert.ok(es.compound('Lee el valor y despues lo guarda.'));
  });
  it('"cuándo" (a question word) is not "cuando"', () => assert.ok(!es.conditional('Se pregunta cuándo guarda el valor.')));
});

// ── Documents ──

function project(files, docs) {
  const dir = makeTempDir('docguard-wordlists-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const run = (files, docs) => { const dir = project(files, docs); return validateDocQuality(dir, loadConfig(dir)); };
const codes = r => (r.findings || []).map(f => f.code).sort();
const skipped = r => (r.skippedMetrics || []).map(s => s.code).sort();
const CLOSED = ['DQ002', 'DQ003', 'DQ007', 'DQ008'];

/** Prose with no word of any list: every closed-class metric is below its threshold. */
const PT_CLEAN = [
  'O sistema lê o arquivo de configuração no início do dia.',
  'O operador revisa o relatório gerado pelo fluxo todos os dias.',
  'A equipe guarda os registros em um diretório separado do código.',
  'Cada módulo tem um responsável definido pela liderança técnica.',
  'Os dados passam por uma etapa de validação antes da gravação final.',
  'O relatório final lista os arquivos lidos hoje pelo sistema.',
].join('\n');
const ES_CLEAN = [
  'El sistema lee el archivo de configuración al inicio del día.',
  'El operador revisa el informe generado por el flujo cada día.',
  'El equipo guarda los registros en un directorio separado del código.',
  'Cada módulo tiene un responsable definido por la dirección técnica.',
  'Los datos pasan por una etapa de validación antes de la escritura final.',
  'El informe final lista los archivos leídos hoy por el sistema.',
].join('\n');

/** Every sentence carries a negation, a condition, vague pronouns and a compound phrase. */
const PT_HEAVY = [
  'Isso não funciona quando ele muda e também ela muda, e isso mostra aquilo que eles disseram sobre esse plano.',
  'Isto nunca grava se esta etapa falha, caso contrário ela segue, e depois eles revisam esse seu relatório.',
  'Aquilo não passa quando elas leem esses dados, assim como eles leem essas notas dele e dela sempre.',
  'Esta tarefa jamais termina quando este módulo para, além disso seus donos não respondem a suas perguntas.',
].join('\n');
const ES_HEAVY = [
  'Esto no funciona cuando ella cambia y también él cambia, y eso muestra aquello que ellos dijeron sobre este plan.',
  'Eso nunca guarda si esta etapa falla, de lo contrario ella sigue, y luego ellos revisan este su informe.',
  'Aquello no pasa cuando ellas leen esos datos, así como ellos leen estas notas de ella y de él siempre.',
  'Esta tarea jamás termina cuando este módulo para, además sus dueños no responden a sus preguntas.',
].join('\n');

describe('a Portuguese document gets numbers and the four findings above threshold', () => {
  for (const language of ['pt-BR', 'pt-PT', 'pt']) {
    it(`${language}: heavy prose yields DQ002, DQ003, DQ007 and DQ008, nothing is skipped for them`, () => {
      const r = run({ 'README.md': `# T\n\n${PT_HEAVY}\n` }, { language });
      for (const code of CLOSED) assert.ok(codes(r).includes(code), `${language}: ${code}`);
      assert.deepEqual(skipped(r), ['DQ001', 'DQ004', 'DQ005'], 'passive voice and both Flesch scores stay skipped');
      assert.ok(r.skippedMetrics.every(s => s.reason === 'language-not-supported' && s.language === 'pt'));
      assert.equal(r.total, 5, 'sentence length and the four closed-class metrics are judged');
    });
    it(`${language}: clean prose is judged on all five and yields none of the four`, () => {
      const r = run({ 'README.md': `# T\n\n${PT_CLEAN}\n` }, { language });
      assert.deepEqual(codes(r).filter(c => CLOSED.includes(c)), []);
      assert.equal(r.total, 5);
      assert.equal(r.passed, 5);
    });
  }
  it('messages keep the English wording and name the metric; DQ002 quotes Portuguese pronouns', () => {
    const r = run({ 'README.md': `# T\n\n${PT_HEAVY}\n` }, { language: 'pt-BR' });
    const byCode = Object.fromEntries(r.findings.map(f => [f.code, f.message]));
    assert.match(byCode.DQ002, /^README\.md: High ambiguous pronoun ratio \(\d+\.\d%\)\. Replace "isso\/isto\/este\/ele" with specific nouns for clarity$/);
    assert.match(byCode.DQ003, /^README\.md: Low atomicity \(\d+% compound sentences\)\./);
    assert.match(byCode.DQ007, /^README\.md: High negation load \(\d+% of sentences use negation\)\./);
    assert.match(byCode.DQ008, /^README\.md: High conditional load \(\d+% of sentences are conditional\)\./);
  });
  it('the thresholds are the English ones: 20% negation passes, above it warns', () => {
    // Ten sentences, two with "não" = 20%: at the threshold, no finding. Three = 30%: finding.
    const base = Array.from({ length: 10 }, (_, i) => `O módulo ${i + 1} lê o arquivo de configuração do sistema.`);
    const two = base.map((s, i) => (i < 2 ? s.replace('lê', 'não lê') : s)).join('\n');
    const three = base.map((s, i) => (i < 3 ? s.replace('lê', 'não lê') : s)).join('\n');
    assert.ok(!codes(run({ 'README.md': `# T\n\n${two}\n` }, { language: 'pt-BR' })).includes('DQ007'));
    assert.ok(codes(run({ 'README.md': `# T\n\n${three}\n` }, { language: 'pt-BR' })).includes('DQ007'));
  });
});

describe('a Spanish document gets numbers and the four findings above threshold', () => {
  for (const language of ['es', 'es-MX', 'es-ES']) {
    it(`${language}: heavy prose yields DQ002, DQ003, DQ007 and DQ008`, () => {
      const r = run({ 'README.md': `# T\n\n${ES_HEAVY}\n` }, { language });
      for (const code of CLOSED) assert.ok(codes(r).includes(code), `${language}: ${code}`);
      assert.deepEqual(skipped(r), ['DQ001', 'DQ004', 'DQ005']);
      assert.ok(r.skippedMetrics.every(s => s.language === 'es'));
      assert.equal(r.total, 5);
    });
    it(`${language}: clean prose yields none of the four`, () => {
      const r = run({ 'README.md': `# T\n\n${ES_CLEAN}\n` }, { language });
      assert.deepEqual(codes(r).filter(c => CLOSED.includes(c)), []);
      assert.equal(r.passed, 5);
    });
  }
  it('DQ002 quotes Spanish pronouns', () => {
    const r = run({ 'README.md': `# T\n\n${ES_HEAVY}\n` }, { language: 'es' });
    assert.ok(r.findings.find(f => f.code === 'DQ002').message.includes('"esto/eso/este/ella"'));
  });
});

describe('overrides and configuration work as in English', () => {
  it('<!-- docguard:quality negation-load off --> silences DQ007 in a Portuguese document and still counts it as passed', () => {
    const body = `# T\n\n<!-- docguard:quality negation-load off — documento de segurança -->\n\n${PT_HEAVY}\n`;
    const r = run({ 'README.md': body }, { language: 'pt-BR' });
    assert.ok(!codes(r).includes('DQ007'));
    assert.ok(codes(r).includes('DQ008'));
    assert.equal(r.total, 5);
  });
  it('a numeric override raises the negation threshold', () => {
    const body = `# T\n\n<!-- docguard:quality negation-load 1 — operacional -->\n\n${ES_HEAVY}\n`;
    assert.ok(!codes(run({ 'README.md': body }, { language: 'es' })).includes('DQ007'));
  });
  it('a document named X.pt-BR.md under docs.language "en" is measured with the Portuguese lists', () => {
    const r = run({ 'docs-canonical/ARCHITECTURE.pt-BR.md': `# A\n\n${PT_HEAVY}\n` }, { language: 'en' });
    for (const code of CLOSED) assert.ok(codes(r).includes(code), code);
  });
});

describe('every other language stays skipped, English is untouched', () => {
  const DE = 'Das System liest die Konfigurationsdatei nicht und schreibt das Ergebnis nicht auf die Festplatte, wenn der Betreiber den Bericht nicht geprüft hat.\nDie Daten durchlaufen vor dem endgültigen Schreiben eine Prüfphase, und danach wird noch einmal geprüft, ob alles vollständig und richtig gespeichert wurde.\nDer Abschlussbericht listet alle gelesenen und alle geschriebenen Dateien des laufenden Tages auf, damit das Team sie am nächsten Morgen in Ruhe durchsehen kann.\n';
  for (const language of ['de', 'fr', 'it', 'ru']) {
    it(`${language}: the four metrics are skipped with language-not-supported, no number, no finding`, () => {
      const r = run({ 'README.md': `# T\n\n${DE}` }, { language });
      for (const code of CLOSED) {
        assert.ok(skipped(r).includes(code), `${language}: ${code} skipped`);
        assert.ok(!codes(r).includes(code));
      }
      assert.ok(r.skippedMetrics.every(s => s.reason === 'language-not-supported'));
      assert.equal(r.total, 1, 'only sentence length is judged');
    });
  }
  it('English prose (no docs.language, and "en") never reports a skip and is scored with the English lists', () => {
    const EN = 'This is not done unless the review passes. It was not stored when the check is skipped if the cache is cold. They said it never fails, and the logs are rotated daily and the data is archived weekly.\nWhen the operator is not present the pipeline waits until the queue is drained, unless the retry budget is exhausted.';
    for (const docs of [undefined, { language: 'en' }]) {
      const r = run({ 'README.md': `# T\n\n${EN}\n` }, docs);
      assert.equal(r.skippedMetrics, undefined);
      assert.equal(r.total, 8);
    }
  });
});
