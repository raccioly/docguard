# Implementation Plan: Requirement Anchors and Suspect Links

**Branch**: `feat/requirement-anchors` (one PR per user story; each later PR uses a branch `feat/requirement-anchors-usN`) | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/070-requirement-anchors/spec.md`

## Summary

The fingerprinting inside `cli/scanners/doc-deps.mjs` moves into a shared
module, `cli/scanners/fingerprint.mjs`. That module serves both the doc lock,
whose algorithm stays the same, and a new requirement-anchor pipeline:

1. **Tag extraction.** A string-aware comment pass reads the tags.
   `cli/scanners/anchor-tags.mjs` resolves each tag to a file, symbol,
   statement or route anchor through three tiers: Babel for JS/TS, one
   batched `python3` process for Python, and a self-checking pattern lexer for
   ten other languages.
2. **Fingerprinting.** Each anchor gets an exact fingerprint and a pattern
   floor fingerprint, and the requirement block it cites gets a requirement
   fingerprint.
3. **Comparison.** `cli/scanners/anchors.mjs` compares the fingerprints with a
   new committed JSON Lines lock (`.docguard-anchor-lock.jsonl`, `merge=union`)
   and derives a state per link.
4. **Reporting and writing.** A new validator reports ANC001–ANC010. A new
   `docguard anchors` command lists links and writes the lock: `accept`,
   `--baseline`, `--remove`, `disposition`. Writes go through
   `commitFileTransaction`.

The later stories build on that link set:

- rename carry-over;
- name-filtered ripple, reusing the reverse-import walk moved out of
  `impact.mjs`;
- a TestGuard saved-report adapter;
- the orphan inventory;
- CSV and ReqIF export;
- StrictDoc and OpenFastTrace importers;
- golden fixtures and a CI-only tree-sitter oracle.

Every story is warn-only until the US3 replay evidence turns the failure
policy on.

## Technical Context

**Language/Version**: JavaScript ES modules on Node.js ≥ 18. Python 3.8+
(`ast` with `end_lineno`, plus `tokenize`) when available.

**Primary Dependencies**: none new. `@babel/parser` stays optional. The
tree-sitter oracle lives in `tools/anchor-oracle/`, has its own lockfile, and
is installed only in CI with `npm ci --ignore-scripts`. It is not in `files`,
so it never ships.

**Storage**:
- `.docguard-anchor-lock.jsonl`, tracked: reviewed state, one entry per line.
- `.docguard/anchors.cache.json`, untracked: a per-file extraction cache.

**Testing**: `node:test` fixtures under `tests/fixtures/anchors/` (golden
fingerprints per language and tier); `tests/requirement-anchors*.test.mjs`; the
CI oracle job; the replay tool `tools/anchor-churn-replay.mjs`.

**Target Platform**: the DocGuard CLI, MCP (read-only listing), the GitHub
Action and the Spec Kit extension.

**Project Type**: CLI.

**Performance Goals**:
- The text pre-filter costs about 0.002 ms per file.
- Only tagged files and files named in the lock are parsed, each once per run.
- One Python process per run.
- Guard wall time stays within the non-regression budget (×1.15).

**Constraints**:
- No network, no LLM, and no git history needed for comparison.
- `.docguard-specs.json` and `.docguard-doc-lock.json` keep their shapes.
- Output for non-adopters is byte-identical (FR-026).

**Scale/Scope**:
- This repository: 664 implementation tags, 177 files, 62 specs.
- Enterprise target: 50k files with about 5% tagged, at about 2.5 s on a cold
  run (measured extrapolation, research §3) and O(changed files) when warm.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I (LLM-first) | `anchors --format json` is the contract. Every finding carries a stable code. An MCP read-only `docguard_anchors` tool lists links. |
| II (dependencies) | No runtime or dev dependency is added. Babel and `python3` stay optional, and extraction degrades to the pattern or file tier with a finding. The oracle is a CI-only tool outside `files`, locked with integrity hashes, with install scripts off. The user-side tree-sitter tier loads only hash-matched artifacts (FR-009). |
| III (docs as truth) | ARCHITECTURE and DATA-MODEL document the lock, tiers and states before release. Any deviation is logged in DRIFT-LOG. |
| IV (validator isolation) | `validators/requirement-anchors.mjs` imports only `scanners/anchors.mjs` and the shared modules. The reverse-import walk moves from `commands/impact.mjs` to `scanners/import-graph.mjs`, so no scanner imports a command. |
| V (no prose, no LLM) | The lock holds hashes, states and the user's reasons. Orphans and dispositions propose no text. |
| VI (safe writes) | Every lock write goes through `commitFileTransaction`. `.gitattributes` changes only with the explicit `--gitattributes` flag, in the same transaction. `trace --matrix --output` uses `safeWrite`. |
| VII (Spec Kit) | The extension gets a read-only `speckit.docguard.anchors` command. `extension.yml` stays schema-valid. |
| VIII (local-first) | No network. The TestGuard evidence is a local saved report. |
| IX (honest assurance) | Every link and finding reports its tier, confidence and state. Baselined links are never counted as reviewed. Output states that DocGuard authenticates no reviewer. |
| X (spec-first) | This spec. Each PR names `specs/070-requirement-anchors`. |

**Gate result: PASS.** Complexity Tracking justifies the CI-only oracle
package.

## Project Structure

### Documentation (this feature)

```text
specs/070-requirement-anchors/
├── spec.md
├── plan.md              # this file
├── research.md          # investigations + plan-phase decisions
├── data-model.md        # tags, anchors, links, lock, states, fingerprints
├── quickstart.md        # runnable validation per story
├── contracts/
│   ├── anchors-cli.md          # command, flags, exit codes, JSON output
│   ├── anchor-lock.md          # lock line format and merge rules
│   ├── tag-grammar.md          # tag, scope block, positional rules, importers
│   ├── fingerprint.md          # normalization rules, versions, tiers
│   ├── trace-matrix.md         # CSV columns and ReqIF mapping
│   └── testguard-evidence.md   # adapter input contract
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source code

