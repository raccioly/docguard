/**
 * Trace-matrix export (specs/070-requirement-anchors, user story 8): every
 * requirement → anchor → test path as CSV with fixed, documented columns, or
 * as a well-formed ReqIF 1.2 document holding each requirement and link once,
 * byte-identical across runs, written through safeWrite with --out.
 *
 * @req docguard.requirement-anchors#FR-037
 * @req docguard.requirement-anchors#SC-010
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CSV_COLUMNS, matrixModel, toCsv, toReqif, xmlEscape } from '../cli/writers/trace-matrix.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const HAS_PYTHON = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0;
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], { encoding: 'utf8' });

/** Two requirements, three anchors, two tests: FR-001 × (2 anchors × 2 tests) + FR-002 × 1 anchor = 5 rows. */
function project({ extraSpec = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-trace-matrix-'));
  dirs.push(dir);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  write(dir, 'specs/001-billing/spec.md', `# Billing\n\n**Spec ID**: \`acme.billing\`\n\n- **FR-001**: Charges.\n- **FR-002**: Carts.\n${extraSpec}`);
  write(dir, 'src/billing.mjs', "import { round } from './math.mjs';\n\n/** @implements acme.billing#FR-001 */\nexport function charge(t) { return round(t); }\n\n/** @implements acme.billing#FR-001 */\nexport function refund(t) { return -round(t); }\n");
  write(dir, 'src/cart.mjs', "import { round } from './math.mjs';\n\n/** @implements acme.billing#FR-002 */\nexport class Cart { total() { return round(1); } }\n");
  write(dir, 'src/math.mjs', 'export const round = n => Math.round(n);\n');
  write(dir, 'tests/a.test.mjs', "// @req acme.billing#FR-001\nimport { test } from 'node:test';\ntest('a', () => {});\n");
  write(dir, 'tests/b.test.mjs', "// @req acme.billing#FR-001\nimport { test } from 'node:test';\ntest('b', () => {});\n");
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 't@example.com']);
  fixtureGit(dir, ['config', 'user.name', 't']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-qm', 'base']);
  assert.equal(cli(dir, ['anchors', 'accept', '--spec', 'acme.billing', '--bulk', '--reason', 'reviewed the billing links']).status, 0);
  return dir;
}

const parseCsv = text => text.trimEnd().split('\n').map(line => line.split(','));

