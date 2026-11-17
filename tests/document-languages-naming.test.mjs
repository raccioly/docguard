/**
 * Spec 104, Stage 3: a document's language comes from its name, never its text.
 *
 * With `docs.language` set, `<name>.<lang>.md`, an `i18n/<lang>/` segment or a
 * `locales/<lang>/` segment gives one document its own language, for labels and
 * for text metrics. The language is never read from content, nothing is inferred
 * without `docs.language`, and an agent-instruction file gets no language at all
 * (Decision 5 and Decision 6).
 *
 * Every test here was red on origin/main (the module and the behavior are new),
 * except the negative ones, which are guards.
 *
 * @req docguard.document-languages#FR-021
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { languageFromNaming } from '../cli/shared-labels.mjs';
import { documentLanguage } from '../cli/shared-doc-language.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { validateDocQuality } from '../cli/validators/doc-quality.mjs';

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-naming-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const codes = (result, code) => (result.findings || []).filter(f => f.code === code);
const PROSE = '\nParagrafo um de texto real que descreve a coisa.\nParagrafo dois de texto real que descreve a coisa.\nParagrafo tres de texto real que descreve a coisa.\nParagrafo quatro de texto real que descreve a coisa.\nParagrafo cinco de texto real que descreve a coisa.\nParagrafo seis de texto real que descreve a coisa.\n';
const PT_ARCH = `# Arquitetura\n\n## Visão geral do sistema\n${PROSE}\n## Mapa de componentes\n\nx\n\n## Pilha tecnológica\n\nNode\n`;
const PT_PROSE = 'O sistema lê o arquivo de configuração e grava o resultado no disco.\nO operador revisa o relatório gerado pelo fluxo todos os dias.\nA equipe guarda os registros em um diretório separado do código.\nCada módulo tem um responsável e um revisor definidos no início.\nOs dados passam por uma etapa de validação antes da gravação final.\nO relatório final lista os arquivos lidos e os arquivos gravados hoje.\n';
const EN_PROSE = 'The loader reads the configuration file and writes the result to the disk.\nThe operator reviews the report that the pipeline generates every day.\nThe team keeps the logs in a directory that is separate from the code.\nEach module has an owner and a reviewer who were named at the start.\nThe data passes through a validation step before the final write.\nThe final report lists the files that were read and the files that were written.\n';

describe('T028: the name of a document gives its language', () => {
  it('reads <name>.<lang>.md, an i18n/<lang>/ segment and a locales/<lang>/ segment', () => {
    assert.equal(languageFromNaming('docs-canonical/ARCHITECTURE.pt-BR.md'), 'pt-BR');
    assert.equal(languageFromNaming('README.es.md'), 'es');
    assert.equal(languageFromNaming('docs/i18n/pt-BR/ARCHITECTURE.md'), 'pt-BR');
    assert.equal(languageFromNaming('docs/locales/es/guide/SETUP.md'), 'es');
    assert.equal(languageFromNaming('docs-canonical/ARCHITECTURE.zh-Hans.md'), 'zh-Hans');
    assert.equal(languageFromNaming('docs/ARCHITECTURE.en.md'), 'en');
  });

  it('is deliberate: a dotted suffix that is not a language tag is not one (guard)', () => {
    for (const name of ['README.old.md', 'ARCHITECTURE.api.md', 'TEST-SPEC.dev.md', 'docs/v1.2.md', 'NOTES.in.md', 'a.xx.md', 'ARCHITECTURE.md', 'docs/i18n/xx/A.md', 'docs/i18n/A.md', 'i18n.md']) {
      assert.equal(languageFromNaming(name), null, name);
    }
  });

  it('a path segment must be a folder, not the file name: docs/es.md is a file', () => {
    assert.equal(languageFromNaming('docs/locales/es.md'), null);
  });

  it('the language of a document in a project without docs.language is nothing: no inference (guard)', () => {
    assert.equal(documentLanguage({}, 'docs-canonical/ARCHITECTURE.pt-BR.md'), null);
    assert.equal(documentLanguage({ docs: {} }, 'docs/i18n/pt-BR/A.md'), null);
  });

  it('with docs.language "en", the name overrides it for that document and for no other', () => {
    const config = { docs: { language: 'en' } };
    assert.equal(documentLanguage(config, 'docs-canonical/ARCHITECTURE.pt-BR.md').language, 'pt');
    assert.equal(documentLanguage(config, 'docs-canonical/ARCHITECTURE.pt-BR.md').builtin, true);
    assert.equal(documentLanguage(config, 'docs/locales/es/A.md').language, 'es');
    assert.equal(documentLanguage(config, 'docs-canonical/ARCHITECTURE.md').language, 'en');
    assert.equal(documentLanguage({ docs: { language: 'pt-BR' } }, 'docs/ARCHITECTURE.en.md').unicode, false, 'X.en.md is English in a pt project');
  });

  it('an agent-instruction file gets no language, whatever its name or docs.language (Decision 6)', () => {
    for (const rel of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', 'docs/i18n/pt-BR/AGENTS.md']) {
      assert.equal(documentLanguage({ docs: { language: 'de' } }, rel), null, rel);
    }
  });

  it('the project aliases of docs.labelAliases follow the document into its own language', () => {
    const ctx = documentLanguage({ docs: { language: 'en', labelAliases: { 'system-overview': ['Panorama geral'] } } }, 'docs/ARCHITECTURE.pt-BR.md');
    assert.deepEqual(ctx.project['system-overview'], ['Panorama geral']);
  });
});

describe('T028: labels resolve with the document\'s own set', () => {
  const controlRole = (rel, language = 'en') => project({ [rel]: PT_ARCH }, { language, roles: { architecture: rel } });

  for (const rel of ['docs/ARCHITECTURE.pt-BR.md', 'docs/i18n/pt-BR/ARCHITECTURE.md', 'docs/locales/pt-BR/ARCHITECTURE.md']) {
    it(`docs.language "en" and ${rel}: the Portuguese headings satisfy STR003`, () => {
      const dir = controlRole(rel);
      assert.deepEqual(codes(validateDocSections(dir, loadConfig(dir)), 'STR003').map(f => f.message), []);
    });
  }

  it('the same Portuguese headings in a file with no language name still report STR003 (guard)', () => {
    const dir = controlRole('docs/handbook/ARCHITECTURE.md');
    assert.ok(codes(validateDocSections(dir, loadConfig(dir)), 'STR003').length > 0);
  });

  it('without docs.language nothing is inferred: the translated file reports STR003 as before (guard)', () => {
    const dir = project({ 'docs/i18n/pt-BR/ARCHITECTURE.md': PT_ARCH }, undefined);
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ docs: { roles: { architecture: 'docs/i18n/pt-BR/ARCHITECTURE.md' } } }));
    assert.ok(codes(validateDocSections(dir, loadConfig(dir)), 'STR003').length > 0);
  });

  it('a file named .de.md has the language de: no STR003, and the document is listed as unsupported', () => {
    const rel = 'docs/ARCHITECTURE.de.md';
    const dir = project({ [rel]: `# Architektur\n\n## Systemübersicht\n${PROSE}\n## Komponenten\n\nx\n\n## Technologien\n\nNode\n` }, { language: 'en', roles: { architecture: rel } });
    const r = validateDocSections(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'STR003'), []);
    assert.deepEqual((r.unexaminedDocuments || []).map(d => [d.path, d.cause]), [[rel, 'language-not-supported']]);
  });
});

describe('T028: text metrics skip a document by its own language', () => {
  const skipped = r => (r.skippedMetrics || []).map(s => `${s.document.split('/').pop()}:${s.code}`).sort();

  it('docs.language "en": X.pt-BR.md skips three metrics (passive voice, Flesch), the English document beside it runs all eight', () => {
    const dir = project({
      'docs-canonical/ARCHITECTURE.md': `# A\n\n${EN_PROSE}`,
      'docs-canonical/ARCHITECTURE.pt-BR.md': `# A\n\n${PT_PROSE}`,
      'docs-canonical/i18n/pt-BR/SECURITY.md': `# S\n\n${PT_PROSE}`,
    }, { language: 'en' });
    const r = validateDocQuality(dir, loadConfig(dir));
    assert.equal(skipped(r).filter(s => s.startsWith('ARCHITECTURE.md:')).length, 0);
    assert.equal(skipped(r).filter(s => s.startsWith('ARCHITECTURE.pt-BR.md:')).length, 3);
    assert.equal(skipped(r).filter(s => s.startsWith('SECURITY.md:')).length, 3);
    assert.equal(r.total, 8 + 5 + 5, 'eight for the English document, five (sentence length and the four reviewed metrics) for each translation');
  });

  it('content never changes the language: Portuguese prose in a plain file is scored as English', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': `# A\n\n${PT_PROSE}` }, { language: 'en' });
    const r = validateDocQuality(dir, loadConfig(dir));
    assert.equal(r.skippedMetrics, undefined);
    assert.equal(r.total, 8);
  });

  it('without docs.language nothing is inferred: X.pt-BR.md is scored as English (guard)', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.pt-BR.md': `# A\n\n${PT_PROSE}` });
    const r = validateDocQuality(dir, loadConfig(dir));
    assert.equal(r.skippedMetrics, undefined);
    assert.equal(r.total, 8);
  });

  it('a README with an unsupported-language name is skipped; AGENTS.md is not a Doc-Quality document at all', () => {
    const dir = project({ 'README.md': `# R\n\n${EN_PROSE}`, 'AGENTS.md': `# Agents\n\n${EN_PROSE}` }, { language: 'de' });
    const r = validateDocQuality(dir, loadConfig(dir));
    assert.deepEqual([...new Set((r.skippedMetrics || []).map(s => s.document))], ['README.md']);
  });
});