```text
cli/scanners/fingerprint.mjs        # NEW  shared: algorithms (doclock-v0 legacy, anchor v1), JS AST normalizer, python batch, floor, directive allowlist
cli/scanners/pattern-lexer.mjs      # NEW  comment-collecting, string-aware lexers per family; symbol finder; brace self-check; Go terminators
cli/scanners/py-anchors.mjs         # NEW  one batched python3 run: ast spans/qualnames/decorators/docstrings via end_lineno + tokenize comments + _fields serializer
cli/scanners/anchor-tags.mjs        # NEW  tag grammar, scope block, positional scope resolution, qualified paths, importers (US9)
cli/scanners/anchor-lock.mjs        # NEW  JSONL lock read/validate/serialize, duplicate-key detection
cli/scanners/anchor-cache.mjs       # NEW  per-file cache in .docguard/ (trusted only off-CI and untracked)
cli/scanners/anchors.mjs            # NEW  link set, requirement fingerprints, state machine, carry-over (US4), ripple (US5), test chain (US6), orphans (US7)
cli/scanners/doc-deps.mjs           # CHANGED  delegate to fingerprint.mjs (doclock-v0); batched python; nested lookup; interpreter-change disambiguation
cli/scanners/requirement-evidence.mjs # CHANGED  comment extraction via anchor-tags (string-aware, FR-005)
cli/shared-requirements.mjs         # CHANGED  full requirement block text (FR-014)
cli/scanners/import-graph.mjs       # CHANGED  export reverseImportAncestors + hub rule (moved from impact.mjs)
cli/commands/impact.mjs             # CHANGED  import the moved walk; behavior unchanged
cli/validators/requirement-anchors.mjs # NEW ANC001–ANC010
cli/commands/anchors.mjs            # NEW  list / accept / --baseline / --remove / disposition / --orphans
cli/commands/specs.mjs              # CHANGED  SPC007 exemption for the completing spec's own anchor findings (FR-029)
cli/commands/trace.mjs              # CHANGED  --matrix csv|reqif (US8), granularity (US7)
cli/writers/trace-matrix.mjs        # NEW  deterministic CSV + ReqIF 1.2 serializer (no deps)
cli/commands/score.mjs              # CHANGED  granularity info (FR-036)
cli/evidence/adapters.mjs           # CHANGED  testguard-evidence adapter (US6)
cli/commands/mcp.mjs                # CHANGED  read-only docguard_anchors tool
cli/commands/guard.mjs              # CHANGED  register validator; changed-only support
cli/config.mjs                      # CHANGED  anchors.{enabled,failOn,orphanPaths,import,importMap,treeSitter,fanOutLimit}
cli/findings.mjs                    # CHANGED  ANC001–ANC010 catalog entries
cli/docguard.mjs                    # CHANGED  command, help, flags
schemas/docguard-anchor-lock.schema.json      # NEW
schemas/docguard-anchor-treesitter.manifest.json # NEW pinned artifact hashes (US10)
tools/anchor-churn-replay.mjs       # NEW  US3 replay
tools/anchor-oracle/{package.json,package-lock.json,run.mjs} # NEW CI-only (US10)
.github/workflows/ci.yml            # CHANGED  anchor-oracle job (US10)
.gitattributes, .github/CODEOWNERS  # NEW/CHANGED  dogfood (FR-043)
.docguard-anchor-lock.jsonl         # NEW  this repo's baseline (US2) and reviews
tests/fixtures/anchors/**           # NEW  per-language fixtures + golden fingerprints
tests/requirement-anchors.test.mjs  # NEW  US1–US3
tests/requirement-anchors-*.test.mjs # NEW  per later story
extensions/spec-kit-docguard/commands/anchors.md # NEW read-only
docs-canonical/{ARCHITECTURE,DATA-MODEL,SECURITY,TEST-SPEC,CI-RECIPES,REQUIREMENTS}.md, README.md, docs/commands.md, docs/configuration.md, docs/reference/findings.md (generated), llms*.txt (generated), CHANGELOG.md
testguard.claims.json               # claims per story (house practice)
```

