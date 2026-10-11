# Remediation and Release Gate: Requirement Anchors

**Purpose**: track every `/speckit-analyze` finding (2026-10-11) from the
artifacts through code to a passing test, and define what must be proven on
this repository before any release that contains spec 070.
**Feature**: [spec.md](../spec.md)
**Delivery**: every story lands as commits on `feat/requirement-anchors`, and
all of them ship in ONE release (0.45.0). "PR n" means story n's commit
series.

A finding is closed only when all of these columns are filled: **Docs** (the
spec, plan, contract and tasks state it), **Code** (merged), and **Proof** (a
named test or recorded measurement that fails without it).

## Analysis findings

| ID | Finding | Docs | Code (PR) | Proof | Status |
|----|---------|------|-----------|-------|--------|
| C1 | `.gitattributes` must change only with an explicit flag (Constitution VI) | FR-017; plan "Lock"; contracts/anchor-lock.md rule 7, anchors-cli.md; T028, T032, T035 | PR 2 (US2) | T028: untouched without `--gitattributes`, added exactly once with it, listing note while missing | docs ✅, code pending PR 2 |
| C2 | Every tree-sitter oracle package passes Constitution II | FR-040; plan "Golden fixtures and oracle", Complexity Tracking; T071 | PR 10 (US10) | `tools/anchor-oracle/VETTING.md` with `npm view` and download evidence per package; a failing grammar leaves its language "no oracle" | docs ✅, code pending PR 10 |
| H1 | A tag above a top-level variable is symbol scope, above another top-level statement is statement scope under `<module>`; YAML and shell are file tier | FR-002, FR-007; contracts/tag-grammar.md; T015 | PR 1 (US1), `cli/scanners/anchor-tags.mjs` | `tests/requirement-anchors.test.mjs`: `LIMITS` (symbol), `registerPlugin(...)` → `<module>>stmt:…#1`, `workflow.yml` (file tier) | docs ✅, code ✅, proof pending lexer |
| H2 | "Byte-identical for non-adopters" carves out only the FR-005 literal-tag fix | FR-026, SC-002, US1 scenario 7; T025 | PR 1 | Release gate items 3 and 4: an A/B against the base release on this repository and the Guard-family repos; every evidence difference is listed in `CHANGELOG.md` | docs ✅, proof pending |
| M1 | A baselined link whose tag is deleted is lost | spec state table, US2 scenario 9, Edge Cases; data-model transitions; plan state machine | PR 2 | T028 scenario 9 for a baselined link and a reviewed one | docs ✅, code pending PR 2 |
| M2 | The churn classifier is the measurable `git diff -w` rule | FR-027; research P6 | PR 3 | `tools/anchor-churn-replay.mjs` output records the rule it applied | docs ✅, code pending PR 3 |
| M3 | The oracle fails only for high-confidence languages | FR-040; plan; T072 | PR 10 | CI `anchor-oracle` job: C/C++ disagreement reported, never failed | docs ✅, code pending PR 10 |
| M4 | Requirement `text` consumers stay unchanged | FR-014 (the `block` field instead of a changed `text`); T017 | PR 1, `cli/shared-requirements.mjs` | `tests/shared-requirements-block.test.mjs` (6 pass); traceability and trace tests unchanged (80 pass) | ✅ |
| M5 | PRs that grow agent-facing bytes declare `Budget-Exempt` | tasks Delivery block | every PR | CI `budget` job green, or a declared exemption with its reason | docs ✅, per PR |
| L1 | ANC001 and ANC003 become errors only under `failOn` | FR-020; finding catalog help text | PR 1 (catalog), PR 3 (policy) | `tests/requirement-anchors-policy.test.mjs` (T037) | catalog ✅, policy pending PR 3 |
| L2 | One rule for `--spec` and `--file` selection | FR-022; contracts/anchors-cli.md; T028, T032 | PR 2 | T028 selection case | docs ✅, code pending PR 2 |
| L3 | Anchors come only from `@implements` and `@req` in non-test files | FR-001; contracts/tag-grammar.md; data-model | PR 1, `cli/scanners/anchor-tags.mjs`, `anchors.mjs` | `tests/requirement-anchors.test.mjs` "no anchor" cases: `@covers` in source; a tag in `tests/` | docs ✅, code ✅, proof pending lexer |
| L4 | `\|` and `%` in key parts are percent-encoded | FR-016; contracts/anchor-lock.md rule 8; data-model | PR 1, `linkKey` | `tests/requirement-anchors.test.mjs` key test | docs ✅, code ✅, proof pending lexer |
| L5 | The budget check cites SC-003 | T025, T036 | every PR | CI `budget` job | ✅ |

