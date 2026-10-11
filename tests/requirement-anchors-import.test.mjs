/**
 * Importers (specs/070-requirement-anchors, user story 9): with
 * `anchors.import`, StrictDoc `@relation(...)` and OpenFastTrace
 * `[impl->dsn~name~rev]` tags anchor like native tags, to the requirement
 * `anchors.importMap` names. Unconfigured, they are plain text; an unmapped
 * ID is ANC007; native and imported tags for different requirements on one
 * symbol are ANC006; an OFT revision behind the mapping is an outdated,
 * code-side suspect. Foreign tags are never written.
 *
 * @req docguard.requirement-anchors#FR-038
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeAnchorStatus, computeLinks } from '../cli/scanners/anchors.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const HAS_PYTHON = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0;
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8' });

const MAP = {
  'strictdoc:REQ-1': 'acme.billing#FR-001',
  'oft:dsn~refund': { requirement: 'acme.billing#FR-002', revision: 2 },
};
const SOURCE = [
  "import { round } from './math.mjs';",
  '',
  '// @relation(REQ-1, scope=function)',
  'export function charge(t) { return round(t); }',
  '',
  '// [impl->dsn~refund~2]',
  'export function refund(t) { return -round(t); }',
  '',
].join('\n');

function project({ anchors = { import: ['strictdoc', 'openfasttrace'], importMap: MAP }, source = SOURCE, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-import-'));
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter', anchors }));
  write(dir, 'specs/001-billing/spec.md', '# Billing\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: Charges.\n- **FR-002**: Refunds.\n- **FR-003**: Notices.\n');
  write(dir, 'src/billing.mjs', source);
  write(dir, 'src/math.mjs', 'export const round = n => Math.round(n);\n');
  for (const [rel, text] of Object.entries(extra)) write(dir, rel, text);
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  return dir;
}
const config = dir => JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8'));
const status = dir => computeAnchorStatus(dir, config(dir), { noCache: true });
const codes = (result, code) => result.problems.filter(p => p.code === code).map(p => p.message);

describe('importers (FR-038)', () => {
  it('unconfigured, StrictDoc and OpenFastTrace syntax is plain text', () => {
    const dir = project({ anchors: {} });
    const result = status(dir);
    assert.deepEqual(result.links, []);
    assert.deepEqual(result.problems, []);
  });

  it('a mapped StrictDoc and a mapped OFT tag anchor the symbols below them', () => {
    const dir = project();
    const links = status(dir).links.map(l => [l.requirement, l.anchor, l.scope, l.imported.from, l.imported.ref]);
    assert.deepEqual(links, [
      ['acme.billing#FR-001', 'charge', 'symbol', 'strictdoc', 'REQ-1'],
      ['acme.billing#FR-002', 'refund', 'symbol', 'openfasttrace', 'dsn~refund~2'],
    ]);
  });

  it('only the enabled importer is read', () => {
    const dir = project({ anchors: { import: ['strictdoc'], importMap: MAP } });
    assert.deepEqual(status(dir).links.map(l => l.imported.from), ['strictdoc']);
  });

  it('StrictDoc scope=file anchors the file; scope=line anchors the statement; the {} form is read too', () => {
    const dir = project({ source: [
      "import { round } from './math.mjs';",
      '',
      'export function charge(t) {',
      '  // @relation{REQ-1, scope=line}',
      '  return round(t);',
      '}',
      '',
      '// @relation(REQ-2, scope=file)',
      'export const x = 1;',
      '',
    ].join('\n'), anchors: { import: ['strictdoc'], importMap: { ...MAP, 'strictdoc:REQ-2': 'acme.billing#FR-003' } } });
    const scopes = Object.fromEntries(status(dir).links.map(l => [l.requirement, l.scope]));
    assert.deepEqual(scopes, { 'acme.billing#FR-001': 'statement', 'acme.billing#FR-003': 'file' });
  });

  it('an unmapped foreign ID is ANC007 and makes no link', () => {
    const dir = project({ source: SOURCE.replace('REQ-1', 'REQ-9') });
    const result = status(dir);
    assert.ok(!result.links.some(l => l.anchor === 'charge'));
    assert.match(codes(result, 'ANC007').join('\n'), /strictdoc:REQ-9/);
  });

  it('a native and a foreign tag for different requirements on one symbol are ANC006', () => {
    const dir = project({ source: SOURCE.replace('// @relation(REQ-1, scope=function)', '// @relation(REQ-1, scope=function)\n// @implements acme.billing#FR-003') });
    assert.match(codes(status(dir), 'ANC006').join('\n'), /native tags for acme\.billing#FR-003 and imported tags for acme\.billing#FR-001/);
    const agree = project({ source: SOURCE.replace('// @relation(REQ-1, scope=function)', '// @relation(REQ-1, scope=function)\n// @implements acme.billing#FR-001') });
    assert.deepEqual(codes(status(agree), 'ANC006'), []);
  });

  it('an OFT tag behind the mapped revision is an outdated, code-side suspect (ANC001)', () => {
    const dir = project({ source: SOURCE.replace('dsn~refund~2', 'dsn~refund~1') });
    const result = status(dir);
    const refund = result.links.find(l => l.anchor === 'refund');
    assert.deepEqual([refund.state, refund.side, refund.cause], ['suspect', 'code', 'oft-outdated']);
    const finding = result.problems.find(p => p.code === 'ANC001');
    assert.equal(finding.cause, 'oft-outdated');
    assert.match(finding.message, /covers revision 1, and anchors\.importMap expects 2/);
  });

  it('accept and listing never rewrite a source file', () => {
    const dir = project();
    const before = readFileSync(join(dir, 'src/billing.mjs'), 'utf8');
    assert.equal(cli(dir, ['anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the imported links']).status, 0);
    cli(dir, ['anchors']);
    assert.equal(readFileSync(join(dir, 'src/billing.mjs'), 'utf8'), before);
  });

  it('changing the import map is never answered from the cache', () => {
    const dir = project();
    const env = {};
    assert.equal(computeLinks(dir, config(dir), { env }).links.find(l => l.anchor === 'charge').requirement, 'acme.billing#FR-001');
    const remapped = { ...config(dir), anchors: { ...config(dir).anchors, importMap: { ...MAP, 'strictdoc:REQ-1': 'acme.billing#FR-003' } } };
    assert.equal(computeLinks(dir, remapped, { env }).links.find(l => l.anchor === 'charge').requirement, 'acme.billing#FR-003');
  });

  it('a Python file with only foreign tags is read', { skip: !HAS_PYTHON && 'python3 is unavailable' }, () => {
    const dir = project({ extra: { 'src/notices.py': 'import os\n\n# [impl->dsn~refund~2]\ndef notify():\n    return os.name\n' } });
    const link = status(dir).links.find(l => l.file === 'src/notices.py');
    assert.deepEqual([link.anchor, link.requirement, link.tier.startsWith('python-ast@')], ['notify', 'acme.billing#FR-002', true]);
  });
});
