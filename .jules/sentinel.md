# Sentinel — security learnings

> ⛔ **STOP / DO-NOT-DUPLICATE.** Before opening ANY PR, search existing **open
> AND closed** PRs and issues. If the topic below is already covered, do NOT
> open another PR — dozens of duplicate command-injection PRs were closed as
> noise. Only open a PR for a **new, unaddressed** finding, with a concrete
> exploit path or failing test as evidence.

## ✅ RESOLVED — Command Injection via execSync (do NOT re-open)

**Status: FIXED and CLOSED. Do not open further PRs about `execSync` / command injection.**

- The real vulnerability (issue #190) was fixed in **v0.21.1** by switching the
  `specify`-spawning path to `execFileSync` (arguments as an array — no shell
  interpolation).
- The last shell-interpolated `execSync` (dead code in `setup.mjs`'s unused
  `isCliAvailable`) was removed in **PR #296**.
- Every remaining `execSync` in `cli/` uses a **static string literal**
  (`git rev-parse …`, `git rev-list --count HEAD`, `git log … | wc -l`) with
  **no variable interpolation** — not injectable. Leave them as-is; do not "fix" them.

Historical note (kept for context, not for re-application): interpolating
`projectDir`/`filePath` into a shell string allowed `;`/`&&`/`||` injection;
`execFileSync` with an args array prevents it. Lesson recorded — already applied.
