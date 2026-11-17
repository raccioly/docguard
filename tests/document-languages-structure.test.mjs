/**
 * Spec 104, Stage 1: required sections in any language.
 *
 * A heading satisfies a section id through, in this order: the language-neutral
 * marker `<!-- docguard:heading <id> -->` on the next non-blank line, the English
 * label or synonym as today, an alias of `docs.language`, an alias of
 * `docs.labelAliases`. STR003, ENV001, ENV002, DCV005, Test-Spec and the Score
 * read one resolver; STR009 reports a misused marker.
 *
 * Every test here was red on origin/main (T004 to T008, T010). The English side
 * (T009) is pinned in document-languages-english-identity.test.mjs.
 *
 * @req docguard.document-languages#FR-004
 * @req docguard.document-languages#FR-005
 * @req docguard.document-languages#FR-006
 * @req docguard.document-languages#FR-008
 * @req docguard.document-languages#FR-009
 * @req docguard.document-languages#FR-010
 * @req docguard.document-languages#FR-011
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { docHasSection } from '../cli/shared.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';

const CLI = resolve('cli/docguard.mjs');
const PROSE = '\nParagrafo um de texto real que descreve a coisa.\nParagrafo dois de texto real que descreve a coisa.\nParagrafo tres de texto real que descreve a coisa.\nParagrafo quatro de texto real que descreve a coisa.\nParagrafo cinco de texto real que descreve a coisa.\nParagrafo seis de texto real que descreve a coisa.\n';

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-structure-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const configFor = docs => ({ docs });
const codes = (result, code) => (result.findings || []).filter(f => f.code === code);

/** Portuguese canonical documents, each heading a built-in alias of the D2 table. */
const PT = {
  'docs-canonical/ARCHITECTURE.md': `# Arquitetura\n\n## Visão geral do sistema\n${PROSE}\n## Mapa de componentes\n\n| Módulo | Papel |\n|---|---|\n| cli | entrada |\n\n## Pilha tecnológica\n\nNode.js.\n`,
  'docs-canonical/DATA-MODEL.md': `# Modelo\n\n## Entidades\n${PROSE}`,
  'docs-canonical/SECURITY.md': `# Segurança\n\n## Autenticação\n${PROSE}\n## Gerenciamento de segredos\n\nNo cofre.\n`,
  'docs-canonical/TEST-SPEC.md': `# Testes\n\n## Categorias de teste\n${PROSE}\n## Regras de cobertura\n\n80 por cento.\n`,
  'docs-canonical/ENVIRONMENT.md': `# Ambiente\n\n## Passos de configuração\n${PROSE}\n## Variáveis de ambiente\n\n| Nome | Uso |\n|---|---|\n| PORT | porta |\n`,
};
const ES = {
  'docs-canonical/ARCHITECTURE.md': `# Arquitectura\n\n## Visión general del sistema\n${PROSE}\n## Mapa de componentes\n\n| Módulo | Papel |\n|---|---|\n| cli | entrada |\n\n## Stack tecnológico\n\nNode.js.\n`,
  'docs-canonical/DATA-MODEL.md': `# Modelo\n\n## Entidades\n${PROSE}`,
  'docs-canonical/SECURITY.md': `# Seguridad\n\n## Autenticación\n${PROSE}\n## Gestión de secretos\n\nEn la bóveda.\n`,
  'docs-canonical/TEST-SPEC.md': `# Pruebas\n\n## Categorías de pruebas\n${PROSE}\n## Reglas de cobertura\n\n80 por ciento.\n`,
  'docs-canonical/ENVIRONMENT.md': `# Entorno\n\n## Pasos de configuración\n${PROSE}\n## Variables de entorno\n\n| Nombre | Uso |\n|---|---|\n| PORT | puerto |\n`,
};

