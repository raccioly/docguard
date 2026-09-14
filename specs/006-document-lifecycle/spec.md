# Feature Specification: Document Lifecycle and Reconciliation

**Status**: Active
**Spec ID**: `docguard.document-lifecycle`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

Spec-driven repositories accumulate completed plans, superseded requirements,
migration notes, and historical audits in locations that agents search for
current instructions. Git preserves history, but the working tree often gives no
reliable signal that an old document has stopped governing the product.

Spec Kit core can compare implementation with specification artifacts and append
missing tasks. Its persistence guidance deliberately supports several mutation
models, and its extension system exposes lifecycle hooks. Community Archive and
Reconcile extensions already provide agent-authored consolidation and artifact
editing. DocGuard should interoperate with those workflows and provide the
deterministic registry, evidence checks, context cleanup, and fail-closed policy
that they do not claim to provide.

## User Scenarios & Testing

### US1 — Review lifecycle candidates

As a maintainer, I can inspect likely completed or superseded documents without
changing the repository, so I can decide what still represents current intent.

### US2 — Retire obsolete context safely

As a maintainer, I can explicitly remove selected documents from the working tree
while preserving their exact Git revision, reason, replacement, and restore
command in a compact manifest.

### US3 — Gate context hygiene

As a CI owner, I can fail a lifecycle check when reviewed candidates remain, so
stale planning material does not accumulate silently.

### US4 — Reconcile post-hoc behavior changes

As a maintainer, I can classify code changes against mechanical facts, approved
intent, and superseded decisions before any document is changed. This outcome is
the next increment after archival and is specified here to keep the boundary
clear.

### US5 — Check a new spec against project history

As a maintainer, I can preflight a new specification against active requirements,
completed and superseded lineage, current implementation evidence, and tests, so
the plan does not begin from an outdated assumption.

### US6 — Maintain one machine-readable tracker

As an agent or CI consumer, I can read a committed registry of spec identities,
lifecycle, lineage, affected documents, evidence, and reconciliation revision.
The registry points to approved prose; it does not duplicate or replace it.

## Functional requirements

- **FR-001**: `docguard retire` and `docguard retire --plan` MUST be read-only
  and report lifecycle candidates with confidence and evidence.
- **FR-002**: `docguard retire --check` MUST exit 2 when high-confidence
  candidates remain and MUST emit the same machine-readable candidate contract
  as the plan. `--fail-on-warning` also gates review candidates.
- **FR-003**: Retirement MUST require `--write`, at least one explicit repeatable
  `--path`, and a non-empty `--reason`.
- **FR-004**: Retirement MUST accept only clean, tracked, non-symlink
  documentation paths inside the selected repository root. Directory selection
  MUST fail if source code, ignored content, or untracked content would remain
  behind.
- **FR-005**: Retirement MUST reject `.git`, `.local`, `.docguard`, path
  traversal, Git submodules, and files configured as required documentation.
- **FR-006**: Retired prose MUST NOT be copied to another working-tree archive.
  A retained Git ref is the content store.
- **FR-007**: `.docguard-archive.json` MUST record schema version, strategy,
  original path, retirement timestamp, source commit, blob identity, reason,
  optional replacement and evidence paths, requirement-identity tombstones,
  retention ref, Git object format, recoverability state, and a restore command.
- **FR-008**: Candidate inference MUST NOT delete documents automatically.
  Explicit lifecycle status is high-confidence evidence; a fully checked task
  list is a review signal rather than proof of completion.
- **FR-009**: Multiple files selected in one invocation MUST share one source
  revision and retirement reason and MUST be listed individually in the manifest.
- **FR-010**: Reconciliation MUST distinguish implementation facts from approved
  intent and MUST NOT rewrite requirements solely to match current code.
- **FR-011**: Reconciliation output MUST distinguish intentional behavior change,
  possible implementation regression, mechanical fact refresh, unrelated change,
  and unsupported evidence.
- **FR-012**: Lifecycle and reconciliation output MUST be available as JSON for
  CI and agent consumers.
- **FR-013**: DocGuard MUST maintain a committed, versioned registry with stable
  spec identity, path or archive reference, orthogonal lifecycle dimensions,
  supersedes and
  superseded-by relationships, affected canonical documents, requirement
  identities, implementation/test evidence references, and last reconciled
  revision. Immutable spec IDs MUST originate in authoritative spec metadata,
  survive path changes and retirement as tombstones, and never be reused.
  Reviewed lifecycle and lineage fields are authoritative; observed evidence
  fields are deterministically regenerated.
- **FR-014**: Approved active requirement prose MUST remain the source of intent.
  The registry is an index and provenance ledger; generated AI context packs are
  disposable projections of current registry entries and canonical docs.
- **FR-015**: New-spec preflight MUST run in two stages: an advisory project
  briefing before specification and a deterministic check of the generated spec
  before planning. It MUST compare declared assumptions with active and prior
  lineage plus current code evidence and report relationship, intent state,
  implementation state, and provenance independently.
