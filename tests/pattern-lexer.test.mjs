/**
 * Pattern-tier lexer, outline and floor fingerprint (specs/070-requirement-anchors).
 *
 * The pattern tier is DocGuard's own reader for Go, Rust, Java, Kotlin, C#,
 * PHP, Ruby, Swift, C and C++, and the floor fingerprint for every language.
 * These tests pin what a line regex gets wrong: a tag-shaped string inside any
 * kind of literal is not a comment; a declaration's span starts at its first
 * annotation and ends at its own closer; delimiters that do not balance are
 * reported instead of producing a span that runs to the end of the file; and
 * the floor ignores layout but not a newline that ends a Go statement.
 *
 * @req docguard.requirement-anchors#FR-005
 * @req docguard.requirement-anchors#FR-007
 * @req docguard.requirement-anchors#FR-008
 * @req docguard.requirement-anchors#FR-013
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  PATTERN_ALGO, PATTERN_TIER, DIRECTIVE_RE,
  languageOf, lex, outline, floorTokens, floorFingerprint, statementSpan,
} from '../cli/scanners/pattern-lexer.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/anchors/pattern/', import.meta.url));
const read = rel => readFileSync(join(FIXTURES, rel), 'utf8');
const quals = out => out.symbols.map(s => s.qual);
const bySym = (out, qual) => out.symbols.filter(s => s.qual === qual);
const one = (out, qual) => {
  const found = bySym(out, qual);
  assert.equal(found.length, 1, `expected exactly one ${qual}; symbols: ${quals(out).join(', ')}`);
  return found[0];
};
const text = (src, sym) => src.slice(sym.start, sym.end);
const symFloor = (out, qual) => { const s = one(out, qual); return floorFingerprint(out.lex, s.start, s.end); };

describe('exports', () => {
  it('names the tier and algorithm version', () => {
    assert.equal(PATTERN_ALGO, 1);
    assert.equal(PATTERN_TIER, 'pattern@1');
  });

  it('maps file paths to pattern languages and leaves config, shell and docs to the file tier', () => {
    const cases = {
      'a/b.go': 'go', 'x.rs': 'rust', 'X.java': 'java', 'k.kt': 'kotlin', 'build.gradle.kts': 'kotlin',
      'P.cs': 'csharp', 'i.php': 'php', 'r.rb': 'ruby', 'lib/Rakefile': 'ruby', 'S.swift': 'swift',
      'm.c': 'c', 'm.h': 'c', 'm.cpp': 'cpp', 'm.hpp': 'cpp', 'm.cc': 'cpp',
      'a.mjs': 'js', 'a.jsx': 'js', 'a.ts': 'ts', 'a.d.ts': 'ts', 'a.tsx': 'ts', 'a.py': 'python',
      'ci.yml': null, 'run.sh': null, 'README.md': null, 'package.json': null, 'Makefile': null,
      '.eslintrc': null, 'C:\\src\\main.go': 'go', 'x.constructor': null, '': null,
    };
    for (const [path, lang] of Object.entries(cases)) assert.equal(languageOf(path), lang, path);
    assert.equal(languageOf(undefined), null);
  });

  it('without a lexer for the language, reports it and still gives a floor that tracks the content', () => {
    const a = lex('a: 1\n', 'yaml');
    const b = lex('a: 2\n', 'yaml');
    assert.match(a.error, /no pattern lexer for yaml/);
    assert.deepEqual(outline('a: 1\n', 'yaml').symbols, []);
    assert.notEqual(floorFingerprint(a, 0, 5), floorFingerprint(b, 0, 5));
    assert.equal(statementSpan(a, 0), null);
  });

  it('returns tokens with UTF-16 offsets and 1-based lines', () => {
    const src = 'fn a() {}\n// c\nfn b() {}\n';
    const lx = lex(src, 'rust');
    assert.equal(lx.error, null);
    const b = lx.tokens.find(t => t.v === 'b');
    assert.deepEqual({ t: b.t, s: b.s, e: b.e, line: b.line }, { t: 'id', s: src.indexOf('b('), e: src.indexOf('b(') + 1, line: 3 });
    assert.deepEqual(lx.comments, [{ s: 10, e: 14, line: 2, endLine: 2, text: ' c', raw: '// c', kind: 'line' }]);
  });
});

describe('FR-005: a tag inside a literal is never a comment', () => {
  const fixtures = [
    ['js/literals.js', 'js'], ['python/literals.py', 'python'], ['go/literals.go', 'go'],
    ['rust/literals.rs', 'rust'], ['java/Literals.java', 'java'], ['kotlin/Literals.kt', 'kotlin'],
    ['csharp/Literals.cs', 'csharp'], ['php/literals.php', 'php'], ['ruby/literals.rb', 'ruby'],
    ['swift/Literals.swift', 'swift'], ['c/literals.c', 'c'], ['cpp/literals.cpp', 'cpp'],
  ];
  for (const [file, lang] of fixtures) {
    it(`${lang}: every literal form in ${file} hides its tag, and a real comment after it is still read`, () => {
      const src = read(file);
      assert.equal(languageOf(file), lang);
      const lx = lex(src, lang);
      assert.equal(lx.error, null);
      assert.deepEqual(lx.comments, []);
      assert.ok(lx.tokens.filter(t => t.t === 'str' && t.v.includes('@implements')).length >= 2);
      const marker = lang === 'python' || lang === 'ruby' ? '#' : '//';
      const after = lex(`${src}\n${marker} @implements x#FR-002\n`, lang);
      assert.equal(after.error, null);
      assert.equal(after.comments.length, 1);
      assert.equal(after.comments[0].text, ' @implements x#FR-002');
    });
  }

  it('ts: the JS literal forms read the same under TypeScript', () => {
    const lx = lex(read('js/literals.js'), 'ts');
    assert.equal(lx.error, null);
    assert.deepEqual(lx.comments, []);
  });

  it('js: a regex inside a template hole is not read as a comment', () => {
    const src = "const name = `resource-${page.path.replace(/^\\//, '').replace(/\\//g, '-')}`;\nconst half = `${a / b}`; // real\n";
    const lx = lex(src, 'js');
    assert.equal(lx.error, null);
    assert.deepEqual(lx.comments.map(c => c.text), [' real']);
  });

  it('js: tells a regex literal from division by the token before it', () => {
    const src = 'const half = total / 2 / 1; // real\nconst re = x ? /a\\/b/ : /[/]c/;\n';
    const lx = lex(src, 'js');
    assert.equal(lx.error, null);
    assert.equal(lx.comments.length, 1);
    assert.deepEqual(lx.tokens.filter(t => t.t === 'str').map(t => t.v), ['/a\\/b/', '/[/]c/']);
  });
});

describe('comment shapes', () => {
  it('strips block delimiters and the leading star of each line', () => {
    const lx = lex('/**\n * one\n * two\n */\nclass A {}\n', 'java');
    assert.equal(lx.comments.length, 1);
    assert.equal(lx.comments[0].kind, 'doc');
    assert.equal(lx.comments[0].text.trim(), 'one\ntwo');
    assert.deepEqual([lx.comments[0].line, lx.comments[0].endLine], [1, 4]);
  });

  it('marks Rust doc comments and nests block comments', () => {
    const src = '//! inner\n/// outer\n//// plain\n// plain\n/* a /* nested */ still */\n/** doc */\nfn x() {}\n';
    const lx = lex(src, 'rust');
    assert.equal(lx.error, null);
    assert.deepEqual(lx.comments.map(c => c.kind), ['doc', 'doc', 'line', 'line', 'block', 'doc']);
    assert.deepEqual(lx.comments.map(c => c.text.trim()), ['inner', 'outer', '// plain', 'plain', 'a /* nested */ still', 'doc']);
    for (const lang of ['kotlin', 'swift']) assert.equal(lex('/* a /* b */ c */\nval x = 1\n', lang).comments.length, 1);
  });

  it('php: #[attributes] are code, # and // comments stop at ?>', () => {
    const src = "<?php\n#[Route('/x')]\nfunction f() {} # one\n// two ?> <p>it's html</p> <?php\n$y = 1;\n";
    const lx = lex(src, 'php');
    assert.equal(lx.error, null);
    assert.deepEqual(lx.comments.map(c => c.text), [' one', ' two ']);
    assert.ok(lx.tokens.some(t => t.t === 'punct' && t.v === '#'));
  });

  it('ruby: =begin blocks are comments, #{} is not, and __END__ data is ignored', () => {
    const src = '=begin\nnotes\n=end\nx = "#{y}" # real\n__END__\n# not code\n';
    const lx = lex(src, 'ruby');
    assert.equal(lx.error, null);
    assert.deepEqual(lx.comments.map(c => [c.kind, c.text.trim()]), [['block', 'notes'], ['line', 'real']]);
  });

  it('python: a trailing directive comment keeps its text', () => {
    const lx = lex('x = f()  # type: ignore[attr]\n', 'python');
    assert.equal(lx.comments[0].text, ' type: ignore[attr]');
  });
});

