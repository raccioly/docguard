/**
 * v0.19-P1 — npm-pack smoke test.
 *
 * Builds the actual tarball that would be published to npm, extracts it
 * into a temp directory, and runs the CLI against a tiny fixture. Catches
 * the class of bugs where a needed file is missing from `package.json`'s
 * `files:` array (regression after adding new modules), or the published
 * package has a structural problem.
 *
 * The local `npm test` against source files can't catch these — only
 * exercising the packed tarball reveals them. v0.15.0 nearly shipped with
 * a missing `schemas/` directory until we added it to the files array.
 *
 * @req SC-PACK-001 — npm pack succeeds without errors
 * @req SC-PACK-002 — packed tarball includes cli/, schemas/, templates/, commands/
 * @req SC-PACK-003 — extracted package can run `docguard --version`
 * @req SC-PACK-004 — extracted package can run a full guard against a fixture
 * @req SC-PACK-005 — schemas/docguard-config.schema.json is in the package
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Skip if NPM_PACK_SMOKE=0 — opt-out only. By default this runs in regular
// CI because catching publish-time gaps is core hygiene.
const SKIP = process.env.NPM_PACK_SMOKE === '0';

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `docguard-pack-${prefix}-`));
}

describe('npm pack smoke', { skip: SKIP }, () => {
  let packDir;
  let extractDir;
  afterEach(() => {
    if (packDir) rmSync(packDir, { recursive: true, force: true });
    if (extractDir) rmSync(extractDir, { recursive: true, force: true });
  });

  it('npm pack produces a tarball and extracts cleanly', () => {
    packDir = tmp('pack');
    // Run `npm pack` from the project root, writing tarball to packDir
    const r = spawnSync('npm', ['pack', '--pack-destination', packDir], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, `npm pack should succeed; got ${r.status}\n${r.stderr}`);
    const tarballs = readdirSync(packDir).filter(f => f.endsWith('.tgz'));
    assert.equal(tarballs.length, 1, `expected exactly one .tgz in packDir; got: ${tarballs.join(', ')}`);

    // Extract the tarball
    extractDir = tmp('extract');
    const ex = spawnSync('tar', ['xzf', join(packDir, tarballs[0]), '-C', extractDir], {
      encoding: 'utf-8',
    });
    assert.equal(ex.status, 0, `tar extract should succeed; got ${ex.status}\n${ex.stderr}`);

    // Verify key directories are present in the extracted `package/`
    const pkgDir = join(extractDir, 'package');
    assert.ok(existsSync(join(pkgDir, 'cli')), 'cli/ should be in the tarball');
    assert.ok(existsSync(join(pkgDir, 'cli/docguard.mjs')), 'cli/docguard.mjs entry point');
    assert.ok(existsSync(join(pkgDir, 'schemas')), 'schemas/ should be in the tarball (v0.15-P4)');
    assert.ok(existsSync(join(pkgDir, 'schemas/docguard-config.schema.json')),
      'schemas/docguard-config.schema.json should ship');
    assert.ok(existsSync(join(pkgDir, 'templates')), 'templates/ should be in the tarball');
    assert.ok(existsSync(join(pkgDir, 'commands')), 'commands/ should be in the tarball');
    assert.ok(existsSync(join(pkgDir, 'extensions')), 'extensions/ should be in the tarball');
    assert.ok(existsSync(join(pkgDir, 'package.json')), 'package.json should be in the tarball');
  });

  it('extracted package runs --version (CLI loads end-to-end)', () => {
    packDir = tmp('pack');
    extractDir = tmp('extract');
    spawnSync('npm', ['pack', '--pack-destination', packDir], { cwd: process.cwd() });
    const tarball = readdirSync(packDir).find(f => f.endsWith('.tgz'));
    spawnSync('tar', ['xzf', join(packDir, tarball), '-C', extractDir]);

    // Run the CLI from the extracted location — this exercises EVERY import
    // chain (validators, scanners, writers, commands). A missing module
    // would crash here.
    const cli = join(extractDir, 'package/cli/docguard.mjs');
    const r = spawnSync('node', [cli, '--version'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, `--version should exit 0; got ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /docguard v\d+\.\d+\.\d+/,
      `--version should print docguard vX.Y.Z; got: ${r.stdout}`);
  });

  it('extracted package can run guard against a minimal fixture', () => {
    packDir = tmp('pack');
    extractDir = tmp('extract');
    const fixtureDir = tmp('fixture');
    spawnSync('npm', ['pack', '--pack-destination', packDir], { cwd: process.cwd() });
    const tarball = readdirSync(packDir).find(f => f.endsWith('.tgz'));
    spawnSync('tar', ['xzf', join(packDir, tarball), '-C', extractDir]);

    // Build a minimal fixture
    writeFileSync(join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'smoke', version: '0.0.1' }));
    mkdirSync(join(fixtureDir, 'docs-canonical'));
    writeFileSync(join(fixtureDir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub.\n');
    writeFileSync(join(fixtureDir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(fixtureDir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
    writeFileSync(join(fixtureDir, 'DRIFT-LOG.md'), '# Drift\n');
    writeFileSync(join(fixtureDir, '.docguard.json'),
      JSON.stringify({ projectName: 'smoke', profile: 'starter', version: '0.5' }));
    spawnSync('git', ['init', '-q'], { cwd: fixtureDir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: fixtureDir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: fixtureDir });

    const cli = join(extractDir, 'package/cli/docguard.mjs');
    const r = spawnSync('node', [cli, 'guard', '--quiet', '--format', 'json'], {
      cwd: fixtureDir,
      encoding: 'utf-8',
    });
    // Guard should exit 0 (pass) or 2 (warn) — both mean it ran cleanly
    assert.ok(r.status === 0 || r.status === 2,
      `guard should exit 0 or 2; got ${r.status}\nstderr: ${r.stderr}`);
    // Output should be valid JSON (no banner pollution — v0.16-P1 fix)
    const data = JSON.parse(r.stdout);
    assert.ok(data.project === 'smoke', `expected project in JSON output; got: ${r.stdout.slice(0, 200)}`);
    assert.ok(Array.isArray(data.validators), 'validators array should be present');

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
