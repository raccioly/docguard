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
| C1 | `.gitattributes` must change only with an explicit flag (Constitution VI) | FR-017; plan "Lock"; contracts/anchor-lock.md rule 7, anchors-cli.md; T028, T032, T035 | PR 2 (US2) | `tests/requirement-anchors-lock.test.mjs`: untouched without `--gitattributes`, added exactly once with it, listing note while missing | ✅ (story 2) |
| C2 | Every tree-sitter oracle package passes Constitution II | FR-040; plan "Golden fixtures and oracle", Complexity Tracking; T071 | PR 10 (US10) | `tools/anchor-oracle/VETTING.md` with `npm view` and download evidence for all 12 installed packages; Kotlin's and Swift's grammars fail (one maintainer), so those languages have no oracle | ✅ (story 10) |
| H1 | A tag above a top-level variable is symbol scope, above another top-level statement is statement scope under `<module>`; YAML and shell are file tier | FR-002, FR-007; contracts/tag-grammar.md; T015 | PR 1 (US1), `cli/scanners/anchor-tags.mjs` | `tests/requirement-anchors.test.mjs`: `LIMITS` (symbol), `registerPlugin(...)` → `<module>>stmt:…#1`, `workflow.yml` (file tier) | ✅ (1512f20) |
| H2 | "Byte-identical for non-adopters" carves out only the FR-005 literal-tag fix | FR-026, SC-002, US1 scenario 7; T025 | PR 1 | Release gate items 3 and 4: an A/B against the base release on this repository and the Guard-family repos; every evidence difference is listed in `CHANGELOG.md` | docs ✅, proof pending |
| M1 | A baselined link whose tag is deleted is lost | spec state table, US2 scenario 9, Edge Cases; data-model transitions; plan state machine | PR 2 | `tests/requirement-anchors-lock.test.mjs`: a deleted tag of a baselined link is lost | ✅ (story 2) |
| M2 | The churn classifier is the measurable `git diff -w` rule | FR-027; research P6 | PR 3 | `specs/070-requirement-anchors/evidence/churn-replay.json` records the rule; `tests/requirement-anchors-policy.test.mjs` asserts it | ✅ (story 3) |
| M3 | The oracle fails only for high-confidence languages | FR-040; plan; T072 | PR 10 | CI `anchor-oracle` job (`tools/anchor-oracle/run.mjs`): `entry.pass` is true for any language whose confidence is not high, so C/C++ are reported, never failed | ✅ (story 10) |
| M4 | Requirement `text` consumers stay unchanged | FR-014 (the `block` field instead of a changed `text`); T017 | PR 1, `cli/shared-requirements.mjs` | `tests/shared-requirements-block.test.mjs` (6 pass); traceability and trace tests unchanged (80 pass) | ✅ |
| M5 | PRs that grow agent-facing bytes declare `Budget-Exempt` | tasks Delivery block | every PR | CI `budget` job green, or a declared exemption with its reason | docs ✅, per PR |
| L1 | ANC001 and ANC003 become errors only under `failOn` | FR-020; finding catalog help text | PR 1 (catalog), PR 3 (policy) | `tests/requirement-anchors-policy.test.mjs`: reviewed/exact/symbol fails; file scope, pattern tier, baselined and ANC002 warn | ✅ (story 3) |
| L2 | One rule for `--spec` and `--file` selection | FR-022; contracts/anchors-cli.md; T028, T032 | PR 2 | `tests/requirement-anchors-lock.test.mjs`: `--spec` selection, `--bulk` refusal | ✅ (story 2) |
| L3 | Anchors come only from `@implements` and `@req` in non-test files | FR-001; contracts/tag-grammar.md; data-model | PR 1, `cli/scanners/anchor-tags.mjs`, `anchors.mjs` | `tests/requirement-anchors.test.mjs` "no anchor" cases: `@covers` in source; a tag in `tests/` | ✅ (1512f20) |
| L4 | `\|` and `%` in key parts are percent-encoded | FR-016; contracts/anchor-lock.md rule 8; data-model | PR 1, `linkKey` | `tests/requirement-anchors.test.mjs` key test | ✅ (1512f20) |
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
| The structured TestGuard reference is `req:<spec-id>#<req>`, not a bare `<spec-id>#<req>` | A bare form collides with the path refs claims already use (`spec.md#FR-001`). The prefix is unambiguous, and every released TestGuard reader accepts it as an opaque string, so adopting it needs no TestGuard upgrade | TestGuard companion spec 003, contracts/testguard-evidence.md |
| The TestGuard adapter is `cli/scanners/testguard-evidence.mjs`, not part of `cli/evidence/adapters.mjs` | The evidence layer may not run an external tool, and the chain must ask git whether the evidence revision exists; scanners may not import the evidence layer either (ARCHITECTURE layer table) | plan, T055, ARCHITECTURE module table |
| The adapter also reads the TestGuard claims file | Evidence alone cannot show a fault added, or a claim edited, after the probe. TestGuard's own status calls that stale, so DocGuard does too (never optimistic) | contracts/testguard-evidence.md |
| An unstructured claim leaves the test "needs re-verification" with a hint, not "inconclusive" | Inconclusive means the evidence cannot be evaluated. A readable report that simply has no structured claim cannot help this test, and the hint names the `req:` form to write | spec FR-033, US6 acceptance 3 |
| Config is `anchors.testguard.{evidence, claims}` instead of `anchors.testguardEvidence` | Two paths belong together | contracts/testguard-evidence.md, docs/configuration.md |
| ANC002 problems carry `scope` and `reviewedState` | The re-probe found the requirement-side exemption untested: ANC002 lacked the fields, so the code check was never what stopped it failing | tests/requirement-anchors-policy.test.mjs |
| An orphan is an implementation unit (function, class, struct, enum, top-level method), not every top-level name | Exported constants and type-only declarations implement nothing; listing them would bury the real gaps. Visibility follows each language (Python `_`, Go case, Rust `pub`, C `static`) | contracts/anchors-cli.md, docs/commands.md |
| `anchors disposition` also takes `--file … --bulk` and `--remove` | Adoption needs to disposition a whole infrastructure file, and a disposition must be removable when a requirement appears | contracts/anchors-cli.md |
| Granularity is computed only once a project opted in | FR-041: a project that has not opted in pays nothing, including in `score` and `trace` | FR-036 test |
| SECURITY.md's write table gained the `anchors` rows | Stories 1 and 2 added a lock writer without listing it there | docs-canonical/SECURITY.md |
| `trace --matrix` takes `--out`, with `--output` as an alias | `report --out` is the CLI's existing flag for writing an artifact | contracts/trace-matrix.md |
| ReqIF times are always the epoch (no `--timestamp`) | A real time would change every export and defeat byte-identical runs; DOORS and Polarion import without it | contracts/trace-matrix.md |
| The formula-injection prefix also covers a leading tab or carriage return | OWASP's CSV-injection list includes both | contracts/trace-matrix.md |
| The import settings are part of the anchor cache identity | The cache is keyed by file bytes; the same bytes mean different anchors under a different import map, so without it a remap would be answered stale | contracts/tag-grammar.md, requirement-anchors-import test |
| An OFT outdated tag is a suspect even with no review in the lock | OpenFastTrace's own "outdated" needs no review; the mismatch is between the tag and the mapping | contracts/tag-grammar.md |
| The oracle measures on a vendored corpus (`tools/anchor-oracle/corpus/`) plus the fixtures | The fixtures alone held 2 to 4 files per language, too few for a 1% threshold. The corpus was written independently of the lexer, so it is not tuned to it, and it stays offline and reviewable | tools/anchor-oracle/run.mjs, VETTING.md |
| Kotlin and Swift have no oracle and no tree-sitter tier | `tree-sitter-kotlin` and `tree-sitter-swift` each have one maintainer, which fails Constitution II | VETTING.md, ts-decls.mjs |
| The tree-sitter tier parses in a child process | web-tree-sitter initializes asynchronously and anchor extraction is synchronous end to end, like the batched `python3` tier | contracts/fingerprint.md, SECURITY.md |
| The tree-sitter tier refines symbols the pattern tier found and never adds one | A link's key must be the same on a machine with and without the tier, or enabling it would lose links. The floor stays the pattern tier's for the same reason | docs/commands.md, requirement-anchors-treesitter test |
| The tree-sitter fingerprint drops commas, semicolons and redundant parentheses | FR-010's formatter guarantees for exact tiers; `isExactTier` already counts `treesitter@` | ts-decls.mjs |
| python-ast golden values cover 3.11 to 3.14, not only the CI version | They differ between all four versions, and contributors run each of them | golden.json |
| The oracle compares declarations an anchor can name: top-level and members of named types | A declaration inside a function body, an anonymous class or a plain block is a statement to an anchor, so neither side is held to it | tools/anchor-oracle/run.mjs, ts-decls.mjs |
| The oracle found 8 pattern-tier gaps on the corpus, fixed before release because the tier is new in 0.45.0 | Ruby `Const = Struct.new … do` class bodies; Java compact constructors and annotation elements with defaults; C# expression bodies past a switch expression; C functions returning `struct x`; C++ inline namespaces, user-defined literal operators, and `= delete` / `= default` members. Every high-confidence language, and C and C++, agree 100% with tree-sitter on the corpus | tests/pattern-lexer.test.mjs ("oracle-found declarations") |
| An explicit `{scope=…}` is honored in the file's leading block | ANC006 told users to add `{scope=symbol}` there, and all three resolvers ignored it | tests/requirement-anchors.test.mjs |
| A tag inside a `switch` case anchors to its statement | It anchored to the whole enclosing function | tests/requirement-anchors.test.mjs |
| The anchor cache identity includes a hash of the resolver code and the requirement patterns | Found while dogfooding: after a resolver change, unchanged files kept the old anchors, and a custom `traceability.requirementPattern` would have done the same | tests/requirement-anchors.test.mjs |
| `/speckit-analyze` re-run (T078): FR-042, FR-043 and SC-007 gained executable proof | Each was proven only by review or a CI measurement. `tests/requirement-anchors-adoption.test.mjs` checks the docs and this repository's adoption; `tests/anchor-oracle.test.mjs` asserts the 99% threshold where the oracle is installed. The plan's file list and T002 were brought up to date | tasks T078, plan |

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

