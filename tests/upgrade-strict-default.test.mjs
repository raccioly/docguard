/**
 * `docguard upgrade` for a project that has not chosen a mode (specs/097-strict-by-default FR-018): it says this
 * version makes strict the default, lists what now fails (and what is only reported), and gives the ways
 * forward in order, without writing anything.
 *
 * @req docguard.strict-by-default#FR-018
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { FIXTURE_GIT } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const ROUTES = {
  'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { express: '4.18.2' } }),
  'src/routes/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.json([]));\nmodule.exports = router;\n",
};
const KEYS = ['structure', 'docsSync', 'drift', 'changelog', 'architecture', 'testSpec', 'security', 'environment', 'freshness', 'apiSurface'];
const only = (...on) => Object.fromEntries(KEYS.map(k => [k, on.includes(k)]));

function project(files, extra = {}) {
  const dir = makeTempDir('docguard-upgrade-strict-');
  temporary.push(dir);
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); }
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'fixture', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: only('apiSurface'), ...extra }, null, 2));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}
const upgrade = dir => spawnSync(process.execPath, [CLI, 'upgrade', '--schema-only'], { cwd: dir, encoding: 'utf8', env: ENV }).stdout;
function snapshot(dir) {
  const out = {};
  const walk = d => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      const rel = relative(dir, abs).replace(/\\/g, '/');
      if (rel === '.docguard' || rel.startsWith('.docguard/')) continue;
      if (statSync(abs).isDirectory()) walk(abs); else out[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

describe('upgrade for a project with no enforcement key', () => {
  it('says this version makes strict the default', () => {
    assert.match(upgrade(project(ROUTES)), /This version makes strict the default, and this project has no "enforcement" key/);
  });

  it('lists what now fails with cause and fix, then reports what does not fail', () => {
    const out = upgrade(project(ROUTES));
    assert.match(out, /What now fails: \d+ validator\(s\) that apply and examined nothing/);
    assert.match(out, /API-Surface is inconclusive \(needs-declaration\)/);
    assert.match(out, /API-REFERENCE\.md/);
  });

  it('gives the three ways forward in order: fix or declare, waive with reason owner and expiry, stay on standard', () => {
    const out = upgrade(project(ROUTES));
    const fix = out.indexOf('1. Fix or declare');
    const waive = out.indexOf('2. Waive');
    const stay = out.indexOf('3. Stay on the lower mode');
    assert.ok(fix > 0 && waive > fix && stay > waive, `${fix} ${waive} ${stay}`);
    assert.match(out, /owner:<@handle> expires:<YYYY-MM-DD>/);
    assert.match(out, /"enforcement": "standard"/);
  });

  it('reports what DocGuard could not read as not failing the build', () => {
    const out = upgrade(project({ 'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { '@aws-sdk/client-dynamodb': '3.0.0' } }), 'src/db.js': 'export const t = 1;\n' }));
    assert.match(out, /Reported, and not failing the build:/);
    assert.match(out, /Schema-Sync is empty \(layout-not-recognized\)/);
    assert.ok(out.indexOf('Reported, and not failing') < out.indexOf('Ways forward'));
  });

  it('names the validators your config sets to false, which strict does not honor', () => {
    const dir = project(ROUTES, { validators: { ...only('apiSurface'), architecture: false, security: false } });
    const out = upgrade(dir);
    assert.match(out, /Your \.docguard\.json sets \d+ validator\(s\) to false: .*architecture.*security|Your \.docguard\.json sets \d+ validator\(s\) to false: .*security.*architecture/);
    assert.match(out, /Strict does not honor that, so they now run/);
    assert.match(out, /reasoned waiver or "enforcement": "standard"/);
  });

  it('does not say the default changed for a project that wrote the key', () => {
    const out = upgrade(project(ROUTES, { enforcement: 'strict' }));
    assert.doesNotMatch(out, /makes strict the default/);
    assert.match(out, /Under strict this project would report/);
  });

  it('writes nothing', () => {
    const dir = project(ROUTES);
    const before = snapshot(dir);
    upgrade(dir);
    assert.deepEqual(snapshot(dir), before);
  });
});

describe('the Action fails on exit 4 and names the strict cause', () => {
  it('action.yml turns exit 4 into a failed step whose message names the strict cause, not only fail-on-inconclusive', () => {
    const action = readFileSync(resolve('action.yml'), 'utf8');
    assert.match(action, /DocGuard guard exited 4: a check that applies to this project examined nothing \(strict enforcement\)/);
    assert.doesNotMatch(action, /a check could not decide \(fail-on-inconclusive is enabled\)"/);
  });
});
