---
description: "Gate a generated specification against registry integrity and prior intent"
allowed-tools: Bash, Read, Edit
---

# DocGuard Generated-Spec Preflight

Run after the specification exists and before planning or task generation. The
generated draft is the reviewable artifact that DocGuard can gate.

## User Input

$ARGUMENTS

## Execution

1. Resolve the current feature's `spec.md`. Use an explicit path from the user
   when supplied. Otherwise use the current Spec Kit feature directory; its
   prerequisite script reports `FEATURE_DIR` in JSON. Use the platform-specific
   script under `.specify/scripts/` and append `/spec.md`.

2. Confirm the draft declares a stable metadata field near the top:

```markdown
**Spec ID**: `organization.feature-name`
```

   Add a project-scoped lowercase ID when it is missing. Never reuse an ID from
   the briefing, even when an old spec has moved to Git history.

3. Run the read-only generated-spec gate:

```bash
npx --yes docguard-cli@latest specs preflight --path <feature-spec.md> --format json
```

4. If the result is `BLOCKED`, stop before task generation. Fix duplicate or
   missing identity, broken lineage, unsafe paths, or stale registry state, then
   rerun the same command.

5. Review `overlaps` manually. Similarity has low confidence and never blocks by
   itself. Record a reviewed `extends`, `duplicates`, `conflictsWith`,
   `supersedes`, or `supersededBy` relation only when the underlying intent
   supports it.

6. Continue only when the deterministic status is `READY`. Refresh the registry
   after the draft is accepted so CI observes its current digest and requirement
   identities:

```bash
npx --yes docguard-cli@latest specs --write
```
