# Architecture Decision Journal

## 2026-09-14 — Spec lifecycle authority and context retirement

**Problem:** Completed feature folders and superseded plans remain beside active
requirements. Agents can interpret historical prose as current intent, while
direct implementation changes may never flow back into specs.

**Evidence:** Spec Kit deliberately supports flow-back, flow-forward, and living
spec persistence models rather than selecting one. Its extension API exposes
`before_specify`, `after_implement`, and related lifecycle hooks. The community
Archive extension consolidates feature deltas into `.specify/memory/`; the
Reconcile extension updates a feature's artifacts from a bounded drift report.
Open Spec Kit issue #620 describes the same cross-feature supersession problem.

**Decision:** DocGuard will use a hybrid living-contract model:

1. Active approved requirement prose remains the source of intent.
2. Source, configuration, and tests remain implementation evidence.
3. `.docguard-specs.json` becomes a deterministic, committed control plane.
   Reviewed fields are authoritative for orthogonal approval, delivery, context,
   storage, persistence policy, lineage, and declared scope;
   generated fields index requirement identities, evidence, and reconciliation
   revision. It points to requirement prose and does not copy it.
4. Context packs are generated projections of active registry entries and
   canonical docs.
5. Completed/superseded prose leaves active search paths after consolidation;
   Git plus `.docguard-archive.json` preserve recovery and provenance.
6. DocGuard validates compatible Archive/Reconcile extension outputs instead of
   recreating their prompt-based merge workflows.
7. Completion is a delivery transition from `implemented → verified`. Checked tasks
   establish a claim; reconciliation of intent, tests, implementation evidence,
   and current docs establishes verification.
8. A verified spec receives a bounded outcome record before its historical prose
   leaves active context. Direct code changes either refresh proven mechanical
   facts or create a reviewed amendment/successor decision.
9. Spec identity comes from immutable metadata, not its directory. Requirement
   evidence uses `specId#requirementId`; retired IDs remain as tombstones so a
   bare `FR-001` can never rebind and certify another feature.
10. `.docguard-archive.json` owns generic document recovery events, while
    `.docguard-specs.json` owns spec governance. A validator cross-checks both;
    neither duplicates retired prose.
11. One `docguard specs` command family is the lifecycle-state writer. Guard,
    trace, preflight, completion, and hooks consume the same pure projection.

**Rejected alternatives:** Keeping every feature folder in the working tree
preserves audit history but pollutes agent context. Making code automatically
rewrite requirements can legitimize regressions. Treating the registry as a
second prose contract creates another drift surface. Contributing a DocGuard
policy engine directly to Spec Kit core would couple two tools before the
interoperability contract has field evidence.

**Operational contract:** New-spec preflight refreshes the registry, checks
identity and lineage, then reports existing implementation evidence, active
intent conflicts, unreconciled changes, and semantic review items separately.
Completion regenerates the observed projection and agent context, updates only
proven mechanical facts automatically, appends the implementation outcome, and
records the reconciled Git revision. Registry generation is byte-deterministic;
reviewed control fields survive regeneration.

Registry transitions are atomic across governance and recovery metadata. A
current spec must resolve to a clean tracked path; a retired spec must resolve to
a matching retained recovery event; supersession must name an approved current
successor; verification must carry exact revision and requirement-qualified
evidence.

Preflight has two points: an advisory briefing before a spec exists and an
enforceable structural check after specification but before planning. Spec Kit
hooks can prompt these actions, while CLI/CI owns the blocking result. DocGuard
refreshes only its own context outputs and validates compatible extension
outputs; it does not silently rewrite agent-native instruction files.

**Lifecycle representation:** Do not overload one `status`. Approval
(`draft|approved|rejected`), delivery
(`planned|in_progress|implemented|verified|released`), context
(`current|retired`), retirement reason (`completed|superseded|abandoned`),
storage (`working_tree|git_history`), and persistence policy are independent.
Archive readiness is stricter than implementation verification because the
source revision and every live backreference must also remain valid.

**Upstream path:** Prove the registry and hooks in DocGuard, interoperate with the
existing community extensions, then propose a generic lifecycle metadata/hook
contract on Spec Kit issue #620. Keep DocGuard-specific evidence and enforcement
outside Spec Kit core.
