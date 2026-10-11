/**
 * Suppressions that carry a reason and an expiry, and the claimspec `ignore`
 * export (specs/057-ignore-reasons, raccioly/docguard#420).
 *
 * @req docguard.ignore-reasons#FR-001
 * @req docguard.ignore-reasons#FR-002
 * @req docguard.ignore-reasons#FR-003
 * @req docguard.ignore-reasons#FR-004
 * @req docguard.ignore-reasons#FR-005
 * @req docguard.ignore-reasons#FR-006
 * @req docguard.ignore-reasons#FR-007
 * @req docguard.ignore-reasons#FR-008
 * @req docguard.ignore-reasons#FR-009
 * @req docguard.ignore-reasons#FR-010
 * @req docguard.ignore-reasons#FR-011
 * @req docguard.ignore-reasons#FR-012
 * @req docguard.ignore-reasons#SC-001
 * @req docguard.ignore-reasons#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildIgnoreFilter, loadDocguardIgnore, loadDocguardIgnoreEntries, mergeIgnoreFile, parseDocguardIgnore, shouldIgnore,
} from '../cli/shared-ignore.mjs';
import { validateSecurity } from '../cli/validators/security.mjs';
import { loadIgnorePatterns } from '../cli/shared.mjs';
import { CODES, parseInlinePragma, suppressesCode } from '../cli/findings.mjs';
import { validateSuppressions } from '../cli/validators/suppressions.mjs';
import { collectSuppressions } from '../cli/scanners/suppressions.mjs';
import { claimspecPathPattern, toClaimspecIgnore } from '../cli/writers/claimspec-ignore.mjs';
import { CLAIMSPEC_VENDOR, assertValidClaimspec, validateClaimspec, validateWithSchemas } from '../cli/claimspec-schema.mjs';
import { fixtureGit } from './helpers/git.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});
const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

let dir;
const fresh = (files = {}) => {
  dir = mkdtempSync(join(tmpdir(), 'docguard-057-'));
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  return dir;
};
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

/** The parser as it was before spec 057 — the backward-compatibility reference. */
const oldParser = raw => raw.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));

const snapshot = root => readdirSync(root, { recursive: true }).map(String).sort()
  .map(rel => { const p = join(root, rel); return statSync(p).isFile() ? `${rel}:${readFileSync(p, 'utf8')}` : rel; });

describe('.docguardignore grammar: pattern  expires:YYYY-MM-DD  # reason (FR-001)', () => {
  const today = '2026-10-10';

  it('reads the pattern, the expiry and the reason from one line', () => {
    const [e] = parseDocguardIgnore('legacy/  expires:2999-12-31  # removed with the v2 API\n', { today });
    assert.deepEqual(
      { pattern: e.pattern, reason: e.reason, expires: e.expires, state: e.state, line: e.line },
      { pattern: 'legacy/', reason: 'removed with the v2 API', expires: '2999-12-31', state: 'active', line: 1 },
    );
  });

  it('a # after whitespace starts the reason; a # inside a pattern stays in the pattern', () => {
    const entries = parseDocguardIgnore([
      '# a whole-line comment',
      'fixtures/  # test data',
      'C#/',
      'notes#1.md',
      'tmp/ #',
      'cache/ # keep expires:2030-01-01 in prose',
      '',
    ].join('\n'), { today });
    assert.deepEqual(entries.map(e => [e.pattern, e.reason, e.expires, e.line]), [
      ['fixtures/', 'test data', null, 2],
      ['C#/', null, null, 3],
      ['notes#1.md', null, null, 4],
      ['tmp/', null, null, 5],
      ['cache/', 'keep expires:2030-01-01 in prose', null, 6],
    ]);
  });

  it('a trailing comment no longer breaks the pattern it follows', () => {
    fresh({ '.docguardignore': 'fixtures/  # test data\n' });
    assert.equal(loadIgnorePatterns(dir)('fixtures/a.md'), true);
  });
});

