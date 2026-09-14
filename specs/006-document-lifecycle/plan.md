# Implementation Plan: Document Lifecycle and Reconciliation

**Status**: Active
**Spec**: `specs/006-document-lifecycle/spec.md`

## Summary

Introduce fail-closed context archival first, then add a derived lifecycle and
evidence registry, new-spec preflight, completion gates, and Spec Kit extension
interoperability. Active approved prose remains the contract.

## Technical Context

- Runtime: Node.js 18+ ES modules and built-ins.
- Persistence: versioned JSON indexes plus Git object history.
- Existing primitives: traceability, feature scoring, diff/impact, sync,
  generated sections, context packs, and Spec Kit extension hooks.
- Constraints: no automatic requirement rewrite, no private-file access, no
  network submission, and no new dependency.

## Project Structure

```text
cli/commands/retire.mjs
cli/scanners/document-lifecycle.mjs
cli/validators/document-lifecycle.mjs
tests/archive.test.mjs
tests/document-lifecycle.test.mjs
specs/006-document-lifecycle/

# Increment 2 additions (planned)
cli/commands/specs.mjs
cli/scanners/spec-registry.mjs
cli/validators/spec-registry.mjs
tests/spec-registry.test.mjs
tests/spec-preflight.test.mjs
```

## Increment 1 — Safe retirement

Add a focused command module and CLI routing. The default operation inventories
candidates; writes require explicit paths and lifecycle rationale. Git stores the
content through a verified retention ref while `.docguard-archive.json` stores
bounded recovery metadata. The public command is `retire` to avoid collision
with the Spec Kit Archive extension's consolidation workflow.

The first detector recognizes explicit terminal lifecycle status and completed
Spec Kit task lists. It reports both for review and never uses either signal to
delete automatically. This favors a visible false negative over destructive
classification.

## Increment 2 — Registry and preflight

Define `.docguard-specs.json` as a deterministic control plane over active and
archived spec identity, lineage, requirements, affected docs, evidence, and
reconciliation revision. Reviewed approval, delivery, context, storage,
persistence policy, lineage, and scope fields survive
regeneration; observed evidence is rebuilt and byte-stable. Add a new-spec
preflight that checks assumptions against the registry and current code before
planning begins. Immutable spec IDs come from spec metadata; requirement
identities remain tombstoned after retirement. The registry never copies requirement prose, so it cannot
become a second behavioral contract.

Expose the control plane through a dedicated command family:

```text
docguard specs --check
docguard specs --write
docguard specs preflight --path specs/<feature>/spec.md
docguard specs complete --id <spec-id> --check
docguard specs complete --id <spec-id> --write --reason <reviewed-rationale>
```

Build the scanner as a pure registry projection so guard, preflight, completion,
and tests consume one calculation. Keep the generic document recovery ledger
separate, then cross-check its spec retirement events against registry storage
state. Registry and recovery writes use one staged transaction with rollback.

## Increment 3 — Completion and reconciliation

Define a delivery `implemented → verified` completion gate over task state,
implementation/test evidence, canonical outcomes, and the last reconciled
revision. Build the review graph on the existing diff, impact, sync, trace, and
generated-section primitives. Mechanical facts may delegate to `sync`; intent
changes remain review tasks. Append a bounded outcome record and regenerate
context packs from governing registry entries after successful completion.
Calculate archive readiness separately using retained-revision proof,
backreference validity, persistence policy, and context freshness.

## Increment 4 — Spec Kit interoperability

Use `before_specify` only for an advisory project-state briefing, then
`after_specify` or the nearest supported `before_plan`/`before_tasks` point for
the generated-spec gate. Treat `after_implement` and `after_converge` as prompts;
CLI/CI remains the enforcement boundary. Detect compatible
community Archive and Reconcile extensions, validate their outputs, and avoid
creating a competing prompt-based merge implementation. Propose a generic
upstream lifecycle metadata contract only after fixtures show that multiple
extensions can consume it.

## Architecture boundaries

- `cli/commands/retire.mjs` owns lifecycle planning and the explicit retirement
  transaction.
- A verified retained Git ref is the retirement storage layer.
- `safeWrite()` owns manifest writes and backup behavior.
- Required-document configuration remains authoritative for protected files.
- Candidate inference is advisory; the write path consumes explicit selection,
  not detector output.
- Reconciliation will consume existing scanner evidence instead of duplicating
  language parsers.
- `.docguard-specs.json` is derived, committed, and reproducible; active approved
  prose remains authoritative. Reviewed control fields survive regeneration;
  only explicit transition commands can change them.
- Immutable spec IDs are authored once in spec metadata; paths are locations and
  may change. Retired requirement identities remain as registry tombstones.
- `.docguard-archive.json` owns document recovery events;
  `.docguard-specs.json` owns spec governance. Validation rejects disagreement
  between their revision, path, and storage fields.
- `docguard specs` is the only lifecycle-state writer. Existing commands consume
  its projection rather than creating parallel state.
- Spec Kit extensions own agent-authored consolidation; DocGuard owns evidence,
  policy, validation, and active-context hygiene.

## Verification

Use disposable Git repositories. Cover read-only behavior, exit semantics,
manifest recovery data, repeated path selection, and every protected boundary.
Run command-focused tests first, then the full suite, `docguard guard`, package
dry-run, and supported Node runtime checks before release.
