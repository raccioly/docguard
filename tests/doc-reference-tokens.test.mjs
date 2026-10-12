/**
 * Doc references match whole file names (specs/075-whole-token-doc-references):
 * `b.mjs` is not named by `hub.mjs`, in any consumer of the shared matcher.
 *
 * @req docguard.whole-token-doc-references#FR-001
 * @req docguard.whole-token-doc-references#FR-002
 * @req docguard.whole-token-doc-references#FR-003
 * @req docguard.whole-token-doc-references#FR-004
 * @req docguard.whole-token-doc-references#FR-005
 * @req docguard.whole-token-doc-references#FR-006
 * @req docguard.whole-token-doc-references#SC-001
 * @req docguard.whole-token-doc-references#SC-002
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { referenceKind, docsForPath, AGENT_FILES } from '../cli/scanners/doc-references.mjs';
import { computeDocConflicts } from '../cli/commands/impact.mjs';
import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { listTrackedFiles } from '../cli/shared-git.mjs';
import { instructionKind } from '../cli/scanners/instruction-scopes.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-tokens-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  fixtureGit(dir, ['init', '-q']);
  commit(dir, 'init');
  return dir;
}

function commit(dir, msg) {
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
}

function cli(dir, args) {
  const r = spawnSync('node', [CLI, ...args, '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
  return JSON.parse(r.stdout);
}

const CONFIG = JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' });

// The reported fixture: b imports a; SECURITY.md names only hub.mjs, whose
// name ends with `b.mjs`. ARCHITECTURE.md really names b, the neighbouring
// valid case that must keep matching.
const HUB = {
  'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
  '.docguard.json': CONFIG,
  'src/a.mjs': 'export const a = 1;\n',
  'src/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n",
  'src/hub.mjs': 'export const hub = 1;\n',
  'docs-canonical/SECURITY.md': '# Security\n\nThe gateway lives in `src/hub.mjs`.\n',
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n`src/b.mjs` re-exports the constant.\n',
  'AGENTS.md': '# Agents\n\nNever edit src/hub.mjs by hand.\n',
};

describe('whole-token doc references — names inside longer names (FR-001, US1)', () => {
  const cases = [
    ['The gateway lives in `src/hub.mjs`.', 'src/b.mjs', null],
    ['Run `cli/impact.test.mjs` first.', 'tests/test.mjs', null],
    ['See tests/test_foo.py for the cases.', 'foo.py', null],
    ['Owned by src/user-service.ts.', 'src/service.ts', null],
    ['Settings live in config.json.', 'src/config.js', null],
    ['Renders `src/index.tsx`.', 'src/index.ts', null],
    ['An old copy is kept as b.mjs.bak.', 'src/b.mjs', null],
    ['The page is routes/+page.svelte.', 'src/page.svelte', null],
    ['Loader: app/routes/posts.$id.tsx', 'app/id.tsx', null],
    // A path inside a longer path is not a path match; its basename still is.
    ['Moved to othersrc/a.mjs.', 'src/a.mjs', 'basename'],
  ];
  for (const [line, file, kind] of cases) {
    it(`${JSON.stringify(line)} → ${file}: ${kind}`, () => {
      assert.equal(referenceKind(line, file), kind);
    });
  }
});

describe('whole-token doc references — every real form still matches (FR-001, FR-002, US2)', () => {
  const file = 'src/b.mjs';
  const cases = [
    ['src/b.mjs', 'path'],
    ['Start at ./src/b.mjs', 'path'],
    ['See `src/b.mjs`.', 'path'],
    ['The [b.mjs](src/b.mjs) module.', 'path'],
    ['https://github.com/o/r/blob/main/src/b.mjs', 'path'],
    ['A vendored copy: lib/src/b.mjs', 'path'],
    ['b.mjs', 'basename'],
    ['**b.mjs** owns the export.', 'basename'],
    ['| b.mjs | the b module |', 'basename'],
    ['Edit "b.mjs" and (b.mjs) and <b.mjs>.', 'basename'],
    ['At b.mjs:12 and b.mjs#L3.', 'basename'],
    ['b.mjs, a.mjs and c.mjs', 'basename'],
    ['See b.mjs.', 'basename'],
    ['See b.mjs...', 'basename'],
    ["b.mjs's exports", 'basename'],
    ['Windows: src\\b.mjs', 'basename'],
    ['参见b.mjs文件', 'basename'],
    ['The `b` module.', 'module'],
  ];
  for (const [line, kind] of cases) {
    it(`${JSON.stringify(line)}: ${kind}`, () => {
      assert.equal(referenceKind(line, file), kind);
    });
  }
});

describe('whole-token doc references — every consumer (FR-003, FR-005, SC-001)', () => {
  it('impact: a change to src/a.mjs flags only the doc that names its importer', () => {
    const dir = makeRepo(HUB);
    writeFileSync(join(dir, 'src/a.mjs'), 'export const a = 2;\n');
    commit(dir, 'change a');
    const data = cli(dir, ['diff', '--since', 'HEAD~1']);
    assert.deepEqual(data.affectedDocs, []);
    assert.deepEqual(data.indirectDocs.map(d => d.doc), ['ARCHITECTURE.md'],
      `hub.mjs does not name b.mjs; got ${JSON.stringify(data.indirectDocs)}`);
    assert.deepEqual(data.indirectDocs[0].chains, [{ changed: 'src/a.mjs', via: 'src/b.mjs', hops: 1 }]);
  });

  it('impact: a change to src/b.mjs directly affects only the doc that names it', () => {
    const dir = makeRepo(HUB);
    writeFileSync(join(dir, 'src/b.mjs'), "import { a } from './a.mjs';\nexport const b = a + 1;\n");
    commit(dir, 'change b');
    const data = cli(dir, ['diff', '--since', 'HEAD~1']);
    assert.deepEqual(data.affectedDocs.map(d => d.doc), ['ARCHITECTURE.md']);
  });

  it('trace --reverse and docguard_docs_for_path agree: only ARCHITECTURE.md names src/b.mjs', () => {
    const dir = makeRepo(HUB);
    const trace = cli(dir, ['trace', '--reverse', 'src/b.mjs']);
    assert.deepEqual(trace.matches.map(m => [m.doc, m.line, m.kind]), [['docs-canonical/ARCHITECTURE.md', 3, 'path']]);
    const tool = docsForPath(dir, {}, 'src/b.mjs');
    assert.deepEqual(tool.references.items.map(r => [r.doc, r.line, r.kind]), [['docs-canonical/ARCHITECTURE.md', 3, 'path']]);
    assert.equal(tool.agentInstructions.total, 0, 'AGENTS.md names hub.mjs, not b.mjs');
  });

  it('impact --prs: PRs touching b.mjs and hub.mjs do not conflict through SECURITY.md', () => {
    const docsIndex = new Map([
      ['SECURITY.md', ['# Security', 'The gateway lives in `src/hub.mjs`.']],
    ]);
    const { prImpacts, conflicts } = computeDocConflicts([
      { number: 1, title: 'b', files: ['src/b.mjs'] },
      { number: 2, title: 'hub', files: ['src/hub.mjs'] },
    ], docsIndex);
    assert.deepEqual(prImpacts.map(p => p.docs), [[], ['SECURITY.md']]);
    assert.deepEqual(conflicts, []);
  });
});

describe('whole-token doc references — doc-to-doc blast radius (FR-004)', () => {
  it('a changed SPEC.md flags the doc that names it, not the one that names TEST-SPEC.md', () => {
    const dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
      '.docguard.json': CONFIG,
      'docs-canonical/SPEC.md': '# Spec\n\nThe product.\n',
      'docs-canonical/TEST-SPEC.md': '# Test spec\n\nThe tests.\n',
      'docs-canonical/GUIDE.md': '# Guide\n\nTest plans live in TEST-SPEC.md.\n',
      'docs-canonical/OVERVIEW.md': '# Overview\n\nSee [the spec](SPEC.md).\n',
    });
    writeFileSync(join(dir, 'docs-canonical/SPEC.md'), '# Spec\n\nThe product, revised.\n');
    commit(dir, 'revise spec');
    const data = cli(dir, ['diff', '--since', 'HEAD~1']);
    const edge = data.blastRadius.find(b => b.changedDoc === 'docs-canonical/SPEC.md');
    assert.ok(edge, `expected a blast-radius edge; got ${JSON.stringify(data.blastRadius)}`);
    assert.deepEqual(edge.dependents.map(d => d.doc), ['OVERVIEW.md']);
  });
});

describe('documented (FR-006)', () => {
  const read = rel => readFileSync(resolve(rel), 'utf8');
  it('docs/commands.md says trace --reverse matches a path or basename only as a whole file name', () => {
    const text = read('docs/commands.md');
    assert.match(text, /A path or basename counts only as a whole file name: `src\/b\.mjs` is not named\nby `hub\.mjs`/);
    assert.match(text, /`diff --since` and the `docguard_docs_for_path` MCP tool use the same matcher\./);
  });
  it('ARCHITECTURE.md says the shared matcher matches whole file names', () => {
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /One reference matcher shared with `trace --reverse` and `impact`; a path or basename matches only as a whole file name/);
  });
});

describe('this repository (SC-002)', () => {
  it('every tracked code file a doc names by its full path is still a path reference', () => {
    const root = resolve('.');
    const tracked = listTrackedFiles(root) || [];
    const code = tracked.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/.test(f));
    const docs = new Set([
      ...listCanonicalDocs(root).map(d => d.abs),
      ...[...AGENT_FILES, ...tracked.filter(f => instructionKind(f))].map(f => resolve(f)).filter(f => existsSync(f)),
    ]);
    // An independent, narrower oracle: the path between the delimiters prose
    // and Markdown use most (backticks, parentheses, brackets, spaces, a URL's /).
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const oracle = new Map(code.map(f => [f, new RegExp(`(?:^|[\\s\x60(\\[/])${esc(f)}(?=$|[\\s\x60)\\]:#,]|\\.(?:\\s|$))`)]));
    let named = 0;
    const lost = [];
    for (const abs of docs) {
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        for (const [file, re] of oracle) {
          if (!line.includes(file) || !re.test(line)) continue;
          named++;
          if (referenceKind(line, file) !== 'path') lost.push(`${file}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    assert.ok(named >= 200, `the oracle should find this repository's path mentions; found ${named}`);
    assert.deepEqual(lost, []);
  });
});