describe('T004: a built-in alias satisfies its id (pt-BR, es, es-MX)', () => {
  for (const [tag, files] of [['pt-BR', PT], ['pt', PT], ['pt-PT', PT], ['es', ES], ['es-MX', ES]]) {
    it(`docs.language ${tag}: no STR003, ENV001 or ENV002 for the D2 headings`, () => {
      const dir = project(files);
      const config = configFor({ language: tag });
      const sections = validateDocSections(dir, config);
      assert.deepEqual(codes(sections, 'STR003').map(f => f.message), []);
      const env = validateEnvironment(dir, config);
      assert.deepEqual(codes(env, 'ENV001').concat(codes(env, 'ENV002')).map(f => f.message), []);
    });
  }

  it('without docs.language the same Portuguese documents still report STR003 (nothing is inferred)', () => {
    const dir = project(PT);
    assert.ok(codes(validateDocSections(dir, {}), 'STR003').length > 0);
  });

  it('folds accents and drops a leading section number', async () => {
    const { labelContext } = await import('../cli/shared-labels.mjs');
    const ctx = labelContext(configFor({ language: 'pt-BR' }));
    for (const heading of ['## Visao geral do sistema', '## VISÃO GERAL DO SISTEMA', '## 2. Visão geral do sistema', '### 5.4 Visão geral']) {
      assert.ok(docHasSection(`# T\n\n${heading}\n\ntexto\n`, '## System Overview', ctx), heading);
    }
  });

  it('English headings are always accepted, so a mixed document passes', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': `# Arq\n\n## System Overview\n${PROSE}\n## Mapa de componentes\n\nx\n\n## Tech Stack\n\nNode\n` });
    assert.deepEqual(codes(validateDocSections(dir, configFor({ language: 'pt-BR' })), 'STR003').map(f => f.message), []);
  });

  it('every alias of the D2 table satisfies its id, whole heading only', async () => {
    const { LABELS, labelContext } = await import('../cli/shared-labels.mjs');
    for (const entry of LABELS.filter(e => e.kind === 'heading')) {
      for (const lang of ['pt', 'es']) {
        const ctx = labelContext({ docs: { language: lang } });
        for (const alias of entry[lang]) {
          assert.ok(docHasSection(`# T\n\n## ${alias}\n\ntexto\n`, `## ${entry.en[0]}`, ctx), `${lang}: ${alias} -> ${entry.id}`);
        }
      }
    }
    const ctx = labelContext({ docs: { language: 'pt' } });
    assert.ok(!docHasSection('# T\n\n## Visão sobre outra coisa\n', '## System Overview', ctx), 'an alias is a whole heading, not a substring');
  });
});

describe('T005: the heading marker satisfies an id in any language', () => {
  const DE = (marker = '<!-- docguard:heading system-overview -->') => ({
    'docs-canonical/ARCHITECTURE.md': `# Architektur\n\n## Systemübersicht\n${marker}\n${PROSE}\n## Komponenten\n<!-- docguard:heading component-map -->\n\nx\n\n## Technologien\n<!-- docguard:heading tech-stack -->\n\nNode\n`,
  });

  it('docs.language "de" with a marker under every required heading: no STR003, and the document is judged', () => {
    const dir = project(DE(), { language: 'de' });
    const r = validateDocSections(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'STR003'), []);
    assert.equal(r.passed, 3);
    assert.deepEqual(r.unexaminedDocuments ?? [], []);
  });

  it('a marker satisfies its id with no docs.language at all (a marker is explicit)', () => {
    const dir = project(DE());
    assert.deepEqual(codes(validateDocSections(dir, {}), 'STR003'), []);
  });

  it('the marker may follow blank lines, but must be the next non-blank line', () => {
    assert.ok(docHasSection('## Systemübersicht\n\n\n<!-- docguard:heading system-overview -->\n', '## System Overview'));
    assert.ok(!docHasSection('## Systemübersicht\nsome prose first\n<!-- docguard:heading system-overview -->\n', '## System Overview'));
  });

  it('a marker inside a code fence or a larger comment block satisfies nothing', () => {
    assert.ok(!docHasSection('## Systemübersicht\n```\n<!-- docguard:heading system-overview -->\n```\n', '## System Overview'));
    assert.ok(!docHasSection('<!--\n## Systemübersicht\n<!-- docguard:heading system-overview -->\n-->\n', '## System Overview'));
    assert.ok(!docHasSection('```md\n## Systemübersicht\n<!-- docguard:heading system-overview -->\n```\n', '## System Overview'));
  });

  it('the marker wins over the heading text: the label of another id stays unsatisfied', () => {
    const content = '## Tech Stack\n<!-- docguard:heading entities -->\n\ntext\n';
    assert.ok(docHasSection(content, '## Entities'));
    assert.ok(!docHasSection(content, '## Tech Stack'));
  });

  it('an unknown id satisfies nothing, and the heading keeps its own text', () => {
    const content = '## System Overview\n<!-- docguard:heading system-overveiw -->\n';
    assert.ok(docHasSection(content, '## System Overview'), 'the English heading still counts');
    assert.ok(!docHasSection('## Systemübersicht\n<!-- docguard:heading system-overveiw -->\n', '## System Overview'));
  });

  it('the N/A marker and the heading marker for one id do not conflict', () => {
    const dir = project({
      'docs-canonical/SECURITY.md': `# Sicherheit\n\n## Authentifizierung\n<!-- docguard:heading authentication -->\n${PROSE}\n<!-- docguard:section authentication n/a — redundant on purpose -->\n<!-- docguard:section secrets-management n/a — nothing secret here -->\n`,
    });
    assert.deepEqual(codes(validateDocSections(dir, {}), 'STR003'), []);
  });
});

