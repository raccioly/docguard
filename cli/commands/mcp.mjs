/**
 * MCP Command — DocGuard as a Model Context Protocol server (stdio).
 *
 * `docguard mcp` exposes the read-only core (guard / score / explain /
 * verify-claims / diagnose) as MCP tools any MCP client (Claude, Cursor,
 * agent SDKs) can call over stdio. JSON-RPC 2.0, newline-delimited, per the
 * MCP stdio transport (protocol revision 2024-11-05).
 *
 * Contract constraints:
 *   - stdout IS the transport. Nothing else may be written there — the
 *     dispatcher suppresses the banner for this command, and every diagnostic
 *     goes to stderr.
 *   - Tool failures are isolated: an exception inside a tool becomes an
 *     `isError: true` tool RESULT (per MCP), never a JSON-RPC error and never
 *     a server crash. Protocol-level problems (unparseable line, unknown
 *     method, unknown tool) get the standard JSON-RPC error codes.
 *   - Config is loaded PER tool call: the server is long-lived, .docguard.json
 *     may change between calls, and the optional `projectDir` argument may
 *     point each call at a different project.
 *
 * Zero npm dependencies — node:readline over process.stdin.
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { loadConfig } from '../config.mjs';
import { CODES } from '../findings.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks } from '../scanners/semantic-claims.mjs';

const _PKG = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8'));

// Oldest MCP revision this server implements; echoed back on initialize when
// the client requests a version we recognize the shape of.
const PROTOCOL_VERSION = '2024-11-05';

// JSON-RPC 2.0 reserved error codes.
const E_PARSE = -32700;
const E_INVALID_REQUEST = -32600;
const E_METHOD_NOT_FOUND = -32601;
const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

// Shared schema fragment: every project-scoped tool accepts an optional
// projectDir and falls back to the server's working directory.
const PROJECT_DIR_PROP = {
  projectDir: {
    type: 'string',
    description: 'Path to the project to inspect (absolute, or relative to the server\'s working directory). Defaults to the working directory the server was started in.',
  },
};

// Every DocGuard MCP tool is READ-ONLY: it inspects local project files and
// never writes, mutates, or reaches the network. These MCP tool hints let
// clients (and directory scanners like Glama) surface that safety to users.
const READONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS = [
  {
    name: 'docguard_guard',
    title: 'Guard docs against code',
    description: 'Run every enabled DocGuard validator against the project\'s canonical docs. Returns the full guard JSON contract: status (PASS/WARN/FAIL), structured findings with stable codes and suggestions, nextStep, doc coverage map, semantic-claim count, and per-validator results.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_score',
    title: 'CDD maturity score',
    description: 'Compute the project\'s CDD maturity score (0-100) with letter grade and per-category breakdown.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_explain',
    title: 'Explain a finding code',
    description: 'Explain a stable DocGuard finding code (e.g. STR001, ENV003): what it means, which validator emits it, and the inline suppression to use if it\'s a confirmed false positive.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The finding code guard prints next to each finding, e.g. STR001 or ENV003. Case-insensitive.',
        },
      },
      required: ['code'],
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_verify_claims',
    title: 'Extract claims to verify',
    description: 'Extract the semantic claims in the project\'s canonical docs — documented numbers, limits, and enums — as a verification task list. Deterministic discovery, LLM judgment — the caller verifies each claim against the code.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_diagnose',
    title: 'Diagnose what to fix',
    description: 'Run guard and return only what needs fixing: failing/warning validators with their messages, structured findings, and suggested next actions — shaped for an agent to act on.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
    },
    annotations: READONLY_ANNOTATIONS,
  },
];

/**
 * Resolve a tool call's target project + config. loadConfig() process.exit(1)s
 * on a malformed .docguard.json — fatal for a long-lived server — so the file
 * is pre-parsed here and a broken config surfaces as an isError tool result.
 */
function resolveTarget(args, defaultDir) {
  const dir = resolve(args && typeof args.projectDir === 'string' && args.projectDir.trim() !== '' ? args.projectDir : defaultDir);
  if (!existsSync(dir)) throw new Error(`projectDir does not exist: ${dir}`);
  const cfgPath = resolve(dir, '.docguard.json');
  if (existsSync(cfgPath)) {
    try { JSON.parse(readFileSync(cfgPath, 'utf-8')); }
    catch (e) { throw new Error(`Cannot parse ${cfgPath}: ${e.message}`); }
  }
  return { dir, config: loadConfig(dir) };
}

