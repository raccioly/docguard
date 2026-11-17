/**
 * Spec 104, Stage 5 (T039): one committed fixture project per language
 * (`tests/fixtures/languages/{pt-BR,es,de}/`), each reproducing the rows of the
 * Problem table, each run on the v0.48.0 tag (red) and on this branch (green).
 *
 * The v0.48.0 CLI comes from a `git archive` copy of the tag; the test skips,
 * with a reason, when the tag is not in the clone (CI fetches full history).
 * The fixtures are copied out of `tests/` first: DocGuard treats anything under
 * a fixtures folder as not the project's own, so it would read none of them.
 *
 * @req docguard.document-languages#FR-025
 * @req docguard.document-languages#SC-001
 * @req docguard.document-languages#SC-002
 * @req docguard.document-languages#SC-003
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';
import { makeTempDir } from './helpers/temp-dir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests/fixtures/languages');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const TAG = 'v0.48.0';

const temporary = [];
const scratch = prefix => { const dir = makeTempDir(prefix); temporary.push(dir); return dir; };
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const tagExists = (() => { try { fixtureGit(ROOT, ['rev-parse', '--verify', '-q', `${TAG}^{commit}`]); return true; } catch { return false; } })();
const skipNoTag = tagExists ? false : `${TAG} is not in this clone (shallow checkout); CI fetches full history`;

let oldCli = null;
function v048() {
  if (oldCli) return oldCli;
  const dir = scratch('docguard-v048-');
  const tarball = join(dir, '.tag.tar');
  fixtureGit(ROOT, ['archive', '-o', tarball, TAG]);
  assert.equal(spawnSync('tar', ['-x', '-f', tarball, '-C', dir]).status, 0, 'tar extract failed');
  rmSync(tarball, { force: true });
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  oldCli = join(dir, 'cli', 'docguard.mjs');
  return oldCli;
}

/** A fresh, committed copy of a fixture (optionally with changed files), so each CLI sees the same project. */
function copyOf(language, change = () => {}) {
  const dir = scratch(`docguard-fx-${language}-`);
  cpSync(join(FIXTURES, language), dir, { recursive: true });
  change(dir);
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fixture']);
  return dir;
}

function guard(cli, dir) {
  const r = spawnSync(process.execPath, [cli, 'guard', '--format', 'json', '--dir', dir], { encoding: 'utf8', env: ENV, maxBuffer: 1 << 26 });
  const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  return { status: r.status, json, codes: new Set(json.findings.map(f => f.code)), unexamined: json.strict.unexamined || [], couldNotRead: json.strict.couldNotRead || [] };
}
const branch = dir => guard(join(ROOT, 'cli/docguard.mjs'), dir);

// The rows of the Problem table that each language reproduces, as the code each one raises on v0.48.0.
// German has no row for SPK005: its `Phase 1:` is the English word, so that check passes on both sides.
const ROWS = {
  'pt-BR': ['STR003', 'SPK003', 'SPK004', 'SPK005', 'CHG001', 'DEC001', 'DCV005'],
  es: ['STR003', 'SPK003', 'SPK004', 'SPK005', 'CHG001', 'DEC001', 'DCV005'],
  de: ['STR003', 'SPK003', 'SPK004', 'CHG001', 'DEC001', 'DCV005'],
};
// What stays in the fixtures for reasons that have nothing to do with language: a tiny project with no agent file,
// no drift log, no Spec Kit directory and one commit. A retired decision record is a lifecycle finding, in any language.
// DQ007: since T033 the Portuguese and Spanish fixture prose is measured for negation, and two of its eight sentences say "não"/"no" (25%, over the 20% every language shares): a real finding about the prose, not about its language.
const UNRELATED = new Set(['STR001', 'STR002', 'SEC010', 'TRC004', 'SPK002', 'SPK015', 'SPR002', 'DLC001', 'DQ007']);
const LABEL_VALIDATORS = ['docSections', 'testSpec', 'changelog', 'docsCoverage', 'specKit', 'decisionRecords', 'environment'];
const PROSE_VALIDATORS = ['metricsConsistency', 'docsDiff', 'semanticClaims'];
const blockingFor = (run, names) => run.unexamined.filter(u => u.blocking && names.some(n => (u.validator || '') === n));

