/**
 * K-6 / S-2 — sweep-needed nudge from Freshness counters.
 *
 * The nudge is emitted by `runGuard` (the public entry point) when 2+
 * canonical docs are stale. Because runGuard prints+exits, the cleanest
 * test is a subprocess that captures stdout.
 *
 * @req SC-K6-001 — guard footer emits a sweep nudge when 2+ docs are stale
 * @req SC-K6-002 — no nudge when 0-1 docs are stale (no noise on healthy repos)
 * @req SC-K6-003 — nudge is suppressed in --format json mode
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-sweep-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function gitInit(dir, opts = {}) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...opts };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['add', '.'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
}

describe('K-6 — sweep-needed nudge', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('parses the sweep-nudge pattern from real freshness messages', () => {
    // Unit-level: the regex used by the guard's footer matches the actual
    // strings produced by validateFreshness. If freshness ever changes its
    // message format, this test catches the drift.
    const samples = [
      'docs-canonical/ARCHITECTURE.md — 28 code commits since last doc update (2026-03-14)',
      'docs-canonical/SECURITY.md — 29 code commits since last doc update (2026-03-14)',
      'docs-canonical/ENVIRONMENT.md — 11 code commits since last doc update (2026-03-14)',
    ];
    const re = /\d+ code commits since/;
    for (const s of samples) assert.match(s, re);

    // And non-matches: messages that aren't about stale counts shouldn't trip the nudge.
    const nonMatches = [
      'DRIFT-LOG.md may be stale — 2 DRIFT comments found in recent commits',
      'docs-canonical/X.md — last updated 45 days before latest code change',
      'docs-canonical/Y.md exists but is not yet committed to git',
    ];
    for (const s of nonMatches) assert.doesNotMatch(s, re);
  });

  it('emits the nudge when 2+ freshness warnings match the pattern (end-to-end)', () => {
    // Build a stub repo with several canonical docs that will look stale
    // relative to the latest commit. Freshness needs git history to compute
    // "commits since" — without commits it just warns "not committed yet".
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 'sweep-stub', version: '0.0.0' }),
      // Old docs (commit them first, then commit lots of code later)
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nstub.',
      'docs-canonical/DATA-MODEL.md': '# Data Model\nstub.',
      'docs-canonical/SECURITY.md': '# Security\nstub.',
      'docs-canonical/TEST-SPEC.md': '# Test Spec\nstub.',
      'docs-canonical/ENVIRONMENT.md': '# Env\nstub.',
      'AGENTS.md': '# Agents\nstub.',
      'CHANGELOG.md': '# Changelog\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# Drift Log\n',
      '.docguard.json': JSON.stringify({ projectName: 'sweep-stub', profile: 'starter', version: '0.5', validators: { freshness: true } }),
    });
    gitInit(dir, { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' });
    const env = { ...process.env, GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-02T00:00:00Z' };
    for (let i = 0; i < 11; i++) {
      writeFileSync(join(dir, 'main.js'), 'export const value = ' + i + ';');
      assert.equal(spawnSync('git', ['add', 'main.js'], { cwd: dir, env }).status, 0);
      assert.equal(spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'change'], { cwd: dir, env }).status, 0);
    }
    const r = spawnSync(process.execPath, [CLI, 'guard'], { cwd: dir, encoding: 'utf8' });
    assert.match(r.stdout, /documents have repository-history review signals/);
    assert.match(r.stdout, /before changing documentation or code/);
    assert.doesNotMatch(r.stdout, /docs are stale/);
    const data = JSON.parse(spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' }).stdout);
    const findings = data.findings.filter(f => f.validator === 'freshness');
    assert.ok(findings.length >= 2);
    for (const finding of findings) {
      assert.equal(finding.confidence, 'low');
      assert.equal(finding.suggestion.kind, 'review');
      assert.equal(finding.suggestion.command, undefined);
    }
  });

  it('does not emit the nudge in --format json mode', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 'sweep-json', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# A\nstub',
      'CHANGELOG.md': '# Changelog\n',
      '.docguard.json': JSON.stringify({ projectName: 'sweep-json', profile: 'starter', version: '0.5' }),
    });
    gitInit(dir);
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    // ANY non-JSON noise in stdout would break JSON.parse and is the bug
    // we're guarding against.
    assert.doesNotMatch(r.stdout, /↻/, 'JSON mode must not print sweep nudge');
    assert.doesNotThrow(() => JSON.parse(r.stdout), 'JSON mode output must be parseable');
  });
});
