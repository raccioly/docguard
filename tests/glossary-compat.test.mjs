/**
 * Spec 105, Stage 2: a project with no glossary and no plain-writing problem gets the same guard
 * answer as the previous release (FR-027). A `git archive` of the v0.49.0 tag runs as a
 * subprocess on one fixture with no `enforcement` key, and so does this tree; the exit code, the
 * findings and the JSON keys agree, except for the GLS004 line, the Glossary validator's own result
 * and Doc-Quality's check counts. The test skips, with a reason, when the tag is not in the clone
 * (a shallow checkout); CI checks out with `fetch-depth: 0`.
 *
 * @req docguard.glossary-and-plain-writing#FR-027
 * @req docguard.glossary-and-plain-writing#FR-007
 * @req docguard.glossary-and-plain-writing#FR-026
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
const TAG = 'v0.49.0';

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
  const dir = scratch('docguard-v049-');
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

const ARCH = [
  '# Architecture', '',
  '## System Overview', '',
  'The tool reads the project files. It checks each document against the code. It reports what it finds.', '',
  '## Tech Stack', '',
  'The tool runs on Node.js. It has no runtime dependency.', '',
].join('\n');
const README = '# Project\n\nThe project is small. It has one module. Run the tests with npm test. Read the configuration guide for more.\n';

/** A committed project: prose documents, no glossary, no `enforcement` key. */
function project() {
  const dir = scratch('docguard-glossary-compat-');
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'compat', version: '1.0.0' }));
  writeFileSync(join(dir, 'README.md'), README);
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), ARCH);
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'compat', version: '0.6' }, null, 2));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function guard(cli, dir) {
  const r = spawnSync(process.execPath, [join(cli, 'cli', 'docguard.mjs'), 'guard', '--format', 'json', '--dir', dir], { encoding: 'utf8', env: ENV });
  return { status: r.status, err: r.stderr, json: JSON.parse(r.stdout) };
}
const key = f => JSON.stringify([f.code, f.location, f.message]);

describe(`FR-027: no glossary, no plain-writing problem: ${TAG} and this tree agree`, { skip: skipNoTag }, () => {
  const runs = {};
  before(() => {
    const dir = project();
    runs.base = guard(baseCli(), dir);
    runs.head = guard(ROOT, dir);
  });

  it('exit with the same code', () => {
    assert.equal(runs.head.status, runs.base.status);
  });

  it('report the same findings, except one GLS004 at the info level', () => {
    const head = runs.head.json.findings.filter(f => f.code !== 'GLS004').map(key).sort();
    assert.deepEqual(head, runs.base.json.findings.map(key).sort());
    const added = runs.head.json.findings.filter(f => f.code === 'GLS004');
    assert.equal(added.length, 1);
    assert.equal(added[0].effectiveSeverity, 'info');
    assert.equal(added[0].suggestion.command, 'docguard init --with glossary');
    assert.equal(runs.base.json.findings.some(f => f.code === 'GLS004'), false);
  });

  it('give the same top-level keys, and the same validators besides Glossary', () => {
    // exitCode and outcome joined in spec 106 (docguard.field-report-fixes#FR-011).
    const later = new Set(['exitCode', 'outcome']);
    assert.deepEqual(Object.keys(runs.head.json).filter(k => !later.has(k)).sort(), Object.keys(runs.base.json).filter(k => !later.has(k)).sort());
    const names = json => json.validators.filter(v => v.key !== 'glossary').map(v => v.key);
    assert.deepEqual(names(runs.head.json), names(runs.base.json));
    assert.equal(runs.head.json.validators.filter(v => v.key === 'glossary').length, 1);
    assert.equal(runs.base.json.validators.some(v => v.key === 'glossary'), false);
  });

  it('give every other validator the same verdict', () => {
    const verdicts = json => Object.fromEntries(json.validators.filter(v => v.key !== 'glossary').map(v => [v.key, v.verdict]));
    assert.deepEqual(verdicts(runs.head.json), verdicts(runs.base.json));
  });

  it('count no new warning or error: the run totals of effective findings are unchanged', () => {
    for (const field of ['effectiveErrors', 'effectiveWarnings']) {
      if (field in runs.base.json) assert.equal(runs.head.json[field], runs.base.json[field], field);
    }
  });

  it('print nothing on stderr', () => {
    assert.equal(runs.head.err, '');
  });
});
