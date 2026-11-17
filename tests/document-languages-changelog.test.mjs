/**
 * Spec 104, Stage 2 (T018): the changelog's `[Unreleased]` section in any language.
 *
 * CHG001, the Score's changelog check and `fix --write` resolve the `unreleased`
 * label through the registry: `## [Não lançado]`, `## [Sin publicar]`, the marker
 * `<!-- docguard:heading unreleased -->` under a heading, or a `docs.labelAliases`
 * entry. `fix --write` writes the first alias plus the marker for `pt` and `es`
 * and `## [Unreleased]` with no `docs.language`. CHG002 and CHG003 are unchanged.
 *
 * Red on origin/main: every test that sets a language or a marker (CHG001 is
 * raised and `fix --write` writes English). Green on both sides by design: the
 * English-unchanged checks (no docs.language, "en", a bare `## Unreleased`), and
 * CHG002/CHG003.
 *
 * @req docguard.document-languages#FR-012
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateChangelog } from '../cli/validators/changelog.mjs';
import { applyMechanicalFix } from '../cli/writers/mechanical.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';

const CLI = resolve('cli/docguard.mjs');

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-changelog-');
  const all = { ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const log = heading => ({ 'CHANGELOG.md': `# Changelog\n\n${heading}\n\n## [1.0.0] - 2026-01-01\n\n- first\n` });
const codes = (result, code) => (result.findings || []).filter(f => f.code === code);
const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8' });

describe('CHG001 reads the unreleased label through the registry (T018)', () => {
  const FORMS = [
    ['pt-BR', '## [Não lançado]'], ['pt-BR', '## [Não publicado]'], ['pt', '## [Nao lancado]'], ['pt-PT', '## [NÃO LANÇADO]'],
    ['es', '## [Sin publicar]'], ['es-MX', '## [No publicado]'], ['es', '## [sin publicar]'],
  ];
  for (const [language, heading] of FORMS) {
    it(`docs.language ${language}: ${heading} satisfies CHG001`, () => {
      const dir = project(log(heading), { language });
      assert.deepEqual(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001').map(f => f.message), []);
    });
  }

  it('without docs.language the same headings still report CHG001 (nothing is inferred)', () => {
    for (const heading of ['## [Não lançado]', '## [Sin publicar]']) {
      assert.equal(codes(validateChangelog(project(log(heading)), {requiredFiles: { changelog: 'CHANGELOG.md' }}), 'CHG001').length, 1, heading);
    }
  });

  it('a Portuguese alias does not satisfy a Spanish project, and English is always accepted', () => {
    assert.equal(codes(validateChangelog(project(log('## [Não lançado]'), { language: 'es' }), { requiredFiles: { changelog: 'CHANGELOG.md' }, docs: { language: 'es' } }), 'CHG001').length, 1);
    const dir = project(log('## [Unreleased]'), { language: 'pt-BR' });
    assert.deepEqual(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001'), []);
  });

  it('the marker under a heading satisfies it in any language, with and without docs.language', () => {
    const files = log('## [Em desenvolvimento]\n<!-- docguard:heading unreleased -->');
    for (const docs of [undefined, { language: 'pt-BR' }, { language: 'de' }]) {
      const dir = project(files, docs);
      assert.deepEqual(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001'), [], JSON.stringify(docs));
    }
  });

  it('a marker that is not directly under a heading satisfies nothing', () => {
    const dir = project(log('## [Em desenvolvimento]\nsome prose\n<!-- docguard:heading unreleased -->'), { language: 'pt-BR' });
    assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001').length, 1);
  });

  it('a docs.labelAliases entry satisfies it, extending the built-in set and never replacing it', () => {
    const docs = { language: 'pt-BR', labelAliases: { unreleased: ['Em desenvolvimento'] } };
    for (const heading of ['## [Em desenvolvimento]', '## [Não lançado]', '## [Unreleased]']) {
      const dir = project(log(heading), docs);
      assert.deepEqual(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001'), [], heading);
    }
    const dir = project(log('## [Em desenvolvimento]'), { labelAliases: { unreleased: ['Em desenvolvimento'] } });
    assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001').length, 1, 'aliases are inert without docs.language');
  });

  it('a language with no built-in set: no CHG001, the document is listed as not judged; a marker or an alias removes the entry', () => {
    const dir = project(log('## [Nicht veröffentlicht]'), { language: 'de' });
    const r = validateChangelog(dir, loadConfig(dir));
    assert.deepEqual(codes(r, 'CHG001'), []);
    assert.equal(r.unexaminedDocuments.length, 1);
    assert.equal(r.unexaminedDocuments[0].path, 'CHANGELOG.md');
    assert.equal(r.unexaminedDocuments[0].cause, 'language-not-supported');
    assert.equal(r.unexaminedDocuments[0].language, 'de');
    assert.deepEqual(r.unexaminedDocuments[0].sections, ['unreleased']);
    for (const docs of [{ language: 'de', labelAliases: { unreleased: ['Nicht veröffentlicht'] } }]) {
      const withAlias = project(log('## [Nicht veröffentlicht]'), docs);
      assert.deepEqual(validateChangelog(withAlias, loadConfig(withAlias)).unexaminedDocuments ?? [], []);
    }
    const marked = project(log('## [Nicht veröffentlicht]\n<!-- docguard:heading unreleased -->'), { language: 'de' });
    assert.deepEqual(validateChangelog(marked, loadConfig(marked)).unexaminedDocuments ?? [], []);
  });

  it('a missing section under a configured language still reports CHG001', () => {
    const dir = project({ 'CHANGELOG.md': '# Changelog\n\n## [1.0.0] - 2026-01-01\n' }, { language: 'pt-BR' });
    assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001').length, 1);
  });
});

describe('English is unchanged (T018, T024)', () => {
  const english = [['no docs.language', undefined], ['docs.language "en"', { language: 'en' }]];
  for (const [label, docs] of english) {
    it(`${label}: [Unreleased] and [unreleased] pass; a bare "## Unreleased" and a mention in prose are judged as before`, () => {
      const expect = [['## [Unreleased]', 0], ['## [unreleased]', 0], ['## Unreleased', 1]];
      for (const [heading, count] of expect) {
        const dir = project(log(heading), docs);
        assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG001').length, count, `${label}: ${heading}`);
      }
    });
  }
});

describe('CHG002 and CHG003 are unchanged by the language (T018)', () => {
  it('CHG002: no `## [` heading at all, in every language', () => {
    for (const docs of [undefined, { language: 'pt-BR' }, { language: 'es' }]) {
      const dir = project({ 'CHANGELOG.md': '# Changelog\n\n## Não lançado\n\nnada\n' }, docs);
      assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG002').length, 1, JSON.stringify(docs));
    }
  });

  it('CHG003: staged code without the changelog is reported in every language', () => {
    for (const docs of [undefined, { language: 'pt-BR' }]) {
      const dir = project({ ...log('## [Não lançado]'), 'src/a.js': 'export const a = 1;\n' }, docs);
      fixtureGit(dir, ['init', '-q']);
      fixtureGit(dir, ['add', 'src/a.js']);
      assert.equal(codes(validateChangelog(dir, loadConfig(dir)), 'CHG003').length, 1, JSON.stringify(docs));
    }
  });
});

describe('the Score reads the same label (T018)', () => {
  it('a Portuguese heading earns the changelog points under docs.language pt-BR and not without it', () => {
    const files = log('## [Não lançado]');
    const withLanguage = project(files, { language: 'pt-BR' });
    const without = project(files);
    const a = runScoreInternal(withLanguage, loadConfig(withLanguage)).categories.changelog;
    const b = runScoreInternal(without, loadConfig(without)).categories.changelog;
    assert.equal(a, 100);
    assert.ok(b < a, `without the language the score is lower (${b} < ${a})`);
  });
});

describe('fix --write inserts the changelog section in the project language (T018)', () => {
  const bare = { 'CHANGELOG.md': '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n- first\n' };
  const insert = (dir, config) => applyMechanicalFix(dir, { type: 'insert-changelog-unreleased', file: 'CHANGELOG.md' }, { config });

  it('pt: `## [Não lançado]` plus the marker, never an English heading', () => {
    const dir = project(bare, { language: 'pt-BR' });
    assert.equal(insert(dir, loadConfig(dir)).applied, true);
    const out = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(out, /^## \[Não lançado\]\n<!-- docguard:heading unreleased -->\n\n## \[1\.0\.0\]/m);
    assert.doesNotMatch(out, /Unreleased/);
  });

  it('es: `## [Sin publicar]` plus the marker', () => {
    const dir = project(bare, { language: 'es-MX' });
    insert(dir, loadConfig(dir));
    assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /^## \[Sin publicar\]\n<!-- docguard:heading unreleased -->\n/m);
  });

  it('no docs.language and "en": `## [Unreleased]`, no marker (the legacy block)', () => {
    for (const docs of [undefined, { language: 'en' }]) {
      const dir = project(bare, docs);
      insert(dir, loadConfig(dir));
      const out = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
      assert.match(out, /^## \[Unreleased\]\n\n## \[1\.0\.0\]/m);
      assert.doesNotMatch(out, /docguard:heading/);
    }
  });

  it('is idempotent for an alias heading and a marker', () => {
    const dir = project(log('## [Não lançado]'), { language: 'pt-BR' });
    assert.equal(insert(dir, loadConfig(dir)).applied, false);
    const marked = project(log('## [Em desenvolvimento]\n<!-- docguard:heading unreleased -->'), { language: 'pt-BR' });
    assert.equal(insert(marked, loadConfig(marked)).applied, false);
  });

  it('a language with no set: nothing is written, and the reason is given', () => {
    const dir = project(bare, { language: 'de' });
    const r = insert(dir, loadConfig(dir));
    assert.equal(r.applied, false);
    assert.match(r.skipped, /language/i);
    assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), bare['CHANGELOG.md']);
  });

  it('a caller that passes no config still writes the project language (the project is the authority)', () => {
    const dir = project(bare, { language: 'pt-BR' });
    applyMechanicalFix(dir, { type: 'insert-changelog-unreleased', file: 'CHANGELOG.md' }, {});
    assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /## \[Não lançado\]/);
  });

  it('end to end: guard reports CHG001, `fix --write` clears it with the Portuguese heading', () => {
    const dir = project({ ...bare, 'package.json': '{"name":"x","version":"1.0.0"}\n' }, { language: 'pt-BR' });
    const before = run(dir, ['guard', '--format', 'json']);
    assert.match(before.stdout, /CHG001/);
    const fixed = run(dir, ['fix', '--write']);
    assert.equal(fixed.status === 0 || fixed.status === 2, true, fixed.stderr);
    const out = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(out, /^## \[Não lançado\]\n<!-- docguard:heading unreleased -->/m);
    assert.doesNotMatch(out, /\[Unreleased\]/);
    assert.doesNotMatch(run(dir, ['guard', '--format', 'json']).stdout, /CHG001/);
  });
});
