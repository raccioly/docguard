/**
 * DORA documentation-quality and AI-capability evidence (specs/092-dora-evidence).
 *
 * @req docguard.dora-evidence#FR-001
 * @req docguard.dora-evidence#FR-002
 * @req docguard.dora-evidence#FR-003
 * @req docguard.dora-evidence#FR-004
 * @req docguard.dora-evidence#FR-005
 * @req docguard.dora-evidence#SC-001
 * @req docguard.dora-evidence#SC-003
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { validateWithSchemas } from '../cli/claimspec-schema.mjs';
import { docsForPath } from '../cli/scanners/doc-references.mjs';
import { SENSOR_CACHE, treeKey } from '../cli/sensor-cache.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const SCHEMA = JSON.parse(readFileSync('schemas/docguard-dora.schema.json', 'utf8'));
const DOC_IDS = ['reliable', 'easy-to-understand', 'easy-to-find', 'code-documented', 'well-organized', 'updated-with-changes', 'reflects-capabilities', 'used-in-incidents'];
const AI_IDS = ['ai-stance', 'healthy-data-ecosystem', 'ai-accessible-data', 'version-control', 'small-batches', 'user-centric-focus', 'quality-internal-platform'];

const API_DOC = '# API Reference\n\n## Endpoints\n\n| Method | Path | Description |\n|---|---|---|\n| GET | /users | List users |\n| DELETE | /ghost | Removed long ago |\n';
const APP = "const express = require('express');\nconst app = express();\napp.get('/users', (req, res) => res.json([]));\nmodule.exports = app;\n";

function write(dir, files) {
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
}
function commit(dir, message = 'c') {
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]);
}
function project(t, files, { git = true } = {}) {
  const dir = makeTempDir('docguard-dora-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write(dir, { 'package.json': '{"name":"fx","dependencies":{"express":"^4"}}\n', 'src/app.js': APP, 'docs-canonical/API-REFERENCE.md': API_DOC, ...files });
  if (git) { fixtureGit(dir, ['init', '-q', '-b', 'main']); commit(dir, 'init'); }
  return dir;
}
const score = (dir, ...args) => spawnSync(process.execPath, [CLI, 'score', ...args], { cwd: dir, encoding: 'utf8' });
const dora = dir => {
  const r = score(dir, '--dora', '--format', 'json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).dora;
};
const byId = (items, id) => items.find(i => i.id === id);

describe('US1 — DORA\'s eight documentation items', () => {
  it('reports every item in DORA\'s order, valid against the schema, each score with evidence', t => {
    const d = dora(project(t, {}));
    assert.deepEqual(d.documentation.map(i => i.id), DOC_IDS);
    assert.deepEqual(validateWithSchemas(SCHEMA, d), []);
    assert.equal(d.schemaVersion, 1);
    assert.match(d.caveat, /survey/);
    for (const i of d.documentation) if (i.score !== null) assert.ok(i.evidence.length > 0, i.id);
  });

  it('a documented route with no code behind it lowers reflects-capabilities and is named', t => {
    const i = byId(dora(project(t, {})).documentation, 'reflects-capabilities');
    assert.equal(i.measure, 'deterministic');
    assert.equal(i.score, 50);
    assert.ok(i.evidence.some(e => e.includes('DELETE /ghost')), i.evidence.join(' | '));
  });

  it('no runbook is proxy evidence of 0; a runbook with scenarios scores 100', t => {
    const none = byId(dora(project(t, {})).documentation, 'used-in-incidents');
    assert.equal(none.measure, 'proxy');
    assert.equal(none.score, 0);
    assert.match(none.evidence[0], /no runbook/);
    const runbook = byId(dora(project(t, { 'docs/RUNBOOK.md': '# Runbook\n\n## Database down\n\nRestart it.\n\n## Queue backlog\n\nScale workers.\n' })).documentation, 'used-in-incidents');
    assert.equal(runbook.score, 100);
  });

  it('easy-to-understand is a proxy, never deterministic', t => {
    assert.equal(byId(dora(project(t, {})).documentation, 'easy-to-understand').measure, 'proxy');
  });
});

describe('US2 — the AI capabilities a repository can show', () => {
  it('reports the seven capabilities; three are survey-only with no score', t => {
    const d = dora(project(t, {}));
    assert.deepEqual(d.ai.map(i => i.id), AI_IDS);
    for (const id of ['healthy-data-ecosystem', 'user-centric-focus', 'quality-internal-platform']) {
      const i = byId(d.ai, id);
      assert.equal(i.measure, 'survey-only');
      assert.equal(i.score, null);
      assert.ok(i.reason);
    }
  });

  it('small batches: null under five commits; scored from the share of commits over 20 files', t => {
    const dir = project(t, {});
    const few = byId(dora(dir).ai, 'small-batches');
    assert.equal(few.score, null);
    assert.match(few.reason, /at least 5/);
    for (let n = 0; n < 4; n++) { write(dir, { [`src/f${n}.js`]: `export const n = ${n};\n` }); commit(dir); }
    write(dir, Object.fromEntries(Array.from({ length: 25 }, (_, k) => [`src/big/b${k}.js`, `export const k = ${k};\n`])));
    commit(dir, 'large');
    const six = byId(dora(dir).ai, 'small-batches');
    // 1 of 6 commits is large (17%): 100 - (0.167 - 0.05) / 0.45 * 100 = 74.
    assert.equal(six.score, 74);
    assert.match(six.evidence[0], /6 commits .* 1 \(17%\) over 20 files/);
  });

  it('without git, history and file-list items are null with a reason', t => {
    const d = dora(project(t, {}, { git: false }));
    assert.equal(byId(d.ai, 'small-batches').score, null);
    assert.equal(byId(d.ai, 'version-control').score, null);
    assert.equal(byId(d.documentation, 'used-in-incidents').score, null);
  });

  it('version control scores code, configuration and build scripts; missing infrastructure is never scored', t => {
    const vc = byId(dora(project(t, {})).ai, 'version-control');
    assert.equal(vc.score, 100);
    assert.ok(vc.evidence.some(e => /infrastructure configuration: none found; not scored/.test(e)));
  });

  it('AI stance: rules for agents score 100, an entry file alone 50, none 0', t => {
    assert.equal(byId(dora(project(t, { 'AGENTS.md': '# Agents\n\nNever push to main.\n' })).ai, 'ai-stance').score, 100);
    assert.equal(byId(dora(project(t, { 'AGENTS.md': '# Agents\n\nThis repo holds a web app.\n' })).ai, 'ai-stance').score, 50);
    assert.equal(byId(dora(project(t, {})).ai, 'ai-stance').score, 0);
  });

  it('an agent instruction pointing at a superseded doc is named', t => {
    const i = byId(dora(project(t, {
      'AGENTS.md': '# Agents\n\nRead docs/old-design.md before changing billing.\n',
      'docs/old-design.md': '# Old design\n\n**Status**: Superseded\n\nThe old way.\n',
    })).ai, 'ai-accessible-data');
    assert.ok(i.evidence.some(e => /AGENTS\.md points at docs\/old-design\.md, which is superseded/.test(e)), i.evidence.join(' | '));
  });
});

describe('FR-001 — display-only and absent without the flag', () => {
  it('score without --dora carries no dora key and no DORA section', t => {
    const dir = project(t, {});
    const json = score(dir, '--format', 'json');
    assert.equal(json.status, 0, json.stderr);
    assert.equal('dora' in JSON.parse(json.stdout), false);
    assert.doesNotMatch(score(dir).stdout, /DORA/);
    const withDora = JSON.parse(score(dir, '--dora', '--format', 'json').stdout);
    const plain = JSON.parse(json.stdout);
    assert.equal(withDora.score, plain.score, 'the CDD score never reads the DORA view');
    assert.equal(withDora.grade, plain.grade);
  });
});

describe('US3 — docs_for_path says how far to trust each referencing doc', () => {
  it('states only what differs from the default; open findings come only from a cache for this tree state', t => {
    const dir = project(t, {
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe server lives in `src/app.js`.\n',
      'AGENTS.md': '# Agents\n\nStart at `src/app.js`. Routes live in `src/app.js` too.\n',
    });
    const config = {};
    const first = docsForPath(dir, config, 'src/app.js');
    assert.deepEqual(first.docs, { findingsBasis: 'no-current-guard-run' }, 'active docs and no cache: one field');

    mkdirSync(join(dir, '.docguard'), { recursive: true });
    writeFileSync(join(dir, SENSOR_CACHE), JSON.stringify({ key: treeKey(dir), result: {}, fileCodes: { 'AGENTS.md': ['PSR002'] } }));
    const cached = docsForPath(dir, config, 'src/app.js');
    assert.deepEqual(cached.docs, { findingsBasis: 'sensor-cache', openFindings: { 'AGENTS.md': ['PSR002'] } });

    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nStart at `src/app.js`.\n');
    const stale = docsForPath(dir, config, 'src/app.js');
    assert.deepEqual(stale.docs, { findingsBasis: 'no-current-guard-run' }, 'a cache for another tree state is never used');
  });

  it('a superseded canonical doc reports lifecycle superseded', t => {
    const dir = project(t, { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n**Status**: Superseded\n\nThe server lives in `src/app.js`.\n' });
    const r = docsForPath(dir, {}, 'src/app.js');
    assert.deepEqual(r.docs.lifecycle, { 'docs-canonical/ARCHITECTURE.md': 'superseded' }, JSON.stringify(r.docs));
  });
});