describe('existing ignore files keep working byte-for-byte (FR-002)', () => {
  it("this repository's .docguardignore yields exactly the old patterns", () => {
    // Only lines written in the pre-057 grammar: a later commit may give this
    // file reasons, and those lines are meant to change.
    const raw = readFileSync(join(ROOT, '.docguardignore'), 'utf8').split(/\r?\n/)
      .filter(line => !/\s#/.test(line.trim()) && !/(^|\s)expires:\S*$/.test(line.trim())).join('\n');
    assert.ok(oldParser(raw).length >= 10, 'the repository file still has pre-057 lines to compare');
    fresh({ '.docguardignore': raw });
    assert.deepEqual(loadDocguardIgnore(dir), oldParser(raw));
  });

  it('odd but comment-free lines are unchanged', () => {
    const raw = [
      '  build/  ', '\tdist/\t', '**/*.snap', 'C#/', 'a#b', 'My Docs/', 'expires-notes/',
      'docs/expires:soon.md', '# comment', '', 'vendor/legacy.ts', 'x\r', 'weird name.md',
    ].join('\n');
    fresh({ '.docguardignore': raw });
    assert.deepEqual(loadDocguardIgnore(dir), oldParser(raw));
  });
});

describe('expiry: an entry applies through its UTC day, then excludes nothing (FR-003)', () => {
  it('is active on its last day and expired the next day', () => {
    const text = 'old/ expires:2026-10-10 # retired with the old importer\n';
    assert.equal(parseDocguardIgnore(text, { today: '2026-10-10' })[0].state, 'active');
    assert.equal(parseDocguardIgnore(text, { today: '2026-10-11' })[0].state, 'expired');
  });

  it('an expired entry is dropped from every consumer of .docguardignore', () => {
    fresh({ '.docguardignore': 'old/ expires:2000-01-01 # retired\nkeep/ expires:2999-01-01 # still valid\n' });
    assert.deepEqual(loadDocguardIgnore(dir), ['keep/']);
    assert.deepEqual(mergeIgnoreFile(dir, {}).ignore, ['keep/']);
    const ignored = loadIgnorePatterns(dir);
    assert.equal(ignored('old/a.md'), false);
    assert.equal(ignored('keep/a.md'), true);
  });
});

describe('an unreadable expiry, or no pattern, excludes nothing (FR-004)', () => {
  it('marks impossible dates, malformed dates and pattern-less lines invalid', () => {
    const entries = parseDocguardIgnore([
      'a/ expires:2026-02-30 # not a calendar date',
      'b/ expires:soon # not a date at all',
      'c/ expires:2026-1-5 # not zero-padded',
      'expires:2030-01-01 # a reason with no pattern',
      'd/ expires:2028-02-29 # a real leap day',
    ].join('\n'), { today: '2026-10-10' });
    assert.deepEqual(entries.map(e => [e.pattern, e.state]), [
      ['a/', 'invalid'], ['b/', 'invalid'], ['c/', 'invalid'], [null, 'invalid'], ['d/', 'active'],
    ]);
    fresh({ '.docguardignore': entries.map(e => e.raw).join('\n') });
    assert.deepEqual(loadDocguardIgnore(dir), ['d/']);
  });
});

describe('the Suppressions validator: IGN001, IGN002, IGN003 (FR-005)', () => {
  const file = [
    'expired/ expires:2000-01-01 # replaced by the v2 importer',
    'broken/ expires:2026-13-01 # month thirteen',
    'bare/',
    'good/ expires:2999-01-01 # generated by the build',
  ].join('\n');

  it('registers the codes for explain and the generated reference', () => {
    for (const code of ['IGN001', 'IGN002', 'IGN003']) {
      assert.equal(CODES[code].validator, 'suppressions', code);
      assert.ok(CODES[code].title && CODES[code].help, code);
    }
  });

  it('reports expired and unreadable entries at their line; reasons only when required', () => {
    fresh({ '.docguardignore': file });
    const off = validateSuppressions(dir, {});
    assert.deepEqual(off.findings.map(f => [f.code, f.location]), [
      ['IGN001', '.docguardignore:1'], ['IGN003', '.docguardignore:2'],
    ]);
    const on = validateSuppressions(dir, { suppressions: { requireReason: true } });
    assert.deepEqual(on.findings.map(f => [f.code, f.location]), [
      ['IGN001', '.docguardignore:1'], ['IGN003', '.docguardignore:2'], ['IGN002', '.docguardignore:3'],
    ]);
    // IGN002 reports; it does not disable the entry.
    assert.ok(loadDocguardIgnore(dir).includes('bare/'));
    assert.equal(on.total, 4);
    assert.equal(on.passed, 1);
  });

  it('is not applicable without entries', () => {
    fresh({ 'package.json': '{}' });
    assert.equal(validateSuppressions(dir, {}).applicable, false);
    fresh({ '.docguardignore': '# only comments\n' });
    assert.equal(validateSuppressions(dir, {}).applicable, false);
  });

  it('guard runs it and reports the expired entry', () => {
    fresh({ '.docguardignore': file, '.docguard.json': JSON.stringify({ projectName: 'ign' }) });
    const out = run(['guard', '--format', 'json'], dir);
    const data = JSON.parse(out.stdout);
    const codes = data.findings.filter(f => f.validator === 'suppressions').map(f => f.code).sort();
    assert.deepEqual(codes, ['IGN001', 'IGN003']);
  });
});

describe('one model of every native suppression (FR-006)', () => {
  it('reads the reason written after an inline pragma, the same codes suppressesCode reads', () => {
    assert.deepEqual(parseInlinePragma('// docguard:ignore SEC001 — UI copy, not a credential'),
      { codes: ['SEC001'], reason: 'UI copy, not a credential' });
    assert.deepEqual(parseInlinePragma('<!-- docguard:ignore SPK010 — task invokes this file -->'),
      { codes: ['SPK010'], reason: 'task invokes this file' });
    assert.deepEqual(parseInlinePragma('x = 1 # docguard:ignore'), { codes: null, reason: null });
    assert.deepEqual(parseInlinePragma('// docguard:ignore-secret: sample key'), { codes: ['SEC*'], reason: 'sample key' });
    assert.deepEqual(parseInlinePragma('// docguard:ignore SEC001,DQ002 -- two codes'), { codes: ['SEC001', 'DQ002'], reason: 'two codes' });
    assert.equal(parseInlinePragma('no pragma here'), null);
    assert.equal(suppressesCode('// docguard:ignore SEC001 — UI copy', 'SEC001'), true);
  });

  it('collects every surface with its scope, reason, expiry, state and source', () => {
    fresh({
      '.docguardignore': '# header\ngen/ expires:2999-01-01 # generated by the build\nbare/\n',
      '.docguard.json': JSON.stringify({ ignore: ['tmp/'], securityIgnore: ['fixtures/'], todoIgnore: ['vendor/'] }),
      'src/a.js': "const k = 'x'; // docguard:ignore SEC001 — sample key in a fixture\n// docguard:ignore\n",
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:validator testSpec n/a — POC, no tests yet -->\n<!-- docguard:section authentication n/a — CLI only, no users -->\n',
      '.docguard.baseline.json': JSON.stringify({ version: 1, count: 2, fingerprints: { aaaa: 1, bbbb: 2 } }),
    });
    const model = collectSuppressions(dir, { ignore: ['tmp/', 'gen/', 'bare/'], securityIgnore: ['fixtures/'], todoIgnore: ['vendor/'] },
      { today: '2026-10-10', validatorKeys: ['testSpec', 'security'] });
    const view = model.entries.map(e => [e.kind, e.pattern ?? e.codes ?? e.key ?? null, e.scope, e.reason, e.expires, e.state, e.source.file, e.source.line ?? e.source.key]);
    assert.deepEqual(view, [
      ['path', 'gen/', 'all-validators', 'generated by the build', '2999-01-01', 'active', '.docguardignore', 2],
      ['path', 'bare/', 'all-validators', null, null, 'active', '.docguardignore', 3],
      ['path', 'tmp/', 'all-validators', null, null, 'active', '.docguard.json', 'ignore'],
      ['path', 'fixtures/', 'validator:security', null, null, 'active', '.docguard.json', 'securityIgnore'],
      ['path', 'vendor/', 'validator:todoTracking', null, null, 'active', '.docguard.json', 'todoIgnore'],
      ['code', ['SEC001'], 'line', 'sample key in a fixture', null, 'active', 'src/a.js', 1],
      ['code', null, 'line', null, null, 'active', 'src/a.js', 2],
      ['validator', 'testSpec', 'validator:testSpec', 'POC, no tests yet', null, 'active', 'docs-canonical/ARCHITECTURE.md', 3],
      ['section', 'authentication', 'section:authentication', 'CLI only, no users', null, 'active', 'docs-canonical/ARCHITECTURE.md', 4],
      ['fingerprint', 'aaaa', 'finding', null, null, 'active', '.docguard.baseline.json', 'fingerprints'],
      ['fingerprint', 'bbbb', 'finding', null, null, 'active', '.docguard.baseline.json', 'fingerprints'],
    ]);
  });
});

describe('docguard ignore lists the model and writes nothing (FR-007)', () => {
  it('prints each suppression with its reason and state, in text and JSON', () => {
    fresh({
      '.docguardignore': 'gen/ expires:2999-01-01 # generated by the build\nold/ expires:2000-01-01 # replaced long ago\nbare/\n',
      '.docguard.json': JSON.stringify({ projectName: 'ign', securityIgnore: ['fixtures/'] }),
    });
    const before = snapshot(dir);
    const text = run(['ignore'], dir);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /gen\/.*generated by the build/);
    assert.match(text.stdout, /old\/.*expired/);
    assert.match(text.stdout, /bare\/.*no reason/);
    assert.match(text.stdout, /fixtures\/.*securityIgnore/);
    const json = run(['ignore', '--format', 'json'], dir);
    const data = JSON.parse(json.stdout);
    assert.equal(data.entries.length, 4);
    assert.equal(data.export.complete, false);
    assert.deepEqual(snapshot(dir), before);
  });
});

