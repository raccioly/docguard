/**
 * Spec 104, Stage 3: `language-not-supported` is the one cause a check that
 * cannot judge a document's language reports, and strict reads it as "could not
 * read": never exit 4, never dropped, never labeled "ownership is not
 * established", one line per validator in the guard text.
 *
 * One mechanism, not two: Stage 1 and 2 carried the same fact in a validator
 * field `languageNotSupported` plus a `partial` applicability. Both are gone;
 * a validator that left documents unjudged for their language lists them in
 * `unexaminedDocuments` with this cause, and a validator that judged nothing
 * for it is `empty` with this `emptyCause`.
 *
 * All tests below were red on origin/main. The two marked "guard" pin what must
 * not move and pass there by construction.
 *
 * @req docguard.document-languages#FR-019
 * @req docguard.document-languages#FR-022
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { EMPTY_CAUSES, validateResultContract } from '../cli/validator-coverage.mjs';
import { buildStrictReport, couldNotReadLines } from '../cli/enforcement.mjs';
import { validateDocsDiff } from '../cli/validators/docs-diff.mjs';
import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';
import { extractSemanticClaims, claimDocumentsNotSupported } from '../cli/scanners/semantic-claims.mjs';

const CLI = resolve('cli/docguard.mjs');
const PROSE = '\nParagrafo um de texto real que descreve a coisa.\nParagrafo dois de texto real que descreve a coisa.\nParagrafo tres de texto real que descreve a coisa.\nParagrafo quatro de texto real que descreve a coisa.\nParagrafo cinco de texto real que descreve a coisa.\nParagrafo seis de texto real que descreve a coisa.\n';

function project(files, docs, extra = {}) {
  const dir = makeTempDir('docguard-lang-strict-');
  const all = { ...files };
  if (docs || Object.keys(extra).length) all['.docguard.json'] = JSON.stringify({ ...(docs ? { docs } : {}), ...extra });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const ARCH_DE = `# Architektur\n\n## Systemübersicht\n${PROSE}\n## Komponenten\n\nx\n\n## Technologien\n\nNode\n`;
const ENV_DE = `# Umgebung\n\n## Einrichtung\n${PROSE}\n## Umgebungsvariablen\n\nx\n`;
const ARCH_DE_MARKED = `# Architektur\n\n## Systemübersicht\n<!-- docguard:heading system-overview -->\n${PROSE}\n## Komponenten\n<!-- docguard:heading component-map -->\n\nx\n\n## Technologien\n<!-- docguard:heading tech-stack -->\n\nNode\n`;
const ENV_DE_MARKED = `# Umgebung\n\n## Einrichtung\n<!-- docguard:heading setup-steps -->\n${PROSE}\n## Umgebungsvariablen\n<!-- docguard:heading environment-variables -->\n\nx\n`;
const BASE = { 'AGENTS.md': '# Agents\n\nRules.\n', 'README.md': '# T\n\n## Installation\n\nx\n\n## Usage\n\nx\n\n## License\n\nMIT\n', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' };

const guardJson = (dir, ...flags) => {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, '--format', 'json', ...flags], { encoding: 'utf8' });
  return { exit: r.status, report: JSON.parse(r.stdout) };
};

describe('T029: the cause is registered and the contract accepts it', () => {
  it('EMPTY_CAUSES carries language-not-supported', () => {
    assert.ok(EMPTY_CAUSES.includes('language-not-supported'));
  });

  it('an empty result with that cause and a fix is complete; applies is true for it', () => {
    const result = { key: 'docQuality', findings: [], errors: [], warnings: [], performed: 0, applies: { applies: true, evidence: '1 document to score' }, emptyCause: 'language-not-supported', howToConfigure: 'Ask for a built-in set.' };
    assert.deepEqual(validateResultContract(result), []);
  });
});

describe('T029: buildStrictReport routes the cause to couldNotRead at both levels', () => {
  const doc = (path, extra = {}) => ({ path, cause: 'language-not-supported', blocking: false, language: 'de', tag: 'de', reason: `${path}: 3 section(s) not judged`, howToConfigure: 'Write <!-- docguard:heading <id> --> under each heading.', ...extra });

  it('validator level: an empty validator with the cause is couldNotRead with its fix, not unexamined', () => {
    const report = buildStrictReport([{ key: 'docsDiff', name: 'Docs-Diff', verdict: 'empty', emptyCause: 'language-not-supported', performed: 0, findings: [], applicability: { status: 'no-matches', reason: 'every document is in "de"' }, howToConfigure: 'Add the words to docs.labelAliases.' }]);
    assert.deepEqual(report.unexamined, []);
    assert.deepEqual(report.blocking, []);
    assert.equal(report.couldNotRead.length, 1);
    assert.equal(report.couldNotRead[0].cause, 'language-not-supported');
    assert.equal(report.couldNotRead[0].howToConfigure, 'Add the words to docs.labelAliases.');
  });

  it('document level: a validator that passed on the rest lists its documents, one row per validator', () => {
    const report = buildStrictReport([{ key: 'docSections', name: 'Doc-Sections', verdict: 'pass', performed: 4, findings: [], unexaminedDocuments: [doc('docs-canonical/A.md'), doc('docs-canonical/B.md'), doc('docs-canonical/C.md'), doc('docs-canonical/D.md')] }]);
    assert.deepEqual(report.unexamined, []);
    assert.equal(report.couldNotRead.length, 1);
    const [row] = report.couldNotRead;
    assert.equal(row.validator, 'docSections');
    assert.equal(row.cause, 'language-not-supported');
    assert.deepEqual(row.documents, ['docs-canonical/A.md', 'docs-canonical/B.md', 'docs-canonical/C.md', 'docs-canonical/D.md']);
    assert.equal(row.language, 'de');
    assert.match(row.howToConfigure, /docguard:heading/);
  });

  it('it is never labeled "ownership is not established", and a blocking flag cannot make it block', () => {
    const report = buildStrictReport([{ key: 'environment', name: 'Environment', verdict: 'pass', performed: 2, findings: [], unexaminedDocuments: [doc('docs-canonical/ENVIRONMENT.md', { blocking: true })] }]);
    assert.deepEqual(report.blocking, []);
    assert.deepEqual(report.unexamined, []);
    for (const row of report.couldNotRead) assert.doesNotMatch(row.reason, /ownership is not established/);
    assert.match(report.couldNotRead[0].reason, /language-not-supported|"de"/);
  });

  it('a validator both empty for the cause and listing documents is one row, with the documents', () => {
    const report = buildStrictReport([{ key: 'docQuality', name: 'Doc-Quality', verdict: 'empty', emptyCause: 'language-not-supported', performed: 0, findings: [], howToConfigure: 'fix', unexaminedDocuments: [doc('README.md')] }]);
    assert.equal(report.couldNotRead.filter(r => r.validator === 'docQuality').length, 1);
    assert.deepEqual(report.couldNotRead[0].documents, ['README.md']);
  });

  it('documents with other causes keep their routes: needs-content blocks, history-unavailable and ownership are unchanged (guard)', () => {
    const report = buildStrictReport([{ key: 'freshness', name: 'Freshness', verdict: 'pass', performed: 3, findings: [], unexaminedDocuments: [
      { path: 'AGENTS.md', cause: 'needs-content', blocking: true, reason: 'no review', howToConfigure: 'review it' },
      { path: 'X.md', cause: 'needs-declaration', blocking: false, reason: 'not owned', howToConfigure: 'declare it' },
      doc('docs-canonical/A.md'),
    ] }]);
    assert.deepEqual(report.blocking, ['freshness']);
    assert.equal(report.unexamined.length, 1);
    assert.equal(report.couldNotRead.length, 2);
    assert.ok(report.couldNotRead.some(r => r.cause === 'language-not-supported'));
    assert.ok(report.couldNotRead.some(r => /ownership is not established/.test(r.reason)));
  });

  it('the text prints one line per validator, with the language, the count and the fix', () => {
    const report = buildStrictReport([
      { key: 'docSections', name: 'Doc-Sections', verdict: 'pass', performed: 2, findings: [], unexaminedDocuments: [doc('a.md'), doc('b.md')] },
      { key: 'environment', name: 'Environment', verdict: 'pass', performed: 2, findings: [], unexaminedDocuments: [doc('c.md')] },
    ]);
    const lines = couldNotReadLines(report).filter(l => /language-not-supported/.test(l));
    assert.equal(lines.length, 2, `one line per validator: ${JSON.stringify(lines)}`);
    assert.match(lines[0], /Doc-Sections/);
    assert.match(lines[0], /"de"/);
    assert.match(lines[0], /2 document/);
    assert.match(lines[0], /docguard:heading/);
  });
});

describe('T029: the de project in strict mode (end to end)', () => {
  const de = docs => project({ ...BASE, 'docs-canonical/ARCHITECTURE.md': ARCH_DE, 'docs-canonical/ENVIRONMENT.md': ENV_DE }, docs);
  const marked = docs => project({ ...BASE, 'docs-canonical/ARCHITECTURE.md': ARCH_DE_MARKED, 'docs-canonical/ENVIRONMENT.md': ENV_DE_MARKED }, docs);

  it('the documents are in strict.couldNotRead with the cause, the language and the fix; nothing is unexamined', () => {
    const { report } = guardJson(de({ language: 'de' }));
    const rows = (report.strict.couldNotRead || []).filter(r => r.cause === 'language-not-supported');
    const byValidator = Object.fromEntries(rows.map(r => [r.validator, r]));
    for (const key of ['docSections', 'environment']) {
      assert.ok(byValidator[key], `${key} is listed: ${JSON.stringify(report.strict.couldNotRead.map(r => r.validator))}`);
      assert.equal(byValidator[key].language, 'de');
      assert.match(byValidator[key].howToConfigure, /docguard:heading|docs\.labelAliases/);
      assert.ok([].concat(byValidator[key].documents).length >= 1 || byValidator[key].documents >= 1);
    }
    assert.equal(rows.length, new Set(rows.map(r => r.validator)).size, 'one row per validator');
    assert.deepEqual(report.strict.unexamined.map(u => u.validator).filter(v => ['docSections', 'environment'].includes(v)), []);
  });

  it('no validator is inconclusive because of it, so no flag turns it into exit 4', () => {
    const { report } = guardJson(de({ language: 'de' }));
    for (const v of report.validators) assert.ok(!(v.applicability?.reason || '').startsWith('language-not-supported'), `${v.key} still carries a partial applicability`);
    const german = guardJson(de({ language: 'de' }), '--fail-on-inconclusive');
    const marked_ = guardJson(marked({ language: 'de' }), '--fail-on-inconclusive');
    assert.equal(german.exit, marked_.exit, 'the same exit code as the same project with every heading marked');
  });

  it('the exit code equals the same project\'s without the unsupported documents (markers on every heading)', () => {
    assert.equal(guardJson(de({ language: 'de' })).exit, guardJson(marked({ language: 'de' })).exit);
  });

  it('adding a marker or a docs.labelAliases entry removes the document from couldNotRead', () => {
    const { report } = guardJson(marked({ language: 'de' }));
    const rows = (report.strict.couldNotRead || []).filter(r => r.cause === 'language-not-supported');
    assert.ok(!rows.some(r => r.validator === 'docSections' || r.validator === 'environment'));
    const aliased = guardJson(de({ language: 'de', labelAliases: { 'system-overview': ['Systemübersicht'], 'component-map': ['Komponenten'], 'tech-stack': ['Technologien'], 'setup-steps': ['Einrichtung'], 'environment-variables': ['Umgebungsvariablen'] } }));
    const rows2 = (aliased.report.strict.couldNotRead || []).filter(r => r.cause === 'language-not-supported');
    assert.ok(!rows2.some(r => r.validator === 'docSections' || r.validator === 'environment'));
  });

  it('the text prints one line per validator that carries the cause', () => {
    const dir = de({ language: 'de' });
    const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir], { encoding: 'utf8' });
    const lines = r.stdout.split('\n').filter(l => /language-not-supported/.test(l) && l.includes('•'));
    assert.ok(lines.length >= 2, r.stdout);
    const names = lines.map(l => l.replace(/^\s*•\s*/, '').split(/[:(]/)[0].trim());
    assert.equal(new Set(names).size, names.length, `a validator is printed twice: ${names}`);
    assert.ok(names.includes('Doc Sections') && names.includes('Environment'), names.join(' | '));
  });

  it('a project without docs.language has no such entry and the same exit code as before (guard)', () => {
    const { report } = guardJson(de({}));
    assert.ok(!(report.strict.couldNotRead || []).some(r => r.cause === 'language-not-supported'));
    assert.ok(!JSON.stringify(report).includes('language-not-supported'));
  });
});

