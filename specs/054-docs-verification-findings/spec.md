# Feature Specification: Defects Found While Documenting DocGuard

**Feature Branch**: `fix/docs-verification-findings`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.docs-verification-findings`

**Lineage**: Found while writing and verifying the user documentation (`docguard.user-documentation`, spec 053), by running each documented flow on scratch projects. Corrects `docguard.release-cut-green` (051), whose release sync leaves some pinned version examples behind, and the agent-file scaffolder (`cli/commands/agents.mjs`, v0.29).

**Input**: "Think of other things that might be missing and fix it."

## Problem

1. **A Koa project is labelled Hono.** `classify()` maps any of express/fastify/hono/koa/@nestjs/core to a framework label, and a Koa-only project falls through to `'Hono'`. Its routes are read by the Hono scanner, so they are found, but the project is reported as Hono everywhere (`generate`, the architecture doc, the API-surface check).
2. **Generated agent files cannot be synced.** `init --with agents` (and the deprecated `agents`) write `CLAUDE.md`, the Cursor rules, the Copilot instructions and the other variants without the `docguard:agents-sync` marker. A later `agents --sync` treats every one of them as hand-written and skips it, so the family the README says stays drift-proof never updates.
3. **`agents --sync` runs the whole `init`.** The dispatcher routes `agents` through `init --with agents` unless `--check` is set. A sync therefore re-runs project scaffolding and the Spec Kit step. On one scratch project it initialized Spec Kit with `cursor-agent`, because the agents step had just created `.cursor/`.
4. **The config schema rejects a valid `sourceRoot`.** The code accepts a string or an array of strings. `schemas/docguard-config.schema.json` declares a string, so a schema-aware editor flags a working configuration.
5. **Pinned version examples go stale.** The release sync updates the README's Action examples but not:
   - the README's pre-commit `rev:`;
   - `.pre-commit-hooks.yaml`'s usage comments;
   - `templates/ci/gitlab-component.yml`'s default `version` and its include examples.

   All of these still say 0.29.0.
6. **PSR002 reports an ignored file as missing.** `validatePathScopedRules` filters the project's files through `.docguardignore` before checking whether an instruction file's pointer resolves. A pointer to a file that exists but is excluded from validation (for example a generated page) is reported as "does not exist".
7. **A misleading security comment.** `cli/commands/mcp.mjs` describes the Origin allow-list as applying "on loopback binds"; the code applies it on every bind.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What DocGuard reports matches the project (Priority: P1)

1. **Given** a Koa project, **Then** DocGuard calls it Koa and lists its routes.
2. **Given** a `.docguard.json` with an array `sourceRoot`, **Then** a schema-aware editor accepts it.
3. **Given** an instruction file pointing at a file excluded by `.docguardignore`, **Then** PSR002 does not call it missing.

### User Story 2 - Agent files stay in sync (Priority: P1)

1. **Given** agent files written by `init --with agents`, **When** `AGENTS.md` changes and `agents --sync` runs, **Then** every file is regenerated.
2. **Given** `agents --sync`, **Then** nothing except the agent files is written, and Spec Kit is not invoked.
3. **Given** a hand-written `CLAUDE.md` with no marker, **Then** `agents --sync` leaves it alone unless `--force` is passed.

### User Story 3 - Copied examples pin the current release (Priority: P2)

1. **Given** a release, **Then** the README's pre-commit `rev:`, `.pre-commit-hooks.yaml` and the GitLab component name that release.

## Requirements *(mandatory)*

- **FR-001**: A project whose only HTTP framework dependency is `koa` MUST be labelled `Koa`, and its routes MUST still be read, with `source: 'koa'`. Hono projects are unchanged.
- **FR-002**: Every agent file `init --with agents` (or `agents`) writes MUST carry the sync marker, so `agents --sync` and `agents --check` manage it. Existing unmarked files keep today's behaviour: skipped, unless `--force`.
- **FR-003**: `agents --sync` MUST run only the agent-file sync, like `agents --check`, without project scaffolding, skill installation or Spec Kit delegation.
- **FR-004**: The config schema MUST accept `sourceRoot` as a string or an array of strings.
- **FR-005**: The release sync MUST update the README pre-commit `rev:`, the `.pre-commit-hooks.yaml` usage comments, and the GitLab component's default `version` and include examples. The release-candidate policy and the release commit's staging MUST cover the new paths, and each example MUST read the current version now.
- **FR-006**: The MCP Origin comment MUST describe what the code does.
- **FR-007**: PSR002 MUST resolve pointers against every tracked (or, outside git, present) file. `.docguardignore` decides which instruction files are validated, not whether a pointer's target exists.

## Success Criteria *(mandatory)*

- **SC-001**: Each defect above has a test that fails before the fix and passes after.
- **SC-002**: The full suite passes, guard on this repository is unchanged, and a replay of the release cut still validates.

## Out of Scope (tracked as issues)

- Route extraction for frameworks DocGuard detects but does not read (NestJS, Laravel, Symfony, ASP.NET Core, Sinatra, Starlette, Warp, Tide, Cloudflare Workers, net/http-only Go).
- TypeORM entities in `generate` and `diff` (guard's schema check already reads them).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `7cec55ca733564288914c53e7b63dbb7e4bdb97c` — Reviewed at 7cec55c on main: all 7 tasks are checked and were delivered by #522; the full suite (2958 tests) passes on Node 18, 20, 22 and 24 in CI, and guard reports 0 errors at this revision. Evidence: `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/docs-verification-findings.test.mjs`, `tests/release-version-sync.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
