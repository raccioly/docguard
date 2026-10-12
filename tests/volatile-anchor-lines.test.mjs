/**
 * Volatile lines (specs/072-volatile-anchor-lines): a line carrying a
 * `docguard:volatile` comment is fingerprinted as a placeholder, at every
 * tier, so a release-managed value can change without turning a link
 * suspect, while adding or removing the marker is itself a change.
 *
 * Every "unchanged" assertion has a control beside it: the same edit without
 * the marker must change the fingerprint, or the test would prove nothing.
 *
 * @req docguard.volatile-anchor-lines#FR-001
 * @req docguard.volatile-anchor-lines#FR-002
 * @req docguard.volatile-anchor-lines#FR-003
 * @req docguard.volatile-anchor-lines#FR-004
 * @req docguard.volatile-anchor-lines#FR-005
 * @req docguard.volatile-anchor-lines#FR-006
 * @req docguard.volatile-anchor-lines#FR-007
 * @req docguard.volatile-anchor-lines#SC-001
 * @req docguard.volatile-anchor-lines#SC-003
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeAnchorStatus, computeLinks } from '../cli/scanners/anchors.mjs';
import { declarationTokens } from '../cli/scanners/ts-decls.mjs';
import { floorTokens, lex } from '../cli/scanners/pattern-lexer.mjs';
import { pythonVersion } from '../cli/scanners/py-anchors.mjs';
import { treeSitterManifest } from '../cli/scanners/ts-anchors.mjs';
import { validateRequirementAnchors } from '../cli/validators/requirement-anchors.mjs';
import { CODES } from '../cli/findings.mjs';
import { loadConfig } from '../cli/config.mjs';

const CLI = resolve('cli/docguard.mjs');
const ORACLE_NM = resolve('tools/anchor-oracle/node_modules');
const REAL_TS = existsSync(join(ORACLE_NM, 'web-tree-sitter/web-tree-sitter.js'));
const PLACEHOLDER = '\u0001volatile';
const SPEC = '# V\n\n**Spec ID**: `acme.v`\n\n- **FR-001**: Version.\n';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

function project(rel, content) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-volatile-'));
  dirs.push(dir);
  write(dir, 'specs/001-v/spec.md', SPEC);
  write(dir, rel, content);
  return dir;
}
function link(rel, content, config = {}) {
  const result = computeLinks(project(rel, content), config, { noCache: true });
  const found = result.links.filter(l => l.file === rel);
  assert.equal(found.length, 1, `one link in ${rel}: ${JSON.stringify(result.links.map(l => l.file))}`);
  return found[0];
}

/**
 * Each case is a source template with three knobs: the value on the version
 * line, whether that line carries the marker, and an edit on another line of
 * the same anchor.
 */
const CASES = [
  {
    name: 'Babel (JS)', rel: 'src/build.mjs', tier: /^babel@7$/,
    src: ({ v, mark, other }) => `// header\nexport const LIMIT = 3;\n\n// @implements acme.v#FR-001\nexport function build() {\n  const version = '${v}';${mark ? ' // docguard:volatile' : ''}\n  return { version, limit: LIMIT${other ? ' + 1' : ''} };\n}\n`,
  },
  {
    name: 'python-ast', rel: 'src/build.py', tier: /^python-ast@/, skip: !pythonVersion() && 'python3 is not available',
    src: ({ v, mark, other }) => `LIMIT = 3\n\n\n# @implements acme.v#FR-001\ndef build():\n    version = "${v}"${mark ? '  # docguard:volatile' : ''}\n    return {"version": version, "limit": LIMIT${other ? ' + 1' : ''}}\n`,
  },
  {
    name: 'pattern (Go)', rel: 'src/build.go', tier: /^pattern@1$/,
    src: ({ v, mark, other }) => `package v\n\nconst Limit = 3\n\n// @implements acme.v#FR-001\nfunc Build() (string, int) {\n\tversion := "${v}"${mark ? ' // docguard:volatile' : ''}\n\treturn version, Limit${other ? ' + 1' : ''}\n}\n`,
  },
  {
    name: 'pattern (Ruby, # comments)', rel: 'src/build.rb', tier: /^pattern@1$/,
    src: ({ v, mark, other }) => `LIMIT = 3\n\n# @implements acme.v#FR-001\ndef build\n  version = "${v}"${mark ? ' # docguard:volatile' : ''}\n  [version, LIMIT${other ? ' + 1' : ''}]\nend\n`,
  },
  {
    name: 'file tier (YAML)', rel: 'deploy/app.yml', tier: /^file$/,
    src: ({ v, mark, other }) => `# @implements acme.v#FR-001\nname: ${other ? 'demo2' : 'demo'}\nversion: "${v}"${mark ? ' # docguard:volatile' : ''}\n`,
  },
];