describe('T030: validators that read English prose report a document in another language', () => {
  const pkg = JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { express: '^4.0.0' } });
  const files = {
    'package.json': pkg,
    'docs-canonical/ARCHITECTURE.md': '# Arquitetura\n\n## Pilha tecnológica\n\nUsamos Express e Redis.\n',
    'docs-canonical/TEST-SPEC.md': '# Testes\n\nNada ainda.\n',
    'README.md': '# Projeto\n\nO projeto tem 10 validadores e 3 dependências de execução.\n',
    'AGENTS.md': '# Agents\n\nThis project has 10 validators and zero runtime dependencies.\n',
  };
  const listed = r => (r.unexaminedDocuments || []).filter(d => d.cause === 'language-not-supported').map(d => d.path).sort();

  it('Docs-Diff lists the architecture document it would have read for the tech stack', () => {
    const dir = project(files, { language: 'pt-BR' });
    assert.deepEqual(listed(validateDocsDiff(dir, loadConfig(dir))), ['docs-canonical/ARCHITECTURE.md']);
  });

  it('Docs-Diff is silent without docs.language and for English (guard)', () => {
    for (const docs of [undefined, { language: 'en' }]) {
      const dir = project(files, docs);
      assert.equal(validateDocsDiff(dir, loadConfig(dir)).unexaminedDocuments, undefined);
    }
  });

  it('Docs-Diff keeps comparing the test files, which are language-neutral', () => {
    const dir = project({ ...files, 'tests/a.test.js': 'x', 'docs-canonical/TEST-SPEC.md': '# Testes\n\n| Arquivo |\n|---|\n| `tests/a.test.js` |\n| `tests/gone.test.js` |\n' }, { language: 'pt-BR' });
    const r = validateDocsDiff(dir, loadConfig(dir));
    assert.ok((r.findings || []).some(f => f.code === 'DDF002' || /tests\/gone\.test\.js/.test(f.message)), JSON.stringify(r.findings));
  });

  it('Metrics-Consistency lists the documents it would have read, and never an agent-instruction file', () => {
    const dir = project(files, { language: 'pt-BR' });
    const r = validateMetricsConsistency(dir, loadConfig(dir));
    const paths = listed(r);
    assert.ok(paths.includes('README.md'), paths.join(', '));
    assert.ok(!paths.includes('AGENTS.md'), 'Decision 6: no entry for an agent-instruction file');
  });

  it('Metrics-Consistency is silent without docs.language (guard)', () => {
    const dir = project(files);
    assert.equal(validateMetricsConsistency(dir, loadConfig(dir)).unexaminedDocuments, undefined);
  });

  it('semantic claims skip a document in another language and list it; an agent file is read as before', () => {
    const claims = { 'docs-canonical/ARCHITECTURE.md': '# A\n\nO tempo limite é de 30 seconds por chamada.\n', 'AGENTS.md': '# Agents\n\nThe timeout is 45 seconds per call.\n' };
    const dir = project(claims, { language: 'de' });
    const config = loadConfig(dir);
    const found = extractSemanticClaims(dir, config).map(c => `${c.doc}:${c.value}`);
    assert.deepEqual(found, ['AGENTS.md:45']);
    assert.deepEqual(claimDocumentsNotSupported(dir, config).map(d => d.path), ['docs-canonical/ARCHITECTURE.md']);
    const plain = project(claims);
    assert.deepEqual(extractSemanticClaims(plain, loadConfig(plain)).map(c => `${c.doc}:${c.value}`).sort(), ['AGENTS.md:45', 'docs-canonical/ARCHITECTURE.md:30']);
    assert.deepEqual(claimDocumentsNotSupported(plain, loadConfig(plain)), []);
  });

  it('guard reports the skipped claim documents under semanticClaims and in strict.couldNotRead', () => {
    const dir = project({ ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\nO tempo limite é de 30 seconds por chamada.\n' }, { language: 'de' });
    const { report } = guardJson(dir);
    assert.deepEqual(report.semanticClaims.languageNotSupported.map(d => d.path).sort(), ['README.md', 'docs-canonical/ARCHITECTURE.md']);
    assert.ok(report.strict.couldNotRead.some(r => r.validator === 'semanticClaims' && r.cause === 'language-not-supported'));
  });

  it('guard is silent about claims without docs.language: no languageNotSupported key (guard)', () => {
    const dir = project({ ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\nO tempo limite é de 30 seconds por chamada.\n' });
    const { report } = guardJson(dir);
    assert.equal(report.semanticClaims.languageNotSupported, undefined);
  });
});
