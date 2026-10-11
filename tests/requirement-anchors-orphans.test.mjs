/**
 * Orphans and granularity (specs/070-requirement-anchors, user story 7): the
 * exported or top-level symbols under the governed paths that no tag anchors
 * are listed once, in a fixed order; a disposition records why one implements
 * no requirement; `score` and `trace` show anchor granularity as information.
 * Nothing here proposes requirement text or calls a model.
 *
 * @req docguard.requirement-anchors#FR-034
 * @req docguard.requirement-anchors#FR-035
 * @req docguard.requirement-anchors#FR-036
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeOrphans } from '../cli/scanners/anchors.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8' });
const json = (dir, args) => JSON.parse(cli(dir, [...args, '--format', 'json']).stdout);

function project({ anchors = { orphanPaths: ['src'] }, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-orphans-'));
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter', anchors }));
  write(dir, 'specs/001-billing/spec.md', '# Billing\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: Charges.\n- **FR-002**: Carts.\n');
  // Three exported functions, one tagged: two orphans. The helper is private, the re-export lives elsewhere.
  write(dir, 'src/billing.mjs', [
    "import { round } from '../lib/math.mjs';",
    '',
    '/** @implements acme.billing#FR-001 */',
    'export function charge(total) { return round(total); }',
    '',
    'export function refund(total) { return -total; }',
    '',
    'export const voidCharge = id => id;',
    '',
    'export const LIMIT = 3;',
    '',
    'function helper() { return 1; }',
    '',
    "export { tax } from '../lib/tax.mjs';",
    '',
  ].join('\n'));
  write(dir, 'lib/math.mjs', 'export const round = n => Math.round(n);\n');
  write(dir, 'lib/tax.mjs', 'export const tax = n => n;\n');
  for (const [rel, text] of Object.entries(extra)) write(dir, rel, text);
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  return dir;
}

