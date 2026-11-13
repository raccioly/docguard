/**
 * File kinds (specs/100-file-kinds): one answer to "is this file this
 * project's own". The kinds are a closed list, unknown is always `own`, and
 * the vocabulary is whole path segments matched without regard to case.
 *
 * @req docguard.file-kinds#FR-001
 * @req docguard.file-kinds#FR-002
 * @req docguard.file-kinds#FR-003
 * @req docguard.file-kinds#FR-004
 * @req docguard.file-kinds#FR-005
 * @req docguard.file-kinds#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { makeTempDir } from './helpers/temp-dir.mjs';
import {
  FILE_KINDS, FIXTURE_DIRS, GENERATED_DIRS, TEMPLATE_DIRS, VENDORED_DIRS, fileKind,
} from '../cli/shared-file-kind.mjs';
import { DEFAULT_DETECTION_IGNORE_DIRS, isNonProductDir, isNonProductPath, isPackageSegment } from '../cli/shared-ignore.mjs';

const kindOf = (path, config, opts) => fileKind(path, config, opts).kind;
const cases = word => [word, word.toUpperCase(), word[0].toUpperCase() + word.slice(1)];

describe('FR-001 — the closed list of kinds', () => {
  it('names exactly seven kinds', () => {
    assert.deepEqual([...FILE_KINDS], ['own', 'template', 'fixture', 'vendored', 'generated', 'backup', 'nested-checkout']);
    assert.ok(Object.isFrozen(FILE_KINDS));
  });

  it('returns kind, segment and reason; every answer is in the list', () => {
    for (const p of ['AGENTS.md', 'src/a.js', 'templates/a/AGENTS.md', 'tests/x.js', 'node_modules/a/b.js', 'dist/a.js', 'docs/ARCHITECTURE copy.md']) {
      const r = fileKind(p, {});
      assert.ok(FILE_KINDS.includes(r.kind), p);
      assert.equal(typeof r.reason, 'string', p);
      assert.ok(r.segment === null || typeof r.segment === 'string', p);
    }
    assert.deepEqual(fileKind('src/a.js', {}), { kind: 'own', segment: null, reason: 'nothing in the vocabulary matches' });
  });

  it('unknown is always own, including odd input', () => {
    for (const p of ['src/lib/util.js', 'docs/guide.md', 'demo/app.js', 'seed/data.json', 'content/post.md', 'public/a.png', 'assets/b.svg', 'legacy/old.js', 'baseline/a.json']) assert.equal(kindOf(p, {}), 'own', p);
    for (const p of [null, undefined, '', 42, {}]) assert.equal(kindOf(p, {}), 'own');
    assert.equal(kindOf('templates/a.js', null), 'template');
  });
});

describe('FR-001 — every vocabulary word, in lower, upper and mixed case', () => {
  const nested = (word, file) => `apps/web/${word}/app/${file}`;
  for (const [set, kind] of [[TEMPLATE_DIRS, 'template'], [FIXTURE_DIRS, 'fixture'], [VENDORED_DIRS, 'vendored'], [GENERATED_DIRS, 'generated']]) {
    it(`${kind}: each word classifies in every case, and reports the segment as written`, () => {
      for (const word of set) {
        if (word.startsWith('.')) continue; // dot directories are the harness cutoff's business
        for (const variant of cases(word)) {
          const r = fileKind(nested(variant, 'x.js'), {});
          // `example(s)` / `sample(s)` after a reverse-domain root are packages; "apps/web" is not one.
          assert.equal(r.kind, kind, `${variant}`);
          assert.equal(r.segment, variant);
        }
      }
    });
  }

  it('the vocabulary sets are disjoint and frozen', () => {
    const all = [...TEMPLATE_DIRS, ...FIXTURE_DIRS, ...VENDORED_DIRS, ...GENERATED_DIRS];
    assert.equal(new Set(all).size, all.length);
    for (const s of [TEMPLATE_DIRS, FIXTURE_DIRS, VENDORED_DIRS, GENERATED_DIRS]) assert.ok(Object.isFrozen(s));
  });

  it('the template vocabulary is the designed one', () => {
    assert.deepEqual([...TEMPLATE_DIRS].sort(), ['_templates', '__templates__', 'boilerplate', 'boilerplates', 'scaffold', 'scaffolds', 'skeleton', 'skeletons', 'starter-kit', 'starter-kits', 'template', 'templates'].sort());
  });

  it('the fixture vocabulary is today\'s detection set plus corpus and golden', () => {
    const before = ['fixtures', '__fixtures__', 'test-fixtures', 'testfixtures', 'testdata', 'test', 'tests', '__tests__', 'test-helpers', 'spec', 'specs', '__mocks__', 'mocks', 'examples', 'example', 'sample', 'samples'];
    assert.deepEqual([...FIXTURE_DIRS].sort(), [...before, 'corpus', 'golden'].sort());
    assert.deepEqual([...DEFAULT_DETECTION_IGNORE_DIRS].sort(), [...FIXTURE_DIRS].sort());
  });

  it('directory names the survey found real product in are not kinds', () => {
    for (const w of ['demo', 'seed', 'baseline', 'content', 'public', 'assets', 'legacy', 'archive', 'backup']) assert.equal(kindOf(`src/${w}/x.js`, {}), 'own', w);
  });

  it('only whole segments count', () => {
    for (const p of ['src/mytemplates/a.js', 'src/templates-x/a.js', 'src/contest/a.js', 'src/fixturesque/a.js', 'src/examplesx/a.js']) assert.equal(kindOf(p, {}), 'own', p);
  });

  it('D5: Examples/ and Fixtures/ are recognized like examples/ and fixtures/', () => {
    assert.equal(kindOf('Examples/x/AGENTS.md', {}), 'fixture');
    assert.equal(kindOf('Fixtures/f/AGENTS.md', {}), 'fixture');
    assert.equal(kindOf('Templates/App/AGENTS.md', {}), 'template');
  });
});

describe('FR-002 — dot segments, package segments, precedence', () => {
  it('a segment after the first dot-directory does not count', () => {
    for (const p of ['.claude/skills/templates/SKILL.md', '.cursor/rules/fixtures/x.mdc', '.agents/examples/a.md', '.github/templates/ISSUE.md']) assert.equal(kindOf(p, {}), 'own', p);
    assert.equal(kindOf('apps/web/templates/base/.claude/rules/a.md', {}), 'template');
    assert.equal(kindOf('templates/x/.claude/rules/a.md', {}), 'template');
  });

  it("harnessFolders: 'all' turns the cutoff off", () => {
    assert.equal(kindOf('.agent/skills/x/tests/y.js', {}, { harnessFolders: 'all' }), 'fixture');
    assert.equal(kindOf('.agent/skills/x/tests/y.js', {}), 'own');
  });

  it('a package segment is not a directory of examples, in any case', () => {
    for (const p of ['src/main/java/com/example/A.java', 'src/main/java/com/Example/A.java', 'src/main/kotlin/org/Samples/B.kt', 'internal/example/x.go', 'internal/Example/x.go', 'src/main/java/anything/deep/Tests/C.java']) assert.equal(kindOf(p, {}), 'own', p);
    assert.equal(kindOf('src/test/java/com/example/A.java', {}), 'fixture');
    assert.equal(isPackageSegment(['com', 'Example'], 1), true);
    assert.equal(isPackageSegment(['SRC', 'MAIN', 'JAVA', 'x'], 3), true);
  });

  it('when several segments qualify a template outranks a fixture, then vendored and generated', () => {
    assert.deepEqual(fileKind('tests/templates/a/AGENTS.md', {}), { kind: 'template', segment: 'templates', reason: 'below a directory named `templates`' });
    assert.equal(kindOf('vendor/tests/a.js', {}), 'fixture');
    assert.equal(kindOf('dist/vendor/a.js', {}), 'vendored');
    assert.equal(kindOf('dist/a.js', {}), 'generated');
  });

  it('kinds restricts the answer to the listed kinds', () => {
    assert.equal(kindOf('tests/templates/a.js', {}, { kinds: ['fixture'] }), 'fixture');
    assert.equal(kindOf('vendor/a.js', {}, { kinds: ['fixture'] }), 'own');
    assert.equal(kindOf('vendor/a.js', {}, { kinds: ['vendored', 'generated'] }), 'vendored');
  });

  it('a root file is never a copy', () => {
    for (const p of ['AGENTS.md', 'README.md', 'templates', 'tests']) assert.equal(kindOf(p, {}, { describesFolder: true }), 'own', p);
    assert.equal(kindOf('AGENTS.md', {}), 'own');
  });

  it('symlinks are classified by the path they are listed under, and nothing is read', t => {
    const dir = makeTempDir('dg-kinds-', t);
    assert.equal(kindOf('templates/link.md', {}, { root: dir }), 'template');
  });
});

describe('FR-003 — the folder that holds the file', () => {
  it('describesFolder: the holding folder does not count', () => {
    assert.equal(kindOf('templates/AGENTS.md', {}, { describesFolder: true }), 'own');
    assert.equal(kindOf('packages/templates/AGENTS.md', {}, { describesFolder: true }), 'own');
    assert.equal(kindOf('tests/AGENTS.md', {}, { describesFolder: true }), 'own');
    assert.equal(kindOf('examples/README.md', {}, { describesFolder: true }), 'own');
    assert.equal(kindOf('templates/app/files/AGENTS.md', {}, { describesFolder: true }), 'template');
    assert.equal(kindOf('tests/fixtures/repo/AGENTS.md', {}, { describesFolder: true }), 'fixture');
    assert.equal(kindOf('examples/demo/README.md', {}, { describesFolder: true }), 'fixture');
  });

  it('otherwise every ancestor counts: fixtures/old.js is a fixture', () => {
    assert.equal(kindOf('fixtures/old.js', {}), 'fixture');
    assert.equal(kindOf('templates/AGENTS.md', {}), 'template');
    assert.equal(kindOf('templates/new.js', {}, { describesFolder: false }), 'template');
  });
});

describe('FR-004 — fileKinds.own', () => {
  it('forces own for a matching path, below any vocabulary', () => {
    const config = { fileKinds: { own: ['examples/real-pkg/**', 'templates/app/files/AGENTS.md'] } };
    assert.equal(kindOf('examples/real-pkg/src/a.js', config), 'own');
    assert.equal(kindOf('templates/app/files/AGENTS.md', config, { describesFolder: true }), 'own');
    assert.equal(kindOf('examples/other/a.js', config), 'fixture');
    assert.equal(kindOf('examples/real-pkg/a.js', config, { harnessFolders: 'all' }), 'own');
  });

  it('a real product package named examples is rescued by one glob', () => {
    assert.equal(kindOf('examples/package.json', {}), 'fixture');
    assert.equal(kindOf('examples/package.json', { fileKinds: { own: ['examples/**'] } }), 'own');
    assert.equal(isNonProductPath('examples/src/index.js', { fileKinds: { own: ['examples/**'] } }), false);
  });

  it('ignores malformed values and does not mutate the config', () => {
    for (const own of [null, 'examples/**', 7, [null, '', 3], {}]) assert.equal(kindOf('examples/a.js', { fileKinds: { own } }), 'fixture');
    const config = Object.freeze({ fileKinds: Object.freeze({ own: Object.freeze(['examples/**']) }) });
    assert.equal(kindOf('examples/a.js', config), 'own');
  });

  it('a leading ./ in the glob is accepted', () => {
    assert.equal(kindOf('examples/a.js', { fileKinds: { own: ['./examples/**'] } }), 'own');
  });
});

describe('FR-005 — backup applies to documents only', () => {
  it('recognizes backup file names of documents', () => {
    for (const p of [
      'docs-canonical/ARCHITECTURE.md.bak', 'docs/a.md.orig', 'docs/a.md.backup', 'docs/a.md~',
      'docs-canonical/ARCHITECTURE copy.md', 'docs/ARCHITECTURE (2).md', 'docs/ARCHITECTURE-old.md', 'docs/ARCHITECTURE.old.md',
      'ARCHITECTURE copy.md', 'README (1).md', 'docs/Guide Copy.md', 'docs/GUIDE-OLD.MD',
    ]) {
      const r = fileKind(p, {});
      assert.equal(r.kind, 'backup', p);
      assert.ok(r.segment, p);
    }
  });

  it('never applies to code or non-documents', () => {
    for (const p of ['src/old.js', 'cli/copy.mjs', 'src/a.js.bak', 'src/a.ts~', 'src/util-old.js', 'src/util.old.ts', 'src/a (2).js', 'package.json.bak', 'docs/diagram-old.png', 'src/handler copy.py']) assert.equal(kindOf(p, {}), 'own', p);
  });

  it('a document in a documentation directory below archive, backup, old or deprecated is a backup', () => {
    for (const p of ['docs-canonical/archive/SECURITY.md', 'docs/Archived/a.md', 'docs-implementation/backups/a.md', 'docs/old/guide.md', 'documentation/deprecated/x.md', 'docs/guides/archive/y.md']) assert.equal(kindOf(p, {}), 'backup', p);
    assert.equal(fileKind('docs-canonical/archive/SECURITY.md', {}).segment, 'archive');
  });

  it('those directories mean nothing outside a documentation directory, and never for code', () => {
    for (const p of ['archive/notes.md', 'src/archive/a.js', 'backup/b.md', 'old/c.md', 'docs-canonical/archive/tool.js', 'scripts/deprecated/x.md']) assert.equal(kindOf(p, {}), 'own', p);
  });

  it('a template or fixture directory outranks a backup name', () => {
    assert.equal(kindOf('templates/docs/a copy.md', {}), 'template');
  });

  it('opts.kinds can ask for backups only', () => {
    assert.equal(kindOf('docs/a copy.md', {}, { kinds: ['backup'] }), 'backup');
    assert.equal(kindOf('templates/a copy.md', {}, { kinds: ['backup'] }), 'backup');
    assert.equal(kindOf('docs/a copy.md', {}, { kinds: ['template'] }), 'own');
  });
});

describe('FR-005 — nested checkout', () => {
  const tree = (t, files) => {
    const dir = makeTempDir('dg-kinds-nested-', t);
    for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), 'x'); }
    return dir;
  };

  it('a non-root directory holding a .git file or directory is a nested checkout', t => {
    const dir = tree(t, ['vendor-ish/lib/.git', 'other/.git/HEAD', 'plain/a.js', 'vendor-ish/lib/src/b.js', 'other/c.js']);
    assert.deepEqual(fileKind('vendor-ish/lib/src/b.js', {}, { root: dir }), { kind: 'nested-checkout', segment: 'vendor-ish/lib', reason: '`vendor-ish/lib` holds its own .git entry' });
    assert.equal(kindOf('other/c.js', {}, { root: dir }), 'nested-checkout');
    assert.equal(kindOf('plain/a.js', {}, { root: dir }), 'own');
  });

  it('the project root itself never counts, and without a root nothing touches the disk', t => {
    const dir = tree(t, ['.git/HEAD', 'src/a.js']);
    assert.equal(kindOf('src/a.js', {}, { root: dir }), 'own');
    const other = tree(t, ['x/.git', 'x/a.js']);
    assert.equal(kindOf('x/a.js', {}), 'own');
    assert.equal(kindOf('x/a.js', {}, { root: other }), 'nested-checkout');
  });

  it('fileKinds.own rescues a nested checkout', t => {
    const dir = tree(t, ['x/.git', 'x/a.js']);
    assert.equal(kindOf('x/a.js', { fileKinds: { own: ['x/**'] } }, { root: dir }), 'own');
  });
});

describe('FR-006 — isNonProductPath and isNonProductDir are views of the vocabulary', () => {
  it('keep their meaning, and gain case-insensitivity, corpus and golden', () => {
    assert.equal(isNonProductPath('src/tests/helper.js'), true);
    assert.equal(isNonProductPath('src/components/button.jsx'), false);
    assert.equal(isNonProductPath('Examples/basic/index.js'), true);
    assert.equal(isNonProductPath('Fixtures/a.js'), true);
    assert.equal(isNonProductPath('corpus/a.js'), true);
    assert.equal(isNonProductPath('golden/a.json'), true);
    assert.equal(isNonProductPath('src/main/java/com/example/A.java'), false);
    assert.equal(isNonProductPath('src/main/java/com/Example/A.java'), false);
    assert.equal(isNonProductPath('src/a.js', { detection: { includeNonProduct: true } }), false);
    assert.equal(isNonProductPath(null), false);
  });

  it('a dot-directory does not stop isNonProductPath (it never did)', () => {
    assert.equal(isNonProductPath('.agent/skills/x/tests/y.js'), true);
  });

  it('templates are not non-product for detection (Stage 2 decides per validator)', () => {
    assert.equal(isNonProductPath('templates/app/index.js'), false);
  });

  it('isNonProductDir follows the same vocabulary and case', () => {
    assert.equal(isNonProductDir('Tests'), true);
    assert.equal(isNonProductDir('GOLDEN'), true);
    assert.equal(isNonProductDir('src'), false);
    assert.equal(isNonProductDir('Example', {}, 'src/main/java/com'), false);
    assert.equal(isNonProductDir('example', {}, 'internal'), false);
  });
});
