# Feature Specification: Calibrated Finding Channels

**Status**: Active
**Spec ID**: `docguard.calibrated-finding-channels`
**Created**: 2026-09-21
**Owner**: DocGuard maintainers
**Extends**: `docguard.precision-evidence-loop`, `docguard.adoption-workflow-integrity`, `docguard.language-repository-coverage`

## Problem

A DocGuard finding carries one uncertainty field, `confidence: 'high'|'low'`,
and that field is doing three jobs at once. It is a maintainer's prior about
the detector (asserted per call site, never measured — `cli/findings.mjs:732`
coerces every value other than `'low'` to `'high'`); it is the triage signal
that decides whether a human should look (`cli/validators/freshness.mjs:427`
maps every history heuristic to `'low'` regardless of how certain the
observation is); and it is the sampling gate for the feedback loop
(`cli/findings.mjs:754` derives `reportable` from it, and `cli/commands/feedback.mjs:217`
selects `reportable` by default). Measured on a project with 17 findings, all
high-confidence, `docguard feedback` selected none. The loop that would validate
the label samples only findings the label already doubts.

Independently, the analyzer tier that produced a finding is invisible. The
Python AST tier depends on a `python3` interpreter on `PATH`
(`cli/scanners/py-ast.mjs`); when it is absent the route and schema scanners
fall back to regex that cannot read multi-line decorators, return plain arrays
with no tier marker, and the validators that consume them report `checked`.
Only `architecture` and `environment` disclose the degradation. `parserTier`
exists as a vocabulary in the benchmark and feedback schemas, authored by
humans, and is never computed at run time.

The precision benchmark (`benchmarks/baseline.json`) measures 7 of 112 codes
and reports precision 1.0 with zero false positives. Its runner scopes observed
findings to the case's declared codes (`benchmarks/lib/runner.mjs:149`), its
defects are authored mutations, and an adjudicated false positive enters the
corpus only after the detector is changed (`cli/feedback-fixture.mjs:184`
emits a test asserting the finding is gone). The manifest accepts
`policy_disagreement` and `ambiguous` rows; the corpus contains none, and no
tool path produces one. A disagreement the maintainers decline to act on leaves
no record.

This feature separates the three jobs into three channels, computes the
analyzer tier at run time, lets adjudications accrue without changing a
detector, and records the objective any future data-driven threshold must use.
It does not make DocGuard a probabilistic judge, does not derive `confidence`
from measured precision (the corpus is three orders of magnitude too small to
do so honestly), and does not add a model of any kind.

## User Scenarios & Testing

### US1 — Triage act versus escalate from machine output (P1)

