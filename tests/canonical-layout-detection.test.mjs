/**
 * Issue #326 — a project keeping its canonical documents somewhere other than
 * `docs-canonical/` read as EMPTY.
 *
 * `listCanonicalDocs` only walks the directories the config points at, so init
 * reported "no canonical docs", offered to reverse-engineer them from code, and
 * scaffolded a second canonical directory beside the real one. Guard meanwhile
 * ran 25 checks instead of 40 and said "no matches" — which reads as "nothing
 * to check here", not "I could not find your documents".
 *
 * Detection is by role filename, because the names are the convention that
 * survives relocation; the directory is the part people change.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectCanonicalLayout, roleForFilename, normaliseDocName } from '../cli/shared-doc-roles.mjs';

const doc = (dir, name) => { writeFileSync(join(dir, name), '# doc\n'); };

describe('role filenames are recognised across real-world spellings', () => {
  it('matches separators, case and Markdown extensions', () => {
    for (const [name, role] of [
      ['ARCHITECTURE.md', 'architecture'], ['architecture.md', 'architecture'],
      ['system-design.md', 'architecture'], ['Architecture.markdown', 'architecture'],
      ['DATA-MODEL.md', 'dataModel'], ['data_model.md', 'dataModel'],
      ['Data Model.md', 'dataModel'], ['schema.mdx', 'dataModel'],
      ['testing.md', 'testSpec'], ['test_plan.md', 'testSpec'],
      ['env.md', 'environment'], ['SETUP.md', 'environment'],
      ['api.md', 'apiReference'], ['endpoints.md', 'apiReference'],
      ['PRD.md', 'requirements'],
    ]) {
      assert.equal(roleForFilename(name), role, `${name} should map to ${role}`);
    }
  });

  it('does not claim files that merely look documentary', () => {
    // README/CHANGELOG have their own handling; a non-Markdown file is not a doc.
    for (const name of ['README.md', 'CHANGELOG.md', 'index.md', 'architecture.py', 'notes.txt']) {
      assert.equal(roleForFilename(name), null, `${name} must not be claimed as a role`);
    }
    assert.equal(normaliseDocName('LICENSE'), null, 'an extensionless file is not a document');
  });
});

describe('canonical layout detection', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dg-layout-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('finds documents relocated to docs/canonical/', () => {
    mkdirSync(join(dir, 'docs/canonical'), { recursive: true });
    for (const n of ['ARCHITECTURE.md', 'DATA-MODEL.md', 'SECURITY.md']) doc(join(dir, 'docs/canonical'), n);
    const [top] = detectCanonicalLayout(dir);
    assert.equal(top.dir, 'docs/canonical');
    assert.equal(top.count, 3);
  });

  it('finds them under non-obvious names and directories', () => {
    mkdirSync(join(dir, 'documentation'), { recursive: true });
    for (const n of ['architecture.md', 'data_model.md', 'testing.md', 'env.md']) doc(join(dir, 'documentation'), n);
    const [top] = detectCanonicalLayout(dir);
    assert.equal(top.dir, 'documentation');
    assert.deepEqual(Object.keys(top.roles).sort(), ['architecture', 'dataModel', 'environment', 'testSpec']);
  });

  it('does not treat a lone root SECURITY.md as a canonical layout', () => {
    // GitHub's security policy lives at the repo root and is not a design doc.
    doc(dir, 'SECURITY.md');
    doc(dir, 'README.md');
    assert.deepEqual(detectCanonicalLayout(dir).filter(h => h.count >= 2), [],
      'one role in a directory is not enough evidence to relocate a project');
  });

  it('prefers the conventional directory when two tie', () => {
    for (const d of ['docs-canonical', 'docs/canonical']) {
      mkdirSync(join(dir, d), { recursive: true });
      for (const n of ['ARCHITECTURE.md', 'SECURITY.md']) doc(join(dir, d), n);
    }
    assert.equal(detectCanonicalLayout(dir)[0].dir, 'docs-canonical',
      'an already-conventional project must never be told to relocate to itself');
  });

  it('ignores dependency and build directories', () => {
    mkdirSync(join(dir, 'node_modules/pkg/docs-canonical'), { recursive: true });
    for (const n of ['ARCHITECTURE.md', 'SECURITY.md']) doc(join(dir, 'node_modules/pkg/docs-canonical'), n);
    assert.deepEqual(detectCanonicalLayout(dir), [],
      "a dependency's documents are not this project's canonical layout");
  });
});
