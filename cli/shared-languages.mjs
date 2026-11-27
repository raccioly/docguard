/**
 * Source languages that one entry describes for every scanner (specs/106-field-report-fixes).
 *
 * Each scanner used to keep its own list of extensions, so a language was read by
 * one check and not by the next: Salesforce Apex was read by none of the secret
 * scan, test detection, traceability and the phantom-completion check. A language
 * is now one entry, and each consumer asks the entry. This module is a leaf: it
 * imports nothing, so any module can use it (Constitution IV).
 *
 * The Apex extension set and the id `apex` match the websec-validator change for
 * the same field report, so the two tools name the same files the same way.
 *
 * @implements docguard.field-report-fixes#FR-003
 * @implements docguard.language-registry#FR-001
 * @implements docguard.language-registry#FR-002
 * @implements docguard.language-registry#FR-003
 */

/**
 * Every source language DocGuard recognizes, once (specs/107-language-registry).
 *   - `kind`: `code` (a programming language), `script` (shell) or `markup` (Visualforce).
 *   - `ast`: DocGuard parses it with a syntax tree (JS/TS with @babel/parser, Python with `ast`);
 *     every other language is read by pattern, and `LANGUAGE_NAMES` names it in coverage gaps.
 *   - `comments`: `slash` (`//`, `/* *\/`), `hash` (`#`) or both; null when DocGuard has no rule.
 *   - `lexer`: the pattern-tier lexer (cli/scanners/pattern-lexer.mjs) that reads it, or null.
 * A scanner that asks "is this file code?" uses `CODE_EXTENSIONS` or `codePathPattern`, so a language
 * added here reaches every such scanner. A scanner tied to one parser (Spring routes, JPA, env reads)
 * keeps its own list, keyed to what that parser reads (tests/language-registry.test.mjs lists them).
 */
