/**
 * Update awareness without network calls (specs/038-update-awareness): the
 * running release's age from the CHANGELOG it ships with, told to agents when
 * it is old, never guessed and never in a machine-readable output.
 *
 * @req docguard.update-awareness#FR-001
 * @req docguard.update-awareness#FR-002
 * @req docguard.update-awareness#FR-003
 * @req docguard.update-awareness#FR-004
 * @req docguard.update-awareness#FR-005
 * @req docguard.update-awareness#FR-006
 * @req docguard.update-awareness#FR-007
 * @req docguard.update-awareness#FR-008
 * @req docguard.update-awareness#SC-001
 * @req docguard.update-awareness#SC-002
 * @req docguard.update-awareness#SC-003
 * @req docguard.update-awareness#SC-004
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  releaseAge, releaseDateFromChangelog, updateHintText, footerHint, UPDATE_HINT_DAYS, UPDATE_HINT_OPT_OUT,
} from '../cli/release-age.mjs';

const REPO = resolve('.');
const VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
const DAY = 86400000;
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const temp = prefix => { const dir = mkdtempSync(join(tmpdir(), prefix)); temps.push(dir); return dir; };
const isoDaysAgo = days => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

/** A package directory with a package.json and, optionally, a CHANGELOG. */
function pkgDir({ version = '1.2.3', changelog } = {}) {
  const dir = temp('dg-age-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'docguard-cli', version }));
  if (changelog !== undefined) writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}
const changelogFor = (version, date) => `# Changelog\n\n## [Unreleased]\n\n## [${version}] - ${date}\n\n- things\n\n## [1.0.0] - 2020-01-01\n`;
const at = iso => Date.parse(`${iso}T12:00:00Z`);

describe('the release date comes only from the shipped CHANGELOG (FR-001)', () => {
  it('reads exactly the running version\'s heading', () => {
    const text = changelogFor('1.2.3', '2026-09-01');
    assert.equal(releaseDateFromChangelog(text, '1.2.3'), '2026-09-01');
    assert.equal(releaseDateFromChangelog(text, '1.2'), null, 'a prefix is not the version');
    assert.equal(releaseDateFromChangelog(text.replace('1.2.3', '1x2y3'), '1.2.3'), null, 'dots are literal');
  });

  it('ignores a heading inside a fenced code block', () => {
    const text = '# Changelog\n\n```md\n## [1.2.3] - 2020-01-01\n```\n';
    assert.equal(releaseDateFromChangelog(text, '1.2.3'), null);
    assert.equal(releaseDateFromChangelog(`${text}\n## [1.2.3] - 2026-09-01\n`, '1.2.3'), '2026-09-01');
  });

  it('says nothing when it cannot be sure, and says why', () => {
    const now = at('2026-10-30');
    const reason = opts => releaseAge({ now, env: {}, ...opts }).reason;
    assert.equal(reason({ pkgDir: pkgDir() }), 'missing-changelog');
    assert.equal(reason({ pkgDir: pkgDir({ changelog: changelogFor('9.9.9', '2026-09-01') }) }), 'no-heading');
    assert.equal(reason({ pkgDir: pkgDir({ changelog: changelogFor('1.2.3', '2026-02-30') }) }), 'bad-date');
    assert.equal(reason({ pkgDir: pkgDir({ changelog: changelogFor('1.2.3', 'someday') }) }), 'bad-date');
    assert.equal(reason({ pkgDir: pkgDir({ changelog: changelogFor('1.2.3', '2026-11-30') }) }), 'clock-before-release');
    for (const r of ['missing-changelog', 'no-heading', 'bad-date', 'clock-before-release']) {
      assert.equal(updateHintText({ show: false, reason: r }, 'footer'), null);
    }
  });
});

describe('more than 14 days old shows the note, 14 does not (FR-002, SC-001)', () => {
  const dir = () => pkgDir({ changelog: changelogFor('1.2.3', '2026-09-01') });
  it('draws the line at 14 whole days', () => {
    assert.equal(UPDATE_HINT_DAYS, 14);
    const fourteen = releaseAge({ now: at('2026-09-15'), env: {}, pkgDir: dir() });
    assert.deepEqual([fourteen.ageDays, fourteen.show, fourteen.reason], [14, false, 'fresh']);
    const fifteen = releaseAge({ now: at('2026-09-16'), env: {}, pkgDir: dir() });
    assert.deepEqual([fifteen.ageDays, fifteen.show, fifteen.reason], [15, true, 'shown']);
  });
});

describe('the note names the version, the date and the way to check (FR-003)', () => {
  const age = releaseAge({ now: at('2026-10-01'), env: {}, pkgDir: pkgDir({ changelog: changelogFor('1.2.3', '2026-09-01') }) });
  it('says "may", names docguard upgrade, and gives days only where the text is ephemeral', () => {
    for (const surface of ['footer', 'mcp', 'pack']) {
      const text = updateHintText(age, surface);
      assert.match(text, /DocGuard 1\.2\.3/);
      assert.match(text, /2026-09-01/);
      assert.match(text, /may exist/);
      assert.match(text, /docguard upgrade/);
      assert.doesNotMatch(text, /is available|is out|newer version exists/i, 'never claims a newer version exists');
    }
    assert.match(updateHintText(age, 'footer'), /\(30 days ago\)/);
    assert.match(updateHintText(age, 'mcp'), /\(30 days ago\)/);
    assert.match(updateHintText(age, 'mcp'), /without the user's agreement/);
    assert.doesNotMatch(updateHintText(age, 'pack'), /days ago/, 'a committed pack must not change daily');
  });
});

describe('opt-out, source checkouts and CI stay silent (FR-005)', () => {
  const dir = () => pkgDir({ changelog: changelogFor('1.2.3', '2026-09-01') });
  const now = at('2026-10-01');
  it(`${UPDATE_HINT_OPT_OUT}=1 silences every surface`, () => {
    assert.equal(releaseAge({ now, env: { [UPDATE_HINT_OPT_OUT]: '1' }, pkgDir: dir() }).reason, 'opt-out');
    assert.equal(releaseAge({ now, env: { [UPDATE_HINT_OPT_OUT]: '0' }, pkgDir: dir() }).show, true, '0 is not an opt-out');
  });
  it('a .git directory or a worktree .git file marks a source checkout', () => {
    const clone = dir(); mkdirSync(join(clone, '.git'));
    const worktree = dir(); writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere\n');
    for (const d of [clone, worktree]) assert.equal(releaseAge({ now, env: {}, pkgDir: d }).reason, 'source-checkout');
  });
  it('CI silences the guard footer only', () => {
    assert.equal(footerHint({ now, env: { CI: 'true' }, pkgDir: dir() }), null);
    assert.equal(footerHint({ now, env: { CI: 'false' }, pkgDir: dir() }) !== null, true);
    assert.ok(footerHint({ now, env: {}, pkgDir: dir() }));
  });
  it('this repository is a source checkout, so it never sees the note (SC-004)', () => {
    assert.equal(releaseAge({ env: {} }).reason, 'source-checkout');
  });
});

/**
 * An install of this build outside any git checkout, whose CHANGELOG dates the
 * running version `days` ago. The CLI reads the real clock: no test-only
 * clock variable exists in production code.
 */
function install(days) {
  const dir = temp('dg-install-');
  for (const part of ['cli', 'templates', 'schemas', 'extensions']) cpSync(join(REPO, part), join(dir, part), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(dir, 'package.json'));
  writeFileSync(join(dir, 'CHANGELOG.md'), changelogFor(VERSION, isoDaysAgo(days)));
  return dir;
}
function project() {
  const dir = temp('dg-proj-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '0.0.0' }));
  writeFileSync(join(dir, 'README.md'), '# p\n');
  return dir;
}
const run = (inst, args, env = {}, input) => spawnSync(process.execPath, [join(inst, 'cli/docguard.mjs'), ...args], {
  encoding: 'utf8', input, env: { ...process.env, CI: '', [UPDATE_HINT_OPT_OUT]: '', ...env },
});
const withoutTimings = text => text
  .replace(/"(durationMs|timestamp|generatedAt|totalMs|elapsedMs)":\s*("[^"]*"|[\d.]+)/g, '"$1":0')
  .replace(/ (timestamp|time)="[^"]*"/g, ' $1=""');

describe('the note reaches agents and never a machine-readable output (FR-004, SC-002, SC-003)', () => {
  const old = install(UPDATE_HINT_DAYS + 1);
  const recent = install(UPDATE_HINT_DAYS);
  const proj = project();

  it('guard text ends with the note at 15 days, not at 14, and CI silences it', () => {
    assert.match(run(old, ['guard', '--dir', proj]).stdout, /may exist[\s\S]*docguard upgrade/);
    assert.doesNotMatch(run(recent, ['guard', '--dir', proj]).stdout, /may exist/);
    assert.doesNotMatch(run(old, ['guard', '--dir', proj], { CI: 'true' }).stdout, /may exist/);
  });

  it('JSON, SARIF and JUnit are byte-identical with and without the note', () => {
    for (const format of ['json', 'sarif', 'junit']) {
      const shown = run(old, ['guard', '--dir', proj, '--format', format]).stdout;
      const silent = run(old, ['guard', '--dir', proj, '--format', format], { [UPDATE_HINT_OPT_OUT]: '1' }).stdout;
      assert.ok(shown.length > 0, format);
      assert.equal(withoutTimings(shown), withoutTimings(silent), format);
      assert.doesNotMatch(shown, /may exist/, format);
    }
  });

  it('MCP initialize carries instructions; tool listings and results do not change', () => {
    const messages = [
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docguard_score', arguments: { projectDir: proj } } },
    ];
    const input = `${messages.map(m => JSON.stringify(m)).join('\n')}\n`;
    const byId = out => new Map(out.split('\n').filter(Boolean).map(l => { const m = JSON.parse(l); return [m.id, m]; }));
    const shown = byId(run(old, ['mcp'], {}, input).stdout);
    const silent = byId(run(old, ['mcp'], { [UPDATE_HINT_OPT_OUT]: '1' }, input).stdout);
    assert.match(shown.get(0).result.instructions, /may exist[\s\S]*without the user's agreement/);
    assert.equal(silent.get(0).result.instructions, undefined);
    assert.equal(byId(run(recent, ['mcp'], {}, input).stdout).get(0).result.instructions, undefined);
    assert.deepEqual(shown.get(1), silent.get(1), 'tools/list');
    assert.equal(withoutTimings(JSON.stringify(shown.get(2))), withoutTimings(JSON.stringify(silent.get(2))), 'tools/call');
  });

  it('the context pack gets its own section, without a day count', () => {
    const pack = run(old, ['memory', '--pack', '--stdout', '--dir', proj]).stdout;
    assert.match(pack, /## DocGuard version\n\nDocGuard [^\n]*may exist/);
    assert.doesNotMatch(pack, /days ago/);
    assert.doesNotMatch(run(recent, ['memory', '--pack', '--stdout', '--dir', proj]).stdout, /## DocGuard version/);
  });

  it('this repository\'s own CLI shows nothing (SC-004)', () => {
    const out = spawnSync(process.execPath, [join(REPO, 'cli/docguard.mjs'), 'memory', '--pack', '--stdout', '--dir', proj], {
      encoding: 'utf8', env: { ...process.env, [UPDATE_HINT_OPT_OUT]: '' },
    }).stdout;
    assert.doesNotMatch(out, /## DocGuard version/);
  });
});

describe('the user-facing docs describe the note, its threshold and the opt-out (FR-008)', () => {
  for (const doc of ['README.md', 'docs/configuration.md', 'docs/ai-integration.md', 'CHANGELOG.md']) {
    it(doc, () => {
      const text = readFileSync(join(REPO, doc), 'utf8');
      assert.match(text, /DOCGUARD_NO_UPDATE_HINT/, 'names the opt-out');
      assert.match(text, /14 days/, 'states the threshold');
      assert.match(text, /docguard upgrade/, 'names the way to check');
    });
  }
});

describe('skills and privacy say the same thing (FR-006, FR-007)', () => {
  it('every shipped DocGuard skill carries the identical paragraph', () => {
    const root = join(REPO, 'extensions/spec-kit-docguard/skills');
    const paragraphs = readdirSync(root).filter(d => d.startsWith('docguard-')).map(d => {
      const text = readFileSync(join(root, d, 'SKILL.md'), 'utf8');
      const m = text.match(/## When DocGuard says it is old\n[\s\S]*?(?=\n## |\s*$)/);
      assert.ok(m, `${d} lacks the paragraph`);
      return m[0].trim();
    });
    assert.ok(paragraphs.length >= 5);
    assert.equal(new Set(paragraphs).size, 1, 'the paragraph is identical everywhere');
    assert.match(paragraphs[0], /Never upgrade DocGuard without the user's agreement/);
  });

  it('PRIVACY.md names the registry fetch and says the note makes no network call', () => {
    const privacy = readFileSync(join(REPO, 'PRIVACY.md'), 'utf8');
    assert.match(privacy, /docguard upgrade[^\n]*registry\.npmjs\.org/);
    assert.match(privacy, /no network call/i);
  });
});
