/**
 * Golden fingerprints (specs/070-requirement-anchors FR-039, SC-001): the
 * fingerprint of every anchored symbol in tests/fixtures/anchors/golden is
 * frozen per language and tier, and survives reformatting in every language,
 * while a one-token edit changes exactly the symbol it touches.
 *
 * A change to any normalization rule fails this test by design. Bump the
 * algorithm version (`dg1` → `dg2`, `pattern@1` → `pattern@2`), then
 * regenerate with `DOCGUARD_WRITE_GOLDEN=1 node --test tests/requirement-anchors-golden.test.mjs`.
 * python-ast values are kept per interpreter minor version, because `ast`
 * changes shape between versions; a version with no recorded values is
 * skipped and says so.
 *
 * @req docguard.requirement-anchors#FR-010
 * @req docguard.requirement-anchors#FR-039
 * @req docguard.requirement-anchors#SC-001
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeLinks } from '../cli/scanners/anchors.mjs';
import { pythonVersion } from '../cli/scanners/py-anchors.mjs';

const FIXTURE = resolve('tests/fixtures/anchors/golden');
const GOLDEN_PATH = join(FIXTURE, 'golden.json');
const WRITE = process.env.DOCGUARD_WRITE_GOLDEN === '1';
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-golden-'));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, 'golden.json'), { force: true });
  return dir;
}
const linksOf = dir => computeLinks(dir, {}, { noCache: true }).links;
const keyOf = l => `${l.file} ${l.requirement}`;
const byKey = links => Object.fromEntries(links.map(l => [keyOf(l), l]));

const python = pythonVersion();
const current = linksOf(copy());
const entry = l => ({ anchor: l.anchor, scope: l.scope, tier: l.tier, exact: l.exact, floor: l.floor });

if (WRITE) {
  const previous = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : { stable: {}, python: {} };
  const stable = {};
  const py = {};
  for (const l of current) (l.tier.startsWith('python-ast@') ? py : stable)[keyOf(l)] = entry(l);
  const golden = { stable, python: { ...previous.python, ...(python ? { [python]: py } : {}) } };
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
}

const GOLDEN = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

describe('frozen fingerprints (FR-039)', () => {
  const now = byKey(current);
  for (const [key, want] of Object.entries(GOLDEN.stable)) {
    it(key, () => assert.deepEqual(entry(now[key] || {}), want));
  }
  const pyGolden = python ? GOLDEN.python[python] : null;
  for (const key of Object.keys(Object.values(GOLDEN.python)[0] || {})) {
    it(`${key} (python ${python || 'unavailable'})`, { skip: !pyGolden && `no golden values recorded for python ${python || '(none)'}; recorded: ${Object.keys(GOLDEN.python).join(', ')}` }, () => {
      assert.deepEqual(entry(now[key] || {}), pyGolden[key]);
    });
  }
  it('every language in the fixture is pinned', () => {
    const files = new Set(Object.keys(GOLDEN.stable).map(k => k.split(' ')[0]));
    for (const f of ['src/sample.mjs', 'src/sample.ts', 'src/sample.go', 'src/sample.rs', 'src/Sample.java']) assert.ok(files.has(f), f);
    assert.ok(Object.keys(GOLDEN.python).length >= 1);
  });
});

// Formatting edits, applied to every source file of the fixture.
const COMMENT = { '.py': '# note', default: '// note' };
const ext = file => file.slice(file.lastIndexOf('.'));
const TRANSFORMS = {
  'halve the indentation (tabs become two spaces)': (text) => text.split('\n')
    .map(line => line.replace(/^(\t+)/, m => '  '.repeat(m.length)).replace(/^( +)/, m => ' '.repeat(Math.max(1, m.length / 2) | 0)))
    .join('\n'),
  'add a comment at the end of every code line': (text, file) => text.split('\n')
    .map(line => (line.trim() && !/^\s*(?:\/\/|#|\/\*|\*)/.test(line) ? `${line}  ${COMMENT[ext(file)] || COMMENT.default}` : line))
    .join('\n'),
  'double every blank line': text => text.replace(/\n\n/g, '\n\n\n'),
};

describe('formatting never changes an exact fingerprint, in any language (SC-001)', () => {
  const base = byKey(current);
  for (const [name, transform] of Object.entries(TRANSFORMS)) {
    it(name, () => {
      const dir = copy();
      for (const file of ['src/sample.mjs', 'src/sample.ts', 'src/sample.py', 'src/sample.go', 'src/sample.rs', 'src/Sample.java']) {
        const path = join(dir, file);
        writeFileSync(path, transform(readFileSync(path, 'utf8'), file));
      }
      const after = byKey(linksOf(dir));
      for (const [key, link] of Object.entries(base)) {
        assert.ok(after[key], `${key} lost its anchor`);
        assert.equal(after[key].anchor, link.anchor, key);
        assert.equal(after[key].exact, link.exact, `${key} exact`);
        assert.equal(after[key].floor, link.floor, `${key} floor`);
      }
    });
  }

  it('JS/TS: trailing commas, quote style and redundant parentheses keep the exact fingerprint', () => {
    const dir = copy();
    const edit = (file, pairs) => {
      let text = readFileSync(join(dir, file), 'utf8');
      for (const [from, to] of pairs) { assert.ok(text.includes(from), from); text = text.replace(from, to); }
      writeFileSync(join(dir, file), text);
    };
    edit('src/sample.mjs', [['total(items, rate)', 'total(items, rate,)'], ["'value: '", '"value: "'], ['return sum * (1 - rate);', 'return (sum * (1 - rate));']]);
    edit('src/sample.ts', [['add(item: string)', 'add(item: string,)']]);
    const after = byKey(linksOf(dir));
    for (const key of Object.keys(base).filter(k => /\.(?:mjs|ts) /.test(k))) assert.equal(after[key].exact, base[key].exact, key);
  });

  it('a one-token edit changes exactly the symbol it touches, in every language', () => {
    const dir = copy();
    const edits = {
      'src/sample.mjs': ['1 - rate', '2 - rate'],
      'src/sample.ts': ['1 - rate', '2 - rate'],
      'src/sample.py': ['1 - rate', '2 - rate'],
      'src/sample.go': ['1 - rate', '2 - rate'],
      'src/sample.rs': ['1.0 - rate', '2.0 - rate'],
      'src/Sample.java': ['1 - rate', '2 - rate'],
    };
    for (const [file, [from, to]] of Object.entries(edits)) {
      const path = join(dir, file);
      const text = readFileSync(path, 'utf8');
      assert.ok(text.includes(from), `${file}: ${from}`);
      writeFileSync(path, text.replace(from, to));
    }
    const after = byKey(linksOf(dir));
    for (const [key, link] of Object.entries(base)) {
      const touched = key.endsWith('#FR-001');
      assert.equal(after[key].exact !== link.exact, touched, `${key} ${touched ? 'should' : 'should not'} change`);
    }
  });
});
