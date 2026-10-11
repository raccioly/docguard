---
title: MCP Server
parent: Reference
nav_order: 6
---

# MCP Server

`docguard mcp` serves DocGuard's checks and document navigation as Model
Context Protocol tools. Every tool is read-only: it reads the project and
never writes, scaffolds or calls the network. No tool calls a language model.

```bash
npx docguard-cli mcp
```

The server speaks JSON-RPC 2.0, one message per line, over stdio by default,
or over Streamable HTTP with `--transport http`. It implements MCP protocol
revision `2024-11-05` and echoes the revision a client asks for in
`initialize`. Source: `cli/commands/mcp.mjs`.

## Options

`docguard mcp --help` prints the general help; these are the options the
server reads.

| Option | Default | Effect |
|---|---|---|
| `--dir <path>` | The working directory | The served directory: tools run against it when a call names no `projectDir` |
| `--root <dir>` | none | Serve another directory tree as well. Repeatable. A root that does not exist or is not a directory stops the server at startup with exit code 1 |
| `--transport <name>` | `stdio` | `stdio` or `http`; any other value exits with code 1 |
| `--host <host>` | `127.0.0.1` | HTTP only. A host other than `127.0.0.1`, `localhost` or `::1` requires an API key |
| `--port <n>` | `8585` | HTTP only |
| `--path <path>` | `/mcp` | HTTP only: the endpoint path; any other path answers 404 |
| `--api-key <key>` | The `DOCGUARD_API_KEY` environment variable, else none | HTTP only: every request must carry the key |

On startup the server prints one line to stderr naming the transport, the
served directory and every root. On stdio, stdout carries only JSON-RPC
messages; every diagnostic goes to stderr.

## Project confinement

Every project-scoped tool accepts an optional `projectDir`.

- Without it, the tool runs against the served directory.
- With it, the path is resolved against the served directory, symbolic links
  are followed, and the result must be the served directory, one of the
  `--root` trees, or a directory inside one of them.
- Anything else returns an `isError` result that names the served roots and
  says to restart with `--root <dir>`. The message is the same whether or not
  the outside path exists, and nothing under it is read.

The same rule applies on both transports. To serve several repositories from
one server, name each at startup:

```bash
docguard mcp --root ~/work/api --root ~/work/web
```

A package inside the served directory, such as one workspace of a monorepo,
needs no `--root`. Spec: `specs/041-mcp-project-confinement/spec.md`.

## Tools

All tools carry the MCP annotations `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`.
`projectDir` is optional on every tool except `docguard_explain`, which takes
none.

| Tool | Inputs | Returns |
|---|---|---|
| `docguard_guard` | `detail`: `"compact"` (default) or `"full"` | Status (`PASS`, `WARN`, `FAIL`), findings with stable codes and suggestions, next step, coverage, semantic-claim count, per-validator status and counts |
| `docguard_score` | none | `score`, `grade`, `categories`, `scoreKind` and `assurance` |
| `docguard_explain` | `code` (required, case-insensitive) | For a finding code: `title`, `help`, `suppress`, `validator`. For a lifecycle blocker code: `kind: "blocker"`, `title`, `help`, `command` |
| `docguard_verify_evidence` | none | Each statement declared in `.docguard-evidence.json` checked against bounded local sources, with states `verified-within-scope`, `contradicted`, `stale`, `inconclusive`, `unsupported` |
| `docguard_verify_claims` | none | `claimCount`, `verifiedWithinScope`, and `tasks`: documented numbers, limits and enums for the caller to check against the code |
| `docguard_report` | none | The compliance-evidence bundle: verdict per validator, findings by code, score, ALCOA+ attributes, fix history and a sha256 integrity hash |
| `docguard_docs_for_path` | `path` (required, project-relative) | Canonical doc lines that name the file, lines in `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`, the `@implements`/`@req` IDs it declares, its `@doc` annotations, and doc sections whose `covers=` includes it |
| `docguard_doc_structure` | `doc` (required) | One document's headings (level, anchor, line range, bytes), section markers, fact markers, marker issues, last-reviewed date and size |
| `docguard_read_section` | `doc` (required); one of `id`, `anchor`, `heading` or `line`; `context` (0 to 50, default 3, with `line`); `offset`; `maxBytes` | One section, found by section id, then anchor, then exact heading; or the lines around `line`. 8 KiB by default, 32 KiB at most; a truncated read returns `nextOffset`. An ambiguous match fails with the candidates |
| `docguard_task_context` | `task` (required) | The packet `docguard agent --task <text> --format json` prints: task-linked requirements, code and test pointers, excerpts and verification steps. It abstains when relevance is weak |
| `docguard_anchors` | `spec`, `file` (optional) | The listing `docguard anchors --format json` prints: each `@implements`/`@req` tag, the requirement it resolves to, and the file, symbol, statement or route it anchors to with its tier, plus problems. Bounded to 200 links; it never writes the anchor lock |
| `docguard_diagnose` | none | `status`, error and warning counts, `nextStep`, and `problems`: only the validators with errors or warnings, each with its findings and suggestions |

### Compact and full guard responses

`docguard_guard` returns the compact form by default. It is a projection of
the full result, never a recomputation, so both always agree
(`cli/shared-guard-json.mjs`; spec `specs/037-compact-guard-response/spec.md`).

