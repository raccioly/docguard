# Contract: TestGuard Evidence Adapter (US6)

Module: `cli/scanners/testguard-evidence.mjs`. It lives with the scanners
because it asks git whether the evidence revision exists, and the evidence
layer never runs an external tool.

## Input

- **Paths.** `anchors.testguard.evidence` (default `.testguard/evidence.json`)
  and `anchors.testguard.claims` (default `testguard.claims.json`).
  - Both must be project-relative. An absolute path, `..`, `\`, `:` or NUL is
    refused before anything is read.
  - Both are read through the evidence reader: no symlink, no path outside
    the project, no `.local` or `.env*` segment.
  - The evidence may be up to 32 MiB.
- **Fields read from the evidence.** These are checked by hand, because
  DocGuard has no schema validator at runtime:
  - `schemaVersion` (1);
  - `run.repo.head` and `run.repo.snapshot`, which must be commit ids;
  - `run.confirmRuns`, `run.provisional` and `run.method`;
  - per record: `claim` (`id`, `statement`, `severity`, `source`,
    `producedBy`), `subject.id`, `subject.file`, `verdict`,
    `defenders.resolved`, `inputs.targetHash` and `inputs.defenderHashes`.
- **Requirement reference.** TestGuard companion spec 003 defines
  `claims[].source = { "kind": "spec", "ref": "req:<spec-id>#<requirement-id>" }`.
  It is the only form that names a requirement.

## Revision

The evidence revision is `run.repo.snapshot` (a working-tree probe) or
`run.repo.head`. It is passed to `git cat-file -e` only after it has matched
the commit-id pattern.

## Evaluation, in order, per test reference T to requirement R

| # | Condition | Status | Reason |
|---|---|---|---|
| 1 | No evidence file | `needs-reverification` | `no-evidence` |
| 2 | Unsafe path, unreadable file | `inconclusive` | `evidence-unreadable` |
| 3 | Not JSON, or not the fields above | `inconclusive` | `evidence-invalid` |
| 4 | `provisional`, or `confirmRuns` < 3 | `inconclusive` | `evidence-provisional` |
| 5 | `method` other than fault injection | `inconclusive` | `evidence-method` |
| 6 | The revision does not exist here | `inconclusive` | `head-unresolvable` |
| 7 | No claim's structured ref names R | `needs-reverification` | `no-structured-claim`, with the `req:` form to write, naming any claim whose path ref resolves to R |
| 8 | The claims file cannot be read | `inconclusive` | `claims-unreadable` |
| 9 | R's anchored code at the revision differs from today, or did not exist | `needs-reverification` | `evidence-predates-change` |
| 10 | T is not a recorded defender of any claim naming R | `needs-reverification` | `not-a-defender` |
| 11 | A defending claim changed or was removed in the claims file | `inconclusive` | `claim-changed` |
| 12 | A fault in the claims file has no record | `inconclusive` | `fault-unprobed` |
| 13 | A recorded target or defender hash differs from the file today | `inconclusive` | `inputs-stale` |
| 14 | A defending claim has a fault not `killed` | `needs-reverification` | `fault-not-killed` |
| 15 | Otherwise | `re-verified` | `evidence-current`, with `evidenceHead` and `claims` |

Code comparison at the revision uses the same rule as the lock: the exact
fingerprint when the tier is unchanged, otherwise the floor.

DocGuard never runs a test, a probe or TestGuard itself.
