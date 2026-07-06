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
 * Serve MCP over stdio until stdin closes. The returned promise keeps the
 * dispatcher's `await` (and thus the process) alive for the server's lifetime.
 */
export function runMcp(projectDir, _config, _flags) {
  const send = (msg) => {
    // A vanished client (EPIPE) is a normal shutdown, not a crash.
    try { process.stdout.write(JSON.stringify(msg) + '\n'); }
    catch { /* client gone — the readline close handler ends the server */ }
  };
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  const handleMessage = (msg) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      replyError(msg && msg.id !== undefined ? msg.id : null, E_INVALID_REQUEST, 'Invalid Request');
      return;
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'docguard', version: _PKG.version },
        });
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const handler = TOOL_HANDLERS[params?.name];
        if (!handler) {
          replyError(id, E_INVALID_PARAMS, `Unknown tool: ${params?.name}`);
          return;
        }
        // In-tool failures are tool RESULTS (isError), not protocol errors —
        // one bad call must never take down the server or the session.
        try {
          const payload = handler(params?.arguments || {}, projectDir);
          reply(id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
        } catch (err) {
          reply(id, { content: [{ type: 'text', text: String((err && err.message) || err) }], isError: true });
        }
        return;
      }
      default:
        // Notifications (initialized, cancelled, …) get no response by spec.
        if (isNotification) return;
        replyError(id, E_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  };

  process.stderr.write(`docguard mcp v${_PKG.version} — serving ${TOOLS.length} tools on stdio (project: ${projectDir})\n`);

  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch { replyError(null, E_PARSE, 'Parse error'); return; }
      try { handleMessage(msg); }
      catch (err) {
        // Last-resort trap: a protocol-handler bug must not kill the server.
        process.stderr.write(`docguard mcp: internal error: ${err && err.stack || err}\n`);
        if (msg && msg.id !== undefined && msg.id !== null) replyError(msg.id, E_INTERNAL, 'Internal error');
      }
    });
    rl.on('close', () => done());
  });
}
