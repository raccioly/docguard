/**
 * Doc ownership map (specs/034-doc-ownership-map): one responsible doc
 * section per source path, and a linted `.devin/wiki.json`.
 *
 * @req docguard.doc-ownership-map#FR-001
 * @req docguard.doc-ownership-map#FR-002
 * @req docguard.doc-ownership-map#FR-003
 * @req docguard.doc-ownership-map#FR-004
 * @req docguard.doc-ownership-map#FR-005
 * @req docguard.doc-ownership-map#FR-006
 * @req docguard.doc-ownership-map#FR-007
 * @req docguard.doc-ownership-map#FR-008
 * @req docguard.doc-ownership-map#FR-009
 * @req docguard.doc-ownership-map#SC-001
 * @req docguard.doc-ownership-map#SC-002
 * @req docguard.doc-ownership-map#SC-003
 * @req docguard.doc-ownership-map#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEVIN_WIKI, lintDevinWiki, loadOwnership, ownerOf, ownershipReport, resolveOwner,
} from '../cli/scanners/doc-ownership.mjs';
import { validateDocOwnership } from '../cli/validators/doc-ownership.mjs';
import { docsForPath } from '../cli/scanners/doc-references.mjs';
import { suggestCovers } from '../cli/commands/review.mjs';

const CLI = resolve('cli/docguard.mjs');

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

function project(t, files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-own-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
  }
  return dir;
}

const DOCS = {
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Component Map\n\nx\n\n<!-- docguard:section id=api-notes source=human -->\nnotes\n<!-- /docguard:section -->\n',
  'docs-canonical/DATA-MODEL.md': '# Data Model\n\n## Entities\n\nx\n',
};
const THREE_DIRS = {
  ...DOCS,
  'src/api/users.ts': 'export {};\n',
  'src/api/deep/admin.ts': 'export {};\n',
  'src/db/store.ts': 'export {};\n',
  'src/jobs/nightly.ts': 'export {};\n',
  'src/jobs/README.md': '# jobs\n',
};
const entry = (doc, paths, section) => ({ doc, paths, ...(section ? { section } : {}) });
const codes = r => r.findings.map(f => f.code).sort();

describe('resolution is deterministic (FR-002, User Story 2)', () => {
  it('an exact path beats a glob, and a longer literal prefix beats a shorter one', t => {
    const dir = project(t, THREE_DIRS);
    const map = loadOwnership(dir, { ownership: { entries: [
      entry('docs-canonical/ARCHITECTURE.md', ['src/**'], 'component-map'),
      entry('docs-canonical/DATA-MODEL.md', ['src/db/store.ts'], 'entities'),
      entry('docs-canonical/ARCHITECTURE.md', ['src/api/**'], 'api-notes'),
    ] } });
    assert.equal(resolveOwner(map, 'src/db/store.ts').owner.key, 'docs-canonical/DATA-MODEL.md#entities');
    assert.equal(resolveOwner(map, 'src/api/deep/admin.ts').owner.key, 'docs-canonical/ARCHITECTURE.md#api-notes');
    assert.equal(resolveOwner(map, 'src/jobs/nightly.ts').owner.key, 'docs-canonical/ARCHITECTURE.md#component-map');
  });

  it('two equally specific entries are a tie with no owner', t => {
    const dir = project(t, THREE_DIRS);
    const map = loadOwnership(dir, { ownership: { entries: [
      entry('docs-canonical/ARCHITECTURE.md', ['src/api/*.ts']),
      entry('docs-canonical/DATA-MODEL.md', ['src/api/**']),
    ] } });
    const r = resolveOwner(map, 'src/api/users.ts');
    assert.equal(r.owner, null);
    assert.deepEqual(r.tie.map(e => e.doc), ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/DATA-MODEL.md']);
  });

  it('a plain directory owns what is under it', t => {
    const dir = project(t, THREE_DIRS);
    const map = loadOwnership(dir, { ownership: { entries: [entry('docs-canonical/ARCHITECTURE.md', ['src/db'])] } });
    assert.equal(resolveOwner(map, 'src/db/store.ts').owner.matchedBy, 'src/db');
    assert.equal(resolveOwner(map, 'src/dbx/a.ts').owner, null, 'a prefix is a directory, not a string prefix');
  });
});

describe('the validator (SC-001, User Stories 1–3)', () => {
  it('reports the one unowned directory, at its highest level, and nothing else', t => {
    const dir = project(t, THREE_DIRS);
    const r = validateDocOwnership(dir, { ownership: { roots: ['src'], entries: [
      entry('docs-canonical/ARCHITECTURE.md', ['src/api/**'], 'component-map'),
      entry('docs-canonical/DATA-MODEL.md', ['src/db/**'], 'entities'),
    ] } });
    assert.deepEqual(r.findings.map(f => `${f.code} ${f.location}`), ['OWN001 src/jobs']);
  });

  it('fires each code exactly where seeded', t => {
    const dir = project(t, {
      ...THREE_DIRS,
      [DEVIN_WIKI.path]: JSON.stringify({
        repo_notes: [{ content: 'Focus on src/api/ and the old/ folder.' }],
        pages: [{ title: 'API', purpose: 'Explain src/api/users.ts' }, { title: 'API', purpose: 'dup' }],
      }),
    });
    const r = validateDocOwnership(dir, { ownership: { roots: ['src', 'gone'], entries: [
      entry('docs-canonical/ARCHITECTURE.md', ['src/api/*.ts'], 'component-map'),
      entry('docs-canonical/DATA-MODEL.md', ['src/api/**', 'src/db/**'], 'entities'),
      entry('docs-canonical/ARCHITECTURE.md', ['legacy/**'], 'component-map'),
      entry('docs-canonical/SECURITY.md', ['src/db/store.ts']),
      entry('docs-canonical/DATA-MODEL.md', ['src/jobs/**'], 'no-such-anchor'),
    ] } });
    assert.deepEqual(codes(r), ['OWN002', 'OWN003', 'OWN003', 'OWN004', 'OWN004', 'OWN005', 'OWN006']);
    const msg = code => r.findings.filter(f => f.code === code).map(f => f.message).join('\n');
    assert.match(msg('OWN002'), /ARCHITECTURE\.md#component-map and docs-canonical\/DATA-MODEL\.md#entities are equally specific owners of src\/api\/users\.ts/);
    assert.match(msg('OWN003'), /root gone matches no tracked file/);
    assert.match(msg('OWN003'), /"legacy\/\*\*" matches no tracked file/);
    assert.match(msg('OWN004'), /SECURITY\.md does not exist/);
    assert.match(msg('OWN004'), /no section or heading anchor "no-such-anchor"/);
    assert.match(msg('OWN005'), /title "API" repeats pages\[0\]/);
    assert.match(msg('OWN006'), /names old\//);
    assert.doesNotMatch(msg('OWN006'), /src\/api/);
  });

  it('an unreadable block or wiki is an error, never "everything owned" (OWN007)', t => {
    const dir = project(t, { ...THREE_DIRS, [DEVIN_WIKI.path]: '{ not json' });
    const bad = validateDocOwnership(dir, { ownership: { entries: [entry('docs-canonical/ARCHITECTURE.md', ['../outside/**'])] } });
    assert.deepEqual(bad.findings.map(f => [f.code, f.severity]), [['OWN007', 'error'], ['OWN007', 'error']]);
    assert.match(bad.findings[0].message, /not a project-relative path/);
    assert.equal(loadOwnership(dir, { ownership: { entries: 'x' } }).error, 'ownership.entries must be an array');
  });

  it('default roots skip test and example code; a declared root is checked as declared', t => {
    const dir = project(t, { ...DOCS, 'src/a.ts': '', 'src/tests/a.test.ts': '', 'src/examples/demo.ts': '' });
    const own = { entries: [entry('docs-canonical/ARCHITECTURE.md', ['src/a.ts'])] };
    assert.deepEqual(ownershipReport(dir, { ownership: own }).unowned, []);
    assert.deepEqual(ownershipReport(dir, { ownership: { ...own, roots: ['src'] } }).unowned, ['src/examples', 'src/tests']);
  });

  it('ignored paths are never unowned', t => {
    const dir = project(t, { ...THREE_DIRS, '.docguardignore': 'src/jobs/\n' });
    const r = ownershipReport(dir, { ownership: { roots: ['src'], entries: [entry('docs-canonical/ARCHITECTURE.md', ['src/api/**', 'src/db/**'])] } });
    assert.deepEqual(r.unowned, []);
  });

  it('without a block or a wiki the validator is not applicable (FR-007)', t => {
    const dir = project(t, THREE_DIRS);
    const r = validateDocOwnership(dir, {});
    assert.equal(r.applicable, false);
    assert.equal(r.findings.length, 0);
  });
});

describe('the Devin wiki lint (FR-006, User Story 6)', () => {
  const pages = n => Array.from({ length: n }, (_, i) => ({ title: `P${i}`, purpose: 'p' }));

  it('uses the documented limits, with the enterprise page cap configurable', t => {
    const dir = project(t, { [DEVIN_WIKI.path]: JSON.stringify({ repo_notes: [], pages: pages(31) }) });
    assert.match(lintDevinWiki(dir).problems[0].message, /31 pages; Devin allows 30 \(80 on enterprise/);
    assert.deepEqual(lintDevinWiki(dir, { devinWiki: { maxPages: 80 } }).problems, []);
    assert.deepEqual([DEVIN_WIKI.maxPages, DEVIN_WIKI.maxPagesEnterprise, DEVIN_WIKI.maxNotes, DEVIN_WIKI.maxNoteChars, DEVIN_WIKI.checked],
      [30, 80, 100, 10000, '2026-09-30']);
  });

  it('counts repo and page notes together, and note length in characters', t => {
    const note = { content: 'x' };
    const dir = project(t, { [DEVIN_WIKI.path]: JSON.stringify({
      repo_notes: Array(60).fill(note),
      pages: [{ title: 'A', purpose: 'a', page_notes: [...Array(41).fill(note), { content: 'é'.repeat(10001) }] }],
    }) });
    const messages = lintDevinWiki(dir).problems.map(p => p.message);
    assert.ok(messages.some(m => /102 notes across repo_notes and page_notes; Devin allows 100/.test(m)));
    assert.ok(messages.some(m => /10001 characters; Devin allows 10000/.test(m)));
  });

  it('counts code points, so a note of 5,001 emoji (10,002 UTF-16 units) is within the limit', t => {
    const dir = project(t, { [DEVIN_WIKI.path]: JSON.stringify({ repo_notes: [{ content: '🧭'.repeat(5001) }], pages: [{ title: 'A', purpose: 'a' }] }) });
    assert.deepEqual(lintDevinWiki(dir).problems, []);
  });

  it('requires both keys and at least one page', t => {
    const dir = project(t, { [DEVIN_WIKI.path]: JSON.stringify({ pages: [] }) });
    const messages = lintDevinWiki(dir).problems.map(p => p.message).join('\n');
    assert.match(messages, /"repo_notes" is required/);
    assert.match(messages, /must list at least one page/);
  });

  it('no wiki file reports nothing', t => {
    assert.equal(lintDevinWiki(project(t, { 'a.ts': '' })).present, false);
  });
});

describe('other tools give the owner (FR-004, FR-005, User Stories 4–5)', () => {
  const ownership = { roots: ['src'], entries: [
    { doc: 'docs-canonical/ARCHITECTURE.md', section: 'component-map', purpose: 'Module layout', paths: ['src/**'] },
  ] };

  it('docguard_docs_for_path names the owner and its purpose', t => {
    const dir = project(t, THREE_DIRS);
    const answer = docsForPath(dir, { ownership }, 'src/api/users.ts');
    assert.deepEqual(answer.owner, { key: 'docs-canonical/ARCHITECTURE.md#component-map', doc: 'docs-canonical/ARCHITECTURE.md', section: 'component-map', purpose: 'Module layout', matchedBy: 'src/**', source: 'declared' });
    assert.match(docsForPath(dir, {}, 'src/api/users.ts').ownerReason, /no ownership map is configured/);
  });

  it('trace --reverse prints the declared owner first; --owners lists entries and unowned code', t => {
    const dir = project(t, { ...THREE_DIRS, '.docguard.json': JSON.stringify({ projectName: 'x', ownership }) });
    const reverse = spawnSync(process.execPath, [CLI, 'trace', '--reverse', 'src/db/store.ts', '--dir', dir], { encoding: 'utf8' });
    assert.match(reverse.stdout, /Owner \(declared\):.*ARCHITECTURE\.md#component-map.*Module layout/);
    const json = spawnSync(process.execPath, [CLI, 'trace', '--owners', '--format', 'json', '--dir', dir], { encoding: 'utf8' });
    const data = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')));
    assert.deepEqual(data.entries.map(e => [e.key, e.files]), [['docs-canonical/ARCHITECTURE.md#component-map', 5]], 'every tracked file it owns, README included');
    assert.deepEqual(data.unowned, []);
  });

  it('trace --owners --suggest drafts a block and writes nothing', t => {
    const dir = project(t, { ...THREE_DIRS, '.docguard.json': '{"projectName":"x"}\n' });
    const before = readFileSync(join(dir, '.docguard.json'), 'utf8');
    const out = spawnSync(process.execPath, [CLI, 'trace', '--owners', '--suggest', '--format', 'json', '--dir', dir], { encoding: 'utf8' });
    const draft = JSON.parse(out.stdout.slice(out.stdout.indexOf('{'))).ownership;
    assert.ok(draft.entries.length > 0);
    assert.ok(draft.entries.every(e => e.purpose.startsWith('<')), 'purpose is left to a person');
    assert.equal(readFileSync(join(dir, '.docguard.json'), 'utf8'), before);
  });

  it('review --suggest offers the owned paths, still low confidence', t => {
    const dir = project(t, THREE_DIRS);
    const s = suggestCovers(dir, 'docs-canonical/ARCHITECTURE.md', { ownership });
    assert.deepEqual(s.find(x => x.source === 'ownership'), { heading: '#component-map (ownership)', covers: ['src/**'], confidence: 'low', source: 'ownership' });
  });

  it('a warm owner lookup is fast (SC-004)', () => {
    const repoConfig = JSON.parse(readFileSync('.docguard.json', 'utf8'));
    ownerOf(process.cwd(), repoConfig, 'cli/findings.mjs');
    const start = performance.now();
    const result = ownerOf(process.cwd(), repoConfig, 'cli/findings.mjs');
    assert.ok(performance.now() - start < 50);
    assert.equal(result.owner.key, 'docs-canonical/DATA-MODEL.md#finding-channels');
  });
});

describe('this repository adopts the map (FR-008, FR-009, SC-002)', () => {
  it('every tracked source file under the five roots has exactly one owner', () => {
    const repoConfig = JSON.parse(readFileSync('.docguard.json', 'utf8'));
    assert.deepEqual(repoConfig.ownership.roots, ['cli', 'extensions', 'tools', 'benchmarks', 'tests']);
    const report = ownershipReport(process.cwd(), repoConfig);
    assert.deepEqual(report.unowned, []);
    assert.deepEqual(report.ties, []);
    assert.deepEqual(validateDocOwnership(process.cwd(), repoConfig).findings, []);
  });

  it('documents the block, the codes and trace --owners', () => {
    const read = p => readFileSync(p, 'utf8');
    assert.match(read('docs/configuration.md'), /## Doc ownership — `ownership`/);
    assert.match(read('docs/commands.md'), /trace --owners/);
    assert.match(read('README.md'), /Doc-Ownership/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /doc-ownership\.mjs/);
    assert.match(read('docs-canonical/DATA-MODEL.md'), /## Doc Ownership Map: `ownership`/);
  });
});
