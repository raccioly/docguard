/**
 * Spec 105, Stage 2: the Glossary validator (`validateGlossary`, GLS001 to GLS004).
 *
 * Fixture projects are temporary directories whose `.docguard.json` pins `"enforcement":
 * "standard"`, so one validator is read at a time. The validator is called directly; the guard
 * checks at the end read the same result through `runGuardInternal` for the level and the contract.
 *
 * @req docguard.glossary-and-plain-writing#FR-001
 * @req docguard.glossary-and-plain-writing#FR-007
 * @req docguard.glossary-and-plain-writing#FR-008
 * @req docguard.glossary-and-plain-writing#FR-011
 * @req docguard.glossary-and-plain-writing#FR-012
 * @req docguard.glossary-and-plain-writing#FR-013
 * @req docguard.glossary-and-plain-writing#FR-014
 * @req docguard.glossary-and-plain-writing#FR-015
 * @req docguard.glossary-and-plain-writing#FR-026
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { applies, validateGlossary } from '../cli/validators/glossary.mjs';
import { glossaryDocuments, glossaryPath } from '../cli/shared-glossary.mjs';
import { validateResultContract } from '../cli/validator-coverage.mjs';

const TABLE = (...rows) => ['# Glossary', '', '| Use | Avoid | Meaning |', '|---|---|---|', ...rows, ''].join('\n');
const CONFIG_ROW = '| configuration | config, conf | How the tool is set up |';

function project(files, config = {}) {
  const dir = makeTempDir('docguard-glossary-');
  const all = { '.docguard.json': JSON.stringify({ projectName: 'g', version: '0.6', enforcement: 'standard', ...config }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const run = dir => validateGlossary(dir, loadConfig(dir));
const gls = (result, code) => (result.findings || []).filter(f => f.code === code);
const locations = result => (result.findings || []).map(f => `${f.code}@${f.location}`);

describe('GLS001: a document uses a term the glossary says to avoid (FR-011)', () => {
  it('reports prose at its line, names the Use term, and ignores inline code', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE(CONFIG_ROW),
      'README.md': ['# Project', '', 'The tool is small.', 'It reads files.', 'It writes files.', 'It is fast.', 'The config sets the paths.', '', 'Run `config` to see it.', ''].join('\n'),
    });
    const r = run(dir);
    const findings = gls(r, 'GLS001');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].location, 'README.md:7');
    assert.match(findings[0].message, /"config" is on the glossary's avoid list; use "configuration"/);
    assert.match(findings[0].message, /Found on 1 line: 7/);
    assert.equal(findings[0].suggestion.kind, 'fix');
    assert.equal(findings[0].severity, 'warn');
    assert.deepEqual(r.errors, []);
  });

  it('reports one finding per document and term, with the count and the first five lines', () => {
    const lines = Array.from({ length: 14 }, (_, i) => (i % 5 === 4 ? 'A plain line.' : `Line ${i + 1} sets the config.`));
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': `# R\n\n${lines.join('\n')}\n`, 'docs/guide.md': '# G\n\nThe conf is here.\n' });
    const r = run(dir);
    const readme = gls(r, 'GLS001').find(f => f.location.startsWith('README.md'));
    assert.equal(gls(r, 'GLS001').filter(f => f.location.startsWith('README.md')).length, 1);
    assert.match(readme.message, /Found on 12 lines: 3, 4, 5, 6, 8 and 7 more/);
    assert.equal(readme.location, 'README.md:3');
    assert.equal(gls(r, 'GLS001').length, 2, 'one more for docs/guide.md and its own term');
    assert.match(gls(r, 'GLS001').find(f => f.location.startsWith('docs/guide.md')).message, /"conf"/);
  });

  it('reports two Avoid terms of one row as two findings in the same document', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config and the conf.\n' });
    assert.deepEqual(locations(run(dir)), ['GLS001@README.md:3', 'GLS001@README.md:3']);
  });

  it('reports a plural and a capital, and not a longer word or code', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE(CONFIG_ROW),
      'README.md': ['# R', '', 'Two configs. Config first.', 'The configuration is fine, and so is `config`.', '```', 'config', '```', ''].join('\n'),
    });
    const [finding] = gls(run(dir), 'GLS001');
    assert.match(finding.message, /Found on 1 line: 3/);
  });

  it('does not report spec inside Spec Kit', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE('| Spec Kit | spec | The toolkit |'), 'README.md': '# R\n\nWe use Spec Kit.\n' });
    assert.deepEqual(gls(run(dir), 'GLS001'), []);
  });

  it('does not report a conflicting term, and reports the conflict instead', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE('| spec | specification |', '| specification | spec |'), 'README.md': '# R\n\nThe spec and the specification.\n' });
    const r = run(dir);
    assert.deepEqual(gls(r, 'GLS001'), []);
    assert.deepEqual(locations(r), ['GLS003@docs/GLOSSARY.md:5', 'GLS003@docs/GLOSSARY.md:6']);
  });
});

describe('waivers (FR-012)', () => {
  const doc = body => project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': `# R\n\n${body}\n` });

  it('skips a line with docguard:ignore GLS001, and reports the others', () => {
    const r = run(doc('One config. <!-- docguard:ignore GLS001 — a file name here -->\nTwo config.'));
    assert.match(gls(r, 'GLS001')[0].message, /Found on 1 line: 4/);
  });

  it('honors the ignore pragma for the code it names only', () => {
    const r = run(doc('One config. <!-- docguard:ignore DQ009 — wrong code -->'));
    assert.equal(gls(r, 'GLS001').length, 1);
  });

  it('skips a document that says glossary off, and counts no check for it', () => {
    const r = run(doc('<!-- docguard:glossary off — this page quotes old names -->\nThe config.'));
    assert.deepEqual(gls(r, 'GLS001'), []);
    assert.equal(r.performed, 1, 'only the lookup');
  });

  it('exempts the terms an allow marker names, in that document only', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE(CONFIG_ROW),
      'README.md': '# R\n\n<!-- docguard:glossary allow config — it is a file name here -->\nThe config and the conf.\n',
      'docs/guide.md': '# G\n\nThe config.\n',
    });
    const r = run(dir);
    assert.deepEqual(locations(r).sort(), ['GLS001@README.md:4', 'GLS001@docs/guide.md:3']);
    assert.match(gls(r, 'GLS001').find(f => f.location.startsWith('README')).message, /"conf"/);
  });

  it('accepts several terms in one allow marker', () => {
    const r = run(doc('<!-- docguard:glossary allow config, conf — file names -->\nThe config and the conf.'));
    assert.deepEqual(gls(r, 'GLS001'), []);
  });

  it('does not read a marker written in inline code or a fence', () => {
    const r = run(doc('Write `<!-- docguard:glossary off -->` to skip. The config.\n```\n<!-- docguard:glossary off -->\n```'));
    assert.equal(gls(r, 'GLS001').length, 1);
  });
});

describe('the documents (FR-008)', () => {
  const GLOSSARY = TABLE(CONFIG_ROW);
  const BAD = '# Doc\n\nThe config.\n';

  it('checks canonical documents, README files, the documentation homes and docs.dirs', () => {
    const dir = project({
      'docs/GLOSSARY.md': GLOSSARY,
      'README.md': BAD, 'README.pt.md': BAD,
      'docs-canonical/ARCHITECTURE.md': BAD,
      'docs/guide.md': BAD, 'docs/deep/more.md': BAD, 'guides/start.md': BAD, 'handbook-x/a.md': BAD,
    }, { docs: { dirs: ['handbook-x'] } });
    const files = glossaryDocuments(dir, loadConfig(dir)).map(d => d.rel);
    assert.deepEqual(files, ['README.md', 'README.pt.md', 'docs-canonical/ARCHITECTURE.md', 'docs/deep/more.md', 'docs/guide.md', 'guides/start.md', 'handbook-x/a.md']);
    assert.equal(gls(run(dir), 'GLS001').length, 7);
  });

  it('leaves out the glossary, the changelog, the drift log, specs, decision records, agent files, backups, generated and ignored files', () => {
    const dir = project({
      'docs/GLOSSARY.md': GLOSSARY.replace('How the tool', 'The config; how the tool'),
      'README.md': '# R\n\nClean.\n',
      'CHANGELOG.md': BAD, 'DRIFT-LOG.md': BAD, 'docs/CHANGELOG.md': BAD,
      'specs/001-x/spec.md': BAD,
      'AGENTS.md': BAD, 'CLAUDE.md': BAD, 'docs/AGENTS.md': BAD,
      'docs/adr/0001-use-it.md': BAD, 'docs/decisions/note.md': BAD, 'docs/ADR-002-thing.md': BAD,
      'docs/archive/old.md': BAD, 'docs/guide copy.md': BAD, 'docs/guide.md.bak': BAD,
      'docs/ignored/page.md': BAD,
      'docs/node_modules/x.md': BAD,
    });
    writeFileSync(join(dir, '.docguardignore'), 'docs/ignored/\n');
    assert.deepEqual(glossaryDocuments(dir, loadConfig(dir)).map(d => d.rel), ['README.md']);
    assert.deepEqual(gls(run(dir), 'GLS001'), []);
  });

  it('keeps a document whose name merely contains adr or decision text inside another word', () => {
    const dir = project({ 'docs/GLOSSARY.md': GLOSSARY, 'docs/address-book.md': BAD, 'docs/adr.md': BAD, 'docs/decision-log.md': BAD });
    assert.deepEqual(glossaryDocuments(dir, loadConfig(dir)).map(d => d.rel), ['docs/address-book.md']);
  });

  it('gives each finding the path of its own document when two share a name', () => {
    const dir = project({ 'docs/GLOSSARY.md': GLOSSARY, 'docs/a/guide.md': BAD, 'docs/b/guide.md': BAD });
    assert.deepEqual(locations(run(dir)), ['GLS001@docs/a/guide.md:3', 'GLS001@docs/b/guide.md:3']);
  });

  it('applies when a document exists and not otherwise (FR-015)', () => {
    assert.equal(applies(project({ 'README.md': '# R\n' }), {}).applies, true);
    const bare = project({ 'src/index.js': 'x\n' });
    const a = applies(bare, {});
    assert.equal(a.applies, false);
    assert.ok(a.evidence.length > 10);
  });
});

describe('the glossary file (FR-001)', () => {
  it('uses docs.glossary when set, and the lookup order otherwise', () => {
    const dir = project({ 'docs/GLOSSARY.md': 'free form', 'docs-canonical/GLOSSARY.md': 'x', 'GLOSSARY.md': 'x', 'meta/terms.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n' }, { docs: { glossary: 'meta/terms.md' } });
    assert.equal(glossaryPath(dir, loadConfig(dir)).rel, 'meta/terms.md');
    assert.equal(gls(run(dir), 'GLS001').length, 1);

    const order = project({ 'GLOSSARY.md': 'root', 'docs-canonical/GLOSSARY.md': 'canonical' });
    assert.equal(glossaryPath(order, {}).rel, 'docs-canonical/GLOSSARY.md');
    const docs = project({ 'GLOSSARY.md': 'root', 'docs-canonical/GLOSSARY.md': 'canonical', 'docs/GLOSSARY.md': 'docs' });
    assert.equal(glossaryPath(docs, {}).rel, 'docs/GLOSSARY.md');
    assert.equal(glossaryPath(project({ 'GLOSSARY.md': 'root' }), {}).rel, 'GLOSSARY.md');
    const none = glossaryPath(project({}), {});
    assert.deepEqual([none.rel, none.exists], ['docs/GLOSSARY.md', false]);
  });

  it('ignores an invalid docs.glossary and falls back to the lookup', () => {
    for (const bad of ['../outside.md', '/abs/x.md', 'notes.txt', 42]) {
      const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n' });
      assert.equal(glossaryPath(dir, { docs: { glossary: bad } }).rel, 'docs/GLOSSARY.md', String(bad));
    }
  });

  it('checks the documents against a glossary at a configured path outside the documentation homes', () => {
    const dir = project({ 'terms/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n' }, { docs: { glossary: 'terms/GLOSSARY.md' } });
    assert.equal(gls(run(dir), 'GLS001').length, 1);
  });
});

describe('GLS002 and GLS003 sit at the glossary line (FR-005, FR-006)', () => {
  it('reports a row with no Use term and does not check its terms', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE('| | config |'), 'README.md': '# R\n\nThe config.\n' });
    const r = run(dir);
    assert.deepEqual(locations(r), ['GLS002@docs/GLOSSARY.md:5']);
    assert.equal(gls(r, 'GLS002')[0].severity, 'warn');
  });

  it('reports the second line of a repeated Use term', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW, '| configuration | cfg |'), 'README.md': '# R\n\nClean.\n' });
    assert.deepEqual(locations(run(dir)), ['GLS002@docs/GLOSSARY.md:6']);
  });

  it('reports a free-form glossary as GLS004 only', () => {
    const dir = project({ 'docs/GLOSSARY.md': '# Glossary\n\n## Config\n\nThe settings.\n', 'README.md': '# R\n\nThe config.\n' });
    const r = run(dir);
    assert.deepEqual(locations(r), ['GLS004@docs/GLOSSARY.md']);
    assert.match(r.findings[0].message, /no table with a Use column and an Avoid column/);
    assert.equal(r.performed, 1);
  });
});

describe('GLS004: no glossary (FR-007, FR-015, FR-026)', () => {
  it('reports it once, with the command that writes a starter, and performs the lookup as one check', () => {
    const dir = project({ 'README.md': '# R\n\nThe config.\n' });
    const r = run(dir);
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].code, 'GLS004');
    assert.equal(r.findings[0].suggestion.command, 'docguard init --with glossary');
    assert.match(r.findings[0].message, /No glossary found/);
    assert.equal(r.performed, 1);
    assert.equal(r.applies.applies, true);
    assert.equal(r.emptyCause, undefined);
  });

  it('is informational in guard and does not add a warning to the run', () => {
    const dir = project({ 'README.md': '# R\n\nThe config.\n' });
    const data = runGuardInternal(dir, loadConfig(dir));
    const v = data.validators.find(x => x.key === 'glossary');
    assert.equal(v.findings[0].code, 'GLS004');
    assert.equal(v.findings[0].effectiveSeverity, 'info');
    assert.equal(v.effectiveWarnings, 0);
    assert.equal(v.effectiveErrors, 0);
  });

  it('is GLS001 at warn in guard once the glossary exists (FR-026)', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n' });
    const v = runGuardInternal(dir, loadConfig(dir)).validators.find(x => x.key === 'glossary');
    assert.equal(v.findings[0].effectiveSeverity, 'warn');
  });

  it('can be raised or lowered with findingSeverity', () => {
    const dir = project({ 'README.md': '# R\n\nThe config.\n' }, { findingSeverity: { GLS004: 'medium' } });
    const v = runGuardInternal(dir, loadConfig(dir)).validators.find(x => x.key === 'glossary');
    assert.equal(v.findings[0].effectiveSeverity, 'warn');
  });
});

describe('the result contract (FR-014, FR-015)', () => {
  it('carries performed, applies and a complete contract in every state', () => {
    const states = {
      'no documents': project({ 'src/a.js': 'x\n' }),
      'no glossary': project({ 'README.md': '# R\n' }),
      'glossary, clean': project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nClean.\n' }),
      'glossary, finding': project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n' }),
    };
    for (const [name, dir] of Object.entries(states)) {
      const v = runGuardInternal(dir, loadConfig(dir)).validators.find(x => x.key === 'glossary');
      assert.deepEqual(validateResultContract(v), [], name);
      assert.ok(Number.isInteger(v.performed), name);
    }
  });

  it('performs one check for the lookup and one per document checked, so it is never empty when it applies', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nClean.\n', 'docs/a.md': '# A\n\nClean.\n', 'docs/b.md': '# B\n\nThe config.\n' });
    const r = run(dir);
    assert.equal(r.performed, 4);
    assert.equal(r.total, 4);
    assert.equal(r.passed, 3);
    assert.equal(r.applies.applies, true);
    assert.equal(r.emptyCause, undefined);
  });

  it('counts no document against a glossary with nothing to avoid', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(), 'README.md': '# R\n\nThe config.\n' });
    const r = run(dir);
    assert.equal(r.performed, 1);
    assert.deepEqual(r.findings, []);
  });

  it('is empty only when there is no document, with a cause, a fix and a sentence no other validator uses', () => {
    const dir = project({ 'src/a.js': 'x\n' });
    const r = run(dir);
    assert.equal(r.performed, 0);
    assert.equal(r.emptyCause, 'nothing-of-this-kind');
    assert.equal(r.applies.applies, false);
    assert.ok(r.howToConfigure.length > 20);
    assert.match(r.note, /^Glossary found no document/);
  });

  it('is registered in guard under the key glossary and the name Glossary', () => {
    const dir = project({ 'README.md': '# R\n' });
    const v = runGuardInternal(dir, loadConfig(dir)).validators.find(x => x.key === 'glossary');
    assert.equal(v.name, 'Glossary');
  });
});

describe('documents in another language (FR-013)', () => {
  it('checks a document in the glossary language and lists the others as language-not-supported', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE('| repositório | repo | A pasta |'),
      'README.md': '# R\n\nO repo novo.\n',
      'docs/guide.en.md': '# G\n\nThe repo.\n',
      'docs/guia.es.md': '# G\n\nEl repo.\n',
    }, { docs: { language: 'pt-BR' } });
    const r = run(dir);
    assert.deepEqual(locations(r), ['GLS001@README.md:3']);
    assert.deepEqual(r.unexaminedDocuments.map(d => [d.path, d.cause, d.blocking]), [
      ['docs/guia.es.md', 'language-not-supported', false],
      ['docs/guide.en.md', 'language-not-supported', false],
    ]);
    for (const d of r.unexaminedDocuments) assert.ok(d.reason && d.howToConfigure);
    assert.equal(r.performed, 2);
  });

  it('never changes the exit code: the strict report does not block on it', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE('| repositório | repo | A pasta |'),
      'README.md': '# R\n\nClean.\n',
      'docs/guide.en.md': '# G\n\nClean.\n',
    }, { docs: { language: 'pt' }, enforcement: 'strict' });
    const data = runGuardInternal(dir, loadConfig(dir));
    assert.ok(!data.strict.blocking.includes('glossary'));
  });

  it('checks every document when docs.language is not set', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW), 'README.md': '# R\n\nThe config.\n', 'README.pt.md': '# R\n\nO config.\n' });
    const r = run(dir);
    assert.equal(gls(r, 'GLS001').length, 2);
    assert.equal(r.unexaminedDocuments, undefined);
  });

  it('exempts the required headings of the document language (pt)', () => {
    const dir = project({
      'docs/GLOSSARY.md': TABLE('| nível | camadas |'),
      'docs-canonical/ARCHITECTURE.md': '# Arquitetura\n\n## Camadas\n\nTexto limpo.\n',
    }, { docs: { language: 'pt-BR' } });
    assert.deepEqual(gls(run(dir), 'GLS001'), []);
  });
});

describe('the same answer twice, in the same order', () => {
  it('is deterministic', () => {
    const dir = project({ 'docs/GLOSSARY.md': TABLE(CONFIG_ROW, '| Spec Kit | spec |'), 'README.md': '# R\n\nThe config and a spec.\n', 'docs/a.md': '# A\n\nThe conf.\n' });
    assert.deepEqual(JSON.stringify(run(dir)), JSON.stringify(run(dir)));
  });
});
