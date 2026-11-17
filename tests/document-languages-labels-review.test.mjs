/**
 * Spec 104, T044: the Portuguese and Spanish label sets after the native-speaker
 * review of 2026-11-17 (spec Decision 11). Every changed first alias and every
 * added variant satisfies its id under its language, the old first aliases are
 * still accepted, and a Spec Kit requirement marker (`*(obrigatório)*`) is not
 * part of a heading's label.
 *
 * @req docguard.document-languages#FR-006
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { docHasSection } from '../cli/shared.mjs';
import { LABELS, aliasesFor, firstAlias, foldHeading, labelContext, statusIdFor, unreleasedState } from '../cli/shared-labels.mjs';
import { parseLifecycleStatus } from '../cli/scanners/lifecycle-status.mjs';

const ctx = tag => labelContext({ docs: { language: tag } });
const entry = id => LABELS.find(l => l.id === id);

// id -> the forms the review changed or added (✏️ new first aliases and ➕ variants), per language.
const REVIEWED = {
  pt: {
    'tech-stack': ['Stack tecnológica', 'Stack tecnológico', 'Stack de tecnologia'],
    'layer-boundaries': ['Fronteiras entre camadas'],
    'external-dependencies': ['Dependências externas'],
    'revision-history': ['Histórico de revisões', 'Histórico de alterações'],
    relationships: ['Relações'],
    'secrets-management': ['Gestão de credenciais'],
    'security-boundaries': ['Limites de segurança'],
    'test-categories': ['Categorias de testes', 'Tipos de teste', 'Tipos de testes'],
    'test-commands': ['Comandos de testes'],
    'source-to-test-map': ['Mapa de código para testes', 'Mapa do código-fonte para testes'],
    'setup-steps': ['Configuração'],
    'configuration-files': ['Ficheiros de configuração'],
    usage: ['Utilização'],
    contributing: ['Contribuição', 'Contribuições'],
    'user-scenarios': ['Cenários de usuário e testes', 'Cenários de uso'],
    'success-criteria': ['Critérios de aceitação'],
    fix: ['Solução'],
    proposed: ['em análise'],
    rejected: ['recusada'],
    deprecated: ['obsoleta', 'descontinuada'],
    superseded: ['superada'],
    'superseded-by': ['Substituída por'],
    'lifecycle-status': ['Estado'],
  },
  es: {
    'tech-stack': ['Tecnologías utilizadas'],
    'external-dependencies': ['Dependencias externas'],
    'revision-history': ['Historial de revisiones', 'Historial de cambios'],
    'secrets-management': ['Manejo de secretos'],
    'test-categories': ['Tipos de pruebas'],
    'test-commands': ['Comandos de pruebas'],
    'source-to-test-map': ['Mapa de código fuente a pruebas'],
    'setup-steps': ['Configuración'],
    prerequisites: ['Prerrequisitos'],
    contributing: ['Contribuciones'],
    'user-scenarios': ['Escenarios de uso', 'Escenarios de usuario y pruebas'],
    fix: ['Solución'],
    unreleased: ['Por publicar'],
    deprecated: ['obsoleta'],
    superseded: ['reemplazada', 'superada'],
    supersedes: ['Reemplaza'],
    'superseded-by': ['Reemplazado por', 'Sustituida por'],
  },
};
const TAG = { pt: 'pt-BR', es: 'es' };

/** Whether `text`, written as a label of `id`, is read as that id in the language. */
function satisfies(id, text, context) {
  const e = entry(id);
  if (e.kind === 'heading') {
    if (id === 'unreleased') return unreleasedState(`# Log\n\n## [${text}]\n`, context) === 'present';
    return docHasSection(`# Doc\n\n## ${text}\n\nTexto.\n`, `## ${e.en[0]}`, context);
  }
  if (e.group === 'decision-status') return statusIdFor(text, context) === id;
  if (id === 'lifecycle-status') return parseLifecycleStatus(`# T\n\n${text}: Obsoleto\n`, context) === 'Obsoleto';
  return aliasesFor(id, context).map(foldHeading).includes(foldHeading(text));
}

