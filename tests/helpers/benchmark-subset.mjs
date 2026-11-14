import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A manifest holding a few cases of the real corpus, with their own fixtures copied beside it,
 * for tests whose property needs a prepared run (a retained root, a changed baseline) and not
 * the whole corpus. The cases are the committed ones, unedited, so a run over them is a real
 * benchmark run; only the number of cases differs. Tests that prove the full corpus keep
 * running `benchmarks/corpus.json` itself.
 * @param {string} directory empty directory that receives `corpus.json` and `fixtures/`
 * @param {string[]} ids case IDs to carry over
 * @returns {string} path of the written manifest
 */
export function writeSubsetManifest(directory, ids) {
  const corpusDirectory = resolve('benchmarks');
  const corpus = JSON.parse(readFileSync(join(corpusDirectory, 'corpus.json'), 'utf8'));
  const cases = ids.map(id => {
    const item = corpus.cases.find(candidate => candidate.id === id);
    if (!item) throw new Error(`Benchmark case not found in the corpus: ${id}`);
    if (item.source.kind !== 'fixture') throw new Error(`A subset carries fixture cases only: ${id}`);
    return item;
  });
  for (const item of cases) {
    const target = join(directory, item.source.path);
    mkdirSync(join(target, '..'), { recursive: true });
    cpSync(join(corpusDirectory, item.source.path), target, { recursive: true, dereference: false });
  }
  const path = join(directory, 'corpus.json');
  writeFileSync(path, `${JSON.stringify({ ...corpus, cases }, null, 2)}\n`, 'utf8');
  return path;
}