- **FR-016**: Spec completion MUST verify task state, implementation/test
  evidence, affected canonical docs, and reconciliation revision before moving a
  spec from `implemented` to `verified` and then archive-ready. Checked tasks
  alone MUST NOT prove completion.
- **FR-017**: Completion MUST refresh DocGuard-owned context outputs from current
  intent, or validate a compatible context extension's output, and MUST exclude
  retired prose. It MUST NOT rewrite agent-native instruction files as a hidden
  lifecycle side effect.
- **FR-018**: DocGuard MUST treat Spec Kit lifecycle hooks as advisory automation
  and provide deterministic CLI/CI gates for enforcement. It SHOULD validate
  outputs produced by compatible Archive or Reconcile extensions instead of
  reproducing their agent-authored merge logic.
- **FR-019**: A future upstream Spec Kit proposal MUST be limited to a generic
  lifecycle metadata or hook contract proven by the DocGuard extension; DocGuard
  detection policy remains outside Spec Kit core.
- **FR-020**: The registry MUST be managed through one dedicated `docguard specs`
  command family. `specs --check` validates the committed projection, `specs
  --write` refreshes derived evidence without changing reviewed fields, `specs
  preflight` evaluates a draft, and `specs complete` plans or applies a reviewed
  delivery transition. Generic `retire` MUST refuse active registered specs so
  another command cannot bypass the registry transaction.

## Authority model

| Artifact | Authority | Mutation rule |
|---|---|---|
| Active approved requirement text | Intended behavior | Human-reviewed change or explicit supersession |
| Source, configuration, and observed tests | Implementation evidence | Normal development workflow |
| `.docguard-specs.json` reviewed fields | Lifecycle and lineage | Explicit transition with rationale and successor where required |
| `.docguard-specs.json` observed fields | Derived evidence index | Deterministically regenerated and checked for drift |
| Canonical docs and decisions | Current system view and rationale | Mechanical sections may sync; intent needs review |
| AI context packs | Task-specific projection | Regenerate from active registry and canonical docs |
| `.docguard-archive.json` + retained Git ref | Recovery and provenance | Append metadata when content leaves active context |

The registry is the source of truth for which specs currently govern the project
and how they relate. It is not the source of behavioral prose. It cannot resolve
a disagreement by itself; it records that code, approved intent, or evidence
changed and routes the case to the correct action.

`.docguard-archive.json` remains the append-only recovery ledger for every
retired document, including non-spec plans and audits. `.docguard-specs.json`
owns spec governance and links to the matching retirement event when a spec
moves to Git history. The two files never duplicate retired prose, and the
registry validator fails when their spec paths, revisions, or storage states
disagree.

## Registry contract

The committed registry separates reviewed control fields from observed evidence
so regeneration cannot silently change policy:

```json
{
  "schemaVersion": 1,
  "specs": [
    {
      "specId": "docguard.document-lifecycle",
      "path": "specs/006-document-lifecycle/spec.md",
      "reviewed": {
        "lifecycle": {
          "approval": "approved",
          "delivery": "in_progress",
          "context": "current",
          "retirementReason": null,
          "storage": "working_tree",
          "persistenceModel": "living"
        },
        "relations": {
          "extends": [],
          "duplicates": [],
          "conflictsWith": [],
          "supersedes": [],
          "supersededBy": []
        },
        "scope": {
          "canonicalDocs": ["docs-canonical/ARCHITECTURE.md"]
        },
        "reconciliation": { "lastReviewedRevision": null }
      },
      "intent": {
        "requirements": ["docguard.document-lifecycle#FR-001"]
      },
      "observed": {
        "artifacts": [
          { "path": "specs/006-document-lifecycle/spec.md", "digest": "sha256:<content-address>" }
        ],
        "taskCompletion": { "checked": 9, "total": 23 },
        "implementationEvidence": [],
        "testEvidence": []
      }
    }
  ]
}
```

Generation preserves the entire `reviewed` block, rebuilds `intent` references
and `observed` evidence, sorts all unordered fields, and omits wall-clock
timestamps. `--check` compares the committed bytes with a fresh projection,
making registry drift reproducible in CI. Unknown reviewed fields and invalid
enum values fail closed instead of being discarded during regeneration. The
normative machine contract is `schemas/docguard-specs.schema.json`.

The path-qualified identity already supported by traceability remains a migration
format. Completion evidence requires the immutable `specId#requirementId` form;
bare IDs are navigation hints only because they can rebind after another spec is
retired. Registry tombstones retain old identities without copying retired prose.

The registry enforces these invariants before writing:

| Invariant | Required evidence |
|---|---|
| A `current` spec has `working_tree` storage | Clean tracked spec path and unique immutable ID |
| A `retired` spec has `git_history` storage | Matching recovery-ledger entry and retained Git ref |
| `superseded` retirement has a successor | Typed `supersedes` edge to an approved current spec |
| `verified` delivery has reconciled evidence | Exact revision, requirement-qualified tests, canonical outcomes, and no unresolved blocker |
| Reviewed fields change only through a transition | Previous state, requested state, reason, actor-supplied review flag, and deterministic validation |
| Observed fields match the repository | Byte-stable regeneration at the recorded revision |

