/**
 * Canonical documents listed in `requiredFiles.canonical` outside
 * `docs-canonical/` are the documents `score` and the section checks read
 * (issue 625).
 *
 * The reproduction: a project keeps its five canonical documents under
 * `docs/canonical/` and lists them in `requiredFiles.canonical`. Structure
 * found them, but docQuality reported every one as "file missing", ALCOA+
 * Original and Available said no canonical directory exists, and guard never
 * checked their sections.
 *
 * @req docguard.configured-canonical-paths#FR-001
 * @req docguard.configured-canonical-paths#FR-002
 * @req docguard.configured-canonical-paths#FR-003
 * @req docguard.configured-canonical-paths#FR-004
 * @req docguard.configured-canonical-paths#FR-005
 * @req docguard.configured-canonical-paths#FR-006
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { fileURLToPath } from 'node:url';

import { loadConfig } from '../cli/config.mjs';
import { runScoreInternal, computeAlcoaCompliance, runScore } from '../cli/commands/score.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { CLAIMSPEC_VENDOR, validateClaimspec } from '../cli/claimspec-schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT'];
// This repository's own canonical documents carry every required section.
const complete = name => readFileSync(join(ROOT, 'docs-canonical', `${name}.md`), 'utf-8');

let dir;
beforeEach(() => { dir = makeTempDir('docguard-625-'); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function put(rel, content) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/** The #625 layout: documents under `canonicalDir`, listed in requiredFiles. */
function project(canonicalDir, { config = {}, docs = {} } = {}) {
  put('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
  put('CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n');
  put('AGENTS.md', '# Agents\n');
  put('DRIFT-LOG.md', '# Drift Log\n');
  for (const name of DOCS) put(`${canonicalDir}/${name}.md`, docs[name] ?? complete(name));
  put('.docguard.json', JSON.stringify({
    version: '0.6',
    profile: 'standard',
    projectType: 'api',
    requiredFiles: { canonical: DOCS.map(n => `${canonicalDir}/${n}.md`) },
    ...config,
  }));
  return loadConfig(dir);
}

const scoreOf = config => runScoreInternal(dir, config);
const alcoa = (config, name) => computeAlcoaCompliance(dir, config, scoreOf(config).categories)
  .attributes.find(a => a.name === name);

describe('#625: docQuality reads the configured canonical documents (FR-001)', () => {
  it('scores documents under docs/canonical/ as present, not "file missing"', () => {
    const relocated = scoreOf(project('docs/canonical')).categories.docQuality;
    assert.ok(relocated > 0, `docQuality was ${relocated}`);
  });

  it('gives the relocated layout the score the default layout gets for the same content', () => {
    const relocated = scoreOf(project('docs/canonical')).categories.docQuality;
    rmSync(dir, { recursive: true, force: true });
    dir = makeTempDir('docguard-625-');
    const standard = scoreOf(project('docs-canonical')).categories.docQuality;
    assert.equal(relocated, standard);
  });

  it('the suggestion names the document and a `fix --doc` the CLI accepts (FR-004)', () => {
    project('docs/canonical', { docs: { ARCHITECTURE: '# Architecture\n\nOne line.\n' } });
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try { runScore(dir, loadConfig(dir), { format: 'text' }); } finally { console.log = log; }
    const out = lines.join('\n');
    assert.doesNotMatch(out, /file missing/);
    assert.match(out, /docguard fix --doc architecture`/);
    assert.doesNotMatch(out, /--doc docs\//);
  });
});

describe('#625: guard checks the sections of the configured documents (FR-002)', () => {
  it('reports STR003 for a relocated document that lacks a required section', () => {
    const config = project('docs/canonical', { docs: { ARCHITECTURE: '# Architecture\n\nOnly prose here.\n' } });
    const str003 = validateDocSections(dir, config).findings.filter(f => f.code === 'STR003');
    assert.ok(str003.length > 0, 'expected STR003 for docs/canonical/ARCHITECTURE.md');
    assert.ok(str003.every(f => f.location === 'docs/canonical/ARCHITECTURE.md' || /docs\/canonical\/ARCHITECTURE\.md/.test(f.message)));
  });

  it('reports nothing for complete relocated documents', () => {
    const config = project('docs/canonical');
    const str003 = validateDocSections(dir, config).findings.filter(f => f.code === 'STR003');
    assert.deepEqual(str003, []);
  });
});

describe('#625: ALCOA+ sees the configured canonical documents (FR-003)', () => {
  it('Original and Available are met without a docs-canonical/ directory', () => {
    const config = project('docs/canonical');
    assert.equal(alcoa(config, 'Original').met, true);
    assert.equal(alcoa(config, 'Available').met, true);
  });

  it('Contemporaneous checks the configured documents, so a stale one is a gap', () => {
    const config = project('docs/canonical');
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(join(dir, 'docs/canonical/SECURITY.md'), old, old);
    assert.equal(alcoa(config, 'Contemporaneous').met, false);
  });

  it('a project with no canonical documents at all is still a gap', () => {
    put('package.json', '{}');
    const config = loadConfig(dir);
    assert.equal(computeAlcoaCompliance(dir, config, scoreOf(config).categories)
      .attributes.find(a => a.name === 'Original').met, false);
  });
});

describe('positive controls (FR-005)', () => {
  it('the default docs-canonical/ layout is unchanged', () => {
    const config = project('docs-canonical');
    assert.ok(scoreOf(config).categories.docQuality > 0);
    assert.equal(alcoa(config, 'Original').met, true);
    const bare = put('docs-canonical/ARCHITECTURE.md', '# Architecture\n\nOnly prose here.\n');
    assert.ok(bare);
    assert.ok(validateDocSections(dir, config).findings.some(f => f.code === 'STR003'));
  });

  it('an explicit docs.roles mapping still wins over requiredFiles.canonical', () => {
    put('handbook/arch.md', complete('ARCHITECTURE'));
    const config = project('docs/canonical', {
      config: { docs: { roles: { architecture: 'handbook/arch.md' } } },
      docs: { ARCHITECTURE: '# Architecture\n\nOnly prose here.\n' },
    });
    const str003 = validateDocSections(dir, config).findings.filter(f => f.code === 'STR003');
    assert.ok(!str003.some(f => /ARCHITECTURE/.test(f.message)), 'the mapped handbook/arch.md is complete');
  });

  it('two configured documents with the same name stay ambiguous and keep the default', () => {
    put('docs/a/ARCHITECTURE.md', '# Architecture\n\nOnly prose here.\n');
    put('docs/b/ARCHITECTURE.md', '# Architecture\n\nOnly prose here.\n');
    put('.docguard.json', JSON.stringify({
      version: '0.6', projectType: 'api',
      requiredFiles: { canonical: ['docs/a/ARCHITECTURE.md', 'docs/b/ARCHITECTURE.md'] },
    }));
    const config = loadConfig(dir);
    const str003 = validateDocSections(dir, config).findings.filter(f => f.code === 'STR003');
    assert.deepEqual(str003, []);
  });
});

describe('#619: claimspec schemas pinned to the TestGuard release with the new evidence fields (FR-006)', () => {
  it('records TestGuard v0.22.1 as the vendored revision', () => {
    assert.equal(CLAIMSPEC_VENDOR.release, 'v0.22.1');
    assert.equal(CLAIMSPEC_VENDOR.revision, '9cdac558743d91fe1bd892499fbcacadf0680330');
  });

  it('the common schema defines run.claimsSource as { external: true, sha256 }, the shape the adapter reads', () => {
    const common = JSON.parse(readFileSync(join(ROOT, 'schemas/claimspec/v1/common.schema.json'), 'utf-8'));
    const source = common.$defs.claimsSource;
    assert.deepEqual(source.required, ['external', 'sha256']);
    assert.deepEqual(source.properties.external, { const: true });
  });

  it('a path entry, the only kind DocGuard exports, still validates', () => {
    const doc = { schemaVersion: 1, entries: [{ kind: 'path', pattern: 'vendor/**', reason: 'third-party code' }] };
    assert.deepEqual(validateClaimspec('ignore', doc), []);
  });

  it('a fingerprint entry, which v0.22.1 removed, is rejected', () => {
    const doc = { schemaVersion: 1, entries: [{ kind: 'fingerprint', pattern: 'abc', reason: 'a known finding' }] };
    assert.notDeepEqual(validateClaimspec('ignore', doc), []);
  });
});