describe('T006: Test-Spec, DCV005 and the Score read the same headings', () => {
  const TEST_FILES = { 'src/a.js': 'export const a = 1;\n', 'tests/a.test.js': 'test("a", () => {});\n' };

  it('"## Mapa de código para testes" gives Test-Spec a table to examine (not empty)', () => {
    const dir = project({
      ...TEST_FILES,
      'docs-canonical/TEST-SPEC.md': `# Testes\n\n## Categorias de teste\n\nx\n\n## Mapa de código para testes\n\n| Fonte | Teste | Status |\n|---|---|---|\n| src/a.js | tests/a.test.js | ✅ |\n`,
    });
    const r = validateTestSpec(dir, configFor({ language: 'pt-BR' }));
    assert.equal(r.emptyCause, undefined, `Test-Spec is empty: ${r.note}`);
    assert.ok(r.performed > 0 && r.passed > 0, JSON.stringify({ performed: r.performed, passed: r.passed }));
  });

  it('the Spanish map heading and a marker under any heading work the same', () => {
    for (const [lang, heading, marker] of [['es', '## Mapa de código a pruebas', ''], ['de', '## Quelle zu Test Zuordnung', '\n<!-- docguard:heading source-to-test-map -->']]) {
      const dir = project({
        ...TEST_FILES,
        'docs-canonical/TEST-SPEC.md': `# T\n\n${heading}${marker}\n\n| Fuente | Prueba | Estado |\n|---|---|---|\n| src/a.js | tests/a.test.js | ✅ |\n`,
      });
      const r = validateTestSpec(dir, configFor({ language: lang }));
      assert.ok(r.performed > 0, `${lang}: Test-Spec examined nothing (${r.emptyCause})`);
    }
  });

  it('DCV005 reads "## Instalação", "## Uso" and "## Licença"', () => {
    const dir = project({ 'README.md': '# Ferramenta\n\nTexto.\n\n## Instalação\n\nnpm i\n\n## Uso\n\nrode\n\n## Licença\n\nMIT\n' });
    const r = validateDocsCoverage(dir, configFor({ language: 'pt-BR' }));
    assert.deepEqual(codes(r, 'DCV005').map(f => f.message), []);
    // Without the language it is the finding the reporter saw (the English substrings are absent).
    assert.equal(codes(validateDocsCoverage(dir, {}), 'DCV005').length, 3);
  });

  it('the Score counts the same sections as STR003', () => {
    const pt = project(PT, { language: 'pt-BR' });
    const english = project({
      'docs-canonical/ARCHITECTURE.md': PT['docs-canonical/ARCHITECTURE.md'].replace('Visão geral do sistema', 'System Overview').replace('Mapa de componentes', 'Component Map').replace('Pilha tecnológica', 'Tech Stack'),
      'docs-canonical/DATA-MODEL.md': PT['docs-canonical/DATA-MODEL.md'].replace('Entidades', 'Entities'),
      'docs-canonical/SECURITY.md': PT['docs-canonical/SECURITY.md'].replace('Autenticação', 'Authentication').replace('Gerenciamento de segredos', 'Secrets Management'),
      'docs-canonical/TEST-SPEC.md': PT['docs-canonical/TEST-SPEC.md'].replace('Categorias de teste', 'Test Categories').replace('Regras de cobertura', 'Coverage Rules'),
      'docs-canonical/ENVIRONMENT.md': PT['docs-canonical/ENVIRONMENT.md'].replace('Passos de configuração', 'Setup Steps').replace('Variáveis de ambiente', 'Environment Variables'),
    });
    const a = runScoreInternal(pt, loadConfig(pt)).categories;
    const b = runScoreInternal(english, loadConfig(english)).categories;
    assert.equal(a.docQuality, b.docQuality);
    const arch = project({ 'docs-canonical/ARCHITECTURE.md': `# Arq\n\n## Limites entre camadas\n\nx\n\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\`\n\n## Dependências externas\n<!-- docguard:heading external-dependencies -->\n\nx\n\n## Histórico de revisões\n<!-- docguard:heading revision-history -->\n\nx\n` }, { language: 'pt-BR' });
    const archEnglish = project({ 'docs-canonical/ARCHITECTURE.md': '# Arq\n\n## Layer Boundaries\n\nx\n\n```mermaid\ngraph TD\nA-->B\n```\n\n## External Dependencies\n\nx\n\n## Revision History\n\nx\n' });
    assert.equal(runScoreInternal(arch, loadConfig(arch)).categories.architecture, runScoreInternal(archEnglish, loadConfig(archEnglish)).categories.architecture);
  });
});

