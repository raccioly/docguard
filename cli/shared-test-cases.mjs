/**
 * Test-case facts shared by the count validators.
 *
 * Two questions, answered deterministically and without running anything:
 *   1. Which files are test files?        → findTestFiles(projectDir)
 *   2. How many test cases do they declare? → countDeclaredTestCases(files)
 *
 * WHY "DECLARED", NOT "EXECUTED":
 *   A test runner's summary is the number readers mean by "N tests", but the
 *   only way to obtain it is to run the suite, which a validator must never do.
 *   The static count is a LOWER BOUND of the runner's number: a case declared
 *   inside a loop is counted once but runs once per iteration, and parametrized
 *   Python/Go cases expand at runtime. Measured on DocGuard's own suite
 *   (2026-09-22): 1,721 declared against 2,085 reported by node:test. The
 *   bound is near-strict rather than strict — a case inside a skipped
 *   `describe(..., { skip })` or behind a runtime `if` is declared but never
 *   reported — so callers must treat the count as evidence that a smaller
 *   documented number is stale, never as the number a doc should say.
 *
 * JS/TS counting uses @babel/parser (the project's single runtime dependency)
 * so `re.test(x)` calls, string literals that spell out `it(`, and comments are
 * never counted. The regex fallback for a parser-less install is documented on
 * `countJsCasesByRegex` and is deliberately conservative.
 *
 * Zero additional dependencies — pure Node.js built-ins plus the shared parser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { walkFiles } from './shared-ignore.mjs';
import { parseJsTs, walk, astTierAvailable } from './scanners/js-ast.mjs';

const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'e2e'];
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);

/** JS/TS: `x.test.ts`, `x.spec.mjs`, or anything under a `__tests__` folder. */
const JS_TEST_RE = /\.(test|spec)\.[^.]+$/;
/** Python (pytest/unittest discovery): `test_x.py`, `x_test.py`. */
const PY_TEST_RE = /^(?:test_.*|.*_test)\.py$/;
/** Go: `x_test.go`. */
const GO_TEST_RE = /_test\.go$/;

function isTestFile(path) {
  const name = basename(path);
  if (JS_TEST_RE.test(name)) return true;
  if (PY_TEST_RE.test(name)) return true;
  if (GO_TEST_RE.test(name)) return true;
  return /[\\/]__tests__[\\/]/.test(path) && JS_EXT.has(extname(name));
}

/**
 * Enumerate a project's test files: the conventional top-level test dirs plus
 * tests co-located under src/. Returns absolute paths, deduplicated.
 * @param {string} projectDir
 * @returns {string[]}
 */
export function findTestFiles(projectDir) {
  const seen = new Set();
  const add = (f) => { if (isTestFile(f) && !seen.has(f)) seen.add(f); };
  for (const td of TEST_DIRS) {
    const dir = resolve(projectDir, td);
    if (existsSync(dir)) walkFiles(dir, add);
  }
  const srcDir = resolve(projectDir, 'src');
  if (existsSync(srcDir)) walkFiles(srcDir, add);
  return [...seen];
}

const JS_CASE_NAMES = new Set(['it', 'test']);
const JS_CASE_MODIFIERS = new Set(['only', 'skip', 'todo']);

/**
 * Count `it(...)`/`test(...)` call sites (plus `.only/.skip/.todo`) in a parsed
 * JS/TS AST. Member calls on other objects (`re.test(x)`, `t.test(...)`) are
 * not counted: the first is not a test, and the second is a node:test subtest
 * whose parent is already counted — under-counting keeps the lower bound.
 */
function countJsCasesInAst(ast) {
  let n = 0;
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const c = node.callee;
    if (!c) return;
    if (c.type === 'Identifier' && JS_CASE_NAMES.has(c.name)) { n++; return; }
    if (c.type === 'MemberExpression' && !c.computed
      && c.object && c.object.type === 'Identifier' && JS_CASE_NAMES.has(c.object.name)
      && c.property && c.property.type === 'Identifier' && JS_CASE_MODIFIERS.has(c.property.name)) {
      n++;
    }
  });
  return n;
}

/**
 * Regex fallback for a parser-less install. Requires the call to start a
 * statement (line start or after `;`/`{`/`}`) so `re.test(` and `it(` inside a
 * string on the same line as other code are skipped. Cases written inline
 * after other tokens are missed — acceptable, because a miss only lowers the
 * bound.
 * @param {string} src
 */
export function countJsCasesByRegex(src) {
  const re = /(?:^|[;{}])\s*(?:it|test)(?:\.(?:only|skip|todo))?\s*\(/gm;
  return (String(src).match(re) || []).length;
}

/** Python: `def test_x(` / `async def test_x(`. Parametrize expands at runtime (lower bound holds). */
function countPyCases(src) {
  return (String(src).match(/^\s*(?:async\s+)?def\s+test_\w*\s*\(/gm) || []).length;
}

/** Go: `func TestX(` top-level functions. Subtests via t.Run are not counted. */
function countGoCases(src) {
  return (String(src).match(/^func\s+Test\w*\s*\(/gm) || []).length;
}

/**
 * Count the test cases declared across the given files.
 *
 * @param {string[]} files - absolute paths from findTestFiles()
 * @returns {{ files: number, cases: number, parserTier: string }}
 *   `parserTier` uses the finding vocabulary (`js-ast`, `regex-fallback`,
 *   `mixed`) so a finding can say which analyzer produced its number.
 */
export function countDeclaredTestCases(files) {
  let cases = 0;
  let counted = 0;
  let viaAst = 0;
  let viaRegex = 0;
  const ast = astTierAvailable();
  for (const file of files) {
    let src;
    try { src = readFileSync(file, 'utf-8'); } catch { continue; }
    counted++;
    const ext = extname(file);
    if (ext === '.py') { cases += countPyCases(src); viaRegex++; continue; }
    if (ext === '.go') { cases += countGoCases(src); viaRegex++; continue; }
    if (!JS_EXT.has(ext)) continue;
    if (ast) {
      const parsed = parseJsTs(src, file);
      if (parsed.ok) { cases += countJsCasesInAst(parsed.ast); viaAst++; continue; }
    }
    cases += countJsCasesByRegex(src);
    viaRegex++;
  }
  const parserTier = viaAst > 0 && viaRegex > 0 ? 'mixed' : viaAst > 0 ? 'js-ast' : 'regex-fallback';
  return { files: counted, cases, parserTier };
}
