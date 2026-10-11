# Feature Specification: Requirement Anchors and Suspect Links

**Feature Branch**: `feat/requirement-anchors`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.requirement-anchors`

**Lineage**: Generalizes `docguard.doc-dependency-lock` (spec 030). That spec
fingerprints the code a doc section covers, and this one applies the same
machinery to the code a requirement tag marks. Extends
`docguard.document-lifecycle` (spec 006: reviewed vs observed state),
`docguard.lifecycle-evidence-gaps` (spec 021), `docguard.canonical-requirement-links`
(spec 027), `docguard.as-built-specs` (spec 024) and
`docguard.code-derived-diagrams` (spec 035: the import graph). The maintainer's
question was whether code areas could carry spec references so that a change
in one place is known to affect another. Four investigations informed the
design: an integration map, a prior-art survey (StrictDoc, OpenFastTrace,
Doorstop, IBM ELM, DOORS, codebeamer, Jama, Polarion), a measured tree-sitter
spike, and a red-team review of every decision. See [research.md](research.md).
The test-chain story has a companion spec in the TestGuard repository, which
makes the claim `source.ref` a structured `specId#FR-NNN`.

**Input**: User description: "Symbol-level requirement anchors and suspect
links: code→requirement tags anchor to the symbol below them, a reviewed
fingerprint of the anchored code and of the requirement is locked, and a link
is flagged when either side changes."

## Problem

Code says which requirement it implements (`@implements docguard.x#FR-003`),
but DocGuard links that claim to the **whole file**:

- **Reconciliation is file-coarse.** `reconcile --since` attributes a changed
  file to every spec the file mentions. Many files here carry tags for several
  specs (`cli/shared-source.mjs` has 19), so a one-line fix attributes the
  change to all of them. A reviewer cannot tell which requirement the change
  touched.
- **No record of what was reviewed.** Nothing records "requirement FR-003 was
  last checked against this function when the function looked like X". A
  requirement can be implemented, reviewed, and then silently regress. Editing
  the requirement text silently retargets every tag that cites it.
- **History-dependent.** Completion records a git revision. Squash merges
  discard branch revisions, which is why `specs reanchor` exists. A comparison
  based on content needs no history.
- **No reverse-engineering inventory.** An enterprise adopter, especially in a
  regulated industry, needs to know which code implements no requirement
  (derived requirements or dead code), and must be able to export the trace
  matrix to requirements tools.
- **The existing tag scanner has defects.** It reads tags inside string
  literals (`cli/commands/explain.mjs:137`). Requirement text keeps only the
  first line of a declaration (`cli/shared-requirements.mjs:76`).

The doc-dependency lock (spec 030) already solves the same problem for doc
sections: symbol fingerprints, tiers, an explicit reasoned accept, and a lock
file kept separate from the registry. It also has defects this feature must not
inherit:

- It reports a Python interpreter upgrade as "changed" instead of
  "unverifiable".
- It spawns one Python process per symbol.
- It finds only top-level symbols and one class-member level.
- It includes the symbol's own name in the hash.

## User Scenarios & Testing *(mandatory)*

Each story ships as its own pull request, in this order. Stories 1–3 are the
minimum viable product. Every later story builds on the anchor lock and changes
nothing for projects that do not use it.

### User Story 1 - A tag anchors to the code under it (Priority: P1)

A developer writes `// @implements acme.billing#FR-003` directly above
`function applyDiscount()`. `docguard anchors` lists the link at symbol scope.
It names the file, the qualified symbol, the extraction tier, and the link
state (unreviewed). A tag in the file's leading header keeps file scope. A
header block sitting directly above a function is reported as ambiguous and
stays at file scope; it is never silently reinterpreted. Nothing fails yet.

**Why this priority**: Every other story needs a precise anchor and a
trustworthy fingerprint. This story is also where the shared fingerprint
module is extracted from the doc-dependency lock and that module's defects are
fixed.

**Independent Test**: Use a fixture project with tags in a JS file, a TS file,
a Python file and a Go file, placed in four positions: header, above a symbol,
inside a function body, and inside a string literal. `anchors --format json`
reports the expected scope and tier for each real tag and nothing for the
string literal. The project's evidence counts are unchanged except for the
removed string-literal false tag.

**Acceptance Scenarios**:

1. **Given** a tag in a comment directly above a function, method or class
   (decorators and annotations may sit between them), **When** `anchors` runs,
   **Then** the link has symbol scope and a qualified symbol path, and its span
   includes the decorators.
2. **Given** a tag in the file's leading header block, followed by imports or
   another comment, **Then** the link has file scope.
3. **Given** a header block with no imports, directly above a declaration,
   **Then** the link has file scope and an ambiguity finding suggests an
   explicit `{scope=…}`.
4. **Given** `@implements acme.x#FR-001 {scope=symbol}` with no declaration
   below it, **Then** a finding says the explicit scope did not resolve, and
   the tag still counts as file-scope evidence.
5. **Given** a tag inside a string or template literal, **Then** it is not a
   tag.
6. **Given** a Go file whose braces do not balance under the pattern tier,
   **Then** every tag in that file has file scope, with a finding naming the
   reason. No span extends to the end of the file.
