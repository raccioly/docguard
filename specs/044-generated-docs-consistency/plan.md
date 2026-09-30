# Implementation Plan: DocGuard's Generated Docs Pass DocGuard's Own Checks

**Branch**: `fix/generated-docs-consistency` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

One rule drives every change: a fact DocGuard writes and a fact DocGuard
checks come from the same function, and the writer emits the shape the reader
parses.

- `cli/scanners/api-doc.mjs`: `ALL`, `ANY` and `/` count; parsed endpoints keep
  the written path (FR-001).
- `cli/commands/diff.mjs`: entity tables are read (FR-002); the tech-stack
  diff delegates to `cli/validators/docs-diff.mjs` (FR-006); env vars come from
  the shared collector (FR-008).
- `cli/writers/sections.mjs`: `upsertSection` accepts a `heading`. A new
  section gets `## Heading` above its marker, or goes under an existing
  heading that already satisfies it (FR-003).
- `cli/scanners/memory-plan.mjs`: every planned section carries its heading;
  TEST-SPEC gets a Test Categories task beside Coverage Rules; tables gain a
  Source column (FR-003, FR-004); tech-stack rows list detected technologies
  (FR-010); env vars come from the shared collector (FR-008).
- `cli/commands/generate.mjs`: `--plan --write` inserts human sections only
  when absent, skips pinned sections, and writes through
  `writeOwnedSections` (FR-009); plain generate reads routes with the
  ecosystem framework, tests from the shared collectors, env vars from the
  shared collector, and auth from the integrations scanner (FR-007, FR-010).
- `cli/writers/doc-generators.mjs`: headings, handler names, Required/default,
  auth row, source citations, component map, tech list, test inventory and
  positive security rules (FR-003, FR-004, FR-007, FR-010, FR-011).
- `cli/writers/generate-io.mjs`: `writeOwnedSections(path, before, after)`
  (FR-009).
- `cli/shared-source.mjs`: `grepEnvUsage` records where each variable is read
  and whether a default is supplied, and reads Go's `os.Getenv` and
  `os.LookupEnv`; `collectEnvVars` merges templates and code (FR-007, FR-008).
- `cli/shared-ignore.mjs`: `isDocguardOwnedDir` (FR-005).
- `cli/scanners/inventory.mjs`, `cli/validators/docs-coverage.mjs`: skip owned
  dirs; DCV003's root display; DCV001 skips `.docguard-specs.json` (FR-005).
- `cli/validators/traceability.mjs`: TRC003 skips generated docs; TRC002
  accepts a cited existing source path (FR-004).
- `cli/validators/environment.mjs`: ENV004 ignores comments (FR-006).
- `cli/scanners/as-built.mjs`: SC-001 (and SC-002 when tests exist) (FR-004).
- `cli/scanners/py-ast.mjs`, `cli/scanners/schemas.mjs`: Django models
  (FR-010).
- `cli/scanners/integrations.mjs`: a JWT auth entry (FR-007).
- `templates/ARCHITECTURE.md.template`, `templates/REQUIREMENTS.md.template`:
  examples inside comments (FR-006).

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`.
- `tests/generated-docs-consistency.test.mjs` holds unit reproductions, one
  per bug.
- `tests/generated-docs-e2e.test.mjs` builds the five fixture projects in a
  temp dir, runs each flow through the CLI, and asserts SC-001.

## Research decisions

- **Headings, not marker-aware validators (FR-003).**
  - Decision: the generator writes the H2 headings the validators already
    require.
  - Rationale: headings are the contract every Markdown reader shares — STR003,
    ENV001/ENV002, `score`'s H2/H3 count, TOCs, humans. Teaching each validator
    to treat `docguard:section id=env-vars` as "Environment Variables" couples
    validators to generator internals and leaves the rendered doc without a
    visible section title.
  - The heading goes outside the marker, so `sync` and regeneration never
    touch it, and a person may rename it.
  - Rejected: validators accepting marker ids; a heading inside the marker.
- **An existing heading hosts the section.** When a document already satisfies
  the heading (for example, init's `## Tech Stack`), the section is inserted
  right under that heading. Rejected: appending a second `## Tech Stack`.
