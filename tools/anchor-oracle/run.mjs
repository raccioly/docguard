#!/usr/bin/env node
/**
 * Anchor oracle: on how many declarations does DocGuard's pattern tier agree
 * with tree-sitter about where the declaration is and where it ends?
 *
 * Spec: specs/070-requirement-anchors (FR-040, SC-007).
 *
 *   npm ci --ignore-scripts --prefix tools/anchor-oracle
 *   node tools/anchor-oracle/run.mjs [--json <report.json>] [--files <dir>...]
 *
 * CI-only, never shipped. web-tree-sitter and the grammar `.wasm` files come
 * from this directory's node_modules, installed from a lockfile with integrity
 * hashes and no install scripts (VETTING.md records why each package passes
 * Constitution II). The corpus is `corpus/` plus the anchor fixtures under
 * tests/fixtures/anchors.
 *
 * A declaration AGREES when the pattern outline has a symbol with the same
 * name on the same line whose span ends on the same line. Otherwise it is a
 * span mismatch (same name and line, different end), missed (tree-sitter
 * only) or spurious (pattern only). A file tree-sitter cannot parse cleanly
 * is skipped: there is no truth to compare with. A file the pattern lexer
 * refuses (its self-check) counts every declaration as missed, because its
 * anchors fall back to file scope.
 *
 * The run fails (exit 1) only when a high-confidence language disagrees on
 * more than 1% of declarations. Low-confidence languages (C, C++) and
 * languages without a vetted grammar (Kotlin, Swift) are reported only.
 *
 * @implements docguard.requirement-anchors#FR-040
 */

import { readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser, Language } from 'web-tree-sitter';
import { languageOf, lex, outline } from '../../cli/scanners/pattern-lexer.mjs';
import { TS_LANGUAGES, declarations } from '../../cli/scanners/ts-decls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const THRESHOLD = 0.01;

/** The pattern kinds an anchor can name at symbol scope. */
const COMPARED_KINDS = new Set(['function', 'method', 'class', 'struct', 'enum', 'interface', 'trait', 'impl', 'module', 'type']);

/** Every pattern-tier language: those with a vetted grammar share the tier's declaration rules. */
const LANGUAGES = {
  ...Object.fromEntries(Object.entries(TS_LANGUAGES).map(([lang, spec]) => [lang, { grammar: `${spec.package}/${spec.file}`, confidence: spec.confidence }])),
  kotlin: { grammar: null, confidence: 'medium', reason: 'no vetted grammar: tree-sitter-kotlin has one maintainer (Constitution II)' },
  swift: { grammar: null, confidence: 'medium', reason: 'no vetted grammar: tree-sitter-swift has one maintainer (Constitution II)' },
};

function args(argv) {
  const out = { json: null, dirs: [join(HERE, 'corpus'), join(ROOT, 'tests/fixtures/anchors')] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = resolve(argv[++i]);
    else if (argv[i] === '--files') { out.dirs = []; while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.dirs.push(resolve(argv[++i])); }
  }
  return out;
}

