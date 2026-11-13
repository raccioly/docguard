/**
 * File kinds: one answer to "is this file this project's own"
 * (specs/100-file-kinds).
 *
 * A repository holds files that are not its own work: a scaffolder's forms,
 * fixture projects, vendored code, build output, backup copies of documents,
 * a nested Git checkout. Before this module every validator kept its own list
 * of directory names, in its own case, with its own exceptions. Now they ask
 * `fileKind`, which answers from a closed list of kinds and always errs toward
 * `own`: classifying a file as a copy removes it from checks, so what the
 * vocabulary does not recognize stays the project's.
 *
 * The directory vocabulary is matched on whole path segments, ignoring case,
 * only before the first segment that starts with `.` (harness folders such as
 * `.claude/` hold files the harness loads, whatever their subfolders are
 * called), and never for a package segment (`src/main/java/com/example`).
 * Reads no file contents; only `nested-checkout` touches the disk, and only
 * when the caller passes `opts.root`.
 *
 * This module imports nothing from the other shared modules: `shared-ignore.mjs`
 * imports it (and re-exports the fixture vocabulary, `compileGlob` and
 * `isPackageSegment`, which live here), so a cycle would be an architecture
 * finding.
 *
 * @implements docguard.file-kinds#FR-001
 * @implements docguard.file-kinds#FR-002
 * @implements docguard.file-kinds#FR-003
 * @implements docguard.file-kinds#FR-004
 * @implements docguard.file-kinds#FR-005
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The closed list. Anything a path is not recognized as is `own`. */
export const FILE_KINDS = Object.freeze(['own', 'template', 'fixture', 'vendored', 'generated', 'backup', 'nested-checkout']);

/**\/*.test.{ts,js}")
 * @returns {RegExp}
 */
export function compileGlob(pattern) {
  const glob = String(pattern);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { re += '(?:.*/)?'; i++; }
        else re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += '(?:' + glob.slice(i + 1, end).split(',')
          .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end;
      } else {
        re += '\\{';
      }
    } else {
      re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}


/** JVM source roots: below `src/main/<one of these>/` every segment is a package. */
const JVM_SOURCE_LANGUAGES = new Set(['java', 'kotlin', 'scala', 'groovy']);
/** First segments of a reverse-domain package name (`com.example`, `org.samples`). */
const REVERSE_DOMAIN_ROOTS = new Set([
  'com', 'org', 'net', 'io', 'dev', 'edu', 'gov', 'mil', 'info', 'biz', 'co', 'eu',
  'uk', 'de', 'fr', 'br', 'nl', 'ch', 'se', 'fi', 'dk', 'jp', 'cn', 'au', 'ca', 'ru', 'es', 'pl',
]);
const EXAMPLE_NAMES = new Set(['example', 'examples', 'sample', 'samples']);

/**
 * Is `segments[index]` a package name rather than a directory of its own kind?
 * - anything below `src/main/{java,kotlin,scala,groovy}/`: Maven and Gradle
 *   main sources are product code by construction (tests live in `src/test`);
 * - `example(s)`/`sample(s)` right after a reverse-domain root (`com/example`)
 *   or after Go's `internal` (`internal/example`).
 *
 * @implements docguard.fallback-language-coverage#FR-006
 */
export function isPackageSegment(segments, index) {
  // Directory names are compared without regard to case, like the vocabulary (spec 100 FR-002).
  const lower = segments.map(s => String(s).toLowerCase());
  for (let j = 0; j + 2 < index; j++) {
    if (lower[j] === 'src' && lower[j + 1] === 'main' && JVM_SOURCE_LANGUAGES.has(lower[j + 2])) return true;
  }
  if (index > 0 && EXAMPLE_NAMES.has(lower[index])) {
    const before = lower[index - 1];
    if (REVERSE_DOMAIN_ROOTS.has(before) || before === 'internal') return true;
  }
  return false;
}

const names = list => Object.freeze(new Set(list));

/** Forms a project writes into other repositories (spec 099 FR-001, plus starter kits and skeletons). */
export const TEMPLATE_DIRS = names([
  'templates', 'template', '_templates', '__templates__', 'scaffold', 'scaffolds', 'boilerplate', 'boilerplates',
  'starter-kit', 'starter-kits', 'skeleton', 'skeletons',
]);