const TOOL_HANDLERS = {
  docguard_guard(args, defaultDir) {
    const { dir, config } = resolveTarget(args, defaultDir);
    return runGuardInternal(dir, config);
  },

  docguard_score(args, defaultDir) {
    const { dir, config } = resolveTarget(args, defaultDir);
    return runScoreInternal(dir, config);
  },

  docguard_explain(args) {
    const code = String((args && args.code) || '').trim().toUpperCase();
    if (!code) throw new Error('Missing required argument "code" (a stable finding code, e.g. STR001).');
    const entry = CODES[code];
    if (!entry) {
      throw new Error(`Unknown finding code "${code}". Codes are the stable handles guard prints next to each finding (e.g. STR001, ENV003) — run docguard_guard and use a code from its findings.`);
    }
    return { code, title: entry.title, help: entry.help, suppress: entry.suppress, validator: entry.validator };
  },

  docguard_verify_claims(args, defaultDir) {
    const { dir, config } = resolveTarget(args, defaultDir);
    const claims = extractSemanticClaims(dir, config);
    return {
      claimCount: claims.length,
      note: 'Deterministic discovery, LLM judgment — the caller verifies each claim against the code and reports any mismatch with both values.',
      tasks: buildSemanticVerifyTasks(claims),
    };
  },

  docguard_diagnose(args, defaultDir) {
    const { dir, config } = resolveTarget(args, defaultDir);
    const data = runGuardInternal(dir, config);
    // Only what needs acting on: validators with errors/warnings, each carrying
    // its structured findings (code + location + suggestion) when available.
    const problems = (data.validators || [])
      .filter((v) => (v.errors || []).length + (v.warnings || []).length > 0)
      .map((v) => ({
        validator: v.name,
        key: v.key,
        severity: v.severity || 'medium',
        errors: v.errors || [],
        warnings: v.warnings || [],
        findings: (Array.isArray(v.findings) ? v.findings : []).map((f) => ({
          code: f.code,
          severity: f.severity,
          message: f.message,
          location: f.location,
          suggestion: f.suggestion,
        })),
      }));
    return {
      status: data.status,
      errors: data.errors,
      warnings: data.warnings,
      nextStep: data.nextStep,
      problems,
      hint: problems.length === 0
        ? 'Nothing to fix — guard is clean.'
        : 'Fix errors first, then warnings. Use docguard_explain with a finding code for the full remediation help.',
    };
  },
};

/**
 * Transport-agnostic JSON-RPC dispatch. Returns the response message for a
 * request, or null for notifications (which get no response by spec). Both
 * the stdio and HTTP transports route through this one dispatcher.
 */
function dispatchMessage(msg, projectDir) {
  const result = (id, res) => ({ jsonrpc: '2.0', id, result: res });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return error(msg && msg.id !== undefined ? msg.id : null, E_INVALID_REQUEST, 'Invalid Request');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'docguard', version: _PKG.version },
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const handler = TOOL_HANDLERS[params?.name];
      if (!handler) return error(id, E_INVALID_PARAMS, `Unknown tool: ${params?.name}`);
      // In-tool failures are tool RESULTS (isError), not protocol errors —
      // one bad call must never take down the server or the session.
      try {
        const payload = handler(params?.arguments || {}, projectDir);
        return result(id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
      } catch (err) {
        return result(id, { content: [{ type: 'text', text: String((err && err.message) || err) }], isError: true });
      }
    }
    default:
      // Notifications (initialized, cancelled, …) get no response by spec.
      if (isNotification) return null;
      return error(id, E_METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * Serve MCP until the transport closes. The returned promise keeps the
 * dispatcher's `await` (and thus the process) alive for the server's lifetime.
 * Default transport is stdio; `--transport http` serves the same tools over
 * the MCP Streamable HTTP transport so one shared process can serve a team.
 */
export function runMcp(projectDir, _config, flags = {}) {
  if (flags.transport === 'http') return runMcpHttp(projectDir, flags);
  if (flags.transport && flags.transport !== 'stdio') {
    process.stderr.write(`docguard mcp: unknown transport "${flags.transport}" (expected stdio or http)\n`);
    process.exitCode = 1;
    return;
  }

  const send = (msg) => {
    // A vanished client (EPIPE) is a normal shutdown, not a crash.
    try { process.stdout.write(JSON.stringify(msg) + '\n'); }
    catch { /* client gone — the readline close handler ends the server */ }
  };

  process.stderr.write(`docguard mcp v${_PKG.version} — serving ${TOOLS.length} tools on stdio (project: ${projectDir})\n`);

  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: E_PARSE, message: 'Parse error' } }); return; }
      try {
        const resp = dispatchMessage(msg, projectDir);
        if (resp) send(resp);
      } catch (err) {
        // Last-resort trap: a protocol-handler bug must not kill the server.
        process.stderr.write(`docguard mcp: internal error: ${err && err.stack || err}\n`);
        if (msg && msg.id !== undefined && msg.id !== null) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: E_INTERNAL, message: 'Internal error' } });
        }
      }
    });
    rl.on('close', () => done());
  });
}

