/**
 * Requirement anchors (specs/070-requirement-anchors): a tag anchors to the
 * code directly below it, at the narrowest scope its position allows, with the
 * tier that resolved it; tags inside literals never count; projects that have
 * not opted in see no change.
 *
 * @req docguard.requirement-anchors#FR-001
 * @req docguard.requirement-anchors#FR-002
 * @req docguard.requirement-anchors#FR-003
 * @req docguard.requirement-anchors#FR-004
 * @req docguard.requirement-anchors#FR-005
 * @req docguard.requirement-anchors#FR-006
 * @req docguard.requirement-anchors#FR-007
 * @req docguard.requirement-anchors#FR-008
 * @req docguard.requirement-anchors#FR-011
 * @req docguard.requirement-anchors#FR-020
 * @req docguard.requirement-anchors#FR-021
 * @req docguard.requirement-anchors#FR-026
 * @req docguard.requirement-anchors#FR-041
 * @req docguard.requirement-anchors#SC-002
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeLinks, linkKey, requirementFingerprint } from '../cli/scanners/anchors.mjs';
import { resolveFileAnchors } from '../cli/scanners/anchor-tags.mjs';
import { requirementPatterns } from '../cli/shared-requirements.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const FIXTURE = resolve('tests/fixtures/anchors/positions');
const EXPECTED = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const copyFixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchors-'));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, 'expected.json'));
  return dir;
};
const run = (dir, args, env = {}) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8', env: { ...process.env, CI: '', ...env } });

describe('anchors resolve to the code under the tag (FR-001 to FR-008)', () => {
  const dir = copyFixture();
  const result = computeLinks(dir, {}, { noCache: true });
  const python = pyAstAvailable();

  for (const want of EXPECTED.links) {
    const label = `${want.file} ${want.requirement} → ${want.anchor || `${want.anchorPrefix}…`} (${want.scope})`;
    it(label, () => {
      const matches = result.links.filter(l => l.file === want.file && l.requirement === want.requirement && l.scope === want.scope
        && (want.anchor ? l.anchor === want.anchor : l.anchor.startsWith(want.anchorPrefix)));
      assert.ok(matches.length >= 1, `no link for ${label}; links in file: ${JSON.stringify(result.links.filter(l => l.file === want.file).map(l => [l.requirement, l.scope, l.anchor]))}`);
      const expectedTier = want.tier === 'python-ast@' && !python ? 'pattern@' : want.tier;
      assert.ok(matches[0].tier.startsWith(expectedTier), `${matches[0].tier} does not start with ${expectedTier}`);
      assert.match(matches[0].exact, /^dg1:sha256:[0-9a-f]{64}$/);
      assert.match(matches[0].floor, /^dg1:sha256:[0-9a-f]{64}$/);
      assert.match(matches[0].req, /^dg1:sha256:[0-9a-f]{64}$/);
    });
  }

  for (const gone of EXPECTED.absent) {
    it(`no anchor: ${gone.file} ${gone.requirement} (${gone.why})`, () => {
      assert.deepEqual(result.links.filter(l => l.file === gone.file && l.requirement === gone.requirement), []);
    });
  }

  it('Java overloads get distinct anchors', () => {
    const java = result.links.filter(l => l.file === 'src/Billing.java' && l.scope === 'symbol').map(l => l.anchor);
    assert.equal(new Set(java).size, 2, JSON.stringify(java));
  });

  it('a tag inside a string, template, regex, raw string or quoted YAML value is never a tag (FR-005)', () => {
    assert.deepEqual(result.links.filter(l => l.requirement.endsWith('#FR-009')), []);
  });

  for (const want of EXPECTED.problems) {
    it(`${want.code} at ${want.file}:${want.line} (${want.match})`, () => {
      const hit = result.problems.find(p => p.code === want.code && p.file === want.file && (p.line === want.line || p.line === null) && p.message.includes(want.match));
      assert.ok(hit, `missing; problems: ${JSON.stringify(result.problems.map(p => [p.code, p.file, p.line, p.message.slice(0, 90)]))}`);
    });
  }

  it('keys are unique, sorted and percent-encode the separator', () => {
    const keys = result.links.map(l => l.key);
    assert.deepEqual(keys, [...new Set(keys)].sort());
    assert.equal(linkKey({ requirement: 'a#FR-001', file: 'x|y%.mjs', anchor: 'f', scope: 'symbol' }), 'a#FR-001|x%7Cy%25.mjs|f|symbol');
  });
});

describe('an explicit scope overrides position, in the leading block too (FR-002)', () => {
  const resolve1 = (src, file) => resolveFileAnchors(src, file, requirementPatterns({})).anchors[0];
  it('JS: {scope=symbol} in the file header anchors the declaration below, with no ANC006', () => {
    const a = resolve1('/**\n * Helpers.\n * @implements acme.cli#FR-001 {scope=symbol}\n */\nexport function build(x) { return x; }\n', 'src/a.mjs');
    assert.deepEqual([a.scope, a.anchor, a.problems], ['symbol', 'build', []]);
  });
  it('pattern tier: {scope=symbol} in the file header anchors the declaration below', () => {
    const a = resolve1('// Server.\n// @implements acme.cli#FR-001 {scope=symbol}\nfunc Serve() int {\n\treturn 1\n}\n', 'src/a.go');
    assert.deepEqual([a.scope, a.anchor, a.problems], ['symbol', 'Serve', []]);
  });
});