describe('T007: a heading the set does not list names the accepted forms and the marker', () => {
  const doc = heading => `# Arquitetura\n\n${heading}\n${PROSE}\n## Mapa de componentes\n\nx\n\n## Pilha tecnológica\n\nNode\n`;

  it('STR003 for "## Panorama geral" lists the forms and the marker; the marker clears it', () => {
    const config = configFor({ language: 'pt-BR' });
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': doc('## Panorama geral') });
    const [finding] = codes(validateDocSections(dir, config), 'STR003');
    assert.ok(finding, 'STR003 expected');
    assert.match(finding.message, /Visão geral do sistema/, 'names an accepted alias');
    assert.match(finding.message, /System Overview/, 'names the English label');
    assert.match(finding.message, /<!-- docguard:heading system-overview -->/, 'names the marker');
    assert.match(finding.message, /docs\.labelAliases\.system-overview/, 'names the project-alias key');
    const fixed = project({ 'docs-canonical/ARCHITECTURE.md': doc('## Panorama geral\n<!-- docguard:heading system-overview -->') });
    assert.deepEqual(codes(validateDocSections(fixed, config), 'STR003'), []);
  });

  it('a docs.labelAliases entry clears it too, and extends the built-in set rather than replacing it', () => {
    const config = configFor({ language: 'pt-BR', labelAliases: { 'system-overview': ['Panorama geral'] } });
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': doc('## Panorama geral') });
    assert.deepEqual(codes(validateDocSections(dir, config), 'STR003'), []);
    const built = project({ 'docs-canonical/ARCHITECTURE.md': doc('## Visão geral do sistema') });
    assert.deepEqual(codes(validateDocSections(built, config), 'STR003'), [], 'the built-in alias still works');
  });

  it('English messages do not change (no accepted-forms text without a language)', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': '# A\n\n## Overview\n\nx\n' });
    for (const f of codes(validateDocSections(dir, {}), 'STR003')) assert.doesNotMatch(f.message, /Accepted headings/);
  });
});

