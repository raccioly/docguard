# Data Model: Requirement Anchors and Suspect Links

## Tag (in source code)

```js
/** @implements acme.billing#FR-003 */                   // positional scope
// @implements acme.billing#FR-004 {scope=statement}     // explicit scope
# @req FR-007                                            # Python / shell / YAML
```

| Field | Rule |
|---|---|
| verb | `implements`, `req` or `covers`. Anchors come only from `implements` and `req` in non-test files. `covers`, and any tag in a test file, is test evidence |
| requirement | `<specId>#<REQ>`, `<path>#<REQ>` (spec 027), or a bare `<REQ>` resolved as today (`resolveRequirementReferences`) |
| scope block | optional `{scope=file\|symbol\|statement\|route}`. Unknown key → ANC006, tag stays file scope |
| arity | one requirement per tag. Extra comma-separated IDs → ANC006, first ID kept |

Full grammar: [contracts/tag-grammar.md](contracts/tag-grammar.md).

## Anchor

| Field | Example | Notes |
|---|---|---|
| `file` | `cli/scanners/anchors.mjs` | POSIX, project-relative |
| `scope` | `symbol` | file, symbol, statement or route |
| `anchor` | `computeLinks`, `Outer.inner`, `run>stmt:docguard.x#FR-002#1`, `route:POST /login`, `*` (file) | the qualified path (plan, "Tag extraction") |
| `tier` | `babel@7` | the tier that resolved the span |
| `confidence` | `high` | `low` for C/C++ pattern spans and any fallback |
| `span` | `{start: 120, end: 168}` | 1-based lines including decorators. Output only, never stored |

## Link

A (requirement, anchor) pair. The key is
`<requirement>|<file>|<anchor>|<scope>`, with `|` and `%` percent-encoded
inside parts, for example
`acme.billing#FR-003|src/pricing.mjs|applyDiscount|symbol`.

## Fingerprints

| Kind | Form | Covers |
|---|---|---|
| exact code | `dg1:sha256:<64 hex>` + tier | the normalized AST of the span (rules: [contracts/fingerprint.md](contracts/fingerprint.md)) |
| floor code | `dg1:sha256:<64 hex>`, tier `pattern@1` | the pattern-token stream of the same span, always computed |
| requirement | `dg1:sha256:<64 hex>` | the normalized requirement block |

The `dg1` prefix is the algorithm version. The doc lock keeps its own
`sha256:` form (`doclock-v0`).

## Anchor lock entry (`.docguard-anchor-lock.jsonl`)

Format: [contracts/anchor-lock.md](contracts/anchor-lock.md).

| Field | Type | Rule |
|---|---|---|
| `key` | string | the link key; unique per file |
| `requirement`, `file`, `anchor`, `scope` | string | the parts of the key, kept for readability and validation |
| `tier` | string | the exact tier at accept time |
| `code`, `floor`, `req` | fingerprint | at accept time |
| `prev` | `{code, floor, req}` or null | the fingerprints this accept replaced (SC-004 audit) |
| `state` | `reviewed` or `baselined` | only these two are stored. Every other state is derived |
| `revision` | 40/64-hex or null | HEAD at accept, used only for the diff command |
| `date` | `YYYY-MM-DD` | |
| `reason` | 10–500 chars | required |
| `bulk` | boolean | true when the accept covered more than one link |

### Disposition entry

Same file. The key is `disposition|<file>|<anchor>`, with fields `kind`
(`derived`, `dead` or `infrastructure`), `reason`, `date` and `revision`.

## Derived link states

| State | Finding | Fails under `failOn: reviewed-exact`? |
|---|---|---|
| unreviewed | ANC004 (info), only when a lock exists | never |
| baselined | none; counted in the baselined share | never |
| reviewed | none | — |
| suspect (code) | ANC001 | when the scope is symbol, statement or route, the tier is exact, and the state is reviewed |
| suspect (requirement) | ANC002 | never |
| lost | ANC003 | under the same conditions as ANC001 |
| moved | info note | never |
| retired-target | ANC008 | never |
| unverifiable | ANC010 | never |

Other findings: ANC005 when the lock is unreadable (error, always); ANC006 for
ambiguous or unresolved scope (info); ANC007 for an unknown requirement
(warn); ANC009 for a conflicting duplicate key (warn, and the link reads as
suspect).

### Transitions

- `anchors accept` moves any state except lost and retired-target to
  reviewed. `--baseline` moves unreviewed to baselined.
- A code or requirement edit moves baselined or reviewed to suspect.
- A deleted tag moves baselined or reviewed to lost, or to moved when FR-030
  holds. The failure policy still applies only to reviewed links.
- `--remove` deletes a lost entry, or any entry.
- A re-tag back to a matching fingerprint restores the earlier state at
  runtime. The comparison is stateless, so a revert restores the prior result
  (the IBM ELM property).

## Test-chain view (US6)

For each requirement with a code-side suspect, the view has one row per test
reference: `{testFile, line, status: needs-reverification|re-verified|inconclusive, evidenceHead?, reason?}`.

## Cache (`.docguard/anchors.cache.json`, untracked)

`{schemaVersion, extractor: {algo, tiers}, files: {<path>: {sha256, anchors, comments}}}`.

- Ignored entirely when any path under `.docguard/` is tracked, when `CI` is
  set, or with `--no-cache`.
- Published atomically: a temp file, then a rename.
- Validated on read. A bad cache is ignored and rebuilt.