7. **Given** a project with no anchor lock and no `anchors` configuration,
   **When** `guard` runs, **Then** its output is byte-identical to the previous
   release, apart from the validator list, timings, and findings that changed
   only because tags inside literals no longer count (FR-026).

---

### User Story 2 - A reviewed link turns suspect when either side changes (Priority: P1)

A maintainer adopts the feature with `docguard anchors accept --baseline
--bulk --reason "adopt anchors at v0.45"`. Every current link is recorded as
**baselined**, not reviewed. Later, a developer changes the body of
`applyDiscount()`. `guard` warns that the link to `acme.billing#FR-003` is
**suspect on the code side**. It names the symbol, the requirement, and a
command that shows the change. After reading the change, the maintainer runs
`docguard anchors accept --link <key> --reason "rounding fix keeps FR-003"`,
and the link becomes reviewed. When someone edits the requirement text of
FR-003 itself, the link is **suspect on the requirement side**. When the tag is
deleted while FR-003 still exists, the link is **lost**.

**Why this priority**: This is the feature's purpose: a durable, reviewable
record that this code was checked against this requirement, and a signal when
that stops being true.

**Independent Test**: In a fixture, baseline, then make five non-semantic
edits: re-indent, add comments, add trailing commas, swap quote style, insert
blank lines. Each yields zero suspects. One single-identifier edit inside one
anchored function yields exactly one code-side suspect. Editing one requirement
line yields one requirement-side suspect. Deleting a tag yields one lost link.
An accept clears exactly the accepted link.

**Acceptance Scenarios**:

1. **Given** a baselined or reviewed link, **When** the anchored code changes
   semantically, **Then** the link is suspect on the code side. Formatting,
   comment, whitespace and line-move changes never make a link suspect in an
   exact tier.
2. **Given** a reviewed link, **When** any line of its requirement block
   changes, **Then** the link is suspect on the requirement side. When the
   change only collapses whitespace or line endings, nothing is reported.
3. **Given** a suspect link, **When** `anchors accept --link <key> --reason
   <text>` runs, **Then** the lock records the new fingerprints, the previous
   fingerprints they replace, the revision, the date and the reason, and the
   link is reviewed.
4. **Given** an accept recorded for the change A→B, **When** the code later
   changes to C, **Then** the link is suspect again. An accept can never cover
   a change it did not see.
5. **Given** an accept that would affect more than one link, **When** `--bulk`
   is absent, **Then** nothing is written. With `--bulk`, every written entry
   records `bulk: true`.
6. **Given** a missing or too-short `--reason`, **Then** nothing is written.
7. **Given** `sync`, `fix --write`, `generate`, `specs complete`, any MCP tool
   or any agent skill, **Then** the anchor lock is never written.
8. **Given** two branches that each accept different links of the same spec,
   **When** git merges them, **Then** the lock merges without conflict. If
   both branches wrote the same key with different content, the link reads as
   suspect and a finding names both entries.
9. **Given** a baselined or reviewed link whose tag is gone while its
   requirement still exists, **Then** the link is lost. `anchors accept --remove <key> --reason`
   removes it.
10. **Given** a tag that cites a requirement of a retired or superseded spec,
    **Then** a finding asks to retarget or remove the tag. The link is not
    reported as suspect.

---

### User Story 3 - Suspect links fail CI only where the signal is proven (Priority: P1)

The maintainer replays this repository's recent history with the lock
baselined at the start. The replay measures how many links each commit would
make suspect, and how many of those flags are false (no change in behavior).
Once the measurement shows that exact-tier links produce no formatter-only
false suspects, suspect and lost links that are **symbol-scope, exact-tier and
reviewed** fail `guard`. Every other link (file scope, pattern tier, baselined)
keeps warning. Completing a spec is never blocked by the spec's own anchor
findings.

**Why this priority**: Turning on a failing gate before measuring it floods CI
red, and then people clear links in bulk without reading them. The measurement
is the gate for the gate.

**Independent Test**: Replay the last 100 or more first-parent commits of this
repository and commit the result as evidence. With the failure policy on, a
fixture containing a reviewed, symbol-scope, exact-tier suspect link exits
non-zero, and the same change on a baselined or pattern-tier link exits with a
warning. `specs complete` for a spec whose own links are suspect succeeds and
lists them.

**Acceptance Scenarios**:

1. **Given** the committed replay evidence shows zero formatter-only false
   suspects for exact-tier links, **When** `anchors.failOn` is unset, **Then**
   the default is `reviewed-exact`. Otherwise the default stays `none`, and
   the spec records why.
2. **Given** `failOn: reviewed-exact`, **Then** a code-side suspect or lost
   link fails `guard` only when it is symbol, statement or route scope, exact
   tier, and reviewed.
3. **Given** a requirement-side suspect, **Then** it warns and never fails.
4. **Given** `specs complete --id X`, **Then** anchor findings for X's own
   links do not count toward SPC007. The completion output lists them with the
   accept command.

---

### User Story 4 - Moving or renaming code keeps its review (Priority: P2)