An interrupted write must leave either the previous valid registry or the full
new registry and associated recovery event. It must never expose a partially
transitioned spec.

## Lifecycle model

A single status cannot express approval, delivery, currentness, and storage
without contradictions. The registry tracks them independently:

| Dimension | Values | Rule |
|---|---|---|
| Approval | `draft`, `approved`, `rejected` | Only approved current prose governs implementation |
| Delivery | `planned`, `in_progress`, `implemented`, `verified`, `released` | Checked tasks can support `implemented`; reconciliation is required for `verified` |
| Context | `current`, `retired` | Retired prose is excluded from normal agent context |
| Retirement reason | `completed`, `superseded`, `abandoned`, or `null` | Supersession requires a typed successor relation |
| Storage | `working_tree`, `git_history` | Removal requires recoverability from a retained ref |
| Persistence model | `flow_back`, `flow_forward`, `living`, or `null` | Project policy determines when feature prose may retire |

Relations are typed edges such as `extends`, `duplicates`, `conflicts_with`, and
`supersedes`. A draft with completed tasks is a review signal: it may be an
unapproved prototype, so it is not automatically contradictory. No inferred
signal changes a reviewed lifecycle dimension by itself.

## New-spec preflight

Before specification, DocGuard can provide an advisory history and implementation
briefing from the request. After a draft exists and before planning, it refreshes
the observed registry projection and compares the actual draft with current
specs, prior lineage, affected canonical docs, code/configuration, tests, and
unreconciled changes. The JSON result separates:

- deterministic blockers such as duplicate spec identity, broken lineage,
  missing governing artifacts, or a stale committed registry;
- evidence that the requested behavior already exists;
- explicit conflicts with active intent or a named predecessor;
- semantic overlap and unsupported evidence that require review.

Relationship (`duplicate`, `extends`, `conflicts_with`, `supersedes`,
`unrelated`, `ambiguous`), intent currentness, implementation presence, and
provenance are separate fields because several can be true at once.

Preflight may block on structural facts. Similar wording, document age, or an AI
inference remains review-only. This keeps the workflow useful on large
repositories without turning uncertain overlap into a false failure.

The pre-specification briefing cannot certify a request because no reviewable
artifact exists yet. The generated-spec gate is the enforceable step: planning
must wait when identity, lineage, registry freshness, or a proven contradiction
fails. Evidence that behavior already exists and semantic similarity remain
visible review items unless an exact requirement identity establishes a
duplicate.

## Completion and back-propagation

Completion is a transaction with a read-only plan first:

1. refresh registry evidence and identify changes since the last reconciled
   revision;
2. verify tasks, source paths, test references, required canonical outcomes, and
   guard status;
3. update proven mechanical facts through existing generated-section writers;
4. append a bounded implementation outcome to the feature spec, including the
   revision, evidence links, accepted deviations, and successor when present;
5. regenerate task-specific context packs from governing specs and canonical
   docs;
6. record the reconciled revision and move delivery `implemented → verified`
   only after the resulting diff passes validation;
7. report archive readiness separately; it additionally requires a retained
   revision, a compatible persistence policy, valid backreferences, and a fresh
   context projection.

Behavior changed directly in code enters the same plan. DocGuard may refresh a
mechanical fact, but a behavioral conflict becomes either an approved amendment,
a successor spec, or a suspected code regression. It never rewrites the old
requirement merely to agree with the implementation.

## Safety and privacy

The retirement operation runs locally and performs no network submission. It never
reads or records `.local` content. A dirty file is rejected because the source
commit would not recover uncommitted text. Replacement and consolidation
evidence must also be tracked and clean at that revision. Required canonical
documents must be replaced and reconfigured before retirement.

## Success criteria

- **SC-001**: Plan and check leave a clean fixture byte-for-byte unchanged.
- **SC-002**: Every retired file can be restored from a manifest revision kept
  reachable by its recorded retention ref.
- **SC-003**: Source code, dirty, untracked, required, symlinked, private,
  protected, submodule, and out-of-root paths fail closed.
- **SC-004**: A completed-task candidate and its neighboring active case are
  classified differently.
- **SC-005**: DocGuard's own released specs and historical planning documents no
  longer appear in active search paths after their outcomes are preserved.
- **SC-006**: A future reconciliation benchmark correctly separates intentional
  change from seeded code regression without silently editing requirements.
- **SC-007**: Repeated registry projection is byte-identical, preserves reviewed
  fields, and never credits a bare reused requirement ID as lifecycle evidence.

## Non-goals

- Replacing Git with a second document store.
- Automatically deciding that code is correct when it conflicts with approved
  requirements.
- Deleting untracked notes or private files.
- Treating document age alone as proof that a document is obsolete.
- Reimplementing the community Spec Kit Archive or Reconcile extensions' prompt
  workflows.
