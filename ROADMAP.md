# DocGuard Roadmap

<!-- docguard:last-reviewed 2026-09-14 -->

This file contains current product intent only. Released work belongs in
`CHANGELOG.md`; implementation history remains recoverable from Git. Completed or
superseded specifications leave the working tree through `docguard retire` so
people and AI agents do not mistake old plans for current requirements.

DocGuard's product goal is dependable, low-maintenance evidence that connects
approved intent, implementation facts, tests, and operational reality. A clean
structural score is useful, but it is not proof that arbitrary prose is true.

## Current priorities

### R1 — Document lifecycle foundation (released in v0.37.0)

Give specifications and planning documents an explicit end of life.

- [x] Ship `docguard retire --plan|--check` and explicit, fail-closed writes.
- [x] Keep archived content in Git and record only recovery metadata in
  `.docguard-archive.json`; do not copy obsolete prose into a second document tree.
- [x] Retire DocGuard's own completed specs, migration plans, and historical
  audits after their current outcomes are represented in canonical docs and the
  changelog.
- [x] Add lifecycle status validation for `active`, `completed`, `superseded`,
  and `archived`; task completion and `Completed` artifact maturity remain
  review signals rather than proof of retirement.
- [x] Add `.docguard-specs.json`, a committed lifecycle control plane. Reviewed
  approval, delivery, context, storage, persistence policy, lineage, and scope
  are authoritative; requirement references and
  implementation/test evidence are deterministic projections. Approved prose
  remains the source of behavioral intent.
- [x] Add a dedicated `docguard specs` command family with deterministic
  `--write|--check`, advisory request briefing, and generated-spec preflight.
  Generic retirement refuses active registered specs so it cannot bypass the
  lifecycle control plane.
- [x] Add a pre-specification briefing and a generated-spec gate so the actual
  draft is checked against active and prior requirements plus current code before
  planning starts. The briefing informs; only the reviewable draft can be gated.
- [x] Connect the Spec Kit extension's mandatory `before_specify` and
  `before_tasks` hooks to the same deterministic briefing and generated-spec
  gate. Keep `docguard specs --check` as the CI enforcement surface because
  hooks are agent-dispatched workflow automation.
- [x] Give every active spec an immutable metadata ID; use
  `specId#requirementId` for completion evidence and preserve retired identities
  as registry tombstones so bare IDs cannot rebind.
- [x] Cross-check spec storage state against `.docguard-archive.json`. The
  archive manifest owns document recovery; the spec registry owns governance,
  and disagreement between them blocks a transition.
- [x] Merge the reviewed implementation in PR #349 and publish the verified
  npm, PyPI, GHCR, MCPB, and Spec Kit extension artifacts as v0.37.0.

R1 deliberately shipped the registry and safe-retirement boundary before adding
completion writes. Transaction rollback, status adapters, monorepo identity,
restore/re-retire handling, and reviewed completion transitions remain R2 work;
they are not part of the v0.37.0 contract.

### R2 — Completion and post-hoc reconciliation (implemented; release pending)

Close the lifecycle loop without allowing current code to silently redefine
approved intent.

- [x] Add staged registry/recovery transactions with rollback before any command
  can update both lifecycle ledgers.
- [x] Add an `implemented → verified` completion transaction that appends a
  bounded outcome record, refreshes mechanical facts, records the exact
  reconciliation revision, and regenerates active AI context.
- [x] Add optional Spec Kit hooks that check archive readiness after convergence
CLI and CI remain the enforcement boundary for lifecycle verification.

Post-hoc implementation changes are classified without silently redefining
approved intent. `docguard reconcile --since <ref>` reports affected material:

1. mechanical code facts that `sync` can safely refresh;
2. approved requirements that may indicate a code regression;
3. superseded decisions that need a replacement or archive action;
4. unsupported or ambiguous evidence that needs human review.

The command produces a review plan before any write. It never rewrites a
requirement merely because the current code differs. Acceptance requires seeded
examples for intentional behavior changes, accidental regressions, and unrelated
edits; each class must remain distinguishable in JSON output.

