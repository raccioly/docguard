/**
 * Spec 104, Stage 1 (T013): `docs.language` and `docs.labelAliases`.
 *
 * `loadConfig` reads both next to `docs.roles`; a primary subtag selects the
 * built-in set (`pt-PT` is `pt`); an invalid tag is reported and treated as
 * absent; the schema describes both keys.
 *
 * @req docguard.document-languages#FR-007
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';

const CLI = resolve('cli/docguard.mjs');
function project(config) {
  const dir = makeTempDir('docguard-lang-config-');
  mkdirSync(dirname(join(dir, '.docguard.json')), { recursive: true });
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config));
  return dir;
}
/** Load a config in a child process so stderr can be read. */
function load(config) {
  const dir = project(config);
  const script = `import { loadConfig } from ${JSON.stringify(resolve('cli/config.mjs'))}; import { labelContext } from ${JSON.stringify(resolve('cli/shared-labels.mjs'))}; const c = loadConfig(${JSON.stringify(dir)}); console.log(JSON.stringify({ docs: c.docs ?? null, ctx: labelContext(c) }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, out: r.status === 0 ? JSON.parse(r.stdout) : null };
}

describe('docs.language and docs.labelAliases load (T013)', () => {
  it('both load next to docs.roles', () => {
    const r = load({ docs: { language: 'pt-BR', labelAliases: { 'system-overview': ['Panorama geral'] }, roles: { architecture: 'docs-canonical/ARCHITECTURE.md' } } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
    assert.equal(r.out.docs.language, 'pt-BR');
    assert.deepEqual(r.out.docs.labelAliases, { 'system-overview': ['Panorama geral'] });
    assert.equal(r.out.ctx.language, 'pt');
    assert.deepEqual(r.out.ctx.project, { 'system-overview': ['Panorama geral'] });
  });

  it('a regional tag resolves to its primary subtag: pt-PT is pt, es-MX is es, en-US is English', () => {
    for (const [tag, primary, builtin] of [['pt-PT', 'pt', true], ['pt', 'pt', true], ['es-MX', 'es', true], ['es', 'es', true], ['de', 'de', false], ['zh-Hant-TW', 'zh', false], ['en-US', 'en', false]]) {
      const { out } = load({ docs: { language: tag } });
      assert.equal(out.ctx.language, primary, tag);
      assert.equal(out.ctx.builtin, builtin, tag);
    }
    assert.equal(load({ docs: { language: 'en' } }).out.ctx.unicode, false, 'English keeps the legacy normalizer');
    assert.equal(load({ docs: { language: 'pt' } }).out.ctx.unicode, true);
  });

  it('there is no label context without docs.language (project aliases are inert without it)', () => {
    assert.equal(load({}).out.ctx, null);
    assert.equal(load({ docs: { labelAliases: { 'system-overview': ['X'] } } }).out.ctx, null);
  });

  it('an invalid tag is reported once, with an example, and treated as absent', () => {
    for (const bad of ['portuguese', 'english', 'pt_BR', '', 42, ['pt']]) {
      const r = load({ docs: { language: bad } });
      assert.equal(r.status, 0, `the run continues for ${JSON.stringify(bad)}: ${r.stderr}`);
      assert.match(r.stderr, /docs\.language/);
      assert.match(r.stderr, /pt-BR/, 'names an example tag');
      assert.equal(r.out.ctx, null, `${JSON.stringify(bad)} is treated as absent`);
      assert.equal(r.out.docs.language, undefined, 'the invalid value is dropped from the loaded config');
    }
  });

  it('an unknown label id or a malformed list in docs.labelAliases is reported and ignored; valid entries stay', () => {
    const r = load({ docs: { language: 'pt', labelAliases: { 'system-overveiw': ['x'], 'tech-stack': 'not a list', 'data-flow': ['Fluxo'], 'entities': [''] } } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /system-overveiw/);
    assert.match(r.stderr, /docs\.labelAliases\.tech-stack/);
    assert.match(r.stderr, /docs\.labelAliases\.entities/);
    assert.deepEqual(r.out.ctx.project, { 'data-flow': ['Fluxo'] });
  });

  it('there is no top-level "language" key (Decision 1): it is not read', () => {
    const r = load({ language: 'pt-BR' });
    assert.equal(r.out.ctx, null);
  });
});

describe('the config schema describes both keys (T013)', () => {
  const schema = JSON.parse(readFileSync(resolve('schemas/docguard-config.schema.json'), 'utf8'));
  const docs = schema.properties.docs.properties;

  it('docs.language is a BCP 47 tag', () => {
    assert.equal(docs.language.type, 'string');
    assert.ok(docs.language.pattern, 'has a pattern');
    const re = new RegExp(docs.language.pattern);
    for (const ok of ['pt-BR', 'pt', 'es-MX', 'de', 'zh-Hant-TW', 'en']) assert.ok(re.test(ok), ok);
    for (const bad of ['portuguese', 'pt_BR', '', 'p']) assert.ok(!re.test(bad), bad);
    assert.match(docs.language.description, /primary subtag/i);
  });

  it('docs.labelAliases is flat, keyed by id, each value a list of strings', () => {
    assert.equal(docs.labelAliases.type, 'object');
    assert.equal(docs.labelAliases.additionalProperties.type, 'array');
    assert.equal(docs.labelAliases.additionalProperties.items.type, 'string');
    assert.ok(docs.labelAliases.propertyNames.enum.includes('system-overview'));
    assert.match(docs.labelAliases.description, /extend/i);
  });

  it('there is no top-level language property', () => {
    assert.equal(schema.properties.language, undefined);
  });
});
