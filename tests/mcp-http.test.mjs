/**
 * MCP Streamable HTTP transport — `docguard mcp --transport http`.
 *
 * Spawns the real server on an ephemeral port and exercises the transport
 * with fetch: initialize (session header), tools/list, tools/call,
 * notifications-only (202), auth (401), GET (405), and the non-loopback
 * bind refusal without an api-key.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const API_KEY = 'test-key-123';

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

describe('docguard mcp --transport http', () => {
  let dir;
  let proc;
  let base;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-mcphttp-'));
    writeFileSync(join(dir, '.docguard.json'),
      JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' }));
    // Port 0 → OS-assigned; the startup banner on stderr carries the real port.
    proc = spawn('node', [CLI, 'mcp', '--transport', 'http', '--port', '0', '--api-key', API_KEY, '--dir', dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    base = await new Promise((resolvePort, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error(`server did not start: ${buf}`)), 15000);
      proc.stderr.on('data', (c) => {
        buf += c;
        const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)(\/\S*)/);
        if (m) { clearTimeout(t); resolvePort(`http://127.0.0.1:${m[1]}${m[2]}`); }
      });
      proc.on('exit', (code) => reject(new Error(`server exited early (${code}): ${buf}`)));
    });
  });

  after(() => {
    if (proc) proc.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const post = (body, headers = {}) => fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, ...headers },
    body: JSON.stringify(body),
  });

  it('initialize returns serverInfo and issues an Mcp-Session-Id header', async () => {
    const res = await post(rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} }));
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('mcp-session-id'), 'session id header expected on initialize');
    const body = await res.json();
    assert.equal(body.result.serverInfo.name, 'docguard');
  });

  it('tools/list returns the six read-only tools', async () => {
    const res = await post(rpc('tools/list', {}, 2));
    const body = await res.json();
    const names = body.result.tools.map(t => t.name);
    assert.deepEqual(names.sort(), [
      'docguard_diagnose', 'docguard_explain', 'docguard_guard', 'docguard_report', 'docguard_score', 'docguard_verify_claims',
    ]);
  });

  it('tools/call docguard_explain works end-to-end over HTTP', async () => {
    const res = await post(rpc('tools/call', { name: 'docguard_explain', arguments: { code: 'STR001' } }, 3));
    const body = await res.json();
    assert.equal(body.result.isError, undefined);
    assert.match(body.result.content[0].text, /STR001/);
  });

  it('a notifications-only body gets 202 with no content', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(res.status, 202);
  });

  it('rejects requests without the api-key (401), accepts X-API-Key', async () => {
    const bad = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc('ping', {}, 4)),
    });
    assert.equal(bad.status, 401);
    const viaHeader = await fetch(base, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify(rpc('ping', {}, 5)),
    });
    assert.equal(viaHeader.status, 200);
  });

  it('GET is 405 (no SSE stream offered); unknown path is 404; bad JSON is 400', async () => {
    const g = await fetch(base, { method: 'GET', headers: { authorization: `Bearer ${API_KEY}` } });
    assert.equal(g.status, 405);
    const nf = await fetch(base.replace('/mcp', '/nope'), {
      method: 'POST', headers: { authorization: `Bearer ${API_KEY}` }, body: '{}',
    });
    assert.equal(nf.status, 404);
    const bad = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: '{not json',
    });
    assert.equal(bad.status, 400);
  });

  it('rejects browser cross-site origins (DNS-rebinding guard)', async () => {
    const res = await post(rpc('ping', {}, 6), { origin: 'https://evil.example.com' });
    assert.equal(res.status, 403);
  });

  it('refuses to bind a non-loopback host without an api-key', () => {
    const r = spawnSync('node', [CLI, 'mcp', '--transport', 'http', '--host', '0.0.0.0', '--port', '0', '--dir', dir], {
      encoding: 'utf-8', timeout: 10000, env: { ...process.env, DOCGUARD_API_KEY: '' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to bind/);
  });
});