describe('the reviewed label sets (spec 104, Decision 11)', () => {
  for (const lang of ['pt', 'es']) {
    it(`${lang}: every changed first alias and added variant satisfies its id`, () => {
      const context = ctx(TAG[lang]);
      let n = 0;
      for (const [id, forms] of Object.entries(REVIEWED[lang])) {
        for (const text of forms) {
          n++;
          assert.ok(satisfies(id, text, context), `${lang}: "${text}" does not satisfy ${id}`);
          // Case and accents are folded, as for every alias.
          assert.ok(satisfies(id, text.toUpperCase(), context), `${lang}: "${text.toUpperCase()}" does not satisfy ${id}`);
        }
      }
      assert.equal(n, Object.values(REVIEWED[lang]).flat().length);
    });
  }

  it('pt: the three generated headings changed their first alias and the old forms stay accepted', () => {
    const context = ctx('pt-BR');
    const CHANGED = [
      ['tech-stack', 'Stack tecnológica', 'Pilha tecnológica'],
      ['source-to-test-map', 'Mapa de código para testes', 'Mapa de fontes para testes'],
      ['security-boundaries', 'Limites de segurança', 'Fronteiras de segurança'],
    ];
    for (const [id, now, before] of CHANGED) {
      assert.equal(firstAlias(id, context), now);
      assert.ok(entry(id).pt.includes(before), `${before} is still listed`);
      assert.ok(satisfies(id, before, context), `${before} still satisfies ${id}`);
    }
  });

  it('every added variant is a new alias and no first alias changed in es', () => {
    for (const lang of ['pt', 'es']) {
      for (const [id, forms] of Object.entries(REVIEWED[lang])) {
        for (const text of forms) assert.ok(entry(id)[lang].includes(text), `${lang}.${id} lists "${text}"`);
      }
    }
    assert.equal(firstAlias('tech-stack', ctx('es')), 'Stack tecnológico');
  });

  it('the old English labels are untouched', () => {
    assert.deepEqual(entry('tech-stack').en, ['Tech Stack']);
    assert.deepEqual(entry('source-to-test-map').en, ['Source-to-Test Map', 'Service-to-Test Map']);
  });
});

describe('a Spec Kit requirement marker is not part of a heading (spec 104, FR-006)', () => {
  const doc = heading => `# Especificação\n\n${heading}\n\nTexto.\n`;

  it('pt-BR: the translated Spec Kit template headings satisfy their ids', () => {
    const c = ctx('pt-BR');
    assert.ok(docHasSection(doc('## Requisitos funcionais *(obrigatório)*'), '## Requirements', c));
    assert.ok(docHasSection(doc('## Cenários de usuário e testes *(obrigatório)*'), '## User Scenarios', c));
    assert.ok(docHasSection(doc('## Critérios de sucesso *(obrigatório)*'), '## Success Criteria', c));
    assert.ok(docHasSection(doc('## Requisitos *(opcional)*'), '## Requirements', c));
  });

  it('es: the translated Spec Kit template headings satisfy their ids', () => {
    const c = ctx('es');
    assert.ok(docHasSection(doc('## Requisitos *(obligatorio)*'), '## Requirements', c));
    assert.ok(docHasSection(doc('## Escenarios de usuario y pruebas *(obligatorio)*'), '## User Scenarios', c));
    assert.ok(docHasSection(doc('## Requisitos funcionales *(obligatoria)*'), '## Requirements', c));
  });

  it('the marker reads with or without emphasis, in any case and accent, and with a section number', () => {
    const c = ctx('pt-BR');
    for (const heading of ['## Requisitos (obrigatório)', '## Requisitos _(Obrigatória)_', '## Requisitos **(OBRIGATORIO)**', '## 2. Requisitos *(mandatory)*', '## Requisitos *( opcional )*', '## Requisitos *(optional)*']) {
      assert.ok(docHasSection(doc(heading), '## Requirements', c), heading);
    }
  });

  it('only one trailing marker of the closed list is dropped; any other parenthetical stays part of the heading', () => {
    const c = ctx('pt-BR');
    for (const heading of ['## Requisitos (versão 2)', '## Requisitos (obrigatório) extra', '## (obrigatório) Requisitos', '## Requisitos (obrigatório) (versão 2)', '## Requisitos (talvez)']) {
      assert.ok(!docHasSection(doc(heading), '## Requirements', c), heading);
    }
    assert.equal(foldHeading('## Requisitos (versão 2)'), 'requisitos versao 2');
    assert.equal(foldHeading('## Requisitos *(obrigatório)*'), 'requisitos');
  });

  it('English results do not change: the marker never mattered, with or without a language', () => {
    for (const c of [null, ctx('en')]) {
      assert.ok(docHasSection(doc('## User Scenarios & Testing *(mandatory)*'), '## User Scenarios', c));
      assert.ok(docHasSection(doc('## Requirements *(mandatory)*'), '## Requirements', c));
      assert.ok(!docHasSection(doc('## Requisitos *(obrigatório)*'), '## Requirements', c), 'no language, no Portuguese');
    }
  });
});