describe('a value on a marked line can change; everything else still counts (FR-002, FR-003)', () => {
  for (const c of CASES) {
    describe(c.name, { skip: c.skip }, () => {
      const at = knobs => link(c.rel, c.src({ v: '1.0.0', mark: true, other: false, ...knobs }));
      it('anchors at the expected tier', () => assert.match(at({}).tier, c.tier));
      it('the marked value changes: exact and floor are unchanged', () => {
        const before = at({});
        const after = at({ v: '2.0.0' });
        assert.equal(after.exact, before.exact);
        assert.equal(after.floor, before.floor);
      });
      it('control: the same value change without the marker changes both', () => {
        const before = at({ mark: false });
        const after = at({ mark: false, v: '2.0.0' });
        assert.notEqual(after.exact, before.exact);
        assert.notEqual(after.floor, before.floor);
      });
      it('another line of the anchor changes: both change', () => {
        const before = at({});
        const after = at({ other: true });
        assert.notEqual(after.exact, before.exact);
        assert.notEqual(after.floor, before.floor);
      });
      it('adding the marker changes both (FR-003)', () => {
        const unmarked = at({ mark: false });
        const marked = at({});
        assert.notEqual(marked.exact, unmarked.exact);
        assert.notEqual(marked.floor, unmarked.floor);
      });
    });
  }

  describe('tree-sitter', { skip: !REAL_TS && 'the anchor-oracle CI job installs the vetted artifacts; locally run `npm ci --ignore-scripts --prefix tools/anchor-oracle`' }, () => {
    const manifest = treeSitterManifest();
    const real = {
      runtime: join(ORACLE_NM, 'web-tree-sitter/web-tree-sitter.js'), runtimeWasm: join(ORACLE_NM, 'web-tree-sitter/web-tree-sitter.wasm'),
      grammars: { go: join(ORACLE_NM, manifest.grammars.go.package, manifest.grammars.go.file) },
    };
    const go = CASES.find(c => c.rel.endsWith('.go'));
    const at = knobs => link(go.rel, go.src({ v: '1.0.0', mark: true, other: false, ...knobs }), { anchors: { treeSitter: { artifacts: real } } });
    it('anchors at the tree-sitter tier', () => assert.match(at({}).tier, /^treesitter@/));
    it('the marked value changes: exact and floor are unchanged; without the marker both change', () => {
      assert.equal(at({ v: '2.0.0' }).exact, at({}).exact);
      assert.notEqual(at({ mark: false, v: '2.0.0' }).exact, at({ mark: false }).exact);
    });
    it('adding the marker or editing another line changes the exact fingerprint', () => {
      assert.notEqual(at({}).exact, at({ mark: false }).exact);
      assert.notEqual(at({ other: true }).exact, at({}).exact);
    });
  });
});

