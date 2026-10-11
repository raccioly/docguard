/**
 * The opt-in tree-sitter tier (specs/070-requirement-anchors, user story 10,
 * FR-009): it loads only when configured, only artifacts whose sha256 the
 * shipped manifest pins, imports only the verified copy under .docguard/ts/,
 * parses in a child with no environment, and falls back to the pattern tier
 * with ANC010 for anything missing or mismatched. With the real vetted
 * artifacts (installed by the anchor-oracle CI job), it anchors the golden
 * fixture's symbols with tree-sitter spans and formatting-stable fingerprints.
 *
 * @req docguard.requirement-anchors#FR-009
 * @req docguard.requirement-anchors#FR-040
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { computeLinks } from '../cli/scanners/anchors.mjs';
import { treeSitterManifest } from '../cli/scanners/ts-anchors.mjs';

const FAKE = resolve('tests/fixtures/anchors/treesitter');
const ORACLE = resolve('tools/anchor-oracle');
const REAL = existsSync(join(ORACLE, 'node_modules/web-tree-sitter/web-tree-sitter.js'));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

const GO = 'package svc\n\nimport "fmt"\n\n// @implements acme.svc#FR-001\nfunc Serve(n int) int {\n\tfmt.Println(n)\n\treturn n + 1\n}\n';
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-ts-'));
  dirs.push(dir);
  write(dir, 'specs/001-svc/spec.md', '# Svc\n\n**Spec ID**: `acme.svc`\n\n- **FR-001**: Serve.\n');
  write(dir, 'src/svc.go', GO);
  return dir;
}
const fakeArtifacts = { runtime: join(FAKE, 'fake-runtime.mjs'), runtimeWasm: join(FAKE, 'fake-runtime.wasm'), grammars: { go: join(FAKE, 'fake-go.wasm') } };
const fakeManifest = {
  schemaVersion: 1,
  runtime: { files: { 'web-tree-sitter.js': sha(fakeArtifacts.runtime), 'web-tree-sitter.wasm': sha(fakeArtifacts.runtimeWasm) } },
  grammars: { go: { sha256: sha(fakeArtifacts.grammars.go) } },
};
const links = (dir, artifacts, manifest) => computeLinks(dir, artifacts ? { anchors: { treeSitter: { artifacts } } } : {}, { noCache: true, treeSitterManifest: manifest });
const tsProblems = result => result.problems.filter(p => p.code === 'ANC010' && /tree-sitter/.test(p.message)).map(p => p.message);

describe('loading (FR-009)', () => {
  it('is never auto-detected: an installed web-tree-sitter in the project is ignored', () => {
    const dir = project();
    write(dir, 'node_modules/web-tree-sitter/web-tree-sitter.js', 'throw new Error("must never load")');
    const result = links(dir);
    assert.equal(result.links[0].tier, 'pattern@1');
    assert.deepEqual(tsProblems(result), []);
    assert.ok(!existsSync(join(dir, '.docguard/ts')));
  });

  it('verified artifacts are staged under .docguard/ts/<sha256>/ and the child imports that copy, with no environment', () => {
    const dir = project();
    const result = links(dir, fakeArtifacts, fakeManifest);
    assert.deepEqual(tsProblems(result), []);
    const link = result.links[0];
    assert.match(link.tier, /^treesitter@[0-9a-f]{8}$/);
    assert.deepEqual([link.anchor, link.startLine, link.endLine, link.confidence], ['Serve', 6, 9, 'high']);
    assert.ok(existsSync(join(dir, '.docguard/ts', sha(fakeArtifacts.runtime), 'web-tree-sitter.js')));
    assert.equal(readFileSync(join(dir, '.docguard/.gitignore'), 'utf8'), '*\n');
  });

  it('the key is the same with and without the tier; only the tier and exact fingerprint differ, and the floor is shared', () => {
    const dir = project();
    const plain = links(dir).links[0];
    const ts = links(dir, fakeArtifacts, fakeManifest).links[0];
    assert.equal(ts.key, plain.key);
    assert.equal(ts.floor, plain.floor);
    assert.notEqual(ts.exact, plain.exact);
  });

  it('a file whose sha256 the manifest does not pin is refused and nothing is staged', () => {
    const dir = project();
    const result = links(dir, fakeArtifacts);
    assert.equal(result.links[0].tier, 'pattern@1');
    assert.match(tsProblems(result).join('\n'), /has sha256 [0-9a-f]{12}…, which the manifest does not pin/);
    assert.ok(!existsSync(join(dir, '.docguard/ts')));
  });

  it('a missing artifact, an unpinned language and a child that fails all fall back with ANC010', () => {
    const dir = project();
    assert.match(tsProblems(links(dir, { ...fakeArtifacts, runtime: join(FAKE, 'missing.mjs') }, fakeManifest)).join('\n'), /cannot be read/);
    assert.match(tsProblems(links(dir, { ...fakeArtifacts, grammars: { kotlin: fakeArtifacts.grammars.go } }, fakeManifest)).join('\n'), /no grammar is pinned for kotlin/);
    const broken = join(dirs[dirs.length - 1], 'broken-runtime.mjs');
    writeFileSync(broken, 'throw new Error("runtime exploded")\n');
    const failing = links(dir, { ...fakeArtifacts, runtime: broken }, { ...fakeManifest, runtime: { files: { ...fakeManifest.runtime.files, 'web-tree-sitter.js': sha(broken) } } });
    assert.equal(failing.links[0].tier, 'pattern@1');
    assert.match(tsProblems(failing).join('\n'), /runtime exploded|process failed/);
  });
});

describe('the manifest pins exactly the vetted oracle packages (FR-009, FR-040)', () => {
  const manifest = treeSitterManifest();
  const lock = JSON.parse(readFileSync(join(ORACLE, 'package-lock.json'), 'utf8'));
  it('every pinned version and integrity is the one in tools/anchor-oracle/package-lock.json', () => {
    const entry = name => lock.packages[`node_modules/${name}`];
    assert.deepEqual([manifest.runtime.version, manifest.runtime.integrity], [entry('web-tree-sitter').version, entry('web-tree-sitter').integrity]);
    for (const [lang, g] of Object.entries(manifest.grammars)) assert.deepEqual([g.version, g.integrity], [entry(g.package).version, entry(g.package).integrity], lang);
  });
  it('every pinned sha256 matches the installed file', { skip: !REAL && 'run `npm ci --ignore-scripts --prefix tools/anchor-oracle` to check the files themselves' }, () => {
    const nm = join(ORACLE, 'node_modules');
    assert.equal(sha(join(nm, 'web-tree-sitter/web-tree-sitter.js')), manifest.runtime.files['web-tree-sitter.js']);
    assert.equal(sha(join(nm, 'web-tree-sitter/web-tree-sitter.wasm')), manifest.runtime.files['web-tree-sitter.wasm']);
    for (const g of Object.values(manifest.grammars)) assert.equal(sha(join(nm, g.package, g.file)), g.sha256, g.package);
  });
});

describe('with the real vetted artifacts', { skip: !REAL && 'the anchor-oracle CI job installs them; locally run `npm ci --ignore-scripts --prefix tools/anchor-oracle`' }, () => {
  const nm = join(ORACLE, 'node_modules');
  const manifest = treeSitterManifest();
  const real = {
    runtime: join(nm, 'web-tree-sitter/web-tree-sitter.js'), runtimeWasm: join(nm, 'web-tree-sitter/web-tree-sitter.wasm'),
    grammars: Object.fromEntries(Object.entries(manifest.grammars).map(([lang, g]) => [lang, join(nm, g.package, g.file)])),
  };
  const golden = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-anchor-ts-golden-'));
    dirs.push(dir);
    cpSync(resolve('tests/fixtures/anchors/golden'), dir, { recursive: true });
    return dir;
  };
  const tsLinks = dir => computeLinks(dir, { anchors: { treeSitter: { artifacts: real } } }, { noCache: true });
  const PATTERN_FILES = ['src/sample.go', 'src/sample.rs', 'src/Sample.java', 'src/Sample.cs', 'src/sample.php', 'src/sample.rb', 'src/sample.c', 'src/sample.cpp'];

  it('every pattern-tier symbol with a vetted grammar is read by tree-sitter; Kotlin and Swift stay on the pattern tier', () => {
    const result = tsLinks(golden());
    assert.deepEqual(tsProblems(result), []);
    for (const l of result.links) {
      if (PATTERN_FILES.includes(l.file)) assert.match(l.tier, /^treesitter@/, `${l.file} ${l.requirement}`);
      if (/\.(kt|swift)$/.test(l.file)) assert.equal(l.tier, 'pattern@1');
    }
  });

  it('formatting keeps every tree-sitter fingerprint, and a one-token edit changes exactly the symbol it touches', () => {
    const base = Object.fromEntries(tsLinks(golden()).links.map(l => [l.key, l.exact]));
    const reformatted = golden();
    for (const file of PATTERN_FILES) {
      const path = join(reformatted, file);
      const comment = file.endsWith('.rb') ? '# note' : '// note';
      writeFileSync(path, readFileSync(path, 'utf8').split('\n').map(line => (line.trim() && !/^\s*(?:\/\/|#|\/\*|\*)/.test(line) ? `${line}  ${comment}` : line)).join('\n').replace(/\n\n/g, '\n\n\n'));
    }
    // Redundant parentheses around a whole return value are formatting too.
    const goPath = join(reformatted, 'src/sample.go');
    writeFileSync(goPath, readFileSync(goPath, 'utf8').replace('return float64(sum) * (1 - rate)', 'return (float64(sum) * (1 - rate))'));
    for (const l of tsLinks(reformatted).links.filter(l => PATTERN_FILES.includes(l.file))) assert.equal(l.exact, base[l.key], `${l.key} changed on formatting`);
    const edited = golden();
    for (const file of PATTERN_FILES) {
      const path = join(edited, file);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/1(\.0)? - (\$?)rate/, '2$1 - $2rate'));
    }
    for (const l of tsLinks(edited).links.filter(l => PATTERN_FILES.includes(l.file))) {
      assert.equal(l.exact !== base[l.key], l.requirement.endsWith('#FR-001'), l.key);
    }
  });
});
