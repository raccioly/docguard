/**
 * MCP Server Tests — `docguard mcp` over stdio.
 *
 * Spawns the real server and drives the MCP handshake end-to-end:
 * initialize → notifications/initialized → tools/list → tools/call.
 *
 * Every stdout line must parse as JSON-RPC — any stray banner/color byte on
 * the transport is a protocol corruption and fails the run. All waits are
 * DEADLINE-based (≥15s), never fixed short sleeps: a prior CI flake came from
 * a 2s cap on a loaded runner.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

const RESPONSE_DEADLINE_MS = 20000;

/** Newline-delimited JSON-RPC client over a spawned `docguard mcp` process. */
class McpClient {
  constructor(cwd) {
    this.proc = spawn('node', [CLI, 'mcp'], {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = '';
    this.messages = [];
    this.parseErrors = [];
    this.waiters = [];
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let nl;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); }
        catch { this.parseErrors.push(line); continue; }
        this._dispatch(msg);
      }
    });
  }

  _dispatch(msg) {
    this.messages.push(msg);
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].predicate(msg)) {
        const { resolve, timer } = this.waiters.splice(i, 1)[0];
        clearTimeout(timer);
        resolve(msg);
      }
    }
  }

  send(msg) {
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
  }

  /** Send a request and resolve on the response with the matching id. */
  request(msg) {
    const p = this.waitFor((m) => m.id === msg.id);
    this.send(msg);
    return p;
  }

  waitFor(predicate) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No matching MCP response within ${RESPONSE_DEADLINE_MS}ms (got ${this.messages.length} messages)`)),
        RESPONSE_DEADLINE_MS
      );
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  kill() {
    try { this.proc.stdin.end(); } catch { /* already gone */ }
    this.proc.kill();
  }
}

describe('docguard mcp', () => {
  let fixture;
  let client;

  before(() => {
    // Minimal project fixture: a config is all guard needs to run (findings
    // about missing docs are expected — the contract shape is what's tested).
    fixture = mkdtempSync(join(tmpdir(), 'docguard-mcp-'));
    writeFileSync(join(fixture, '.docguard.json'), JSON.stringify({
      projectName: 'mcp-fixture',
      profile: 'starter',
    }, null, 2));
    writeFileSync(join(fixture, 'README.md'), '# mcp-fixture\n\nTest fixture for the MCP server.\n');
    client = new McpClient(fixture);
  });

  after(() => {
    client.kill();
    rmSync(fixture, { recursive: true, force: true });
  });

  it('initialize handshake identifies the server and echoes the protocol version', async () => {
    const res = await client.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'docguard-tests', version: '0.0.0' },
      },
    });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.ok(res.result, 'initialize must return a result');
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.equal(res.result.serverInfo.name, 'docguard');
    assert.match(res.result.serverInfo.version, /^\d+\.\d+\.\d+/);
    assert.ok(res.result.capabilities.tools, 'must advertise the tools capability');

    // notifications/initialized takes no response — just must not crash the server.
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  });

  it('tools/list exposes the five DocGuard tools with input schemas', async () => {
    const res = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(res.id, 2);
    const tools = res.result.tools;
    assert.equal(tools.length, 5);
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['docguard_diagnose', 'docguard_explain', 'docguard_guard', 'docguard_score', 'docguard_verify_claims']
    );
    for (const t of tools) {
      assert.ok(t.description, `${t.name} must have a description`);
      assert.equal(t.inputSchema.type, 'object', `${t.name} must have an object inputSchema`);
    }
    const explain = tools.find((t) => t.name === 'docguard_explain');
    assert.deepEqual(explain.inputSchema.required, ['code']);
  });

  it('tools/call docguard_explain resolves STR001 from the CODES registry', async () => {
    const res = await client.request({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'docguard_explain', arguments: { code: 'STR001' } },
    });
    assert.equal(res.id, 3);
    assert.ok(!res.error, 'must be a result, not a JSON-RPC error');
    assert.ok(!res.result.isError, 'known code must not be an in-tool error');
    const payload = JSON.parse(res.result.content[0].text);
    assert.equal(payload.code, 'STR001');
    assert.equal(payload.validator, 'structure');
    assert.equal(payload.title, 'Missing required file');
    assert.ok(payload.help.length > 20, 'help text must be substantive');
  });

  it('tools/call docguard_explain flags an unknown code as an in-tool error, not a protocol error', async () => {
    const res = await client.request({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'docguard_explain', arguments: { code: 'NOPE999' } },
    });
    assert.equal(res.id, 4);
    assert.ok(!res.error, 'in-tool failure must NOT be a JSON-RPC error');
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /Unknown finding code "NOPE999"/);
  });

  it('tools/call docguard_guard returns the guard contract for the fixture project', async () => {
    const res = await client.request({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'docguard_guard', arguments: { projectDir: fixture } },
    });
    assert.equal(res.id, 5);
    assert.ok(!res.error, 'guard call must be a result, not a JSON-RPC error');
    const data = JSON.parse(res.result.content[0].text);
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(data.status), `status must be PASS/WARN/FAIL, got ${data.status}`);
    assert.equal(data.project, 'mcp-fixture');
    assert.ok(Array.isArray(data.findings), 'contract must include findings[]');
    assert.ok(Array.isArray(data.validators) && data.validators.length > 0, 'contract must include per-validator results');
    assert.ok('nextStep' in data, 'contract must include nextStep');
  });

  it('rejects an unknown method with -32601 and answers ping with an empty result', async () => {
    const unknown = await client.request({ jsonrpc: '2.0', id: 6, method: 'no/such/method' });
    assert.equal(unknown.error.code, -32601);

    const pong = await client.request({ jsonrpc: '2.0', id: 7, method: 'ping' });
    assert.deepEqual(pong.result, {});
  });

  it('keeps the stdout transport pure JSON-RPC (no banner, no color, no garbage)', () => {
    assert.deepEqual(client.parseErrors, [], `non-JSON lines leaked onto stdout: ${client.parseErrors.join(' | ')}`);
  });
});