**Structure decision**: the existing single-project layout. Scanners hold
every computation, the validator only reports, and the command is the only
writer. This mirrors spec 030 exactly.

## Design notes

### Shared fingerprint module (US1, FR-015)

- `fingerprint.mjs` exposes algorithms by ID:
  - **`doclock-v0`** is the current doc-deps algorithm, byte-for-byte: a JSON
    of the Babel node without metadata, including the name, and `ast.dump`.
    The doc lock keeps using it, and its tier labels (`ast`, `python-ast`,
    `content`, `glob`) do not change. So every entry in
    `.docguard-doc-lock.json` stays current, and the doc-lock schema is
    untouched (FR-015, FR-017).
  - **`v1`** is the anchor algorithm. JS: the normalized Babel node minus the
    declaration's own identifier, plus the allowlisted directive comments
    inside the span, in source order. Python: a `_fields` walk that omits
    `name`, the docstring `Expr` and empty defaults, plus `# type: ignore` and
    `# noqa` comments taken from `tokenize`.
  - **Floor**: the pattern-tier token stream of the span (comments dropped
    except directives; terminator tokens for Go), hashed. Computed for every
    anchor, including JS/TS and Python, from DocGuard's own lexer.
- Fingerprint string: `dg1:sha256:<hex>`. The tier is stored beside it:
  `babel@7`, `python-ast@3.12`, `pattern@1`, `treesitter@<grammar-hash8>`,
  `file`.
- **Python interpreter change in the doc lock**: a `python-ast` mismatch
  re-fingerprints the symbol at `reviewedRevision` with today's interpreter
  (`fileContentAtRev`). If that equals today's fingerprint, the code did not
  change: report unverifiable ("interpreter changed"), never DLK001. If the
  revision is not available, keep DLK001 and add a note.
- Python batching: one `python3 -c` per run receives `{files:[…], symbols:{…}}`
  on stdin and returns spans, comments and both serializations. This replaces
  the per-symbol spawn at doc-deps.mjs:177-198.

### Tag extraction and scope (US1, FR-001–FR-008)

- **Comment pass**:
  - JS/TS: Babel `ast.comments`, which already excludes strings, templates
    and regex literals.
  - Python: `tokenize` COMMENT tokens plus docstring nodes.
  - Pattern languages: `pattern-lexer.mjs` extends `lexCLike` with
    `collectComments: true`. Comment spans are recorded instead of only
    masked. It adds `lexRust` (raw strings `r#"…"#`, byte strings, lifetimes
    vs. character literals) and reuses `lexCSharp`, `lexPhp` and the Sinatra
    Ruby tokenizer.
  - `requirement-evidence.mjs` switches to this pass, which is the FR-005
    fix. Files with no parser fall back to today's tokenizer, made
    string-aware for `"`, `'` and backtick.
