/**
 * Tags inside literals are not evidence (specs/070-requirement-anchors
 * FR-005, FR-006, SC-008): the implementation-evidence scanner reads real
 * comments only, so `"// @req FR-012"` in a help string no longer counts,
 * while every tag in a real comment still does.
 *
 * @req docguard.requirement-anchors#FR-005
 * @req docguard.requirement-anchors#FR-006
 * @req docguard.requirement-anchors#SC-008
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { scanImplementationFilesForReferences } from '../cli/scanners/requirement-evidence.mjs';
import { DEFAULT_REQ_PATTERNS } from '../cli/shared-requirements.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const refsIn = (dir, files) => {
  const refs = scanImplementationFilesForReferences(dir, files, DEFAULT_REQ_PATTERNS);
  return [...refs].flatMap(([id, locations]) => locations.map(l => `${l.scope || ''}#${id}@${l.file}:${l.line}`)).sort();
};

describe('implementation evidence reads real comments only (FR-005)', () => {
  it('JS: strings, templates and regex literals do not count; comments do', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-lit-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'a.mjs'), [
      '// @implements acme.x#FR-001',
      'const help = "Add `// @req FR-012` to the test";',
      'const t = `/* @implements acme.x#FR-013 */`;',
      'const r = /\\/\\/ @implements acme.x#FR-014/;',
      '/** @implements acme.x#FR-002 */',
      'export function f() {}',
    ].join('\n'));
    assert.deepEqual(refsIn(dir, ['a.mjs']), ['acme.x#FR-001@a.mjs:1', 'acme.x#FR-002@a.mjs:5']);
  });

  it('Python and YAML: quoted text does not count; comments do', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-lit-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'a.py'), '# @implements acme.x#FR-001\nx = "# @implements acme.x#FR-012"\ny = """\n# @implements acme.x#FR-013\n"""\n');
    writeFileSync(join(dir, 'w.yml'), '# @implements acme.x#FR-002\nrun: echo "# @implements acme.x#FR-012"\n');
    assert.deepEqual(refsIn(dir, ['a.py', 'w.yml']), ['acme.x#FR-001@a.py:1', 'acme.x#FR-002@w.yml:1']);
  });

  it('this repository: the help text in explain.mjs is no longer evidence', () => {
    const refs = refsIn(resolve('.'), ['cli/commands/explain.mjs']);
    assert.deepEqual(refs.filter(r => r.startsWith('#FR-012@')), []);
  });

  it('every requirement ID in a tagged comment still counts, as before (FR-006)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-lit-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'b.mjs'), '/**\n * Reads x (acme.x#FR-003).\n * @implements acme.x#FR-004\n */\nexport const b = 1;\n');
    assert.deepEqual(refsIn(dir, ['b.mjs']), ['acme.x#FR-003@b.mjs:2', 'acme.x#FR-004@b.mjs:3']);
  });
});
