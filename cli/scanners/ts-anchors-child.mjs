/**
 * The tree-sitter tier's parser process (FR-009). ts-anchors.mjs starts it
 * with no environment and `--no-addons`, and writes one JSON request to
 * stdin:
 *
 *   { runtime: { js, wasm }, grammars: { <lang>: <path> }, files: [{ key, lang, content, volatile? }] }
 *
 * Every path is a hash-verified copy under `.docguard/ts/<sha256>/`. The
 * runtime is imported by absolute file URL and each grammar is loaded from
 * its bytes, so module resolution never runs. It prints
 * `{ ok, files: { <key>: { symbols } } }` and nothing else.
 *
 * @implements docguard.requirement-anchors#FR-009
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { declarations } from './ts-decls.mjs';
import { dg1 } from './fingerprint.mjs';

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const { Parser, Language } = await import(pathToFileURL(input.runtime.js).href);
  await Parser.init({ locateFile: () => input.runtime.wasm });
  const parsers = {};
  for (const [lang, path] of Object.entries(input.grammars)) {
    const language = await Language.load(new Uint8Array(readFileSync(path)));
    const parser = new Parser();
    parser.setLanguage(language);
    parsers[lang] = parser;
  }
  const files = {};
  for (const file of input.files) {
    const parser = parsers[file.lang];
    if (!parser) continue;
    const tree = parser.parse(file.content);
    if (tree.rootNode.hasError) { files[file.key] = { error: 'tree-sitter found a syntax error' }; tree.delete(); continue; }
    files[file.key] = {
      symbols: declarations(tree, file.lang, new Set(file.volatile || [])).map(d => ({
        name: d.name, nameLine: d.nameLine, startLine: d.startLine, endLine: d.endLine, fp: dg1(d.tokens.join('\u0000')),
      })),
    };
    tree.delete();
  }
  process.stdout.write(JSON.stringify({ ok: true, files }));
}

main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message || error) })); });
