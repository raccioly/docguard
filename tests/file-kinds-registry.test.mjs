/**
 * No validator keeps its own answer to "is this file the project's own"
 * (specs/100-file-kinds FR-011).
 *
 * Thirteen places used to keep a private directory-name ignore set or walk
 * the tree on their own. A file under `cli/` that defines such a set, or
 * recursively walks directories without asking the shared classifier, fails
 * this test unless it is in the allowlist below, with a reason per entry. The
 * allowlist is exact in both directions: an entry that no longer matches
 * fails too, so it can only shrink. Stage 2 (spec 100 T020) migrated every
 * entry: the allowlist is empty, and a file that cannot ask the shared
 * classifier needs a precise exemption (file and what it defines), with the
 * reason the definition means something other than "not this project's file".
 *
 * @req docguard.file-kinds#FR-011
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The modules that define the vocabulary; they are the one sanctioned place for a directory-name set. */
const DEFINING_MODULES = new Set(['cli/shared-ignore.mjs', 'cli/shared-file-kind.mjs']);

/** Names that, two or more together in one literal, make a directory-name ignore set. */
const DIRECTORY_NAMES = new Set([
  'node_modules', 'vendor', 'vendored', 'third_party', 'dist', 'build', 'out', 'coverage', 'target', 'obj', '_build', 'generated',
  'fixtures', '__fixtures__', 'testdata', 'tests', '__tests__', '__mocks__', 'mocks', 'corpus', 'golden',
  'templates', 'template', 'scaffold', 'examples', 'example', 'samples',
  '.next', '.nuxt', '.git', '.cache', '.turbo', '.venv', '__pycache__',
]);

