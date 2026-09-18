# Validation — how DocGuard's detectors earn their defaults

Detector changes should be tested against both synthetic controls and real repository snapshots. The September 2026 field assessment found false positives and unsupported coverage that prior passing tests did not reveal. Historical results below describe their original samples; they are not a current zero-false-positive guarantee. This page
documents the method and the measured results, in the spirit of an honest
benchmarks page: what we measured, what we found, and what we do *not* claim.

## The method

The required evaluation process is:

1. **Build** the detector from a published method where one exists (research
   papers, field-tested heuristics), deterministic and zero-LLM.
2. **Run it read-only** against a corpus of real production repositories —
   no writes, no config, first-run conditions (the exact scenario a new user
   hits).
3. **Measure signal vs noise** by hand: every finding is classified as a true
   positive, a false positive, or inert (pattern absent in that repo).
4. **Keep, cut, or tune.** Detectors that flood are given precision levers
   (subject binding, caps, scoping, evidence gates) and re-measured; detectors
   that add no value are removed, not shipped default-off.
5. **Dogfood.** DocGuard guards its own repository in CI. A detector that
   false-positives on DocGuard itself gets fixed before release (see the
   examples below).

## Results — evidence-scoped verification (v0.40.0 candidate)

The R5 candidate passed 1,733 tests on each supported Node release (18, 20, 22,
and 24). The extracted npm tarball ran without installed dependencies, exercising
the optional-parser fallback, and the evidence manifest/example passed an
independent JSON Schema Draft 2020-12 validator.

The complete frozen benchmark ran 24 paired synthetic/public cases across 12
repository groups. Comparison found no new false positives, false negatives,
supported-case abstentions, or removed evidence. Persisted runtime observations
remain non-comparable by policy; performance claims require five controlled
same-session samples.

### Reviewed baseline numbers (`benchmarks/baseline.json`, reviewed 2026-09-14)

| Metric | Point estimate | n | Wilson 95% |
|--------|----------------|---|------------|
| Finding precision | 1.000 | 12 expected findings, 0 unexpected | 0.757 – 1.000 |
| Finding recall | 1.000 | 12 expected findings, 0 missed | 0.757 – 1.000 |
| Clean-control false-positive case rate | 0.000 | 12 clean controls | 0.000 – 0.243 |
| Accepted repair rate | null | 0 repairs evaluated | null |

Per-detector cells are small: security n=20, structure n=2, todoTracking n=2,
architecture n=0 (`null`). A cell that small says almost nothing on its own.

**Caveat, verbatim from the envelope:** *Benchmark precision on a deliberately
balanced corpus of 12 defect and 12 clean-control cases across 12 repository
groups and 12 causal families. This is DocGuard's precision on labelled cases,
not the probability that a finding in your repository is real; quote every
ratio with its n and Wilson 95% bound.*

The envelope's `review.measures` is `benchmark-precision`. DocGuard does not
publish a calibration document (P(finding is real) under a base rate): the real
base rate of a stale documented claim is nowhere near the corpus's 50/50 split,
so a probability read off this corpus would mislead. The HIGH/MEDIUM/LOW labels
in `guard` output are deterministic strata — a validator's check pass-ratio —
and were never calibrated against outcomes. The loader
(`benchmarks/lib/baseline.mjs`) recomputes every ratio from the retained cases
and rejects an envelope whose numbers or caveat have been edited by hand.

The corpus is six production repositories spanning TypeScript/Next.js SaaS
applications, a Python data pipeline, a financial research lab, and a
messaging-platform integration — different sizes, doc cultures, and stacks.
They are private client/portfolio projects, so results are reported per-repo
but unnamed.

## Results — v0.32.0 (graph-informed batch)

Read-only runs on five corpus repos, first-run conditions:

| Detector | Findings across corpus | False positives | Verdict |
|:---------|:----------------------:|:---------------:|:--------|
| REF002 — ADR citations in code | 0 (pattern absent) | 0 | Keep — inert where unused, proven on fixtures + self-repo |
| Wikilink validation (XRF001/2) | 0 (evidence gate held) | 0 | Keep — the `.obsidian`/resolution gate prevented every would-be FP |
| Indirect impact (import-graph) | 7 docs flagged across 2 repos | 0 (chains verified by hand) | Keep — e.g. 74 changed files → 6 explainable doc chains |
| graphify interop (TRC002 evidence) | evidence-only by design | n/a — can only *remove* warnings | Keep |

Dogfooding caught two real issues before release:

- **REF002 initially flagged DocGuard's own source** — the validator's doc
  comments used realistic `ADR-012` examples, and test fixtures cited ADRs.
  Fix: non-product scoping (tests/fixtures excluded) + digit-free placeholder
  examples. Shipped with zero self-findings.
- **The semantic-claim extractor ignored `.docguardignore`** — an explicitly
  excluded historical audit contributed 28 of 39 "unverified claims" on
  DocGuard's own repo, burying the actionable ones. Fixed and regression-tested;
  the count dropped to 12, and one of those 12 turned out to be **real drift**
  (a stale suite-runtime claim in TEST-SPEC.md) — found by the tool, fixed in
  the same release.

## Results — v0.31.0 (research-backed batch)

Same method, six-repo corpus. All six detectors shipped default-on after
tuning; the levers that mattered:

- **Diff-Suspicion (DSP001)** needed path/module-only references (basename
  matching flooded), a generic-token filter (HTTP verbs, CSS words), and a
  per-doc cap — one repo's route-inventory doc went from 45 raw findings to a
  capped, reviewable set.
- **Reference-Existence (REF001)** excludes CLI flags and requires the
  two-revision gate (present when the doc was written AND absent now) — the
  two documented false-positive modes from the underlying method
  (arXiv 2212.01479).
- **API-doc-smells (APS001/2)** shipped with the deterministic Bloated/Lazy
  detectors only (reported F1 0.90/0.95 in the source taxonomy) — the
  LLM-dependent smell classes were left out by design.

## Standing verification

- Built-in `node:test`, with Node 18/20/22/24 in the supported CI matrix. Per-change validation records contain measured test totals.
- **Self-guarded:** every push runs all 29 validators against DocGuard's own
  docs; count claims in this README family are machine-governed
  (Canonical-Sync), so the validator count is checked, not remembered.
- **Deterministic core:** no LLM calls at validation time, one pinned
  dependency (`@babel/parser`, with a regex fallback), no network access.

## What we do NOT claim

- **No recall guarantee.** Precision-first means some real drift is missed by
  design; the recall-maximizing variants of these detectors were tested and
  rejected because false-positive floods destroy trust faster than misses do.
- **No arbitrary prose judgment.** Strict `.docguard-evidence.json`
  declarations can verify selected statements against supported local sources.
  Remaining prose correctness and intent are surfaced as agent tasks
  (`verify --semantic`, `diagnose`), never auto-judged.
- **Soft by default.** The v0.31/v0.32 detectors are `confidence: low` and
  emit warnings by default. Exit 2 still fails an ordinary shell step; CI warning policy and severity overrides determine enforcement.

*Method note: corpus runs are point-in-time (repos evolve); each accuracy
release re-runs the sweep. Full per-release detail lives in the
[CHANGELOG](CHANGELOG.md).*