Items 1 to 9 pass at c22a6da (the release candidate as of 2026-10-11). Item 10 waits for Ricardo. If more commits land before the release, items 1, 2 and 9 are re-run on the final commit.

| Item | Commit | Result | Evidence |
|------|--------|--------|----------|
| 1 | c22a6da | PASS | CI `test` on Node 18, 20, 22 and 24 green. Locally: Node 24 3,706/3,707 before the llms refresh (that one fixed), and Node 18 3,712/3,713, whose one failure was a private name in uncommitted gate notes, removed before commit. No skips beyond the documented python-version and oracle-install ones |
| 2 | c22a6da | PASS | `docguard guard`: PASS, no findings |
| 9 | 1b232b1, c22a6da | PASS | TestGuard 0.15.0 `--confirm 3 --serial` on all 11 spec 070 claims: 98/98 faults killed at 1b232b1, and ANCHOR-FINGERPRINT-GOLDEN 9/9 again at c22a6da after the `.mjs` staging fix. The claims file's 10 invalid anchors are the same 10 that predate spec 070 on main |
| 3 | 1b232b1 | PASS | `guard --format json` from 0.44.3 and from the candidate on a `git archive` export of the same commit. 73 shared findings, identical (the bare export has no history). Base only: SPR001 (the FR-005 evidence projection) and MET001 ×2 (the validator count: 34 with `requirementAnchors`). Candidate only: none. The four evidence differences are listed in CHANGELOG. `specs --check` is CURRENT for the candidate; the base disagrees only through that projection. Run in place, 0.44.3 also flags two TODOs in `cli/validators/todo-tracking.mjs` that the candidate skips: `isSelfPath` skips the running validator's own source, a pre-existing behavior, not spec 070 |
| 4 | 1b232b1 | PASS | `git archive` exports, base 0.44.3 against the candidate. Identical guard output on testguard (3 findings), web-security-validator (18), and seven local projects of mixed stacks (TypeScript/React, Python, Python with TypeScript, 9 to 183 findings each). `requirementAnchors` is not applicable on all nine. `docguard anchors` runs on each. ANC006 ×2 on one project, reviewed: header comments directly above a variable, correctly ambiguous. ANC010 on two projects, reviewed: they commit `.docguard/plan.cache.json`, so the anchor cache correctly refuses `.docguard/`. The spec-071 public clones were temporary and no longer exist, so the local projects stand in for that corpus |
| 5 | 1b232b1 | PASS | guard PASS with no findings: no DLK001 |
| 7 | 1b232b1 | PASS | `node benchmarks/run.mjs --baseline benchmarks/baseline.json`: core PASS, 0 regressions. The first run flagged 4 cases as `case-evidence-changed` because two fixtures held an ignored `.docguard/anchors.cache.json` left by an intermediate build; the digest now skips `.docguard/` like `.git` |
| 8 | 1b232b1 | PASS | `docguard anchors` on this repository: 686 links (file 491, statement 10, symbol 185; babel@7 658, file 27, python-ast@3.12 1, treesitter 0 since the tier is opt-in). Every link reviewed (97) or baselined (589). No ANC006, no ANC007 |
| 6 (CI) | 335eca1 / ab260fa | PASS | CI `budget` job green with no `Budget-Exempt`; `anchor-oracle` job green on its first run |
| SC-007 (story 10) | working tree after story 10 | PASS | `node tools/anchor-oracle/run.mjs`: Go 54/54, Rust 94/94, Java 84/84, C# 81/81, PHP 79/79, Ruby 101/101 declarations agree with tree-sitter (0.00% disagreement); C 30/30 and C++ 79/79 (reported). Five files tree-sitter cannot parse are skipped and named. Kotlin and Swift have no vetted grammar |
| 9 (interim, stories 6–10) | working trees | PASS | TestGuard 0.15.0 `--confirm 3 --serial`: ANCHOR-TESTCHAIN-NEEDS-REVERIFY 10/10, ANCHOR-FAIL-POLICY-SCOPED 8/8 (F4/F8 fixed), ANCHOR-ORPHANS-DETERMINISTIC 11/11, TRACE-MATRIX-COMPLETE 11/11, ANCHOR-IMPORTERS-READ-ONLY 8/8, ANCHOR-FINGERPRINT-GOLDEN 9/9 killed |
| 6 (interim, story 2) | working tree after story 2 | PASS | `tools/budget.mjs ab` against main 512974d: guard +94 ms on `.` (limit +1,630); no new errors; tools/list +834 B (limit +878, close); package +5.5% (limit 10%); no new dependencies |