describe('Rust', () => {
  it("tells lifetimes from character literals such as '{'", () => {
    const src = "pub fn pick<'a>(x: &'a str, open: char) -> &'a str {\n    if open == '{' { x } else { let _c = '}'; x }\n}\nfn after() {}\n";
    const out = outline(src, 'rust');
    assert.equal(out.error, null);
    assert.equal(one(out, 'pick').endLine, 3);
    assert.ok(text(src, one(out, 'pick')).endsWith('x }\n}'));
    assert.equal(one(out, 'after').startLine, 4);
    assert.ok(out.lex.tokens.some(t => t.t === 'id' && t.v === "'a"));
    assert.ok(out.lex.tokens.some(t => t.t === 'str' && t.v === "'{'"));
  });

  it('qualifies trait impl methods by their type and records the trait as the signature', () => {
    const src = 'pub struct Id(u32);\n\nimpl From<A> for Id {\n    fn from(a: A) -> Self { Id(a.0) }\n}\n\nimpl From<B> for Id {\n    fn from(b: B) -> Self { Id(b.0) }\n}\n\nimpl Id {\n    pub fn get(&self) -> u32 { self.0 }\n}\n\ntrait Named {\n    fn name(&self) -> String;\n    fn shout(&self) -> String { self.name() }\n}\n';
    const out = outline(src, 'rust');
    assert.equal(out.error, null);
    const froms = bySym(out, 'Id.from');
    assert.equal(froms.length, 2);
    assert.deepEqual(froms.map(s => s.sig), ['From<A>', 'From<B>']);
    assert.ok(froms.every(s => s.kind === 'method'));
    assert.deepEqual(bySym(out, 'Id').map(s => [s.kind, s.sig]), [['struct', null], ['impl', 'From<A>'], ['impl', 'From<B>'], ['impl', null]]);
    assert.equal(one(out, 'Id.get').sig, '&self');
    const name = one(out, 'Named.name');
    assert.equal(name.bodyOpen, null);
    assert.equal(text(src, name), 'fn name(&self) -> String;');
    assert.notEqual(one(out, 'Named.shout').bodyOpen, null);
    assert.equal(text(src, bySym(out, 'Id')[0]), 'pub struct Id(u32);');
  });

  it('starts a #[cfg(test)] module at its attribute and nests the functions inside it', () => {
    const src = 'fn lib() {}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn x() { assert!(true); }\n}\n';
    const out = outline(src, 'rust');
    const mod = one(out, 'tests');
    assert.equal(mod.kind, 'module');
    assert.ok(text(src, mod).startsWith('#[cfg(test)]\nmod tests {'));
    assert.ok(text(src, mod).endsWith('}\n}'));
    const x = one(out, 'tests.x');
    assert.ok(text(src, x).startsWith('#[test]\n    fn x()'));
    assert.equal(out.symbols[x.parent].qual, 'tests');
  });

  it('does not read symbols out of macro_rules! bodies or macro invocations', () => {
    const src = 'macro_rules! make {\n    ($n:ident) => { fn $n() { let _ = "}"; } };\n    () => {};\n}\nmake!(generated);\nlazy_static! { static ref X: u8 = 1; }\nfn after() -> u8 { 1 }\n';
    const out = outline(src, 'rust');
    assert.equal(out.error, null);
    assert.deepEqual(quals(out), ['make!', 'after']);
    assert.equal(text(src, one(out, 'after')), 'fn after() -> u8 { 1 }');
  });

  it('reads statics, consts, type aliases and nested functions', () => {
    const src = 'pub static mut COUNT: u32 = 0;\npub(crate) const fn zero() -> u32 { 0 }\nconst LIMITS: [u8; 2] = [1, 2];\ntype Map = std::collections::HashMap<String, u8>;\nfn outer() {\n    fn inner() {}\n}\n';
    const out = outline(src, 'rust');
    assert.deepEqual(out.symbols.map(s => [s.qual, s.kind, s.topLevel]), [
      ['COUNT', 'variable', true], ['zero', 'function', true], ['LIMITS', 'variable', true],
      ['Map', 'type', true], ['outer', 'function', true], ['outer.inner', 'function', false],
    ]);
    assert.ok(text(src, one(out, 'zero')).startsWith('pub(crate) const fn'));
    assert.equal(text(src, one(out, 'LIMITS')), 'const LIMITS: [u8; 2] = [1, 2];');
  });
});