describe('the v0.48.0 reproduction (red): the reporter\'s table', { skip: skipNoTag }, () => {
  for (const [language, rows] of Object.entries(ROWS)) {
    it(`${language}: every row of the Problem table is a finding, and Test-Spec blocks a strict run`, () => {
      const run = guard(v048(), copyOf(language));
      for (const code of rows) assert.ok(run.codes.has(code), `${language}: ${code} on ${TAG}`);
      assert.equal(blockingFor(run, ['testSpec']).length, 1, 'Test-Spec is empty with needs-declaration and blocks');
      assert.equal(run.unexamined.find(u => u.validator === 'testSpec').cause, 'needs-declaration');
    });
  }
});

describe('the branch (green): SC-001 and SC-002, Portuguese and Spanish', () => {
  for (const language of ['pt-BR', 'es']) {
    describe(language, () => {
      let run;
      before(() => { run = branch(copyOf(language)); });

      it('none of the table\'s rows is a finding, and the findings that remain are not about language', () => {
        for (const code of ROWS[language]) assert.ok(!run.codes.has(code), `${language}: no ${code}`);
        assert.deepEqual([...run.codes].filter(code => !UNRELATED.has(code)), []);
      });

      it('Test-Spec reads its map (not empty), and no label check is blocked or unread', () => {
        assert.deepEqual(blockingFor(run, LABEL_VALIDATORS), []);
        assert.ok(!run.couldNotRead.some(entry => LABEL_VALIDATORS.includes(entry.validator)), 'no label validator lists a document it could not read');
        const testSpec = run.json.validators.find(v => v.key === 'testSpec');
        assert.notEqual(testSpec.verdict, 'empty');
        assert.ok(testSpec.passed >= 1, 'the map row was checked against the files');
      });

      it('passive voice and Flesch are reported as skipped with their reason, never as a number; the reviewed word-list metrics run (T033)', () => {
        const quality = run.json.validators.find(v => v.key === 'docQuality');
        const skipped = quality.skippedMetrics.filter(m => m.document === 'docs-canonical/ARCHITECTURE.md');
        assert.deepEqual(skipped.map(m => m.code).sort(), ['DQ001', 'DQ004', 'DQ005'], 'passive voice and the two Flesch scores are skipped');
        assert.ok(skipped.every(m => m.reason === 'language-not-supported' && (m.language === 'pt' || m.language === 'es')));
        assert.deepEqual(['DQ001', 'DQ004', 'DQ005', 'DQ008'].filter(code => run.codes.has(code)), []);
      });

      it('the prose checks say they do not read this language, and that does not change the verdict', () => {
        assert.deepEqual(run.couldNotRead.map(entry => entry.validator).sort(), [...PROSE_VALIDATORS].sort());
        for (const entry of run.couldNotRead) {
          assert.equal(entry.cause, 'language-not-supported');
          assert.ok(entry.howToConfigure && entry.documents.length > 0);
        }
        assert.ok(run.couldNotRead.every(entry => !entry.blocking));
      });
    });
  }

  it('pt-BR: the reporter\'s own wording ("Feito quando") is read through docs.labelAliases', () => {
    const config = JSON.parse(readFileSync(join(FIXTURES, 'pt-BR/.docguard.json'), 'utf8'));
    assert.deepEqual(config.docs.labelAliases['success-criteria'], ['Feito quando']);
    assert.match(readFileSync(join(FIXTURES, 'pt-BR/specs/001-pedidos/spec.md'), 'utf8'), /^## Feito quando$/m);
  });

  it('pt-BR: ARCHITECTURE carries the first alias a generator writes now, TEST-SPEC keeps the reporter\'s old form on purpose', () => {
    // After the 2026-11-17 review `Stack tecnológica` is the first alias; `Mapa de fontes para testes` stays
    // accepted, and the reporter's table has it, so this fixture is the end-to-end proof that an old form still works.
    assert.match(readFileSync(join(FIXTURES, 'pt-BR/docs-canonical/ARCHITECTURE.md'), 'utf8'), /^## Stack tecnológica$/m);
    assert.match(readFileSync(join(FIXTURES, 'pt-BR/docs-canonical/TEST-SPEC.md'), 'utf8'), /^## Mapa de fontes para testes$/m);
  });
});

describe('the branch (green): SC-003, a language with no built-in set (de)', () => {
  let run;
  before(() => { run = branch(copyOf('de')); });

  it('no label finding, and the label checks list their documents with language-not-supported instead', () => {
    for (const code of ROWS.de) assert.ok(!run.codes.has(code), `de: no ${code}`);
    assert.deepEqual([...run.codes].filter(code => !UNRELATED.has(code)), []);
    const byValidator = new Map(run.couldNotRead.map(entry => [entry.validator, entry]));
    for (const validator of [...LABEL_VALIDATORS.filter(v => v !== 'environment'), ...PROSE_VALIDATORS]) {
      const entry = byValidator.get(validator);
      assert.ok(entry, `${validator} is listed`);
      assert.equal(entry.cause, 'language-not-supported');
      assert.match(entry.reason, /de/);
      assert.ok(entry.howToConfigure, `${validator} names the fix`);
    }
  });

  it('Test-Spec does not block a strict run over a map it cannot read in German', () => {
    assert.deepEqual(blockingFor(run, LABEL_VALIDATORS), []);
    assert.ok(!run.unexamined.some(u => u.validator === 'testSpec'));
  });

  it('no metric number is printed: Doc-Quality has nothing scored to report for the German prose', () => {
    const quality = run.json.validators.find(v => v.key === 'docQuality');
    assert.ok(quality.skippedMetrics.length >= 5);
    assert.ok(quality.skippedMetrics.every(m => m.language === 'de' && m.reason === 'language-not-supported'));
    assert.deepEqual(['DQ001', 'DQ002', 'DQ003', 'DQ004', 'DQ005', 'DQ007', 'DQ008'].filter(code => run.codes.has(code)), []);
  });

  it('the exit code is the exit code of the same project with every label declared', () => {
    const declared = branch(copyOf('de', dir => declareAll(dir, 'markers')));
    assert.equal(run.status, declared.status);
  });

  for (const how of ['markers', 'aliases']) {
    it(`adding ${how === 'markers' ? 'a <!-- docguard:heading --> marker under each heading and docs.labelAliases for the words' : 'docs.labelAliases for every label'} removes the label entries`, () => {
      const fixed = branch(copyOf('de', dir => declareAll(dir, how)));
      assert.deepEqual(fixed.couldNotRead.map(entry => entry.validator).filter(v => LABEL_VALIDATORS.includes(v)), []);
      for (const code of ROWS.de) assert.ok(!fixed.codes.has(code), `de (${how}): no ${code}`);
      assert.ok(!fixed.unexamined.some(u => u.validator === 'testSpec'));
      // The prose checks still have no rules for German: that is not a label.
      assert.deepEqual(fixed.couldNotRead.map(entry => entry.validator).sort(), [...PROSE_VALIDATORS].sort());
    });
  }
});

/** The German fixture's headings and words, declared with markers (headings) or `docs.labelAliases` (everything). */
const DE_HEADINGS = {
  'docs-canonical/ARCHITECTURE.md': [['Systemüberblick', 'system-overview'], ['Komponentenübersicht', 'component-map'], ['Technologie-Stack', 'tech-stack']],
  'docs-canonical/TEST-SPEC.md': [['Testkategorien', 'test-categories'], ['Abdeckungsregeln', 'coverage-rules'], ['Zuordnung von Quellen zu Tests', 'source-to-test-map']],
  'README.md': [['Verwendung', 'usage'], ['Lizenz', 'license']],
  'specs/001-pedidos/spec.md': [['Benutzerszenarien', 'user-scenarios'], ['Funktionale Anforderungen', 'requirements'], ['Erfolgskriterien', 'success-criteria']],
  'specs/001-pedidos/plan.md': [['Zusammenfassung', 'summary'], ['Technischer Kontext', 'technical-context'], ['Projektstruktur', 'project-structure']],
  'CHANGELOG.md': [['[Unveröffentlicht]', 'unreleased']],
};
const DE_WORDS = { accepted: ['Akzeptiert'], superseded: ['Ersetzt'], 'superseded-by': ['Ersetzt durch'], supersedes: ['Ersetzt'] };

function declareAll(dir, how) {
  const configPath = join(dir, '.docguard.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const aliases = { ...DE_WORDS };
  for (const [file, headings] of Object.entries(DE_HEADINGS)) {
    const path = join(dir, file);
    let text = readFileSync(path, 'utf8');
    for (const [heading, id] of headings) {
      if (how === 'markers') text = text.replace(new RegExp(`^(#{2,3} ${heading.replace(/[[\]]/g, '\\$&')})$`, 'm'), `$1\n<!-- docguard:heading ${id} -->`);
      else aliases[id] = [heading.replace(/^\[|\]$/g, '')];
    }
    writeFileSync(path, text);
  }
  config.docs.labelAliases = aliases;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
