/**
 * Spec 104, Stage 1 (T012): the label registry is closed and exact in both
 * directions.
 *
 * @req docguard.document-languages#FR-003
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CANONICAL_SECTIONS } from '../cli/authoring-contract.mjs';
import { BUILTIN_LANGUAGES, LABELS, foldHeading, headingIds, idForEnglishLabel, labelIds } from '../cli/shared-labels.mjs';

/** The N/A slug of a heading, as structure.mjs derives it. */
const slug = heading => heading.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

describe('the label registry (T012)', () => {
  it('the ids of the authoring contract equal the N/A slugs of its headings, and each is registered', () => {
    const contract = Object.values(CANONICAL_SECTIONS).flat();
    for (const section of contract) {
      assert.equal(section.id, slug(section.heading), `${section.heading}: id must be the existing N/A slug`);
      assert.ok(labelIds().includes(section.id), `${section.id} is not in the registry`);
      assert.equal(idForEnglishLabel(section.heading), section.id);
    }
    const registered = LABELS.filter(l => ['architecture', 'data-model', 'security', 'test-spec', 'environment'].includes(l.group) && contract.some(s => s.id === l.id)).map(l => l.id).sort();
    assert.deepEqual(registered, contract.map(s => s.id).sort(), 'every contract section is registered once, and nothing else is claimed to be in the contract');
  });

  it('the registry is closed: ids are unique, lowercase kebab-case, and the two kinds are the only kinds', () => {
    const ids = labelIds();
    assert.equal(new Set(ids).size, ids.length);
    for (const entry of LABELS) {
      assert.match(entry.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      assert.ok(['heading', 'word'].includes(entry.kind), entry.id);
      assert.ok(entry.en.length > 0, `${entry.id} has no English label`);
    }
    assert.deepEqual(headingIds(), LABELS.filter(l => l.kind === 'heading').map(l => l.id));
  });

  it('every alias belongs to exactly one id per language (after folding)', () => {
    for (const lang of BUILTIN_LANGUAGES) {
      const owner = new Map();
      for (const entry of LABELS) {
        for (const alias of entry[lang]) {
          const key = foldHeading(alias);
          assert.ok(key, `${entry.id} (${lang}) has an alias that folds to nothing`);
          assert.ok(!owner.has(key) || owner.get(key) === entry.id, `${lang}: "${alias}" belongs to both ${owner.get(key)} and ${entry.id}`);
          owner.set(key, entry.id);
        }
      }
    }
  });

  it('every English label belongs to exactly one id', () => {
    const owner = new Map();
    for (const entry of LABELS) {
      for (const label of entry.en) {
        const key = foldHeading(label);
        assert.ok(!owner.has(key) || owner.get(key) === entry.id, `"${label}" belongs to both ${owner.get(key)} and ${entry.id}`);
        owner.set(key, entry.id);
      }
    }
  });

  it('the built-in languages are exactly the languages the registry carries alias lists for', () => {
    const langs = new Set(LABELS.flatMap(entry => Object.keys(entry).filter(k => !['id', 'group', 'kind', 'en'].includes(k))));
    assert.deepEqual([...langs].sort(), [...BUILTIN_LANGUAGES].sort());
  });

  it('the D2 table is shipped as written: spot checks per row group', () => {
    const find = id => LABELS.find(l => l.id === id);
    assert.deepEqual(find('system-overview').pt, ['Visão geral do sistema', 'Visão geral', 'Panorama do sistema']);
    assert.deepEqual(find('source-to-test-map').pt, ['Mapa de fontes para testes', 'Mapa de código para testes']);
    assert.deepEqual(find('source-to-test-map').es, ['Mapa de código a pruebas']);
    assert.deepEqual(find('unreleased').pt, ['Não lançado', 'Não publicado']);
    assert.deepEqual(find('superseded').es, ['sustituido', 'sustituida', 'reemplazado', 'superado']);
    assert.deepEqual(find('lifecycle-status').es, ['Estado']);
    assert.deepEqual(find('phase').pt, ['Fase']);
  });

  it('the config schema names exactly the registry ids for docs.labelAliases', () => {
    const schema = JSON.parse(readFileSync(resolve('schemas/docguard-config.schema.json'), 'utf8'));
    const aliases = schema.properties.docs.properties.labelAliases;
    assert.deepEqual([...aliases.propertyNames.enum].sort(), [...labelIds()].sort());
  });
});
