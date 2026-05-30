/**
 * v0.24 — Score "Top improvements" must be honest (field report, Issue B).
 *
 * The bug: the suggestion line was a static per-category template, so a project
 * that had already done the work was still told to do it — e.g. "Configure
 * TEST-SPEC.md and add CI test step" for a repo that had both. Compounding it,
 * pytest config living in pyproject.toml ([tool.pytest.ini_options]) wasn't
 * detected, so uv/pytest projects were capped at 85% on testing with no way up.
 *
 * These tests assert the suggestion is derived from the sub-checks that
 * actually failed, and that Python test config is recognized.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Minimal repo with overridable files. `files` maps relative path → contents. */
function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-score-'));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  const base = {
    'package.json': JSON.stringify({ name: 't', version: '0.1.0' }),
    'docs-canonical/ARCHITECTURE.md': '# A\n## System Overview\nx\n## Component Map\ny\n## Tech Stack\nz\n',
    'CHANGELOG.md': '# Changelog\n## [Unreleased]\n## [1.0.0] - 2026-01-01\n',
    'AGENTS.md': '# Agents\n',
    'DRIFT-LOG.md': '# Drift\n',
    '.docguard.json': JSON.stringify({ projectName: 't', profile: 'standard' }),
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

function score(dir, json = false) {
  const args = [CLI, 'score', '--dir', dir, '--quiet'];
  if (json) args.push('--format', 'json');
  const r = spawnSync('node', args, { encoding: 'utf-8' });
  return json ? JSON.parse(r.stdout) : stripAnsi(r.stdout);
}

describe('score suggestions — honest, derived from real gaps', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('detects pytest config in pyproject.toml ([tool.pytest.*]) — full testing marks', () => {
    dir = makeRepo({
      'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
      'tests/test_x.py': 'def test_x():\n    assert True\n',
      'docs-canonical/TEST-SPEC.md': '# Test Spec\n## Test Categories\nunit\n## Coverage Rules\n80%\n',
      '.github/workflows/ci.yml': 'name: ci\njobs:\n  test:\n    steps:\n      - run: pytest\n',
    });
    const json = score(dir, true);
    assert.equal(json.categories.testing.score, 100,
      `pytest-in-pyproject project should score testing 100 (got ${json.categories.testing.score})`);
  });

  it('does not tell you to do work that is already done', () => {
    // Same well-configured testing setup → "testing" must not appear in the
    // improvements list at all, and the stale canned phrase must be gone.
    dir = makeRepo({
      'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
      'tests/test_x.py': 'def test_x():\n    assert True\n',
      'docs-canonical/TEST-SPEC.md': '# Test Spec\n## Test Categories\nunit\n## Coverage Rules\n80%\n',
      '.github/workflows/ci.yml': 'name: ci\njobs:\n  test:\n    steps:\n      - run: pytest\n',
    });
    const out = score(dir);
    const block = out.slice(out.indexOf('Top improvements'));
    assert.doesNotMatch(block, /add CI test step/, 'must not suggest adding a CI step that exists');
    assert.doesNotMatch(block, /Configure TEST-SPEC\.md/, 'must not suggest configuring a TEST-SPEC that exists');
  });

  it('names the specific failing sub-check when something is genuinely missing', () => {
    // Repo fully configured EXCEPT environment docs → the environment line must
    // name what's actually missing, not print a generic template.
    dir = makeRepo({ 'README.md': '# T\n## Setup\nrun it\n' });
    const out = score(dir);
    const block = out.slice(out.indexOf('Top improvements'));
    assert.match(block, /environment:.*ENVIRONMENT\.md missing/,
      `environment suggestion should name the missing file; got:\n${block}`);
  });
});
