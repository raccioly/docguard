/**
 * Spec 104, Stage 4 (T036): `explain`, the findings reference and the languages
 * page say which labels are matched by id and which by alias, and list the
 * closed id list. A drift between the registry and any of them fails here.
 *
 * @req docguard.document-languages#FR-024
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CODES } from '../cli/findings.mjs';
import { LABELS, headingIds, labelIds, labelEntry } from '../cli/shared-labels.mjs';
import { LABEL_BLOCK_FILES, renderFindingsReference, withLabelBlock } from '../tools/generate-docs-reference.mjs';

const CLI = resolve('cli/docguard.mjs');
const explain = code => spawnSync(process.execPath, [CLI, 'explain', code], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stdout;
const explainJson = code => JSON.parse(spawnSync(process.execPath, [CLI, 'explain', code, '--format', 'json'], { encoding: 'utf8' }).stdout);
const flat = text => text.replace(/\s+/g, ' ');

// Each code, the ids it reads, and a heading alias from each built-in set.
const CASES = [
  ['STR003', ['system-overview', 'component-map', 'tech-stack', 'entities', 'authentication', 'secrets-management', 'test-categories', 'coverage-rules', 'environment-variables', 'setup-steps']],
  ['CHG001', ['unreleased']],
  ['DEC001', ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']],
  ['SPK003', ['user-scenarios', 'requirements', 'success-criteria']],
  ['SPK004', ['summary', 'technical-context', 'project-structure']],
  ['DCV005', ['installation', 'usage', 'license']],
];

describe('explain states the id, the marker and the aliases (FR-024)', () => {
  for (const [code, ids] of CASES) {
    it(`${code}: every id it reads, with its English label, its pt and es aliases`, () => {
      const out = flat(explain(code));
      for (const id of ids) {
        const entry = labelEntry(id);
        assert.ok(out.includes(`\`${id}\``), `${code} names ${id}`);
        assert.ok(out.includes(entry.en[0]), `${code}: English label of ${id}`);
        assert.ok(out.includes(entry.pt[0]), `${code}: first pt alias of ${id}`);
        assert.ok(out.includes(entry.es[0]), `${code}: first es alias of ${id}`);
      }
      assert.match(out, /docs\.language/);
      assert.match(out, /docs\.labelAliases/);
    });
  }

  it('a heading id is matched by the marker; a word id has none and is matched by alias only', () => {
    assert.ok(flat(explain('STR003')).includes('<!-- docguard:heading system-overview -->'));
    assert.ok(flat(explain('DCV005')).includes('<!-- docguard:heading usage -->'));
    assert.ok(flat(explain('CHG001')).includes('<!-- docguard:heading unreleased -->'));
    const dec = flat(explain('DEC001'));
    assert.doesNotMatch(dec, /<!-- docguard:heading accepted -->/);
    assert.match(dec, /no marker/i);
  });

  it('the same text is in the JSON `help`, so the reference page carries it', () => {
    assert.ok(explainJson('CHG001').help.includes('Não lançado'));
  });
});

describe('the closed id list cannot drift (FR-024)', () => {
  const list = (text, label) => {
    const m = new RegExp(`${label}[^\`]*\`([^\`]+)\``).exec(text);
    assert.ok(m, `${label} list found`);
    return m[1].split(',').map(s => s.trim()).filter(Boolean);
  };

  it('STR009 lists exactly the heading ids and, separately, the word ids', () => {
    const help = CODES.STR009.help;
    assert.deepEqual(list(help, 'Heading ids').sort(), headingIds().sort());
    assert.deepEqual(list(help, 'Word ids').sort(), LABELS.filter(entry => entry.kind === 'word').map(entry => entry.id).sort());
  });

  it('the generated findings reference carries the same STR009 text', () => {
    const page = renderFindingsReference();
    assert.ok(page.includes(CODES.STR009.help.trim()));
    assert.equal(readFileSync(resolve('docs/reference/findings.md'), 'utf8'), page, 'docs/reference/findings.md is current: run npm run docs:reference');
  });

  it('docs/languages.md carries the generated registry block, current, and lists exactly the registry ids', () => {
    assert.ok(LABEL_BLOCK_FILES.includes('docs/languages.md'));
    const page = readFileSync(resolve('docs/languages.md'), 'utf8');
    assert.equal(withLabelBlock(page), page, 'docs/languages.md is current: run npm run docs:reference');
    const block = /<!-- docguard:label-registry\b[^>]*-->([\s\S]*?)<!-- \/docguard:label-registry -->/.exec(page);
    assert.ok(block, 'the page has the generated block');
    const ids = [...block[1].matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map(m => m[1]);
    assert.deepEqual([...ids].sort(), [...labelIds()].sort());
    assert.equal(new Set(ids).size, ids.length);
  });

  it('every file that carries the block also exists with the markers (the tool reports a missing block)', () => {
    for (const file of LABEL_BLOCK_FILES) assert.notEqual(withLabelBlock(readFileSync(resolve(file), 'utf8')), null, file);
  });
});

describe('the README states how to use docs.language (FR-024)', () => {
  for (const file of ['README.md', 'README.pt-BR.md', 'README.es.md']) {
    it(`${file} names docs.language, docs.labelAliases, the marker and docs/languages`, () => {
      const text = readFileSync(resolve(file), 'utf8');
      assert.match(text, /docs\.language/, file);
      assert.match(text, /docs\.labelAliases/, file);
      assert.match(text, /<!-- docguard:heading /, file);
      assert.match(text, /languages\.html|docs\/languages\.md/, file);
    });
  }

  it('the stale note from #647 ("Must stay in English today") is gone', () => {
    assert.doesNotMatch(readFileSync(resolve('README.md'), 'utf8'), /Must stay in English today/);
  });
});
