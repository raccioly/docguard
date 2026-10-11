# Research: Requirement Anchors and Suspect Links

Four read-only investigations ran on 2026-10-11, before the spec was written:

1. an integration map of this repository;
2. a prior-art survey;
3. a measured tree-sitter vs. pattern-tier spike;
4. a red-team review of the 16 draft decisions.

This file records what each found and how the decision changed.

## 1. What already exists

- **`cli/scanners/doc-deps.mjs` (spec 030)** already implements symbol
  fingerprints for doc→code links. The pieces:
  - `fingerprint(ctx, 'path#symbol')`;
  - Babel AST normalization that strips positions and comments;
  - Python `ast.dump`;
  - the tiers `ast`, `python-ast`, `content` and `glob`, plus an
    `unverifiable` state;
  - `docLockStatus` (current/changed/missing/unverifiable);
  - the reasoned `review --accept`, which writes through
    `commitFileTransaction`;
  - a separate committed lock.

  This feature generalizes that machinery and does not build a second one.
- **Evidence producers**: `cli/scanners/requirement-evidence.mjs`, the
  `implementationDeclarations` regex tokenizer at :106-119. It is not
  string-aware and ignores `@covers`. Also `cli/shared-requirements.mjs`,
  whose `text` field is the first line only (:76).
- **Evidence consumers**:
  - `reconciliation.mjs` `directSpecLinks` (file-path match);
  - `specs.mjs`: SPC004, completion evidence, the 20-outcome and
    100-evidence-path bounds;
  - `validators/spec-registry.mjs` (SPR006);
  - `task-context.mjs`;
  - the traceability validator and `trace --features`, which use test
    references only.
- **Registry constraints**:
  - `reviewed` is fail-closed by a key whitelist (`spec-registry.mjs:289-378`),
    so older releases report SPR003 on unknown fields.
  - The registry is current only when it is byte-equal to the regenerated
    projection (:709-718).

  Either way, review state does not belong in `.docguard-specs.json`.
- **Annotation positions in this repository**: 664 implementation entries.
  - 405 sit in a leading comment block.
  - 216 sit before a top-level statement, some of them before imports.
  - 15 sit inside a statement (for example `cli/docguard.mjs:681` inside the
    ~600-line `main()`).
  - 28 are in non-JS files (YAML).
- **Reusable pieces**:
  - `impact.mjs`: a 2-hop reverse import walk (`reverseImportAncestors`).
  - `shared-diff.mjs`: hunks with `newStart`.
  - `writers/state-dir.mjs` and the `memory-plan.mjs` disk cache: atomic, and
    validated on read.
  - `as-built.mjs`: stable fact keys and `checkAsBuiltSync`.
  - The route extractors.
- **Python port**: `docguard_cli/` only wraps the Node CLI. It has no parity
  burden.

## 2. Prior art

