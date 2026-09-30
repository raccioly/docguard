# Implementation Plan: A Project's First Spec Can Pass Preflight

**Branch**: `fix/first-spec-preflight` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

- `cli/scanners/spec-registry.mjs`:
  - `projectSpecRegistry` stops excluding the draft. With `draftPath` it
    also reports `currentExceptDraft`: the committed registry compared with
    the projection after removing the entry at the draft's path from both.
    With no registry, it is true when the projection holds only the draft
    and no tombstones (FR-001, FR-002, FR-003).
  - `preflightSpec` uses `currentExceptDraft`, keeps the draft in the
    briefing (FR-004), and drops the projection's SPR002 issue for the draft
    path because it re-checks the draft's identity itself.
- `cli/commands/specs.mjs`:
  - `specs approve` (FR-005). Plan by default, `--write` commits the registry
    with `commitFileTransaction` and validates that the result is current.
  - SPC002 messages name `specs approve` (FR-006).
  - `completionTransition` starts from the recorded delivery (FR-009).
  - `reanchor --to` resolves the value with `resolveCommit` first (FR-010).
  - The spec-first fix hint uses a placeholder (FR-008).
- `cli/scanners/revision-anchor.mjs`: `resolveCommit(dir, rev)` runs
  `git rev-parse --verify --quiet <rev>^{commit}` and returns the full SHA or
  null. Values starting with `-` are refused before git runs.
- `cli/scanners/spec-first.mjs`: an ID after a `Spec:` or `Spec ID:` label
  that resolves to no spec is added to `unresolved` (FR-008).
- `cli/findings.mjs`: `BLOCKER_CODES` holds SPC001–SPC008. `explain` and the
  MCP `docguard_explain` tool read it after `CODES` (FR-007).
- `cli/docguard.mjs`: `--delivery` flag and `approve` in the specs help.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`, `tests/first-spec-preflight.test.mjs`. Every case
builds a temporary git repository, so no test reads this repository's
registry, finding counts or the date.

**Preflight of this spec**: `specs preflight --path
specs/040-spec-preflight-first-spec/spec.md` was READY before any code
changed, because this repository already has prior specs and the draft was
not yet registered. The bug appears only for a project's first spec, or once
`specs --write` has registered the draft; the tests reproduce both.

## Research decisions

- **Judge currency without the draft, instead of excluding the draft from
  the projection.**
  - Decision: project every spec, then compare registry and projection with
    the draft's entry removed from both.
  - Rationale: excluding the draft from the projection makes its registered
    entry look like a spec that vanished (SPR004), and a relation that names
    the draft look like a dangling reference. Comparing without it asks the
    question preflight means: is the registry current for everything else?
  - Rejected: passing the draft's registered entry through unchanged. It
    fixes SPR004 but leaves the no-registry case and the briefing count to
    special-case separately.
- **Approval is a command, not a status line.**
  - Decision: `docguard specs approve --id <id> [--delivery <state>]
    [--write]`.
  - Rationale: the registry separates reviewed fields, which a person
    attests, from observed fields, which `specs --write` derives from files.
    `**Status**: Approved` sits in spec prose, which Spec Kit agents
    generate and the projection reads. Honouring it would derive a reviewed
    field from content an agent writes, and `specs --write` would start
    changing reviewed state. A command keeps the attestation explicit: a
    person runs it, and the registry diff is reviewed in the pull request,
    exactly as a hand edit is today. The command adds validation (known
    current spec, current registry, allowed transition) and a message that
    SPC002 can point to.
  - Rejected: a `--reason` flag. The reviewed lifecycle has no field for a
    rationale; accepting one and discarding it would suggest a record that
    does not exist. Adding a field changes the schema and belongs in its own
    spec. The commit and pull request carry the reason.
  - Delivery: `--delivery` accepts `planned`, `in_progress` and
    `implemented` only. `verified` and `released` are set by `specs
    complete`, which checks evidence. A verified or released spec cannot be
    moved back.
  - Block codes: SPC001 for identity and registry state, SPC002 for a
    lifecycle state that does not allow the change, as `reanchor` reuses
    SPC001. No new code family.
- **SPC codes live beside, not inside, `CODES`.** `CODES` is the finding
  registry: `findingSeverity`, SARIF rules and feedback read it. SPC codes
  never appear in guard output, so adding them there would let
  `findingSeverity.SPC002` validate and do nothing. `BLOCKER_CODES` carries a
  `command` instead of a `validator`.
- **Unresolved Spec IDs need a label.** Any dotted word (`cli/docguard.mjs`,
  `v1.2`, `e.g.`) matches the Spec ID shape, so reporting every unmatched one
  would be noise. A word after `Spec:` or `Spec ID:` is meant as a
  reference; it is listed when nothing matches. Status is unchanged: an
  unresolved reference never covers a change.
- **`reanchor --to` resolves, not validates.** Git already knows what a
  revision names. The resolved full SHA is recorded, so the registry still
  holds only full revisions. A leading `-` is refused because git would read
  it as an option.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Preflight still blocks every stale registry except the draft's own entry. Approval stays a person's explicit act; nothing is inferred from prose. |
| X (spec-first) | This spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/spec-registry.mjs     # currentExceptDraft; preflight
cli/scanners/revision-anchor.mjs   # resolveCommit
cli/scanners/spec-first.mjs        # labelled unresolved IDs
cli/commands/specs.mjs             # approve; SPC002 hint; transition; reanchor --to; hint
cli/commands/explain.mjs           # BLOCKER_CODES lookup
cli/commands/mcp.mjs               # BLOCKER_CODES lookup
cli/findings.mjs                   # BLOCKER_CODES
cli/docguard.mjs                   # --delivery; help
tests/first-spec-preflight.test.mjs   # NEW
docs/commands.md, README.md, docs-canonical/DATA-MODEL.md,
docs-canonical/SECURITY.md, CHANGELOG.md, extensions/spec-kit-docguard/commands/complete.md
testguard.claims.json              # FIRST-SPEC-PREFLIGHT-PASSES
```
