/**
 * Spec 104, Stage 2 (T019): decision records in any language.
 *
 * The status words of the D2 table, a front-matter `status:` value and a status
 * cell normalize to the five ids (`proposed`, `accepted`, `rejected`,
 * `deprecated`, `superseded`) through the registry, extended by
 * `docs.labelAliases` and never replaced by it. The link words `Substitui` /
 * `Substituído por` (`Sustituye` / `Sustituido por`) build supersession links;
 * terminal words skip a record; DEC001's message lists the accepted words.
 *
 * Red on origin/main: everything that passes a language. Green on both sides by
 * design: the English-unchanged checks and the "no inference without a
 * language" checks.
 *
 * @req docguard.document-languages#FR-013
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { labelContext } from '../cli/shared-labels.mjs';
import { normalizeStatus, parseAdrFile, validateDecisionRecords } from '../cli/validators/decision-records.mjs';

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-dec-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const ctx = (language, labelAliases) => labelContext({ docs: { language, ...(labelAliases ? { labelAliases } : {}) } });
const codes = (result, code) => (result.findings || []).filter(f => f.code === code);
const all = result => (result.findings || []).map(f => `${f.code} ${f.message}`);
const adr = (n, status, extra = '') => `## ADR-${String(n).padStart(3, '0')}: decisao ${n}\n\n${status}\n${extra}\n`;

const WORDS = {
  pt: { proposed: ['proposto', 'proposta', 'rascunho'], accepted: ['aceito', 'aceita', 'aprovado', 'aprovada'], rejected: ['rejeitado', 'rejeitada', 'recusado'], deprecated: ['obsoleto', 'descontinuado', 'depreciado'], superseded: ['substituído', 'substituída', 'superado'] },
  es: { proposed: ['propuesto', 'propuesta', 'borrador'], accepted: ['aceptado', 'aceptada', 'aprobado', 'aprobada'], rejected: ['rechazado', 'rechazada'], deprecated: ['obsoleto', 'en desuso', 'deprecado'], superseded: ['sustituido', 'sustituida', 'reemplazado', 'superado'] },
};

describe('normalizeStatus resolves the status words of the D2 table (T019)', () => {
  for (const [language, byId] of Object.entries(WORDS)) {
    for (const [id, words] of Object.entries(byId)) {
      it(`${language}: ${words.join(', ')} are ${id}`, () => {
        const labels = ctx(language);
        for (const word of words) {
          for (const raw of [word, word.toUpperCase(), `✅ **${word[0].toUpperCase()}${word.slice(1)}**`, word.normalize('NFD').replace(/\p{M}+/gu, '')]) {
            assert.equal(normalizeStatus(raw, labels), id, `${language}: ${raw}`);
          }
        }
      });
    }
  }

  it('a multi-word alias (es "en desuso") is read whole, and a longer status line still resolves by its leading words', () => {
    assert.equal(normalizeStatus('En desuso desde 2026', ctx('es')), 'deprecated');
    assert.equal(normalizeStatus('Aceito em 2026-01-01', ctx('pt-BR')), 'accepted');
  });

  it('English words are always accepted, in every language', () => {
    assert.equal(normalizeStatus('Accepted', ctx('pt')), 'accepted');
    assert.equal(normalizeStatus('approved', ctx('es')), 'accepted');
    assert.equal(normalizeStatus('Accepted', ctx('de')), 'accepted');
  });

  it('docs.labelAliases extend the built-in set and never replace it', () => {
    const labels = ctx('pt-BR', { accepted: ['Vigente'], deprecated: ['Arquivado'] });
    assert.equal(normalizeStatus('Vigente', labels), 'accepted');
    assert.equal(normalizeStatus('Aceito', labels), 'accepted');
    assert.equal(normalizeStatus('Accepted', labels), 'accepted');
    assert.equal(normalizeStatus('Arquivado', labels), 'deprecated');
    assert.equal(normalizeStatus('Obsoleto', labels), 'deprecated');
  });

  it('an alias of one language is not read in another, and a word that is no status stays itself', () => {
    assert.equal(normalizeStatus('Aceito', ctx('es')), 'aceito');
    assert.equal(normalizeStatus('Feito', ctx('pt')), 'feito');
  });

  it('without a language nothing is inferred (the legacy words only)', () => {
    assert.equal(normalizeStatus('Aceito'), 'aceito');
    assert.equal(normalizeStatus('Aceito', null), 'aceito');
    assert.equal(normalizeStatus('Approved'), 'accepted');
  });
});

describe('the validator reads a Portuguese and a Spanish record set (T019)', () => {
  const PT = `# ADR\n\n${adr(1, '**Status**: Aceito')}${adr(2, '**Status:** Rejeitado')}${adr(3, '- Status: Proposto')}${adr(4, '| Status | Obsoleto |\n|---|---|')}${adr(5, '**Status**: ✅ Aprovada')}`;
  const ES = `# ADR\n\n${adr(1, '**Estado**: Aceptado')}${adr(2, '**Estado:** Rechazado')}${adr(3, '- Estado: Propuesto')}${adr(4, '| Estado | En desuso |\n|---|---|')}${adr(5, '**Status**: Aprobada')}`;

  it('pt-BR: no DEC001 for any of the five statuses; without docs.language each is reported', () => {
    const dir = project({ 'docs-canonical/ADR.md': PT }, { language: 'pt-BR' });
    assert.deepEqual(all(validateDecisionRecords(dir, loadConfig(dir))), []);
    const bare = project({ 'docs-canonical/ADR.md': PT });
    assert.equal(codes(validateDecisionRecords(bare, loadConfig(bare)), 'DEC001').length, 5);
  });

  it('es: the Estado label and the Spanish words are read', () => {
    const dir = project({ 'docs-canonical/ADR.md': ES }, { language: 'es' });
    assert.deepEqual(all(validateDecisionRecords(dir, loadConfig(dir))), []);
  });

  it('a Situação label reads under pt, and the project can add a label word through docs.labelAliases', () => {
    const dir = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(1, '**Situação**: Aceito')}${adr(2, '**Zustand**: accepted')}` }, { language: 'pt', labelAliases: { 'lifecycle-status': ['Zustand'] } });
    assert.deepEqual(all(validateDecisionRecords(dir, loadConfig(dir))), []);
  });

  it('a front-matter status: value goes through the same words (one file per decision)', () => {
    const dir = project({
      'docs/adr/0001-usar-x.md': '---\nstatus: aceito\n---\n# Usar X\n',
      'docs/adr/0002-usar-y.md': '---\nstatus: Obsoleto\n---\n# Usar Y\n',
      'docs/adr/0003-usar-z.md': '---\nstatus: propuesto\n---\n# Usar Z\n',
    }, { language: 'pt-BR', dirs: undefined });
    const r = validateDecisionRecords(dir, { ...loadConfig(dir), docs: { language: 'pt-BR', dirs: ['docs'] } });
    // `propuesto` is Spanish: the one finding proves the front matter is judged, in Portuguese only.
    assert.deepEqual(codes(r, 'DEC001').map(f => f.message.match(/ADR-\d+/)[0]), ['ADR-003']);
  });

  it('a status cell of the index is read, and DEC005 compares the ids', () => {
    const text = `# ADR\n\n${adr(1, '**Status**: Aceito')}${adr(2, '**Status**: Aceito')}\n| ID | Status |\n|---|---|\n| ADR-001 | Aceito |\n| ADR-002 | Rejeitado |\n`;
    const dir = project({ 'docs-canonical/ADR.md': text }, { language: 'pt-BR' });
    const r = validateDecisionRecords(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'DEC005').map(f => f.message), ['The index says ADR-002 is rejected; its record says accepted']);
    assert.deepEqual(codes(r, 'DEC001'), []);
  });
});

describe('the link words build supersession links (T019)', () => {
  const PAIR = (language) => language === 'es'
    ? `# ADR\n\n${adr(2, '**Estado**: Sustituido\n\nSustituido por ADR-003')}${adr(3, '**Estado**: Aceptado\n\nSustituye ADR-002')}`
    : `# ADR\n\n${adr(2, '**Status**: Substituído\n\nSubstituído por ADR-003')}${adr(3, '**Status**: Aceito\n\nSubstitui: ADR-002')}`;

  it('parseAdrFile: `Substituído por ADR-003` is a superseded-by link and NOT a supersedes link (substitui is a prefix of substituido)', () => {
    const { records } = parseAdrFile(PAIR('pt'), 'ADR.md', ctx('pt-BR'));
    const two = records.find(r => r.n === 2);
    const three = records.find(r => r.n === 3);
    assert.deepEqual(two.supersededBy, [3]);
    assert.deepEqual(two.supersedes, []);
    assert.deepEqual(three.supersedes, [2]);
    assert.deepEqual(three.supersededBy, []);
    assert.equal(two.status, 'superseded');
  });

  it('parseAdrFile reads the Spanish words and a front-matter link', () => {
    const { records } = parseAdrFile(PAIR('es'), 'ADR.md', ctx('es'));
    assert.deepEqual(records.find(r => r.n === 2).supersededBy, [3]);
    assert.deepEqual(records.find(r => r.n === 3).supersedes, [2]);
    const fm = parseAdrFile('---\nstatus: sustituido\nsustituido_por: adr-0003\n---\n# Usar Y\n', 'docs/adr/0001-usar-y.md', ctx('es'));
    assert.deepEqual(fm.records[0].supersededBy, [3]);
  });

  it('without a language the Portuguese words are ignored, as on origin/main', () => {
    const { records } = parseAdrFile(PAIR('pt'), 'ADR.md');
    assert.deepEqual(records.map(r => [r.supersedes, r.supersededBy]), [[[], []], [[], []]]);
  });

  it('a consistent pair raises nothing; a link to a missing record is DEC002; a one-way link is DEC003; a successor-less status is DEC004', () => {
    for (const [language, text] of [['pt-BR', PAIR('pt')], ['es', PAIR('es')]]) {
      const dir = project({ 'docs-canonical/ADR.md': text }, { language });
      assert.deepEqual(all(validateDecisionRecords(dir, loadConfig(dir))), [], language);
    }
    const missing = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(3, '**Status**: Aceito\n\nSubstitui ADR-099')}` }, { language: 'pt-BR' });
    assert.equal(codes(validateDecisionRecords(missing, loadConfig(missing)), 'DEC002').length, 1);
    const oneWay = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(2, '**Status**: Aceito')}${adr(3, '**Status**: Aceito\n\nSubstitui ADR-002')}` }, { language: 'pt-BR' });
    assert.equal(codes(validateDecisionRecords(oneWay, loadConfig(oneWay)), 'DEC003').length, 1);
    const noSuccessor = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(2, '**Status**: Substituído')}` }, { language: 'pt-BR' });
    assert.equal(codes(validateDecisionRecords(noSuccessor, loadConfig(noSuccessor)), 'DEC004').length, 1);
  });

  it('a status line that carries the link keeps working: "Status: Substituído, substituído por ADR-003"', () => {
    const text = `# ADR\n\n${adr(2, '**Status**: Substituído por ADR-003')}${adr(3, '**Status**: Aceito\n\nSubstitui ADR-002')}`;
    const dir = project({ 'docs-canonical/ADR.md': text }, { language: 'pt-BR' });
    assert.deepEqual(all(validateDecisionRecords(dir, loadConfig(dir))), []);
  });
});

describe('terminal words skip a record (T019)', () => {
  const spec = status => `# Feature\n\n${status}\n\n## Clarifications\n\n- Q: o que? → A:\n`;
  it('a Spec Kit spec whose Estado/Status is a terminal word has its open question skipped', () => {
    for (const [language, line] of [['pt-BR', '**Status**: Substituído'], ['pt-BR', '**Situação**: Obsoleto'], ['es', '**Estado**: En desuso'], ['es', '**Status**: Superado']]) {
      const dir = project({ 'specs/001-a/spec.md': spec(line) }, { language });
      assert.deepEqual(codes(validateDecisionRecords(dir, loadConfig(dir)), 'DEC006'), [], `${language}: ${line}`);
    }
  });
  it('a live spec keeps its DEC006, and without a language the Portuguese word skips nothing', () => {
    const live = project({ 'specs/001-a/spec.md': spec('**Status**: Ativo') }, { language: 'pt-BR' });
    assert.equal(codes(validateDecisionRecords(live, loadConfig(live)), 'DEC006').length, 1);
    const bare = project({ 'specs/001-a/spec.md': spec('**Status**: Substituído') });
    assert.equal(codes(validateDecisionRecords(bare, loadConfig(bare)), 'DEC006').length, 1);
  });
});

describe('DEC001 names the accepted words (T019)', () => {
  it('under a configured language the message lists the words of the language and the project aliases', () => {
    const dir = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(1, '**Status**: Concluído')}${adr(2, '**Status**: Vigente')}` }, { language: 'pt-BR', labelAliases: { accepted: ['Vigente'] } });
    const messages = codes(validateDecisionRecords(dir, loadConfig(dir)), 'DEC001').map(f => f.message);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /ADR-001 status "Concluído" is not proposed, accepted, rejected, deprecated or superseded/);
    for (const word of ['aceito', 'rejeitado', 'obsoleto', 'substituído', 'proposto', 'Vigente']) assert.match(messages[0], new RegExp(word), word);
  });

  it('a record with no status also names them', () => {
    const dir = project({ 'docs-canonical/ADR.md': '# ADR\n\n## ADR-001: sem estado\n\nTexto.\n' }, { language: 'es' });
    assert.match(codes(validateDecisionRecords(dir, loadConfig(dir)), 'DEC001')[0].message, /aceptado/);
  });

  it('English is unchanged: the legacy message, with no docs.language and with "en"', () => {
    for (const docs of [undefined, { language: 'en' }]) {
      const dir = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(1, '**Status**: Done')}` }, docs);
      assert.deepEqual(codes(validateDecisionRecords(dir, loadConfig(dir)), 'DEC001').map(f => f.message), ['ADR-001 status "Done" is not proposed, accepted, rejected, deprecated or superseded']);
    }
  });
});

describe('a language with no built-in set (T019)', () => {
  it('an unrecognized status is not judged: no DEC001, listed as not judged; English words and aliases are read', () => {
    const dir = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(1, '**Status**: Akzeptiert')}${adr(2, '**Status**: accepted')}` }, { language: 'de' });
    const r = validateDecisionRecords(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'DEC001'), []);
    assert.equal(r.unexaminedDocuments.length, 1);
    assert.equal(r.unexaminedDocuments[0].path, 'docs-canonical/ADR.md');
    assert.equal(r.unexaminedDocuments[0].cause, 'language-not-supported');
    const aliased = project({ 'docs-canonical/ADR.md': `# ADR\n\n${adr(1, '**Status**: Akzeptiert')}` }, { language: 'de', labelAliases: { accepted: ['Akzeptiert'] } });
    assert.deepEqual(validateDecisionRecords(aliased, loadConfig(aliased)).unexaminedDocuments ?? [], []);
  });
});