describe('only what lies wholly on the marked line is replaced (FR-002)', () => {
  it('a template literal that starts on a marked line and continues is still fingerprinted (Babel and floor)', () => {
    const src = tail => `// header\nexport const N = 1;\n\n// @implements acme.v#FR-001\nexport function banner() {\n  return /* docguard:volatile */ \`1.0.0\n${tail}\`;\n}\n`;
    const a = link('src/banner.mjs', src('alpha'));
    const b = link('src/banner.mjs', src('beta'));
    assert.notEqual(b.exact, a.exact);
    assert.notEqual(b.floor, a.floor);
  });

  it('floor: tokens on a marked line collapse to one placeholder per line; layout tokens stay', () => {
    const src = 'func F() {\n\ta := "1" + "2" // docguard:volatile\n\treturn a\n}\n';
    // The `;` after the placeholder is the virtual statement end of the marked line: layout, kept.
    assert.deepEqual(floorTokens(lex(src, 'go'), 0, src.length, new Set([2])), ['func', 'F', '(', ')', '{', PLACEHOLDER, ';', 'return', 'a', ';', '}']);
  });

  it('tree-sitter tokens: a node wholly on a marked row becomes one placeholder, a node across rows does not', () => {
    let id = 0;
    const leaf = (type, text, row, named = true) => ({ id: ++id, type, text, isNamed: named, childCount: 0, startPosition: { row }, endPosition: { row } });
    const inner = (type, children) => ({
      id: ++id, type, isNamed: true, childCount: children.length, child: i => children[i],
      startPosition: { row: Math.min(...children.map(c => c.startPosition.row)) }, endPosition: { row: Math.max(...children.map(c => c.endPosition.row)) },
      namedChildCount: children.filter(c => c.isNamed).length, namedChild(i) { return children.filter(c => c.isNamed)[i]; },
    });
    const name = leaf('identifier', 'F', 0);
    const assign = inner('short_var_declaration', [leaf('identifier', 'a', 1), leaf(':=', ':=', 1, false), leaf('interpreted_string_literal', '"1.0.0"', 1)]);
    const call = inner('call_expression', [leaf('identifier', 'f', 2), leaf('interpreted_string_literal', '"x"', 3)]);
    const decl = inner('function_declaration', [leaf('func', 'func', 0, false), name, assign, call]);
    // Line 2 holds the whole assignment: one placeholder for it.
    assert.deepEqual(declarationTokens(decl, name, new Set([2])), ['func', PLACEHOLDER, 'identifier:f', 'interpreted_string_literal:"x"']);
    // Line 3 starts a call that ends on line 4: the call stays, only its leaf on line 3 is replaced.
    assert.deepEqual(declarationTokens(decl, name, new Set([3])), ['func', 'identifier:a', ':=', 'interpreted_string_literal:"1.0.0"', PLACEHOLDER, 'interpreted_string_literal:"x"']);
    assert.deepEqual(declarationTokens(decl, name), ['func', 'identifier:a', ':=', 'interpreted_string_literal:"1.0.0"', 'identifier:f', 'interpreted_string_literal:"x"']);
  });
});

describe('what marks a line (FR-001)', () => {
  it('the marker inside a string literal marks nothing', () => {
    const src = v => `// header\nexport const N = 1;\n\n// @implements acme.v#FR-001\nexport function build() {\n  const version = '${v}'; const note = "// docguard:volatile";\n  return [version, note];\n}\n`;
    assert.notEqual(link('src/s.mjs', src('2.0.0')).exact, link('src/s.mjs', src('1.0.0')).exact);
  });

  it('the marker inside a quoted YAML value marks nothing', () => {
    const src = v => `# @implements acme.v#FR-001\nversion: "${v}"\nnote: "# docguard:volatile"\n`;
    const srcSameLine = v => `# @implements acme.v#FR-001\nversion: "${v} # docguard:volatile"\n`;
    assert.notEqual(link('a.yml', src('2.0.0')).exact, link('a.yml', src('1.0.0')).exact);
    assert.notEqual(link('a.yml', srcSameLine('2.0.0')).exact, link('a.yml', srcSameLine('1.0.0')).exact);
  });

  // Each of these contains the text `docguard:volatile`, so it passes the fast
  // path and reaches the whole-word check.
  for (const near of ['docguard:volatiles', 'docguard:volatile-ish', 'not-docguard:volatile', 'xdocguard:volatile']) {
    it(`only the whole word counts: ${near} marks nothing`, () => {
      const src = v => `# @implements acme.v#FR-001\nversion: "${v}" # ${near}\n`;
      assert.notEqual(link('b.yml', src('2.0.0')).exact, link('b.yml', src('1.0.0')).exact);
    });
  }

  it('a block comment marks the line it starts on', () => {
    const src = v => `// header\nexport const N = 1;\n\n// @implements acme.v#FR-001\nexport function build() {\n  const version = '${v}'; /* docguard:volatile\n  release-managed */\n  return version;\n}\n`;
    assert.equal(link('src/b.mjs', src('2.0.0')).exact, link('src/b.mjs', src('1.0.0')).exact);
  });
});