function corpus(dirs) {
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (LANGUAGES[languageOf(path)]) files.push(path);
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

/** Tree-sitter's declarations: name, the line the name is on, the last line. */
const treeSitterDecls = (tree, lang) => declarations(tree, lang).map(d => ({ name: d.name, line: d.nameLine, end: d.endLine, type: d.type, local: d.local }));

function patternDecls(content, lang) {
  return outline(content, lang).symbols
    .filter(sym => COMPARED_KINDS.has(sym.kind))
    .map(sym => ({ name: String(sym.name).replace(/!$/, ''), line: sym.nameLine, end: sym.endLine, kind: sym.kind }));
}

function compare(ts, pattern) {
  const key = d => `${d.name}@${d.line}`;
  const fromPattern = new Map();
  for (const d of pattern) if (!fromPattern.has(key(d))) fromPattern.set(key(d), d);
  const seen = new Set();
  const result = { agree: 0, span: [], missed: [], spurious: [] };
  for (const d of ts) {
    const p = fromPattern.get(key(d));
    if (!p) { result.missed.push(d); continue; }
    seen.add(key(d));
    if (p.end === d.end) result.agree++;
    else result.span.push({ ...d, patternEnd: p.end });
  }
  // A pattern symbol tree-sitter has no declaration for, on a line where tree-sitter has none of that name.
  const tsKeys = new Set(ts.map(key));
  for (const p of pattern) if (!seen.has(key(p)) && !tsKeys.has(key(p))) result.spurious.push(p);
  return result;
}

async function main() {
  const opts = args(process.argv.slice(2));
  await Parser.init();
  const report = { schemaVersion: 1, threshold: THRESHOLD, languages: {}, failed: [] };
  const files = corpus(opts.dirs);
  for (const [lang, spec] of Object.entries(LANGUAGES)) {
    const langFiles = files.filter(f => languageOf(f) === lang);
    const entry = { confidence: spec.confidence, files: langFiles.length, declarations: 0, agree: 0, span: 0, missed: 0, spurious: 0, skipped: [], selfCheck: [], details: [] };
    report.languages[lang] = entry;
    if (!spec.grammar) { entry.oracle = false; entry.reason = spec.reason; continue; }
    entry.oracle = true;
    const language = await Language.load(join(HERE, 'node_modules', spec.grammar));
    const parser = new Parser();
    parser.setLanguage(language);
    for (const file of langFiles) {
      const rel = relative(ROOT, file);
      const content = readFileSync(file, 'utf8');
      const tree = parser.parse(content);
      if (tree.rootNode.hasError) { entry.skipped.push(rel); continue; }
      const all = treeSitterDecls(tree, lang);
      // Local declarations are statements to an anchor: neither side is held to them.
      const localKeys = new Set(all.filter(d => d.local).map(d => `${d.name}@${d.line}`));
      const ts = all.filter(d => !d.local);
      entry.declarations += ts.length;
      if (lex(content, lang).error) {
        entry.selfCheck.push(rel);
        entry.missed += ts.length;
        continue;
      }
      const r = compare(ts, patternDecls(content, lang).filter(d => !localKeys.has(`${d.name}@${d.line}`)));
      entry.agree += r.agree;
      entry.span += r.span.length;
      entry.missed += r.missed.length;
      entry.spurious += r.spurious.length;
      for (const d of r.span) entry.details.push({ file: rel, kind: 'span', name: d.name, line: d.line, treeSitterEnd: d.end, patternEnd: d.patternEnd, node: d.type });
      for (const d of r.missed) entry.details.push({ file: rel, kind: 'missed', name: d.name, line: d.line, node: d.type });
      for (const d of r.spurious) entry.details.push({ file: rel, kind: 'spurious', name: d.name, line: d.line, patternKind: d.kind });
    }
    const compared = entry.agree + entry.span + entry.missed + entry.spurious;
    entry.disagreement = compared ? Number(((entry.span + entry.missed + entry.spurious) / compared).toFixed(4)) : 0;
    entry.pass = spec.confidence !== 'high' || entry.disagreement <= THRESHOLD;
    if (!entry.pass) report.failed.push(lang);
  }
  const lines = ['| Language | Confidence | Files | Declarations | Agree | Span | Missed | Spurious | Disagreement | Result |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---|'];
  for (const [lang, e] of Object.entries(report.languages)) {
    lines.push(e.oracle
      ? `| ${lang} | ${e.confidence} | ${e.files} | ${e.declarations} | ${e.agree} | ${e.span} | ${e.missed} | ${e.spurious} | ${(e.disagreement * 100).toFixed(2)}% | ${e.confidence === 'high' ? (e.pass ? 'pass' : 'FAIL') : 'reported'} |`
      : `| ${lang} | ${e.confidence} | ${e.files} | — | — | — | — | — | — | ${e.reason} |`);
  }
  const table = lines.join('\n');
  console.log(table);
  for (const [lang, e] of Object.entries(report.languages)) {
    for (const d of e.details.slice(0, 20)) console.log(`  ${lang} ${d.kind} ${d.file}:${d.line} ${d.name}${d.kind === 'span' ? ` (tree-sitter ends ${d.treeSitterEnd}, pattern ${d.patternEnd})` : ''}`);
    for (const f of e.skipped) console.log(`  ${lang} skipped ${f} (tree-sitter reports a syntax error)`);
    for (const f of e.selfCheck) console.log(`  ${lang} self-check ${f} (the pattern lexer refused the file)`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Anchor oracle\n\n${table}\n`);
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(report, null, 2)}\n`);
  if (report.failed.length) {
    console.error(`Disagreement above ${THRESHOLD * 100}% for high-confidence language(s): ${report.failed.join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
