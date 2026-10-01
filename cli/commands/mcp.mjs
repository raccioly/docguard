/**
 * @implements docguard.evidence-scoped-verification#FR-009
 * @implements docguard.evidence-scoped-verification#FR-012
 * @implements docguard.first-spec-preflight#FR-007
 * @implements docguard.mcp-project-confinement#FR-001
 * @implements docguard.mcp-project-confinement#FR-002
 * @implements docguard.mcp-project-confinement#FR-003
 * @implements docguard.mcp-project-confinement#FR-004
 * @implements docguard.mcp-project-confinement#FR-005
 * @implements docguard.mcp-project-confinement#FR-006
 * MCP Command — DocGuard as a Model Context Protocol server (stdio).
 *
 * `docguard mcp` exposes the read-only core (guard / score / explain /
 * verify-evidence / verify-claims / diagnose) as MCP tools any MCP client (Claude, Cursor,
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
 *     point each call at a different project — but only one inside the
 *     directories the operator started the server to serve (`--dir` or the
 *     working directory, plus each `--root`). The client never widens that.
 *
 * Zero npm dependencies — node:readline over process.stdin.
 */

import { compactGuardResult } from '../shared-guard-json.mjs';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path, { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { buildReport } from './report.mjs';
import { loadConfig } from '../config.mjs';
import { BLOCKER_CODES, CODES } from '../findings.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks } from '../scanners/semantic-claims.mjs';
import { coverSemanticClaims, evaluateEvidence } from '../evidence/evaluate.mjs';
import { docsForPath, docStructure, readSection, READ_DEFAULT_BYTES, READ_MAX_BYTES } from '../scanners/doc-references.mjs';
import { buildTaskContextPacket } from '../scanners/task-context.mjs';
import { releaseAge, updateHintText } from '../release-age.mjs';

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
// projectDir and falls back to the directory the server serves.
// docguard.mcp-project-confinement#FR-006
const PROJECT_DIR_PROP = {
  projectDir: {
    type: 'string',
    description: 'Project to inspect: a directory inside the directories this server serves (absolute, or relative to the served directory). Defaults to the served directory.',
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
    description: 'Run every enabled DocGuard validator against the project\'s canonical docs. Returns status (PASS/WARN/FAIL), every finding once with its stable code and suggestion, each code\'s evidence once, nextStep, doc coverage, semantic-claim count, and per-validator status and counts. Pass detail "full" for the complete guard JSON contract (per-validator finding copies, the reportable subset, raw benchmark statistics per code).',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_DIR_PROP,
        detail: { type: 'string', enum: ['compact', 'full'], default: 'compact', description: '"compact" (default): each fact once. "full": the complete guard JSON contract, as `docguard guard --format json` prints it.' },
      },
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
    name: 'docguard_verify_evidence',
    title: 'Verify declared evidence',
    description: 'Evaluate `.docguard-evidence.json` against bounded local sources. Returns explicit verified-within-scope, contradicted, stale, inconclusive, and unsupported states; verification applies only to each selected statement.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
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
    name: 'docguard_report',
    title: 'Compliance-evidence bundle',
    description: 'Generate the commit-stamped compliance-evidence bundle: guard verdict per validator, findings grouped by stable code, CDD score, ALCOA+ data-integrity attributes, fix history, and a tamper-evident sha256 integrity hash. Evidence, not a gate — it reports state without failing.',
    inputSchema: {
      type: 'object',
      properties: { ...PROJECT_DIR_PROP },
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_docs_for_path',
    title: 'Docs that describe a file',
    description: 'Exact answer to "which documentation describes this file?": canonical doc lines that name it (with heading, anchor and section), AGENTS.md/CLAUDE.md/GEMINI.md lines, the @implements/@req IDs it declares, its @doc annotations, and doc sections whose covers= includes it with their review state. Deterministic, bounded, no model.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project-relative file path, e.g. src/api/users.ts' }, ...PROJECT_DIR_PROP },
      required: ['path'],
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_doc_structure',
    title: 'Outline of one document',
    description: 'A document\'s headings (level, text, anchor, line range, bytes), docguard:section markers (id, source, pinned, covers), fact markers, marker issues, last-reviewed date and size — so an agent can read one section instead of the whole file.',
    inputSchema: {
      type: 'object',
      properties: { doc: { type: 'string', description: 'Project-relative Markdown path, e.g. docs-canonical/ARCHITECTURE.md' }, ...PROJECT_DIR_PROP },
      required: ['doc'],
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_read_section',
    title: 'Read one section of a document',
    description: `Return one section's text, resolved by docguard:section id, then heading anchor, then exact heading text — or, with \`line\`, just the lines around one reference from docguard_docs_for_path (the cheapest read for a table row). Bounded: ${READ_DEFAULT_BYTES} bytes by default, ${READ_MAX_BYTES} at most; a truncated result carries nextOffset. An ambiguous match fails with the candidates.`,
    inputSchema: {
      type: 'object',
      properties: {
        doc: { type: 'string', description: 'Project-relative Markdown path' },
        id: { type: 'string', description: 'docguard:section id' },
        anchor: { type: 'string', description: 'Heading anchor, e.g. spec-lifecycle-registry' },
        heading: { type: 'string', description: 'Exact heading text' },
        line: { type: 'integer', minimum: 1, description: 'Read the lines around this line number instead of a whole section' },
        context: { type: 'integer', minimum: 0, maximum: 50, description: 'With line: lines before and after (default 3)' },
        offset: { type: 'integer', minimum: 0, description: 'Byte offset from a previous truncated read' },
        maxBytes: { type: 'integer', minimum: 1, maximum: READ_MAX_BYTES },
        ...PROJECT_DIR_PROP,
      },
      required: ['doc'],
    },
    annotations: READONLY_ANNOTATIONS,
  },
  {
    name: 'docguard_task_context',
    title: 'Bounded context packet for a task',
    description: 'The same deterministic packet as `docguard agent --task <text> --format json`: current task-linked requirements, pointers to implementing code and tests, excerpts, and verification steps; abstains when relevance is weak.',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'What the agent is about to do' }, ...PROJECT_DIR_PROP },
      required: ['task'],
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