- **Positional rules (FR-002)** apply to the comment's end line and the next
  significant token:
  1. The leading block ends at the first token that is not a comment. If that
     token begins an import or require, or another comment follows, the tag is
     file scope.
  2. If the token is a declaration with no blank line, the tag is symbol
     scope. Declarations are `function`, `class`, a top-level variable
     declaration with any initializer, `def`, `fn`, `func`, and a method
     signature at class-body depth. Decorators and annotations are skipped
     first. A tag above any other top-level statement is statement scope under
     `<module>`.
  3. A leading block directly above a declaration with no import in between is
     ambiguous: file scope plus ANC006.
  4. Inside a function body above a statement, the tag is statement scope. If
     a route extractor recognises the statement (`expressRouteBindings`,
     `python-routes`, `go-routes`, and so on), it is route scope with
     `route:<METHOD> <path>`.
- **Qualified paths**:
  - JS: `Class.method`, with `default` for default exports.
  - Python: a qualname-like `Outer.inner`.
  - Pattern tier: enclosing type or `impl` blocks, e.g. `impl From<A> for Id`
    gives `Id.from<From<A>>`.
  - Collisions get `name(sig)` where the tier reads parameter types, else
    `name#2`. Still ambiguous means file scope plus ANC006.
- **Statement anchor identity**: `<enclosing symbol>>stmt:<REQ>#<n>`, where `n`
  is the ordinal among statement tags for the same requirement inside the same
  enclosing symbol. Adding untagged statements never changes the key
  (research P3).
- **Self-check (FR-008)**: after `matchPairs`, any unpaired delimiter in the
  file switches every tag in that file to file scope, with ANC006 naming the
  reason. A symbol's span is the paired closing token. It never runs to the
  end of the file.

### Requirement fingerprints (US2, FR-014)

- `shared-requirements.mjs` returns `text` as the whole block: lines through
  the next requirement declaration, a heading, or a list item at the same or
  shallower indent.
- The registry stores IDs only (`intent.requirements` holds strings), so the
  projection is unchanged.
- The normalized form (NFC, `\n`, collapsed whitespace) is hashed with the
  outcomes block and review stamps stripped. This reuses `spec-outcomes.mjs`
  and `spec-registry.mjs:48-50`.
- Canonical requirements (`docs-canonical/REQUIREMENTS.md#FR-024`, spec 027)
  are fingerprinted the same way.

### Lock (US2, FR-016–FR-018, FR-022–FR-025)

- `.docguard-anchor-lock.jsonl`:
  - Line 1 is the header `{"kind":"docguard-anchor-lock","schemaVersion":1}`.
  - Every other line is one entry, with sorted keys. See
    [contracts/anchor-lock.md](contracts/anchor-lock.md).
  - The reader tolerates any line order, which a union merge can produce. The
    writer re-sorts.
  - A duplicate key with differing content means both entries are treated as
    absent for comparison: the link is suspect, plus ANC009.
- **Accept**:
  1. Compute fingerprints for the selection.
  2. Read the files again and refuse if the bytes changed during the run
     (TOCTOU).
  3. Build entries that include `prev`, the replaced fingerprints.
  4. In one `commitFileTransaction`, write the lock. The validate hook
     re-reads and validates it. With `--gitattributes`, the same transaction
     also appends `.docguard-anchor-lock.jsonl merge=union` to `.gitattributes`
     when the line is absent. Without the flag, `.gitattributes` is never
     touched (Constitution VI). Listing shows a note with the exact line
     whenever it is missing.
- `--bulk` is required when the selection is larger than one link. Each entry
  records `"bulk": true`.
- `--baseline` implies `--bulk` and writes `"state": "baselined"`.
- `--remove <key>` deletes the entry. It is allowed for any state and needs a
  reason, which goes into the transaction log output (no entry remains to
  carry it).

### State machine (FR-019, FR-030)

