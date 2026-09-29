/**
 * As-built specs — `docguard generate --spec <area>` and the SPR007 sync check.
 *
 * @req docguard.as-built-specs#FR-001
 * @req docguard.as-built-specs#FR-002
 * @req docguard.as-built-specs#FR-003
 * @req docguard.as-built-specs#FR-004
 * @req docguard.as-built-specs#FR-005
 * @req docguard.as-built-specs#FR-006
 * @req docguard.as-built-specs#FR-007
 * @req docguard.as-built-specs#SC-001
 * @req docguard.as-built-specs#SC-002
 * @req docguard.as-built-specs#SC-003
 * @req docguard.as-built-specs#SC-004
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { collectAreaFacts, resolveArea } from '../cli/scanners/as-built.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const USERS = [
  'import express from "express";',
  'const r = express.Router();',
  'r.get("/users", (q, s) => s.json([]));',
  'r.post("/users", (q, s) => s.json({}));',
  'export default r;',
  'export function listUsers() { return process.env.DB_URL; }',
  '',
].join('\n');

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'as-built-'));
  dirs.push(dir);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  git('add', '-A'); git('commit', '-q', '-m', 'fixture');
  return { dir, git };
}
const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const json = r => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const spr007 = dir => json(cli(dir, ['guard', '--format', 'json'])).findings.filter(f => f.code === 'SPR007');

const BASE = {
  '.docguard.json': JSON.stringify({ projectName: 'acme' }),
  'package.json': JSON.stringify({ name: 'acme', dependencies: { express: '4.0.0' } }),
  'src/api/users.mjs': USERS,
  // Outside the area: its env var must not become a candidate for src/api.
  'src/worker.mjs': 'export const queue = process.env.QUEUE_URL;\n',
};

describe('generate --spec <area>', () => {
  it('proposes one candidate per fact, with markers and citations, and no DocGuard prose', () => {
    const { dir } = project(BASE);
    const r = json(cli(dir, ['generate', '--spec', 'src/api', '--format', 'json']));
    assert.equal(r.status, 'PLANNED');
    assert.deepEqual(r.facts.map(f => `${f.kind} ${f.key}`).sort(), [
      'env DB_URL', 'export src/api/users.mjs#default', 'export src/api/users.mjs#listUsers', 'route GET /users', 'route POST /users',
    ]);
    assert.equal(r.path, 'specs/001-as-built-src-api/spec.md');
    assert.equal(r.specId, 'acme.as-built-src-api');
  });

  it('--write creates the spec and registers origin: as_built with sourcePaths', () => {
    const { dir } = project(BASE);
    const r = json(cli(dir, ['generate', '--spec', 'src/api', '--write', '--format', 'json']));
    assert.equal(r.status, 'WRITTEN');
    const spec = readFileSync(join(dir, r.path), 'utf8');
    assert.match(spec, /\*\*Status\*\*: As-built/);
    assert.equal((spec.match(/- \*\*FR-\d{3}\*\*: <!-- agent:/g) || []).length, 5, 'every statement is an agent task');
    assert.equal((spec.match(/<!-- docguard:fact /g) || []).length, 5);
    const entry = JSON.parse(readFileSync(join(dir, '.docguard-specs.json'), 'utf8')).specs.find(s => s.specId === r.specId);
    assert.equal(entry.reviewed.lifecycle.origin, 'as_built');
    assert.deepEqual(entry.reviewed.scope.sourcePaths, ['src/api']);
    assert.equal(entry.reviewed.lifecycle.approval, 'draft', 'a human approves the prose, not the generator');
    assert.match(cli(dir, ['specs', '--check']).stdout, /Spec registry: CURRENT/);
  });

  it('refuses a missing area, an escape, or an area with no facts, and writes nothing', () => {
    const { dir } = project({ ...BASE, 'docs/readme.md': '# x\n' });
    for (const area of ['nope', '../', 'docs']) {
      const r = cli(dir, ['generate', '--spec', area, '--write', '--format', 'json']);
      assert.equal(r.status, 1, area);
      assert.equal(json(r).status, 'ERROR');
    }
    assert.throws(() => readdirSync(join(dir, 'specs')));
  });
});

describe('SPR007 — the as-built spec stays synced', () => {
  const written = () => {
    const p = project(BASE);
    const r = json(cli(p.dir, ['generate', '--spec', 'src/api', '--write', '--format', 'json']));
    p.git('add', '-A'); p.git('commit', '-q', '-m', 'as-built');
    return { ...p, specPath: join(p.dir, r.path) };
  };

  it('round-trips with zero drift (SC-001)', () => {
    assert.deepEqual(spr007(written().dir), []);
  });

  it('reports a new route, and a cited route that vanished (SC-002)', () => {
    const added = written();
    writeFileSync(join(added.dir, 'src/api/users.mjs'), USERS.replace('export default r;', 'r.delete("/users/:id", (q, s) => s.end());\nexport default r;'));
    const a = spr007(added.dir);
    assert.equal(a.length, 1, JSON.stringify(a.map(f => f.message)));
    assert.match(a[0].message, /route `DELETE \/users\/:id`.*neither specifies it/);

    const removed = written();
    writeFileSync(join(removed.dir, 'src/api/users.mjs'), USERS.replace('r.post("/users", (q, s) => s.json({}));\n', ''));
    const v = spr007(removed.dir);
    assert.equal(v.length, 1, JSON.stringify(v.map(f => f.message)));
    assert.match(v[0].message, /route `POST \/users` is cited by the spec but no longer exists/);
  });

  it('does not report a fact listed under Out of Scope', () => {
    const w = written();
    writeFileSync(join(w.dir, 'src/api/users.mjs'), USERS.replace('export default r;', 'r.delete("/users/:id", (q, s) => s.end());\nexport default r;'));
    const spec = readFileSync(w.specPath, 'utf8');
    writeFileSync(w.specPath, spec.replace('## Out of Scope\n', '## Out of Scope\n\n- Admin-only deletion is not part of this contract. <!-- docguard:fact route DELETE /users/:id -->\n'));
    assert.deepEqual(spr007(w.dir), []);
  });

  it('needs no tasks.md: preflight and Spec-Kit raise nothing about tasks (FR-006)', () => {
    const w = written();
    const pre = json(cli(w.dir, ['specs', 'preflight', '--format', 'json']));
    assert.notEqual(pre.status, 'BLOCKED', JSON.stringify(pre.blockers));
    const g = json(cli(w.dir, ['guard', '--format', 'json']));
    assert.equal(g.findings.filter(f => f.validator === 'specKit' && /tasks/i.test(f.message)).length, 0);
  });
});

describe('registry compatibility (SC-003)', () => {
  it('leaves an existing spec entry byte-identical', () => {
    const { dir, git } = project({
      ...BASE,
      'specs/001-existing/spec.md': '# Existing\n\n**Spec ID**: `acme.existing`\n\n- **FR-001**: Work.\n',
    });
    cli(dir, ['specs', '--write']);
    git('add', '-A'); git('commit', '-q', '-m', 'registry');
    const before = JSON.stringify(JSON.parse(readFileSync(join(dir, '.docguard-specs.json'), 'utf8')).specs.find(s => s.specId === 'acme.existing'));
    assert.doesNotMatch(before, /origin|sourcePaths/);
    json(cli(dir, ['generate', '--spec', 'src/api', '--write', '--format', 'json']));
    const after = JSON.stringify(JSON.parse(readFileSync(join(dir, '.docguard-specs.json'), 'utf8')).specs.find(s => s.specId === 'acme.existing'));
    assert.equal(after, before);
  });
});

describe('this repository (SC-004)', () => {
  it('proposes every exported validate* function under cli/validators', () => {
    const area = resolveArea(process.cwd(), 'cli/validators');
    const keys = new Set(collectAreaFacts(process.cwd(), area.rel, {}).map(f => f.key));
    for (const file of readdirSync('cli/validators').filter(f => f.endsWith('.mjs'))) {
      for (const m of readFileSync(join('cli/validators', file), 'utf8').matchAll(/^export (?:async )?function (validate\w+)/gm)) {
        assert.ok(keys.has(`cli/validators/${file}#${m[1]}`), `${file}#${m[1]}`);
      }
    }
  });
});

describe('documentation (FR-007)', () => {
  it('README and the Spec Kit generate command explain generate --spec and SPR007', () => {
    const readme = readFileSync('README.md', 'utf8');
    const cmd = readFileSync('extensions/spec-kit-docguard/commands/generate.md', 'utf8');
    assert.match(readme, /`--spec <area>` writes an \*\*as-built Spec Kit spec\*\*/);
    assert.match(cmd, /## As-built specs for code that has none/);
    assert.match(cmd, /SPR007/);
    assert.match(cmd, /Brownfield Bootstrap/);
  });
});

describe('SPR007 is a registered finding code', () => {
  it('docguard explain SPR007 describes the as-built drift check', () => {
    const r = spawnSync(process.execPath, [CLI, 'explain', 'SPR007'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(r.stdout, /As-built spec drifted from its source paths/);
  });
});