describe('T008: a language with no built-in set is never blocked and never passed silently', () => {
  const ARCH_DE = `# Architektur\n\n## Systemübersicht\n${PROSE}\n## Komponenten\n\nx\n\n## Technologien\n\nNode\n`;
  const ENV_DE = `# Umgebung\n\n## Einrichtung\n${PROSE}\n## Umgebungsvariablen\n\nx\n`;

  it('docs.language "de", German headings, no marker: no STR003; the document is reported with language-not-supported', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': ARCH_DE }, { language: 'de' });
    const r = validateDocSections(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'STR003'), []);
    assert.equal(r.unexaminedDocuments.length, 1);
    assert.equal(r.unexaminedDocuments[0].path, 'docs-canonical/ARCHITECTURE.md');
    assert.equal(r.unexaminedDocuments[0].cause, 'language-not-supported');
    assert.equal(r.unexaminedDocuments[0].language, 'de');
    assert.match(r.unexaminedDocuments[0].howToConfigure, /docguard:heading/);
    assert.deepEqual([...r.unexaminedDocuments[0].sections].sort(), ['component-map', 'system-overview', 'tech-stack']);
    assert.equal(r.performed, 0, 'nothing was judged, so the result is empty for the cause, never for needs-declaration (strict would exit 4)');
    assert.equal(r.emptyCause, 'language-not-supported');
    assert.equal(r.applicability, undefined, 'one mechanism: the cause, not a partial applicability (spec 104 Stage 3)');
  });

  it('markers or docs.labelAliases satisfy it, and the report no longer lists the document', () => {
    const marked = project({
      'docs-canonical/ARCHITECTURE.md': `# Architektur\n\n## Systemübersicht\n<!-- docguard:heading system-overview -->\n${PROSE}\n## Komponenten\n<!-- docguard:heading component-map -->\n\nx\n\n## Technologien\n<!-- docguard:heading tech-stack -->\n\nNode\n`,
    }, { language: 'de' });
    const rm = validateDocSections(marked, loadConfig(marked));
    assert.deepEqual(codes(rm, 'STR003'), []);
    assert.equal(rm.unexaminedDocuments, undefined);
    const aliased = project({ 'docs-canonical/ARCHITECTURE.md': ARCH_DE }, { language: 'de', labelAliases: { 'system-overview': ['Systemübersicht'], 'component-map': ['Komponenten'], 'tech-stack': ['Technologien'] } });
    const ra = validateDocSections(aliased, loadConfig(aliased));
    assert.equal(ra.unexaminedDocuments, undefined);
    assert.equal(ra.passed, 3);
  });

  it('a section that is judged and missing is still STR003 for a supported language', () => {
    const dir = project({ 'docs-canonical/ARCHITECTURE.md': `# A\n\n## Visão geral do sistema\n${PROSE}` }, { language: 'pt-BR' });
    assert.ok(codes(validateDocSections(dir, loadConfig(dir)), 'STR003').length > 0);
  });

  it('a reasoned N/A marker still owns the section for an unsupported language', () => {
    const dir = project({ 'docs-canonical/SECURITY.md': `# Sicherheit\n${PROSE}\n<!-- docguard:section authentication n/a — kein Login -->\n<!-- docguard:section secrets-management n/a — keine Geheimnisse -->\n` }, { language: 'de' });
    const r = validateDocSections(dir, loadConfig(dir));
    assert.equal(r.unexaminedDocuments, undefined);
    assert.equal(r.passed, 2);
  });

  it('ENV001 and ENV002 follow the same rule for an unsupported language', () => {
    const dir = project({ 'docs-canonical/ENVIRONMENT.md': ENV_DE }, { language: 'de' });
    const r = validateEnvironment(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'ENV001').concat(codes(r, 'ENV002')), []);
    assert.ok(r.performed > 0);
    assert.equal(r.unexaminedDocuments[0].path, 'docs-canonical/ENVIRONMENT.md');
  });

  it('DCV005 follows the same rule for an unsupported language', () => {
    const dir = project({ 'README.md': '# Werkzeug\n\nText.\n\n## Verwendung\n\nlos\n' }, { language: 'de' });
    const r = validateDocsCoverage(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'DCV005'), []);
    assert.equal(r.unexaminedDocuments[0].path, 'README.md');
  });

  it('strict guard: the unsupported-language documents are couldNotRead, never unexamined, and the exit code does not move', () => {
    const base = { 'docs-canonical/ARCHITECTURE.md': ARCH_DE, 'docs-canonical/ENVIRONMENT.md': ENV_DE, 'AGENTS.md': '# Agents\n\nRules.\n', 'README.md': '# T\n\n## Installation\n\nx\n\n## Usage\n\nx\n\n## License\n\nMIT\n', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' };
    const run = docs => {
      const dir = project(base, docs);
      const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, '--format', 'json'], { encoding: 'utf8' });
      const report = JSON.parse(r.stdout);
      const byKey = key => report.validators.find(v => v.key === key);
      return { exit: r.status, sections: byKey('docSections'), environment: byKey('environment'), unexamined: (report.strict?.unexamined || []).map(u => u.validator), couldNotRead: (report.strict?.couldNotRead || []).map(u => u.validator) };
    };
    const german = run({ language: 'de' });
    // Nothing in the document could be judged, so the verdict is empty, for the cause that strict reads as could-not-read (spec 104 Stage 3).
    assert.equal(german.sections.verdict === 'empty' ? german.sections.emptyCause : 'language-not-supported', 'language-not-supported');
    assert.ok(!german.unexamined.includes('docSections'), `docSections became unexamined: ${german.unexamined}`);
    assert.ok(!german.unexamined.includes('environment'), `environment became unexamined: ${german.unexamined}`);
    assert.ok(german.couldNotRead.includes('docSections') && german.couldNotRead.includes('environment'), `not listed as could-not-read: ${german.couldNotRead}`);
    const english = run({});
    assert.equal(german.exit, english.exit, 'the exit code is the same as the same project without docs.language');
    assert.deepEqual(german.unexamined.sort(), english.unexamined.sort(), 'strict.unexamined gains nothing');
  });
});

