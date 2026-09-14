# Feature Specification: Task-Specific Agent Context

**Status**: Active
**Spec ID**: `docguard.task-specific-agent-context`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

DocGuard already emits a complete agent task graph and a repository-wide context
pack. Both are useful maps, but neither answers the narrower question an agent
faces during one change: which current requirements, owned documentation, source
evidence, and verification commands matter for this task? Supplying every known
fact can consume context, encourage unnecessary exploration, and amplify stale or
irrelevant instructions.

A task-specific packet is worthwhile only if deterministic evaluation shows that
it preserves task success and safety while improving outcome quality or cost. The
feature must abstain when repository evidence cannot justify a narrow selection.

## User Scenarios & Testing

### US1 — Start an agent with bounded relevant evidence

As a maintainer, I can provide a concrete task and receive a compact packet of
current requirements, source pointers, project rules, and verification commands.
Every excerpt identifies its file, line range, content hash, and selection reason.

### US2 — Avoid false confidence from weak retrieval

As a maintainer, I see when the selector has insufficient evidence. An abstention
returns a small navigation map and tells the agent to discover context normally;
it does not present low-similarity prose as authoritative task context.

### US3 — Exclude stale and private material

As an enterprise adopter, retired specifications, unsafe paths, symlink escapes,
secret files, and `.local/` never enter the packet. Current lifecycle metadata and
configured document roles control eligible documentation.

### US4 — Verify benefit before enabling the feature

As a maintainer, I can reproduce a frozen comparison of task-only, existing
context-pack, and targeted-packet conditions. Hidden tests and deterministic
policy checks decide success; an LLM judge or DocGuard score cannot promote the
feature.

## Functional Requirements

- **FR-001**: Task context generation MUST be read-only and MUST NOT execute
  project code, package-manager commands, hooks, or network requests.
- **FR-002**: The task input MUST be length-bounded, normalized deterministically,
  and represented by a digest in machine output; raw task text MUST NOT be written
  to repository state by default.
- **FR-003**: Selection MUST rank exact paths, stable finding codes, qualified
  requirement IDs, identifiers, and lexical overlap deterministically. Exact
  evidence MUST outrank lexical similarity, and no embedding or LLM call may be
  required.
- **FR-004**: Eligible prose MUST be limited to configured canonical documents,
  approved current specifications, and bounded project-rule sections. Retired,
  superseded, unapproved, or unknown-lifecycle planning material MUST be excluded.
- **FR-005**: Source and test context MUST be represented as bounded pointers or
  excerpts only when linked by exact path, requirement evidence, or selected
  canonical prose. Repository-wide source dumping is prohibited.
- **FR-006**: Every selected excerpt MUST include repository-relative path, exact
  line range, content hash, score, and machine-readable reasons. Hashes establish
  captured provenance, not truth.
- **FR-007**: Packet limits MUST cap files, excerpts, lines per excerpt, total
  characters, and per-run file reads. Truncation and omitted candidate counts MUST
  remain visible.
- **FR-008**: If no candidate reaches the predeclared relevance threshold, the
  selector MUST abstain and emit only provenance, limitations, and a navigation
  map. Abstention MUST NOT be reported as successful retrieval.
- **FR-009**: The packet MUST preserve DocGuard assurance boundaries: deterministic
  findings and scoped evidence retain their states; selected prose remains
  unverified unless an existing exact evidence declaration verifies it.
- **FR-010**: `docguard agent` without a task MUST retain its existing output.
  Any promoted task-specific interface MUST use an explicit task option and keep
  human and JSON output semantically aligned.
- **FR-011**: Evaluation MUST use fresh frozen repositories, identical task prompts,
  hidden fail-to-pass and pass-to-pass tests, a fixed model/harness/effort, bounded
  wall time, and at least three repeated trials per task and condition.
- **FR-012**: Evaluation MUST compare task-only, existing DocGuard context-pack,
  and targeted-packet conditions and record success, requirement violations,
  unnecessary edits, agent steps, input/output tokens, latency, and human
  intervention proxy.
- **FR-013**: Promotion thresholds and the non-inferiority margin MUST be committed
  before trials run. Changing thresholds after observing results requires a new
  protocol version and invalidates promotion from earlier trials.
- **FR-014**: Deterministic manifests, fixture digests, prompts, scoring logic, and
  aggregate results MUST be versioned separately from environment-specific model
  observations. Failed and unsupported trials remain in results.
- **FR-015**: The user-facing targeted packet MUST ship only when the frozen trial
  satisfies every promotion criterion. Otherwise R7 MUST close with the harness,
  evidence, and an explicit rejection or deferral of product behavior.

## Success Criteria

- **SC-001**: Selector fixtures prove exact-path and requirement selection,
  deterministic ordering, bounded excerpts, lifecycle exclusion, private-path
  rejection, and honest abstention.
- **SC-002**: The same task and repository state produce byte-identical packet
  cores on Node 18, 20, 22, and 24.
- **SC-003**: All hidden regression and policy tests are absent from agent-visible
  repositories and fail against the unmodified fixture where applicable.
- **SC-004**: At least 27 frozen agent runs complete: three tasks by three
  conditions by three repeated trials, unless the harness records an explicit
  model or infrastructure failure for each missing run.
- **SC-005**: Promotion occurs only if targeted context is within one failure of
  the best baseline across nine trials, introduces no additional requirement or
  unnecessary-edit violations, and either gains at least one success or reduces
  median uncached input tokens, steps, or latency versus full context by at least
  15 percent.

## Non-Goals

- Automatically invoking or choosing an LLM in normal DocGuard commands.
- Treating lexical relevance as semantic correctness.
- Preventing an agent from reading additional repository files after startup.
- Claiming general agent-productivity improvement from three synthetic tasks.
- Replacing repository-native tests, review, or access controls.