describe('anchors --orphans (FR-034)', () => {
  it('lists the two untagged exported functions once, in file and line order', () => {
    const dir = project();
    const result = json(dir, ['anchors', '--orphans']);
    assert.deepEqual(result.governed, { source: 'anchors.orphanPaths', paths: ['src'] });
    assert.deepEqual(result.orphans.map(o => [o.file, o.anchor, o.line, o.kind, o.tier]), [
      ['src/billing.mjs', 'refund', 6, 'function', 'babel@7'],
      ['src/billing.mjs', 'voidCharge', 8, 'function', 'babel@7'],
    ]);
    assert.equal(result.undispositioned, 2);
    assert.equal(result.symbols, 3);
  });

  it('the same project gives byte-identical output twice', () => {
    const dir = project({ extra: { 'src/a.mjs': 'export function a1() {}\nexport function a2() {}\n', 'src/z/z.mjs': 'export class Z {}\n' } });
    const first = cli(dir, ['anchors', '--orphans', '--format', 'json']).stdout;
    const second = cli(dir, ['anchors', '--orphans', '--format', 'json']).stdout;
    assert.equal(first, second);
    assert.deepEqual(JSON.parse(first).orphans.map(o => `${o.file}#${o.anchor}`), ['src/a.mjs#a1', 'src/a.mjs#a2', 'src/billing.mjs#refund', 'src/billing.mjs#voidCharge', 'src/z/z.mjs#Z']);
  });

  it('a file-scope tag covers every symbol in the file, and a tagged method covers its class', () => {
    const dir = project({ extra: {
      'src/header.mjs': '/**\n * Ledger.\n * @implements acme.billing#FR-002\n */\nimport { round } from "../lib/math.mjs";\nexport function post() { return round(1); }\n',
      'src/cart.mjs': "import { round } from '../lib/math.mjs';\n\nexport class Cart {\n  /** @implements acme.billing#FR-002 */\n  total() { return round(1); }\n}\n",
    } });
    const files = json(dir, ['anchors', '--orphans']).orphans.map(o => o.file);
    assert.ok(!files.includes('src/header.mjs'));
    assert.ok(!files.includes('src/cart.mjs'));
  });

  it('a JS module that exports nothing lists its top-level functions and classes, not its constants', () => {
    const dir = project({ extra: { 'src/script.mjs': "const LIMIT = 3;\nfunction main() { return LIMIT; }\nclass Runner {}\nmain();\n" } });
    const names = json(dir, ['anchors', '--orphans']).orphans.filter(o => o.file === 'src/script.mjs').map(o => [o.anchor, o.kind]);
    assert.deepEqual(names, [['main', 'function'], ['Runner', 'class']]);
  });

  it('reads Go, Rust and Python with their own visibility rules', () => {
    const dir = project({ extra: {
      'src/svc.go': 'package svc\n\nfunc Serve() int {\n\treturn 1\n}\n\nfunc helper() {}\n',
      'src/lib.rs': 'pub fn serve() -> i32 { 1 }\nfn helper() {}\n',
      'src/cart.py': 'def total():\n    return 0\n\ndef _helper():\n    return 1\n',
    } });
    const names = json(dir, ['anchors', '--orphans']).orphans.map(o => `${o.file}#${o.anchor}`);
    for (const expected of ['src/svc.go#Serve', 'src/lib.rs#serve', 'src/cart.py#total']) assert.ok(names.includes(expected), `${expected} in ${names}`);
    for (const hidden of ['src/svc.go#helper', 'src/lib.rs#helper', 'src/cart.py#_helper']) assert.ok(!names.includes(hidden), hidden);
  });

  it('without anchors.orphanPaths the current specs\' scope.sourcePaths govern; --spec narrows to one spec', () => {
    const dir = project({ anchors: {}, extra: { 'other/x.mjs': 'export function x() {}\n' } });
    assert.deepEqual(json(dir, ['anchors', '--orphans']).orphans, []);
    const registry = projectSpecRegistry(dir).registry;
    registry.specs.find(s => s.specId === 'acme.billing').reviewed.scope.sourcePaths = ['src/billing.mjs'];
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    const all = json(dir, ['anchors', '--orphans']);
    assert.equal(all.governed.source, 'the scope.sourcePaths of current specs');
    assert.deepEqual(all.orphans.map(o => o.anchor), ['refund', 'voidCharge']);
    assert.deepEqual(json(dir, ['anchors', '--orphans', '--spec', 'acme.billing']).orphans.length, 2);
    assert.match(json(dir, ['anchors', '--orphans', '--spec', 'acme.missing']).notes[0], /declares no scope\.sourcePaths/);
  });

  it('with no governed paths it lists nothing and says how to set them', () => {
    const dir = project({ anchors: {} });
    const result = json(dir, ['anchors', '--orphans']);
    assert.deepEqual(result.orphans, []);
    assert.match(result.notes[0], /anchors\.orphanPaths/);
    assert.equal(cli(dir, ['anchors', '--orphans']).status, 0);
  });

  it('a glob entry governs only what it matches', () => {
    const dir = project({ anchors: { orphanPaths: ['src/**/*.go'] }, extra: { 'src/svc.go': 'package svc\n\nfunc Serve() int {\n\treturn 1\n}\n' } });
    assert.deepEqual(json(dir, ['anchors', '--orphans']).orphans.map(o => o.file), ['src/svc.go']);
  });
});

