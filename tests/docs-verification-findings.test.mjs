/**
 * Defects found while documenting DocGuard (specs/054-docs-verification-findings).
 *
 * @req docguard.docs-verification-findings#FR-001
 * @req docguard.docs-verification-findings#FR-002
 * @req docguard.docs-verification-findings#FR-003
 * @req docguard.docs-verification-findings#FR-004
 * @req docguard.docs-verification-findings#FR-006
 * @req docguard.docs-verification-findings#FR-007
 * @req docguard.docs-verification-findings#SC-001
 * @req docguard.docs-verification-findings#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { validatePathScopedRules } from '../cli/validators/path-scoped-rules.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');
// No `specify` on PATH, so nothing here can reach Spec Kit even by accident.
const PATH_WITHOUT_SPECIFY = (process.env.PATH || '').split(delimiter)
  .filter(p => p && !existsSync(join(p, 'specify'))).join(delimiter);
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', PATH: PATH_WITHOUT_SPECIFY },
});
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

let dir;
const tree = root => readdirSync(root, { recursive: true }).map(String).sort();
const fresh = prefix => (dir = mkdtempSync(join(tmpdir(), `docguard-054-${prefix}-`)));
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

describe('a Koa project is labelled Koa and its routes are still read (FR-001)', () => {
  it('labels Koa, keeps Hono, and reads Koa routes with source koa', () => {
    fresh('koa');
    write(dir, 'package.json', JSON.stringify({ name: 'k', dependencies: { koa: '2.15.0', '@koa/router': '12.0.0' } }));
    write(dir, 'src/routes.js', "const Router = require('@koa/router');\nconst router = new Router();\nrouter.get('/health', ctx => { ctx.body = 'ok'; });\nrouter.post('/orders', ctx => {});\nmodule.exports = router;\n");
    const profile = detectProjectProfile(dir);
    assert.equal(profile.primary.framework, 'Koa');
    const routes = scanRoutesDeep(dir, { framework: profile.primary.framework });
    assert.deepEqual(routes.map(r => `${r.method} ${r.path}`).sort(), ['GET /health', 'POST /orders']);
    assert.ok(routes.every(r => r.source === 'koa'), JSON.stringify(routes.map(r => r.source)));

    write(dir, 'package.json', JSON.stringify({ name: 'h', dependencies: { hono: '4.0.0' } }));
    assert.equal(detectProjectProfile(dir).primary.framework, 'Hono');
  });
});

function agentsProject(prefix) {
  fresh(prefix);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'agents-fixture', profile: 'starter' }));
  write(dir, 'AGENTS.md', '# Agents\n\nRun the tests before every commit.\n');
  return dir;
}
const MARKER = /docguard:agents-sync source=AGENTS\.md hash=[0-9a-f]{16}|"_docguardSync"/;

describe('generated agent files can be synced (FR-002, FR-003)', () => {
  it('every file `agents` generates carries the sync marker', () => {
    agentsProject('mark');
    const res = run(['agents', '--no-spec-kit'], dir);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const written = ['CLAUDE.md', '.github/copilot-instructions.md', '.gemini/settings.json'].filter(f => existsSync(join(dir, f)));
    assert.ok(written.length >= 3, written.join());
    for (const f of written) assert.match(readFileSync(join(dir, f), 'utf8'), MARKER, f);
  });

  it('agents --sync then updates them from AGENTS.md and runs nothing else', () => {
    agentsProject('sync');
    run(['agents', '--no-spec-kit'], dir);
    const configBefore = readFileSync(join(dir, '.docguard.json'), 'utf8');
    const treeBefore = tree(dir);
    write(dir, 'AGENTS.md', '# Agents\n\nRun the tests and the linter before every commit.\n');
    const res = run(['agents', '--sync'], dir);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /and the linter/, 'CLAUDE.md regenerated from the new AGENTS.md');
    assert.equal(readFileSync(join(dir, '.docguard.json'), 'utf8'), configBefore, 'init did not rewrite the config');
    assert.deepEqual(tree(dir), treeBefore, 'the sync created or removed no file');
    assert.equal(existsSync(join(dir, '.specify')), false, 'Spec Kit was not initialized');
  });

  it('an unmarked file that already exists is still left alone without --force', () => {
    agentsProject('hand');
    write(dir, 'CLAUDE.md', '# Hand-written\n');
    run(['agents', '--sync'], dir);
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Hand-written\n');
  });
});

describe('the config schema accepts every sourceRoot the code accepts (FR-004)', () => {
  it('sourceRoot is a string or an array of strings', () => {
    const schema = JSON.parse(readFileSync('schemas/docguard-config.schema.json', 'utf8'));
    const s = schema.properties.sourceRoot;
    const variants = s.oneOf || s.anyOf;
    assert.ok(Array.isArray(variants), 'sourceRoot declares alternatives');
    assert.ok(variants.some(v => v.type === 'string'));
    assert.ok(variants.some(v => v.type === 'array' && v.items?.type === 'string'));
  });
});

describe('the MCP Origin comment matches the code (FR-006)', () => {
  it('does not limit the Origin allow-list to loopback binds', () => {
    assert.doesNotMatch(readFileSync('cli/commands/mcp.mjs', 'utf8'), /Origin allow-list on loopback binds/);
  });
});

describe('PSR002 resolves pointers against files that exist, ignored or not (FR-007)', () => {
  it('a pointer to a file .docguardignore excludes is not reported missing', () => {
    fresh('psr');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    write(dir, 'AGENTS.md', '# Agents\n\nFinding codes are listed in docs/reference/findings.md and docs/reference/gone.md.\n');
    write(dir, 'docs/reference/findings.md', '# Findings\n');
    write(dir, '.docguardignore', 'docs/reference/findings.md\n');
    spawnSync('git', ['add', '-A'], { cwd: dir });
    const missing = validatePathScopedRules(dir, {}).findings.filter(f => f.code === 'PSR002').map(f => f.message);
    assert.ok(missing.some(m => m.includes('docs/reference/gone.md')), `a missing file is still reported: ${missing}`);
    assert.ok(!missing.some(m => m.includes('docs/reference/findings.md')), `an ignored file is not missing: ${missing}`);
  });
});