describe('a file with no marker fingerprints as before (FR-004)', () => {
  it('a marker on a comment-only line has no code to replace: exact and floor equal those of any other comment there', () => {
    const src = note => `// header\nexport const N = 1;\n\n// @implements acme.v#FR-001\nexport function build() {\n  ${note}\n  return N;\n}\n`;
    const plain = link('src/c.mjs', src('// release-managed'));
    const marked = link('src/c.mjs', src('// docguard:volatile'));
    assert.equal(marked.exact, plain.exact);
    assert.equal(marked.floor, plain.floor);
  });
  // The byte-for-byte guarantee for every tier is the golden fixture test
  // (tests/requirement-anchors-golden.test.mjs): no golden file carries a
  // marker, so any change to an unmarked fingerprint fails it.
});

describe('an anchor made only of volatile lines is listed (FR-005)', () => {
  const SRC = '// header\nexport const N = 1;\n\n// @implements acme.v#FR-001\nexport const VERSION = \'1.0.0\'; // docguard:volatile\n';

  it('computeAnchorStatus reports ANC011 for it, and not for a partly volatile anchor', () => {
    const dir = project('src/version.mjs', SRC);
    const status = computeAnchorStatus(dir, {}, { noCache: true });
    const anc011 = status.problems.filter(p => p.code === 'ANC011');
    assert.equal(anc011.length, 1);
    assert.equal(anc011[0].file, 'src/version.mjs');
    assert.match(anc011[0].message, /volatile/);
    const partly = project('src/build.mjs', CASES[0].src({ v: '1.0.0', mark: true, other: false }));
    assert.deepEqual(computeAnchorStatus(partly, {}, { noCache: true }).problems.filter(p => p.code === 'ANC011'), []);
  });

  it('guard never reports it; `docguard anchors` lists it as info', () => {
    const dir = project('src/version.mjs', SRC);
    const status = computeAnchorStatus(dir, {}, { noCache: true });
    const findings = validateRequirementAnchors(dir, {}, { status }).findings || [];
    assert.ok(!findings.some(f => f.code === 'ANC011'));
    const out = JSON.parse(execFileSync(process.execPath, [CLI, 'anchors', '--format', 'json', '--dir', dir], { encoding: 'utf8' }));
    const listed = out.problems.filter(p => p.code === 'ANC011');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].severity, 'info');
  });
});

describe('documented (FR-007)', () => {
  const read = rel => readFileSync(resolve(rel), 'utf8');
  it('docs/commands.md describes the marker, the placeholder rule and ANC011', () => {
    const text = read('docs/commands.md');
    assert.match(text, /docguard:volatile/);
    assert.match(text, /placeholder/);
    assert.match(text, /ANC011/);
    assert.match(text, /crosses onto another line/);
  });
  it('SECURITY.md says marked lines are outside change detection and that adding a marker is detected', () => {
    const text = read('docs-canonical/SECURITY.md');
    assert.match(text, /`docguard:volatile` is outside requirement-anchor change detection/);
    assert.match(text, /adding or removing it turns a reviewed link over that line suspect/);
  });
  it('the finding catalog carries ANC011', () => {
    assert.equal(CODES.ANC011.validator, 'requirementAnchors');
    assert.match(CODES.ANC011.help, /never by guard/);
  });
});

describe('this repository (FR-006, SC-003)', () => {
  it('marks its two release-managed version lines', () => {
    assert.match(readFileSync(resolve('action.yml'), 'utf8'), /DOCGUARD_RELEASED_VERSION: '\d+\.\d+\.\d+' # docguard:volatile/);
    assert.match(readFileSync(resolve('extensions/spec-kit-docguard/extension.yml'), 'utf8'), /^ {2}version: "\d+\.\d+\.\d+" # docguard:volatile/m);
  });
  it('every link is reviewed or baselined, and no anchor is made only of marked lines', () => {
    const status = computeAnchorStatus(resolve('.'), loadConfig(resolve('.')), { noCache: true });
    const open = status.links.filter(l => !['reviewed', 'baselined'].includes(l.state)).map(l => `${l.state} ${l.key}`);
    assert.deepEqual(open, []);
    assert.deepEqual(status.problems.filter(p => p.code === 'ANC011'), []);
  });
});