describe('anchors disposition (FR-035)', () => {
  it('records a disposition in the lock, and the symbol leaves the undispositioned count', () => {
    const dir = project();
    const r = cli(dir, ['anchors', 'disposition', '--symbol', 'src/billing.mjs#refund', '--kind', 'dead', '--reason', 'refunds moved to the ledger service']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const lock = readFileSync(join(dir, '.docguard-anchor-lock.jsonl'), 'utf8');
    const entry = lock.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.key === 'disposition|src/billing.mjs|refund');
    assert.equal(entry.kind, 'dead');
    assert.equal(entry.reason, 'refunds moved to the ledger service');
    const result = json(dir, ['anchors', '--orphans']);
    assert.equal(result.undispositioned, 1);
    assert.deepEqual(result.orphans.find(o => o.anchor === 'refund').disposition.kind, 'dead');
  });

  it('refuses a bad kind, a short reason, a tagged or unknown symbol, and an unconfirmed multi-symbol selection', () => {
    const dir = project();
    const refused = args => { const r = cli(dir, ['anchors', 'disposition', ...args]); assert.equal(r.status, 1, args.join(' ')); return r; };
    assert.match(refused(['--symbol', 'src/billing.mjs#refund', '--kind', 'unused', '--reason', 'refunds moved elsewhere']).stderr, /needs --kind derived\|dead\|infrastructure/);
    assert.match(refused(['--symbol', 'src/billing.mjs#refund', '--kind', 'dead', '--reason', 'short']).stderr, /needs --reason/);
    assert.match(refused(['--symbol', 'src/billing.mjs#charge', '--kind', 'dead', '--reason', 'charge is tagged already']).stderr, /not an untagged symbol/);
    refused(['--symbol', 'src/billing.mjs#nothing', '--kind', 'dead', '--reason', 'no such function here']);
    assert.match(refused(['--file', 'src/billing.mjs', '--kind', 'infrastructure', '--reason', 'billing glue code only']).stderr, /--bulk/);
    assert.ok(!existsSync(join(dir, '.docguard-anchor-lock.jsonl')), 'a refusal writes nothing');
    assert.equal(cli(dir, ['anchors', 'disposition', '--file', 'src/billing.mjs', '--kind', 'infrastructure', '--bulk', '--reason', 'billing glue code only']).status, 0);
    assert.equal(json(dir, ['anchors', '--orphans']).undispositioned, 0);
  });

  it('--remove deletes a disposition; a disposition whose symbol is gone is reported stale', () => {
    const dir = project();
    cli(dir, ['anchors', 'disposition', '--symbol', 'src/billing.mjs#refund', '--kind', 'dead', '--reason', 'refunds moved to the ledger service']);
    cli(dir, ['anchors', 'disposition', '--symbol', 'src/billing.mjs#voidCharge', '--kind', 'derived', '--reason', 'implements the unwritten void rule']);
    assert.equal(cli(dir, ['anchors', 'disposition', '--remove', 'src/billing.mjs#voidCharge', '--reason', 'void rule now has a requirement']).status, 0);
    assert.equal(json(dir, ['anchors', '--orphans']).undispositioned, 1);
    write(dir, 'src/billing.mjs', readFileSync(join(dir, 'src/billing.mjs'), 'utf8').replace('export function refund(total) { return -total; }\n', ''));
    const stale = json(dir, ['anchors', '--orphans']).staleDispositions;
    assert.deepEqual(stale.map(s => [s.file, s.anchor, s.kind]), [['src/billing.mjs', 'refund', 'dead']]);
  });

  it('a disposition survives an accept, and guard reports nothing for orphans or dispositions', () => {
    const dir = project();
    cli(dir, ['anchors', 'disposition', '--symbol', 'src/billing.mjs#refund', '--kind', 'dead', '--reason', 'refunds moved to the ledger service']);
    assert.equal(cli(dir, ['anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']).status, 0);
    assert.equal(computeOrphans(dir, { anchors: { orphanPaths: ['src'] } }).orphans.find(o => o.anchor === 'refund').disposition.kind, 'dead');
    const guard = json(dir, ['guard']);
    assert.ok(!guard.findings.some(f => /orphan|disposition|untagged/i.test(f.message)));
  });
});

describe('granularity in score and trace (FR-036)', () => {
  it('appears as information once the project opted in, and is absent before', () => {
    const dir = project();
    assert.equal(json(dir, ['score']).anchorGranularity, undefined);
    assert.equal(json(dir, ['trace']).anchorGranularity, undefined);
    cli(dir, ['anchors', 'accept', '--baseline', '--bulk', '--reason', 'adopt anchors for the fixture']);
    const score = json(dir, ['score']);
    assert.deepEqual([score.anchorGranularity.links, score.anchorGranularity.byScope, score.anchorGranularity.byTier], [1, { symbol: 1 }, { 'babel@7': 1 }]);
    assert.match(score.anchorGranularity.info, /information only/);
    assert.equal(json(dir, ['trace']).anchorGranularity.links, 1);
  });
});