describe('Go', () => {
  it('qualifies methods by receiver and reads generics, type and var declarations', () => {
    const src = 'package p\n\ntype Server struct{}\n\ntype List[T any] struct {\n\titems []T\n}\n\ntype Alias = int\n\ntype Grid [4]int\n\nfunc (s *Server) Run() error {\n\treturn nil\n}\n\nfunc (l *List[T]) Push(v T) {\n\tl.items = append(l.items, v)\n}\n\nfunc Map[T, U any](xs []T, f func(T) U) []U {\n\treturn nil\n}\n\nvar Version = "1"\n\nconst (\n\tA = iota\n\tB\n)\n';
    const out = outline(src, 'go');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.kind]), [
      ['Server', 'struct'], ['List', 'struct'], ['Alias', 'type'], ['Grid', 'type'], ['Server.Run', 'method'],
      ['List.Push', 'method'], ['Map', 'function'], ['Version', 'variable'], ['A', 'variable'], ['B', 'variable'],
    ]);
    assert.equal(text(src, one(out, 'Server.Run')), 'func (s *Server) Run() error {\n\treturn nil\n}');
    assert.equal(text(src, one(out, 'List')), 'type List[T any] struct {\n\titems []T\n}');
    assert.equal(one(out, 'Map').sig, '[]T, func(T)U');
    assert.equal(text(src, one(out, 'A')), 'A = iota');
  });

  it('inserts the statement terminator exactly where the Go spec does (FR-013)', () => {
    const lx = lex('package p\nfunc f() {\n\tx++\n\ty := g(\n\t\t1,\n\t)\n\tif y {\n\t} else {\n\t}\n\treturn\n}\n', 'go');
    const shape = lx.tokens.map(t => (t.t === 'semi' ? ';' : t.v)).join(' ');
    assert.equal(shape, 'package p ; func f ( ) { x + + ; y : = g ( 1 , ) ; if y { } else { } ; return ; } ;');
  });

  it('gives `return\\nfoo()` and `return foo()` different floor fingerprints', () => {
    const a = outline('package p\n\nfunc f() {\n\treturn\n\tfoo()\n}\n', 'go');
    const b = outline('package p\n\nfunc f() {\n\treturn foo()\n}\n', 'go');
    assert.notEqual(symFloor(a, 'f'), symFloor(b, 'f'));
    const s = one(a, 'f');
    assert.deepEqual(floorTokens(a.lex, s.start, s.end).slice(4, 8), ['{', 'return', ';', 'foo']);
  });

  it('keeps the floor fingerprint across re-indentation, blank lines and added comments', () => {
    const a = outline('package p\n\nfunc Sum(xs []int) (total int) {\n\tfor _, x := range xs {\n\t\ttotal += x\n\t}\n\treturn\n}\n', 'go');
    const b = outline('package p\n\n// Sum adds.\nfunc Sum(xs []int) (total int) {\n\n    // loop\n    for _, x := range xs { /* each */\n\n            total += x // add\n    }\n\n    return\n}\n', 'go');
    const sa = one(a, 'Sum'), sb = one(b, 'Sum');
    assert.deepEqual(floorTokens(a.lex, sa.start, sa.end), floorTokens(b.lex, sb.start, sb.end));
    assert.equal(symFloor(a, 'Sum'), symFloor(b, 'Sum'));
  });

  it('detects a one-identifier edit', () => {
    const a = outline('package p\nfunc f() int { return x }\n', 'go');
    const b = outline('package p\nfunc f() int { return y }\n', 'go');
    assert.notEqual(symFloor(a, 'f'), symFloor(b, 'f'));
  });
});

