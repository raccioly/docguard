/**
 * Spec 104, Stage 4 (T035): `init` and `generate` write language-ready documents.
 *
 * Under every generated heading that the label registry knows, the writers put
 * the id marker `<!-- docguard:heading <id> -->`; for a `docs.language` with a
 * built-in set (`pt`, `es`) the heading text is the first alias, otherwise it
 * is English. The new CHANGELOG gets `## [<first alias>]` plus the marker in a
 * translated project and stays `## [Unreleased]` (no marker, as `fix --write`
 * writes it) in an English one. No existing document is rewritten, and an
 * unedited scaffold is recognized by id, so a translated one is still STR006.
 *
 * @req docguard.document-languages#FR-023
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isUneditedScaffold, templateText } from '../cli/shared-scaffold.mjs';
import { isDocguardAuthored } from '../cli/writers/generate-io.mjs';
import { renderAsBuiltSpec } from '../cli/scanners/as-built.mjs';
import { labelContext, headingIds } from '../cli/shared-labels.mjs';
import { materialize, PROJECTS } from './fixtures/generated-docs-projects.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const guard = dir => {
  const r = run(dir, ['guard', '--format', 'json']);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
};
const LABEL_CODES = ['STR003', 'STR007', 'STR009', 'ENV001', 'ENV002', 'CHG001', 'DCV005'];
const noLabelFinding = report => assert.deepEqual(report.findings.filter(f => LABEL_CODES.includes(f.code)).map(f => f.code), []);

/** An empty project with `package.json` and (optionally) a config that sets docs.language. */
function bare(language) {
  const dir = makeTempDir('gdc-lang-init-');
  temps.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  const config = { projectName: 'demo', ...(language ? { docs: { language } } : {}) };
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config));
  return dir;
}

function expressProject(language, extra = {}) {
  const files = { ...PROJECTS['express-js'].files, ...extra };
  if (language) files['.docguard.json'] = JSON.stringify({ projectName: 'demo', docs: { language } });
  const dir = materialize(files, { prefix: 'gdc-lang-gen-' });
  temps.push(dir);
  return dir;
}

const norm = text => text.replace(/\r\n/g, '\n').replace(/\b\d{4}-\d{2}-\d{2}\b|YYYY-MM-DD/g, '<date>');
const withoutMarkers = text => text.replace(/^<!-- docguard:heading [\w-]+ -->\n/gm, '');

// The first alias of every required id a template carries, per language (data from the registry; this test pins the wiring).
// Recommended headings (Layer Boundaries, Relationships, Revision History, ...) are not relabeled and carry no marker: some readers still match them by their English text.
const REQUIRED_PLUS_MAP = new Set(['system-overview', 'component-map', 'tech-stack', 'entities', 'authentication', 'secrets-management', 'test-categories', 'coverage-rules', 'source-to-test-map', 'environment-variables', 'setup-steps']);
const SCAFFOLD = {
  'pt-BR': {
    'docs-canonical/ARCHITECTURE.md': [['system-overview', 'Visão geral do sistema'], ['component-map', 'Mapa de componentes'], ['tech-stack', 'Pilha tecnológica']],
    'docs-canonical/DATA-MODEL.md': [['entities', 'Entidades']],
    'docs-canonical/SECURITY.md': [['authentication', 'Autenticação'], ['secrets-management', 'Gerenciamento de segredos']],
    'docs-canonical/TEST-SPEC.md': [['test-categories', 'Categorias de teste'], ['coverage-rules', 'Regras de cobertura']],
    'docs-canonical/ENVIRONMENT.md': [['environment-variables', 'Variáveis de ambiente'], ['setup-steps', 'Passos de configuração']],
  },
  es: {
    'docs-canonical/ARCHITECTURE.md': [['system-overview', 'Visión general del sistema'], ['component-map', 'Mapa de componentes'], ['tech-stack', 'Stack tecnológico']],
    'docs-canonical/DATA-MODEL.md': [['entities', 'Entidades']],
    'docs-canonical/SECURITY.md': [['authentication', 'Autenticación'], ['secrets-management', 'Gestión de secretos']],
    'docs-canonical/TEST-SPEC.md': [['test-categories', 'Categorías de pruebas'], ['coverage-rules', 'Reglas de cobertura']],
    'docs-canonical/ENVIRONMENT.md': [['environment-variables', 'Variables de entorno'], ['setup-steps', 'Pasos de configuración']],
  },
};