describe('docguard ignore --format claimspec (FR-008)', () => {
  it('maps DocGuard scope onto gitignore syntax exactly, or refuses', () => {
    const table = [
      ['build/', 'build'], ['*.egg-info/', '*.egg-info'], ['src/legacy/**', '**/src/legacy/**'],
      ['docs/reference/findings.md', '**/docs/reference/findings.md'], ['*.bak', '*.bak'], ['a/*/b', '**/a/*/b'],
      // FR-011: the matcher now reads these the way gitignore does (FR-010).
      ['**/fixtures/**', '**/fixtures/**'], ['a/**/b', '**/a/**/b'], ['foo?', 'foo?'], ['[ab]', '[ab]'],
      ['[!ab].md', '[!ab].md'], ['/rooted', '/rooted'], ['/rooted/dir/', '/rooted/dir'], ['x(1)', 'x(1)'],
      ['back\\slash', 'back\\slash'], ['a+b|c', 'a+b|c'], ['{a,b}.md', '{a,b}.md'], ['**', '**'],
      // Still read differently, so still refused.
      ['!keep', null], ['a**', null], ['**b/c', null], ['[unclosed', null], ['[[:alpha:]].md', null],
    ];
    for (const [pattern, expected] of table) {
      assert.equal(claimspecPathPattern(pattern).pattern, expected, pattern);
    }
  });

  it('exports reasoned entries, keeps expired ones with their instant, and reports the rest', () => {
    const long = 'x'.repeat(2001);
    fresh({
      '.docguardignore': [
        'src/legacy/**  expires:2026-12-31  # removed with the v2 API',
        'build/  # generated output of the build',
        'old/  expires:2000-01-01  # replaced by the v2 importer',
        'bare/',
        'short/  # tmp',
        'broken/  expires:2026-02-30  # an impossible expiry date',
        'foo?  # one character after foo',
        '!keep  # a negation DocGuard reads literally',
        `long/  # ${long}`,
      ].join('\n'),
      '.docguard.json': JSON.stringify({ projectName: 'ign', todoIgnore: ['vendor/'] }),
      'src/a.js': '// docguard:ignore SEC001 — sample key in a fixture\n',
    });
    const before = snapshot(dir);
    const out = run(['ignore', '--format', 'claimspec'], dir);
    assert.equal(out.status, 0, out.stderr);
    const doc = JSON.parse(out.stdout);
    assert.deepEqual(validateClaimspec('ignore', doc), []);
    assert.deepEqual(doc, {
      schemaVersion: 1,
      entries: [
        { kind: 'path', pattern: '**/src/legacy/**', reason: 'removed with the v2 API', expires: '2027-01-01T00:00:00Z' },
        { kind: 'path', pattern: 'build', reason: 'generated output of the build' },
        { kind: 'path', pattern: 'old', reason: 'replaced by the v2 importer', expires: '2000-01-02T00:00:00Z' },
        { kind: 'path', pattern: 'foo?', reason: 'one character after foo' },
      ],
    });
    assert.match(out.stderr, /not the complete suppression policy/);
    assert.match(out.stderr, /bare\/.*no reason/);
    assert.match(out.stderr, /short\/.*shorter than 8/);
    assert.match(out.stderr, /broken\/.*expiry/);
    assert.match(out.stderr, /!keep.*negates/);
    assert.match(out.stderr, /long\/.*longer than 2000/);
    assert.match(out.stderr, /1 validator-scoped/);
    assert.match(out.stderr, /1 inline pragma/);
    assert.deepEqual(snapshot(dir), before);
  });

  it('never invents a reason: no exportable entry gives an empty document, marked incomplete', () => {
    const { document, report } = toClaimspecIgnore({
      entries: [{ kind: 'path', pattern: 'bare/', scope: 'all-validators', reason: null, expires: null, state: 'active', source: { file: '.docguardignore', line: 1 } }],
    });
    assert.deepEqual(document, { schemaVersion: 1, entries: [] });
    assert.equal(report.complete, false);
    assert.deepEqual(validateClaimspec('ignore', document), []);
  });

  it('a project with only fully reasoned .docguardignore entries exports a complete document', () => {
    fresh({ '.docguardignore': 'gen/ # generated by the build\n' });
    const { document, report } = toClaimspecIgnore(collectSuppressions(dir, {}, { today: '2026-10-10' }));
    assert.equal(document.entries.length, 1);
    assert.equal(report.complete, true);
  });
});