/** What precedes an array that lists file kinds: `kinds: [`, `skipKinds: [`, `COPY_OF_CODE_KINDS = [`. */
const KIND_LIST_PREFIX = /kinds\s*[:=]\s*(?:Object\.freeze\(\s*)?$/i;

/** A walk is classified when the file asks the shared classifier or uses the shared walker. */
const CLASSIFIER_USE = /\bfileKind\(|\bisNonProductPath\(|\bisNonProductDir\(|\bwalkFiles\(|\bsharedWalkFiles\(|\bholdsOwnGit\(/;

/**
 * What a source text defines: `sets` (array literals or regex alternations
 * naming two or more directory names) and `walks` (functions that read a
 * directory and call themselves, in a file that never asks the classifier).
 * Exported for the self-check below.
 */
export function scanSource(source) {
  const sets = [];
  const words = text => [...text.matchAll(/['"`]([\w.-]+)['"`]/g)].map(m => m[1]);
  for (const m of source.matchAll(/\[[^\[\]]{0,1500}\]/g)) {
    // A list of file KINDS (`kinds: ['generated', 'vendored']`, `SKIP_KINDS = [...]`) shares words with the directory
    // vocabulary, but it names the closed kinds of `fileKind`, not directories.
    if (KIND_LIST_PREFIX.test(source.slice(Math.max(0, m.index - 40), m.index))) continue;
    const names = new Set(words(m[0]).filter(w => DIRECTORY_NAMES.has(w)));
    if (names.size >= 2) sets.push([...names].slice(0, 4).join(','));
  }
  for (const m of source.matchAll(/\((?:\?:)?([\w.\\-]+(?:\|[\w.\\-]+)+)\)/g)) {
    const names = new Set(m[1].split('|').map(w => w.replace(/\\/g, '')).filter(w => DIRECTORY_NAMES.has(w)));
    if (names.size >= 2) sets.push([...names].slice(0, 4).join(','));
  }
  const walks = [];
  {
    const decl = /^(?:export )?(?:async )?(?:function\*? ([A-Za-z_$][\w$]*)\s*\(|const ([A-Za-z_$][\w$]*) = (?:async )?(?:function|\())/gm;
    const marks = [...source.matchAll(decl)].map(m => ({ name: m[1] || m[2], at: m.index }));
    marks.forEach((mark, i) => {
      const body = source.slice(mark.at + 1, i + 1 < marks.length ? marks[i + 1].at : source.length);
      const self = new RegExp(`\\b${mark.name.replace(/\$/g, '\\$')}\\(`);
      // A name inside a string or a comment is not a call (an error message that quotes the function).
      const code = body.slice(body.indexOf('(') + 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
      // The function itself must ask the classifier (a file that asks it elsewhere does not cover this walk).
      if (/readdirSync\(|readdir\(/.test(body) && self.test(code) && !CLASSIFIER_USE.test(body)) walks.push(mark.name);
    });
  }
  return { sets: [...new Set(sets)], walks };
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/**
 * Files not yet migrated to the shared classifier, each with why it is still
 * here. Spec 100 Stage 2 (T020) migrated every entry: the list is empty and
 * stays empty. A file that cannot ask the classifier goes in EXEMPT below.
 */
const ALLOWLIST = {
};

/**
 * Precise exemptions: a file and what it defines, with the reason the
 * definition does not mean "not this project's file". Exact in both
 * directions (an exemption that matches nothing fails), and the definition is
 * named, so a second set added to the same file is still reported.
 */
const EXEMPT = {
  'cli/validators/security.mjs': {
    sets: ['node_modules,.git,.next,dist'],
    reason: 'Security reads every kind of file, copies included: a secret in a template, a backup or a nested checkout is still a leaked secret, and it only labels the context (secretContext). Its list is the original narrow one on purpose: the shared build-output set also skips out/, target/ and obj/, where a bundled key is still a leaked key.',
  },
};

const offenders = () => {
  const found = {};
  for (const file of sourceFiles(join(ROOT, 'cli')).sort()) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (DEFINING_MODULES.has(rel)) continue;
    const { sets, walks } = scanSource(readFileSync(file, 'utf8'));
    const exempt = EXEMPT[rel];
    const left = { sets: sets.filter(x => !exempt?.sets?.includes(x)), walks: walks.filter(x => !exempt?.walks?.includes(x)) };
    if (left.sets.length || left.walks.length) found[rel] = left;
  }
  return found;
};

describe('the scan itself', () => {
  it('finds a private directory-name set in an array, a Set and a regex alternation', () => {
    assert.equal(scanSource("const SKIP = new Set(['node_modules', 'dist', 'x']);").sets.length, 1);
    assert.equal(scanSource("const A = ['fixtures', 'templates'];").sets.length, 1);
    assert.equal(scanSource('const R = /(?:^|\\/)(?:node_modules|vendor|dist)(?:\\/|$)/;').sets.length, 1);
  });

  it('a list of file kinds is not a set of directory names', () => {
    assert.deepEqual(scanSource("walk(dir, cb, { kinds: ['generated', 'vendored'] });").sets, []);
    assert.deepEqual(scanSource("const COPY_OF_CODE_KINDS = ['template', 'fixture', 'vendored', 'generated'];").sets, []);
    assert.equal(scanSource("const SKIP = ['vendored', 'generated'];").sets.length, 1, 'a plain list of those names is still a set');
  });

  it('a function name inside a string or a comment is not a recursive call', () => {
    const quoted = "function plan(s) {\n  if (!s) throw new TypeError('plan(s): pass it');\n  return readdirSync(s);\n}\n";
    assert.deepEqual(scanSource(quoted).walks, []);
    const real = "function plan(s) {\n  for (const e of readdirSync(s)) plan(e); // plan(e) again\n}\n";
    assert.deepEqual(scanSource(real).walks, ['plan']);
  });

  it('one directory name alone is not a set, and ordinary arrays are not', () => {
    assert.deepEqual(scanSource("const A = ['dist'];\nconst B = ['a', 'b', 'c'];").sets, []);
  });

  it('finds a function that reads a directory and calls itself, unless that function asks the classifier', () => {
    const walker = "import { readdirSync } from 'node:fs';\nfunction scan(dir) {\n  for (const e of readdirSync(dir)) scan(e);\n}\n";
    assert.deepEqual(scanSource(walker).walks, ['scan']);
    assert.deepEqual(scanSource(`${walker}\nconst keep = f => !fileKind(f, {}).kind;`).walks, []);
    assert.deepEqual(scanSource("function once(dir) { return readdirSync(dir); }").walks, []);
    // Asking the classifier in some other function of the file does not cover this walk.
    const elsewhere = `${walker}\nfunction other(f) { return fileKind(f, {}); }\n`;
    assert.deepEqual(scanSource(elsewhere).walks, ['scan']);
  });
});

describe('FR-011 — no private directory-name set or unclassified walk under cli/', () => {
  const found = offenders();

  it('every offending file is in the allowlist', () => {
    const missing = Object.keys(found).filter(f => !(f in ALLOWLIST));
    assert.deepEqual(missing, [], `Ask the shared classifier instead (cli/shared-file-kind.mjs, walkFiles), or, for a file that cannot yet, add it to ALLOWLIST with a reason: ${missing.map(f => `${f} (${[...found[f].sets, ...found[f].walks].join(' ')})`).join('; ')}`);
  });

  it('every allowlist entry still offends: the list only shrinks', () => {
    const stale = Object.keys(ALLOWLIST).filter(f => !(f in found));
    assert.deepEqual(stale, [], `These files no longer define a set or walk the tree; delete them from ALLOWLIST: ${stale.join(', ')}`);
  });

  it('the allowlist is empty: Stage 2 migrated every file', () => {
    assert.deepEqual(Object.keys(ALLOWLIST), []);
  });

  it('every exemption still matches what it names, and carries a reason', () => {
    for (const [file, ex] of Object.entries(EXEMPT)) {
      assert.ok(typeof ex.reason === 'string' && ex.reason.trim().length >= 40, `${file}: say why the definition is not a copy list`);
      const { sets, walks } = scanSource(readFileSync(join(ROOT, file), 'utf8'));
      for (const x of ex.sets || []) assert.ok(sets.includes(x), `${file}: no set ${x} any more; delete the exemption`);
      for (const x of ex.walks || []) assert.ok(walks.includes(x), `${file}: no walk ${x} any more; delete the exemption`);
    }
  });

  it('every allowlist entry carries a reason', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) assert.ok(typeof reason === 'string' && reason.trim().length >= 12, file);
  });

  it('the defining modules exist', () => {
    for (const m of DEFINING_MODULES) assert.ok(readFileSync(join(ROOT, m), 'utf8').length > 0, m);
  });
});