export const LANGUAGES = Object.freeze([
  { id: 'javascript', name: 'JavaScript', kind: 'code', ast: true, comments: 'slash', lexer: 'js', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  { id: 'typescript', name: 'TypeScript', kind: 'code', ast: true, comments: 'slash', lexer: 'ts', extensions: ['.ts', '.tsx', '.mts', '.cts'] },
  { id: 'python', name: 'Python', kind: 'code', ast: true, comments: 'hash', lexer: 'python', extensions: ['.py', '.pyi'] },
  { id: 'go', name: 'Go', kind: 'code', comments: 'slash', lexer: 'go', extensions: ['.go'] },
  { id: 'java', name: 'Java', kind: 'code', comments: 'slash', lexer: 'java', extensions: ['.java'] },
  { id: 'kotlin', name: 'Kotlin', kind: 'code', comments: 'slash', lexer: 'kotlin', extensions: ['.kt', '.kts'] },
  { id: 'ruby', name: 'Ruby', kind: 'code', comments: 'hash', lexer: 'ruby', extensions: ['.rb', '.rake', '.gemspec'] },
  { id: 'rust', name: 'Rust', kind: 'code', comments: 'slash', lexer: 'rust', extensions: ['.rs'] },
  { id: 'php', name: 'PHP', kind: 'code', comments: 'both', lexer: 'php', extensions: ['.php'] },
  { id: 'csharp', name: 'C#', kind: 'code', comments: 'slash', lexer: 'csharp', extensions: ['.cs'] },
  { id: 'swift', name: 'Swift', kind: 'code', comments: 'slash', lexer: 'swift', extensions: ['.swift'] },
  { id: 'scala', name: 'Scala', kind: 'code', comments: 'slash', lexer: null, extensions: ['.scala'] },
  { id: 'elixir', name: 'Elixir', kind: 'code', comments: 'hash', lexer: null, extensions: ['.ex', '.exs'] },
  { id: 'dart', name: 'Dart', kind: 'code', comments: 'slash', lexer: null, extensions: ['.dart'] },
  { id: 'c', name: 'C', kind: 'code', comments: 'slash', lexer: 'c', extensions: ['.c', '.h'] },
  { id: 'cpp', name: 'C++', kind: 'code', comments: 'slash', lexer: 'cpp', extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.c++', '.ipp', '.inl'] },
  { id: 'objective-c', name: 'Objective-C', kind: 'code', comments: 'slash', lexer: null, extensions: ['.m', '.mm'] },
  { id: 'lua', name: 'Lua', kind: 'code', comments: null, lexer: null, extensions: ['.lua'] },
  { id: 'clojure', name: 'Clojure', kind: 'code', comments: null, lexer: null, extensions: ['.clj'] },
  { id: 'haskell', name: 'Haskell', kind: 'code', comments: null, lexer: null, extensions: ['.hs'] },
  { id: 'erlang', name: 'Erlang', kind: 'code', comments: null, lexer: null, extensions: ['.erl'] },
  { id: 'ocaml', name: 'OCaml', kind: 'code', comments: null, lexer: null, extensions: ['.ml'] },
  { id: 'fsharp', name: 'F#', kind: 'code', comments: 'slash', lexer: null, extensions: ['.fs'] },
  { id: 'visual-basic', name: 'Visual Basic', kind: 'code', comments: null, lexer: null, extensions: ['.vb'] },
  { id: 'groovy', name: 'Groovy', kind: 'code', comments: 'slash', lexer: null, extensions: ['.groovy'] },
  { id: 'perl', name: 'Perl', kind: 'code', comments: 'hash', lexer: null, extensions: ['.pl'] },
  { id: 'crystal', name: 'Crystal', kind: 'code', comments: 'hash', lexer: null, extensions: ['.cr'] },
  { id: 'nim', name: 'Nim', kind: 'code', comments: 'hash', lexer: null, extensions: ['.nim'] },
  { id: 'zig', name: 'Zig', kind: 'code', comments: 'slash', lexer: null, extensions: ['.zig'] },
  { id: 'julia', name: 'Julia', kind: 'code', comments: 'hash', lexer: null, extensions: ['.jl'] },
  { id: 'apex', name: 'Apex', kind: 'code', comments: 'slash', lexer: 'java', extensions: ['.cls', '.trigger', '.apex'] },
  { id: 'shell', name: 'Shell', kind: 'script', comments: 'hash', lexer: null, extensions: ['.sh', '.bash'] },
  { id: 'visualforce', name: 'Visualforce', kind: 'markup', comments: null, lexer: null, extensions: ['.page', '.component'] },
  // Recognized so they can be disclosed when no check reads them (specs/108-analysis-disclosure).
  { id: 'dataweave', name: 'DataWeave', kind: 'dsl', comments: 'slash', lexer: null, extensions: ['.dwl'] },
  { id: 'yaml-config', name: 'YAML config', kind: 'config', comments: 'hash', lexer: null, extensions: ['.yml', '.yaml'] },
  { id: 'properties', name: 'Properties config', kind: 'config', comments: 'hash', lexer: null, extensions: ['.properties', '.conf'] },
  // Path rules: matched before the extension, so `pom.xml` and other XML stay unclassified.
  { id: 'mule-flow', name: 'Mule flow XML', kind: 'flow', comments: null, lexer: null, extensions: [], match: /(?:^|\/)src\/main\/mule\/.+\.xml$/i },
  { id: 'salesforce-flow', name: 'Salesforce Flow', kind: 'metadata', comments: null, lexer: null, extensions: [], match: /\.flow-meta\.xml$/i },
  { id: 'lwc-template', name: 'LWC template', kind: 'markup', comments: null, lexer: null, extensions: [], match: /(?:^|\/)lwc\/.+\.html$/i },
  { id: 'appsettings', name: 'appsettings JSON', kind: 'config', comments: null, lexer: null, extensions: [], match: /(?:^|\/)appsettings(?:\.[\w-]+)?\.json$/i },
].map(l => Object.freeze({ ast: false, match: null, ...l, extensions: Object.freeze(l.extensions) })));

const byExtension = new Map(LANGUAGES.flatMap(l => l.extensions.map(e => [e, l])));
const byRule = LANGUAGES.filter(l => l.match);

/** The language of a path: a path rule first (Mule flow XML, Salesforce Flow, LWC template), then its extension; or null. */
export function languageFor(path) {
  const p = String(path).replace(/\\/g, '/');
  for (const l of byRule) if (l.match.test(p)) return l;
  return byExtension.get((p.match(/\.[^./]+$/) || [''])[0].toLowerCase()) || null;
}

/** Every programming-language extension (not shell, not markup). */
export const CODE_EXTENSIONS = Object.freeze(new Set(LANGUAGES.filter(l => l.kind === 'code').flatMap(l => l.extensions)));

/** Shell script extensions: a scanner that reads scripts adds these to `CODE_EXTENSIONS`. */
export const SCRIPT_EXTENSIONS = Object.freeze(LANGUAGES.filter(l => l.kind === 'script').flatMap(l => l.extensions));

/** `CODE_EXTENSIONS` plus a scanner's own non-language formats (`.yaml`, `.json`, `.vue`…) as a new Set. */
export function codeExtensions(extra = []) {
  return new Set([...CODE_EXTENSIONS, ...extra]);
}

/** Is this path a programming-language source file? */
export function isCodePath(path) {
  const lang = languageFor(path);
  return Boolean(lang && lang.kind === 'code');
}

const escapeExt = e => e.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A RegExp that matches a path ending in a code extension or one of `extra`. `suffix` is
 * appended after the extension inside the pattern (for example a `:12` line reference).
 */
export function codePathPattern(extra = [], { flags = 'i', suffix = '' } = {}) {
  return new RegExp(`\\.(?:${codeExtensionAlternation(extra)})${suffix}$`, flags);
}

/** The extensions as a RegExp alternation without dots (`js|mjs|…`), longest first, for scanners that embed it. */
export function codeExtensionAlternation(extra = []) {
  return [...codeExtensions(extra)].sort((a, b) => b.length - a.length).map(escapeExt).join('|');
}

/** Extensions a pattern-tier lexer reads, mapped to that lexer (no leading dot). */
export const LEXER_BY_EXTENSION = Object.freeze(Object.fromEntries(
  LANGUAGES.filter(l => l.lexer).flatMap(l => l.extensions.map(e => [e.slice(1), l.lexer])),
));

/** Extensions whose language uses `//` comments, and those that use `#`. */
export const SLASH_COMMENT_EXTENSIONS = Object.freeze(new Set(LANGUAGES.filter(l => l.comments === 'slash' || l.comments === 'both').flatMap(l => l.extensions)));
export const HASH_COMMENT_EXTENSIONS = Object.freeze(new Set(LANGUAGES.filter(l => l.comments === 'hash' || l.comments === 'both').flatMap(l => l.extensions)));

/** Display names of the languages read by pattern (no syntax tree), by extension, for naming coverage gaps. */
export const LANGUAGE_NAMES = Object.freeze(Object.fromEntries(
  LANGUAGES.filter(l => !l.ast && (l.kind === 'code' || l.kind === 'markup')).flatMap(l => l.extensions.map(e => [e, l.name])),
));

/** Salesforce Apex: classes, triggers and anonymous scripts. Java-like syntax, single-quoted strings. */
export const APEX = Object.freeze({ ...LANGUAGES.find(l => l.id === 'apex'), manifest: 'sfdx-project.json' });

/** Visualforce markup: pages and components. Scanned for secrets only. */
export const VISUALFORCE = LANGUAGES.find(l => l.id === 'visualforce');

export const APEX_EXTENSIONS = APEX.extensions;

const extOf = path => (String(path).match(/\.[^./\\]+$/) || [''])[0].toLowerCase();
const baseOf = path => String(path).replace(/\\/g, '/').split('/').pop();

/** Is this path an Apex source file, by extension? */
export function isApexPath(path) {
  return APEX.extensions.includes(extOf(path));
}

/**
 * An Apex test class by name: `OrderTotalTest.cls`, `OrderTotalTests.cls`,
 * `OrderTotal_Test.cls` or `Test_OrderTotal.cls`. A `.cls` named otherwise is a
 * test only when it declares `@isTest` (`declaresApexTest`).
 */
export const APEX_TEST_NAME = /(?:^|\/)(?:[^/]*(?:Test|Tests|_Test)|Test_[^/]+)\.cls$/;

export function isApexTestName(path) {
  return APEX_TEST_NAME.test(String(path).replace(/\\/g, '/'));
}

/** Does Apex source declare a test class or method (`@isTest`, any case)? */
export function declaresApexTest(content) {
  return /@isTest\b/i.test(String(content || ''));
}

/**
 * Salesforce metadata files are `<ApiName>.<type>-meta.xml` (`Widget__c.object-meta.xml`,
 * `Weight__c.field-meta.xml`, `WidgetService.cls-meta.xml`). The deliverable a task names is
 * the API name. Returns it, or null for any other file name.
 */
export function metadataApiName(fileName) {
  const m = /^(.+?)\.[A-Za-z][\w]*-meta\.xml$/.exec(baseOf(fileName));
  return m ? m[1] : null;
}

/** Is this a Salesforce metadata file (`*.<type>-meta.xml`)? */
export function isSalesforceMetadata(path) {
  return metadataApiName(path) !== null;
}
