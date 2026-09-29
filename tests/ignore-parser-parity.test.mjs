/**
 * One meaning for `.docguardignore`: the shared.mjs loader must agree with
 * shared-ignore.mjs, which fixed gitignore-style `dir/` patterns long ago
 * while the private copy kept compiling them to a regex that matched nothing.
 *
 * @req docguard.ignore-and-todo-parsing#FR-001
 * @req docguard.ignore-and-todo-parsing#SC-001
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadIgnorePatterns } from '../cli/shared.mjs';
import { buildIgnoreFilter, loadDocguardIgnore } from '../cli/shared-ignore.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function withIgnore(content) {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-parity-'));
  dirs.push(dir);
  writeFileSync(join(dir, '.docguardignore'), content);
  return dir;
}

describe('.docguardignore parsers agree', () => {
  it('a trailing-slash pattern ignores everything under the directory', () => {
    const isIgnored = loadIgnorePatterns(withIgnore('notes/\n'));
    assert.equal(isIgnored('notes/a.md'), true);
    assert.equal(isIgnored('notes/deep/b.md'), true);
    assert.equal(isIgnored('src/notes.md'), false);
  });

  it('this repository\'s own patterns give identical answers in both parsers', () => {
    const repo = process.cwd();
    const a = loadIgnorePatterns(repo);
    const b = buildIgnoreFilter(loadDocguardIgnore(repo));
    const probes = [
      'Research/x.md', 'dist/a.js', 'build/b.js', 'docguard_cli/c.py', '__pycache__/d.pyc', 'x.pyc',
      '.DS_Store', '.specify/templates/t.md', '.specify/scripts/s.sh', 'a/b.bak',
      'docs-canonical/SURFACE-AUDIT.md', 'examples/e.md', 'templates/demo-fixture/f.md',
      'benchmarks/fixtures/g.md', 'packaging/h.md', 'websec-out/i.json', 'graphify-out/j.json',
      'README.md', 'docs-canonical/ARCHITECTURE.md', 'specs/015-spec-first-gate/spec.md', 'cli/docguard.mjs',
    ];
    for (const p of probes) assert.equal(a(p), b(p), p);
    assert.ok(readFileSync(join(repo, '.docguardignore'), 'utf8').includes('dist/'));
    assert.equal(a('dist/a.js'), true, 'dist/ in this repository\'s ignore file must take effect');
  });
});