describe('Java', () => {
  it('keeps an annotation with array braces inside the method span and tells overloads apart', () => {
    const src = 'package a;\n\npublic class Billing {\n    @SuppressWarnings({"unchecked", "rawtypes"})\n    @Override\n    public int total(int x) { return x; }\n\n    public int total(String x) { return 0; }\n\n    private final String s = "// x";\n}\n';
    const out = outline(src, 'java');
    assert.equal(out.error, null);
    const totals = bySym(out, 'Billing.total');
    assert.deepEqual(totals.map(s => s.sig), ['int', 'String']);
    assert.ok(text(src, totals[0]).startsWith('@SuppressWarnings({"unchecked", "rawtypes"})\n    @Override'));
    assert.ok(text(src, totals[0]).endsWith('{ return x; }'));
    assert.equal(totals[0].nameLine, 6);
    assert.equal(totals[0].kind, 'method');
    assert.equal(out.symbols[totals[0].parent].qual, 'Billing');
    assert.equal(one(out, 'Billing').kind, 'class');
  });

  it('finds constructors, generic methods, interfaces and nested types, but not field initializers', () => {
    const src = 'class Outer<T> {\n    private final List<String> names = List.of("a");\n    private Runnable r = () -> { helper(); };\n    Outer(int n) { this.n = n; }\n    public <R> R map(Function<T, R> f) throws IOException, X { return null; }\n    interface Visitor { void visit(Node n); }\n    static class Inner extends Base implements A, B {\n        @Test void inner() {}\n    }\n    enum Kind { A("a"), B("b"); Kind(String s) {} }\n    @interface Marker {}\n}\n';
    const out = outline(src, 'java');
    assert.equal(out.error, null);
    assert.deepEqual(quals(out), [
      'Outer', 'Outer.Outer', 'Outer.map', 'Outer.Visitor', 'Outer.Visitor.visit', 'Outer.Inner',
      'Outer.Inner.inner', 'Outer.Kind', 'Outer.Kind.Kind', 'Outer.Marker',
    ]);
    assert.equal(one(out, 'Outer.map').sig, 'Function<T,R>');
    assert.equal(one(out, 'Outer.Visitor.visit').bodyOpen, null);
    assert.equal(one(out, 'Outer.Marker').kind, 'interface');
    assert.ok(text(src, one(out, 'Outer.Marker')).startsWith('@interface'));
  });
});

describe('Kotlin', () => {
  it('ends a single-expression function at its expression', () => {
    const src = 'package a\n\n@JvmStatic\nfun f() = 1\n\nfun g(x: Int): Int {\n    return x\n}\n\nclass Box(val v: Int) {\n    fun get() = v\n    companion object {\n        const val ZERO = 0\n    }\n}\n\nfun String.shout(): String = uppercase()\nval top = listOf(1, 2)\n';
    const out = outline(src, 'kotlin');
    assert.equal(out.error, null);
    assert.equal(text(src, one(out, 'f')), '@JvmStatic\nfun f() = 1');
    assert.equal(text(src, one(out, 'g')), 'fun g(x: Int): Int {\n    return x\n}');
    assert.equal(one(out, 'g').sig, 'Int');
    assert.equal(text(src, one(out, 'Box.get')), 'fun get() = v');
    assert.equal(one(out, 'Box.Companion.ZERO').kind, 'variable');
    assert.equal(text(src, one(out, 'String.shout')), 'fun String.shout(): String = uppercase()');
    assert.deepEqual([one(out, 'top').kind, one(out, 'top').topLevel], ['variable', true]);
  });

  it('inserts a terminator at a newline that ends a statement (best effort)', () => {
    const a = outline('fun f(): Int {\n    return\n    g()\n}\n', 'kotlin');
    const b = outline('fun f(): Int {\n    return g()\n}\n', 'kotlin');
    assert.notEqual(symFloor(a, 'f'), symFloor(b, 'f'));
    const c = outline('fun f(): Int {\n    return listOf(1)\n        .map { it }\n        .size\n}\n', 'kotlin');
    const d = outline('fun f(): Int {\n  return listOf(1).map { it }.size\n}\n', 'kotlin');
    assert.equal(symFloor(c, 'f'), symFloor(d, 'f'));
  });
});

describe('Swift', () => {
  it('reads implicit-return functions, types, extensions and properties', () => {
    const src = 'import Foundation\n\n@MainActor\nfunc f() -> Int { 1 }\n\nstruct Point: Equatable {\n    var x: Int\n    var norm: Double { Double(x) }\n    init(x: Int) { self.x = x }\n    static func == (a: Point, b: Point) -> Bool { a.x == b.x }\n}\n\nextension Point {\n    func moved(by dx: Int) -> Point { Point(x: x + dx) }\n}\n\nlet origin = Point(x: 0)\n';
    const out = outline(src, 'swift');
    assert.equal(out.error, null);
    assert.equal(text(src, one(out, 'f')), '@MainActor\nfunc f() -> Int { 1 }');
    assert.deepEqual(bySym(out, 'Point').map(s => s.kind), ['struct', 'impl']);
    assert.equal(one(out, 'Point.x').kind, 'variable');
    assert.equal(text(src, one(out, 'Point.norm')), 'var norm: Double { Double(x) }');
    assert.equal(one(out, 'Point.init').sig, 'x:Int');
    assert.equal(one(out, 'Point.==').kind, 'method');
    assert.equal(one(out, 'Point.moved').sig, 'by:Int');
    assert.equal(one(out, 'origin').kind, 'variable');
  });
});

describe('signatures without bodies (Kotlin interfaces, Swift protocols)', () => {
  it('end each requirement at its own line, after a generic, async or throws', () => {
    const swift = 'protocol Socket {\n    func receive() async throws -> AsyncStream<Request>\n    func send(value: Response) async throws\n    func shutdown() async\n    var isOpen: Bool { get }\n}\n';
    let out = outline(swift, 'swift');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.startLine, s.endLine]), [
      ['Socket', 1, 6], ['Socket.receive', 2, 2], ['Socket.send', 3, 3], ['Socket.shutdown', 4, 4], ['Socket.isOpen', 5, 5],
    ]);
    const kotlin = 'interface Repo {\n    fun all(): List<Map<String, Int>>\n    suspend fun one(id: Int): Item?\n    val size: Int\n}\n';
    out = outline(kotlin, 'kotlin');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.startLine, s.endLine]), [['Repo', 1, 5], ['Repo.all', 2, 2], ['Repo.one', 3, 3], ['Repo.size', 4, 4]]);
  });

  it('a comparison at the end of a line still continues it', () => {
    const a = outline('fun f(a: Int, b: Int): Boolean {\n    return a >\n        b\n}\n', 'kotlin');
    const b = outline('fun f(a: Int, b: Int): Boolean {\n    return a > b\n}\n', 'kotlin');
    assert.equal(symFloor(a, 'f'), symFloor(b, 'f'));
  });
});