| Tool | Granularity | Change detection | Clearing |
|---|---|---|---|
| StrictDoc | `@relation(REQ, scope=file\|class\|function\|line\|range_*)`. Function scope for Python and C/C++ (tree-sitter) and Rust; none for JS/TS | None on code; a Git diff of documents only | n/a |
| OpenFastTrace | `[impl->dsn~name~rev]`, with manual revision numbers | "Outdated" when a tag cites an old revision | Manual revision bump |
| Doorstop | Per item | SHA-256 stamps of item fields; one-way "suspect link" | `doorstop clear`, with no identity, reason or permission check; whitespace changes forced "review all" (#193) |
| IBM ELM | Per artifact version | Suspect when either end changes; keyed on the version pair, so a revert restores the status | Role permission "Set Link Validity" |
| codebeamer, Jama, Polarion | Per item | Configurable suspect propagation, some bidirectional | Manual; permission and audit vary |

None of them combines per-symbol content fingerprints, two-way suspicion and
fingerprint-bound clearing. None documents automated or AI clearing.

- **Standards**: DO-178C §5.5 requires bidirectional traces from low-level
  requirements to source code. ISO 26262 and IEC 62304 expect change-impact
  analysis. Symbol granularity is the level these standards expect.
- **Normalization**: Type-1 clone normalization (whitespace, layout, comments)
  is safe for change detection. Type-2 normalization (identifiers, literals)
  is unsafe. git `patch-id --stable` showed how an algorithm change invalidates
  stored IDs, which is why every fingerprint carries an algorithm version.
- **Research on link recovery**:
  - LiSSA (ICSE 2025, retrieval plus an LLM) beats earlier methods on
    requirements-to-code, but its authors say it is not ready for practice.
  - A follow-up found agent-based recovery below information-retrieval
    baselines.

  So any recovery can only propose links, never approve them. DocGuard makes
  no LLM calls at all (Constitution V).

## 3. Tree-sitter vs. the pattern tier (measured, Node 24.18)

- **Accuracy and speed of the pattern tier**:
  - Rust: 76 files, 46,799 lines, 2,194 symbols, 0 range errors, 1.01 ms per
    file.
  - Go: 22 files, 109 symbols, 0 errors, 0.13 ms per file.
  - The `@implements` pre-filter costs 0.002 ms per file.
  - Babel parses all 513 JS files of this repository (5.4 MB) in about 175 ms.
- **Fingerprint stability**: after re-indenting, adding comments and inserting
  blank lines across 98 files, 2,298 of 2,303 fingerprints were unchanged. The
  5 that changed were qualified-name collisions, not lexer errors. All 1,177
  one-identifier edits were detected, with 0 false flags.
- **Brace self-check**: every lexer failure probed (C# and Kotlin
  interpolation, PHP inline HTML, C preprocessor branches, C++ raw strings)
  surfaced as an unpaired brace. The self-check therefore catches these
  failures and falls back to file scope.
- **Tree-sitter install weight**:
  - The 9 official grammar packages total about 305 MB unpacked, with 10
    install scripts and native prebuilds.
  - None has npm provenance.
  - web-tree-sitter 0.27.1 shipped 8 releases in 6 months, and grammars built
    for older versions fail to load in newer runtimes.
  - OSV lists lookalike malicious packages, including `tree-sitter-forth`
    9999.99.99 (2026-06).
- **Decision**:
  - The pattern tier is the default for every language.
  - Tree-sitter is opt-in, loaded from DocGuard's install and hash-pinned.
  - Tree-sitter also runs in CI as an oracle (move a language over if
    disagreement exceeds 1%).
  - C/C++ is low confidence.

## 4. Red-team outcomes

| Draft decision | Outcome | Reason |
|---|---|---|
| D1 position-based scope | Modified: ambiguity reported, statement and route scopes, explicit `{scope=}` | Header blocks above declarations are ambiguous in 23 files. Statement tags inside `main()` would churn |
| D2 token-stream hash | **Reversed**: AST normalization where a parser exists | Prettier 3's default `trailingComma: "all"` changes token streams but not the normalized AST (verified) |
| D3 runtime cache | Kept, with security fixes | A cache file force-added with `git add -f` could forge "current" |
| D4 requirement fingerprint | Modified: full block, requirement-side flags warn-only | The first-line-only `text` misses multi-line edits, and typo fixes would flood |
| D5 fail on direct suspects | Modified: fail on reviewed, exact-tier, symbol scope only, after measurement; SPC007 exemption | `specs complete` refuses while guard has errors, which would deadlock |
| D6 depth-1 ripple plus SCIP | Modified: reuse the 2-hop walk filtered by name; SCIP dropped | Already exists; SCIP needs protobuf and goes stale |
| D7 similarity re-link | Modified: carry over only on a unique exact match; add a lost state | Trivial bodies collide, and deleted implementations passed silently |
| D8 BM25 and agent proposals | Modified: opt-in report with dispositions | Constitution V; regulated adopters need dispositions |
| D9 broad-tag warning | Info only | A warning pushes copy-paste tagging |
| D10 tags in code | Kept | — |
| D11 tiers | Modified: parser version in the tier ID, floor fingerprint, brace fallback | An interpreter upgrade currently reads as "changed" in doc-deps (an existing bug) |
| D12 baseline | Modified: bulk accept `baseline: true`, plus the state model | — |
| D13 clearing through `specs complete` | Modified: `anchors accept`, fingerprint-bound, `--bulk`, CODEOWNERS | SPC007 deadlock; the 20/100 caps truncate the audit; a self-declared "cleared by human" can be forged |
| D14 one spec, P1 large | Modified: more, smaller stories; failure after measurement | — |
| D15 fingerprints in the registry | **Reversed**: separate lock, one entry per line, `merge=union` | SPR003 on older releases; merge conflicts |
| D16 reuse doc-deps | Adopted | No-rebuild rule |

The red-team's top risks, and how the spec answers each:

- **Gate bypass**: a forged cache, boilerplate clears, or a span that leaves
  out annotations. Answered by FR-004, FR-022, FR-025 and FR-041.
- **False-suspect floods leading to rubber-stamping.** Answered by FR-010 to
  FR-012, FR-027 and FR-028.
- **Deadlocks in the clearing path.** Answered by FR-022 and FR-029.

## 5. Plan-phase decisions

Each decision gives its rationale and the alternatives rejected.

### P1. Lock format: JSON Lines with a header line

- **Decision**: `.docguard-anchor-lock.jsonl`. Line 1 is the header, and every
  other line is one sorted-key entry. The reader tolerates any line order, and
  the writer re-sorts.
- **Rationale**: `merge=union` merges by line, so one entry per line merges
  cleanly. A duplicate key is detectable, so a bad merge fails closed. Diffs
  show one line per changed link.
- **Rejected**: a JSON object like the doc lock (adjacent-key conflicts); a
  sharded directory with one file per spec (many files, and union merge still
  needed within a spec); storage in `.docguard-specs.json` (SPR003 on older
  releases, and byte-equality churn).

### P2. Two algorithms in one module

- **Decision**: `doclock-v0`, which keeps doc-deps behavior byte-for-byte, and
  `v1` for anchors.
- **Rationale**: existing doc-lock entries stay current without a schema bump.
  Only the anchor algorithm drops the name and handles directives.
- **Rejected**: migrating the doc lock to v1, which would flip every DLK entry
  and need a schema bump.

### P3. Statement anchor identity

- **Decision**: the key is `<enclosing symbol>>stmt:<REQ>#<n>`, where `n` is
  the ordinal among statement tags for that requirement inside the enclosing
  symbol.
- **Rationale**: the key survives line moves and untagged insertions. Adding a
  second tag for the same requirement is the only thing that renumbers, and
  such an edit is deliberate.
- **Rejected**: a line number (churns on every edit above it); a hash of the
  statement (changes on the edit we want flagged as suspect, turning suspect
  into lost plus unreviewed); a global ordinal (churns on unrelated tags).

### P4. Python comments and spans

- **Decision**: one batched `python3` process. It uses `ast` (`end_lineno`,
  Python 3.8+) for spans, decorators and docstrings, and `tokenize` for
  comments.
- **Rationale**: `ast` drops comments, and `tokenize` is in the standard
  library. One process keeps the cost flat.
- **Rejected**: the regex outline tier for comments (it does not understand
  strings); one process per file (cost).

### P5. Tier labels

- **Decision**: `babel@7` (the AST-schema major), `python-ast@<major.minor>`,
  `pattern@<algo>`, `treesitter@<grammar-hash8>`, `file`.
- **Rationale**: Babel's AST is stable within a major version, so Babel patch
  bumps do not drop links to the floor. Python's `ast` shape changes across
  minor versions.
- **Rejected**: the full Babel version (needless floor comparisons on every
  dependency bump).

### P6. Churn classification

- **Decision**: formatting-only means the `git diff -w` hunks inside the
  symbol's span at both revisions are empty or comment-only. Every other flag
  is code-changing. This is the rule FR-027 states.
- **Rationale**: this is reproducible, needs no dependency, and is
  conservative. A Prettier trailing-comma change shows up as non-whitespace,
  so it counts as code-changing in the replay. The golden fixtures cover
  that case separately (SC-001), so the replay never hides a formatter false
  positive.
- **Rejected**: running Prettier (a dependency); manual labelling (not
  reproducible).

### P7. User-side tree-sitter loading

- **Decision**: the user configures absolute artifact paths. DocGuard verifies
  them against a manifest it ships, copies the verified bytes into
  `.docguard/ts/<hash>/`, and imports that copy.
- **Rationale**: hash pinning means only known code runs, wherever it was
  installed. The copy closes the window between checking and loading. The
  project's module resolution is never used.
- **Rejected**: loading from DocGuard's own `node_modules` (a global install's
  layout is not predictable); auto-detection (results would differ by
  machine).

### P8. The doc lock and a Python interpreter upgrade

- **Decision**: on a `python-ast` mismatch, re-fingerprint the symbol from the
  blob at `reviewedRevision` with today's interpreter. If that equals today's
  fingerprint, the cause is the interpreter, reported as unverifiable. If they
  differ, it is DLK001. If the revision is unavailable, it stays DLK001 with a
  note.
- **Rationale**: this fixes the bug without changing the doc-lock schema.
  History is used only to tell the two causes apart, never for comparison.
- **Rejected**: storing the interpreter version in the doc lock (a schema
  bump); dropping to the content tier (would flag every Python entry).

### P9. ReqIF without a dependency

- **Decision**: build the ReqIF 1.2 document by string assembly with XML
  escaping and deterministic identifiers (`_` + sha1 of the key, first 16
  hex digits).
- **Rationale**: the format needs only a small subset (types, objects,
  relations). Constitution II rules out an XML library.
- **Rejected**: an XML library dependency.