describe('init writes language-ready documents (FR-023)', () => {
  for (const [language, docs] of Object.entries(SCAFFOLD)) {
    it(`docs.language "${language}": the first alias under each heading, each followed by its marker, the first guard run has no label finding`, () => {
      const dir = bare(language);
      assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
      for (const [file, headings] of Object.entries(docs)) {
        const text = read(dir, file);
        for (const [id, alias] of headings) {
          assert.match(text, new RegExp(`^## ${alias}\\n<!-- docguard:heading ${id} -->\\n`, 'm'), `${file} ${id}`);
        }
      }
      // A recommended heading is neither relabeled nor marked.
      const arch = read(dir, 'docs-canonical/ARCHITECTURE.md');
      assert.match(arch, /^## Layer Boundaries\n\n/m);
      assert.doesNotMatch(arch, /docguard:heading layer-boundaries|Limites entre camadas/);
      noLabelFinding(guard(dir));
    });
  }

  it('the translated scaffold is still an unedited scaffold: STR006 names it, by id', () => {
    const dir = bare('pt-BR');
    assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
    const report = guard(dir);
    const scaffolds = report.findings.filter(f => f.code === 'STR006').length;
    assert.ok(scaffolds >= 5, `five canonical scaffolds reported, saw ${scaffolds}`);
  });

  it('a language with no built-in set (de): English headings plus markers, so no label is reported as not judged', () => {
    const dir = bare('de');
    assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
    const text = read(dir, 'docs-canonical/ARCHITECTURE.md');
    assert.match(text, /^## System Overview\n<!-- docguard:heading system-overview -->\n/m);
    assert.match(read(dir, 'CHANGELOG.md'), /^## \[Unreleased\]\n/m);
    const report = guard(dir);
    noLabelFinding(report);
    // Stage 3's prose checks (Docs-Diff, Metrics-Consistency, semantic claims) still report that they do not read German; no label check does.
    const prose = new Set(['docsDiff', 'metricsConsistency', 'semanticClaims', 'docQuality']);
    assert.deepEqual((report.strict?.couldNotRead || []).filter(entry => entry.cause === 'language-not-supported' && !prose.has(entry.validator)).map(entry => entry.validator), []);
  });

  it('English (no docs.language): the template plus a marker line under each registered heading, nothing else', () => {
    const dir = bare(null);
    assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
    for (const name of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT']) {
      const text = read(dir, `docs-canonical/${name}.md`);
      assert.match(text, /<!-- docguard:heading [\w-]+ -->/, `${name} carries markers`);
      assert.equal(norm(withoutMarkers(text)), norm(templateText(name)), `${name} differs from its template only by the marker lines`);
    }
    assert.match(read(dir, 'docs-canonical/ARCHITECTURE.md'), /^## Tech Stack\n<!-- docguard:heading tech-stack -->\n/m);
    const marked = ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT'].flatMap(name => [...read(dir, `docs-canonical/${name}.md`).matchAll(/<!-- docguard:heading ([\w-]+) -->/g)].map(m => m[1]));
    assert.deepEqual(marked.filter(id => !REQUIRED_PLUS_MAP.has(id)), [], 'only required headings are marked');
    assert.match(read(dir, 'docs-canonical/ARCHITECTURE.md'), /^## Layer Boundaries\n\n/m);
    // The changelog keeps the Keep a Changelog heading, as `fix --write` writes it.
    assert.equal(norm(read(dir, 'CHANGELOG.md')), norm(templateText('CHANGELOG')));
  });

  it('the CHANGELOG is `## [<first alias>]` plus the marker in pt and es', () => {
    for (const [language, alias] of [['pt-BR', 'Não lançado'], ['es-MX', 'Sin publicar']]) {
      const dir = bare(language);
      assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
      assert.match(read(dir, 'CHANGELOG.md'), new RegExp(`^## \\[${alias}\\]\\n<!-- docguard:heading unreleased -->\\n`, 'm'), language);
      assert.doesNotMatch(read(dir, 'CHANGELOG.md'), /\[Unreleased\]/);
    }
  });

  it('no existing document is rewritten', () => {
    const dir = bare('pt-BR');
    mkdirSync(join(dir, 'docs-canonical'));
    const mine = '# Arquitetura\n\n## Pilha tecnológica\n\nNode e Express.\n';
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), mine);
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Registro\n\n## Não lançado\n');
    assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
    assert.equal(read(dir, 'docs-canonical/ARCHITECTURE.md'), mine);
    assert.equal(read(dir, 'CHANGELOG.md'), '# Registro\n\n## Não lançado\n');
  });
});

describe('generate writes language-ready documents (FR-023)', () => {
  it('docs.language "pt-BR": the generated documents carry alias headings plus markers, and guard reports no label finding', () => {
    const dir = expressProject('pt-BR');
    assert.equal(run(dir, ['generate']).status, 0);
    const arch = read(dir, 'docs-canonical/ARCHITECTURE.md');
    assert.match(arch, /^## 1\. Visão geral do sistema\n<!-- docguard:heading system-overview -->\n/m);
    assert.match(arch, /^## 5\. Mapa de componentes\n<!-- docguard:heading component-map -->\n/m);
    assert.match(arch, /^### Pilha tecnológica\n<!-- docguard:heading tech-stack -->\n/m);
    assert.doesNotMatch(arch, /^#{2,3} (?:\d+\. )?(System Overview|Introduction and Goals|Building Block View|Tech Stack)\b/m);
    assert.match(read(dir, 'docs-canonical/DATA-MODEL.md'), /^## Entidades\n<!-- docguard:heading entities -->\n/m);
    assert.match(read(dir, 'docs-canonical/SECURITY.md'), /^## Gerenciamento de segredos\n<!-- docguard:heading secrets-management -->\n/m);
    assert.match(read(dir, 'docs-canonical/TEST-SPEC.md'), /^## Categorias de teste\n<!-- docguard:heading test-categories -->\n/m);
    assert.match(read(dir, 'docs-canonical/TEST-SPEC.md'), /^## Mapa de fontes para testes\n<!-- docguard:heading source-to-test-map -->\n/m);
    assert.match(arch, /^### Layer Boundaries\n\n/m, 'a recommended heading keeps its English text, which the Architecture validator reads');
    assert.match(read(dir, 'docs-canonical/ENVIRONMENT.md'), /^## Variáveis de ambiente\n<!-- docguard:heading environment-variables -->\n/m);
    assert.match(read(dir, 'CHANGELOG.md'), /^## \[Não lançado\]\n<!-- docguard:heading unreleased -->\n/m);
    noLabelFinding(guard(dir));
  });

  it('docs.language "es": Spanish headings and the Spanish changelog heading', () => {
    const dir = expressProject('es');
    assert.equal(run(dir, ['generate']).status, 0);
    assert.match(read(dir, 'docs-canonical/ARCHITECTURE.md'), /^### Stack tecnológico\n<!-- docguard:heading tech-stack -->\n/m);
    assert.match(read(dir, 'CHANGELOG.md'), /^## \[Sin publicar\]\n<!-- docguard:heading unreleased -->\n/m);
    noLabelFinding(guard(dir));
  });

  it('English: the same documents plus markers; the English headings stay and no marker appears twice', () => {
    const dir = expressProject(null);
    assert.equal(run(dir, ['generate']).status, 0);
    const arch = read(dir, 'docs-canonical/ARCHITECTURE.md');
    assert.match(arch, /^### Tech Stack\n<!-- docguard:heading tech-stack -->\n/m);
    assert.match(arch, /^## 1\. Introduction and Goals\n<!-- docguard:heading system-overview -->\n/m);
    for (const file of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT']) {
      const ids = [...read(dir, `docs-canonical/${file}.md`).matchAll(/<!-- docguard:heading ([\w-]+) -->/g)].map(m => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${file}: each id once`);
      assert.ok(ids.every(id => headingIds().includes(id) && REQUIRED_PLUS_MAP.has(id)), `${file}: only required registry ids`);
    }
    assert.match(read(dir, 'CHANGELOG.md'), /^## \[Unreleased\]\n\n### Added/m);
    assert.doesNotMatch(read(dir, 'CHANGELOG.md'), /docguard:heading/);
    noLabelFinding(guard(dir));
  });

  it('a second generate rewrites nothing: documents that exist are left byte for byte', () => {
    const dir = expressProject('pt-BR');
    assert.equal(run(dir, ['generate']).status, 0);
    const files = ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/SECURITY.md', 'CHANGELOG.md'];
    const before = files.map(file => read(dir, file));
    assert.equal(run(dir, ['generate']).status, 0);
    assert.deepEqual(files.map(file => read(dir, file)), before);
  });

  it('generate --plan --write: a heading it has to write carries its marker, in English too', () => {
    const english = expressProject(null, { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:generated true -->\n' });
    assert.equal(run(english, ['generate', '--plan', '--write']).status, 0);
    const text = read(english, 'docs-canonical/ARCHITECTURE.md');
    assert.match(text, /^## Tech Stack\n<!-- docguard:heading tech-stack -->\n\n<!-- docguard:section id=tech-stack/m);
    assert.match(text, /^## System Overview\n<!-- docguard:heading system-overview -->\n/m);
    // A generator heading outside the registry has no id and so no marker.
    assert.doesNotMatch(text, /^## Frontend Modules\n<!--/m);
  });
});

describe('the as-built spec carries markers (FR-023, D5)', () => {
  const facts = [{ kind: 'route', key: 'GET /users', file: 'src/api/users.mjs', line: 3 }];
  const input = { title: 'As-built: src/api', specId: 'demo.api', areaRel: 'src/api', facts, tests: [], dirName: '001-api', date: '2026-11-17' };

  it('English: the three mandatory headings keep their text and gain a marker', () => {
    const text = renderAsBuiltSpec(input);
    assert.match(text, /^## User Scenarios & Testing \*\(mandatory\)\*\n<!-- docguard:heading user-scenarios -->\n/m);
    assert.match(text, /^## Requirements \*\(mandatory\)\*\n<!-- docguard:heading requirements -->\n/m);
    assert.match(text, /^## Success Criteria \*\(mandatory\)\*\n<!-- docguard:heading success-criteria -->\n/m);
  });

  it('pt and es: the first alias plus the marker, and nothing else is translated', () => {
    const pt = renderAsBuiltSpec({ ...input, labels: labelContext({ docs: { language: 'pt-BR' } }) });
    assert.match(pt, /^## Cenários de usuário\n<!-- docguard:heading user-scenarios -->\n/m);
    assert.match(pt, /^## Requisitos\n<!-- docguard:heading requirements -->\n/m);
    assert.match(pt, /^## Critérios de sucesso\n<!-- docguard:heading success-criteria -->\n/m);
    assert.match(pt, /^## Out of Scope$/m);
    const es = renderAsBuiltSpec({ ...input, labels: labelContext({ docs: { language: 'es' } }) });
    assert.match(es, /^## Escenarios de usuario\n<!-- docguard:heading user-scenarios -->\n/m);
    assert.match(es, /^## Criterios de éxito\n<!-- docguard:heading success-criteria -->\n/m);
  });

  it('`generate --spec --write` in a Portuguese project passes SPK003 with no label finding', () => {
    const dir = materialize({
      '.docguard.json': JSON.stringify({ projectName: 'acme', docs: { language: 'pt-BR' } }),
      'package.json': JSON.stringify({ name: 'acme', dependencies: { express: '4.0.0' } }),
      'src/api/users.mjs': 'import express from "express";\nconst r = express.Router();\nr.get("/users", (q, s) => s.json([]));\nexport default r;\n',
    }, { prefix: 'gdc-lang-asbuilt-' });
    temps.push(dir);
    const r = run(dir, ['generate', '--spec', 'src/api', '--write']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const spec = readFileSync(join(dir, 'specs', readdirSyncOne(join(dir, 'specs')), 'spec.md'), 'utf8');
    assert.match(spec, /^## Critérios de sucesso\n<!-- docguard:heading success-criteria -->\n/m);
    assert.deepEqual(guard(dir).findings.filter(f => /^SPK00[345]$/.test(f.code)).map(f => f.code), []);
  });
});

function readdirSyncOne(dir) {
  return spawnSync('ls', [dir], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
}

/** A scaffold as `init` writes it for a translated project, built by hand so this test does not depend on the writer. */
function localizedScaffold(name, pairs) {
  let text = templateText(name);
  for (const [english, alias, id] of pairs) text = text.replace(`## ${english}\n`, `## ${alias}\n<!-- docguard:heading ${id} -->\n`);
  return text;
}

describe('isUneditedScaffold compares headings by their marker (FR-023)', () => {
  const PT = [['System Overview', 'Visão geral do sistema', 'system-overview'], ['Component Map', 'Mapa de componentes', 'component-map'], ['Tech Stack', 'Pilha tecnológica', 'tech-stack']];

  it('an unedited Portuguese scaffold is a scaffold', () => {
    assert.equal(isUneditedScaffold(localizedScaffold('ARCHITECTURE', PT), 'ARCHITECTURE'), true);
  });

  it('a Spanish scaffold is a scaffold', () => {
    const es = [['System Overview', 'Visión general del sistema', 'system-overview'], ['Tech Stack', 'Stack tecnológico', 'tech-stack']];
    assert.equal(isUneditedScaffold(localizedScaffold('ARCHITECTURE', es), 'ARCHITECTURE'), true);
  });

  it('the id comes from the marker, never from guessing: the same headings without markers are an edited document (D6)', () => {
    const text = localizedScaffold('ARCHITECTURE', PT).replace(/^<!-- docguard:heading [\w-]+ -->\n/gm, '');
    assert.equal(isUneditedScaffold(text, 'ARCHITECTURE'), false);
  });

  it('an edited one is not: a line the template does not have, or a heading no marker names', () => {
    assert.equal(isUneditedScaffold(`${localizedScaffold('ARCHITECTURE', PT)}\nNós usamos Node e Express.\n`, 'ARCHITECTURE'), false);
    assert.equal(isUneditedScaffold(`${localizedScaffold('ARCHITECTURE', PT)}\n## Decisões\n`, 'ARCHITECTURE'), false);
  });

  it('a marker on a heading the template has no label for does not make it the template\'s', () => {
    assert.equal(isUneditedScaffold(localizedScaffold('ARCHITECTURE', [['System Overview', 'Visão geral do sistema', 'data-flow']]), 'ARCHITECTURE'), false);
  });

  it('English scaffolds, with and without markers, are unchanged', () => {
    const english = templateText('ARCHITECTURE');
    assert.equal(isUneditedScaffold(english, 'ARCHITECTURE'), true);
    assert.equal(isUneditedScaffold(english.replace('## Tech Stack\n', '## Tech Stack\n<!-- docguard:heading tech-stack -->\n'), 'ARCHITECTURE'), true);
    assert.equal(isUneditedScaffold(`${english}\nWe use Node.\n`, 'ARCHITECTURE'), false);
  });
});

describe('isDocguardAuthored: exactly what init writes, nothing a person could have changed (FR-023, Constitution VI)', () => {
  const PT = [['System Overview', 'Visão geral do sistema', 'system-overview'], ['Component Map', 'Mapa de componentes', 'component-map'], ['Tech Stack', 'Pilha tecnológica', 'tech-stack']];
  const doc = 'docs-canonical/ARCHITECTURE.md';

  it('init output in every form it writes: the template, English with markers, pt and es', () => {
    for (const language of [null, 'de', 'pt-BR', 'es']) {
      const dir = bare(language);
      assert.equal(run(dir, ['init', '--skip-prompts']).status, 0);
      assert.equal(isDocguardAuthored(doc, read(dir, doc)), true, String(language));
    }
    assert.equal(isDocguardAuthored(doc, templateText('ARCHITECTURE')), true);
  });

  it('a hand-translated copy (headings changed, no markers) or any edit is a person\'s document: its overwrite keeps a backup', () => {
    const translated = templateText('ARCHITECTURE').replace('## System Overview\n', '## Visão geral do sistema\n');
    assert.equal(isDocguardAuthored(doc, translated), false);
    assert.equal(isDocguardAuthored(doc, `${localizedScaffold('ARCHITECTURE', PT)}\nedited\n`), false);
    assert.equal(isDocguardAuthored(doc, localizedScaffold('ARCHITECTURE', [['System Overview', 'Panorama', 'system-overview']])), false);
  });
});
