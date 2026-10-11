# Contract: TestGuard Evidence Adapter (US6)

## Input

- **Path.** `anchors.testguardEvidence` sets the path; it defaults to
  `.testguard/evidence.json`. It must be a project-relative plain file, and
  the same `safePath` rules as the doc lock apply.
- **Shape.** The TestGuard evidence schema at `spec/schemas/evidence.schema.json`.
  The adapter reads only `head`, `claims[].id`, `claims[].source`, the verdict
  per fault, and the declared inputs it checks hashes against.
- **Requirement reference.** The TestGuard companion spec defines the
  structured form `claims[].source = { kind: "spec", ref: "<specId>#<REQ>" }`.

## Matching

A test reference to requirement R is **re-verified at H** when all four hold:

1. The evidence `head` H resolves in this repository.
2. A claim whose `source.ref` equals R has every confirmed fault verdict
   `killed`.
3. That claim's `defendedBy` includes the test file.
4. The anchored code's v1 fingerprint, computed from blobs at H, equals the
   current fingerprint.

## Outcomes

| Condition | Status | Reason |
|---|---|---|
| All four hold | `re-verified` | `evidence head <H>` |
| The fingerprint at H differs | `needs-reverification` | `evidence predates the change` |
| No claim has a structured reference to R | `needs-reverification` | `no structured claim names R`, with a hint about the companion spec |
| The file is unreadable, the schema is invalid, input hashes are stale, or H does not resolve | `inconclusive` | the specific cause |

DocGuard never runs a test, a probe or TestGuard itself.