| | Compact (default) | Full (`detail: "full"`) |
|---|---|---|
| Findings | Each once, in `findings` | In `findings`, again in `reportable` and in each `validators[].findings` |
| Evidence per code | Once per code, in `evidenceByCode` | On every finding |
| Validators | Status, applicability and `errorCount`/`warningCount`; messages only for validators without structured findings | Status, applicability, findings and messages |
| Standard applicability reasons | Once, in `applicabilityReasons` | On each validator |
| `checkCoverage` | Counts and caveat | Counts, caveat and `limitations` |
| Raw benchmark statistics per code | Left out | `precisionEvidence.codes` |
| Marker | `detail: "compact"` and a `hint` naming the full form | none |

The full form is the same contract `docguard guard --format json` prints. The
CLI prints the compact form with `docguard guard --format json --compact`.

## Errors

| Problem | Answer |
|---|---|
| A tool fails (bad argument, `projectDir` outside the roots, a malformed `.docguard.json`) | A normal result with `isError: true` and the message as text. The server keeps running |
| A line that is not JSON | JSON-RPC error `-32700` |
| A message that is not a JSON-RPC 2.0 request | `-32600` |
| An unknown method | `-32601` |
| An unknown tool | `-32602` |
| An internal failure | `-32603` |

Configuration is read on every call, so an edit to `.docguard.json` applies to
the next call without a restart.

## Streamable HTTP

```bash
docguard mcp --transport http                       # http://127.0.0.1:8585/mcp
docguard mcp --transport http --host 0.0.0.0 --api-key "$KEY"
```

| Request | Answer |
|---|---|
| `POST` a JSON-RPC message or batch | `200` with the response, or `202` with no body when the body holds only notifications |
| `POST` an `initialize` | Also sets an `Mcp-Session-Id` header. The server is stateless and accepts any session id, or none, afterwards |
| `GET` | `405`: the server does not offer a server-sent event stream |
| `DELETE` | `200`: there is no session state to end |
| Any other path | `404` |
| A body over 4 MiB | `413` |

Security rules:

- The server binds to `127.0.0.1` unless you pass `--host`. Binding any host
  other than `127.0.0.1`, `localhost` or `::1` without `--api-key` or
  `DOCGUARD_API_KEY` refuses to start.
- With a key set, every request must send `Authorization: Bearer <key>` or
  `X-API-Key: <key>`; otherwise `401`.
- A request with an `Origin` header whose host is not a loopback address is
  refused with `403`. Clients that send no `Origin`, such as MCP SDKs and
  `curl`, are not affected.
- An API key is not a boundary between projects: every client with the key
  reaches every served root.

## Version-age note

When the installed release is more than 14 days old, the `initialize` result
carries `instructions` that give the version and its release date, say a newer
version may exist, and tell the agent to offer `docguard upgrade` and never to
upgrade without the user's agreement. The date comes from the `CHANGELOG.md`
shipped in the package, so no network call is made. The note is absent in a
source checkout and with `DOCGUARD_NO_UPDATE_HINT=1`, and it never appears in
a tool result.

## Client setup

Each of these starts the same server. Point it at your project with `--dir`
(or the client's working directory) and add `--root` for further trees.

### Claude Code

```bash
claude mcp add docguard -- npx docguard-cli mcp
```

### Claude Desktop

Download `docguard-v<version>.mcpb` from the
[latest release](https://github.com/raccioly/docguard/releases/latest) and drag
it into Settings, Extensions. Claude Desktop asks for the project folder. The
bundle runs the copy of DocGuard inside it, so neither npm nor a JSON edit is
needed. Its manifest (`mcpb/manifest.template.json`) starts the server as:

```json
{
  "command": "node",
  "args": ["${__dirname}/cli/docguard.mjs", "mcp", "--dir", "${user_config.project_dir}"]
}
```

The manifest declares Node.js 18 or later and the macOS, Windows and Linux
platforms.

### Cursor and VS Code

The README's
[one-click install buttons](https://github.com/raccioly/docguard#one-click-mcp-install)
add DocGuard to Cursor and to VS Code. Both install this server definition,
with the name `docguard`:

```json
{
  "command": "npx",
  "args": ["-y", "docguard-cli", "mcp"]
}
```

To add it by hand, enter the same command and arguments in the client's MCP
server settings.

### Docker

A public image on GHCR runs the stdio server without a local Node.js:

```bash
docker run -i --rm -v "$PWD":/workspace ghcr.io/raccioly/docguard:latest
```

Mount the project at `/workspace`; it is the served directory. Arguments after
the image name go to `docguard mcp`, so `--root <dir>` serves another mounted
tree. Pin a version tag in shared setups.

### Registries

- **Official MCP registry**: `io.github.raccioly/docguard`, defined in
  `server.json` as the npm package `docguard-cli` run with `npx` and the `mcp`
  argument over stdio.
- **Smithery**: `smithery.yaml` runs `npx -y docguard-cli mcp`, with an
  optional `projectDir` that becomes `--dir`.

## Related

- [Coding Agents](agents.md): the skills and commands DocGuard installs for each agent.
- [AI Integration](../ai-integration.md): the JSON contract and the agent workflow.
- [Finding Codes](findings.md): what `docguard_explain` returns, for every code.
