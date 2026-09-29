/**
 * Field report follow-ups — the remaining acceptance criteria of #438, #437,
 * #436 and the fix for #454.
 *
 * @req docguard.field-report-followups#FR-001
 * @req docguard.field-report-followups#FR-002
 * @req docguard.field-report-followups#FR-003
 * @req docguard.field-report-followups#FR-004
 * @req docguard.field-report-followups#FR-005
 * @req docguard.field-report-followups#SC-001
 * @req docguard.field-report-followups#SC-002
 * @req docguard.field-report-followups#SC-003
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CURRENT_SCHEMA_VERSION } from '../cli/shared.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const strip = s => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'frf-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
function cli(dir, args, env = {}, extraNodeArgs = []) {
  const r = spawnSync(process.execPath, [...extraNodeArgs, CLI, ...args], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', ...env },
  });
  return { status: r.status, out: strip(`${r.stdout}${r.stderr}`), stdout: r.stdout };
}

const PASSING = {
  '.docguard.json': JSON.stringify({ projectName: 't', version: CURRENT_SCHEMA_VERSION, requiredFiles: { canonical: [], agentFile: ['AGENTS.md'], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' } }),
  'AGENTS.md': '# Agents\n',
  'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
  'DRIFT-LOG.md': '# Drift Log\n',
};

describe('#438 — the claims caveat travels with the pass badge', () => {
  it('prints claims_unverified-unknown under --changed-only instead of dropping it', () => {
    const { out } = cli(project(PASSING), ['guard', '--changed-only']);
    const badge = out.split('\n').find(l => l.includes('📎 Badge'));
    assert.ok(badge, out);
    assert.match(badge, /CDD_Guard-/);
    assert.match(badge, /claims_unverified-unknown-lightgrey/);
  });

  it('keeps both honesty lines, before the upgrade and pin nudges', () => {
    const dir = project({
      ...PASSING,
      '.docguard.json': JSON.stringify({ projectName: 't', version: '0.4', docguardVersion: '0.0.1', requiredFiles: { canonical: [], agentFile: ['AGENTS.md'], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' } }),
      'README.md': '# T\n\nThe service retries 3 times and keeps 30 days of logs.\n',
    });
    const { out } = cli(dir, ['guard']);
    const accuracy = out.indexOf('do not establish factual accuracy');
    const gates = out.indexOf('configured gates passed');
    assert.ok(accuracy > 0, out);
    assert.ok(gates > 0, 'the unverified-claims honesty line must print when claims exist');
    for (const nudge of ['↑ Schema', '📌']) {
      const at = out.indexOf(nudge);
      if (at >= 0) assert.ok(accuracy < at && gates < at, `${nudge} printed above the honesty block`);
    }
  });
});

describe('#437 — the baseline says what it hides', () => {
  it('splits suppressed findings by severity, summing to baselineSuppressed', () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 't', version: CURRENT_SCHEMA_VERSION, requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' } }),
      'CHANGELOG.md': '# Changelog\n',
    });
    cli(dir, ['guard', '--update-baseline']);
    const { stdout } = cli(dir, ['guard', '--format', 'json']);
    const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
    assert.ok(j.baselineSuppressed > 0, 'fixture must suppress something');
    const s = j.baselineBySeverity;
    assert.equal(s.error + s.warn + s.info, j.baselineSuppressed);
    assert.ok(s.error > 0);
    const human = cli(dir, ['guard']).out;
    assert.match(human, new RegExp(`suppressed by \\.docguard\\.baseline\\.json — ${s.error} error`));
  });
});

describe('#436 — the schema nudge can always be cleared', () => {
  it('upgrade --apply migrates the schema when the CLI install fails, then the nudge is gone', () => {
    const dir = project({ ...PASSING, '.docguard.json': JSON.stringify({ projectName: 't', version: '0.4' }) });
    const bin = join(dir, '.bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho "npm ERR! EACCES" >&2\nexit 1\n');
    chmodSync(join(bin, 'npm'), 0o755);
    // Offline: the registry lookup reports a newer CLI so the install step runs and fails.
    const stubFetch = 'data:text/javascript,globalThis.fetch=async()=>({ok:true,json:async()=>({version:"99.0.0"})});';
    const before = cli(dir, ['guard']).out;
    assert.match(before, /Schema v0\.4 is behind/);
    const r = cli(dir, ['upgrade', '--apply'], { PATH: `${bin}:${process.env.PATH}` }, ['--import', stubFetch]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /CLI upgrade failed/);
    assert.equal(JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8')).version, CURRENT_SCHEMA_VERSION);
    assert.doesNotMatch(cli(dir, ['guard']).out, /Schema .* is behind/);
  });
});

describe('#454 — never advise disabling a hook manager', () => {
  const husky = () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 't' }),
      '.husky/_/pre-commit': '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
      '.husky/pre-commit': 'npm test\n',
    });
    spawnSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: dir });
    return dir;
  };

  it('points at .husky/pre-commit and never mentions --force (the reproduction)', () => {
    const dir = husky();
    const { out } = cli(dir, ['hooks', '--type', 'pre-commit']);
    assert.match(out, /husky manages this hook/);
    assert.match(out, /\.husky\/pre-commit: npx docguard-cli guard --changed-only/);
    assert.doesNotMatch(out.split('\n').filter(l => /pre-commit/.test(l)).join('\n'), /--force to/);
  });

  it('leaves the dispatcher byte-identical even with --force', () => {
    const dir = husky();
    const before = readFileSync(join(dir, '.husky/_/pre-commit'));
    const { out } = cli(dir, ['hooks', '--type', 'pre-commit', '--force']);
    assert.match(out, /--force ignored/);
    assert.deepEqual(readFileSync(join(dir, '.husky/_/pre-commit')), before);
  });

  it('names lefthook and simple-git-hooks configuration', () => {
    const lh = project({ '.docguard.json': JSON.stringify({ projectName: 't' }), 'lefthook.yml': 'pre-commit:\n  commands: {}\n' });
    assert.match(cli(lh, ['hooks', '--type', 'pre-commit']).out, /lefthook manages this hook[\s\S]*lefthook\.yml/);
    const sgh = project({ '.docguard.json': JSON.stringify({ projectName: 't' }), 'package.json': JSON.stringify({ name: 'x', 'simple-git-hooks': { 'pre-commit': 'npm test' } }) });
    assert.match(cli(sgh, ['hooks', '--type', 'pre-commit']).out, /simple-git-hooks manages this hook[\s\S]*"simple-git-hooks"/);
  });
});
