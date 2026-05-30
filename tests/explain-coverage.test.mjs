/**
 * v0.24 — `docguard explain` coverage (field report, Issue A).
 *
 * The bug: `explain` shipped a hand-maintained lookup table that drifted
 * behind the guard registry. Six validators (incl. docQuality — the very
 * negation-load escape hatch v0.23.0 added) returned "No matching validator
 * found", and display names users see in guard output ("Doc-Quality",
 * "Doc Sections") didn't resolve at all.
 *
 * These tests pin `explain` to the LIVE guard registry, so a new validator
 * can't ship without an explain entry, and anything guard prints by name
 * stays explainable. Same spirit as the tool's own metricsConsistency check:
 * documented surface must match implemented surface.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-explain-'));
  mkdirSync(join(dir, 'docs-canonical'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub.\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 't', profile: 'standard' }, null, 2));
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

/** Run an explain query and return the parsed JSON ({ query, match } or { validators }). */
function explain(args) {
  const r = spawnSync('node', [CLI, 'explain', ...args, '--format', 'json', '--quiet'], { encoding: 'utf-8' });
  return JSON.parse(r.stdout);
}

describe('explain coverage — every guard validator is explainable', () => {
  let dir;
  let registry; // { keys: Set<string>, names: string[] }

  before(() => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard', '--dir', dir, '--format', 'json', '--quiet'], { encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    registry = {
      keys: [...new Set(data.validators.map(v => v.key))],
      names: data.validators.map(v => v.name).filter(Boolean),
    };
  });

  after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('every display name guard prints resolves in explain', () => {
    // Users type what they see. "Doc-Quality", "Doc Sections", "API-Surface"
    // must all resolve — this is what the field report flagged.
    const misses = [];
    for (const name of registry.names) {
      const res = explain([name]);
      if (!res.match) misses.push(name);
    }
    assert.equal(misses.length, 0,
      `These guard display names don't resolve in \`explain\`: ${misses.join(', ')}`);
  });

  it('every validator key guard exposes is in the explain catalog', () => {
    // Structural exhaustiveness: the no-args list must cover every live key,
    // so the catalog can't quietly fall behind the registry again.
    const listed = new Set(explain([]).validators);
    const missing = registry.keys.filter(k => !listed.has(k));
    assert.equal(missing.length, 0,
      `Guard keys with no explain entry: ${missing.join(', ')}`);
  });

  it('the escape hatch docQuality shipped is reachable from explain (the connected insight)', () => {
    // v0.23.0 added the negation-load override but explain didn't know about
    // it, so a user hitting the warning could never discover the fix.
    const res = explain(['docQuality']);
    assert.ok(res.match, 'explain docQuality should resolve');
    const blob = JSON.stringify(res.match);
    assert.match(blob, /docguard:quality negation-load off/,
      'docQuality explainer must document the negation-load override marker');
  });

  it('the doc-sections N/A marker is discoverable (kebab + display name)', () => {
    for (const q of ['doc-sections', 'Doc Sections', 'docSections']) {
      const res = explain([q]);
      assert.equal(res.match && res.match.key, 'docSections', `"${q}" should resolve to docSections`);
    }
    const blob = JSON.stringify(explain(['docSections']).match);
    assert.match(blob, /docguard:section/, 'docSections explainer must document the N/A marker');
  });
});
