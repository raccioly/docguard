/**
 * Requirement anchors are documented and adopted (specs/070-requirement-anchors):
 * every configuration key, command flag and finding is documented where a
 * user looks (FR-042), and this repository runs the feature on itself, with a
 * reviewed lock under CODEOWNERS, a union-merged lock, the committed replay,
 * and no ambiguous or unresolved tag (FR-043).
 *
 * @req docguard.requirement-anchors#FR-042
 * @req docguard.requirement-anchors#FR-043
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitattributesDeclaresUnion, readAnchorLock } from '../cli/scanners/anchor-lock.mjs';
import { computeLinks } from '../cli/scanners/anchors.mjs';
import { loadConfig } from '../cli/config.mjs';

const ROOT = resolve('.');
const read = rel => readFileSync(resolve(ROOT, rel), 'utf8');

describe('documented (FR-042)', () => {
  it('every anchors configuration key is in docs/configuration.md', () => {
    const schema = JSON.parse(read('schemas/docguard-config.schema.json'));
    const keys = Object.keys(schema.properties.anchors.properties);
    assert.ok(keys.length >= 8, keys.join(', '));
    const doc = read('docs/configuration.md');
    for (const key of keys) assert.ok(doc.includes(`\`anchors.${key}`), `anchors.${key} is undocumented`);
  });

  it('every anchors and trace --matrix flag in the CLI help is in docs/commands.md', () => {
    const doc = read('docs/commands.md');
    const flagsOf = command => spawnSync(process.execPath, ['cli/docguard.mjs', command, '--help'], { encoding: 'utf8' }).stdout
      .split('\n').map(line => /^\s{2}(--[\w-]+|accept|disposition)\b/.exec(line)?.[1]).filter(Boolean);
    const anchorFlags = flagsOf('anchors');
    assert.ok(anchorFlags.length >= 15, anchorFlags.join(' '));
    for (const flag of anchorFlags) assert.ok(doc.includes(flag), `docguard anchors ${flag} is undocumented`);
    for (const flag of flagsOf('trace').filter(f => ['--matrix', '--out', '--spec'].includes(f))) assert.ok(doc.includes(`trace --matrix`) && doc.includes(flag), flag);
  });

  it('every ANC finding has a findings-reference entry, and the canonical docs cover the lock, the tiers and their safety', () => {
    const findings = read('docs/reference/findings.md');
    for (let n = 1; n <= 10; n++) assert.ok(findings.includes(`### ANC${String(n).padStart(3, '0')}`), `ANC${n}`);
    const security = read('docs-canonical/SECURITY.md');
    for (const term of ['.docguard-anchor-lock.jsonl', 'ts-anchors.mjs', 'testguard-evidence.mjs', 'anchors accept, anchors disposition', 'trace --matrix']) assert.ok(security.includes(term), `SECURITY.md: ${term}`);
    assert.match(read('docs-canonical/CI-RECIPES.md'), /Recipe 3f — Requirement anchors/);
    for (const doc of ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/TEST-SPEC.md', 'docs-canonical/DATA-MODEL.md', 'README.md']) assert.match(read(doc), /anchor/i, doc);
  });
});

describe('adopted by this repository (FR-043)', () => {
  it('the lock is committed, readable, union-merged and owned through CODEOWNERS', () => {
    const lock = readAnchorLock(ROOT);
    assert.equal(lock.error, null);
    assert.deepEqual(lock.conflicts, []);
    assert.ok(lock.links.size > 500, `${lock.links.size} entries`);
    assert.ok(gitattributesDeclaresUnion(ROOT));
    assert.match(read('.github/CODEOWNERS'), /^\.docguard-anchor-lock\.jsonl\s+@\S+/m);
    assert.ok(existsSync(resolve(ROOT, 'specs/070-requirement-anchors/evidence/churn-replay.json')));
  });

  it('no tag in this repository is ambiguous (ANC006) or cites nothing (ANC007)', () => {
    const { problems, links } = computeLinks(ROOT, loadConfig(ROOT), { noCache: true });
    const flagged = problems.filter(p => p.code === 'ANC006' || p.code === 'ANC007').map(p => `${p.code} ${p.file}:${p.line} ${p.message}`);
    assert.deepEqual(flagged, []);
    assert.ok(links.length > 500);
  });
});