A developer renames `applyDiscount` to `applyCouponDiscount` and moves it to
`pricing/discounts.mjs` without changing its body. The tag moves with the
function. `anchors` reports the reviewed link as **moved**, not suspect and not
lost. The next accept rewrites the lock key.

**Why this priority**: Refactors are the main source of false alarms after
formatting. Without carry-over, every rename would read as a deletion plus a
new, unreviewed link.

**Independent Test**: In a fixture, rename and move a reviewed function with
an unchanged body. The result is one "moved" info finding, no suspect and no
lost. Duplicate the function so that two identical bodies exist. The review
does not carry over, and the link is lost.

**Acceptance Scenarios**:

1. **Given** a reviewed lock entry whose anchor no longer resolves, **When**
   exactly one unreviewed link exists for the same requirement with the same
   code fingerprint, **Then** the review carries over at runtime as moved. The
   lock is not written.
2. **Given** zero matches or more than one, **Then** the link is lost. No
   fuzzy or similarity matching is used.

---

### User Story 5 - See what else a change may affect (Priority: P2)

When an anchored symbol changes, `anchors` and `guard` add advisory notes for
links in files that import the changed file and use the changed exported name.
The notes follow the same reverse-import depth that `diff --since` already
uses. Wide fan-out collapses into one summary line.

**Why this priority**: This is the "a change here affects somewhere else"
signal the maintainer asked about. File-level import edges are cheap and
already exist. Function-level call graphs are where cost explodes, so they are
excluded.

**Independent Test**: A fixture where `a.mjs` exports `f` and `g`, `b.mjs`
imports `f` and carries a tag, and `c.mjs` imports only `g` and carries a tag.
Changing `f` adds a ripple note for `b.mjs` only. A hub file imported by more
files than the fan-out limit produces one summary.

**Acceptance Scenarios**:

1. **Given** a changed anchored symbol in a JS/TS or Python file, **Then**
   ripple notes name each importing file that references the changed exported
   name, up to depth 2, at info severity.
2. **Given** a language without an import graph, **Then** the output says
   ripple is unavailable for that file.
3. Ripple never fails `guard`.

---

### User Story 6 - Tests linked to a changed requirement need re-verification (Priority: P3)

When a code-side suspect exists for FR-003, the tests that carry `@req FR-003`
or `@covers FR-003` are listed as **needing re-verification**. If the project
has a TestGuard evidence file, DocGuard reads it as a saved report. When the
evidence was produced at a revision where the anchored code had today's
fingerprint, its claim names FR-003 through a structured source reference, and
its faults were killed, the tests are listed as **re-verified at <revision>**.
DocGuard never runs tests.

**Why this priority**: It completes the requirement ↔ code ↔ test chain that
regulated adopters expect. TestGuard does the proving. This story only reads
TestGuard's evidence.

**Independent Test**: A fixture with a suspect link, two tests tagged with the
requirement, and a saved TestGuard evidence file in three variants: matching
revision and fingerprint, stale fingerprint, and unstructured reference. The
results are, in order: re-verified, needs re-verification, and needs
re-verification with a hint about the unstructured reference.

**Acceptance Scenarios**:

1. **Given** a code-side suspect link, **Then** every test reference to its
   requirement is listed as needing re-verification.
2. **Given** a TestGuard evidence file that matches the fingerprint and the
   requirement, with killed verdicts, **Then** those tests are re-verified.
3. **Given** an evidence file that is unreadable, stale against its declared
   inputs, or unstructured, **Then** the result is inconclusive with a reason,
   never re-verified.

---

### User Story 7 - Inventory of code that implements no requirement (Priority: P3)

`docguard anchors --orphans` lists the exported and top-level symbols under
governed paths that no tag anchors. A maintainer records a disposition for
each one: derived (implements an unwritten requirement), dead, or
infrastructure. `score` and `trace` show how many links sit at symbol scope
versus file scope, as information.

**Why this priority**: This is the reverse-engineering view. It feeds as-built
specs and gives regulated adopters the "no code without a requirement" check.
It is opt-in, because on large repositories it is a report, not a gate.

**Independent Test**: A fixture with three exported functions, one of them
tagged. `--orphans` lists two. Recording a disposition for one leaves one
undispositioned. `score --format json` reports the anchor granularity.

**Acceptance Scenarios**:

1. **Given** `--orphans`, **Then** each untagged exported or top-level symbol
   under the configured or spec-scoped source paths appears once, in
   deterministic order.
2. **Given** `anchors disposition --symbol <key> --kind derived|dead|infrastructure
   --reason <text>`, **Then** the disposition is recorded in the anchor lock
   and the symbol drops out of the undispositioned list.
3. DocGuard proposes no requirement text and makes no LLM call. Agents read
   the JSON output.

---

### User Story 8 - Export the trace matrix (Priority: P3)

`docguard trace --matrix --format csv` and `--format reqif` export one row or
relation per requirement → anchor → test, with scope, tier, state and
fingerprints, so that teams using DOORS, Polarion or a spreadsheet can import
it.

**Why this priority**: Regulated adopters must hand the matrix to auditors and
requirements tools.