// ── Streamable HTTP transport ───────────────────────────────────────────────
//
// Minimal spec-compliant subset, zero-dep (node:http):
//   - POST <path>: JSON-RPC request/batch in, application/json out. A body of
//     only notifications → 202 Accepted, empty.
//   - GET <path>: 405 — this server does not offer a server-initiated SSE
//     stream (clients that need one fall back to plain request/response).
//   - DELETE <path>: 200 — the server is stateless; nothing to clean up.
//   - `Mcp-Session-Id` is issued on initialize and accepted (not required)
//     afterwards — stateless by design, like `--stateless` HTTP MCP servers.
//
// Security posture (Security → Production-readiness → Simplicity):
//   - Default bind 127.0.0.1 (loopback-only).
//   - Binding any non-loopback host REQUIRES --api-key / DOCGUARD_API_KEY —
//     the server refuses to start otherwise, instead of warning and exposing
//     read access to the whole network.
//   - When an api-key is set, every request must carry it
//     (`Authorization: Bearer <key>` or `X-API-Key: <key>`) → else 401.
//   - Origin allow-list on loopback binds (DNS-rebinding guard per the MCP
//     Streamable HTTP security notes): browser-originated cross-site requests
//     are rejected; non-browser clients send no Origin and pass.

const HTTP_BODY_CAP = 4 * 1024 * 1024; // 4 MiB — guard payloads are large but bounded

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function runMcpHttp(projectDir, flags) {
  const { createServer } = await import('node:http');
  const { randomUUID } = await import('node:crypto');

  const host = flags.host || '127.0.0.1';
  const port = Number.isFinite(Number(flags.port)) && Number(flags.port) >= 0 ? Number(flags.port) : 8585;
  const mountPath = flags.path || '/mcp';
  const apiKey = flags.apiKey || process.env.DOCGUARD_API_KEY || '';

  if (!isLoopbackHost(host) && !apiKey) {
    process.stderr.write(
      `docguard mcp: refusing to bind ${host} without an API key.\n` +
      `Exposing the server beyond localhost requires --api-key <key> (or DOCGUARD_API_KEY).\n`);
    process.exitCode = 1;
    return;
  }

  const authorized = (req) => {
    if (!apiKey) return true;
    const auth = req.headers['authorization'] || '';
    const xkey = req.headers['x-api-key'] || '';
    return auth === `Bearer ${apiKey}` || xkey === apiKey;
  };

  const originAllowed = (req) => {
    const origin = req.headers['origin'];
    if (!origin) return true; // non-browser clients (MCP SDKs, curl) send none
    try {
      const o = new URL(origin);
      return isLoopbackHost(o.hostname);
    } catch { return false; }
  };

  const server = createServer((req, res) => {
    const answer = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    const url = (req.url || '').split('?')[0];
    if (url !== mountPath) return answer(404, { error: 'not found' });
    if (!originAllowed(req)) return answer(403, { error: 'origin not allowed' });
    if (!authorized(req)) return answer(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });

    if (req.method === 'GET') return answer(405, { error: 'SSE stream not offered — POST JSON-RPC to this endpoint' }, { allow: 'POST, DELETE' });
    if (req.method === 'DELETE') return answer(200, {}); // stateless — nothing to end
    if (req.method !== 'POST') return answer(405, { error: 'method not allowed' }, { allow: 'POST, DELETE' });

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > HTTP_BODY_CAP) { answer(413, { error: 'payload too large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')); }
      catch { return answer(400, { jsonrpc: '2.0', id: null, error: { code: E_PARSE, message: 'Parse error' } }); }

      try {
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const responses = messages.map((m) => dispatchMessage(m, projectDir)).filter(Boolean);
        // New sessions get an id on initialize; we accept any/none afterwards.
        const headers = messages.some((m) => m && m.method === 'initialize')
          ? { 'mcp-session-id': randomUUID() } : {};
        if (responses.length === 0) return answer(202, undefined, headers); // notifications only
        return answer(200, Array.isArray(parsed) ? responses : responses[0], headers);
      } catch (err) {
        process.stderr.write(`docguard mcp: internal error: ${err && err.stack || err}\n`);
        return answer(500, { jsonrpc: '2.0', id: null, error: { code: E_INTERNAL, message: 'Internal error' } });
      }
    });
  });

  return new Promise((done) => {
    server.listen(port, host, () => {
      const addr = server.address();
      process.stderr.write(
        `docguard mcp v${_PKG.version} — Streamable HTTP on http://${host}:${addr.port}${mountPath} ` +
        `(project: ${projectDir}${apiKey ? ', api-key required' : ', loopback only'})\n`);
    });
    server.on('close', () => done());
  });
}
