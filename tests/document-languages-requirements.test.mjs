/**
 * Spec 104, Stage 2 (T021): a translated template row is a placeholder.
 *
 * `O sistema DEVE [capacidade]` and `El sistema DEBE [capacidad]` carry the
 * scaffold sentence shape of their language (modal verbs `deve`, `devem`, `pode`,
 * `deverá`; `debe`, `deben`, `puede`), so with `docs.language` set they are
 * placeholders and not requirements. A filled row is a requirement; English is
 * unchanged.
 *
 * Red on origin/main: every test that passes a language. Green on both sides by
 * design: the English rows, and the checks that no language means no inference.
 *
 * @req docguard.document-languages#FR-016
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { labelContext } from '../cli/shared-labels.mjs';
import { classifyRequirementIds, hasPlaceholderSlot, isPlaceholderRequirement } from '../cli/shared-requirement-ids.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';

const def = text => ({ id: 'FR-001', text: `- **FR-001**: ${text}`, file: 'docs-canonical/REQUIREMENTS.md' });
const ctx = language => labelContext({ docs: { language } });

const PT_TEMPLATE = ['O sistema DEVE [capacidade]', 'Os usuários DEVEM [ação]', 'O sistema DEVERÁ [capacidade]', 'O sistema PODE [capacidade]', 'Os módulos DEVEM {{comportamento}}', 'DEVE [capacidade]', 'Cada usuário DEVE <ação>'];
const ES_TEMPLATE = ['El sistema DEBE [capacidad]', 'Los usuarios DEBEN [acción]', 'El sistema PUEDE [capacidad]', 'El sistema debe [capacidad]'];
const PT_REAL = ['O sistema DEVE validar a entrada antes de gravar.', 'O exportador DEVE gravar [arquivo] no diretório de saída.', 'O sistema DEVE [capacidade] e registrar cada falha em auditoria.'];
const ES_REAL = ['El sistema DEBE validar la entrada antes de guardar.', 'El exportador DEBE escribir [archivo] en el directorio de salida.'];

describe('a translated template row is a placeholder under its language (T021)', () => {
  it('pt: the scaffold shapes with a slot are placeholders, with and without region', () => {
    for (const language of ['pt', 'pt-BR', 'pt-PT']) for (const text of PT_TEMPLATE) {
      assert.equal(hasPlaceholderSlot(def(text), ctx(language)), true, `${language}: ${text}`);
      assert.equal(isPlaceholderRequirement(def(text), ctx(language)), true, `${language}: ${text}`);
    }
  });

  it('es: the scaffold shapes with a slot are placeholders', () => {
    for (const language of ['es', 'es-MX']) for (const text of ES_TEMPLATE) {
      assert.equal(hasPlaceholderSlot(def(text), ctx(language)), true, `${language}: ${text}`);
      assert.equal(isPlaceholderRequirement(def(text), ctx(language)), true, `${language}: ${text}`);
    }
  });

  it('a filled row, or a row that states something without its slot, is a requirement', () => {
    for (const text of PT_REAL) assert.equal(isPlaceholderRequirement(def(text), ctx('pt-BR')), false, text);
    for (const text of ES_REAL) assert.equal(isPlaceholderRequirement(def(text), ctx('es')), false, text);
  });

  it('a table row picks the cell that carries the modal verb', () => {
    const row = { id: 'FR-001', text: '| FR-001 | O sistema DEVE [capacidade] | Alta |', file: 'docs-canonical/REQUIREMENTS.md' };
    assert.equal(hasPlaceholderSlot(row, ctx('pt-BR')), true);
  });

  it('a slot inside inline code is code, as in English', () => {
    assert.equal(hasPlaceholderSlot(def('O sistema DEVE aceitar `[capacidade]` como entrada.'), ctx('pt')), false);
  });

  it('the language of one project does not read the other: pt does not read DEBE, es does not read DEVE', () => {
    assert.equal(hasPlaceholderSlot(def('El sistema DEBE [capacidad]'), ctx('pt')), false);
    assert.equal(hasPlaceholderSlot(def('O sistema DEVE [capacidade]'), ctx('es')), false);
  });

  it('a language with no built-in set changes nothing', () => {
    assert.equal(hasPlaceholderSlot(def('O sistema DEVE [capacidade]'), ctx('de')), false);
  });

  it('without a language nothing is inferred (the legacy shapes only)', () => {
    assert.equal(hasPlaceholderSlot(def('O sistema DEVE [capacidade]')), false);
    assert.equal(hasPlaceholderSlot(def('O sistema DEVE [capacidade]'), null), false);
  });
});

describe('English is unchanged (T021, T024)', () => {
  const ENGLISH = [['The system MUST [capability]', true], ['Users MUST be able to [action]', true], ['The system SHOULD support [thing]', true], ['The exporter MUST write {file} to the output directory.', false], ['The system MUST validate input.', false]];
  for (const [label, labels] of [['no language', null], ['pt', ctx('pt-BR')], ['es', ctx('es')], ['en', ctx('en')], ['de', ctx('de')]]) {
    it(`${label}: the English rows are judged as before`, () => {
      for (const [text, expected] of ENGLISH) assert.equal(hasPlaceholderSlot(def(text), labels), expected, `${label}: ${text}`);
    });
  }
});

describe('the validators count a translated template row as no requirement (T021)', () => {
  const REQS = '# Requisitos\n\n- **FR-001**: O sistema DEVE [capacidade]\n- **FR-002**: Os usuários DEVEM [ação]\n- **FR-003**: O sistema DEVE validar a entrada.\n';
  function project(docs) {
    const dir = makeTempDir('docguard-lang-req-');
    const files = { 'docs-canonical/REQUIREMENTS.md': REQS, 'src/a.js': '// @req FR-003\nexport const a = 1;\n', ...(docs ? { '.docguard.json': JSON.stringify({ docs }) } : {}) };
    for (const [rel, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); }
    return dir;
  }
  const classify = (dir, labels) => classifyRequirementIds([...[1, 2, 3].map(n => ({ id: `FR-00${n}`, text: REQS.split('\n').find(l => l.includes(`FR-00${n}`)), file: 'docs-canonical/REQUIREMENTS.md' }))], { labels });

  it('classifyRequirementIds splits two placeholders from one requirement under pt-BR', () => {
    const labels = ctx('pt-BR');
    const { requirements, placeholders } = classify(null, labels);
    assert.deepEqual(requirements.map(r => r.id), ['FR-003']);
    assert.equal(placeholders, 2);
    const bare = classify(null, null);
    assert.equal(bare.requirements.length, 3);
  });

  it('Traceability reports the placeholders as skipped, not as requirements without a test', () => {
    const withDir = project({ language: 'pt-BR' });
    const withoutDir = project();
    const withLanguage = validateTraceability(withDir, loadConfig(withDir));
    const without = validateTraceability(withoutDir, loadConfig(withoutDir));
    // FR-003 is a real requirement and keeps its own finding; the two template rows are the ones that move.
    const uncovered = result => (result.findings || []).filter(f => f.code === 'TRC004').map(f => f.message.match(/FR-\d+/)[0]).filter(id => id !== 'FR-003');
    assert.deepEqual(uncovered(without).sort(), ['FR-001', 'FR-002']);
    assert.deepEqual(uncovered(withLanguage), []);
  });
});
