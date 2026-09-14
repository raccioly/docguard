# Feature Specification: Evidence-Scoped Verification

**Status**: Active
**Spec ID**: `docguard.evidence-scoped-verification`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

DocGuard discovers high-value numeric and enum claims, but all of them remain
unverified and are handed to an agent. Repository-wide age heuristics can request
review without knowing whether the source relevant to a statement changed. Teams
that already produce exact JSON configuration or API-compatibility reports have
no standard way to bind that evidence to the prose, examples, requirements, and
migration guidance that depend on it.

This feature adds narrow deterministic verification without implying that all
prose, code, runtime behavior, or deployment state is correct.

## User Scenarios & Testing

### US1 — Bind a documented value to JSON

As a maintainer, I can bind a sentence such as “Retention is 30 days” to an RFC
6901 pointer in a JSON policy file. A source or prose change produces a specific
result without requiring an agent to search the repository.

### US2 — Verify a documented enum or collection count

As a maintainer, I can compare a uniquely selected Markdown value with a JSON
array as a set or with a bounded file collection count. Ordering and display
format are declared rather than guessed.

### US3 — Link upstream compatibility evidence

As an API owner, I can save oasdiff JSON or Buf JSON Lines and bind a no-breaking-
change claim to that artifact. DocGuard verifies declared input digests and marks
the evidence stale when an input changes.

### US4 — Gate drift without false assurance

As a CI owner, I receive structured verified, contradicted, stale, inconclusive,
and unsupported states. Only a current, uniquely targeted, supported predicate
can pass; missing evidence and unsupported report shapes stay visible.

## Functional Requirements

- **FR-001**: `.docguard-evidence.json` MUST use a versioned strict schema. Each
  declaration MUST have an immutable ID, Markdown target, source adapter,
  predicate, and explicit applicability. Duplicate IDs, unknown keys, unsafe
  paths, invalid combinations, and unbounded inputs MUST fail validation.
- **FR-002**: Evidence reads MUST remain inside the repository, reject private
  `.local` and `.env*` paths, reject symlinks, cap file counts and bytes, and
  perform no network access, package installation, project-code execution, or
  external-tool execution.
- **FR-003**: The JSON adapter MUST resolve RFC 6901 pointers with exact decoding,
  array-index rules, and failure on invalid or unresolved pointers. Values MUST
  retain JSON type; string/number/boolean coercion is forbidden.
- **FR-004**: The collection adapter MUST count files from one bounded relative
  glob using the existing ignore contract. Zero matches are a real value only
  when the declaration explicitly permits an empty collection.
- **FR-005**: The oasdiff adapter MUST consume saved JSON from a declared
  `breaking` or `changelog` command. The Buf adapter MUST consume saved JSON
  Lines from `buf breaking --error-format=json`. Both MUST require producer
  version and current SHA-256 declarations for every repository input. Unknown
  shapes or command modes are unsupported; malformed files are inconclusive.
- **FR-006**: A Markdown target MUST name a document, heading, and literal
  statement template. Value predicates require exactly one `{{value}}` slot;
  report predicates require no slot. Matching MUST ignore fenced code, normalize
  horizontal whitespace only, and require one unique candidate in the heading.
- **FR-007**: Initial predicates MUST be `equals`, `set-equals`, `count-equals`,
  and `no-findings`. Set comparison MUST declare a separator and ignore order
  while rejecting duplicates. Count comparison MUST parse one non-negative base-
  ten integer. No predicate may infer units, aliases, or semantic equivalence.
- **FR-008**: Every evaluated declaration MUST return exactly one state:
  `verified-within-scope`, `contradicted`, `stale`, `inconclusive`, or
  `unsupported`, with a stable claim ID, document location, adapter, predicate,
  input hashes, evidence hash, reason code, and explicit scope limitation.
- **FR-009**: `docguard verify --evidence --format json` MUST expose the complete
  machine contract. Human output MUST group states by action and show the next
  exact file or producer step. Existing `--semantic` and `--instructions`
  behavior MUST remain backward compatible.
- **FR-010**: `guard` MUST run evidence verification when a manifest exists.
  Contradictions MUST be high-confidence errors; stale, inconclusive, unsupported,
  and invalid declarations MUST remain visible findings. Verified declarations
  contribute passes only within their selected statement and MUST NOT exempt the
  containing document or undeclared prose from freshness review.
- **FR-011**: Claim and evidence identities MUST change when the declaration,
  selected statement, source value/report, producer metadata, or declared input
  digest changes. Line-number movement and unrelated repository edits MUST NOT
  change identity.
- **FR-012**: Output and agent context MUST keep deterministic verification
  separate from heuristic semantic candidates. A verified declaration may
  reduce the unverified count only when it uniquely covers the same extracted
  claim; all other discovered claims remain unverified.
- **FR-013**: The distributed schema, examples, `explain` entries, canonical
  architecture, security, test guidance, and Spec Kit skills MUST state the
  evidence boundary and remediation workflow without telling agents to rewrite
  approved intent from current code automatically.

## Evidence State Contract

| State | Meaning | CI action |
|---|---|---|
| verified-within-scope | Unique document target and current supported source satisfy the exact predicate | Pass for this declaration only |
| contradicted | Unique target and current source produce different exact values or a report violates `no-findings` | High-confidence error; determine whether code/evidence or approved prose is wrong |
| stale | A declared external-report input hash no longer matches the current repository input | Regenerate upstream report and review the dependent prose |
| inconclusive | Required file, heading, unique target, pointer, or parse result is unavailable | Restore evidence or narrow the declaration; no pass |
| unsupported | Adapter version, command, report shape, or predicate combination is outside the implemented contract | Keep visible and contribute a paired fixture before expanding support |

## Success Criteria

- **SC-001**: Seeded JSON scalar, enum-set, and collection-count examples each
  distinguish matching, contradicted, missing, ambiguous, and unsafe cases.
- **SC-002**: Seeded oasdiff and Buf reports distinguish clean, finding,
  malformed, unsupported, and input-digest-stale cases without invoking either
  external binary.
- **SC-003**: Reordering unrelated files or moving the selected statement within
  its heading leaves the claim identity stable; changing any covered input
  changes the evidence identity.
- **SC-004**: Guard, JSON, SARIF/JUnit-compatible finding flow, diagnose, and
  agent context preserve all non-pass states and never report whole-document
  factual accuracy.
- **SC-005**: The full supported Node matrix, parser-absent path, benchmark
  baseline, package composition, and external corpus show no regression.

## Non-Goals

- Proving arbitrary prose, runtime behavior, deployment state, or compliance.
- Executing, installing, or choosing policy for oasdiff, Buf, or another tool.
- Supporting arbitrary regular expressions, scripts, JSONPath, YAML parsing, or
  remote evidence in the initial release.
- Rewriting canonical intent when implementation differs.
- Treating a verified statement as a freshness exemption for its document.