describe('C#', () => {
  it('reads expression-bodied members, properties, records and file-scoped namespaces', () => {
    const src = 'using System;\n\nnamespace Acme.Billing;\n\n[Serializable]\npublic class Invoice\n{\n    public int Total { get; set; } = 0;\n    public string Name => "x";\n    int F() => 1;\n    [HttpGet("{id}")]\n    public async Task<int> Get(int id) { return id; }\n    public int Get(string key) { return 0; }\n    public Invoice(int t) : base() { Total = t; }\n    void Generic<T>(T x) where T : new() { }\n}\n\npublic record Line(string Sku, int Qty);\n';
    const out = outline(src, 'csharp');
    assert.equal(out.error, null);
    const cls = one(out, 'Acme.Billing.Invoice');
    assert.ok(text(src, cls).startsWith('[Serializable]\npublic class Invoice'));
    assert.equal(text(src, one(out, 'Acme.Billing.Invoice.F')), 'int F() => 1;');
    assert.equal(text(src, one(out, 'Acme.Billing.Invoice.Total')), 'public int Total { get; set; } = 0;');
    assert.equal(one(out, 'Acme.Billing.Invoice.Name').kind, 'variable');
    const gets = bySym(out, 'Acme.Billing.Invoice.Get');
    assert.deepEqual(gets.map(s => s.sig), ['int', 'string']);
    assert.ok(text(src, gets[0]).startsWith('[HttpGet("{id}")]'));
    assert.equal(one(out, 'Acme.Billing.Invoice.Invoice').kind, 'method');
    assert.equal(one(out, 'Acme.Billing.Invoice.Generic').sig, 'T');
    assert.equal(text(src, one(out, 'Acme.Billing.Line')), 'public record Line(string Sku, int Qty);');
  });

  it('a #region line with an apostrophe is a directive, not a character literal', () => {
    const lx = lex("class A {\n#region Customer's data\n  int x;\n#endregion\n}\n", 'csharp');
    assert.equal(lx.error, null);
    assert.ok(lx.tokens.some(t => t.pp && t.v === "#region Customer's data"));
  });
});

describe('PHP', () => {
  it('reads methods inside classes inside a statement namespace', () => {
    const src = "<?php\n\nnamespace App\\Http;\n\nuse Foo\\Bar;\n\nconst VERSION = '1';\n\n#[Attribute]\nabstract class UserController extends Controller\n{\n    public const LIMIT = 10;\n\n    #[Route('/users/{id}')]\n    public function show(int $id): Response\n    {\n        $f = function ($x) { return $x; };\n        return new Response(\"{$id}\");\n    }\n\n    abstract protected function hook(): void;\n}\n\nfunction helper(array &$xs = []) { return count($xs); }\n";
    const out = outline(src, 'php');
    assert.equal(out.error, null);
    const show = one(out, 'App.Http.UserController.show');
    assert.equal(show.kind, 'method');
    assert.ok(text(src, show).startsWith("#[Route('/users/{id}')]"));
    assert.ok(text(src, show).endsWith('}'));
    assert.equal(show.sig, 'int');
    assert.equal(one(out, 'App.Http.UserController.hook').bodyOpen, null);
    assert.ok(text(src, one(out, 'App.Http.UserController')).startsWith('#[Attribute]'));
    assert.equal(one(out, 'App.Http.VERSION').kind, 'variable');
    assert.equal(one(out, 'App.Http.UserController.LIMIT').kind, 'variable');
    assert.equal(one(out, 'App.Http.helper').sig, 'array&');
  });

  it('reads inline HTML around PHP blocks as one literal, so its braces do not count', () => {
    const src = '<html><script>if (a) { b(); </script>\n<?php function f() { ?>\n<p>{ not code</p>\n<?php } ?>\n';
    const out = outline(src, 'php');
    assert.equal(out.error, null);
    assert.equal(one(out, 'f').endLine, 4);
  });
});

describe('Ruby', () => {
  it('nests def/class/module, ignores modifier if/unless and reads endless defs', () => {
    const src = 'module Billing\n  class Invoice < Base\n    TAX = 0.2\n\n    def total(items)\n      return 0 if items.empty?\n      items.each do |i|\n        puts i unless i.nil?\n      end\n      sum = if items.size > 1 then 2 else 1 end\n      while sum > 3 do sum -= 1 end\n      sum\n    end\n\n    def self.build = new\n\n    class << self\n      def create; end\n    end\n  end\nend\n';
    const out = outline(src, 'ruby');
    assert.equal(out.error, null);
    assert.deepEqual(quals(out), ['Billing', 'Billing.Invoice', 'Billing.Invoice.TAX', 'Billing.Invoice.total', 'Billing.Invoice.build', 'Billing.Invoice.create']);
    const total = one(out, 'Billing.Invoice.total');
    assert.ok(text(src, total).startsWith('def total(items)'));
    assert.ok(text(src, total).endsWith('      sum\n    end'));
    assert.equal(total.kind, 'method');
    assert.equal(text(src, one(out, 'Billing.Invoice.build')), 'def self.build = new');
    assert.equal(one(out, 'Billing').end, src.trimEnd().length);
    assert.equal(one(out, 'Billing.Invoice.TAX').kind, 'variable');
  });

  it('reads operator methods, operator symbols, /= and a modifier on a continued line', () => {
    const src = "class Path\n  def_delegators :path, :to_path, :/,\n                 :join\n  RESTRICT = [:`].freeze\n\n  def /(other)\n    dir = other\n    dir /= other\n    raise ArgumentError, \"bad\" \\\n      unless dir\n    dir\n  end\n\n  def `(cmd) = cmd\nend\n";
    const out = outline(src, 'ruby');
    assert.equal(out.error, null);
    assert.deepEqual(quals(out), ['Path', 'Path.RESTRICT', 'Path./', 'Path.`']);
    assert.ok(text(src, one(out, 'Path./')).endsWith('    dir\n  end'));
    assert.ok(out.lex.tokens.some(t => t.t === 'str' && t.v === ':/'));
  });

  it('reports a missing or extra end instead of guessing spans', () => {
    for (const src of ['def f\n  if x\n    1\nend\n', 'def f\n  1\nend\nend\n']) {
      const out = outline(src, 'ruby');
      assert.equal(typeof out.error, 'string', src);
      assert.deepEqual(out.symbols, []);
    }
  });
});