describe('vendored claimspec schemas and their validator (FR-009)', () => {
  const fixture = name => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'claimspec', name), 'utf8'));

  it('the vendored files are byte-identical to the recorded revision', () => {
    assert.match(CLAIMSPEC_VENDOR.revision, /^[0-9a-f]{40}$/);
    for (const [file, sha] of Object.entries(CLAIMSPEC_VENDOR.sha256)) {
      const bytes = readFileSync(join(ROOT, 'schemas', 'claimspec', 'v1', file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, file);
    }
  });

  it("accepts claimspec's conformance example and rejects its invalid ignore cases", () => {
    assert.deepEqual(validateClaimspec('ignore', fixture('ignore.example.json')), []);
    assert.notDeepEqual(validateClaimspec('ignore', fixture('ignore.invalid.missing-reason.json')), []);
    assert.notDeepEqual(validateClaimspec('ignore', fixture('ignore.invalid.short-reason.json')), []);
  });

  it('enforces kind, lengths, the instant format and closed objects', () => {
    const entry = { kind: 'path', pattern: 'src/**', reason: 'a reason that is long enough' };
    const bad = [
      { schemaVersion: 2, entries: [] },
      { schemaVersion: 1 },
      { schemaVersion: 1, entries: [{ ...entry, kind: 'glob' }] },
      { schemaVersion: 1, entries: [{ ...entry, pattern: '' }] },
      { schemaVersion: 1, entries: [{ ...entry, pattern: 'p'.repeat(513) }] },
      { schemaVersion: 1, entries: [{ ...entry, reason: 'r'.repeat(2001) }] },
      { schemaVersion: 1, entries: [{ ...entry, expires: '2026-12-31' }] },
      { schemaVersion: 1, entries: [{ ...entry, extra: true }] },
      { schemaVersion: 1, entries: [], extra: true },
      { schemaVersion: 1, entries: [{ ...entry, reason: '😀😀😀😀😀😀😀' }] },
    ];
    for (const doc of bad) assert.notDeepEqual(validateClaimspec('ignore', doc), [], JSON.stringify(doc).slice(0, 80));
    assert.deepEqual(validateClaimspec('ignore', { schemaVersion: 1, entries: [{ ...entry, reason: '😀😀😀😀😀😀😀😀', expires: '2027-01-01T00:00:00Z' }] }), []);
  });

  it('refuses a schema keyword it does not implement instead of passing', () => {
    assert.throws(() => validateWithSchemas({ oneOf: [{ type: 'string' }] }, 'x', {}), /unsupported JSON Schema keyword: oneOf/);
  });

  it('the writer refuses to print a document that does not validate', () => {
    assert.throws(() => assertValidClaimspec('ignore', { schemaVersion: 1, entries: [{ kind: 'path', pattern: 'x', reason: 'short' }] }), /not a valid claimspec ignore/);
  });
});