/**
 * Test data, sample apps, example projects, mocks. The detection set of
 * `isNonProductPath` as it was, plus `corpus` and `golden`.
 */
export const FIXTURE_DIRS = names([
  'fixtures', '__fixtures__', 'test-fixtures', 'testfixtures', 'testdata',
  'test', 'tests', '__tests__', 'test-helpers', 'spec', 'specs', '__mocks__', 'mocks',
  'examples', 'example', 'sample', 'samples',
  'corpus', 'golden',
]);

/** Code that belongs to someone else (`DEFAULT_IGNORE_DIRS`' package managers, plus vendored and third_party). */
export const VENDORED_DIRS = names(['node_modules', 'vendor', 'vendored', 'third_party', '.venv', '__pycache__']);

/** Build output (`DEFAULT_IGNORE_DIRS`' build outputs, plus generated). */
export const GENERATED_DIRS = names(['dist', 'build', 'out', 'coverage', 'target', 'obj', '_build', 'generated']);

/** Order in which kinds win when several segments of one path qualify. */
const PRECEDENCE = [
  ['template', TEMPLATE_DIRS],
  ['fixture', FIXTURE_DIRS],
  ['vendored', VENDORED_DIRS],
  ['generated', GENERATED_DIRS],
];

const DOCUMENTATION_DIRS = new Set(['docs', 'docs-canonical', 'docs-implementation', 'documentation', 'doc']);
const BACKUP_DIRS = new Set(['archive', 'archived', 'backup', 'backups', 'old', 'deprecated']);
const DOC_EXT = '(?:md|mdx|markdown|txt|rst|adoc)';
const BACKUP_SUFFIX_RE = /(?:\.bak|\.orig|\.backup|~)$/i;
const DOC_FILE_RE = new RegExp(`\\.${DOC_EXT}$`, 'i');
const BACKUP_NAME_RES = [
  new RegExp(`\\s+copy(?:\\s+\\d+)?\\.${DOC_EXT}$`, 'i'),
  new RegExp(`\\s\\(\\d+\\)\\.${DOC_EXT}$`, 'i'),
  new RegExp(`-old\\.${DOC_EXT}$`, 'i'),
  new RegExp(`\\.old\\.${DOC_EXT}$`, 'i'),
];

/**
 * How a file that describes its own folder (an agent-instruction file) asks
 * whether it is a copy written for another project: the holding folder does
 * not count, and only templates and fixtures are copies (specs/099 FR-001,
 * specs/100 FR-007 to FR-009).
 */
export const INSTRUCTION_COPY = Object.freeze({ describesFolder: true, kinds: Object.freeze(['template', 'fixture']) });

const OWN = Object.freeze({ kind: 'own', segment: null, reason: 'nothing in the vocabulary matches' });

