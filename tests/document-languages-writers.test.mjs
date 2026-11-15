/**
 * Spec 104, Stage 1 (T011): writers respect `docs.language`.
 *
 * `generate --write` and `sync` (`upsertSection`) find their host heading
 * through the resolver. With no host they write the first alias of the language
 * plus the id marker for a language that has a set, and the block alone (with a
 * `language-not-supported` report) when it has none. They never write an English
 * heading into a translated document. English output is unchanged in this stage
 * (the markers under generated headings are Stage 4).
 *
 * @req docguard.document-languages#FR-008
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { upsertSection } from '../cli/writers/sections.mjs';
import { materialize, PROJECTS } from './fixtures/generated-docs-projects.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

const ctxFor = async language => (await import('../cli/shared-labels.mjs')).labelContext({ docs: { language } });

function expressProject(extra, docs) {
  const files = { ...PROJECTS['express-js'].files, ...extra };
  if (docs) files['.docguard.json'] = JSON.stringify({ docs });
  const dir = materialize(files, { prefix: 'gdc-lang-writers-' });
  temps.push(dir);
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8' });

const ENGLISH_HEADINGS = /^## (System Overview|Component Map|Tech Stack|Environment Variables|Entities|Endpoints|Test Inventory|Frontend Modules|Module Graph|Integrations|Feature Areas|Screens)\b/m;

describe('upsertSection with a label context', () => {
  it('a Portuguese host heading hosts the block; no second heading is written', async () => {
    const doc = '# Arq\n\n## Pilha tecnológica\n\nNode.\n\n## Outra\n';
    const out = upsertSection(doc, 'tech-stack', '| x |', { heading: 'Tech Stack', labels: await ctxFor('pt-BR') }).content;
    assert.equal((out.match(/^## /gm) || []).length, 2);
    assert.ok(out.indexOf('id=tech-stack') > out.indexOf('## Pilha tecnológica'));
    assert.ok(out.indexOf('id=tech-stack') < out.indexOf('## Outra'));
    assert.doesNotMatch(out, /## Tech Stack/);
  });

  it('a host that carries its marker keeps the marker as the next line, and the block goes after it', async () => {
    const doc = '# Arq\n\n## Tecnologias de base\n<!-- docguard:heading tech-stack -->\n\nNode.\n';
    const out = upsertSection(doc, 'tech-stack', '| x |', { heading: 'Tech Stack', labels: await ctxFor('pt-BR') }).content;
    assert.match(out, /## Tecnologias de base\n<!-- docguard:heading tech-stack -->\n\n<!-- docguard:section id=tech-stack/);
  });

  it('no host, a language with a set: the first alias plus the id marker', async () => {
    for (const [language, heading] of [['pt-BR', 'Pilha tecnológica'], ['es', 'Stack tecnológico']]) {
      const out = upsertSection('# Arq\n', 'tech-stack', '| x |', { heading: 'Tech Stack', labels: await ctxFor(language) }).content;
      assert.match(out, new RegExp(`^## ${heading}\\n<!-- docguard:heading tech-stack -->\\n\\n<!-- docguard:section id=tech-stack source=code -->`, 'm'), language);
      assert.doesNotMatch(out, /## Tech Stack/);
    }
  });

  it('the section id and the heading id differ (overview vs system-overview): the heading maps to the registry id', async () => {
    const out = upsertSection('# Arq\n', 'overview', '> task', { source: 'human', heading: 'System Overview', labels: await ctxFor('pt-BR') }).content;
    assert.match(out, /^## Visão geral do sistema\n<!-- docguard:heading system-overview -->/m);
  });

  it('no host, a language with no set: the block is written without a heading and the result says so', async () => {
    const r = upsertSection('# Arq\n', 'tech-stack', '| x |', { heading: 'Tech Stack', labels: await ctxFor('de') });
    assert.doesNotMatch(r.content, /^## /m);
    assert.match(r.content, /docguard:section id=tech-stack/);
    assert.equal(r.languageNotSupported, 'Tech Stack');
  });

  it('a generator heading with no alias in a translated document is written without a heading, never in English', async () => {
    const r = upsertSection('# Arq\n', 'endpoints', '| x |', { heading: 'Endpoints', labels: await ctxFor('pt-BR') });
    assert.doesNotMatch(r.content, /^## /m);
    assert.equal(r.languageNotSupported, 'Endpoints');
  });

  it('English output is unchanged: no docs.language, or docs.language "en", writes the English heading and no marker', async () => {
    const legacy = upsertSection('# Env\n', 'env-vars', '| a |', { heading: 'Environment Variables' }).content;
    assert.equal(legacy, '# Env\n\n## Environment Variables\n\n<!-- docguard:section id=env-vars source=code -->\n| a |\n<!-- /docguard:section -->\n');
    const en = upsertSection('# Env\n', 'env-vars', '| a |', { heading: 'Environment Variables', labels: await ctxFor('en') }).content;
    assert.equal(en, legacy);
  });
});

describe('generate --plan --write in a Portuguese project', () => {
  it('places the generated block under the Portuguese host and writes no English heading', () => {
    const dir = expressProject({
      'docs-canonical/ARCHITECTURE.md': '# Arquitetura\n\n<!-- docguard:generated true -->\n\n## Visão geral do sistema\n\nTexto.\n\n## Pilha tecnológica\n\nNode.\n',
    }, { language: 'pt-BR' });
    const r = run(dir, ['generate', '--plan', '--write']);
    assert.equal(r.status, 0, r.stderr);
    const out = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    const host = out.indexOf('## Pilha tecnológica');
    const block = out.indexOf('id=tech-stack');
    assert.ok(host >= 0 && block > host, 'the tech-stack block sits under the Portuguese heading');
    assert.equal((out.match(/^## Pilha tecnológica$/gm) || []).length, 1);
    assert.doesNotMatch(out, ENGLISH_HEADINGS);
    // A heading that did not exist is the alias plus its marker.
    assert.match(out, /^## Mapa de componentes\n<!-- docguard:heading component-map -->/m);
    for (const file of ['DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT', 'API-REFERENCE']) {
      try { assert.doesNotMatch(readFileSync(join(dir, `docs-canonical/${file}.md`), 'utf8'), ENGLISH_HEADINGS, file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  });

  it('for "de" with no host the block is written without a heading and the run reports language-not-supported', () => {
    const dir = expressProject({
      'docs-canonical/ARCHITECTURE.md': '# Architektur\n\n<!-- docguard:generated true -->\n',
    }, { language: 'de' });
    const r = run(dir, ['generate', '--plan', '--write']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /language-not-supported/);
    const out = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    assert.match(out, /docguard:section id=tech-stack/);
    assert.doesNotMatch(out, ENGLISH_HEADINGS);
  });

  it('without docs.language the English headings are written exactly as before', () => {
    const dir = expressProject({ 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:generated true -->\n' });
    assert.equal(run(dir, ['generate', '--plan', '--write']).status, 0);
    const out = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    assert.match(out, /^## Tech Stack\n\n<!-- docguard:section id=tech-stack/m);
    assert.doesNotMatch(out, /docguard:heading/);
  });

  it('sync refreshes a code section under a Portuguese heading and adds no heading', () => {
    const dir = expressProject({
      'docs-canonical/ARCHITECTURE.md': '# Arquitetura\n\n<!-- docguard:generated true -->\n\n## Pilha tecnológica\n\n<!-- docguard:section id=tech-stack source=code -->\nOUTDATED\n<!-- /docguard:section -->\n',
    }, { language: 'pt-BR' });
    const r = run(dir, ['sync', '--write']);
    assert.equal(r.status, 0, r.stderr);
    const out = readFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), 'utf8');
    assert.doesNotMatch(out, /OUTDATED/);
    assert.deepEqual(out.match(/^## .*$/gm), ['## Pilha tecnológica']);
  });
});
