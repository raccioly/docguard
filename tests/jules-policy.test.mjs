/**
 * Jules automation policy (specs/067-jules-policy): what a Google Jules PR may
 * merge alone, what triage closes, and what a routine works on.
 *
 * @req docguard.jules-policy#FR-001
 * @req docguard.jules-policy#FR-002
 * @req docguard.jules-policy#FR-003
 * @req docguard.jules-policy#FR-004
 * @req docguard.jules-policy#FR-005
 * @req docguard.jules-policy#FR-006
 * @req docguard.jules-policy#FR-007
 * @req docguard.jules-policy#FR-008
 * @req docguard.jules-policy#FR-009
 * @req docguard.jules-policy#FR-010
 * @req docguard.jules-policy#FR-011
 * @req docguard.jules-policy#FR-012
 * @req docguard.jules-policy#FR-013
 * @req docguard.jules-policy#SC-001
 * @req docguard.jules-policy#SC-002
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLINE_WINDOW_DAYS, LABELS, MAX_FILES, QUEUE_CAP, ROUTINES, SCHEDULE,
  bugHuntTargets, contractReason, dupKey, helpSubcommands, isJules, isoWeek, mergeVerdict,
  noiseReason, parseTag, pickTarget, tagTitle, triage, untestedExports,
} from '../.github/scripts/jules-policy.mjs';
import { run as runTriage } from '../.github/scripts/jules-triage.mjs';
import { FIXTURE_GIT } from './helpers/git.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const NOW = '2026-10-10T12:00:00Z';
const DAY = 86_400_000;
const daysAgo = (n, from = NOW) => new Date(Date.parse(from) - n * DAY).toISOString();
const added = (filename) => ({ filename, status: 'added' });
const modified = (filename) => ({ filename, status: 'modified' });
const openPr = (number, title, files = [], labels = []) => ({ number, title, files, labels });
const HANDLE = /@\s*jules\b/i;

describe('who and what a Jules PR is', () => {
  it('recognises the bot under the spellings GitHub uses, and nobody else', () => {
    assert.equal(isJules('google-labs-jules[bot]'), true);
    assert.equal(isJules('app/google-labs-jules[bot]'), true);
    assert.equal(isJules('google-labs-jules'), true);
    for (const login of ['raccioly', 'dependabot[bot]', 'github-actions[bot]', undefined]) assert.equal(isJules(login), false);
  });

  it('reads the routine tag a title starts with, and only for a known routine', () => {
    assert.deepEqual(ROUTINES, ['bug-hunt', 'test-gaps', 'docs-drift']);
    assert.deepEqual(parseTag('[jules:test-gaps] cli/shared-ignore.mjs — four exports'), { routine: 'test-gaps', target: 'cli/shared-ignore.mjs' });
    assert.deepEqual(parseTag(tagTitle('docs-drift', 'guard')), { routine: 'docs-drift', target: 'guard' });
    assert.equal(parseTag('[jules:sentinel] anything'), null);
    assert.equal(parseTag('test: add tests'), null);
  });

  it('keys a change by its files, ignoring the changelog and order', () => {
    assert.equal(dupKey(['b.mjs', 'CHANGELOG.md', 'a.mjs']), dupKey(['a.mjs', 'b.mjs']));
    assert.equal(dupKey(['CHANGELOG.md']), '');
  });
});

describe('the merge gate: only new test modules merge alone (FR-001)', () => {
  it('merges #324, one added test module, and up to the file limit of them', () => {
    assert.deepEqual(mergeVerdict({ files: [added('tests/shared-ignore-functions.test.mjs')] }), { verdict: 'merge', reason: '1 new test file(s)' });
    const many = Array.from({ length: MAX_FILES }, (_, i) => added(`tests/area-${i}.test.mjs`));
    assert.equal(mergeVerdict({ files: many }).verdict, 'merge');
    assert.equal(MAX_FILES, 10);
  });

  it('holds #421, #451 and #516, which edited existing tests', () => {
    for (const files of [
      [modified('tests/shared-git.test.mjs')],
      [modified('tests/docs-diff.test.mjs')],
      [modified('tests/commands.test.mjs'), modified('tests/sync.test.mjs')],
      [added('tests/new.test.mjs'), modified('tests/commands.test.mjs')],
    ]) {
      const v = mergeVerdict({ files });
      assert.equal(v.verdict, 'hold', JSON.stringify(files));
      assert.match(v.reason, /edits an existing test/);
    }
  });

  it('holds every path the old Markdown filter merged, added or modified', () => {
    const paths = [
      'AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGELOG.md', '.jules/RULES.md', '.jules/routines/bug-hunt.md',
      '.agents/skills/docguard-guard/SKILL.md', '.specify/memory/constitution.md',
      'commands/docguard.guard.md', 'templates/AGENTS.md', 'extensions/spec-kit-docguard/commands/guard.md',
      'docs/commands.md', 'docs-canonical/SECURITY.md', 'specs/067-jules-policy/spec.md',
      'tests/fixtures/sample/a.test.mjs', 'tests/fixtures/sample/README.md', 'tests/helpers/git.mjs',
      'tests/nested/deep.test.mjs', 'tests/helper.mjs', 'tests/notes.md', 'cli/docguard.mjs', '.github/workflows/ci.yml',
      'package.json', 'package-lock.json',
    ];
    for (const path of paths) {
      for (const f of [added(path), modified(path)]) {
        const v = mergeVerdict({ files: [f] });
        assert.equal(v.verdict, 'hold', `${f.status} ${path}`);
        assert.ok(v.reason.includes(path), v.reason);
      }
    }
  });

  it('holds a removed, renamed or copied file, an empty change and one over the limit', () => {
    const cases = [
      [[{ filename: 'tests/old.test.mjs', status: 'removed' }], /removed/],
      [[{ filename: 'tests/new.test.mjs', status: 'renamed', previous_filename: 'tests/old.test.mjs' }], /renamed/],
      [[{ filename: 'tests/copy.test.mjs', status: 'copied', previous_filename: 'tests/old.test.mjs' }], /copied/],
      [[{ filename: 'tests/new.test.mjs', status: 'added', previous_filename: 'tests/old.test.mjs' }], /renam|previous/],
      [[], /no files/],
      [Array.from({ length: MAX_FILES + 1 }, (_, i) => added(`tests/area-${i}.test.mjs`)), /limit/],
    ];
    for (const [files, why] of cases) {
      const v = mergeVerdict({ files });
      assert.equal(v.verdict, 'hold');
      assert.match(v.reason, why);
    }
  });
});

describe('auto-merge reads the verified head and pins the merge (FR-002)', () => {
  const wf = read('.github/workflows/auto-merge.yml');

  it('asks the policy module, on the comparison of the base with the CI-verified head', () => {
    assert.match(wf, /\.github\/scripts\/jules-policy\.mjs/);
    assert.match(wf, /mergeVerdict\(\{ files: /);
    assert.match(wf, /compareCommitsWithBasehead\(\{[^}]*basehead: `\$\{pr\.base\.sha\}\.\.\.\$\{headSha\}`/);
    assert.doesNotMatch(wf, /pulls\.listFiles/);
    assert.doesNotMatch(wf, /endsWith\('\.md'\)|startsWith\('docs\/'\)/);
  });

  it('merges pinned to the head CI verified', () => {
    assert.match(wf, /pulls\.merge\(\{[^}]*sha: headSha/);
  });

  it('keeps the Dependabot rule, the exact-run check and the default-branch policy checkout', () => {
    assert.match(wf, /from \(\\d\+\)\\\.\(\\d\+\)\\\.\(\\d\+\)\\S\* to/);
    assert.match(wf, /Majors are never auto-merged/);
    assert.match(wf, /evaluateReleaseJobs\(runJobs\.jobs\)/);
    assert.match(wf, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n\s+persist-credentials: false/);
    assert.match(wf, /headSha !== pr\.head\.sha/);
  });
});

describe('triage: noise (FR-003)', () => {
  it('closes the empty #305, #306, #316 and #327, and the .jules-only #297', () => {
    for (const title of ['chore: @babel/parser is up to date', 'chore: verify test stability', 'Check @babel/parser update', 'chore(deps): up to date @babel/parser']) {
      assert.match(noiseReason({ title, files: [] }), /no files/);
    }
    assert.match(noiseReason({ title: '🎨 Palette: Init palette journal', files: [added('.jules/palette.md')] }), /\.jules/);
  });

  it('closes a report that nothing needed changing, and a count sync in user docs', () => {
    assert.ok(noiseReason({ title: 'chore: @babel/parser is up to date', files: [modified('package-lock.json')] }));
    assert.ok(noiseReason({ title: 'Palette: No changes required', files: [modified('README.md')] }));
    assert.ok(noiseReason({ title: 'docs: sync test count metric', files: [modified('README.md'), modified('docs/testing.md')] }));
  });

  it('does not call a count fix in code noise, nor an ordinary fix', () => {
    assert.equal(noiseReason({ title: 'fix: count of findings is off by one', files: [modified('cli/commands/score.mjs')] }), null);
    assert.equal(noiseReason({ title: '[jules:docs-drift] guard — --compact is undocumented', files: [modified('docs/commands.md')] }), null);
  });
});

describe('triage: never by subject (FR-006)', () => {
  it('keeps a security or performance finding with code for a maintainer, whatever its title says', () => {
    const findings = [
      ['🛡️ Sentinel: [CRITICAL] Fix path traversal in report --out', [modified('cli/commands/report.mjs'), added('tests/report-out-path.test.mjs')]],
      ['🛡️ Sentinel: [HIGH] Fix command injection via execSync in a new spawn path', [modified('cli/shared-git.mjs')]],
      ['⚡ Bolt: [performance improvement] Optimize guard by caching parsed ASTs', [modified('cli/scanners/js-ast.mjs')]],
      ['perf: precompute basenames, O(N) single-pass Set comparison', [modified('cli/commands/diff.mjs')]],
    ];
    for (const [title, files] of findings) {
      const d = triage({ pr: { number: 70, title, files }, open: [], closed: [], now: NOW });
      assert.deepEqual([d.action, d.label], ['keep', LABELS.review], title);
    }
  });

  it('labels a kept PR eligible only when its files could merge alone', () => {
    const tests = triage({ pr: { number: 71, title: 'test: cover shared-ignore', files: [added('tests/shared-ignore-more.test.mjs')] }, open: [], closed: [], now: NOW });
    assert.deepEqual([tests.action, tests.label], ['keep', LABELS.eligible]);
    const docs = triage({ pr: { number: 72, title: 'docs: fix an example', files: [modified('docs/commands.md')] }, open: [], closed: [], now: NOW });
    assert.deepEqual([docs.action, docs.label], ['keep', LABELS.review]);
  });

  it('carries no keyword list in the policy', () => {
    const policy = read('.github/scripts/jules-policy.mjs');
    assert.doesNotMatch(policy, /command injection|execFileSync|performance|optimi\[sz\]e|sentinel|bolt|palette/i);
  });
});

describe('triage: duplicates, declines and the queue (FR-004, FR-005)', () => {
  const pr = { number: 50, title: '[jules:test-gaps] cli/shared-ignore.mjs — three exports', files: [added('tests/shared-ignore-exports.test.mjs')] };

  it('closes the newer of two PRs for the same routine target, whatever files they touch', () => {
    const d = triage({ pr, open: [openPr(41, '[jules:test-gaps] cli/shared-ignore.mjs — other wording', ['tests/other.test.mjs'])], closed: [], now: NOW });
    assert.deepEqual([d.action, d.label, d.ref], ['close', LABELS.duplicate, 41]);
    assert.match(d.reason, /#41/);
  });

  it('closes the newer of two PRs with the same files (#324 then #329), whatever they are titled', () => {
    const newer = { number: 329, title: 'test: Add unit tests for shared-ignore detection utilities', files: [added('tests/shared-ignore-functions.test.mjs')] };
    const older = openPr(324, 'test: add tests for untested shared-ignore utilities', ['tests/shared-ignore-functions.test.mjs', 'CHANGELOG.md']);
    assert.deepEqual([triage({ pr: newer, open: [older], closed: [], now: NOW }).action], ['close']);
    assert.equal(triage({ pr: { ...newer, number: 300 }, open: [older], closed: [], now: NOW }).action, 'keep');
  });

  it('closes work declined within the window, and allows it again after', () => {
    const declined = (closedAt, labels = []) => ({ number: 12, title: pr.title, files: [], labels, mergedAt: null, closedAt });
    const d = triage({ pr, open: [], closed: [declined(daysAgo(DECLINE_WINDOW_DAYS - 1))], now: NOW });
    assert.deepEqual([d.action, d.label, d.ref], ['close', LABELS.declined, 12]);
    assert.equal(triage({ pr, open: [], closed: [declined(daysAgo(DECLINE_WINDOW_DAYS + 1))], now: NOW }).action, 'keep');
    assert.equal(DECLINE_WINDOW_DAYS, 60);
  });

  it('does not count a merged PR, a queue-full close or an off-contract close as declined', () => {
    const closed = [
      { number: 12, title: pr.title, files: [], labels: [], mergedAt: daysAgo(3), closedAt: daysAgo(3) },
      { number: 13, title: pr.title, files: [], labels: [{ name: LABELS.queueFull }], mergedAt: null, closedAt: daysAgo(3) },
      { number: 14, title: pr.title, files: [], labels: [{ name: LABELS.offContract }], mergedAt: null, closedAt: daysAgo(3) },
    ];
    assert.equal(triage({ pr, open: [], closed, now: NOW }).action, 'keep');
  });

  it(`closes a new PR once ${QUEUE_CAP} are waiting, and not before`, () => {
    const waiting = (n) => Array.from({ length: n }, (_, i) => openPr(i + 1, `[jules:docs-drift] cmd${i}`, [`docs/${i}.md`]));
    assert.equal(QUEUE_CAP, 5);
    assert.deepEqual([triage({ pr, open: waiting(QUEUE_CAP), closed: [], now: NOW }).label], [LABELS.queueFull]);
    assert.equal(triage({ pr, open: waiting(QUEUE_CAP - 1), closed: [], now: NOW }).action, 'keep');
    const overflow = Array.from({ length: QUEUE_CAP }, (_, i) => openPr(i + 1, `t${i}`, [`docs/${i}.md`], [{ name: LABELS.queueFull }]));
    assert.equal(triage({ pr, open: overflow, closed: [], now: NOW }).action, 'keep');
  });
});

describe('triage: routine contracts (FR-008)', () => {
  const cases = [
    ['[jules:bug-hunt] cli/validators/freshness.mjs — stale date', [modified('cli/validators/freshness.mjs')], /new test/],
    ['[jules:bug-hunt] cli/validators/freshness.mjs — stale date', [modified('cli/validators/freshness.mjs'), modified('tests/freshness.test.mjs')], /new test/],
    ['[jules:test-gaps] cli/shared-ignore.mjs — exports', [added('tests/a.test.mjs'), modified('cli/shared-ignore.mjs')], /only add/],
    ['[jules:test-gaps] cli/shared-ignore.mjs — exports', [modified('tests/shared-ignore.test.mjs')], /only add/],
    ['[jules:docs-drift] guard — flag', [modified('docs/commands.md'), modified('cli/docguard.mjs')], /user docs/],
    ['[jules:docs-drift] guard — flag', [modified('docs/reference/findings.md')], /user docs/],
    ['[jules:docs-drift] guard — flag', [modified('AGENTS.md')], /user docs/],
  ];
  it('closes a routine PR outside its contract', () => {
    for (const [title, files, why] of cases) {
      assert.match(contractReason({ title, files }) ?? '', why, title);
      const d = triage({ pr: { number: 80, title, files }, open: [], closed: [], now: NOW });
      assert.deepEqual([d.action, d.label], ['close', LABELS.offContract], title);
    }
  });

  it('keeps one inside it', () => {
    const inside = [
      ['[jules:bug-hunt] cli/validators/freshness.mjs — stale date', [modified('cli/validators/freshness.mjs'), added('tests/freshness-stale-date.test.mjs')], LABELS.review],
      ['[jules:test-gaps] cli/shared-ignore.mjs — exports', [added('tests/shared-ignore-exports.test.mjs')], LABELS.eligible],
      ['[jules:docs-drift] guard — flag', [modified('docs/commands.md'), modified('README.md'), modified('README.pt-BR.md')], LABELS.review],
    ];
    for (const [title, files, label] of inside) {
      assert.equal(contractReason({ title, files }), null, title);
      assert.deepEqual(triage({ pr: { number: 81, title, files }, open: [], closed: [], now: NOW }).label, label);
    }
    assert.equal(contractReason({ title: 'untagged', files: [modified('cli/x.mjs')] }), null);
  });
});

describe('no comment or reason names the agent (FR-007)', () => {
  it('in any policy reason', () => {
    const reasons = [];
    const prs = [
      { number: 9, title: 'x', files: [] },
      { number: 9, title: '[jules:bug-hunt] cli/a.mjs — x', files: [modified('cli/a.mjs')] },
      { number: 9, title: 'fix', files: [modified('cli/a.mjs')] },
      { number: 9, title: 'test', files: [added('tests/a.test.mjs')] },
    ];
    for (const pr of prs) reasons.push(triage({ pr, open: [], closed: [], now: NOW }).reason);
    reasons.push(triage({ pr: prs[2], open: [openPr(1, 'y', ['cli/a.mjs'])], closed: [], now: NOW }).reason);
    for (const files of [[], [modified('tests/a.test.mjs')], [added('AGENTS.md')]]) reasons.push(mergeVerdict({ files }).reason);
    for (const reason of reasons) assert.doesNotMatch(reason, HANDLE);
  });

  it('in the workflows and scripts that write comments', () => {
    for (const path of ['.github/workflows/auto-merge.yml', '.github/workflows/jules-triage.yml', '.github/scripts/jules-triage.mjs', '.github/scripts/jules-policy.mjs']) {
      assert.doesNotMatch(read(path), HANDLE, path);
    }
  });
});

/** An in-memory GitHub with the paging behaviour of the REST API. */
function fakeGithub({ pulls, files = {} }) {
  const calls = [];
  const writes = { comments: [], labels: [], closed: [] };
  const page = (items, { per_page = 30, page: n = 1 }) => items.slice((n - 1) * per_page, n * per_page);
  const rest = {
    pulls: {
      get: async ({ pull_number }) => ({ data: pulls.find((p) => p.number === pull_number) }),
      list: async (params) => {
        calls.push(['pulls.list', params.state, params.page ?? 1]);
        let items = pulls.filter((p) => p.state === params.state);
        if (params.sort === 'updated') items = [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        return { data: page(items, params) };
      },
      listFiles: async (params) => {
        calls.push(['pulls.listFiles', params.pull_number, params.page ?? 1]);
        return { data: page(files[params.pull_number] ?? [], params) };
      },
      update: async ({ pull_number, state }) => { writes.closed.push([pull_number, state]); return { data: {} }; },
    },
    issues: {
      createLabel: async () => ({ data: {} }),
      addLabels: async ({ issue_number, labels }) => { writes.labels.push([issue_number, ...labels]); return { data: {} }; },
      createComment: async ({ issue_number, body }) => { writes.comments.push([issue_number, body]); return { data: {} }; },
    },
  };
  const paginate = async (method, params, mapFn) => {
    const out = [];
    let stop = false;
    for (let n = 1; ; n++) {
      const response = await method({ ...params, page: n });
      out.push(...(mapFn ? mapFn(response, () => { stop = true; }) : response.data));
      if (stop || response.data.length < (params.per_page ?? 30)) return out;
    }
  };
  return { github: { rest, paginate }, calls, writes };
}

const JULES = { login: 'google-labs-jules[bot]' };
const HUMAN = { login: 'raccioly' };
const pull = (number, { user = JULES, state = 'open', title = `pr ${number}`, labels = [], merged_at = null, closed_at = null, updated_at = NOW } = {}) =>
  ({ number, user, state, title, labels, merged_at, closed_at, updated_at });
const runOn = (number, gh) => runTriage({
  github: gh.github,
  context: { repo: { owner: 'raccioly', repo: 'docguard' }, payload: { pull_request: { number } } },
  core: { info() {}, notice() {} },
  now: NOW,
});

describe('the triage glue (FR-004, FR-005, FR-007)', () => {
  it('reads open Jules PRs past the first page, so the queue cap holds', async () => {
    const humans = Array.from({ length: 150 }, (_, i) => pull(1000 + i, { user: HUMAN }));
    const jules = Array.from({ length: QUEUE_CAP }, (_, i) => pull(2000 + i, { title: `[jules:docs-drift] c${i}` }));
    const gh = fakeGithub({ pulls: [...humans, ...jules, pull(3000, { title: 'test: one more' })], files: { 3000: [added('tests/one-more.test.mjs')] } });
    await runOn(3000, gh);
    assert.deepEqual(gh.writes.closed, [[3000, 'closed']]);
    assert.deepEqual(gh.writes.labels, [[3000, LABELS.queueFull]]);
    assert.ok(gh.calls.some(([m, state, n]) => m === 'pulls.list' && state === 'open' && n === 2));
  });

  it('finds a decline past the first page of closed PRs, and stops paging at the window', async () => {
    const closed = Array.from({ length: 400 }, (_, i) => {
      const at = daysAgo(i < 200 ? 1 + i * 0.25 : DECLINE_WINDOW_DAYS + 1 + i);
      return pull(4000 + i, { user: i === 150 ? JULES : HUMAN, state: 'closed', title: i === 150 ? '[jules:test-gaps] cli/a.mjs — x' : `c${i}`, closed_at: at, updated_at: at });
    });
    const gh = fakeGithub({ pulls: [...closed, pull(5000, { title: '[jules:test-gaps] cli/a.mjs — again' })], files: { 5000: [added('tests/a-again.test.mjs')] } });
    await runOn(5000, gh);
    assert.deepEqual(gh.writes.labels, [[5000, LABELS.declined]]);
    assert.match(gh.writes.comments[0][1], /#4150/);
    const closedPages = gh.calls.filter(([m, state]) => m === 'pulls.list' && state === 'closed').map(([, , n]) => n);
    assert.deepEqual(closedPages, [1, 2, 3]);
  });

  it('reads every page of a PR file list', async () => {
    const shared = Array.from({ length: 100 }, (_, i) => added(`tests/t${i}.test.mjs`));
    const gh = fakeGithub({
      pulls: [pull(10, { title: 'older' }), pull(11, { title: 'newer' })],
      files: { 10: [...shared, added('tests/only-in-10.test.mjs')], 11: [...shared, added('tests/only-in-11.test.mjs')] },
    });
    await runOn(11, gh);
    assert.deepEqual(gh.writes.closed, []);
    assert.ok(gh.calls.some(([m, n, p]) => m === 'pulls.listFiles' && n === 11 && p === 2));
  });

  it('comments with a marker and never mentions the agent; ignores a human PR', async () => {
    const gh = fakeGithub({ pulls: [pull(20, { title: 'chore: verify test stability' }), pull(21, { user: HUMAN })] });
    await runOn(20, gh);
    await runOn(21, gh);
    assert.equal(gh.writes.comments.length, 1);
    const [[number, body]] = gh.writes.comments;
    assert.equal(number, 20);
    assert.match(body, /<!-- docguard-jules:triage -->/);
    assert.doesNotMatch(body, HANDLE);
    assert.deepEqual(gh.writes.closed, [[20, 'closed']]);
  });
});

describe('the triage workflow only runs the script (FR-004 – FR-007)', () => {
  const wf = read('.github/workflows/jules-triage.yml');
  it('checks out the default branch without credentials and never the PR head', () => {
    assert.match(wf, /pull_request_target:/);
    assert.match(wf, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n\s+persist-credentials: false/);
    assert.doesNotMatch(wf, /pull_request\.head|head\.ref|head\.sha/);
    assert.match(wf, /\.github\/scripts\/jules-triage\.mjs/);
    assert.match(wf, /concurrency:/);
    for (const [, sha] of wf.matchAll(/uses:\s*[^@\s]+@(\S+)/g)) assert.match(sha, /^[a-f0-9]{40}$/);
  });
});

describe('what a routine works on (FR-009, FR-010)', () => {
  const candidates = ['a', 'b', 'c', 'd'];
  const pick = (open = [], closed = [], now = NOW) => pickTarget({ routine: 'test-gaps', candidates, open, closed, now });

  it('numbers ISO weeks the way the standard does at the year boundaries', () => {
    assert.equal(isoWeek('2026-01-01T00:00:00Z'), 1);
    assert.equal(isoWeek('2021-01-03T00:00:00Z'), 53);
    assert.equal(isoWeek('2024-12-30T00:00:00Z'), 1);
    assert.equal(isoWeek(NOW), 41);
  });

  it('starts the rotation at the week and moves one target per week', () => {
    assert.deepEqual(pick(), { go: true, target: candidates[41 % 4] });
    assert.equal(pick([], [], '2026-10-17T12:00:00Z').target, candidates[42 % 4]);
  });

  it('skips a target declined for the same routine, not one declined for another', () => {
    const closed = [{ number: 2, title: tagTitle('test-gaps', 'b'), labels: [], mergedAt: null, closedAt: daysAgo(5) }];
    assert.equal(pick([], closed).target, 'c');
    assert.equal(pick([], [{ ...closed[0], title: tagTitle('docs-drift', 'b') }]).target, 'b');
    assert.equal(pick([], [{ ...closed[0], labels: [{ name: LABELS.offContract }] }]).target, 'b');
  });

  it('stops while the routine has a PR waiting, when the queue is full, when nothing is left, and for an unknown routine', () => {
    const own = pick([openPr(7, tagTitle('test-gaps', 'a'))]);
    assert.equal(own.go, false);
    assert.match(own.reason, /#7/);
    assert.equal(pick([openPr(7, tagTitle('docs-drift', 'a'))]).go, true);
    const full = Array.from({ length: QUEUE_CAP }, (_, i) => openPr(i, `t${i}`));
    assert.match(pick(full).reason, /queue is full/);
    const declinedAll = candidates.map((c, i) => ({ number: i, title: tagTitle('test-gaps', c), labels: [], mergedAt: null, closedAt: daysAgo(1) }));
    assert.match(pick([], declinedAll).reason, /every/);
    assert.equal(pickTarget({ routine: 'bolt', candidates, open: [], closed: [], now: NOW }).go, false);
    assert.equal(pickTarget({ routine: 'test-gaps', candidates: [], open: [], closed: [], now: NOW }).go, false);
  });
});

function cliModules() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.mjs')) out.push({ path: rel, source: read(rel) });
    }
  };
  walk('cli');
  return out;
}

