/**
 * @req docguard.release-cut-green#FR-001
 * @req docguard.release-cut-green#FR-002
 * @req docguard.release-cut-green#FR-004
 * @req docguard.release-cut-green#FR-005
 * @req docguard.release-cut-green#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notesSince, notesAsUnreleased } from './fixtures/changelog-notes.mjs';
import { cutChangelog, inferBump } from '../.github/scripts/release-changelog.mjs';
import { ensureSkills } from '../cli/ensure-skills.mjs';
import { RELEASE_PATH_ALLOWLIST } from '../cli/release-pr-policy.mjs';
import { execFileSync } from 'node:child_process';

const BASE = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- **feature X** ships.\n\n### Fixed\n\n- bug Y.\n\n## [0.42.1] - 2026-09-22\n\n### Fixed\n\n- old fix Z\n';
const cut = (text, version, commits = []) => cutChangelog(text, { version, date: '2026-10-01', lastTag: 'v0.42.1', commits });

describe('CHANGELOG checks read the notes their change shipped in (FR-001, FR-002)', () => {
  it('finds the notes before the cut, after it, and after a later cut', () => {
    const afterCut = cut(BASE, '0.43.0', ['abc1234 feat: X (#1)']);
    const later = cut(afterCut.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- next bug.\n'), '0.43.1');
    for (const text of [BASE, afterCut, later]) {
      const notes = notesSince(text, '0.42.1');
      assert.match(notes, /feature X/);
      assert.match(notes, /### Fixed[\s\S]*bug Y/);
      assert.doesNotMatch(notes, /old fix Z/);
      assert.equal(inferBump(notesAsUnreleased(text, '0.42.1')).bump, 'minor');
    }
    // The [Unreleased]-only reading these tests used to do is empty after the cut.
    assert.equal(inferBump(afterCut).bump, 'patch');
  });

  it('refuses to read the whole file when a bound is missing', () => {
    assert.throws(() => notesSince(BASE, '0.41.0'), /no ## \[0\.41\.0\] heading/);
    assert.throws(() => notesSince('# Changelog\n\n## [0.42.1]\n', '0.42.1'), /no ## \[Unreleased\]/);
  });

  it("this repository's notes since 0.42.1 cut a minor release", () => {
    assert.equal(inferBump(notesAsUnreleased(readFileSync('CHANGELOG.md', 'utf8'), '0.42.1')).bump, 'minor');
  });
});

describe('the release refreshes repository mirrors without ensureSkills (FR-004)', () => {
  it('the scheduled release never calls ensureSkills', () => {
    assert.doesNotMatch(readFileSync('.github/workflows/scheduled-release.yml', 'utf8'), /ensureSkills/);
  });
});

describe('ensureSkills requires the agent surface (FR-005)', () => {
  it('throws instead of silently installing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-ensure-surface-'));
    try {
      assert.throws(() => ensureSkills(dir, { format: 'json', noSpecKit: true }), /surface/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the release commits and admits every synchronized path (FR-006)', () => {
  // The files sync-release-version.mjs rewrites in this repository, mirrors included.
  const synchronized = execFileSync('git', ['ls-files', 'commands', 'extensions/spec-kit-docguard', '.agent/skills', '.agent/commands', 'templates/ci'], { encoding: 'utf8' })
    .split('\n').filter(p => /^(commands\/docguard\.[a-z-]+\.md|extensions\/spec-kit-docguard\/(extension\.yml|commands\/.+\.md|skills\/[^/]+\/SKILL\.md|templates\/github-workflows\/.+\.yml)|\.agent\/(skills\/[^/]+\/SKILL\.md|commands\/docguard\..+\.md)|templates\/ci\/github-actions\.yml)$/.test(p));

  it('the release-candidate policy admits each one', () => {
    assert.ok(synchronized.some(p => p.startsWith('.agent/commands/')), 'fixture: .agent/commands is tracked');
    for (const rel of synchronized) assert.match(rel, RELEASE_PATH_ALLOWLIST, rel);
  });

  it('the release commit stages each one', () => {
    const wf = readFileSync('.github/workflows/scheduled-release.yml', 'utf8');
    const add = wf.split('\n').find(line => /^\s*git add package\.json /.test(line));
    assert.ok(add, 'the release commit has a git add line');
    const specs = add.trim().replace(/ 2>\/dev\/null.*$/, '').split(/\s+/).slice(2);
    for (const rel of synchronized) {
      assert.ok(specs.some(s => (s.endsWith('/') ? rel.startsWith(s) : rel === s)), `${rel} is not staged by: ${add.trim()}`);
    }
  });
});