- **Citations link a doc to code (FR-004).**
  - Decision: TRC002 accepts a backticked or linked path in the document that
    exists in the project and is not Markdown.
  - Rationale: a doc naming the file it describes is stronger evidence than a
    project-wide filename glob, and generated docs always know their sources.
  - Rejected: exempting generated docs from TRC002 (hides a doc that really
    is unlinked).
- **TRC003 exemption by marker.** A `docguard:generated true` document was
  written by DocGuard; "consider deleting it" is never right for it. `init`
  owns config creation, so plain `generate` on a project without
  `.docguard.json` cannot register it.
- **Owned directories.** `docs-canonical/` and `docs-implementation/` always;
  `specs/` only when a child directory holds `spec.md` (Spec Kit's shape), so
  an RSpec-style `specs/` stays code.
- **One reader per fact.**
  - The tech-stack diff: `diff` delegates to guard's `diffTechStack`, which
    already strips comments and reads negations.
  - Env vars: `collectEnvVars` (templates plus code reads).
  - Routes: `detectRouteFramework` (exported from the API-surface validator,
    as `diff` already imports `resolveApiSurface`).
  - Tests: `collectCodeTests` plus `scanTestInventory`.
  - Entities: `scanSchemasDeep`, now with Django.
- **Required and defaults (FR-007).** A read site counts as defaulted when:
  - JS: the access is followed by `||` or `??` and a value;
  - Python: `os.getenv`/`os.environ.get` has a second argument.

  A variable is Required "No" only when every read site is defaulted, and the
  first default is shown. `os.environ["X"]` is never defaulted.
- **Backups (FR-009).** The plan now edits only DocGuard-owned bytes:
  - code-section bodies that are not pinned;
  - inserted blocks and headings.

  `writeOwnedSections` skips the `.bak` only when both hold:
  - the document is DocGuard's own: marked `docguard:generated true`, or
    byte-identical to its init template apart from dates;
  - every line outside unpinned code-section bodies survives, in order.

  Anything else goes through `safeWrite` with its backup, so a person's
  document keeps one even for a bounded code-section refresh (the existing
  mapped-role test). Constitution VI protects user content before an
  overwrite; a DocGuard-authored document whose non-owned bytes all survive
  holds no user content to lose. Rejected: skipping the backup for any
  section-bounded write (a person's document would lose its safety copy).
- **Human sections are insert-only.** The plan replaced a `source=human`
  section with its task placeholder on every run, losing agent prose. It now
  inserts a human section only when absent.
- **As-built success criterion.** SC-001 is a fact DocGuard checks: SPR007
  reports no drift for the spec. SC-002 (tests pass) appears only when tests
  exist under the area. No prose is invented (Constitution V).

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validator isolation) | Shared helpers live in `cli/shared*.mjs` and `cli/scanners/`. Validators import no validator; `generate` and `diff` (commands) import `docs-diff` and `api-surface` exports. |
| V (AI as author) | Generated text is code facts, headings and task placeholders. The as-built SC names a DocGuard check, not behaviour. |
| VI (safe writes) | `safeWrite` unchanged. `writeOwnedSections` skips the backup only after proving no byte outside DocGuard-owned code sections changes; otherwise it calls `safeWrite`. |
| IX (honest assurance) | Nothing is suppressed: TRC002 needs a real, existing cited path; the TRC003 exemption needs DocGuard's own marker; placeholders are ignored only inside comments. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/api-doc.mjs, memory-plan.mjs, inventory.mjs, as-built.mjs,
  py-ast.mjs, schemas.mjs, integrations.mjs
cli/commands/diff.mjs, generate.mjs
cli/writers/sections.mjs, doc-generators.mjs, generate-io.mjs
cli/shared-source.mjs, shared-ignore.mjs
cli/validators/traceability.mjs, docs-coverage.mjs, environment.mjs,
  api-surface.mjs, docs-diff.mjs
templates/ARCHITECTURE.md.template, templates/REQUIREMENTS.md.template
tests/generated-docs-consistency.test.mjs   # NEW
tests/generated-docs-e2e.test.mjs           # NEW
docs/commands.md, docs-canonical/ARCHITECTURE.md, CHANGELOG.md
testguard.claims.json                       # GENERATED-DOCS-PASS-OWN-CHECKS
```