**Independent Test**: A fixture with two requirements, three anchors and two
tests exports a CSV with a fixed header and five rows in deterministic order,
and a ReqIF document in which every requirement and link appears exactly once.

**Acceptance Scenarios**:

1. **Given** `--format csv`, **Then** the columns are fixed and documented,
   and the row order is deterministic.
2. **Given** `--format reqif`, **Then** the output is well-formed XML with the
   ReqIF 1.2 structure: requirements as spec objects and anchors as relations.
3. **Given** `--output <path>`, **Then** the write goes through the safe-write
   path.

---

### User Story 9 - Teams already using StrictDoc or OpenFastTrace adopt without re-tagging (Priority: P3)

A project configures `anchors.import: ["strictdoc", "openfasttrace"]` and an
ID mapping. DocGuard reads `@relation(REQ-1, scope=function)` and
`[impl->dsn~name~2]` tags as anchors to the mapped requirements. It never
writes them.

**Why this priority**: Enterprises with existing tagging can layer DocGuard's
drift detection on top. Both of those tools lack content-based suspect
detection.

**Independent Test**: A fixture with one StrictDoc tag and one OFT tag, both
mapped, produces two anchors. An unmapped foreign ID produces a finding. A
symbol that carries a native tag and a foreign tag for different requirements
produces a finding.

**Acceptance Scenarios**:

1. **Given** importers are not configured, **Then** foreign syntax is ignored.
2. **Given** an OFT tag whose revision differs from the mapped revision,
   **Then** the link is reported as outdated, which is treated as code-side
   suspect.
3. **Given** a foreign ID with no mapping, **Then** a finding names it.

---

### User Story 10 - Fingerprints are provably deterministic (Priority: P3)

Committed golden fixtures fix the expected fingerprint for each language,
tier and parser version. Any change to the algorithm fails the suite until the
algorithm version is bumped. A CI-only job installs tree-sitter at exact
versions with integrity hashes, compares the pattern tier's spans with
tree-sitter's spans on the fixtures and a pinned corpus, and fails when they
disagree on more than 1% of symbols for a language. Users can opt into the
tree-sitter tier, which loads only from the DocGuard installation after hash
checks against the hashes DocGuard ships.

**Why this priority**: Tool-qualification arguments (DO-330, ISO 26262-8)
depend on deterministic, versioned output. The oracle keeps the dependency-free
pattern tier honest.

**Independent Test**: Altering one normalization rule makes the golden test
fail and name the fixture. The oracle job's report lists per-language agreement
percentages. With the tree-sitter tier configured but its hash wrong, the tier
is reported unavailable and the pattern tier is used.

**Acceptance Scenarios**:

1. **Given** the golden fixtures, **Then** every expected fingerprint matches,
   on every supported Node and Python version in CI.
2. **Given** `anchors.treeSitter` configured and verified, **Then** links in
   languages it covers record the tree-sitter tier. A missing or mismatched
   artifact falls back with a finding, never a crash.
3. The tree-sitter tier is never auto-detected and never resolved through
   the scanned project's modules. Only artifacts whose hashes DocGuard ships
   are loaded.

### Edge Cases

- **Overloads and name collisions**:
  - Java and C# overloads, Rust `impl From<A>` vs `impl From<B>`, and
    `#[cfg]` twins get a qualified key with a parameter signature where the
    tier can read one, or an ordinal otherwise.
  - When neither resolves the ambiguity, the tag falls back to file scope with
    a finding.
- **Anonymous and arrow functions**: `export const f = () => …` anchors to
  `f`. An inline route callback such as `app.post('/login', …)` anchors to the
  route identity `route:POST /login` where a route extractor recognises it, and
  to the enclosing statement otherwise.
- **Nested symbols**: Python nested functions and JS class methods use dotted
  paths (`Outer.inner`).
- **Generated code**: tags inside generated or ignored paths are reported and
  not anchored. Generated files can be covered through a spec's `assetPaths`
  at file scope.
- **Macro-generated symbols** (Rust macros, Ruby `define_method`): no tier can
  see them. Tags above the macro call anchor to the statement.
- **C/C++ preprocessor branches**: pattern-tier links are marked
  low-confidence, and a brace imbalance falls back to file scope.
- **Newline-significant languages**: `return\nfoo()` and `return foo()` must
  produce different fingerprints in Go. Kotlin, Swift and Ruby are best effort
  and documented as such.
- **Directive comments change behavior**, so they stay in the fingerprint:
  `@ts-ignore`, `@ts-expect-error`, `eslint-disable*`, `//go:build`,
  `# type: ignore`, `# noqa`, `/*#__PURE__*/`.
- **Python interpreter changes**:
  - A different interpreter version on CI than on the developer machine gives
    a different exact tier. Comparison drops to the floor fingerprint and
    reports "tier changed". It never reports suspect on the tier change alone.
  - A file that one interpreter version cannot parse, such as `match` on
    Python 3.9, falls to the pattern tier and says so.
- **Algorithm upgrades**: a link stamped under an older algorithm version is
  recomputed under that version when DocGuard still supports it. A match
  counts as current and needs a restamp (info). An unsupported older version
  is unverifiable (warn), never suspect.