| Lock entry | Anchor resolves | Requirement exists | Code fp equal | Req fp equal | State |
|---|---|---|---|---|---|
| none | yes | yes | — | — | unreviewed |
| baselined or reviewed | yes | yes | yes | yes | baselined or reviewed |
| any | yes | yes | no | — | suspect (code) |
| any | yes | yes | — | no | suspect (requirement) |
| baselined or reviewed | no | yes | — | — | moved, if exactly one unreviewed same-requirement link has the same v1 fp; else lost |
| any | — | retired or superseded | — | — | retired-target |
| any | tier comparison impossible | — | — | — | unverifiable |

How "code fp equal" is decided:
- Same exact tier on both sides: compare the exact fingerprints.
- Different tiers: compare the floors. Equal floors mean current, plus info
  "tier changed".
- Different algorithm version: recompute under the stored version if it is
  still supported, else unverifiable.

### Failure policy (US3, FR-027–FR-029)

- `tools/anchor-churn-replay.mjs --commits 100`:
  - Walks first-parent history and reads blobs with `git show` (no checkout).
  - Baselines at the start revision and computes states at each commit.
  - Classifies each flag as formatting-only when the symbol's text at both
    revisions is identical after removing whitespace and comments, i.e. the
    `git diff -w` hunks inside the span are empty or comment-only. Everything
    else is code-changing.
  - Writes `specs/070-requirement-anchors/evidence/churn-replay.json`.
- The `failOn` default is computed from the evidence file shipped in the
  package. A code constant `ANCHOR_FAIL_DEFAULT` is regenerated by the replay
  tool and checked by a drift test, so the decision is reproducible.
- **SPC007 exemption**: `specs complete --id X` passes guard's findings through
  a filter that drops ANC* findings whose `requirement` belongs to X before
  counting errors, and prints those findings.

### Ripple (US5, FR-031)

- `reverseImportAncestors` and the hub rule (`HUB_OUT_DEGREE = 15`) move to
  `scanners/import-graph.mjs`. `impact.mjs` re-imports them, and an
  `impact` test pins the unchanged behavior.
- Name filter: an importer qualifies only if its import statement names the
  changed exported symbol, or imports the namespace and uses `ns.<name>`.
  This reuses the import-graph's specifier data, which needs extending to
  record imported names.
- Fan-out above `anchors.fanOutLimit` (default 10) collapses into one summary.

### Test chain (US6, FR-032–FR-033)

- Test references come from the existing `testEvidence` (`@req`, `@covers`, and
  test labels).
- Adapter `testguard-evidence` in `evidence/adapters.mjs`: it reads the saved
  evidence path (config `anchors.testguardEvidence`, default
  `.testguard/evidence.json`, checked against the TestGuard repo's evidence
  schema).
- Each claim is matched by its structured `source.ref`
  (`<specId>#<REQ>`, the companion spec).
- The anchored code fingerprint at evidence `head` is computed from blobs at
  that revision. When `head` is not resolvable, the result is inconclusive.
- Input hashes are checked the same way as the existing adapters
  (`adapters.mjs:120-123`).

### Orphans, granularity, export, importers (US7–US9)

- **Orphans**:
  - The candidates are the exported or top-level symbols the tiers already
    enumerate (`moduleSymbols`, `py-anchors`, the pattern symbol finder),
    under `scope.sourcePaths` of current specs, or under
    `anchors.orphanPaths`.
  - Dispositions are lock lines with key `disposition|<file>|<anchor>`.
- **CSV**: fixed columns (contract). RFC 4180 quoting; formula injection is
  neutralized by prefixing `'` to any cell that starts with `=+-@`.
- **ReqIF 1.2**: a minimal valid document. One `SPEC-OBJECT-TYPE` each for
  Requirement, Anchor and Test. `SPEC-RELATION-TYPE` for implements and
  verifies. Deterministic identifiers derived from keys. XML is escaped. Built
  with string assembly; no XML dependency.
- **Importers**:
  - StrictDoc: `@relation\((?<id>[^,)]+)(?:,\s*scope=(?<scope>\w+))?(?:,\s*role=\w+)?\)`
    with `()` or `{}`.
  - OFT: `\[(?<type>\w+)->(?<target>\w+~[\w.-]+~\d+)(?:>>[\w,]+)?\]`.
  - Mapping through `anchors.importMap` (foreign ID → `specId#REQ`). For an OFT
    revision, the map stores the expected revision, and a mismatch is treated
    as a code-side suspect.