/** The matcher as it was before FR-010 — the reference for the before/after table. */
function oldGlobToRegex(pattern) {
  const normalized = pattern.replace(/\/+$/, '') || pattern;
  const escaped = normalized
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${escaped}$|/${escaped}$|^${escaped}/|/${escaped}/`);
}
const oldFilter = patterns => path => patterns.some(p => oldGlobToRegex(p).test(path));

describe('the ignore matcher reads every pattern the way gitignore does (FR-010)', () => {
  const cases = [
    // [pattern, matches, does not match]
    ['**/fixtures/**', ['fixtures/x', 'a/fixtures/x', 'a/b/fixtures/c/d'], ['fixturesx/y', 'x/fixtures']],
    ['**/x.md', ['x.md', 'a/x.md', 'a/b/x.md'], ['ax.md', 'x.mdx']],
    ['a/**/b', ['a/b', 'a/x/b', 'a/x/y/b', 'z/a/b', 'a/b/c'], ['ab', 'a/xb', 'a/b2']],
    ['foo?', ['foox', 'dir/fooy', 'fooz/inner'], ['fo', 'foo', 'fooxx', 'foo/x']],
    ['x(1).md', ['x(1).md', 'd/x(1).md'], ['x1.md', 'x.md']],
    ['a+b', ['a+b'], ['aab', 'ab']],
    ['a|b', ['a|b'], ['a', 'b']],
    ['^x$', ['^x$'], ['x']],
    ['{a,b}.md', ['{a,b}.md'], ['a.md', 'b.md']],
    ['x{2}', ['x{2}'], ['xx']],
    ['[ab].md', ['a.md', 'd/b.md'], ['c.md', 'ab.md']],
    ['[!ab].md', ['c.md', '!.md'], ['a.md', 'b.md', 'ab.md']],
    ['[^ab].md', ['c.md'], ['a.md']],
    ['[a-c]x', ['ax', 'cx'], ['dx']],
    ['x[!a]y', ['xby'], ['x/y', 'xay']],
    ['[unclosed', ['[unclosed'], ['u']],
    ['\\*.md', ['*.md'], ['a.md']],
    ['back\\slash', ['backslash'], ['back\\slash']],
    ['/build', ['build', 'build/x'], ['a/build', 'a/build/x']],
    ['/a/b/', ['a/b', 'a/b/c'], ['x/a/b']],
    ['!keep', ['!keep'], ['keep']],
    ['§§x', ['§§x'], ['abcx']],
  ];

  for (const [pattern, yes, no] of cases) {
    it(`${pattern}`, () => {
      const f = buildIgnoreFilter([pattern]);
      for (const p of yes) assert.equal(f(p), true, `${pattern} should match ${p}`);
      for (const p of no) assert.equal(f(p), false, `${pattern} should not match ${p}`);
    });
  }

  it('every caller sees the same reading: config ignore, securityIgnore, todoIgnore, documentLifecycle, .docguardignore', () => {
    const config = { ignore: ['**/gen/**'], securityIgnore: ['**/fixtures/**'], todoIgnore: ['notes?.md'], documentLifecycle: ['/archive'] };
    assert.equal(shouldIgnore('gen/a.js', config), true);
    assert.equal(shouldIgnore('fixtures/a.js', config, 'securityIgnore'), true);
    assert.equal(shouldIgnore('fixtures/a.js', config), false);
    assert.equal(shouldIgnore('notes1.md', config, 'todoIgnore'), true);
    assert.equal(shouldIgnore('notes.md', config, 'todoIgnore'), false);
    assert.equal(shouldIgnore('archive/old.md', config, 'documentLifecycle'), true);
    assert.equal(shouldIgnore('docs/archive/old.md', config, 'documentLifecycle'), false);
    fresh({ '.docguardignore': '**/fixtures/**\n' });
    assert.equal(loadIgnorePatterns(dir)('fixtures/x.md'), true);
  });

  it('securityIgnore **/fixtures/** now keeps a top-level fixtures/ out of the secret scan', () => {
    fresh({ 'fixtures/keys.js': "const api_key = 'Zx9Qw8Er7Ty6Ui5Op4As';\n", 'src/index.js': 'export const x = 1;\n' });
    const without = validateSecurity(dir, {}).findings.filter(f => f.code === 'SEC002');
    assert.equal(without.length, 1, 'the fixture is a real SEC002 hit without the pattern');
    const withPattern = validateSecurity(dir, { securityIgnore: ['**/fixtures/**'] }).findings.filter(f => f.code === 'SEC002');
    assert.deepEqual(withPattern, []);
  });

  it('before/after: patterns without the fixed syntax match exactly the same paths', () => {
    const repoPatterns = oldParser(readFileSync(join(ROOT, '.docguardignore'), 'utf8'));
    const fixturePatterns = oldParser(readFileSync(join(ROOT, 'benchmarks/fixtures/generated-security-control/.docguardignore'), 'utf8'));
    const crafted = [
      'build/', 'dist', '*.bak', '*.egg-info/', 'src/legacy/**', 'docs/reference/findings.md', 'a/*/b', 'a**',
      '**', '***', 'x.**', 'My Docs/', 'C#/', 'notes#1.md', '.DS_Store', '**.md', 'tests/**/*.snap', 'a/**',
      '/', 'packages/*/dist/', '*', '*.test.ts', 'vendor/legacy.ts',
    ];
    const tracked = fixtureGit(ROOT, ['ls-files']).split('\n').filter(Boolean);
    const paths = [...tracked, 'fixtures/x', 'a/b', 'a/x/b', 'build', 'build/x', 'x/build', 'Research', 'Research/a.md',
      'My Docs/a.md', 'C#/x.cs', 'x.bak', 'deep/x.egg-info/PKG', 'src/legacy/a.js', 'z/src/legacy/a.js', 'a/q/b/c'];
    const fixed = p => /[?[\]()+^$|{}\\§]/.test(p) || /^\//.test(p) || /(^|\/)\*\*\//.test(p);
    const rows = [];
    for (const pattern of [...new Set([...repoPatterns, ...fixturePatterns, ...crafted])]) {
      const before = oldFilter([pattern]);
      const after = buildIgnoreFilter([pattern]);
      const changed = paths.filter(p => before(p) !== after(p));
      rows.push([pattern, paths.filter(before).length, paths.filter(after).length, changed.length]);
      if (!fixed(pattern)) assert.deepEqual(changed, [], `${pattern} changed on ${changed.slice(0, 5).join(', ')}`);
      // A leading or interior `**/` only gains matches (zero directories, top level).
      else if (/(^|\/)\*\*\//.test(pattern) && !/[?[\]()+^$|{}\\§]/.test(pattern)) {
        assert.deepEqual(changed.filter(p => before(p)), [], `${pattern} lost a match`);
      }
    }
    assert.ok(rows.length >= 40, `table has ${rows.length} patterns`);
  });
});

describe('claimspec export follows the corrected matcher (FR-011)', () => {
  it('exports a reasoned entry the matcher used to read as a regular expression', () => {
    fresh({ '.docguardignore': '**/fixtures/**  # test data that is not product code\nnotes?.md  # numbered scratch notes\n' });
    const { document, report } = toClaimspecIgnore(collectSuppressions(dir, {}, { today: '2026-10-10' }));
    assert.deepEqual(document.entries.map(e => e.pattern), ['**/fixtures/**', 'notes?.md']);
    assert.equal(report.complete, true);
    assert.deepEqual(validateClaimspec('ignore', document), []);
  });
});

describe('the documentLifecycle exclusion array is part of the published config (FR-012)', () => {
  it('is declared in the config schema and documented', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'docguard-config.schema.json'), 'utf8'));
    assert.deepEqual(schema.properties.documentLifecycle?.type, 'array');
    assert.deepEqual(schema.properties.documentLifecycle?.items, { type: 'string' });
    assert.match(readFileSync(join(ROOT, 'docs', 'configuration.md'), 'utf8'), /`documentLifecycle`/);
  });
});
