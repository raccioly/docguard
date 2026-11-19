/**
 * Spec 105, Stage 3: creating the glossary (`init --with glossary`, plain `init`, `fix --doc glossary`).
 *
 * The starter is a title, an explanation in an HTML comment, the table header and no active row;
 * the proposals taken from the project's documents sit in one HTML comment, so the checker ignores
 * them. An existing glossary is never changed.
 *
 * @req docguard.glossary-and-plain-writing#FR-017
 * @req docguard.glossary-and-plain-writing#FR-018
 * @req docguard.glossary-and-plain-writing#FR-019
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { parseGlossary, starterGlossary } from '../cli/shared-glossary.mjs';
import { validateGlossary } from '../cli/validators/glossary.mjs';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

function project(files, config) {
  const dir = makeTempDir('docguard-glossary-init-');
  const all = { ...files };
  if (config) all['.docguard.json'] = JSON.stringify({ projectName: 'g', version: '0.6', enforcement: 'standard', ...config });
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
const docguard = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: ENV, timeout: 60000 });
const starter = (dir, config = {}) => starterGlossary(dir, loadConfig(dir) && { ...loadConfig(dir), ...config });
const proposals = text => (/<!-- docguard:glossary-proposals([\s\S]*?)-->/.exec(text) || [])[1] ?? '';
const rowsIn = text => text.split('\n').filter(l => /^\| (?!Use|Usar|---)/.test(l));

const PROSE = [
  '# Notes',
  '',
  'The spec says how the tool works. Each spec is short.',
  'The specification of the tool is complete, and every specification lists its rules.',
  'Write the spec first, then the plan.',
  '',
].join('\n');

describe('the starter (FR-018)', () => {
  it('has a title, an explanation in a comment, the English header and no active row', () => {
    const dir = project({ 'README.md': PROSE });
    const text = starter(dir);
    assert.match(text, /^# Glossary\n/);
    assert.match(text, /\n<!--\nOne term for one concept\./);
    assert.match(text, /\n\| Use \| Avoid \| Meaning \|\n\|---\|---\|---\|\n/);
    const parsed = parseGlossary(text);
    assert.equal(parsed.found, true);
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.issues, []);
  });

  it('writes the Portuguese and Spanish title and header for docs.language, and English for any other language', () => {
    const dir = project({ 'README.md': PROSE });
    const pt = starterGlossary(dir, { docs: { language: 'pt-BR' } });
    assert.match(pt, /^# Glossário\n/);
    assert.match(pt, /\n\| Usar \| Evitar \| Significado \|\n/);
    assert.equal(parseGlossary(pt).found, true);
    const es = starterGlossary(dir, { docs: { language: 'es-MX' } });
    assert.match(es, /^# Glosario\n/);
    assert.match(es, /\n\| Usar \| Evitar \| Significado \|\n/);
    const de = starterGlossary(dir, { docs: { language: 'de' } });
    assert.match(de, /^# Glossary\n/);
    assert.match(de, /\n\| Use \| Avoid \| Meaning \|\n/);
  });

  it('proposes a synonym pair that occurs in prose, the more frequent form as Use, with both counts', () => {
    const dir = project({ 'README.md': PROSE });
    const text = starter(dir);
    assert.ok(text.includes('<!-- docguard:glossary-proposals'));
    assert.deepEqual(rowsIn(proposals(text)), ['| spec | specification | Both forms occur: "spec" 3 times, "specification" 2 times |']);
  });

  it('puts the long form first on a tie, and proposes nothing when only one form occurs', () => {
    const tie = project({ 'README.md': 'The config is read once. The configuration is checked once.\n' });
    assert.match(rowsIn(proposals(starter(tie)))[0], /^\| configuration \| config \|/);
    const single = project({ 'README.md': 'The config is read. The config is checked. A repo exists.\n' });
    assert.deepEqual(rowsIn(proposals(starter(single))), []);
    assert.match(proposals(starter(single)), /No proposals/);
  });

  it('counts prose only: code, links and quoted text do not make a pair', () => {
    const dir = project({ 'README.md': 'The spec is short.\n\n```\nspecification specification specification\n```\n\nSee `specification` and "specification" and specification.md.\n' });
    assert.deepEqual(rowsIn(proposals(starter(dir))), []);
  });

  it('reads the documents of the glossary set, not the changelog or specs', () => {
    const dir = project({ 'README.md': 'The spec is short.\n', 'CHANGELOG.md': 'The specification changed.\n', 'specs/001-x/spec.md': 'The specification.\n' });
    assert.deepEqual(rowsIn(proposals(starter(dir))), []);
  });

  it('proposes capitalized names that recur three times away from the start of a sentence', () => {
    const dir = project({
      'README.md': [
        '# Notes', '',
        'Our team ships with DocGuard every week.',
        'Then DocGuard runs in CI, and DocGuard reports each problem.',
        'We built the Spec Kit flow. Reviewers like Spec Kit a lot, and Spec Kit stays small.',
        'Check the guard output. Guard runs fast. Rare Name appears twice, see Rare Name.',
        'Run the build. Build output is cached.',
        '',
      ].join('\n'),
    });
    assert.deepEqual(rowsIn(proposals(starter(dir))), [
      '| DocGuard | | Appears 3 times, never at the start of a sentence; say what it means |',
      '| Spec Kit | | Appears 3 times, never at the start of a sentence; say what it means |',
    ]);
  });

  it('proposes at most ten names, most frequent first, in a fixed order', () => {
    const names = Array.from({ length: 14 }, (_, i) => `Zeta${String.fromCharCode(65 + i)}x`);
    const body = names.map((n, i) => `We like ${n}, use ${n} and see ${n}${i < 3 ? ' and ' + n : ''}.`).join('\n');
    const dir = project({ 'README.md': `# R\n\n${body}\n` });
    const rows = rowsIn(proposals(starter(dir)));
    assert.equal(rows.length, 10);
    assert.ok(rows[0].startsWith('| ZetaAx |') && rows[1].startsWith('| ZetaBx |') && rows[2].startsWith('| ZetaCx |'));
    assert.match(rows[0], /Appears 4 times/);
    assert.equal(starter(dir), starter(dir));
  });

  it('keeps every proposal inside one HTML comment, so guard reports no GLS001 on the starter', () => {
    const dir = project({ 'README.md': PROSE, 'docs/guide.md': '# Guide\n\nThe spec and the specification and the config and the configuration.\n' });
    const text = starter(dir);
    assert.equal((text.match(/<!-- docguard:glossary-proposals/g) || []).length, 1);
    writeFileSync(join(dir, 'docs/GLOSSARY.md'), text);
    const r = validateGlossary(dir, loadConfig(dir));
    assert.deepEqual((r.findings || []).map(f => f.code), []);
    assert.equal(r.performed, 1);
    assert.equal(parseGlossary(text).rows.length, 0);
  });

  it('turns a copied proposal into a working row', () => {
    const dir = project({ 'README.md': PROSE, 'docs/GLOSSARY.md': starter(project({ 'README.md': PROSE })).replace('|---|---|---|\n\n<!-- docguard', '|---|---|---|\n| spec | specification | the document |\n\n<!-- docguard') });
    const r = validateGlossary(dir, loadConfig(dir));
    assert.deepEqual((r.findings || []).map(f => `${f.code}@${f.location}`), ['GLS001@README.md:4']);
  });
});

describe('init --with glossary and plain init (FR-017)', () => {
  const INIT = ['init', '--skip-prompts', '--no-spec-kit', '--profile', 'starter'];

  it('writes docs/GLOSSARY.md and reads back as a glossary with no row', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE });
    const r = docguard(dir, ...INIT, '--with', 'glossary');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const text = readFileSync(join(dir, 'docs/GLOSSARY.md'), 'utf8');
    assert.match(text, /^# Glossary\n/);
    assert.equal(parseGlossary(text).found, true);
    assert.match(r.stdout, /docs\/GLOSSARY\.md created/);
  });

  it('never overwrites an existing glossary, force included, and says so', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE, 'docs/GLOSSARY.md': '# My terms\n\n| Use | Avoid |\n|---|---|\n| one | uno |\n' });
    for (const extra of [[], ['--force']]) {
      const r = docguard(dir, ...INIT, '--with', 'glossary', ...extra);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.equal(readFileSync(join(dir, 'docs/GLOSSARY.md'), 'utf8'), '# My terms\n\n| Use | Avoid |\n|---|---|\n| one | uno |\n');
      assert.match(r.stdout, /docs\/GLOSSARY\.md exists; left alone/);
    }
    assert.equal(existsSync(join(dir, 'docs/GLOSSARY.md.bak')), false);
  });

  it('leaves a glossary at another lookup path alone and writes none beside it', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE, 'GLOSSARY.md': '# Terms\n' });
    const r = docguard(dir, ...INIT, '--with', 'glossary');
    assert.match(r.stdout, /GLOSSARY\.md exists; left alone/);
    assert.equal(existsSync(join(dir, 'docs/GLOSSARY.md')), false);
  });

  it('writes the starter at docs.glossary and the language header for docs.language', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE }, { docs: { glossary: 'meta/terms.md', language: 'pt' } });
    const r = docguard(dir, ...INIT, '--with', 'glossary');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const text = readFileSync(join(dir, 'meta/terms.md'), 'utf8');
    assert.match(text, /^# Glossário\n/);
    assert.match(text, /\| Usar \| Evitar \| Significado \|/);
    assert.equal(existsSync(join(dir, 'docs/GLOSSARY.md')), false);
  });

  it('writes the starter on plain init when the project has none, and not when it has one', () => {
    const fresh = project({ 'package.json': '{"name":"g"}' });
    const r = docguard(fresh, ...INIT);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(parseGlossary(readFileSync(join(fresh, 'docs/GLOSSARY.md'), 'utf8')).found, true);

    const had = project({ 'package.json': '{"name":"g"}', 'docs/GLOSSARY.md': '# Mine\n' });
    docguard(had, ...INIT);
    assert.equal(readFileSync(join(had, 'docs/GLOSSARY.md'), 'utf8'), '# Mine\n');
  });

  it('is accepted by --with with other scaffolders, and an unknown name still fails', () => {
    const dir = project({ 'package.json': '{"name":"g"}' });
    const bad = docguard(dir, ...INIT, '--with', 'glosary');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout + bad.stderr, /glossary/);
  });
});

describe('fix --doc glossary (FR-019)', () => {
  const fix = (dir, ...args) => docguard(dir, 'fix', '--doc', 'glossary', ...args);

  it('prints a CREATE prompt for a missing glossary, naming the file and the steps', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE });
    const r = fix(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /TASK: CREATE the file docs\/GLOSSARY\.md/);
    assert.match(r.stdout, /DOCUMENTS TO READ \(1\): README\.md/);
    assert.match(r.stdout, /named two or more ways/);
    assert.match(r.stdout, /WITH THE MAINTAINER/);
    assert.match(r.stdout, /move each accepted proposal into the table/);
    assert.match(r.stdout, /docguard guard/);
  });

  it('prints an IMPROVE prompt for an existing glossary', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE, 'docs/GLOSSARY.md': '# Glossary\n' });
    assert.match(fix(dir).stdout, /TASK: IMPROVE the file docs\/GLOSSARY\.md/);
  });

  it('resolves the configured path', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE, 'meta/terms.md': '# Terms\n' }, { docs: { glossary: 'meta/terms.md' } });
    assert.match(fix(dir).stdout, /TASK: IMPROVE the file meta\/terms\.md/);
  });

  it('wraps the prompt in JSON with --format json, as for the other documents', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE });
    const r = fix(dir, '--format', 'json');
    const json = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(json), ['doc', 'action', 'projectType', 'prompt']);
    assert.equal(json.doc, 'docs/GLOSSARY.md');
    assert.equal(json.action, 'CREATE');
    assert.match(json.prompt, /CREATE the file docs\/GLOSSARY\.md/);
  });

  it('lists glossary among the available documents when the name is wrong', () => {
    const dir = project({ 'package.json': '{"name":"g"}' });
    const r = docguard(dir, 'fix', '--doc', 'nope');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Available: .*glossary/);
  });

  it('does not make the plain fix scan flag a glossary that is only a starter', () => {
    const dir = project({ 'package.json': '{"name":"g"}', 'README.md': PROSE });
    docguard(dir, 'init', '--skip-prompts', '--no-spec-kit', '--profile', 'starter', '--with', 'glossary');
    const r = docguard(dir, 'fix', '--format', 'json');
    assert.doesNotMatch(r.stdout, /GLOSSARY/);
  });
});
