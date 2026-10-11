# Contract: `docguard anchors`

## Synopsis

```text
docguard anchors [--spec <id>] [--state <state>] [--file <path>] [--format text|json] [--no-cache]
docguard anchors --orphans [--spec <id>] [--format text|json]
docguard anchors accept (--link <key> | --spec <id> | --file <path>) --reason <text> [--bulk] [--gitattributes]
docguard anchors accept --baseline --bulk --reason <text> [--gitattributes]
docguard anchors accept --remove <key> --reason <text>
docguard anchors disposition (--symbol <file>#<anchor> | --file <path> --bulk) --kind derived|dead|infrastructure --reason <text>
docguard anchors disposition --remove <file>#<anchor> --reason <text>
docguard trace --matrix --format csv|reqif [--output <path>]
```

## Listing: `--format json`

```json
{
  "command": "anchors",
  "status": "PASS|WARN|FAIL",
  "activated": true,
  "lock": { "path": ".docguard-anchor-lock.jsonl", "exists": true, "entries": 664, "error": null },
  "summary": {
    "links": 664,
    "byState": { "unreviewed": 0, "baselined": 640, "reviewed": 20, "suspect": 3, "lost": 1 },
    "byScope": { "file": 405, "symbol": 230, "statement": 15, "route": 14 },
    "byTier": { "babel@7": 600, "python-ast@3.12": 0, "pattern@1": 36, "file": 28 },
    "baselinedShare": 0.96
  },
  "links": [
    {
      "key": "acme.billing#FR-003|src/pricing.mjs|applyDiscount|symbol",
      "requirement": "acme.billing#FR-003",
      "file": "src/pricing.mjs", "anchor": "applyDiscount", "scope": "symbol",
      "tier": "babel@7", "confidence": "high", "span": { "start": 12, "end": 30 },
      "state": "suspect", "side": "code",
      "diffCommand": "git diff 1a2b3c4d5e6f -- src/pricing.mjs",
      "acceptCommand": "docguard anchors accept --link 'acme.billing#FR-003|src/pricing.mjs|applyDiscount|symbol' --reason \"<what you checked>\"",
      "ripple": [ { "file": "src/cart.mjs", "via": "src/pricing.mjs", "hops": 1, "links": ["acme.cart#FR-001|src/cart.mjs|total|symbol"] } ],
      "tests": [ { "file": "tests/pricing.test.mjs", "line": 40, "status": "needs-reverification" } ]
    }
  ],
  "notes": ["DocGuard records reasons and bulk flags; it does not authenticate who accepted. Require review of .docguard-anchor-lock.jsonl through CODEOWNERS."]
}
```

- `activated` is false when there is no lock and no `anchors.enabled`. In that
  case `links` is still computed for `anchors`, but `guard` reports nothing
  (FR-026).
- `ripple` appears from US5, and `tests` from US6.

## Orphans: `--orphans --format json`

```json
{
  "command": "anchors --orphans",
  "governed": { "source": "anchors.orphanPaths", "paths": ["src"] },
  "files": 12, "symbols": 40,
  "orphans": [ { "file": "src/billing.mjs", "anchor": "refund", "line": 6, "kind": "function", "tier": "babel@7", "disposition": null } ],
  "undispositioned": 1,
  "staleDispositions": [ { "key": "disposition|src/old.mjs|f", "file": "src/old.mjs", "anchor": "f", "kind": "dead", "date": "2026-10-11", "why": "no untagged symbol by that name any more (tagged, renamed or removed)" } ],
  "notes": []
}
```

- A candidate is a function, class, struct, enum or top-level method. JS/TS
  lists exports (named, default, or a local name in an export list; never a
  re-export or a type), or the top-level functions and classes of a module
  that exports nothing. Python skips `_names`, Go lowercase names, Rust items
  without `pub`, C `static`, and Java, Kotlin, C# and Swift `private`,
  `internal` and `fileprivate` items.
- A file-scope link covers every candidate in its file. A link at `X`, `X.m`,
  `X#2`, `X(sig)` or a statement inside `X` covers `X`.
- Order: file, then line, then name. The listing exits 0.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `anchors` (list) | no warn or error | an error-level finding (ANC005, or ANC001/ANC003 under `failOn`) | warnings only |
| `anchors accept`, `disposition` | written | refused: bad args, missing reason, `--bulk` required, bytes changed during the run, transaction failure | — |

## Write rules

- Only `anchors accept` and `anchors disposition` write the lock (FR-024).
- Every write goes through one `commitFileTransaction`. That transaction
  modifies `.gitattributes` only with `--gitattributes`, by appending
  `.docguard-anchor-lock.jsonl merge=union` when it is absent. Otherwise the
  listing's `notes[]` gives the line to add.
- The reason is 10–500 characters, after trimming.
- **Selection**:
  - `--link` selects one link.
  - `--spec` selects every link of the spec except lost and retired-target
    links.
  - `--file` selects every link in the file except lost and retired-target
    links.
- `--bulk` is required when the selection resolves to more than one link.
  `--baseline` requires `--bulk`.
- A selection that matches nothing is an error, and nothing is written.

## MCP

`docguard_anchors` is a read-only tool with the same JSON as the listing,
bounded to 200 links plus the summary. It cannot write.
