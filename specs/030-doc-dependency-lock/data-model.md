# Data Model: Doc Dependency Lock

## Section declaration (in a Markdown document)

```markdown
<!-- docguard:section id=pricing source=human covers="src/pricing.mjs#discount, src/rules.mjs" -->
Prose describing how discounts are applied.
<!-- /docguard:section -->
```

- `id`: unique within the document.
- `source=human`: `sync` never writes it (existing rule).
- `covers`: comma-separated entries.
  - `path`: one file, fingerprinted by content.
  - `path#symbol`: a named export, function, class or variable declaration.
  - a glob (`dir/**/*.mjs`): the matching files.

  Paths are relative to the project root. Absolute paths, `..` and symlinks are
  refused.

## `.docguard-doc-lock.json`

```json
{
  "schemaVersion": 1,
  "sections": {
    "docs-canonical/ARCHITECTURE.md#pricing": {
      "reviewedRevision": "542b9c5…",
      "reviewedAt": "2026-09-29",
      "reason": "Prose matches the discount rule after the threshold change",
      "dependencies": {
        "src/pricing.mjs#discount": { "tier": "ast", "fingerprint": "sha256:…" },
        "src/rules.mjs": { "tier": "content", "fingerprint": "sha256:…" }
      }
    }
  }
}
```

- Keys are sorted at every level, with a trailing newline, so diffs stay
  minimal.
- `tier` is `ast`, `python-ast`, `content` or `glob`.
- `reason` is 8–500 characters and required.
- `reviewedRevision` is a git object ID, or `null` outside git.

## States (per section)

| State | Condition | Finding |
|---|---|---|
| current | every fingerprint matches | none |
| changed | at least one fingerprint differs | DLK001 (escalate) |
| missing-dependency | a covered path or symbol no longer resolves | DLK002 (warn) |
| unaccepted | section declares `covers`, no lock entry | DLK003 (warn) |
| orphaned | lock entry, no such section | DLK004 (warn) |
| unreadable lock | parse or schema failure | DLK005 (error), once |

Transitions: `review --accept` moves any state except orphaned to current.
`review --prune` deletes orphaned entries. Code or doc edits move a section to
changed, missing-dependency or orphaned.