- **Shallow clones and squash merges**: comparison needs no history, and only
  the suggested diff command degrades.
- **Cache tampering**: a cache file tracked by git (`git add -f`) disables the
  cache for the run, with a finding. The cache is also off in CI.
- **Corrupt or future-version lock**: one error finding. It never reads as
  "all current".
- **A tag citing two requirements**: one ID per tag. Stack one tag per line.
  A comma list keeps its first ID, and a finding asks to split it.
- **A symbol tagged for two specs**: two independent links.
- **A deleted symbol**: lost when it was baselined or reviewed, gone when it
  was only unreviewed.
- **A file moved across packages**: carry-over follows User Story 4.

## Requirements *(mandatory)*

### Functional Requirements

#### Tags and anchoring

- **FR-001**: The existing tag forms (`@implements <specId>#<REQ>`,
  `@implements <path>#<REQ>`, `@req <REQ>`, `@covers <REQ>`) MUST keep
  parsing exactly as today.
  - A tag MAY end with a scope block, `{scope=file|symbol|statement|route}`,
    that older releases ignore.
  - An unknown key in the block MUST produce a finding, and the tag MUST still
    count at file scope.
  - One requirement ID per tag. A comma list keeps its first ID and MUST
    produce a finding.
  - Anchors come only from `@implements` and `@req` tags in files that are not
    tests. `@covers`, and every tag in a test file, stays test evidence and
    feeds the test chain (US6).
- **FR-002**: Without an explicit scope, scope MUST follow position:
  - **File scope**: a tag in the file's leading comment block, when imports,
    another comment, or nothing follows that block.
  - **Symbol scope**: a tag in a comment directly above a declaration. Only
    decorators or annotations may sit between them; no blank line.
  - **Ambiguous**: a leading header block with no imports, directly above a
    declaration. It MUST stay file scope and produce an info finding.
  - **Top-level variable**: a tag directly above a top-level variable
    declaration, whatever its initializer (`export const TRACE_MAP = {…}`), is
    symbol scope, and the variable name is the symbol.
  - **Statement scope**: a tag inside a function body, above a statement. A
    tag above any other top-level statement, such as a call, is statement
    scope under the enclosing symbol `<module>`.
  - **Route scope**: a tag above a route registration that a route extractor
    recognises. It anchors to `route:<METHOD> <path>`.
  - **Python docstring tags**: a tag inside a docstring anchors to the
    function or class the docstring belongs to.
- **FR-003**: A symbol anchor MUST record a qualified path: file, then
  enclosing scopes, then name (`cli/x.mjs::Outer.inner`).
  - Overloads and collisions add a parameter signature where the tier can read
    one, or an ordinal otherwise.
  - An anchor that is still ambiguous falls back to file scope with a finding.
- **FR-004**: A symbol's span MUST include its decorators and annotations and
  MUST exclude the tag comment itself.
- **FR-005**: Every tier MUST recognise comments in a way that respects
  strings, template literals, regex literals and character literals. A tag
  inside any literal MUST NOT count, which fixes `cli/commands/explain.mjs:137`.
- **FR-006**: Every tag that counts as requirement evidence today MUST keep
  counting, whatever scope it resolves to, in requirement coverage, SPR006,
  preflight presence and trace. The only permitted difference is the removal
  of tags found inside literals, listed in the changelog.

#### Extraction tiers

- **FR-007**: Anchors MUST be extracted through these tiers, and every link
  MUST report its tier and confidence:
  - `babel@<version>` for JS/TS;
  - `python-ast@<major.minor>` for Python, with every file in a run parsed in
    one batched interpreter process and the AST serialized by walking its
    fields;
  - `pattern@<algorithm-version>` for Go, Rust, Java, Kotlin, C#, PHP, Ruby,
    Swift, C and C++. C and C++ are low confidence.
  - `file` as the fallback, and as the only tier for languages without a
    lexer (YAML, shell, Markdown-adjacent configuration).
- **FR-008**: The pattern tier MUST check itself. When the language's
  delimiters do not balance in a file, every tag in that file MUST fall back
  to file scope, with a finding. No span MAY run to the end of the file.
- **FR-009**: A tree-sitter tier MAY be enabled, but only explicitly in
  configuration, by naming the artifact files.
  - Each runtime and grammar file MUST match a sha256 in the manifest DocGuard
    ships before it is loaded.
  - Resolution MUST NOT go through the scanned project's module resolution,
    so the project's `node_modules` can never supply code.
  - A missing or mismatched artifact makes the tier unavailable, with a
    finding, and extraction falls back.
  - It is never auto-detected.

#### Fingerprints

- **FR-010**: A code fingerprint MUST ignore positions, whitespace, comments,
  docstrings and the symbol's own declared name. It MUST include decorators,
  annotations, parameters, the body, string literals verbatim, and allowlisted
  directive comments (Edge Cases). In exact tiers, formatter-only changes MUST
  NOT change it: trailing commas, optional semicolons, quote style, redundant
  parentheses.