describe('C and C++ (best effort)', () => {
  it('falls back when #if/#else branches each open a brace', () => {
    const src = '#include <stdio.h>\n\n#if defined(FAST)\nint run(int n) {\n#else\nint run(long n) {\n#endif\n    return 0;\n}\n';
    for (const lang of ['c', 'cpp']) {
      const out = outline(src, lang);
      assert.equal(typeof out.error, 'string', lang);
      assert.match(out.error, /unclosed '\{' at line 4/);
      assert.deepEqual(out.symbols, []);
    }
  });

  it('reads C++ raw strings, namespaces, constructors with initializer lists and qualified definitions', () => {
    const src = 'namespace acme {\nclass Parser : public Base {\npublic:\n    explicit Parser(int n);\n    ~Parser();\n    int parse(const std::string& s) const override;\n};\n\nParser::Parser(int n) : n_(n), cache_{} {}\n\nint Parser::parse(const std::string& s) const {\n    auto re = R"x(// not a comment { ")x";\n    return 0;\n}\n}  // namespace acme\n\nstatic const int kMax = 10;\n';
    const out = outline(src, 'cpp');
    assert.equal(out.error, null);
    assert.deepEqual(out.lex.comments.map(c => c.text), [' namespace acme']);
    assert.deepEqual(quals(out), [
      'acme', 'acme.Parser', 'acme.Parser.Parser', 'acme.Parser.~Parser', 'acme.Parser.parse',
      'acme.Parser.Parser', 'acme.Parser.parse', 'kMax',
    ]);
    const parses = bySym(out, 'acme.Parser.parse');
    assert.deepEqual(parses.map(s => s.bodyOpen === null), [true, false]);
    assert.equal(parses[0].sig, 'const std::string&');
    assert.ok(text(src, parses[1]).includes('R"x(// not a comment { ")x"'));
    assert.equal(text(src, bySym(out, 'acme.Parser.Parser')[1]), 'Parser::Parser(int n) : n_(n), cache_{} {}');
    assert.equal(one(out, 'kMax').kind, 'variable');
  });

  it('keeps a multi-line #define with comments and quote characters as one directive', () => {
    const src = "#define ESCAPE(c) \\\n  switch (c) { /* one */ \\\n  case '\"': \\\n  case '\\'': \\\n    break; \\\n  }\n\nint after(void) { return 0; }\n";
    const out = outline(src, 'c');
    assert.equal(out.error, null);
    assert.deepEqual(out.lex.comments.map(c => c.text), [' one']);
    const pp = out.lex.tokens.filter(t => t.pp);
    assert.equal(pp.length, 1);
    assert.ok(!pp[0].v.includes('one'));
    assert.deepEqual(quals(out), ['after']);
  });

  it('names a call operator operator() and reads its own parameters', () => {
    const src = 'struct F {\n  bool operator()(int a, int b) const { return a < b; }\n  F& operator=(const F& o) = default;\n};\n';
    const out = outline(src, 'cpp');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.sig]), [['F', null], ['F.operator()', 'int, int'], ['F.operator=', 'const F&']]);
  });

  it('reads C functions, structs, typedefs, prototypes and globals', () => {
    const src = '#include "x.h"\n\ntypedef struct {\n    int a;\n} Pair;\n\nstruct node {\n    struct node *next;\n};\n\nstatic int counter = 0;\n\nint add(int a, int b) {\n    return a + b;\n}\n\nvoid noop(void);\n';
    const out = outline(src, 'c');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.kind]), [['Pair', 'struct'], ['node', 'struct'], ['counter', 'variable'], ['add', 'function'], ['noop', 'function']]);
    assert.equal(one(out, 'add').sig, 'int, int');
    assert.equal(one(out, 'noop').bodyOpen, null);
    assert.equal(text(src, one(out, 'Pair')), 'typedef struct {\n    int a;\n} Pair;');
  });
});

describe('Python and JS outlines (best-effort fallbacks)', () => {
  it('python: indentation, decorators, nesting, class attributes and one-line bodies', () => {
    const src = 'import os\n\nRATE = 0.2\n\n@dataclass\nclass Invoice:\n    total: int = 0\n\n    @property\n    def net(self) -> float:\n        return self.total * (1 - RATE)\n\n    def add(self, n: int):\n        def inner():\n            pass\n        return inner\n\ndef apply(x): return x\n';
    const out = outline(src, 'python');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.kind]), [
      ['RATE', 'variable'], ['Invoice', 'class'], ['Invoice.total', 'variable'], ['Invoice.net', 'method'],
      ['Invoice.add', 'method'], ['Invoice.add.inner', 'function'], ['apply', 'function'],
    ]);
    assert.ok(text(src, one(out, 'Invoice.net')).startsWith('@property\n    def net'));
    assert.ok(text(src, one(out, 'Invoice')).startsWith('@dataclass\nclass Invoice:'));
    assert.ok(text(src, one(out, 'Invoice')).endsWith('return inner'));
    assert.equal(text(src, one(out, 'apply')), 'def apply(x): return x');
    assert.equal(one(out, 'Invoice.add').sig, 'self, int');
  });

  it('js: functions, classes, members and top-level variables', () => {
    const src = "import x from 'y';\nexport const LIMITS = { max: 3 };\nexport function applyDiscount(cart, pct) {\n  return cart.total * pct;\n}\nexport class Cart {\n  items = [];\n  get total() { return 1; }\n  static of(xs) { return new Cart(xs); }\n}\nconst arrow = (a) => a * 2\nlet plain = 1\n";
    const out = outline(src, 'js');
    assert.equal(out.error, null);
    assert.deepEqual(out.symbols.map(s => [s.qual, s.kind]), [
      ['LIMITS', 'variable'], ['applyDiscount', 'function'], ['Cart', 'class'], ['Cart.items', 'variable'],
      ['Cart.total', 'method'], ['Cart.of', 'method'], ['arrow', 'function'], ['plain', 'variable'],
    ]);
    assert.equal(text(src, one(out, 'LIMITS')), 'export const LIMITS = { max: 3 };');
    assert.equal(text(src, one(out, 'arrow')), 'const arrow = (a) => a * 2');
  });

  it('ts: a return type with object literals does not open the body early', () => {
    const src = 'export async function sync(n: number): Promise<{ changed: number; ids: string[] }> {\n  return { changed: n, ids: [] };\n}\nfunction pick(): { a: 1 } | null {\n  return null;\n}\n';
    const out = outline(src, 'ts');
    assert.equal(out.error, null);
    assert.ok(text(src, one(out, 'sync')).endsWith('ids: [] };\n}'));
    assert.equal(one(out, 'sync').bodyOpen, src.indexOf('{\n  return { changed'));
    assert.ok(text(src, one(out, 'pick')).endsWith('return null;\n}'));
  });
});