### Golden fixtures and oracle (US10, FR-039–FR-040)

- `tests/fixtures/anchors/<lang>/{input.*,golden.json}` hold the expected
  `{anchor, tier, fp, floor}` values.
- The python-ast golden values are keyed per interpreter minor version that CI
  runs. When the local interpreter has no golden entry, the test skips that
  key and says so.
- **Oracle**: `tools/anchor-oracle/run.mjs` loads web-tree-sitter and grammar
  `.wasm` from its own `node_modules`, which `npm ci --ignore-scripts`
  installs from a lockfile with integrity hashes. It compares spans with
  `pattern-lexer` on the fixtures plus a pinned corpus. The corpus is the
  fixtures plus this repository's own Go, Rust and Java samples under
  `tests/fixtures`.
- **Package vetting.** Before a package enters
  `tools/anchor-oracle/package.json`, it is checked against every Constitution
  II criterion: official registry, more than 10k weekly downloads, more than
  one maintainer, first published more than 30 days earlier, exact pin. The
  result is recorded in `tools/anchor-oracle/VETTING.md` (`npm view` output
  plus the download-API figures). A grammar that fails is left out, and its
  language is reported as "no oracle".
- The job fails only for high-confidence languages (Go, Rust, Java, C#,
  PHP, Ruby, Kotlin and Swift when vetted). C and C++ are reported, never
  failed.
- The oracle runs in a CI job with `permissions: contents: read`.
- **User tier**: config `anchors.treeSitter.artifacts: {runtime, grammars:{go:…}}`
  names absolute file paths.
  1. DocGuard checks each file's sha256 against
     `schemas/docguard-anchor-treesitter.manifest.json`.
  2. It copies the verified bytes into `.docguard/ts/<hash>/`.
  3. It imports from that copy, which closes the TOCTOU window.

  The project's module resolution is never used.

## PR sequence

| PR | Story | Contents | Gate before merge |
|---|---|---|---|
| 1 | US1 | fingerprint.mjs, pattern-lexer, py-anchors, anchor-tags, anchors list, ANC006/007/010 (warn/info), FR-005/014/015 fixes, golden fixtures for SC-001's non-semantic edits, docs | SC-002, SC-008, doc-lock entries current, budget |
| 2 | US2 | lock, accept/baseline/remove, state machine, ANC001–005/008/009, `--gitattributes`, CODEOWNERS recipe, this repo's baseline | SC-001, SC-004, budget |
| 3 | US3 | replay tool + committed evidence, `failOn`, SPC007 exemption | SC-005, SC-006 |
| 4 | US4 | carry-over and moved | SC-009 |
| 5 | US5 | walk relocation, name filter, ripple | impact tests unchanged |
| 6 | US6 | TestGuard adapter (after the TestGuard companion PR merges) | adapter fixtures |
| 7 | US7 | orphans, dispositions, granularity | — |
| 8 | US8 | trace matrix CSV and ReqIF | SC-010 |
| 9 | US9 | importers | — |
| 10 | US10 | full golden set, oracle job, user tree-sitter tier | SC-007 |

The TestGuard companion spec runs in `raccioly/testguard` in parallel with PRs
1–5.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `tools/anchor-oracle/` with its own lockfile (CI-only) | FR-040 and SC-007 need an independent parser to measure the pattern tier | Shipping tree-sitter as a dependency breaks Constitution II (about 305 MB, install scripts). Without an oracle, the pattern tier's accuracy would be asserted, not measured (Constitution IX). Every oracle package still passes the Constitution II criteria, recorded in `VETTING.md`. It ships nowhere: `tools/` is outside `files` |
| Two fingerprint algorithms (`doclock-v0`, `v1`) | Existing doc-lock entries must stay current, and the doc-lock schema must not change | Migrating the doc lock to v1 would flip every DLK entry and need a schema bump that older releases reject (DLK005) |
| A JSONL lock instead of JSON | Union merges for parallel PRs (FR-017) | A JSON object conflicts on adjacent keys whenever two PRs accept links of the same spec |