- **FR-011**: A fingerprint MUST carry its algorithm version and tier.
  - Every link MUST also store a pattern-tier floor fingerprint.
  - When both sides have the same exact tier, the exact fingerprints are
    compared. Otherwise the floor fingerprints are compared.
  - A floor match with a different tier is "current, tier changed" (info).
  - A floor mismatch is suspect.
  - When no comparison is possible, the link is unverifiable (warn).
- **FR-012**: When the algorithm version changes, a link stamped under a
  version DocGuard still supports MUST be recomputed under that version. A
  match is current and needs a restamp (info). A link stamped under an
  unsupported version is unverifiable (warn). Neither case is suspect.
- **FR-013**: In Go, the pattern tier MUST emit a token wherever the language
  inserts a statement terminator. Kotlin, Swift and Ruby MUST do so on a
  documented best-effort basis.
- **FR-014**: A requirement fingerprint MUST cover the whole requirement
  block: from its declaration to the next requirement declaration, the next
  heading, or the end of its list item.
  - Normalization: Unicode NFC, unified line endings, collapsed whitespace
    runs.
  - It MUST exclude the implementation-outcomes block and review stamps.
  - Requirement parsing MUST expose the whole block as a new `block` field,
    which fixes the first-line-only capture at
    `cli/shared-requirements.mjs:76`. The existing `text` field stays the
    first line, because the traceability TF-IDF hint and preflight's overlap
    detection depend on it.
- **FR-015**: The doc-dependency lock and requirement anchors MUST share one
  fingerprint implementation. The doc lock MUST gain batched Python parsing,
  nested symbol lookup and parser-versioned tiers. It MUST report an
  interpreter change as unverifiable, never DLK001. Existing doc-lock entries
  MUST keep comparing as current on this repository, either because their
  fingerprints are unchanged or through FR-012.

#### Anchor lock

- **FR-016**: Reviewed state MUST live in a committed anchor lock, separate
  from `.docguard-specs.json` and `.docguard-doc-lock.json`.
  - One entry per line, sorted by key, serialized deterministically, and
    validated against a published schema.
  - The key is: requirement identity + file + anchor (symbol path, statement
    or route) + scope, joined by `|`. Any `|` or `%` inside a part is
    percent-encoded.
  - An entry records:
    - the exact and floor code fingerprints, and the requirement fingerprint;
    - the fingerprints they replaced;
    - the state: baselined or reviewed;
    - the revision, date and reason;
    - the bulk flag.
- **FR-017**: The lock is meant to merge with `merge=union`.
  - When `.gitattributes` does not declare it, `anchors` MUST show a note
    giving the exact line.
  - `anchors accept --gitattributes` MUST add the line in the same
    transaction. Without that flag, DocGuard MUST NOT modify `.gitattributes`
    (Constitution VI).
  - A key that appears twice with different content MUST read as suspect and
    produce a finding naming both entries.
  - The shapes of `.docguard-specs.json` and `.docguard-doc-lock.json` MUST
    NOT change.
- **FR-018**: A lock that fails to parse, or whose schema version is
  unsupported, MUST produce one error finding and MUST NOT count as "all
  current".

#### States and findings

- **FR-019**: Every link MUST have exactly one state, plus a reason where one
  applies:

  | State | Meaning |
  |---|---|
  | unreviewed | No lock entry yet |
  | baselined | Stamped at adoption, never reviewed |
  | reviewed | Accepted with a reason |
  | suspect | Code side, requirement side, or both |
  | lost | A baselined or reviewed link whose tag is gone while its requirement still exists |
  | moved | Review carried over after a rename or move (US4) |
  | retired-target | The requirement belongs to a retired or superseded spec |
  | unverifiable | No tier comparison is possible |

- **FR-020**: These finding codes MUST be added to the finding catalog. Each
  MUST name the requirement, file, anchor and tier, and code-side suspects
  MUST include a command that shows the change. ANC001 and ANC003 become
  errors only under FR-028.

  | Code | Condition | Severity | Disposition |
  |---|---|---|---|
  | ANC001 | Code-side suspect | warn | escalate |
  | ANC002 | Requirement-side suspect | warn | escalate |
  | ANC003 | Lost | warn | escalate |
  | ANC004 | Unreviewed link in a project that has a lock | info | escalate |
  | ANC005 | Lock unreadable or unsupported | error | act |
  | ANC006 | Ambiguous or unresolved scope | info | act |
  | ANC007 | Tag cites a requirement that does not exist | warn | act |
  | ANC008 | Tag cites a retired or superseded requirement | warn | act |
  | ANC009 | Conflicting duplicate lock key | warn | act |
  | ANC010 | Tier unavailable, unverifiable, or stale cache | warn | escalate |

#### Commands and writes

- **FR-021**: `docguard anchors` MUST list every link with its state, scope,
  tier and anchor. It MUST support `--format json`, `--spec <id>` and
  `--state <state>`.
- **FR-022**: Clearing goes through
  `docguard anchors accept --link <key>|--spec <id>|--file <path> --reason <text>`:
  - The reason MUST be at least 10 characters.
  - An accept that affects more than one link MUST require `--bulk`.
  - The write MUST go through `commitFileTransaction`.
  - The accept MUST re-fingerprint and refuse to write when the code it read
    changed during the run.
  - It MUST record the replaced fingerprints.
  - `--remove <key>` resolves a lost link.
  - `--spec <id>` selects every link of that spec except lost and
    retired-target links. `--file <path>` does the same for one file. Either
    one needs `--bulk` when it matches more than one link.
