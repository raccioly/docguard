---
description: "Review implementation evidence and plan the spec completion transaction"
allowed-tools: Bash, Read
---

# DocGuard Spec Completion Review

Run after implementation or convergence. This hook plans the lifecycle gate; it
does not mark the feature verified without a reviewed rationale.

1. Resolve the current feature `spec.md` and read its `Spec ID` metadata.
2. Run `docguard guard --format json`. Stop on errors.
3. Refresh deterministic evidence with `docguard specs --write`, then review and
   commit that projection with the implementation.
4. Select the Git baseline that covers the implementation changes. Prefer the
   registry's prior reconciliation revision; otherwise use the feature branch's
   merge base with its configured default branch.
5. Run:

```bash
docguard specs complete --id <spec-id> --since <ref> --check --format json
```

6. Review every reconciliation classification. Unsupported or ambiguous changes
   block completion. A possible implementation regression requires deciding
   whether to fix code, amend approved intent, or record an accepted deviation.
7. When the evidence is complete, present the exact reviewed write command to
   the maintainer. Apply it only when the maintainer supplies the rationale:

```bash
docguard specs complete --id <spec-id> --since <ref> --write --reason "<reviewed outcome>"
```

The write atomically records the outcome, advances delivery through
`implemented` to `verified`, and regenerates `.docguard/current-context.json`.