Spec Kit already publishes persistence models and supports lifecycle hooks, while
community Archive and Reconcile extensions perform agent-authored artifact
updates. DocGuard will validate and index those outcomes rather than duplicate
their prompt workflows. A future upstream contribution should standardize only
the generic lifecycle metadata or hook contract after interoperability is proven.

Delivered slices include explicit changed-file-to-spec evidence edges,
replacement-spec fields in bounded outcomes, decision-record classification,
transaction rollback fixtures, and `after_implement`/`after_converge` evidence
gates. Broader symbol inference remains intentionally unsupported until R3 can
measure its false-positive cost.

### R3 — Independent precision benchmark (complete; living baseline)

Governing spec: `specs/007-precision-evidence-loop/spec.md`.

The reproducible corpus now covers JavaScript, TypeScript, Python,
fallback-language, monorepo, generated-code, and sparse-doc shapes. Five pinned
public projects supplement repository-owned fixtures. Labels and exact mutations
are fixed before output review, and the evaluation split is isolated by
repository and causal family.

The reviewed baseline reports case-level and grouped TP/FP/FN, precision, recall,
false positives per repository, abstention, unsupported coverage, cold/warm
runtime, repair outcomes, and Wilson confidence limits. Comparisons fail on a
new miss, false positive, removed case, or supported-case abstention even when
the total warning count falls.

Maintained artifacts: `benchmarks/corpus.json`, `benchmarks/baseline.json`, the
runner and comparison libraries, and `schemas/docguard-benchmark.schema.json`.

### R4 — Contribution-to-regression loop (complete; open to contributions)

Governing spec: `specs/007-precision-evidence-loop/spec.md`.

`feedback` accepts redaction-attested synthetic fixture manifests with detector,
configuration, expected identity, parser tier, explicit predicate, and opposite
control. False positives, false negatives, unsupported syntax, ambiguity, and
policy disagreements retain distinct classifications.

Public payloads remain opt-in and use reviewed synthetic content. Preview exposes
a deterministic duplicate identity and open/closed searches without submission.
The reducer preserves explicit interestingness, and test-only generation enforces
reproduction, neighboring control, scope, redaction, and benchmark-delta evidence.

Maintained artifacts: `templates/feedback-fixture.json`,
`schemas/docguard-feedback-fixture.schema.json`, and the generated direct
`tests/*.test.mjs` contribution path.

### R5 — Evidence-scoped verification (planned)

Replace broad age-based review prompts with declared source-to-document
dependencies where available. Start with bounded claim types such as named JSON
values, enum sets, and counts tied to documented collections. Results remain one
of verified-within-scope, contradicted, unsupported, inconclusive, or stale.

Contribution slices: dependency declarations, exact claim predicates, saved
oasdiff/Buf evidence adapters, and review invalidation fixtures. Upstream tools
retain ownership of their domain semantics; DocGuard links results to affected
prose, examples, requirements, and migration guidance.

### R6 — Language and repository coverage (planned)

Add capabilities only with explicit applicability and controls. Priorities are
Python import relationships, additional Worker binding forms, custom document
role writers with section ownership, and repository-root guidance for monorepos.
Unsupported extraction must remain visible and must not become a success claim.

Contribution slices: one parser or framework per pull request, paired supported
and unsupported fixtures, and benchmark deltas for any performance-sensitive
scanner change.

### R7 — Task-specific agent context (research)

Evaluate targeted evidence packets against ordinary repository context and the
existing DocGuard context pack. Freeze repository snapshots, model/harness
versions, prompts, and budgets; measure hidden-test success, requirement
violations, unnecessary edits, tokens, latency, and human intervention.

Ship only if repeated trials improve task outcomes or reduce cost within a
predeclared non-inferiority margin. An LLM judge or DocGuard score alone is not
sufficient evidence.

## Contribution standard

Before opening work, search existing open and closed issues and pull requests.
Each proposal should name the failure mode, include a minimal reproduction and a
valid control, state supported and unsupported scope, and define the acceptance
test. See `CONTRIBUTING.md` for repository mechanics.

## Deferred ideas

A hosted dashboard, leaderboards, and notification integrations remain deferred
until user research shows that the CLI, CI outputs, and existing observability
systems cannot meet a concrete team need. They are not active commitments.