- **FR-023**: `anchors accept --baseline --bulk --reason` MUST stamp every
  unreviewed link as baselined. Baselined links MUST NEVER count as reviewed
  in any score, export or report. The baselined share MUST be reported.
- **FR-024**: Only `anchors accept` and `anchors disposition` MAY write the
  anchor lock. `sync`, `fix --write`, `generate`, `specs complete`, MCP tools
  and agent skills MUST NOT write it.
- **FR-025**: DocGuard MUST state, in its output and its documentation, that it
  records reasons and bulk flags but does not authenticate who accepted. The CI
  recipe MUST show a CODEOWNERS entry for the anchor lock so that the forge
  enforces human review.

#### Activation and CI policy

- **FR-026**: The feature MUST activate only when the project has an anchor
  lock or sets `anchors.enabled`. Otherwise guard output and exit status MUST
  be byte-identical to the previous release, with two exceptions:
  - the validator list and timings;
  - findings that change only because FR-005 no longer counts tags inside
    literals. The changelog lists these.
- **FR-027**: A reproducible replay MUST measure suspect churn on this
  repository:
  - over at least the last 100 first-parent commits;
  - with the lock baselined at the start;
  - counting code-side suspects and lost links per commit;
  - classifying each flag as formatting-only when every whitespace-insensitive
    diff hunk inside the anchored span is empty or touches only comments, and
    as code-changing otherwise.

  The result MUST be committed as evidence.
- **FR-028**: `anchors.failOn` MUST accept `none` and `reviewed-exact`.
  - Under `reviewed-exact`, ANC001 and ANC003 are errors only for links that
    are symbol, statement or route scope, exact tier, and reviewed.
  - The default MUST be `reviewed-exact` only if the FR-027 evidence shows zero
    formatting-only flags among exact-tier links. Otherwise it is `none`, and
    the outcome is recorded in this spec.
  - ANC002 MUST never be an error.
- **FR-029**: During `specs complete --id X`, anchor findings for X's own links
  MUST NOT count toward SPC007. The completion output MUST list them with
  their accept commands.

#### Rename, move and ripple

- **FR-030**: A reviewed entry whose anchor no longer resolves MUST carry over
  as moved, at runtime only, when exactly one unreviewed link exists with the
  same requirement and the same code fingerprint. Otherwise it is lost. No
  similarity matching is used.
- **FR-031**: For a changed anchored symbol in a file with an import graph
  (JS/TS, Python), ripple notes at info severity MUST name links in importing
  files that reference the changed exported name.
  - The depth limit and reverse-import walk MUST be shared with
    `diff --since`.
  - Fan-out above a documented limit MUST collapse into one summary.
  - Ripple never fails.
  - Languages without an import graph report "unavailable".

#### Test chain

- **FR-032**: For each code-side suspect, test references (`@req`, `@covers`)
  to the same requirement MUST be listed as needing re-verification.
- **FR-033**: A saved-report adapter MUST read a TestGuard evidence file
  without executing anything.
  - Tests are re-verified only when the evidence's recorded revision carried
    the anchored code at today's fingerprint, a claim's structured source
    reference names the requirement, and its faults were killed.
  - Unreadable, stale or unstructured evidence is inconclusive, with a reason.
  - DocGuard MUST NOT run tests.

#### Orphans, granularity, export, interop

- **FR-034**: `anchors --orphans` MUST list each untagged exported or
  top-level symbol under the governed source paths once, in deterministic
  order. The governed paths are a spec's `scope.sourcePaths` or
  `anchors.orphanPaths`.
- **FR-035**: `anchors disposition --symbol <key> --kind derived|dead|infrastructure
  --reason <text>` MUST record a disposition in the anchor lock. DocGuard MUST
  NOT propose requirement text and MUST make no LLM call.
- **FR-036**: `score` and `trace` MUST report anchor granularity (links by
  scope and tier) at info level only.
- **FR-037**: `trace --matrix --format csv|reqif` MUST export
  requirement → anchor → test links with scope, tier, state and fingerprints,
  in deterministic order. The CSV columns MUST be documented. ReqIF output MUST
  be well-formed and follow the ReqIF 1.2 structure. `--output` MUST write
  through the safe-write path.
- **FR-038**: The `anchors.import` setting MUST enable read-only StrictDoc
  `@relation(...)` and OpenFastTrace `[impl->…]` tags through a configured ID
  mapping.
  - Foreign tags are never written.
  - An unmapped ID produces a finding.
  - A symbol that carries native and foreign tags for different requirements
    produces a finding.
  - An OFT revision mismatch is treated as code-side suspect.

#### Determinism, performance, safety

- **FR-039**: Golden fixtures MUST fix the expected fingerprints for each
  language, tier and parser version. The suite MUST fail on any change until
  the algorithm version is bumped.
