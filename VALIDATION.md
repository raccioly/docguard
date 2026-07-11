# Validation — how DocGuard's detectors earn their defaults

DocGuard's detection claims are tested against **real production repositories
before every accuracy release**, not just against unit-test fixtures. This page
documents the method and the measured results, in the spirit of an honest
benchmarks page: what we measured, what we found, and what we do *not* claim.

## The method

Every new detector goes through the same pipeline before it ships enabled:

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

- **969 tests**, zero test dependencies (`node:test`), Node 18/20/22 CI matrix.
- **Self-guarded:** every push runs all 27 validators against DocGuard's own
  docs; count claims in this README family are machine-governed
  (Canonical-Sync), so "27 validators" is checked, not remembered.
- **Deterministic core:** no LLM calls at validation time, one pinned
  dependency (`@babel/parser`, with a regex fallback), no network access.

## What we do NOT claim

- **No recall guarantee.** Precision-first means some real drift is missed by
  design; the recall-maximizing variants of these detectors were tested and
  rejected because false-positive floods destroy trust faster than misses do.
- **No LLM-grade semantic judgment.** Claims a regex cannot verify (prose
  correctness, intent) are surfaced as agent tasks (`verify --semantic`,
  `diagnose`), never auto-judged.
- **Soft by default.** The v0.31/v0.32 detectors are `confidence: low` and
  never break CI — they exist to direct human/agent attention, not to gate.

*Method note: corpus runs are point-in-time (repos evolve); each accuracy
release re-runs the sweep. Full per-release detail lives in the
[CHANGELOG](CHANGELOG.md).*
