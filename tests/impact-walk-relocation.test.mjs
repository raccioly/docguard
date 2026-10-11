/**
 * The reverse-import walk behind `diff --since` / `impact` moved into
 * cli/scanners/import-graph.mjs so requirement-anchor ripple shares it
 * (specs/070-requirement-anchors, user story 5; Constitution IV). This pins
 * the behavior the move must keep: two hops at most, and hub modules (more
 * than 15 imports) suppressed.
 *
 * @req docguard.requirement-anchors#FR-031
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

describe('impact keeps its reverse-import walk after the move', () => {
  it('reports importers up to two hops, never three, and never a hub', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-impact-walk-'));
    dirs.push(dir);
    write(dir, 'package.json', JSON.stringify({ name: 't', version: '0.0.0' }));
    write(dir, '.docguard.json', JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }));
    write(dir, 'src/core.mjs', 'export function a() { return 1; }\n');
    write(dir, 'src/adapter.mjs', "import { a } from './core.mjs';\nexport const b = () => a();\n");
    write(dir, 'src/service.mjs', "import { b } from './adapter.mjs';\nexport const c = () => b();\n");
    write(dir, 'src/outer.mjs', "import { c } from './service.mjs';\nexport const d = () => c();\n");
    const stubs = Array.from({ length: 15 }, (_, i) => `s${i}`);
    for (const s of stubs) write(dir, `src/${s}.mjs`, `export const ${s} = ${JSON.stringify(s)};\n`);
    write(dir, 'src/hub.mjs', ["import { a } from './core.mjs';", ...stubs.map(s => `import { ${s} } from './${s}.mjs';`), 'export const hub = a;', ''].join('\n'));
    write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\nThe service layer is `src/service.mjs`.\n');
    write(dir, 'docs-canonical/DATA-MODEL.md', '# Data model\nThe outer layer is `src/outer.mjs`.\n');
    write(dir, 'docs-canonical/SECURITY.md', '# Security\nEverything is wired in `src/hub.mjs`.\n');
    write(dir, 'docs-canonical/TEST-SPEC.md', '# Tests\nThe adapter is `src/adapter.mjs`.\n');
    fixtureGit(dir, ['init', '-q']);
    fixtureGit(dir, ['config', 'user.email', 't@example.com']);
    fixtureGit(dir, ['config', 'user.name', 't']);
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'base']);
    write(dir, 'src/core.mjs', 'export function a() { return 2; }\n');
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'change core']);
    const r = spawnSync(process.execPath, [CLI, 'impact', '--since', 'HEAD~1', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(r.stdout);
    const docs = Object.fromEntries(data.indirectDocs.map(d => [d.doc, d.chains.map(ch => [ch.via, ch.hops])]));
    assert.deepEqual(docs, {
      'TEST-SPEC.md': [['src/adapter.mjs', 1]],
      'ARCHITECTURE.md': [['src/service.mjs', 2]],
    }, JSON.stringify(data.indirectDocs));
  });
});