As an agent consuming `guard --format json` or SARIF, I can tell whether
DocGuard asserts a defect it can name the fix for, or reports a signal a human
must judge, without parsing prose. FRS002 ("13 code commits since the document
was reviewed") is an escalation with a certain observation, not a
low-confidence defect.

**Independent test**: on a fixture with one FRS002 and one STR001, JSON and
SARIF both carry `disposition: 'escalate'` for FRS002 and `'act'` for STR001;
the guard summary prints separate counts for each.

### US2 — Know whether a confidence label is measured, asserted, or unmeasured (P1)

As a reader, I can see beside every finding whether its confidence is backed
by the reviewed corpus, is a maintainer's prior, or has never been measured,
using the evidence `precision-evidence.mjs` already computes per run.

**Independent test**: SEC005 findings carry `evidence.status: 'measured'` with
n and the Wilson bound; FRS002 findings carry `evidence.status: 'not-measured'`;
`explain <CODE>` and the finding agree.

### US3 — Know which analyzer produced a finding and when the tool degraded (P2)

As a maintainer of a Python service, when `python3` is absent from `PATH` I see
the route/schema validators report `partial` with a reason naming the
interpreter, and every finding they emit carries `parserTier: 'regex-fallback'`.
A JS/TS file `@babel/parser` cannot parse is disclosed the same way.

**Independent test**: a Flask fixture with a multi-line route decorator scanned
with and without `python3` on `PATH` produces different applicability and
different `parserTier` values, and the guard summary prints the tier counts
when any degraded tier is present.

### US4 — Adjudications accrue even when the detector is left alone (P2)

As a maintainer, when a user reports a false positive and I decide the detector
is behaving as designed, that decision is recorded as a corpus row and reported
per code (`N adjudicated disagreement(s) on record`) without changing the
measured precision. As a user, `docguard feedback` by default selects every
finding whose code has never been measured, and tells me how many measured
high-confidence findings it excluded.

**Independent test**: a `policy_disagreement` row for SEC001 in the corpus
leaves `byCode.SEC001.precision` unchanged and adds
`byCode.SEC001.adjudicated.policyDisagreements: 1`; on a run with 17
high-confidence findings across unmeasured codes, feedback selects all 17.

### US5 — Any future tuning is bound to a strictly proper scoring rule (P3)

As a contributor holding feedback labels, I cannot merge a threshold fitted for
accuracy, F1, or minimum reported false positives; the specification and a
comment at every threshold site name the required objective.

**Independent test**: a repository test asserts each listed threshold constant
carries the pointer comment.

### US6 — The headline cannot read non-coverage as success (P3)

As a badge reader, `628/628 passed` is accompanied by how many validators were
actually able to check, and a run in which any validator was partial, missing
its prerequisite, unsupported, or errored does not render `brightgreen`.

**Independent test**: on this repository (1 partial, 1 missing prerequisite)
the summary prints `21 of 30 validators checked` and the badge colour is
`green`, not `brightgreen`.

## Functional Requirements

### Channels on the Finding (additive; no existing field renamed or removed)

- **FR-001**: Every Finding MUST carry `disposition: 'act' | 'escalate'`.
  `act` means DocGuard asserts a defect and names a correction; `escalate`
  means DocGuard reports an observation whose judgement belongs to the reader.
  `disposition` is orthogonal to `severity` (whether CI blocks) and to
  `confidence` (how sure the detector is of the observation).
- **FR-002**: `disposition` MUST default from `suggestion.kind` (`fix`,
  `suppress` → `act`; `review`, `report` → `escalate`) and MUST default to
  `escalate` when no valid suggestion is present. A call site MAY set it
  explicitly.
- **FR-003**: A suggestion whose `kind` is not one of the supported values MUST
  be treated as malformed and omitted, per `docguard.adoption-workflow-integrity#FR-002`;
  it MUST NOT be coerced to `review`.
- **FR-004**: Every Finding MUST carry `evidence: { status: 'measured' |
  'not-measured', … }` derived by finding code from the reviewed baseline via
  the existing projection (`docguard.precision-evidence-loop#FR-019`). A
  `measured` entry MUST carry `n`, the point estimate only when the denominator
  meets the published floor, the 95% bound, and `measuredOnRunningVersion`.
- **FR-005**: `confidence` MUST describe the detector's certainty in the
  observation, not the reader's need to act. The freshness adapter MUST stop
  blanket-mapping every warning to `'low'`; FRS002–FRS005 MUST be
  `disposition: 'escalate'` with `confidence: 'high'` when the counted quantity
  (commits, days, added lines) was read directly from Git.
- **FR-006**: Every Finding MUST carry `parserTier`, one of the benchmark
  vocabulary `js-ast | py-ast | regex-fallback | fallback-language | mixed |
  not-applicable`, computed at run time (FR-010–FR-012).
- **FR-007**: `guard --format json`, SARIF `result.properties`, and the feedback
  record MUST include `disposition`, `evidence.status`, and `parserTier` for
  every finding. SARIF MUST include `confidence` for every finding, not only
  when it is `'low'`.
- **FR-008**: The guard summary MUST print the count of `act` and `escalate`
  findings separately, and MUST print analyzer tier counts whenever any
  finding or validator was produced under `regex-fallback` or
  `fallback-language`.
- **FR-009**: `location` MUST be a string or `null`; a Finding constructed with
  an object location MUST be normalized to `file:line` (`APS002` currently
  emits an object, rendering `[object Object]`).

### Run-time analyzer tier

- **FR-010**: The tier MUST be decided at the two analyzer entry points and
  nowhere else: `parseJsTs` (`ok: true` → `js-ast`; `ok: false` →
  `regex-fallback` with the returned `error` as reason) and
  `extractPythonFiles` (`null` → `regex-fallback` for all files, reason
  `python-interpreter-unavailable`; per-file `ok: false` → `regex-fallback` for
  that file, reason `python-parse-failed`). Files whose extension has no AST
  tier MUST be `fallback-language`.
- **FR-011**: Scanners that consume those entry points (`routes`, `schemas`,
  `js-ast` users) MUST attach `tier` and `tierReason` to every extracted item.
  A validator that emits a Finding from items of more than one tier MUST set
  `parserTier: 'mixed'` and MUST name the lowest tier in the reason.
- **FR-012**: A validator whose inputs include any `regex-fallback` item for a
  language that has an AST tier MUST set `applicability.status: 'partial'`
  with a reason naming the cause and the count of affected files, following
  the existing `architecture` and `environment` pattern. Findings produced
  under that condition MUST still be emitted (findings are retained; coverage
  is disclosed).
- **FR-013**: Constitution principle II is unchanged: `@babel/parser` and
  `python3` remain optional at load time. Absence MUST degrade and disclose,
  never crash and never silently pass.

### Feedback sampling and adjudication record

- **FR-014**: `reportable` MUST NOT be derived from `confidence` alone. It MUST
  be true when `evidence.status` is `not-measured` or `confidence` is `'low'`.
  `feedback` default selection MUST use the same predicate, and MUST print how
  many measured high-confidence findings were excluded and that `--all`
  includes them.
- **FR-015**: A feedback record the maintainers adjudicate as
  `policy_disagreement` or `ambiguous` without changing the detector MUST be
  representable as a corpus row with that classification, an opposite control,
  and the same provenance and redaction attestations as a defect row. The
  contribution template MUST offer this path beside the existing regression
  test path.
- **FR-016**: Per `docguard.precision-evidence-loop#FR-003`, such rows MUST NOT
  enter the precision or recall denominators. The baseline core, the generated
  precision-evidence module, `guard`'s `precisionEvidence` block, and
  `explain <CODE>` MUST report them as separate integer counts per code
  (`adjudicated.policyDisagreements`, `adjudicated.ambiguous`).
- **FR-017**: A `policy_disagreement` row MUST record the adjudication rationale
  and date, and the regression comparator MUST fail if such a row is removed
  without a replacing tombstone.

### Data-driven thresholds

- **FR-018**: Any threshold, weight, or confidence value derived from observed
  data MUST be fitted against a strictly proper scoring rule (Brier or
  logarithmic). Classification accuracy, F1, and raw false-positive counts
  MUST NOT be used as fitting objectives. A fitted value MUST record its
  objective, its held-out split, its calibration error, and MUST be fitted per
  declared shape (`code × parserTier` at minimum), never globally.
- **FR-019**: Every hand-set threshold constant (`freshness`, `doc-quality`,
  `task-context`, `cross-reference`, `precision-evidence minN`) MUST carry a
  one-line comment referencing FR-018, and a repository test MUST assert the
  comment is present at each listed site.

### Headline coverage

- **FR-020**: The guard summary MUST print `checked` validator count beside the
  passed/total check count. The badge colour MUST NOT be `brightgreen` when any
  active validator is `partial`, `missing-prerequisite`, `unsupported`, or
  `error`.

## Key Entities

- **Finding** (extended): `code, validator, severity, confidence, disposition,
  evidence, parserTier, message, location, suggestion, reportable, redactedContext`.
- **Tiered item**: a scanner output element with `tier` and `tierReason`.
- **Adjudication row**: a corpus case with classification `policy_disagreement`
  or `ambiguous`, opposite control, rationale, date; never counted in ratios.

## Success Criteria

- **SC-001**: 100% of findings in `guard --format json` and SARIF carry
  `disposition`, `evidence.status`, `parserTier`, and `confidence`.
- **SC-002**: FRS002 on the fixture emits `escalate` / `confidence: 'high'` /
  `evidence: not-measured` / `reportable: true`.
- **SC-003**: On a run whose findings all have unmeasured codes, `feedback`
  default selection equals the full finding list; on a run with SEC005 only,
  it selects none and prints the exclusion count.
- **SC-004**: Flask fixture with a multi-line decorator: with `python3`,
  `apiSurface` flags the undocumented route under `py-ast`; without, the
  validator reports `partial` naming the interpreter and any finding carries
  `regex-fallback`.
- **SC-005**: Adding a `policy_disagreement` row changes no precision or
  recall value in the baseline and adds the per-code adjudicated count to the
  generated module and `explain`.
- **SC-006**: Benchmark comparison against the reviewed baseline reports no
  regressions after the change (finding identities are unchanged).
- **SC-007**: On this repository the summary prints `21 of 30 validators
  checked` and the badge is `green`.
- **SC-008**: Full suite passes; no new runtime dependency; `docguard guard`
  passes on this repository.

## Non-Goals

- Deriving `confidence` from measured precision. The corpus cannot support it.
- Any learned or model-based judge, local or remote.
- Renaming or removing `confidence`; that is a separate breaking change to a
  published contract.
- A general audit of per-file `catch { continue }` sites. Whole-validator read
  failures already surface as `applicability: error`; individual swallow sites
  are handled only where a fixture demonstrates silent loss (see plan).