describe('a tag inside a switch case (FR-002)', () => {
  it('anchors the statement under it, not the whole enclosing function', () => {
    const src = 'export function main(cmd) {\n  switch (cmd) {\n    case "agent":\n      // @implements acme.cli#FR-001\n      runAgent(cmd);\n      break;\n    default:\n      break;\n  }\n}\n';
    const [a] = resolveFileAnchors(src, 'src/cli.mjs', requirementPatterns({})).anchors;
    assert.deepEqual([a.scope, a.owner, a.startLine, a.endLine, a.problems], ['statement', 'main', 5, 5, []]);
  });
});

describe('fingerprints follow the code, not its formatting (FR-010, FR-011)', () => {
  const linkFor = (dir, file, requirement) => computeLinks(dir, {}, { noCache: true }).links.find(l => l.file === file && l.requirement === requirement);

  it('reformatting and comments leave a JS symbol fingerprint alone; a token edit changes only that symbol', () => {
    const dir = copyFixture();
    const before = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002');
    const otherBefore = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-004');
    const path = join(dir, 'src/pricing.mjs');
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, source.replace('export function applyDiscount(total, coupon) {\n  // @implements acme.billing#FR-003\n  const rate = coupon ? 0.1 : 0;',
      'export function applyDiscount(total, coupon,) {\n  // @implements acme.billing#FR-003\n    // a new explanatory comment\n  const rate = (coupon ? 0.1 : 0);'));
    const reformatted = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002');
    assert.equal(reformatted.exact, before.exact);
    writeFileSync(path, source.replace('const rate = coupon ? 0.1 : 0;', 'const rate = coupon ? 0.2 : 0;'));
    assert.notEqual(linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002').exact, before.exact);
    assert.equal(linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-004').exact, otherBefore.exact);
  });

  it('renaming a symbol with an unchanged body keeps its v1 fingerprint', () => {
    const dir = copyFixture();
    const before = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002');
    const path = join(dir, 'src/pricing.mjs');
    writeFileSync(path, readFileSync(path, 'utf8').replace('export function applyDiscount(', 'export function applyCouponDiscount('));
    const after = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002');
    assert.equal(after.anchor, 'applyCouponDiscount');
    assert.equal(after.exact, before.exact);
  });

  it('a directive comment inside the span changes the fingerprint; an ordinary comment does not', () => {
    const dir = copyFixture();
    const path = join(dir, 'src/pricing.mjs');
    const source = readFileSync(path, 'utf8');
    const before = linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002').exact;
    writeFileSync(path, source.replace('  return round(', '  // just a note\n  return round('));
    assert.equal(linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002').exact, before);
    writeFileSync(path, source.replace('  return round(', '  // @ts-ignore\n  return round('));
    assert.notEqual(linkFor(dir, 'src/pricing.mjs', 'acme.billing#FR-002').exact, before);
  });

  it('the requirement fingerprint covers the whole block and ignores whitespace-only edits', () => {
    assert.equal(requirementFingerprint('- **FR-1**: a  b\n  c'), requirementFingerprint('- **FR-1**: a b\r\n  c '));
    assert.notEqual(requirementFingerprint('- **FR-1**: a b\n  c'), requirementFingerprint('- **FR-1**: a b\n  d'));
  });
});

describe('opt-in and the cache (FR-026, FR-041)', () => {
  it('without a lock or anchors.enabled, guard reports nothing from the validator', () => {
    const dir = copyFixture();
    const out = run(dir, ['guard', '--format', 'json']);
    const json = JSON.parse(out.stdout);
    assert.equal(json.findings.some(f => /^ANC\d{3}$/.test(f.code)), false);
  });

  it('with anchors.enabled, guard reports ANC007 and never the anchors-only ANC006', () => {
    const dir = copyFixture();
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ anchors: { enabled: true } }));
    const json = JSON.parse(run(dir, ['guard', '--format', 'json']).stdout);
    const codes = json.findings.map(f => f.code).filter(code => code.startsWith('ANC'));
    assert.ok(codes.includes('ANC007'), JSON.stringify(codes));
    assert.equal(codes.includes('ANC006'), false);
  });

  it('`anchors --format json` lists links and anchors-only problems', () => {
    const dir = copyFixture();
    const json = JSON.parse(run(dir, ['anchors', '--format', 'json']).stdout);
    assert.equal(json.command, 'anchors');
    assert.equal(json.activated, false);
    assert.ok(json.links.length >= 20);
    assert.ok(json.problems.some(p => p.code === 'ANC006' && p.severity === 'info'));
  });

  it('the cache identity covers the resolver code and the requirement patterns', () => {
    const dir = copyFixture();
    const env = {};
    const before = computeLinks(dir, {}, { env }).links.length;
    const cache = JSON.parse(readFileSync(join(dir, '.docguard/anchors.cache.json'), 'utf8'));
    assert.match(JSON.stringify(cache), /\|code:[0-9a-f]{16}\|req:[0-9a-f]{16}/);
    // A pattern that recognizes no requirement ID: a stale cache would still answer with every link.
    const narrowed = computeLinks(dir, { traceability: { requirementPattern: 'NOPE-\\d{3}' } }, { env }).links.length;
    assert.ok(before > 0);
    assert.equal(narrowed, 0);
  });

  it('a warm run reuses the cache; a cache git tracks is ignored and reported', () => {
    const dir = copyFixture();
    const first = computeLinks(dir, {}, { env: {} });
    assert.equal(first.cache.enabled, true);
    assert.ok(existsSync(join(dir, '.docguard', 'anchors.cache.json')));
    const second = computeLinks(dir, {}, { env: {} });
    assert.deepEqual(second.links, first.links);
    fixtureGit(dir, ['init', '-q']);
    fixtureGit(dir, ['add', '-f', '.docguard/anchors.cache.json']);
    const third = computeLinks(dir, {}, { env: {} });
    assert.equal(third.cache.enabled, false);
    assert.ok(third.problems.some(p => p.code === 'ANC010' && /planted/.test(p.message)));
  });

  it('CI never trusts the cache', () => {
    const dir = copyFixture();
    assert.equal(computeLinks(dir, {}, { env: { CI: 'true' } }).cache.enabled, false);
  });
});
