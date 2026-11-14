/**
 * File kinds, stage 2 (specs/100-file-kinds): every validator asks the shared
 * classifier, so a copy of a file never stands in for this project's own and
 * never hides one. One test per defect (D2, D3, D4, D6, D8, D9) and for
 * walkers skipping a nested checkout (T022). Each fixture is built so the
 * defect shows on the CLI from before the change.
 *
 * @req docguard.file-kinds#FR-005
 * @req docguard.file-kinds#FR-012
 * @req docguard.file-kinds#FR-013
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { makeTempDir } from './helpers/temp-dir.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { validateReferenceExistence } from '../cli/validators/reference-existence.mjs';
import { validateStructure, validateDocSections } from '../cli/validators/structure.mjs';
import { validateCrossReferences } from '../cli/validators/cross-reference.mjs';
import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';
import { llmsDocSet } from '../cli/commands/llms.mjs';
import { detectCanonicalLayout, resolveDocRole } from '../cli/shared-doc-roles.mjs';
import { roleDocument } from '../cli/shared-doc-role-hint.mjs';
import { listCanonicalDocs, walkFiles } from '../cli/shared-ignore.mjs';
import { clearFileKindCache, fileKind, inDocumentationDirectory } from '../cli/shared-file-kind.mjs';
import { isGeneratedPath } from '../cli/shared-source.mjs';
import { backupDocuments, backupLeftovers } from '../cli/shared-backup-documents.mjs';
import { computeFileKinds } from '../cli/commands/guard.mjs';

const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
const project = (t, files = {}) => {
  clearFileKindCache();
  const dir = makeTempDir('docguard-kinds2-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, b] of Object.entries(files)) write(dir, p, b);
  return dir;
};
const gitRepo = (dir) => {
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
};
const commit = (dir, message) => { fixtureGit(dir, ['add', '-A']); fixtureGit(dir, ['commit', '-q', '-m', message]); };

describe('D2: a fixture copy never hides a stale reference (REF001)', () => {
  const build = (t, copyPath) => {
    const dir = project(t, {
      'src/api.mjs': 'export function legacyTokenCheck(t) { return t; }\nexport function keepMe() {}\n',
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nTokens go through `legacyTokenCheck`. See also `keepMe`.\n',
    });
    gitRepo(dir);
    commit(dir, 'initial');
    // The real function is removed; a copy of the old code stays where a copy lives.
    write(dir, 'src/api.mjs', 'export function keepMe() {}\n');
    write(dir, copyPath, 'export function legacyTokenCheck(t) { return t; }\n');
    commit(dir, 'remove legacyTokenCheck, keep a copy');
    return dir;
  };
  const stale = dir => validateReferenceExistence(dir, {}).findings.filter(f => f.code === 'REF001').map(f => f.message);

  for (const copy of ['tests/fixtures/old-app/api.mjs', 'examples/old-app/api.mjs', 'templates/app/src/api.mjs', 'Fixtures/old-app/api.mjs']) {
    it(`still reports the removed function when the only definition is ${copy}`, t => {
      const hits = stale(build(t, copy));
      assert.equal(hits.length, 1, JSON.stringify(hits));
      assert.match(hits[0], /legacyTokenCheck/);
    });
  }

  it('does not report it when a real source file still defines it', t => {
    const dir = build(t, 'tests/fixtures/old-app/api.mjs');
    write(dir, 'src/legacy.mjs', 'export function legacyTokenCheck(t) { return t; }\n');
    commit(dir, 'restore');
    assert.deepEqual(stale(dir), []);
  });

  it('a test of the project is code: it keeps a reference alive', t => {
    const dir = build(t, 'tests/helpers/legacy.mjs');
    assert.deepEqual(stale(dir), []);
  });

  it('fileKinds.own brings an examples/ package back as code', t => {
    const dir = build(t, 'examples/old-app/api.mjs');
    assert.deepEqual(validateReferenceExistence(dir, { fileKinds: { own: ['examples/**'] } }).findings.filter(f => f.code === 'REF001'), []);
  });
});

describe('D3: an archived copy never stands in for a missing role document', () => {
  it('STR001 and STR003 read the same path: the archive copy is neither adopted nor checked', t => {
    const dir = project(t, { 'docs-canonical/archive/SECURITY.md': '# Security\n\nOld text.\n' });
    const config = { requiredFiles: { canonical: ['docs-canonical/SECURITY.md'], agentFile: [], driftLog: 'DRIFT-LOG.md' } };
    assert.equal(resolveDocRole(dir, config, 'security'), join(dir, 'docs-canonical/SECURITY.md'));
    const missing = validateStructure(dir, config).findings.filter(f => f.code === 'STR001' && /SECURITY/.test(f.location)).map(f => f.location);
    assert.deepEqual(missing, ['docs-canonical/SECURITY.md']);
    const sections = validateDocSections(dir, config).findings.map(f => f.location);
    assert.deepEqual(sections.filter(l => /archive/.test(l)), [], 'STR003 must not check the archive copy');
  });

  it('a backup-named copy next to nothing is not adopted either', t => {
    const dir = project(t, { 'docs-canonical/03-security/SECURITY copy.md': '# Security\n' });
    assert.equal(resolveDocRole(dir, { requiredFiles: { canonical: [] } }, 'security'), join(dir, 'docs-canonical/SECURITY.md'));
  });

  it('a unique nested document is still adopted', t => {
    const dir = project(t, { 'docs-canonical/03-security/SECURITY.md': '# Security\n' });
    assert.equal(resolveDocRole(dir, { requiredFiles: { canonical: [] } }, 'security'), join(dir, 'docs-canonical/03-security/SECURITY.md'));
  });
});

describe('D4: a template, fixture, test, vendored, generated, backup or nested document is never proposed as the canonical one', () => {
  const pair = prefix => ({ [`${prefix}/docs/ARCHITECTURE.md`]: '# Architecture\n', [`${prefix}/docs/SECURITY.md`]: '# Security\n' });

  for (const prefix of ['examples/demo', 'templates/app', 'tests/fixtures/app', 'vendor/lib', 'dist/site', 'docs/archive', 'Examples/Demo', 'out/site']) {
    it(`detectCanonicalLayout does not list ${prefix}`, t => {
      const dir = project(t, pair(prefix));
      assert.deepEqual(detectCanonicalLayout(dir).map(h => h.dir), []);
    });
  }

  it('a nested checkout is not listed', t => {
    const dir = project(t, { ...pair('other'), 'other/.git': 'gitdir: ../.git/modules/other\n' });
    assert.deepEqual(detectCanonicalLayout(dir).map(h => h.dir), []);
  });

  it('a project folder is still found', t => {
    const dir = project(t, { ...pair('docs/canonical'), ...pair('examples/demo') });
    assert.deepEqual(detectCanonicalLayout(dir).map(h => h.dir), ['docs/canonical/docs']);
  });

  it('the role hint does not point at a document under examples or templates', t => {
    const dir = project(t, { ...pair('examples/demo'), 'templates/ARCHITECTURE.md': '# Architecture\n' });
    const hint = roleDocument(dir, { requiredFiles: { canonical: [] } }, 'architecture');
    assert.equal(hint.elsewhere, null, hint.lead);
    assert.doesNotMatch(hint.lead + hint.tail, /examples|templates/);
  });

  it('the role hint still points at the project\'s own document', t => {
    const dir = project(t, { 'docs/architecture/ARCHITECTURE.md': '# Architecture\n', 'examples/demo/ARCHITECTURE.md': '# Architecture\n' });
    assert.equal(roleDocument(dir, { requiredFiles: { canonical: [] } }, 'architecture').elsewhere, 'docs/architecture/ARCHITECTURE.md');
  });
});

describe('D6 and D9: a backup-named document is not read as a document and is not listed by llms', () => {
  const files = {
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nSee [data](DATA-MODEL.md).\n',
    'docs-canonical/DATA-MODEL.md': '# Data model\n',
    'docs-canonical/ARCHITECTURE copy.md': '# Architecture\n\nSee [gone](MISSING-ONE.md).\n',
    'docs-canonical/ARCHITECTURE-old.md': '# Architecture\n',
    'docs-canonical/ARCHITECTURE (1).md': '# Architecture\n',
    'docs-canonical/SECURITY.md.bak': '# Security\n',
    'docs-canonical/archive/OLD.md': '# Old\n\nSee [gone](MISSING-TWO.md).\n',
  };

  it('listCanonicalDocs leaves the backups out', t => {
    const dir = project(t, files);
    assert.deepEqual(listCanonicalDocs(dir).map(d => d.rel), ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/DATA-MODEL.md']);
  });

  it('XRF001 is not raised from a backup', t => {
    const dir = project(t, files);
    const hits = validateCrossReferences(dir, {}).findings.filter(f => f.code === 'XRF001');
    assert.deepEqual(hits, []);
  });

  it('docguard llms does not list a backup', t => {
    const dir = project(t, files);
    assert.deepEqual(llmsDocSet(dir).filter(d => d.canonical).map(d => d.path), ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/DATA-MODEL.md']);
  });

  it('fileKinds.own brings a backup-named document back', t => {
    const dir = project(t, files);
    const own = listCanonicalDocs(dir, { config: { fileKinds: { own: ['docs-canonical/ARCHITECTURE copy.md'] } } }).map(d => d.rel);
    assert.ok(own.includes('docs-canonical/ARCHITECTURE copy.md'));
  });
});

describe('D6 and D8: TODO tracking reads this project\'s code only', () => {
  const todo = '// TODO: finish the retry loop before the release\nexport const x = 1;\n';
  const todos = dir => validateTodoTracking(dir, {}).findings.filter(f => /^TDO00[23]$/.test(f.code) && f.location).map(f => f.location.split(':')[0]).sort();

  it('flags src/ and nothing in a template, fixture, example or nested checkout', t => {
    const dir = project(t, {
      'src/a.mjs': todo,
      'templates/app/b.mjs': todo,
      'Fixtures/d.mjs': todo,
      'examples/demo/e.mjs': todo,
      'vendored-checkout/f.mjs': todo,
      'vendored-checkout/.git': 'gitdir: ../.git/modules/x\n',
    });
    assert.deepEqual(todos(dir), ['src/a.mjs']);
  });

  it('a backup folder is not in the vocabulary for code: backup/ is read as code unless it is a kind', t => {
    // `backup` is a directory name only inside a documentation directory (spec 100); outside it, code in a folder
    // of that name is the project's own and is read.
    const dir = project(t, { 'src/a.mjs': todo, 'backup/c.mjs': todo });
    assert.deepEqual(todos(dir), ['backup/c.mjs', 'src/a.mjs']);
  });

  it('does not read build output: out/ and target/ (D8)', t => {
    const dir = project(t, { 'src/a.mjs': todo, 'out/b.mjs': todo, 'target/c.mjs': todo, 'obj/d.mjs': todo });
    assert.deepEqual(todos(dir), ['src/a.mjs']);
  });

  it('skipped tests are still read in the project\'s own tests, not in a fixture', t => {
    const skip = "import test from 'node:test';\ntest.skip('later', () => {});\n";
    const dir = project(t, { 'tests/own.test.mjs': skip, 'tests/fixtures/app/x.test.mjs': skip });
    const hits = validateTodoTracking(dir, {}).findings.filter(f => f.code === 'TDO001').map(f => f.location.split(':')[0]);
    assert.deepEqual(hits, ['tests/own.test.mjs']);
  });

  it('fileKinds.own rescues an examples/ package', t => {
    const dir = project(t, { 'examples/demo/e.mjs': todo });
    const hits = validateTodoTracking(dir, { fileKinds: { own: ['examples/**'] } }).findings.filter(f => f.code === 'TDO002');
    assert.equal(hits.length, 1);
  });
});

describe('T022: a walker never walks a nested checkout', () => {
  const tree = { 'a.txt': 'a', 'sub/b.txt': 'b', 'checkout/c.txt': 'c', 'checkout/.git': 'gitdir: elsewhere\n', 'deep/inner/d.txt': 'd', 'deep/inner/.git/HEAD': 'ref: x\n' };
  const walked = (dir, opts) => { const out = []; walkFiles(dir, f => out.push(f.slice(dir.length + 1)), opts); return out.sort(); };

  it('skips a directory that holds .git and everything below it', t => {
    const dir = project(t, tree);
    assert.deepEqual(walked(dir), ['a.txt', 'sub/b.txt']);
  });

  it('the root itself may hold .git', t => {
    const dir = project(t, { ...tree, '.git/HEAD': 'ref: x\n' });
    assert.deepEqual(walked(dir), ['a.txt', 'sub/b.txt']);
  });

  it('nestedCheckouts: false reads it (the security validator keeps reporting secrets in a copy)', t => {
    const dir = project(t, tree);
    assert.deepEqual(walked(dir, { nestedCheckouts: false, skipDotEntries: true }), ['a.txt', 'checkout/c.txt', 'deep/inner/d.txt', 'sub/b.txt']);
  });

  it('skipKinds leaves a kind out, and fileKinds.own rescues a path', t => {
    const dir = project(t, { 'src/a.js': 'a', 'templates/t.js': 't', 'examples/e/x.js': 'x', 'examples/f/y.js': 'y' });
    assert.deepEqual(walked(dir, { skipKinds: ['template', 'fixture'] }), ['src/a.js']);
    assert.deepEqual(walked(dir, { skipKinds: ['template', 'fixture'], config: { fileKinds: { own: ['examples/e/**'] } } }), ['examples/e/x.js', 'src/a.js']);
  });

  it('every command and scanner that walks the tree goes through it (the registry has no allowlist)', async () => {
    const { readFileSync } = await import('node:fs');
    const registry = readFileSync(new URL('./file-kinds-registry.test.mjs', import.meta.url), 'utf8');
    assert.match(registry, /const ALLOWLIST = \{\s*\};/);
  });
});

describe('the generated kind also reads file names (isGeneratedPath joins it)', () => {
  it('a build artifact is generated by name and code only', () => {
    for (const name of ['app.min.js', 'src/vendor.bundle.js', 'x/chunk.chunk.mjs', 'api-generated.ts', 'types.d.ts']) {
      assert.equal(fileKind(name, {}).kind, 'generated', name);
      assert.equal(isGeneratedPath(name), true, name);
    }
    for (const name of ['src/app.js', 'docs/api-generated.md', 'README.md']) assert.notEqual(fileKind(name, {}).kind, 'generated', name);
  });
});

describe('FR-013: a backup-named document in a documentation directory is a warning', () => {
  const files = {
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n',
    'docs-canonical/ARCHITECTURE.md.bak': '# Architecture\n',
    'docs/guide/SECURITY copy.md': '# Security\n',
    'docs/archive/OLD-PLAN.md': '# Old plan\n',
    'Starting_files/onboarding (1).md': '# Download\n',
    'README copy.md': '# Readme\n',
    'tests/fixtures/app/docs/X.md.bak': '# fixture\n',
    'templates/app/docs/Y copy.md': '# template\n',
  };
  const structureConfig = { requiredFiles: { canonical: [], agentFile: [], driftLog: 'DRIFT-LOG.md' } };

  it('names the backup-named documents in documentation directories, not an archive and not a download folder', t => {
    const dir = project(t, files);
    assert.deepEqual(backupLeftovers(dir, {}), ['docs-canonical/ARCHITECTURE.md.bak', 'docs/guide/SECURITY copy.md']);
    assert.deepEqual(backupDocuments(dir, {}).map(d => `${d.by}:${d.path}`), ['name:docs-canonical/ARCHITECTURE.md.bak', 'folder:docs/archive/OLD-PLAN.md', 'name:docs/guide/SECURITY copy.md']);
  });

  it('inDocumentationDirectory stops at a dot directory and needs an ancestor', () => {
    assert.equal(inDocumentationDirectory('docs/a/b.md'), true);
    assert.equal(inDocumentationDirectory('Docs/b.md'), true);
    assert.equal(inDocumentationDirectory('.claude/docs/b.md'), false);
    assert.equal(inDocumentationDirectory('docs'), false);
    assert.equal(inDocumentationDirectory('src/b.md'), false);
  });

  it('STR008 is raised per file, with no check added to the counts', t => {
    const dir = project(t, files);
    const hits = validateStructure(dir, structureConfig).findings.filter(f => f.code === 'STR008');
    assert.deepEqual(hits.map(h => h.location), ['docs-canonical/ARCHITECTURE.md.bak', 'docs/guide/SECURITY copy.md']);
    assert.equal(hits[0].severity, 'warn');
    const clean = project(t, { 'docs-canonical/ARCHITECTURE.md': '# A\n' });
    const base = validateStructure(clean, structureConfig);
    const withBackup = validateStructure(project(t, { 'docs-canonical/ARCHITECTURE.md': '# A\n', 'docs-canonical/ARCHITECTURE.md.bak': '# A\n' }), structureConfig);
    assert.equal(withBackup.total, base.total);
    assert.equal(withBackup.passed, base.passed);
  });

  it('caps the list at ten and says how many more', t => {
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`docs/D${i} copy.md`, '# d\n']));
    const hits = validateStructure(project(t, many), structureConfig).findings.filter(f => f.code === 'STR008');
    assert.equal(hits.length, 11);
    assert.match(hits[10].message, /and 3 more/);
  });

  it('.docguardignore-style ignore and fileKinds.own silence it', t => {
    const dir = project(t, files);
    assert.deepEqual(backupLeftovers(dir, { ignore: ['docs-canonical/*.bak'] }), ['docs/guide/SECURITY copy.md']);
    assert.deepEqual(backupLeftovers(dir, { fileKinds: { own: ['docs/guide/SECURITY copy.md'] } }), ['docs-canonical/ARCHITECTURE.md.bak']);
  });

  it('files.kinds.excluded.backup lists every document left out, the archive too', t => {
    const dir = project(t, files);
    gitRepo(dir);
    commit(dir, 'files');
    const kinds = computeFileKinds(dir, {});
    assert.deepEqual(kinds.excluded.backup, ['docs-canonical/ARCHITECTURE.md.bak', 'docs/archive/OLD-PLAN.md', 'docs/guide/SECURITY copy.md']);
    assert.ok(kinds.counts.backup >= 3);
  });
});
