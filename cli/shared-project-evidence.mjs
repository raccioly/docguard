/**
 * What a project has, read from its files, for the applicability decisions of
 * the validators that need a declaration no tool can infer (specs/097-strict-by-default
 * FR-006): "this project has canonical documents and source code" is a fact
 * about the project; "this project wrote a covers= marker" is the declaration
 * the validator then asks for. Only an empty result pays for these scans.
 *
 * @implements docguard.strict-by-default#FR-006
 */
import { extname } from 'node:path';
import { listCanonicalDocs, isNonProductPath, relPosix, walkFiles } from './shared-ignore.mjs';
import { listTrackedFiles } from './shared-git.mjs';
import { isTestSource as isTestFile } from './scanners/requirement-evidence.mjs';

const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.py', '.go', '.rs', '.java', '.kt', '.rb',
  '.php', '.cs', '.swift', '.scala', '.c', '.cc', '.cpp', '.h', '.hpp',
]);

/** The first source file that is the project's own product code, or null: not a test, fixture, example or benchmark path. */
export function firstProductSource(projectDir, config = {}) {
  const tracked = listTrackedFiles(projectDir);
  const isProduct = rel => SOURCE_EXTENSIONS.has(extname(rel)) && !isNonProductPath(rel, config) && !isTestFile(rel);
  if (tracked) {
    for (const rel of tracked) if (isProduct(rel)) return rel;
    return null;
  }
  let found = null;
  walkFiles(projectDir, abs => {
    if (found) return;
    const rel = relPosix(projectDir, abs);
    if (isProduct(rel)) found = rel;
  });
  return found;
}

/** The canonical documents (docs-canonical/ and mapped roles), project-relative. */
export function canonicalDocPaths(projectDir, config = {}) {
  return listCanonicalDocs(projectDir, { config }).map(doc => doc.rel);
}

/** `a, b and 2 more` for evidence sentences. */
export function sample(items, count = 3) {
  const head = items.slice(0, count).join(', ');
  return items.length > count ? `${head} and ${items.length - count} more` : head;
}

/**
 * A validator whose printed `total` is padded (so an enabled validator prints 1
 * check, not 0/0) reports its empty result as `checked` with the generic
 * sentence. When it performed nothing, say why instead: the verdict is `empty`
 * either way (FR-004), so this moves no exit code. Only an empty result's
 * applicability is replaced; a result that performed or found something is returned as is.
 */
export function explainPaddedEmpty(fields) {
  if (fields.performed !== 0 || !fields.emptyCause) return fields;
  return { ...fields, applicability: { status: 'no-matches', reason: fields.note } };
}
