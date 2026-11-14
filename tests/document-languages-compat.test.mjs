/**
 * Documents in any language, Stage 0 (specs/104-document-languages): the
 * keys and the marker the feature adds must be harmless to the last release.
 * A `git archive` of the v0.48.0 tag is run as a subprocess; the test skips,
 * with a reason, when the tag is not in the clone (a shallow checkout). CI
 * checks out with `fetch-depth: 0`.
 *
 * @req docguard.document-languages#FR-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_GIT, fixtureGit } from './helpers/git.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const TAG = 'v0.48.0';

const temporary = [];
function scratch(prefix) {
  const dir = makeTempDir(prefix);
  temporary.push(dir);
  return dir;
}
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const tagExists = (() => { try { fixtureGit(ROOT, ['rev-parse', '--verify', '-q', `${TAG}^{commit}`]); return true; } catch { return false; } })();
const skipNoTag = tagExists ? false : `${TAG} is not in this clone (shallow checkout); CI fetches full history`;

let baseDir = null;
function baseCli() {
  if (baseDir) return baseDir;
  const dir = scratch('docguard-v048-');
  const tarball = join(dir, '.tag.tar');
  fixtureGit(ROOT, ['archive', '-o', tarball, TAG]);
  const tar = spawnSync('tar', ['-x', '-f', tarball, '-C', dir]);
  rmSync(tarball, { force: true });
  assert.equal(tar.status, 0, 'tar extract failed');
  // The tag's runtime dependency resolves from this checkout's install.
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  baseDir = dir;
  return dir;
}

const ARCH = '# Architecture\n\n## System Overview\n\nThe system has one module.\n\n## Tech Stack\n<!-- docguard:heading tech-stack -->\n\nNode.js.\n';
const PLAIN_ARCH = '# Architecture\n\n## System Overview\n\nThe system has one module.\n\n## Tech Stack\n\nNode.js.\n';

function project(arch, docsKeys) {
  const dir = scratch('docguard-compat-');
  const config = { projectName: 'compat', version: '0.6', ...(docsKeys ? { docs: docsKeys } : {}) };
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'compat', version: '1.0.0' }));
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), arch);
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config, null, 2));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function v048(dir, args) {
  const r = spawnSync(process.execPath, [join(baseCli(), 'cli', 'docguard.mjs'), ...args, '--dir', dir], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const findingsKey = json => JSON.stringify(json.findings.map(f => [f.code, f.location, f.message]).sort());

describe('FR-001: v0.48.0 loads docs.language, docs.labelAliases and a docguard:heading marker', { skip: skipNoTag }, () => {
  const runs = {};
  before(() => {
    const docs = { language: 'pt-BR', labelAliases: { 'tech-stack': ['Pilha tecnologica'] } };
    for (const [name, arch, keys] of [['plain', PLAIN_ARCH, undefined], ['keys', ARCH, docs]]) {
      const dir = project(arch, keys);
      runs[name] = { guard: v048(dir, ['guard', '--format', 'json']), dir };
    }
  });

  it('guard runs with an empty stderr and no configuration error', () => {
    const r = runs.keys.guard;
    assert.equal(r.err, '');
    assert.doesNotMatch(r.out, /Error parsing \.docguard\.json/);
    const json = JSON.parse(r.out);
    assert.ok(Array.isArray(json.validators) && json.validators.length > 0, 'guard produced a validator list');
  });

  it('guard reports the findings and the exit code of the same project without them', () => {
    assert.equal(runs.keys.guard.status, runs.plain.guard.status);
    assert.equal(findingsKey(JSON.parse(runs.keys.guard.out)), findingsKey(JSON.parse(runs.plain.guard.out)));
  });

  it('generate --plan --write runs with an empty stderr', () => {
    const r = v048(runs.keys.dir, ['generate', '--plan', '--write']);
    assert.equal(r.err, '');
    assert.ok(r.status === 0 || r.status === 2, `exit ${r.status}: ${r.out.slice(-300)}`);
  });
});