/** `fileKinds.own` globs, compiled once per config object. */
const overrideMemo = new WeakMap();
function ownMatchers(config) {
  if (!config || typeof config !== 'object') return [];
  if (overrideMemo.has(config)) return overrideMemo.get(config);
  const raw = config.fileKinds?.own;
  const list = (Array.isArray(raw) ? raw : []).filter(p => typeof p === 'string' && p.trim()).map(p => {
    try { return compileGlob(p.trim().replace(/^\.\//, '')); } catch { return null; }
  }).filter(Boolean);
  overrideMemo.set(config, list);
  return list;
}

/**
 * Could a `fileKinds.own` glob name a file below this directory? A walker that
 * prunes a fixture-named directory asks first, so an `examples/` package the
 * project declared its own is still read.
 */
export function mayHoldOwnFiles(dirPath, config = {}) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.fileKinds?.own)) return false;
  const dir = String(dirPath).replace(/^\.\//, '').replace(/\/+$/, '');
  return config.fileKinds.own.some(raw => {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const glob = raw.trim().replace(/^\.\//, '');
    return glob === dir || glob.startsWith(`${dir}/`) || (glob.startsWith('**/') && (`/${glob}/`).includes(`/${dir.split('/').pop()}/`));
  });
}

/** Does `.git` exist in this project-relative directory? Cached per root and directory. */
const checkoutMemo = new Map();
function holdsGit(root, dir) {
  const key = `${root}\0${dir}`;
  if (!checkoutMemo.has(key)) checkoutMemo.set(key, existsSync(join(root, dir, '.git')));
  return checkoutMemo.get(key);
}

/** Forget what was learned about nested checkouts (tests that rebuild a tree). */
export function clearFileKindCache() { checkoutMemo.clear(); }

function backupOf(path, segments, dirCount, wants) {
  if (!wants('backup')) return null;
  const name = segments[segments.length - 1];
  const bare = name.replace(BACKUP_SUFFIX_RE, '');
  const isDocument = DOC_FILE_RE.test(bare);
  if (!isDocument) return null;
  if (bare !== name || BACKUP_NAME_RES.some(re => re.test(name))) {
    return { kind: 'backup', segment: name, reason: `\`${name}\` is named like a backup copy of a document` };
  }
  // Inside a documentation directory, an archive-like ancestor.
  let inDocs = false;
  for (let i = 0; i < dirCount; i++) {
    const lower = segments[i].toLowerCase();
    if (segments[i].startsWith('.')) break;
    if (inDocs && BACKUP_DIRS.has(lower)) return { kind: 'backup', segment: segments[i], reason: `a document below a documentation directory's \`${segments[i]}\`` };
    if (DOCUMENTATION_DIRS.has(lower)) inDocs = true;
  }
  return null;
}

/**
 * Classify one project-relative POSIX path.
 *
 * @param {string} path - project-relative, `/`-separated
 * @param {object} [config] - the project config; `fileKinds.own` (globs) forces `own`
 * @param {object} [opts]
 * @param {boolean} [opts.describesFolder] - the file describes its own folder (an agent-instruction file, a
 *   README): the folder that holds it does not count, so `templates/AGENTS.md` governs `templates/`
 * @param {string[]} [opts.kinds] - answer only with these kinds (others are `own`)
 * @param {'cutoff'|'all'} [opts.harnessFolders] - `'all'` reads segments after a dot-directory too
 *   (`isNonProductPath`'s historical behavior); the default stops at the first one
 * @param {boolean} [opts.asDirectory] - the last segment names a directory and is classified like one
 * @param {string} [opts.root] - absolute project root; enables `nested-checkout`
 * @returns {{ kind: string, segment: string|null, reason: string }}
 */
export function fileKind(path, config = {}, opts = {}) {
  if (typeof path !== 'string' || path === '') return OWN;
  const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (ownMatchers(config).some(re => re.test(clean))) return { kind: 'own', segment: null, reason: 'named by fileKinds.own' };
  const segments = clean.split('/').filter(Boolean);
  if (segments.length === 0) return OWN;
  const wanted = Array.isArray(opts.kinds) ? new Set(opts.kinds) : null;
  const wants = kind => !wanted || wanted.has(kind);
  const dirCount = opts.asDirectory ? segments.length : segments.length - 1;
  // A root file has no ancestor: no vocabulary applies to it, though its name can still be a backup's.
  const folder = dirCount - 1; // index of the folder that holds the file
  const limit = opts.describesFolder && !opts.asDirectory ? folder : dirCount;
  const cutoff = opts.harnessFolders !== 'all';

  if (opts.root && wants('nested-checkout')) {
    for (let i = 0; i < dirCount; i++) {
      const dir = segments.slice(0, i + 1).join('/');
      if (holdsGit(opts.root, dir)) return { kind: 'nested-checkout', segment: dir, reason: `\`${dir}\` holds its own .git entry` };
    }
  }

  const first = new Map();
  for (let i = 0; i < limit; i++) {
    const seg = segments[i];
    if (cutoff && seg.startsWith('.')) break;
    const lower = seg.toLowerCase();
    for (const [kind, set] of PRECEDENCE) {
      if (first.has(kind) || !wants(kind) || !set.has(lower)) continue;
      if (isPackageSegment(segments.map(s => s.toLowerCase()), i)) continue;
      first.set(kind, seg);
    }
  }
  for (const [kind] of PRECEDENCE) {
    if (first.has(kind)) return { kind, segment: first.get(kind), reason: `below a directory named \`${first.get(kind)}\`` };
  }
  return backupOf(clean, segments, dirCount, wants) || OWN;
}
