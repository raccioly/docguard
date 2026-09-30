/**
 * v0.24 — Skill install is idempotent (field report, Issue D).
 *
 * The bug: ensureSkills gated rewrites on a `docguard:version:` marker. One
 * bundled skill (docguard-sync) lacked the marker, so its installed copy
 * always compared as version '0.0.0' ≠ package version and got rewritten —
 * and re-announced — on EVERY scaffolding run, churning the mtimes the
 * Freshness validator reads.
 *
 * Fix: a content-equality gate. These tests assert that a second identical
 * run writes nothing and prints no install message.
 *
 * Spec 042 (docguard.read-only-commands#FR-001): only `init` installs skills;
 * every other command, `generate` included, writes only its own outputs. So
 * this exercises idempotency through `init`.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-skills-'));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  // Mark spec-kit as already initialized so ensureSpecKit early-returns and
  // doesn't scaffold (keeps this test about skills only).
  mkdirSync(join(dir, '.specify'), { recursive: true });
  writeFileSync(join(dir, '.specify/init-options.json'), JSON.stringify({ ai: 'claude' }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  return dir;
}

// `init` is the only command that installs skills. --skip-prompts keeps it
// non-interactive; --no-spec-kit keeps this test about DocGuard's own skills.
function runCmd(dir) {
  return spawnSync('node', [CLI, 'init', '--skip-prompts', '--no-spec-kit', '--dir', dir], { encoding: 'utf-8' }).stdout;
}

function skillMtimes(dir) {
  const root = join(dir, '.agent/skills');
  const out = {};
  let dirs = [];
  try { dirs = readdirSync(root); } catch { return out; }
  for (const d of dirs) {
    try { out[d] = statSync(join(root, d, 'SKILL.md')).mtimeMs; } catch { /* ignore */ }
  }
  return out;
}

describe('ensureSkills — idempotent, no per-command rewrite churn', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('installs on first run, stays silent on the second', () => {
    dir = makeRepo();
    const first = runCmd(dir);
    assert.match(first, /DocGuard AI skills installed\/updated/,
      'first run should install skills and announce it');
    const second = runCmd(dir);
    assert.doesNotMatch(second, /DocGuard AI skills installed\/updated/,
      'second identical run must NOT re-announce (no rewrite)');
  });

  it('does not rewrite unchanged SKILL.md files (mtimes stable)', () => {
    dir = makeRepo();
    runCmd(dir);
    const before = skillMtimes(dir);
    assert.ok(Object.keys(before).length >= 5, 'all bundled skills should be installed');
    runCmd(dir);
    runCmd(dir);
    const after = skillMtimes(dir);
    assert.deepEqual(after, before, 'SKILL.md mtimes must be unchanged across repeated scaffolding runs');
  });

  it('every bundled skill carries the docguard:version marker (so the file is self-consistent)', () => {
    // docguard-sync was the one missing it — guard against regressing any skill.
    const skillsRoot = join(process.cwd(), 'extensions/spec-kit-docguard/skills');
    for (const d of readdirSync(skillsRoot).filter(n => n.startsWith('docguard-'))) {
      const md = readFileSync(join(skillsRoot, d, 'SKILL.md'), 'utf-8');
      assert.match(md, /<!-- docguard:version:/, `${d}/SKILL.md is missing the docguard:version marker`);
    }
  });

  it('keeps repository agent copies byte-identical to the released skills', () => {
    const sourceRoot = join(process.cwd(), 'extensions/spec-kit-docguard/skills');
    const installedRoot = join(process.cwd(), '.agent/skills');
    for (const d of readdirSync(sourceRoot).filter(n => n.startsWith('docguard-'))) {
      const source = readFileSync(join(sourceRoot, d, 'SKILL.md'), 'utf-8');
      const installed = readFileSync(join(installedRoot, d, 'SKILL.md'), 'utf-8');
      assert.equal(installed, source, `${d}/SKILL.md must be refreshed in the release commit`);
    }
  });
});
