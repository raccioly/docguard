/**
 * Inventory scanners — code-truth the generator PRE-FILLS instead of leaving
 * empty placeholders.
 *
 * Field report §2/§5: `generate` markets "reverse-engineer docs from code" but
 * shipped empty templates, so the agent hand-greps the structure that was right
 * there in the code. These two extractors populate the `source:"code"` sections
 * so the agent is left with only the genuine prose (the *why*):
 *   - scanComponents:    top-level source modules → ARCHITECTURE Component Map
 *   - scanTestInventory: test files + per-file case counts → TEST-SPEC inventory
 *
 * Language-agnostic, best-effort, zero NPM deps.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { resolveSourceRoots, readScannable } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, isNonProductDir } from '../shared-ignore.mjs';

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.rb', '.php', '.java', '.kt']);
const toPosix = (p) => p.split(/[\\/]/).join('/');

// ── Component map ─────────────────────────────────────────────────────────────

// Descend through single-package wrappers (src/ → src/<pkg>/) so we list the
// REAL modules, not just the wrapper folder. A wrapper is a dir whose only
// non-ignored child is another dir (e.g. a Python `src/<pkg>/` layout).
function componentRoot(root, config) {
  let cur = root;
  for (let depth = 0; depth < 3; depth++) {
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { break; }
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')
      && !IGNORE_DIRS.has(e.name) && !isNonProductDir(e.name, config));
    const codeFiles = entries.filter(e => e.isFile() && CODE_EXT.has(extname(e.name))
      && !/^(index|main|mod|lib|__init__|__main__)\./.test(e.name));
    if (dirs.length === 1 && codeFiles.length === 0) { cur = join(cur, dirs[0].name); continue; }
    break;
  }
  return cur;
}

/**
 * Top-level source modules under the project's (de-wrapped) source root(s).
 * Each is a directory (a module) or a significant source file directly under
 * the root. Non-product dirs (tests/fixtures/examples) and barrel/entry files
 * are excluded. Capped to keep the table readable.
 * @returns {Array<{ name: string, kind: 'module'|'file', path: string }>}
 */
export function scanComponents(projectDir, config = {}, limit = 30) {
  const out = [];
  const seen = new Set();
  for (const root of resolveSourceRoots(projectDir, config)) {
    const croot = componentRoot(root, config);
    let entries;
    try { entries = readdirSync(croot, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      let kind;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || isNonProductDir(e.name, config)) continue;
        kind = 'module';
      } else if (e.isFile() && CODE_EXT.has(extname(e.name))) {
        if (/^(index|__init__)\./.test(e.name)) continue; // barrels/entry-init aren't components
        kind = 'file';
      } else continue;
      const rel = toPosix(relative(projectDir, join(croot, e.name)));
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push({ name: e.name, kind, path: rel });
    }
  }
  out.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : (a.kind === 'module' ? -1 : 1)));
  return out.slice(0, limit);
}

// ── Test inventory ────────────────────────────────────────────────────────────

// Test FILE conventions across ecosystems: JS *.test/*.spec, Python test_*.py /
// *_test.py, Go *_test.go, Ruby *_spec.rb / *_test.rb.
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|(?:^|\/)test_[^/]*\.py|_test\.(?:py|go)|_spec\.rb|(?:^|\/)[^/]*_test\.rb)$/i;
// Fixture/mock subdirs that sit INSIDE a test dir but aren't themselves tests.
const FIXTURE_DIRS = new Set(['fixtures', '__fixtures__', 'testdata', 'test-fixtures', 'testfixtures', 'mocks', '__mocks__', 'snapshots', '__snapshots__']);
const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'e2e'];

function countCases(content, ext) {
  let re;
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) re = /\b(?:it|test)\s*\(/g;
  else if (ext === '.py') re = /^[ \t]*(?:async[ \t]+)?def[ \t]+test_/gm;
  else if (ext === '.go') re = /^[ \t]*func[ \t]+Test[A-Z]/gm;
  else if (ext === '.rs') re = /#\[(?:test|tokio::test)\]/g;
  else if (ext === '.rb') re = /^[ \t]*(?:it|test|specify)\b/gm;
  else return 0;
  let n = 0;
  while (re.exec(content) !== null) n++;
  return n;
}

function walkTestFiles(dir, projectDir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    if (e.isDirectory()) {
      if (FIXTURE_DIRS.has(e.name)) continue; // fixtures/mocks inside a test dir aren't tests
      walkTestFiles(join(dir, e.name), projectDir, acc);
    } else if (e.isFile() && CODE_EXT.has(extname(e.name))) {
      const rel = toPosix(relative(projectDir, join(dir, e.name)));
      if (TEST_FILE_RE.test(rel)) acc.add(rel);
    }
  }
}

/**
 * Test files + per-file case counts. Walks the conventional test dirs (tests/,
 * test/, __tests__, spec/, e2e/) plus each source root (co-located tests),
 * skipping fixture/mock subdirs. Case counts are per-language (it()/test(),
 * `def test_`, `func Test`, `#[test]`, …).
 * @returns {{ files: Array<{file:string,cases:number}>, totalCases:number, totalFiles:number }}
 */
export function scanTestInventory(projectDir, config = {}) {
  const root = resolve(projectDir);
  const acc = new Set();
  for (const td of TEST_DIRS) {
    const d = join(root, td);
    if (existsSync(d)) walkTestFiles(d, root, acc);
  }
  for (const sr of resolveSourceRoots(projectDir, config)) walkTestFiles(sr, root, acc);

  const files = [];
  let totalCases = 0;
  for (const rel of acc) {
    const content = readScannable(join(root, rel));
    const cases = content === null ? 0 : countCases(content, extname(rel));
    files.push({ file: rel, cases });
    totalCases += cases;
  }
  files.sort((a, b) => b.cases - a.cases || a.file.localeCompare(b.file));
  return { files, totalCases, totalFiles: files.length };
}
