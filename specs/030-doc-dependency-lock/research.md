# Research: Doc Dependency Lock

## Decision 1: What signal says "the code this section describes changed"

| Signal | Same-size semantic edit (`30`→`90`) | Formatter reflow | Line move | Comment edit | Needs history |
|---|---|---|---|---|---|
| Line count | missed | false alarm | missed | false alarm | no |
| File size | missed | false alarm | missed | false alarm | no |
| mtime | caught | false alarm | caught | false alarm | no, but git checkout does not preserve it, so CI always sees "changed" |
| sha256 of file bytes | caught | false alarm | false alarm | false alarm | no |
| git blob ID | same as sha256 | | | | needs git |
| **Normalized AST of the named symbol** | **caught** | **ignored** | **ignored** | **ignored** | **no** |

**Decision:** Hash the normalized AST of the named symbol (JS/TS via the
existing `js-ast.mjs`; Python via `ast.dump` when `python3` exists), and fall
back to a sha256 of the file's bytes. Each fingerprint records its tier, so a
reader knows how precise it is.

**Why not line counts** (the maintainer's first idea): the drifts that matter
are exactly the same-size ones. SC-004 keeps this demonstrated by a test.

**Normalization** reuses Diff-Suspicion's rule (`diff-suspicion.mjs:117-129`):
strip `start`, `end`, `loc`, `extra`, comments, tokens and errors, and keep
every semantic field. Diff-Suspicion already relies on it to decide whether a
diff was semantic.

## Decision 2: Where the declaration and the state live

- **Declaration next to the prose** (`covers=` on the section marker). It is
  reviewed in the same PR as the text it justifies, and it says which code the
  prose depends on.
- **State in an external lockfile**, never in code comments. Code comments
  would have to hash themselves out, would change on every edit, would conflict
  across branches, point the wrong way (one file is described by many docs),
  and could be bumped without a review. This mirrors `.docguard-specs.json`:
  reviewed fields change only through explicit commands (#435 taught that a
  derived field must not flip a verdict).

## Decision 3: No git history required

Squash merges, rebases and `fetch-depth: 1` CI clones cannot resolve an old
revision. Fingerprints compare content, so they work without history. The
recorded revision is used only to print `git diff <rev> -- <path>` when it
resolves.

## Decision 4: What the DeepWiki family teaches

- **DeepWiki** (Cognition): no confirmed vector index. It regenerates about
  weekly, so its wiki can be a week stale by design.
- **OpenDeepWiki**: diffs files since `LastCommitId`, then an LLM agent decides
  which docs to touch. The lock makes that decision deterministically, and
  exactly.
- **Cursor**: a Merkle tree of file hashes for incremental re-indexing. The glob
  fingerprint (a sorted list of per-file fingerprints) is the same idea at the
  scale DocGuard needs.
- **Rejected:** embeddings and vector databases. They need a model (network
  access or a heavy dependency), results shift with the model version, a stale
  index fails silently, and they break Constitution VIII (local-first) and the
  zero-dependency rule. Claude Code dropped its local vector index for agentic
  search for the same reasons.

## Decision 5: Opt-in and additive

No `covers` means no lock and no new findings, with byte-identical output
(FR-007, SC-002). FRS002 stays the fallback for documents that declare nothing.
Suppressing FRS002 for covered documents was considered and rejected: prose
outside covered sections can still drift, and FRS002 is the only signal for
it.