describe('T010: STR009 reports a misused marker', () => {
  const arch = body => ({ 'docs-canonical/ARCHITECTURE.md': `# Arquitetura\n\n${body}` });
  const FULL = `## Visão geral do sistema\n${PROSE}\n## Mapa de componentes\n\nx\n\n## Pilha tecnológica\n\nNode\n`;
  const config = configFor({ language: 'pt-BR' });

  it('an unknown id: a warning that lists the valid ids; it satisfies nothing', () => {
    const dir = project(arch(`${FULL}\n## Outra coisa\n<!-- docguard:heading system-overveiw -->\n`));
    const findings = codes(validateDocSections(dir, config), 'STR009');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'warn');
    assert.match(findings[0].message, /system-overveiw/);
    assert.match(findings[0].message, /system-overview, component-map, tech-stack/);
  });

  it('a duplicate id names the second heading; the first counts', () => {
    const dir = project(arch(`${FULL}\n## Visão geral\n<!-- docguard:heading system-overview -->\n\n## Visão geral do sistema (de novo)\n<!-- docguard:heading system-overview -->\n`));
    const findings = codes(validateDocSections(dir, config), 'STR009');
    assert.equal(findings.filter(f => /second heading/.test(f.message)).length, 1);
  });

  it('a marker whose heading is another label in English: the marker wins, and STR009 warns', () => {
    const dir = project(arch(`${FULL}\n## Tech Stack\n<!-- docguard:heading entities -->\n`));
    const findings = codes(validateDocSections(dir, config), 'STR009');
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /English label of "tech-stack"/);
    assert.match(findings[0].message, /marker says "entities"/);
  });

  it('a misplaced marker that names a valid id (after prose, in a fence, in a comment) is reported', () => {
    for (const body of [
      `${FULL}\n## Solta\nTexto antes.\n<!-- docguard:heading tech-stack -->\n`,
      `${FULL}\n\`\`\`\n<!-- docguard:heading tech-stack -->\n\`\`\`\n`,
      `${FULL}\n<!--\nnota\n<!-- docguard:heading tech-stack -->\n-->\n`,
    ]) {
      const dir = project(arch(body));
      assert.equal(codes(validateDocSections(dir, config), 'STR009').length, 1, body);
    }
  });

  it('a misplaced marker that names no valid id is not reported (nothing to act on)', () => {
    const dir = project(arch(`${FULL}\nTexto.\n<!-- docguard:heading nothing-real -->\n`));
    assert.deepEqual(codes(validateDocSections(dir, config), 'STR009'), []);
  });

  it('a correct marker, and a project with no markers, yield no STR009', () => {
    const dir = project(arch(FULL.replace('## Visão geral do sistema\n', '## Visão geral do sistema\n<!-- docguard:heading system-overview -->\n')));
    assert.deepEqual(codes(validateDocSections(dir, config), 'STR009'), []);
    const plain = project(arch(FULL));
    assert.deepEqual(codes(validateDocSections(plain, config), 'STR009'), []);
  });

  it('STR009 is registered with help text and `docguard explain` states the closed id list', () => {
    const r = spawnSync(process.execPath, [CLI, 'explain', 'STR009'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /docguard:heading/);
    assert.match(r.stdout, /system-overview/);
  });
});
