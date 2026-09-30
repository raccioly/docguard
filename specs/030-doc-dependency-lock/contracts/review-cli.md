# Contract: `docguard review`

```text
docguard review [--format json]
docguard review --accept <doc>#<section-id> --reason <text>
docguard review --accept <doc> --reason <text>        # every covered section of one doc
docguard review --prune
docguard review --suggest <doc> [--format json]
```

| Invocation | Writes | Exit |
|---|---|---|
| `review` | nothing | 0 all current; 2 any section changed, missing a dependency, unaccepted or orphaned; 1 lock unreadable |
| `--accept` | `.docguard-doc-lock.json` via `commitFileTransaction` | 0 written; 1 missing `--reason`, unknown section, or a dependency that does not resolve |
| `--prune` | same file, removes orphaned entries only | 0 |
| `--suggest` | nothing | 0 |

JSON (`review --format json`):

```json
{ "status": "CHANGED", "sections": [ { "key": "doc#id", "state": "changed", "dependencies": [ { "ref": "path#sym", "tier": "ast", "state": "changed", "diff": "git diff 542b9c5 -- path" } ] } ] }
```

Guard findings DLK001–DLK005 carry the same `key`, `ref` and `diff` fields in
`evidence`.