- **FR-040**: A CI-only oracle job MUST install tree-sitter at exact versions
  with integrity hashes, without adding a package dependency.
  - Every oracle package MUST meet Constitution II's criteria: published on
    the official registry, more than 10k weekly downloads, more than one
    maintainer, first published more than 30 days earlier, exact-pinned.
  - A language whose grammar fails those criteria has no oracle and stays low
    confidence.
  - The job compares pattern-tier spans with tree-sitter spans on the
    fixtures and a pinned corpus, and reports per-language agreement.
  - It fails only when disagreement exceeds 1% for a language the spec marks
    high confidence. Low-confidence languages are reported, never failed.
- **FR-041**: Only files that contain a tag (pre-filtered by a text scan) and
  files named in the lock MAY be parsed.
  - Each file is parsed at most once per run.
  - A per-file cache MAY live in the state directory, keyed by a hash of the
    working-tree bytes plus the tier and algorithm versions.
  - The cache MUST be ignored when any cache file is tracked by git, in CI,
    and with `--no-cache`.
  - Guard's wall time on this repository MUST stay within the non-regression
    budget.
- **FR-042**: The documentation MUST cover the tag grammar, scopes, tiers,
  states, findings, commands, configuration, lock format, CI recipe and
  security notes. That means README, `docs/commands.md`,
  `docs/configuration.md`, ARCHITECTURE, DATA-MODEL, SECURITY, TEST-SPEC,
  CI-RECIPES and the findings reference.
- **FR-043**: This repository MUST adopt the feature: baseline its lock, add
  the CODEOWNERS entry, run and commit the FR-027 replay, and move every tag
  that today sits inside a function body or above an unrelated statement to an
  explicit scope.

### Key Entities

- **Tag**: a comment that cites one requirement, with an optional scope block.
- **Anchor**: what a tag binds to: a file, a qualified symbol, a statement or a
  route, plus the tier that resolved it.
- **Link**: a (requirement, anchor) pair with a state.
- **Fingerprint**: a versioned, tier-labelled hash of normalized code or
  requirement text. Each link has an exact code fingerprint, a floor code
  fingerprint, and a requirement fingerprint.
- **Lock entry**: the reviewed or baselined state of one link: fingerprints,
  replaced fingerprints, revision, date, reason and bulk flag.
- **Disposition**: a recorded classification of an untagged symbol (derived,
  dead, infrastructure) with a reason.
- **TestGuard evidence**: a saved report produced outside DocGuard. It is read
  only, and only with its input hashes checked.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the golden fixtures, five formatting-only edits (re-indent,
  added comments, trailing commas, quote style, blank lines) produce 0
  suspects in exact tiers. A one-token semantic edit inside one anchored
  symbol produces exactly 1 suspect for its links, and 0 for every other
  link.
- **SC-002**: A project without an anchor lock or `anchors.enabled` produces
  byte-identical `guard --format json` output before and after, apart from the
  validator list, timings, and the listed FR-005 literal-tag differences.
- **SC-003**: Guard's wall time on this repository, with its lock baselined,
  stays within the non-regression budget (×1.15 of base).
- **SC-004**: An accept recorded for A→B never covers C. A later change always
  re-flags the link.
- **SC-005**: The committed replay over at least 100 commits reports the
  formatting-only false-suspect rate among exact-tier links. The failure
  default follows FR-028 from that number.
- **SC-006**: A spec whose own links are suspect can be completed. Completion
  lists them, and no deadlock is possible.
- **SC-007**: On the reference corpus, the pattern tier agrees with tree-sitter
  on at least 99% of symbol spans for Go, Rust and Java. Each language below
  99% is marked low confidence.
- **SC-008**: This repository's requirement evidence counts are unchanged
  apart from the documented string-literal false tags.
- **SC-009**: Renaming and moving an anchored function with an unchanged body
  yields 0 suspects and 0 lost links. Deleting a requirement's only anchor
  yields exactly 1 lost link.
- **SC-010**: In the ReqIF and CSV exports, each requirement, anchor and link
  appears exactly once, in byte-identical order across two runs.

## Assumptions

- Tags in code remain the declaration surface. The anchor lock holds only
  review state, so the code stays the source of which code implements what.
- Human sign-off is the forge's job: CODEOWNERS and branch protection on the
  anchor lock. DocGuard records reasons and bulk flags and says plainly that it
  authenticates nobody.
- The tree-sitter tier is not a package dependency (Constitution II). It is
  opt-in, user-installed, and hash-checked, and it runs in DocGuard's own CI
  only as an oracle.
- The TestGuard companion spec, which makes the claim `source.ref` a
  structured `specId#FR-NNN`, ships in the TestGuard repository. Until it
  does, US6 reports unstructured evidence as inconclusive.
- Python's `ast` and Babel stay optional. When they are absent, extraction
  drops to the pattern or file tier and says so (Constitution II, IX).

## Out of Scope

- Similarity or fuzzy re-linking, function-level call graphs, and SCIP or LSIF
  ingestion.
- Any LLM call, and any proposal of requirement prose (Constitution V).
- Authenticating reviewers.
- Anchoring macro-generated or metaprogrammed symbols beyond the statement
  that generates them.
- Changes to TestGuard itself. The companion spec covers those.
- Inferring links at guard time.
