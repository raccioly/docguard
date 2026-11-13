/**
 * No validator keeps its own answer to "is this file the project's own"
 * (specs/100-file-kinds FR-011).
 *
 * Thirteen places used to keep a private directory-name ignore set or walk
 * the tree on their own. A file under `cli/` that defines such a set, or
 * recursively walks directories without asking the shared classifier, fails
 * this test unless it is in the allowlist below, with a reason per entry. The
 * allowlist is exact in both directions: an entry that no longer matches
 * fails too, so it can only shrink. Stage 2 migrates every entry and ends
 * with an empty list.
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

/** A walk is classified when the file asks the shared classifier or uses the shared walker. */
const CLASSIFIER_USE = /\bfileKind\(|\bisNonProductPath\(|\bisNonProductDir\(|\bwalkFiles\(|\bsharedWalkFiles\(/;

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
    const names = new Set(words(m[0]).filter(w => DIRECTORY_NAMES.has(w)));
    if (names.size >= 2) sets.push([...names].slice(0, 4).join(','));
  }
  for (const m of source.matchAll(/\((?:\?:)?([\w.\\-]+(?:\|[\w.\\-]+)+)\)/g)) {
    const names = new Set(m[1].split('|').map(w => w.replace(/\\/g, '')).filter(w => DIRECTORY_NAMES.has(w)));
    if (names.size >= 2) sets.push([...names].slice(0, 4).join(','));
  }
  const walks = [];
  if (!CLASSIFIER_USE.test(source)) {
    const decl = /^(?:export )?(?:async )?(?:function\*? ([A-Za-z_$][\w$]*)\s*\(|const ([A-Za-z_$][\w$]*) = (?:async )?(?:function|\())/gm;
    const marks = [...source.matchAll(decl)].map(m => ({ name: m[1] || m[2], at: m.index }));
    marks.forEach((mark, i) => {
      const body = source.slice(mark.at + 1, i + 1 < marks.length ? marks[i + 1].at : source.length);
      const self = new RegExp(`\\b${mark.name.replace(/\$/g, '\\$')}\\(`);
      if (/readdirSync\(|readdir\(/.test(body) && self.test(body.slice(body.indexOf('(') + 1))) walks.push(mark.name);
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
 * here. Stage 2 (specs/100-file-kinds T020) removes every entry.
 */
const ALLOWLIST = {
  'cli/commands/diff.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/commands/generate.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/commands/score.mjs': 'Stage 2: keeps a private directory-name skip list and its own recursive walk; move both to walkFiles and fileKind',
  'cli/commands/sync-tests.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/commands/trace.mjs': 'Stage 2: keeps a private directory-name skip list and its own recursive walk; move both to walkFiles and fileKind',
  'cli/ensure-skills.mjs': 'Stage 2: recursive read of the shipped skill assets; confirm it is not a project walk, then drop the entry or exempt it with a reason',
  'cli/scanners/aidlc.mjs': 'Stage 2: keeps a private directory-name skip list and its own recursive walk; move both to walkFiles and fileKind',
  'cli/scanners/doc-tools.mjs': 'Stage 2: walks directories on its own; move it to walkFiles and fileKind',
  'cli/scanners/frontend.mjs': 'Stage 2: walks directories on its own; move it to walkFiles and fileKind',
  'cli/scanners/import-graph.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/scanners/inventory.mjs': 'Stage 2: keeps fixture-name skip lists and walks test files itself; use fileKind (D6, D8 family)',
  'cli/scanners/project-type.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/scanners/symbol-map.mjs': 'Stage 2: vendored and generated directory regex; becomes the vendored and generated kinds',
  'cli/scanners/tech-stack.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/shared-doc-role-hint.mjs': 'Stage 2: directory-name skip list behind the role hint, which proposes examples and templates documents (D4)',
  'cli/shared-doc-roles.mjs': 'Stage 2: directory-name skip list behind uniqueSameNamedCanonical, which adopts an archive copy (D3)',
  'cli/shared-drift.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/shared-source.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/shared-test-cases.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/validators/docs-coverage.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/validators/docs-diff.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/validators/docs-sync.mjs': 'Stage 2: private skip list beside isNonProductPath',
  'cli/validators/metadata-sync.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
  'cli/validators/security.mjs': 'Stage 2: private skip list beside isNonProductPath; templates and backups are not classified',
  'cli/validators/test-spec.mjs': 'Stage 2: keeps a private directory-name skip list and its own recursive walk; move both to walkFiles and fileKind',
  'cli/validators/todo-tracking.mjs': 'Stage 2: private ignore set that flags out/ and target/ (D8) and files in templates, backup, examples and fixtures (D6)',
  'cli/validators/traceability.mjs': 'Stage 2: keeps a private directory-name skip list; replace it with walkFiles and fileKind',
};

const offenders = () => {
  const found = {};
  for (const file of sourceFiles(join(ROOT, 'cli')).sort()) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (DEFINING_MODULES.has(rel)) continue;
    const { sets, walks } = scanSource(readFileSync(file, 'utf8'));
    if (sets.length || walks.length) found[rel] = { sets, walks };
  }
  return found;
};

describe('the scan itself', () => {
  it('finds a private directory-name set in an array, a Set and a regex alternation', () => {
    assert.equal(scanSource("const SKIP = new Set(['node_modules', 'dist', 'x']);").sets.length, 1);
    assert.equal(scanSource("const A = ['fixtures', 'templates'];").sets.length, 1);
    assert.equal(scanSource('const R = /(?:^|\\/)(?:node_modules|vendor|dist)(?:\\/|$)/;').sets.length, 1);
  });

  it('one directory name alone is not a set, and ordinary arrays are not', () => {
    assert.deepEqual(scanSource("const A = ['dist'];\nconst B = ['a', 'b', 'c'];").sets, []);
  });

  it('finds a function that reads a directory and calls itself, unless the file asks the classifier', () => {
    const walker = "import { readdirSync } from 'node:fs';\nfunction scan(dir) {\n  for (const e of readdirSync(dir)) scan(e);\n}\n";
    assert.deepEqual(scanSource(walker).walks, ['scan']);
    assert.deepEqual(scanSource(`${walker}\nconst keep = f => !fileKind(f, {}).kind;`).walks, []);
    assert.deepEqual(scanSource("function once(dir) { return readdirSync(dir); }").walks, []);
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

  it('every allowlist entry carries a reason', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) assert.ok(typeof reason === 'string' && reason.trim().length >= 12, file);
  });

  it('the defining modules exist', () => {
    for (const m of DEFINING_MODULES) assert.ok(readFileSync(join(ROOT, m), 'utf8').length > 0, m);
  });
});