describe('FR-008: delimiters that do not balance', () => {
  const broken = {
    go: 'package p\nfunc F() {\n\tif x {\n}\n',
    rust: 'fn f() { let x = (1;\n}\n',
    java: 'class A { void f() { }\n',
    kotlin: 'fun f() {\n',
    csharp: 'class A { void F() { } } }\n',
    php: '<?php function f() { if (1) { }\n',
    ruby: 'def f(\n  1\nend\n',
    swift: 'func f() -> Int { [1, 2 }\n',
    c: 'int f() { return (1; }\n',
    cpp: 'int f() { return 1; }}\n',
    js: 'function f() { return [1, 2; }\n',
    ts: 'class A { m() { }\n',
    python: 'def f(x:\n    return x\n',
  };
  for (const [lang, src] of Object.entries(broken)) {
    it(`${lang}: reports the imbalance and yields no symbols`, () => {
      let out;
      assert.doesNotThrow(() => { out = outline(src, lang); });
      assert.equal(typeof out.error, 'string');
      assert.match(out.error, /line \d+/);
      assert.deepEqual(out.symbols, []);
      assert.equal(typeof lex(src, lang).error, 'string');
    });
  }

  it('reports an unterminated string, raw string, heredoc or block comment', () => {
    const cases = [
      ['go', 'package p\nvar s = "open\n'], ['go', 'package p\nvar s = `open\n'], ['rust', 'const S: &str = r#"open";\n'],
      ['java', 'class A { /* open\n}\n'], ['ruby', 'x = <<~EOS\n  body\n'], ['php', "<?php $x = <<<EOT\nbody\n"],
      ['python', 'x = """open\n'], ['cpp', 'auto s = R"x(open)y";\n'], ['csharp', 'class A { string s = @"open; }\n'],
    ];
    for (const [lang, src] of cases) assert.equal(typeof lex(src, lang).error, 'string', `${lang}: ${src}`);
  });

  it('never throws, whatever the input', () => {
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const alphabet = '{}[]()"\'`/\\*#@$%<>=;:,.!?\n\t abcdefXYZ019_\r\u00e9\ud83d\ude00';
    const langs = ['js', 'ts', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'php', 'ruby', 'swift', 'c', 'cpp', 'yaml', null];
    for (let round = 0; round < 300; round++) {
      let src = '';
      const len = rand() % 200;
      for (let k = 0; k < len; k++) src += alphabet[rand() % alphabet.length];
      const lang = langs[round % langs.length];
      assert.doesNotThrow(() => {
        const out = outline(src, lang);
        floorFingerprint(out.lex, 0, src.length);
        statementSpan(out.lex, rand() % (src.length + 1));
      }, `${lang}: ${JSON.stringify(src)}`);
    }
  });
});

describe('floor fingerprint', () => {
  const fnFloor = (src, lang = 'js', qual = 'f') => symFloor(outline(src, lang), qual);

  it('has the dg1 form and hashes the tokens joined by NUL', () => {
    const lx = lex('fn f() {}', 'rust');
    const fp = floorFingerprint(lx, 0, 9);
    assert.match(fp, /^dg1:sha256:[0-9a-f]{64}$/);
    assert.deepEqual(floorTokens(lx, 0, 9), ['fn', 'f', '(', ')', '{', '}']);
    assert.equal(floorTokens(null, 0, 1).length, 0);
  });

  it('keeps directive comments and drops ordinary ones', () => {
    const base = 'function f(x) {\n  return x.y;\n}\n';
    const note = 'function f(x) {\n  // just a note\n  return x.y;\n}\n';
    const directive = 'function f(x) {\n  // @ts-ignore\n  return x.y;\n}\n';
    assert.equal(fnFloor(base), fnFloor(note));
    assert.notEqual(fnFloor(base), fnFloor(directive));
    const out = outline(directive, 'js');
    const s = one(out, 'f');
    assert.ok(floorTokens(out.lex, s.start, s.end).includes('\u0001directive:@ts-ignore'));
    const py = 'def f():\n    x = g(){C}\n    return x\n';
    assert.notEqual(fnFloor(py.replace('{C}', ''), 'python'), fnFloor(py.replace('{C}', '  # type: ignore'), 'python'));
    assert.equal(fnFloor(py.replace('{C}', ''), 'python'), fnFloor(py.replace('{C}', '  # why'), 'python'));
  });

  it('recognises every allowlisted directive and nothing else', () => {
    const yes = ['@ts-ignore', ' @ts-expect-error: reason', '@ts-nocheck', ' eslint-disable-next-line no-x', 'eslint-disable', 'go:build linux',
      ' +build linux', 'go:generate stringer', '#__PURE__', '@__PURE__', ' type: ignore[attr]', ' noqa: E501', ' noqa', ' pragma: no cover'];
    const no = [' just a note', ' @implements x#FR-001', ' noqaz', ' typed: ignore', 'eslint-enable', ' TODO type: ignore'];
    for (const body of yes) assert.ok(DIRECTIVE_RE.test(body), body);
    for (const body of no) assert.ok(!DIRECTIVE_RE.test(body), body);
  });

  it('is stable across CRLF line endings', () => {
    const lf = 'fn f() -> &\'static str {\n    "a\nb"\n}\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.equal(fnFloor(lf, 'rust'), fnFloor(crlf, 'rust'));
    const py = 'def f():\n    if x:\n        return 1\n    return 2\n';
    assert.equal(fnFloor(py, 'python'), fnFloor(py.replace(/\n/g, '\r\n'), 'python'));
  });

  it('python: re-indenting keeps the floor, a dedent that moves a statement changes it', () => {
    const a = 'def f():\n    if x:\n        a()\n        b()\n';
    const wider = 'def f():\n        if x:\n                a()\n                b()\n';
    const moved = 'def f():\n    if x:\n        a()\n    b()\n';
    assert.equal(fnFloor(a, 'python'), fnFloor(wider, 'python'));
    assert.notEqual(fnFloor(a, 'python'), fnFloor(moved, 'python'));
  });
});

