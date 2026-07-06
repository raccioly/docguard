# Bolt — performance learnings

> ⛔ **STOP / DO-NOT-DUPLICATE.** Before opening ANY PR, search existing **open
> AND closed** PRs. Dozens of duplicate "optimize diffTests / Set cross-compare
> / precompute toLowerCase / pre-compile RegExp" PRs were closed as noise.
> **Do NOT open another micro-optimization PR** unless you include a **benchmark
> showing >20% wall-clock improvement on a realistic workload** (a real repo,
> not a synthetic loop). A theoretical Big-O note is NOT sufficient justification.

## ✅ APPLIED / EVALUATED — the recurring diff & scan optimizations (do NOT re-open)

The learnings below have already been applied where they helped, and the
affected code (`cli/commands/diff.mjs`, `cli/validators/*`, the scanners) was
substantially **refactored in v0.29–v0.30** — PRs written against the old shape
no longer apply and just create merge noise.

- **Early-return in `checkUntrackedTodos`** — already in place.
- **Precompute `.toLowerCase()` / `.substring()` outside loops** — applied where
  it mattered; the remaining cases are not hot paths.
- **Pre-compile `RegExp` outside nested loops** — applied in the scanners.

These are recorded as historical context, **not** as standing mandates to
re-scan for on every run. The DocGuard test suite (898 tests) and CI already
guard against regressions here.