describe('the target lists come from the repository (FR-010)', () => {
  it('bug-hunt walks validator and scanner modules that name a governing spec', () => {
    const synthetic = [
      { path: 'cli/validators/b.mjs', source: '/** @implements docguard.alpha#FR-001 */' },
      { path: 'cli/validators/a.mjs', source: '// no spec' },
      { path: 'cli/scanners/c.mjs', source: '// @implements docguard.beta#FR-002' },
      { path: 'cli/commands/d.mjs', source: '// @implements docguard.gamma#FR-001' },
    ];
    assert.deepEqual(bugHuntTargets(synthetic), ['cli/scanners/c.mjs', 'cli/validators/b.mjs']);
    const real = bugHuntTargets(cliModules());
    assert.ok(real.length > 20, `${real.length} targets`);
    for (const path of real) assert.match(read(path), /@implements docguard\.[a-z0-9-]+#/);
  });

  it('test-gaps walks modules whose exported functions no test imports, most untested first', () => {
    const modules = [
      { path: 'cli/a.mjs', source: 'export function one() {}\nexport async function two() {}\nexport const three = (x) => x;\nexport const DATA = {};\nfunction hidden() {}' },
      { path: 'cli/b.mjs', source: 'export function four() {}\nexport function five() {}\nexport { six as seven };\nfunction six() {}' },
      { path: 'cli/c.mjs', source: 'export function eight() {}' },
      { path: 'cli/d.mjs', source: 'export function nine() {}\nexport function ten() {}\nexport function eleven() {}' },
      { path: 'cli/e.mjs', source: "export { nine, ten as tenth } from './d.mjs';\nexport * from './f.mjs';" },
      { path: 'cli/f.mjs', source: 'export function twelve() {}' },
    ];
    const tests = [
      { path: 'tests/a.test.mjs', source: "import { one, two as second } from '../cli/a.mjs';\nconst { four } = await import('../cli/b.mjs');" },
      { path: 'tests/c.test.mjs', source: "import * as c from '../cli/c.mjs';\nc.eight();" },
      { path: 'tests/e.test.mjs', source: "import { nine, tenth, twelve } from '../cli/e.mjs';" },
    ];
    assert.deepEqual(untestedExports({ modules, tests }), [
      { file: 'cli/b.mjs', names: ['five', 'seven'] },
      { file: 'cli/a.mjs', names: ['three'] },
      { file: 'cli/d.mjs', names: ['eleven'] },
    ]);
    const real = untestedExports({ modules: cliModules(), tests: readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => ({ path: `tests/${f}`, source: read(`tests/${f}`) })) });
    assert.ok(real.length > 0);
    for (const { file, names } of real) {
      assert.match(file, /^cli\/.+\.mjs$/);
      assert.ok(names.length > 0);
    }
  });

  it('docs-drift walks the subcommands the real --help lists', () => {
    const help = execFileSync(process.execPath, [join(ROOT, 'cli', 'docguard.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const subs = helpSubcommands(help);
    for (const name of ['init', 'guard', 'diff', 'score', 'specs', 'verify', 'ci']) assert.ok(subs.includes(name), name);
    for (const name of ['badge', 'publish', 'setup', 'docguard', 'npx']) assert.ok(!subs.includes(name), name);
    assert.equal(new Set(subs).size, subs.length);
  });
});

describe('preflight prints GO or STOP and fails closed (FR-009)', () => {
  const servers = [];
  after(() => { for (const s of servers) s.close(); });
  const serve = (routes) => new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const body = routes[url.searchParams.get('state')];
      if (!body) { res.writeHead(500).end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(url.searchParams.get('page') === '1' || !url.searchParams.get('page') ? body : []));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  const preflight = (routine, api) => new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, '.jules', 'preflight.mjs'), routine], { env: { ...process.env, DOCGUARD_JULES_API: api, NO_COLOR: '1' }, encoding: 'utf8' },
      (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
  });
  const julesPr = (number, title, state = 'open') => ({ number, title, state, user: JULES, labels: [], merged_at: null, closed_at: state === 'closed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() });

  it('GO: one target and the title to use', async () => {
    const api = await serve({ open: [], closed: [] });
    const { code, stdout } = await preflight('test-gaps', api);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /^GO\nroutine: test-gaps\ntarget: cli\/\S+\.mjs\n/);
    assert.match(stdout, /^untested exports: \S/m);
    assert.match(stdout, /^title: \[jules:test-gaps\] cli\/\S+ — <one-line summary>$/m);
  });

  it('STOP with exit 3: the routine has a PR waiting, the queue is full, an unknown routine, an unreadable queue', async () => {
    const own = await serve({ open: [julesPr(9, '[jules:docs-drift] guard — x')], closed: [] });
    let r = await preflight('docs-drift', own);
    assert.equal(r.code, 3);
    assert.match(r.stdout, /^STOP: .*#9/);
    const full = await serve({ open: Array.from({ length: QUEUE_CAP }, (_, i) => julesPr(i + 1, `t${i}`)), closed: [] });
    r = await preflight('bug-hunt', full);
    assert.equal(r.code, 3);
    assert.match(r.stdout, /^STOP: the review queue is full/);
    r = await preflight('sentinel', full);
    assert.equal(r.code, 3);
    assert.match(r.stdout, /^STOP: unknown routine/);
    r = await preflight('bug-hunt', await serve({}));
    assert.equal(r.code, 3);
    assert.match(r.stdout, /^STOP: cannot read the pull request queue/);
  });
});

describe('environment setup fails closed (FR-011)', () => {
  const setup = read('.jules/setup.sh');
  const commands = setup.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');

  it('is strict, installs from the lockfile, carries no credentials, and the old script is gone', () => {
    assert.match(setup, /^#!\/usr\/bin\/env bash\n/);
    assert.match(setup, /^set -euo pipefail$/m);
    assert.match(setup, /^npm ci\b/m);
    assert.match(setup, /^npm test$/m);
    assert.match(setup, /git fetch --unshallow/);
    assert.doesNotMatch(commands, /\|\|\s*echo|\|\|\s*true/);
    assert.doesNotMatch(commands, /(API_KEY|TOKEN|SECRET|PASSWORD)\s*=/i);
    assert.equal(spawnSync('bash', ['-n', join(ROOT, '.jules', 'setup.sh')]).status, 0);
    assert.equal(existsSync(join(ROOT, '.jules-setup.sh')), false);
  });

  // Runs the real script in a scratch repository whose npm and CLI are stubs,
  // so the exit status is decided by the script, not by this repository's suite.
  const scratch = (testExit, guardExit) => {
    const dir = mkdtempSync(join(tmpdir(), 'jules-setup-'));
    const bin = join(dir, 'bin');
    mkdirSync(join(dir, 'repo', '.jules'), { recursive: true });
    mkdirSync(join(dir, 'repo', 'cli'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(dir, 'repo', '.jules', 'setup.sh'), setup);
    writeFileSync(join(dir, 'repo', 'cli', 'docguard.mjs'), `process.exit(${guardExit});\n`);
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\ncase "$1" in test) exit ${testExit};; esac\nexit 0\n`);
    chmodSync(join(bin, 'npm'), 0o755);
    const env = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir,
      GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    };
    const git = (...args) => execFileSync('git', [...FIXTURE_GIT, ...args], { cwd: join(dir, 'repo'), env, stdio: 'pipe' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const r = spawnSync('bash', ['.jules/setup.sh'], { cwd: join(dir, 'repo'), env, encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    return r;
  };

  it('fails when the suite is red, and when guard reports errors', () => {
    const red = scratch(1, 0);
    assert.notEqual(red.status, 0);
    assert.doesNotMatch(red.stdout, /^ready$/m);
    const guardErrors = scratch(0, 1);
    assert.notEqual(guardErrors.status, 0);
    assert.doesNotMatch(guardErrors.stdout, /^ready$/m);
  });

  it('succeeds on a green suite with guard warnings, leaving the tree clean', () => {
    const green = scratch(0, 2);
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /^ready$/m);
  });
});

describe('routines decide or stop, and live in the repository (FR-012)', () => {
  const rules = read('.jules/RULES.md');
  const readme = read('.jules/README.md');

  it('RULES.md forbids questions: decide pessimistically or stop with a summary', () => {
    assert.match(rules, /^## \d+\. Never ask a question: decide, or stop$/m);
    assert.match(rules, /waiting for your input/);
    assert.match(rules, /pessimistic/i);
    assert.match(rules, /no pull request/);
  });

  it('every routine has a file, a weekday, and a one-line UI prompt that points at it', () => {
    assert.deepEqual(SCHEDULE.map(([name]) => name), ROUTINES);
    for (const [name, day] of SCHEDULE) {
      const routine = read(`.jules/routines/${name}.md`);
      assert.match(routine, new RegExp(`node \\.jules/preflight\\.mjs ${name}`));
      assert.match(routine, /RULES\.md/);
      const prompt = `Follow .jules/routines/${name}.md exactly. Read .jules/RULES.md first. If preflight prints STOP, end the task with no changes and no pull request.`;
      assert.ok(readme.includes(`| ${name} | Weekly, ${day} | \`${prompt}\` |`), `${name} row in .jules/README.md`);
    }
    assert.deepEqual(readdirSync(join(ROOT, '.jules', 'routines')).sort(), ROUTINES.map((n) => `${n}.md`).sort());
    assert.match(readme, /bash \.jules\/setup\.sh/);
  });

  it('bug-hunt lands a failing test first; test-gaps only adds test files', () => {
    assert.match(read('.jules/routines/bug-hunt.md'), /fail/i);
    assert.match(read('.jules/routines/test-gaps.md'), /new/i);
  });
});

describe('the persona notes are retired and the docs describe the policy (FR-013)', () => {
  it('removes sentinel, bolt and palette and every reference to them', () => {
    for (const name of ['sentinel', 'bolt', 'palette']) assert.equal(existsSync(join(ROOT, '.jules', `${name}.md`)), false, name);
    for (const path of ['AGENTS.md', 'docs-canonical/ARCHITECTURE.md', '.jules/README.md', '.jules/RULES.md']) {
      assert.doesNotMatch(read(path), /\.jules\/(sentinel|bolt|palette)\.md|\.jules-setup\.sh/, path);
    }
  });

  it('AGENTS.md, ARCHITECTURE.md and TEST-SPEC.md name the policy', () => {
    const agents = read('AGENTS.md');
    assert.match(agents, /\.github\/scripts\/jules-policy\.mjs/);
    assert.match(agents, /\.jules\/RULES\.md/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /`\.jules\/`/);
    assert.match(read('docs-canonical/TEST-SPEC.md'), /`\.github\/scripts\/jules-policy\.mjs`.*`tests\/jules-policy\.test\.mjs`/);
  });
});
