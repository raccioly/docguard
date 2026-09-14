/**
 * @req docguard.language-repository-coverage#FR-009
 * @req docguard.language-repository-coverage#FR-010
 * @req docguard.language-repository-coverage#FR-011
 * @req docguard.language-repository-coverage#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { generateArchitecture } from '../cli/writers/doc-generators.mjs';
import { applyMechanicalFix } from '../cli/writers/mechanical.mjs';
import { assertOwnedCodeSection, inspectSections } from '../cli/writers/sections.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-mapped-writer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function generate(dir, config, flags = {}) {
  const scan = { routes: [], services: [], models: [], components: [], middlewares: [] };
  const log = console.log;
  console.log = () => {};
  try { return generateArchitecture(dir, config, {}, scan, flags, {}); }
  finally { console.log = log; }
}

describe('mapped document writers', () => {
  it('generates a new mapped role at its configured path', t => {
    const dir = fixture(t);
    const config = { projectName: 'mapped', docs: { roles: { architecture: 'handbook/system.md' } } };
    assert.equal(generate(dir, config), true);
    assert.equal(existsSync(join(dir, 'handbook/system.md')), true);
    assert.equal(existsSync(join(dir, 'docs-canonical/ARCHITECTURE.md')), false);
  });

  it('overwrites an explicitly generated mapped role with a backup', t => {
    const dir = fixture(t);
    const path = join(dir, 'handbook/system.md');
    const config = { projectName: 'mapped', docs: { roles: { architecture: 'handbook/system.md' } } };
    safeWrite(path, '# Old\n<!-- docguard:generated true -->\n');
    assert.equal(generate(dir, config, { force: true }), true);
    assert.match(readFileSync(path, 'utf8'), /# Architecture/);
    assert.match(readFileSync(path + '.bak', 'utf8'), /# Old/);
  });

  it('refuses human and shared whole-document targets even with force', t => {
    const dir = fixture(t);
    const path = join(dir, 'handbook/system.md');
    safeWrite(path, '# Human architecture\nKeep this prose.\n');
    const human = { docs: { roles: { architecture: 'handbook/system.md' } } };
    const before = readFileSync(path, 'utf8');
    assert.throws(() => generate(dir, human, { force: true }), /not fully owned|--force cannot/);
    assert.equal(readFileSync(path, 'utf8'), before);

    const shared = { docs: { roles: { architecture: 'handbook/shared.md', requirements: 'handbook/shared.md' } } };
    assert.throws(() => generate(dir, shared), /multiple roles/);
    assert.equal(existsSync(join(dir, 'handbook/shared.md')), false);
  });

  it('regenerates one mapped code section and preserves surrounding bytes', t => {
    const dir = fixture(t);
    const rel = 'handbook/system.md';
    const path = join(dir, rel);
    const before = '# Human title\nKeep before.\n<!-- docguard:section id=modules source=code -->\nold\n<!-- /docguard:section -->\nKeep after.\n';
    safeWrite(path, before);
    const result = applyMechanicalFix(dir, {
      type: 'regenerate-section', doc: rel, sectionId: 'modules', body: 'new module table',
    }, { config: { docs: { roles: { architecture: rel } } }, recordHistory: false });
    assert.equal(result.applied, true);
    const after = readFileSync(path, 'utf8');
    assert.equal(after, before.replace('\nold\n', '\nnew module table\n'));
    assert.equal(readFileSync(path + '.bak', 'utf8'), before);
  });

  it('fails closed on missing, human, duplicate, nested, and unclosed sections', t => {
    const valid = '<!-- docguard:section id=owned source=code -->\nvalue\n<!-- /docguard:section -->';
    assert.equal(assertOwnedCodeSection(valid, 'owned').id, 'owned');
    for (const content of [
      valid,
      valid.replace('source=code', 'source=human'),
      valid + '\n' + valid,
      '<!-- docguard:section id=owned source=code -->\n<!-- docguard:section id=other source=code -->\nx\n<!-- /docguard:section -->',
      '<!-- docguard:section id=owned source=code -->\nvalue',
    ]) {
      const id = content === valid ? 'missing' : 'owned';
      assert.throws(() => assertOwnedCodeSection(content, id), /exactly once|source=human|malformed|duplicate/);
    }
    assert.ok(inspectSections(valid + '\n<!-- /docguard:section -->').issues.some(issue => issue.code === 'unmatched-close'));
  });
});