// ── Served roots (docguard.mcp-project-confinement) ─────────────────────────
//
// The operator decides what the server exposes when starting it; a tool call's
// projectDir may only select a directory inside that. Comparison happens on
// real paths (symlinks followed, letter case as stored — realpathSync.native
// canonicalizes it on macOS and Windows), so neither a symlink nor `..` nor a
// case variant changes the answer.

/**
 * True when `target` is `root` or inside it. Both must already be absolute
 * paths in `pathImpl`'s flavour. `relative` rather than a string prefix, so
 * `/x/app-other` is not inside `/x/app`; win32's `relative` compares case-
 * insensitively and returns an absolute path across drives and UNC shares.
 */
export function isWithinRoot(root, target, pathImpl = path) {
  const rel = pathImpl.relative(root, target);
  if (rel === '') return true;
  if (pathImpl.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${pathImpl.sep}`);
}

/**
 * The real path of `p`, or — when its tail does not exist — the real path of
 * its deepest existing ancestor with the missing segments appended. A missing
 * path is judged by where it would be, so a symlink in its existing part
 * cannot make an outside path look inside (and the refusal cannot be used to
 * probe which outside paths exist).
 */
function realish(p) {
  const tail = [];
  let head = p;
  for (;;) {
    try { return tail.length ? join(realpathSync.native(head), ...tail.reverse()) : realpathSync.native(head); }
    catch {
      const up = dirname(head);
      if (up === head) return p;
      tail.push(basename(head));
      head = up;
    }
  }
}

/**
 * The serving context, built once at startup (FR-005). The served directory
 * is always a root; each `--root` must exist and be a directory, or the
 * server refuses to start (throws).
 */
export function buildServedRoots(projectDir, extraRoots = []) {
  const dir = resolve(projectDir);
  const roots = [realish(dir)];
  for (const r of extraRoots) {
    const abs = resolve(String(r));
    let st;
    try { st = statSync(abs); } catch { throw new Error(`--root does not exist: ${abs}`); }
    if (!st.isDirectory()) throw new Error(`--root is not a directory: ${abs}`);
    const real = realpathSync.native(abs);
    if (!roots.includes(real)) roots.push(real);
  }
  return { dir, realDir: roots[0], roots };
}

/**
 * Resolve a tool call's target project + config. loadConfig() process.exit(1)s
 * on a malformed .docguard.json — fatal for a long-lived server — so the file
 * is pre-parsed here and a broken config surfaces as an isError tool result.
 *
 * docguard.mcp-project-confinement#FR-001, FR-002, FR-004: no projectDir →
 * the served directory, unchanged. Otherwise the argument resolves against the
 * served directory and must land inside a served root before anything under it
 * is read; an outside path gets one message whether or not it exists.
 */
function resolveTarget(args, serving) {
  const requested = args && typeof args.projectDir === 'string' && args.projectDir.trim() !== '' ? args.projectDir : null;
  let dir = serving.dir;
  if (requested !== null) {
    const lexical = resolve(serving.dir, requested);
    const real = realish(lexical);
    if (!serving.roots.some((root) => isWithinRoot(root, real))) {
      throw new Error(
        `projectDir is outside the directories this server serves (${serving.roots.join(', ')}). ` +
        'Pass a directory inside one of them, or restart the server with --root <dir> to serve another tree.');
    }
    if (!existsSync(real)) throw new Error(`projectDir does not exist: ${lexical}`);
    if (!statSync(real).isDirectory()) throw new Error(`projectDir is not a directory: ${lexical}`);
    // Run against the resolved path, not the caller's spelling; the served
    // directory keeps its own spelling so every name for it answers alike.
    dir = real === serving.realDir ? serving.dir : real;
  } else if (!existsSync(dir)) {
    throw new Error(`projectDir does not exist: ${dir}`);
  }
  const cfgPath = resolve(dir, '.docguard.json');
  if (existsSync(cfgPath)) {
    try { JSON.parse(readFileSync(cfgPath, 'utf-8')); }
    catch (e) { throw new Error(`Cannot parse ${cfgPath}: ${e.message}`); }
  }
  return { dir, config: loadConfig(dir) };
}

const TOOL_HANDLERS = {
  docguard_guard(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    const detail = args?.detail ?? 'compact';
    if (detail !== 'compact' && detail !== 'full') throw new Error('detail must be "compact" or "full"');
    const result = runGuardInternal(dir, config);
    // docguard.compact-guard-response#FR-003: agents get each fact once by default.
    return detail === 'full' ? result : compactGuardResult(result);
  },

  docguard_score(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    return runScoreInternal(dir, config);
  },

  docguard_explain(args) {
    const code = String((args && args.code) || '').trim().toUpperCase();
    if (!code) throw new Error('Missing required argument "code" (a stable finding code, e.g. STR001).');
    const entry = CODES[code];
    // docguard.first-spec-preflight#FR-007: lifecycle command blockers too.
    const blocker = BLOCKER_CODES[code];
    if (!entry && blocker) return { code, kind: 'blocker', title: blocker.title, help: blocker.help, command: blocker.command };
    if (!entry) {
      throw new Error(`Unknown finding code "${code}". Codes are the stable handles guard prints next to each finding (e.g. STR001, ENV003) — run docguard_guard and use a code from its findings.`);
    }
    return { code, title: entry.title, help: entry.help, suppress: entry.suppress, validator: entry.validator };
  },

  docguard_verify_claims(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    const claims = extractSemanticClaims(dir, config);
    const coverage = coverSemanticClaims(claims, evaluateEvidence(dir, config));
    return {
      claimCount: claims.length,
      verifiedWithinScope: coverage.verifiedWithinScope,
      note: 'Deterministic discovery, LLM judgment — the caller verifies each claim against the code and reports any mismatch with both values.',
      tasks: buildSemanticVerifyTasks(coverage.remaining),
    };
  },

  docguard_verify_evidence(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    return evaluateEvidence(dir, config);
  },

  docguard_report(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    return buildReport(dir, config);
  },

  // docguard.mcp-doc-tools: exact, bounded reads. No tool here answers in
  // natural language or calls a model (FR-009).
  docguard_docs_for_path(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    return docsForPath(dir, config, String((args && args.path) || ''));
  },

  docguard_doc_structure(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    return docStructure(dir, config, String((args && args.doc) || ''));
  },

  docguard_read_section(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    const { doc, id, anchor, heading, line, context, offset, maxBytes } = args || {};
    if (!id && !anchor && !heading && line === undefined) throw new Error('Pass one of "id", "anchor", "heading" or "line" (see docguard_doc_structure and docguard_docs_for_path).');
    return readSection(dir, config, { doc: String(doc || ''), id, anchor, heading, line, context, offset, maxBytes });
  },

  docguard_task_context(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
    const task = String((args && args.task) || '').trim();
    if (!task) throw new Error('Missing required argument "task".');
    return buildTaskContextPacket(dir, config, task);
  },

  docguard_diagnose(args, serving) {
    const { dir, config } = resolveTarget(args, serving);
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
function dispatchMessage(msg, serving) {
  const result = (id, res) => ({ jsonrpc: '2.0', id, result: res });
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return error(msg && msg.id !== undefined ? msg.id : null, E_INVALID_REQUEST, 'Invalid Request');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      // docguard.update-awareness#FR-004: computed per session, so a server
      // left running for weeks reports its current age to each new client.
      const instructions = updateHintText(releaseAge(), 'mcp');
      return result(id, {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'docguard', version: _PKG.version },
        ...(instructions ? { instructions } : {}),
      });
    }
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
        const payload = handler(params?.arguments || {}, serving);
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
  if (flags.transport && flags.transport !== 'stdio' && flags.transport !== 'http') {
    process.stderr.write(`docguard mcp: unknown transport "${flags.transport}" (expected stdio or http)\n`);
    process.exitCode = 1;
    return;
  }
  // docguard.mcp-project-confinement#FR-005: a bad --root stops the server
  // before it serves anything, on either transport.
  let serving;
  try { serving = buildServedRoots(projectDir, flags.roots || []); }
  catch (err) {
    process.stderr.write(`docguard mcp: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (flags.transport === 'http') return runMcpHttp(serving, flags);

  const send = (msg) => {
    // A vanished client (EPIPE) is a normal shutdown, not a crash.
    try { process.stdout.write(JSON.stringify(msg) + '\n'); }
    catch { /* client gone — the readline close handler ends the server */ }
  };

  process.stderr.write(`docguard mcp v${_PKG.version} — serving ${TOOLS.length} tools on stdio (project: ${serving.dir}; roots: ${serving.roots.join(', ')})\n`);

  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: E_PARSE, message: 'Parse error' } }); return; }
      try {
        const resp = dispatchMessage(msg, serving);
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

async function runMcpHttp(serving, flags) {
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
        const responses = messages.map((m) => dispatchMessage(m, serving)).filter(Boolean);
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
        `(project: ${serving.dir}; roots: ${serving.roots.join(', ')}${apiKey ? '; api-key required' : '; loopback only'})\n`);
    });
    server.on('close', () => done());
  });
}
