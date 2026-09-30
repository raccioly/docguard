# Implementation Plan: MCP Project Confinement

**Branch**: `fix/mcp-project-confinement` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/commands/mcp.mjs`:
  - `buildServedRoots(projectDir, extraRoots)` runs once at startup. It
    resolves each `--root` with `realpathSync.native` and refuses to start on
    a missing root or a file (FR-005). The served directory is resolved the
    same way when it exists.
  - `resolveTarget(args, serving)` replaces today's "any existing directory"
    check. With no `projectDir` it returns the served directory unchanged
    (FR-004). Otherwise it resolves the argument against the served
    directory, checks containment, and only then reads `.docguard.json`
    (FR-001, FR-002).
  - `isWithinRoot(root, target, pathImpl)` is the one containment test. It is
    exported so the Windows rules can be tested with `path.win32` on any OS.
  - `dispatchMessage` receives the serving context instead of a bare
    directory, so stdio and HTTP share the boundary (FR-003).
  - The `projectDir` schema description states the boundary (FR-006).
- `cli/docguard.mjs`: parse `--root <dir>` (repeatable) into `flags.roots`.
- Docs and CHANGELOG (FR-007).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new (`node:fs`, `node:path`)
**Testing**: `node:test`. `tests/mcp-project-confinement.test.mjs` builds a
temp tree (`parent/outside.md`, `parent/app/`, `parent/app-other/`, a
symlink out and a symlink in), spawns the real server over stdio and HTTP,
and unit-tests `isWithinRoot` with `path.posix` and `path.win32`.

## Research decisions

- **Who sets the boundary.**
  - Decision: the operator, at startup (`--dir`, working directory,
    `--root`).
  - Rationale: the client is the party being confined. The MCP `roots`
    capability lets the client declare roots, so it cannot be the limit.
  - Rejected: client-declared roots; per-call allow lists.
- **One way to widen it.**
  - Decision: repeatable `--root <dir>`.
  - Rejected: `--allow-any-project`. It is a blanket switch that is easy to
    paste into a shared config without noticing. `--root /` has the same
    effect and names what it exposes.
- **Which tools are confined.**
  - Decision: every tool that takes `projectDir`.
  - Rationale: guard, report and diagnose messages quote document lines and
    paths, and one rule is easier to state and audit than two.
  - Rejected: confining only the four navigation tools.
- **Resolve, then compare.**
  - Decision: `realpathSync.native` on the root and on `projectDir`, then
    `path.relative`. Inside means the relative path is empty, or is not
    absolute and its first segment is not `..`.
  - Rationale: a lexical check alone is bypassed by a symlink. The native
    realpath returns the stored letter case on macOS and Windows, so a
    differently cased spelling of an inside directory matches. `path.win32`
    compares case-insensitively and yields an absolute path for another
    drive or UNC share, which counts as outside. A prefix string test would
    accept `/x/app-other` for root `/x/app`; `relative` does not.
  - The tool then runs against the resolved real path, so a caller's spelling
    cannot be re-pointed between the check and the read.
- **No existence oracle.**
  - Decision: if `projectDir` does not exist, compare its lexical path with
    the roots (as given and as resolved). Outside → the same refusal as an
    existing outside directory. Inside → today's "does not exist" error.
  - Rationale: otherwise a client could probe which paths exist outside the
    project.
- **Relative `projectDir`.**
  - Decision: resolve against the served directory, not the process working
    directory.
  - Rationale: the two differ when `--dir` is given (the MCPB bundle starts
    the server with `--dir` from Claude Desktop's own working directory). A
    client sees the served project, not the process. When `--dir` is absent
    they are the same, so existing stdio setups do not change.
- **The served directory does not exist.** Startup keeps today's behaviour
  (the server starts and each call reports the missing directory); only
  `--root` is validated at startup, because it exists to widen access.
- **Message content.** The refusal names the roots. The client already talks
  to this server about that project, so the path is not new information;
  it tells the caller how to fix the call.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | The docs stop describing account permissions as the only boundary and state the new one exactly, including what it does not cover (an API key is still not per-project authorization). |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/commands/mcp.mjs                   # roots, resolveTarget, isWithinRoot
cli/docguard.mjs                       # --root
tests/mcp-project-confinement.test.mjs # NEW
tests/update-awareness.test.mjs        # start the server on its fixture
docs-canonical/SECURITY.md, docs/ai-integration.md, docs/commands.md,
README.md, mcpb/manifest.template.json, smithery.yaml, CHANGELOG.md
testguard.claims.json                  # MCP-PROJECTDIR-STAYS-INSIDE-SERVED-ROOTS
```