/** Parse with the standard library's XML parser and return what the matrix must hold. */
function reqifFacts(xml) {
  const script = `
import json, sys, xml.etree.ElementTree as ET
ns = '{http://www.omg.org/spec/ReqIF/20110401/reqif.xsd}'
root = ET.fromstring(sys.stdin.read())
content = root.find(f'{ns}CORE-CONTENT/{ns}REQ-IF-CONTENT')
ids = [e.get('IDENTIFIER') for e in root.iter() if e.get('IDENTIFIER')]
refs = [e.text for e in root.iter() if e.tag.endswith('-REF')]
def values(obj):
    return [v.get('THE-VALUE') for v in obj.iter(f'{ns}ATTRIBUTE-VALUE-STRING')]
objects = {}
for o in content.find(f'{ns}SPEC-OBJECTS'):
    kind = o.find(f'{ns}TYPE/{ns}SPEC-OBJECT-TYPE-REF').text
    objects.setdefault(kind, []).append(values(o))
types = {t.get('IDENTIFIER'): t.get('LONG-NAME') for t in content.find(f'{ns}SPEC-TYPES')}
rels = [(types[r.find(f'{ns}TYPE/{ns}SPEC-RELATION-TYPE-REF').text], r.find(f'{ns}SOURCE/{ns}SPEC-OBJECT-REF').text, r.find(f'{ns}TARGET/{ns}SPEC-OBJECT-REF').text) for r in content.find(f'{ns}SPEC-RELATIONS')]
print(json.dumps({
  'root': root.tag, 'sections': [c.tag.replace(ns, '') for c in content],
  'idsUnique': len(ids) == len(set(ids)), 'refsResolve': all(r in set(ids) for r in refs),
  'objects': {types[k]: v for k, v in objects.items()}, 'relations': sorted(r[0] for r in rels),
}))
`;
  const r = spawnSync('python3', ['-I', '-c', script], { input: xml, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('CSV (FR-037)', () => {
  it('has the documented header and one row per (link, test), sorted', () => {
    const dir = project();
    const out = cli(dir, ['trace', '--matrix', '--format', 'csv']);
    assert.equal(out.status, 0, out.stderr);
    const [header, ...rows] = parseCsv(out.stdout);
    assert.deepEqual(header, [...CSV_COLUMNS]);
    assert.equal(header.join(','), 'requirement,requirement_fp,spec_state,file,anchor,scope,tier,confidence,link_state,suspect_side,code_fp,reviewed_revision,reviewed_date,test_file,test_line,test_status');
    const col = name => header.indexOf(name);
    assert.deepEqual(rows.map(r => [r[col('requirement')], r[col('anchor')], r[col('test_file')], r[col('link_state')]]), [
      ['acme.billing#FR-001', 'charge', 'tests/a.test.mjs', 'reviewed'],
      ['acme.billing#FR-001', 'charge', 'tests/b.test.mjs', 'reviewed'],
      ['acme.billing#FR-001', 'refund', 'tests/a.test.mjs', 'reviewed'],
      ['acme.billing#FR-001', 'refund', 'tests/b.test.mjs', 'reviewed'],
      ['acme.billing#FR-002', 'Cart', '', 'reviewed'],
    ]);
    for (const r of rows) {
      assert.match(r[col('requirement_fp')], /^dg1:sha256:[0-9a-f]{64}$/);
      assert.match(r[col('code_fp')], /^dg1:sha256:[0-9a-f]{64}$/);
      assert.match(r[col('reviewed_revision')], /^[0-9a-f]{40}$/);
    }
    assert.ok(out.stdout.endsWith('\n') && !out.stdout.includes('\r'));
  });

  it('sorts requirements by byte order, not by where their spec was found', () => {
    const dir = project();
    // specs/002-alpha is read after specs/001-billing, but acme.alpha sorts first.
    // Its code lives in src/zeta.mjs, which sorts after every billing file.
    write(dir, 'specs/002-alpha/spec.md', '# Alpha\n\n**Spec ID**: `acme.alpha`\n\n- **FR-001**: Alpha.\n');
    write(dir, 'src/zeta.mjs', "import { round } from './math.mjs';\n\n/** @implements acme.alpha#FR-001 */\nexport function alpha() { return round(1); }\n");
    fixtureGit(dir, ['add', '-A']);
    const [header, ...rows] = parseCsv(cli(dir, ['trace', '--matrix']).stdout);
    assert.equal(rows.find(r => r[header.indexOf('requirement')] === 'acme.alpha#FR-001')[header.indexOf('file')], 'src/zeta.mjs');
    const reqs = rows.map(r => r[header.indexOf('requirement')]);
    assert.deepEqual([...new Set(reqs)], ['acme.alpha#FR-001', 'acme.billing#FR-001', 'acme.billing#FR-002']);
  });

  it('a requirement with no link is a missing row; a changed link marks its tests', () => {
    const dir = project({ extraSpec: '- **FR-003**: Refund notices.\n' });
    write(dir, 'src/billing.mjs', readFileSync(join(dir, 'src/billing.mjs'), 'utf8').replace('round(t); }\n\n/**', 'round(t) + 1; }\n\n/**'));
    const [header, ...rows] = parseCsv(cli(dir, ['trace', '--matrix']).stdout);
    const col = name => header.indexOf(name);
    const missing = rows.filter(r => r[col('requirement')] === 'acme.billing#FR-003');
    assert.deepEqual(missing.map(r => [r[col('link_state')], r[col('file')]]), [['missing', '']]);
    const charge = rows.filter(r => r[col('anchor')] === 'charge');
    assert.deepEqual(charge.map(r => [r[col('link_state')], r[col('suspect_side')], r[col('test_status')]]), [['suspect', 'code', 'needs-reverification'], ['suspect', 'code', 'needs-reverification']]);
    assert.ok(rows.filter(r => r[col('anchor')] === 'refund').every(r => r[col('test_status')] === 'linked'));
  });

  it('quotes per RFC 4180 and defuses formula injection', () => {
    const row = Object.fromEntries(CSV_COLUMNS.map(c => [c, '']));
    const csv = toCsv([{ ...row, requirement: '=HYPERLINK("http://x")', file: 'a,b.mjs', anchor: 'say "hi"', test_file: '@x', tier: '+1', scope: '-2', confidence: '\tz' }]);
    const line = csv.split('\n')[1];
    assert.ok(line.startsWith(`"'=HYPERLINK(""http://x"")"`), line);
    assert.ok(line.includes('"a,b.mjs"'));
    assert.ok(line.includes('"say ""hi"""'));
    for (const cell of ["'@x", "'+1", "'-2", "'\tz"]) assert.ok(line.includes(cell), cell);
  });

  it('--spec keeps one spec, and an unsupported format is refused', () => {
    const dir = project();
    const [, ...rows] = parseCsv(cli(dir, ['trace', '--matrix', '--spec', 'acme.other']).stdout);
    assert.equal(rows.length, 0);
    const r = cli(dir, ['trace', '--matrix', '--format', 'text']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /csv, reqif or json/);
  });
});

describe('ReqIF 1.2 (FR-037, SC-010)', { skip: !HAS_PYTHON && 'python3 parses the XML here' }, () => {
  it('is well-formed, in the ReqIF namespace and section order, with each requirement and link once', () => {
    const dir = project();
    const out = cli(dir, ['trace', '--matrix', '--format', 'reqif']);
    assert.equal(out.status, 0, out.stderr);
    const facts = reqifFacts(out.stdout);
    assert.equal(facts.root, '{http://www.omg.org/spec/ReqIF/20110401/reqif.xsd}REQ-IF');
    assert.deepEqual(facts.sections, ['DATATYPES', 'SPEC-TYPES', 'SPEC-OBJECTS', 'SPEC-RELATIONS', 'SPECIFICATIONS']);
    assert.ok(facts.idsUnique);
    assert.ok(facts.refsResolve);
    assert.deepEqual(facts.objects.Requirement.map(v => v[0]), ['acme.billing#FR-001', 'acme.billing#FR-002']);
    assert.deepEqual(facts.objects.Anchor.map(v => v[1]), ['charge', 'refund', 'Cart']);
    assert.deepEqual(facts.objects.Test.map(v => v[0]), ['tests/a.test.mjs', 'tests/b.test.mjs']);
    assert.deepEqual(facts.relations, ['implements', 'implements', 'implements', 'verifies', 'verifies']);
  });

  it('a test cited by a changed and an unchanged link of one requirement keeps the cautious status', () => {
    const dir = project();
    write(dir, 'src/billing.mjs', readFileSync(join(dir, 'src/billing.mjs'), 'utf8').replace('round(t); }\n\n/**', 'round(t) + 1; }\n\n/**'));
    const facts = reqifFacts(cli(dir, ['trace', '--matrix', '--format', 'reqif']).stdout);
    assert.deepEqual(facts.objects.Test.map(v => [v[0], v[2]]), [['tests/a.test.mjs', 'needs-reverification'], ['tests/b.test.mjs', 'needs-reverification']]);
  });

  it('escapes every XML special character and drops what XML cannot carry', () => {
    const model = matrixModel([], [{ identity: `a<b>&"c'\u0001`, fingerprint: '', specState: '' }]);
    const facts = reqifFacts(toReqif(model));
    assert.deepEqual(facts.objects.Requirement.map(v => v[0]), [`a<b>&"c'`]);
    assert.equal(xmlEscape('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
  });
});

describe('determinism and --out', () => {
  it('two runs are byte-identical in both formats', () => {
    const dir = project();
    for (const format of ['csv', 'reqif']) {
      assert.equal(cli(dir, ['trace', '--matrix', '--format', format]).stdout, cli(dir, ['trace', '--matrix', '--format', format]).stdout, format);
    }
  });

  it('--out writes the same bytes through safeWrite and keeps stdout empty', () => {
    const dir = project();
    const expected = cli(dir, ['trace', '--matrix', '--format', 'reqif']).stdout;
    const r = cli(dir, ['trace', '--matrix', '--format', 'reqif', '--out', 'reports/trace.reqif']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(readFileSync(join(dir, 'reports/trace.reqif'), 'utf8'), expected);
    write(dir, 'reports/trace.reqif', 'hand edits');
    cli(dir, ['trace', '--matrix', '--format', 'reqif', '--output', 'reports/trace.reqif']);
    assert.ok(existsSync(join(dir, 'reports/trace.reqif.bak')), 'the previous file is backed up');
  });
});