### Changes made while implementing (recorded, not silent)

| Change | Why | Where recorded |
|--------|-----|----------------|
| FR-014 adds a `block` field instead of rewriting `text` | Both `text` consumers (the TF-IDF hint and preflight overlap detection) would change behavior | spec FR-014, plan, T017, ARCHITECTURE `requirement-identity` |
| ANC004 and ANC006 are listed by `docguard anchors` only | Guard findings support `error` and `warn` only; this also keeps guard quieter | spec FR-020 |
| FR-009 tree-sitter loads by manifest hash, not by install location | Hash pinning is what makes the code safe; a global install's layout is not predictable | spec FR-009, US10, research P7 |
| Requirement docs collector moved to `cli/scanners/requirement-docs.mjs` | A scanner may not import a validator (Constitution IV) | ARCHITECTURE module table |
| The pattern tier is a self-contained tokenizer (`cli/scanners/pattern-lexer.mjs`) instead of an extension of `lexCLike` | `lexCLike` masks literals and drops comments; the anchors need comment records, raw, verbatim and interpolated strings, and per-language statement ends. `route-lexing.mjs` and the route readers stay untouched (a parallel spec, 071, owns them) | plan, T014 |
| Python's pattern tier emits indent/dedent markers | Re-indenting keeps the floor; moving a statement out of a block changes it | contracts/fingerprint.md |

## Release gate

No release containing spec 070 is cut until every item below is checked for
the exact commit being released. The results are recorded under
"Gate results", so the claim can be audited.

1. `npm test`: the whole suite passes, with zero skipped tests other than the
   documented python-version skips.
2. `docguard guard` on this repository: PASS, with no error or warning findings
   that the base release does not report.
3. **A/B on this repository.** Run `guard --format json` from the base release
   and from the candidate, on the same commit of this repository. The findings
   must be identical, except for:
   - the new validator entry;
   - the listed FR-005 evidence differences.

   `specs --check` must be CURRENT on both.
4. **A/B on other real projects**, exported with `git archive` into temporary
   directories so nothing in them changes:
   - testguard;
   - websec-validator;
   - the spec-071 route corpus.

   Guard output must not change, because no project there has opted in to
   anchors. `docguard anchors` must run without error on each, and its ANC006
   and ANC007 output must be reviewed by hand.
5. **Doc lock.** Every `.docguard-doc-lock.json` entry is current, or was
   re-accepted with a reason that names the spec 070 change.
6. **CI `budget` job.** Guard wall time stays within ×1.15 of base, there are
   no new error findings, and package weight and runtime dependencies are
   unchanged. Any agent-bytes growth is declared.
7. **Precision benchmark.** `npm run benchmark` matches its committed
   baselines.
8. **Dogfood.** `docguard anchors` on this repository:
   - every ANC007 is fixed or explained;
   - every link's tier is the exact tier wherever a parser exists;
   - the counts by scope and tier are recorded.
9. **TestGuard.** Each story's claim is probed with `--confirm 3 --serial` and
   gated.
10. Ricardo asks for the release in the session that cuts it.

### Gate results

| Item | Commit | Result | Evidence |
|------|--------|--------|----------|
| | | | |