describe('statementSpan', () => {
  const after = (src, marker) => src.indexOf(marker) + marker.length;

  it('go: the statement after a comment, through its multi-line call', () => {
    const src = 'package p\n\nfunc f() {\n\t// tag\n\tx := compute(\n\t\t1,\n\t)\n\treturn x\n}\n';
    const span = statementSpan(lex(src, 'go'), after(src, '// tag'));
    assert.equal(src.slice(span.s, span.e), 'x := compute(\n\t\t1,\n\t)');
  });

  it('js: an if/else chain is one statement', () => {
    const src = 'function f() {\n  // tag\n  if (a) {\n    b();\n  } else {\n    c();\n  }\n  d();\n}\n';
    const span = statementSpan(lex(src, 'js'), after(src, '// tag'));
    assert.equal(src.slice(span.s, span.e), 'if (a) {\n    b();\n  } else {\n    c();\n  }');
  });

  it('rust and java: a block statement ends at its brace, an initializer at its semicolon', () => {
    const rs = 'fn f() {\n    // tag\n    let v = Foo {\n        a: 1,\n    };\n    match v { _ => {} }\n}\n';
    let span = statementSpan(lex(rs, 'rust'), after(rs, '// tag'));
    assert.equal(rs.slice(span.s, span.e), 'let v = Foo {\n        a: 1,\n    };');
    span = statementSpan(lex(rs, 'rust'), rs.indexOf('match'));
    assert.equal(rs.slice(span.s, span.e), 'match v { _ => {} }');
    const java = 'class A {\n  void f() {\n    // tag\n    for (int i = 0; i < 3; i++) {\n      g(i);\n    }\n    h();\n  }\n}\n';
    span = statementSpan(lex(java, 'java'), after(java, '// tag'));
    assert.equal(java.slice(span.s, span.e), 'for (int i = 0; i < 3; i++) {\n      g(i);\n    }');
  });

  it('python: a compound statement runs through its else clause', () => {
    const src = 'def f():\n    # tag\n    for x in y:\n        g(x)\n    else:\n        h()\n    return 1\n';
    const span = statementSpan(lex(src, 'python'), after(src, '# tag'));
    assert.equal(src.slice(span.s, span.e), 'for x in y:\n        g(x)\n    else:\n        h()');
  });

  it('ruby: a do-block call runs to its end', () => {
    const src = 'def f\n  # tag\n  items.each do |i|\n    puts i\n  end\n  done\nend\n';
    const span = statementSpan(lex(src, 'ruby'), after(src, '# tag'));
    assert.equal(src.slice(span.s, span.e), 'items.each do |i|\n    puts i\n  end');
  });

  it('returns null at a closing brace or past the last token', () => {
    const src = 'fn f() {\n    g();\n    // trailing\n}\n';
    const lx = lex(src, 'rust');
    assert.equal(statementSpan(lx, after(src, '// trailing')), null);
    assert.equal(statementSpan(lx, src.length), null);
  });
});

describe('symbol shape', () => {
  it('carries every documented field', () => {
    const src = 'package p\n\n// doc\nfunc (s *Server) Run(ctx context.Context) error {\n\treturn nil\n}\n';
    const out = outline(src, 'go');
    const run = one(out, 'Server.Run');
    assert.deepEqual(Object.keys(run).sort(), ['bodyOpen', 'end', 'endLine', 'kind', 'name', 'nameLine', 'parent', 'qual', 'sig', 'start', 'startLine', 'topLevel'].sort());
    assert.deepEqual(
      { name: run.name, start: run.start, startLine: run.startLine, nameLine: run.nameLine, endLine: run.endLine, parent: run.parent, topLevel: run.topLevel, sig: run.sig },
      { name: 'Run', start: src.indexOf('func'), startLine: 4, nameLine: 4, endLine: 6, parent: null, topLevel: true, sig: 'context.Context' },
    );
    assert.equal(run.bodyOpen, src.indexOf('{\n\treturn'));
    assert.equal(run.end, src.lastIndexOf('}') + 1);
  });
});

describe('performance', () => {
  it('lexes and outlines a 5,000-line Go file in under 500 ms', () => {
    const lines = ['package big', ''];
    for (let k = 0; lines.length < 5000; k++) {
      lines.push(`// F${k} does work.`, `func (s *Server) F${k}(x int, y string) (int, error) {`, `\tif x > ${k} {`,
        `\t\treturn x, fmt.Errorf("bad %s // not a comment {", y)`, '\t}', '\treturn x * 2, nil', '}', '');
    }
    const src = lines.join('\n');
    const t0 = performance.now();
    const out = outline(src, 'go');
    for (const s of out.symbols) floorFingerprint(out.lex, s.start, s.end);
    const ms = performance.now() - t0;
    assert.equal(out.error, null);
    assert.ok(out.symbols.length >= 600);
    assert.equal(out.lex.comments.length, out.symbols.length);
    assert.ok(ms < 500, `took ${ms.toFixed(1)} ms`);
  });
});
