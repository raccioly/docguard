/**
 * Ripple (specs/070-requirement-anchors, user story 5): when an anchored
 * function changes, the anchored links in files that import it and use the
 * changed name are listed, up to two hops, hubs excluded, wide fan-out
 * collapsed; it is advisory and never reaches guard.
 *
 * @req docguard.requirement-anchors#FR-031
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeAnchorStatus } from '../cli/scanners/anchors.mjs';
import { clearImportGraphCache } from '../cli/scanners/import-graph.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

function project({ fanOutLimit, extraImporters = 0, hub = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-ripple-'));
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter', anchors: fanOutLimit ? { fanOutLimit } : {} }));
  write(dir, 'specs/001-r/spec.md', '# R\n\n**Spec ID**: `acme.r`\n\n- **FR-001**: f.\n- **FR-002**: g.\n- **FR-003**: uses f.\n- **FR-004**: uses g.\n- **FR-005**: two hops.\n- **FR-006**: namespace.\n');
  write(dir, 'src/a.mjs', "import { x } from './x.mjs';\n\n/** @implements acme.r#FR-001 */\nexport function f() { return 1; }\n\n/** @implements acme.r#FR-002 */\nexport function g() { return 2; }\n");
  write(dir, 'src/x.mjs', 'export const x = 0;\n');
  write(dir, 'src/b.mjs', "import { f } from './a.mjs';\n\n/** @implements acme.r#FR-003 */\nexport function useF() { return f(); }\n");
  write(dir, 'src/c.mjs', "import { g } from './a.mjs';\n\n/** @implements acme.r#FR-004 */\nexport function useG() { return g(); }\n");
  write(dir, 'src/d.mjs', "import { useF } from './b.mjs';\n\n/** @implements acme.r#FR-005 */\nexport function outer() { return useF(); }\n");
  write(dir, 'src/n.mjs', "import * as a from './a.mjs';\n\n/** @implements acme.r#FR-006 */\nexport function viaNamespace() { return a.f(); }\n");
  for (let i = 0; i < extraImporters; i++) {
    write(dir, `src/e${i}.mjs`, `import { f } from './a.mjs';\n\n/** @implements acme.r#FR-003 */\nexport function extra${i}() { return f(); }\n`);
  }
  if (hub) {
    const stubs = Array.from({ length: 15 }, (_, i) => `s${i}`);
    for (const s of stubs) write(dir, `src/${s}.mjs`, `export const ${s} = 1;\n`);
    write(dir, 'src/hub.mjs', ["import { f } from './a.mjs';", ...stubs.map(s => `import { ${s} } from './${s}.mjs';`), '', '/** @implements acme.r#FR-003 */', 'export function wired() { return f(); }', ''].join('\n'));
  }
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  const r = spawnSync(process.execPath, [CLI, 'anchors', 'accept', '--baseline', '--bulk', '--reason', 'adopt anchors for the fixture', '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const path = join(dir, 'src/a.mjs');
  writeFileSync(path, readFileSync(path, 'utf8').replace('return 1;', 'return 10;'));
  clearImportGraphCache();
  return dir;
}
const config = dir => JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8'));
const rippleOf = dir => computeAnchorStatus(dir, config(dir), { noCache: true, ripple: true }).links.find(l => l.requirement === 'acme.r#FR-001').ripple;

describe('ripple (FR-031)', () => {
  it('names the importers that use the changed name: b (named), n (namespace), d at two hops; never c', () => {
    const ripple = rippleOf(project());
    const files = ripple.map(r => [r.file, r.hops, r.confidence]);
    assert.deepEqual(files, [['src/b.mjs', 1, 'high'], ['src/n.mjs', 1, 'high'], ['src/d.mjs', 2, 'low']]);
    assert.equal(ripple.find(r => r.file === 'src/d.mjs').via, 'src/b.mjs');
    assert.ok(ripple.every(r => r.links.length >= 1));
  });

  it('a hub importer is not listed', () => {
    const files = rippleOf(project({ hub: true })).map(r => r.file);
    assert.ok(!files.includes('src/hub.mjs'), files.join(', '));
  });

  it('more importers than anchors.fanOutLimit collapse into one summary', () => {
    const ripple = rippleOf(project({ fanOutLimit: 2, extraImporters: 3 }));
    assert.equal(ripple.collapsed, true);
    assert.ok(ripple.count > 2);
    assert.equal(ripple.files.length, 2);
  });

  it('a language without an import graph says ripple is unavailable', () => {
    const dir = project();
    write(dir, 'src/svc.go', 'package svc\n\n// @implements acme.r#FR-002\nfunc Serve() int {\n\treturn 1\n}\n');
    fixtureGit(dir, ['add', '-A']);
    assert.equal(spawnSync(process.execPath, [CLI, 'anchors', 'accept', '--file', 'src/svc.go', '--reason', 'reviewed the go server link', '--dir', dir], { encoding: 'utf8' }).status, 0);
    write(dir, 'src/svc.go', 'package svc\n\n// @implements acme.r#FR-002\nfunc Serve() int {\n\treturn 2\n}\n');
    const link = computeAnchorStatus(dir, config(dir), { noCache: true, ripple: true }).links.find(l => l.file === 'src/svc.go');
    assert.match(link.ripple.unavailable, /no import graph/);
  });

  it('ripple is advisory: guard has no ripple finding, and the listing shows it', () => {
    const dir = project();
    const guard = JSON.parse(spawnSync(process.execPath, [CLI, 'guard', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
    assert.ok(!guard.findings.some(f => /may affect|ripple/i.test(f.message)));
    const text = spawnSync(process.execPath, [CLI, 'anchors', '--dir', dir], { encoding: 'utf8' }).stdout;
    assert.match(text, /↳ may affect src\/b\.mjs \(1 hop/);
  });
});
