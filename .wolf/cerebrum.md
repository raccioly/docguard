# Cerebrum — docguard-cli

> OpenWolf learning memory for **docguard-cli** — the enforcement tool for Canonical-Driven Development (CDD). Audits, generates, and guards project documentation.
> Last updated: 2026-06-02

## User Preferences

- On field/bug reports, Ricardo prefers **"triage & verify first"** over jumping to fixes — confirm each item against current code (reproduce where possible) and explicitly challenge the report's own stated root-cause before writing any fix. (Chosen on the websec-validator field report, 2026-06-02.)

## Key Learnings

- **Ignore wiring map (as of fcc7264):** all `shared-ignore` consumers — incl. `routes.mjs:90` and `todo-tracking.mjs:307,383` — call `shouldIgnore`. `project-type.mjs` did NOT until the B1b fix (2026-06-02): its `walk()` in `findManifests` now honors config.ignore (prunes dirs + skips manifest files via shouldIgnore). It detects frameworks from **dependency manifests** (`has(deps,'express'/'flask')`), so before the fix it ingested fixture `package.json`/`requirements.txt`. Two different mechanisms: glob filtering on results vs. `DEFAULT_IGNORE_DIRS` (bare dir-name Set) during walks.
- **`globToRegex` (shared-ignore.mjs:115) silently mishandles trailing-slash dir patterns.** Verified by execution: `buildIgnoreFilter(['tests/'])('tests/fixtures/x.js')` → `false`; `['tests']` and `['tests/**']` → `true`. Gitignore-style `dir/` (the natural form) matches nothing. This makes ignore look wired-but-broken across every consumer. (Fixed 2026-06-02 by stripping the trailing slash.)
- **The dispatcher (docguard.mjs) installs DocGuard's own agent tooling as a side effect.** `ensureSkills()` runs on every command except `setup`/`init` and except when `headless` (= jsonMode||write||checkOnly||changedOnly||quiet||plan after the B4 fix). It writes `.agent/skills` + `.agent/commands` and can spawn the `specify` CLI (→ `.specify/` + pip/npm). So read-shaped commands must be added to the `headless` set to stay side-effect-free. `headless` is consumed in exactly two places: the banner and this ensureSkills gate.

## Do-Not-Repeat

- **2026-06-02** — Don't trust a bug report's stated root cause. The websec B1 report blamed "scanners/validators skip the ignore file"; the real defect was the trailing-slash glob (above). Fixing per the report ("centralize ignore handling") would have changed nothing AND left a false-green — the exact failure mode this tool exists to prevent.
- **2026-06-02** — Don't assume a documented CLI flag is wired. `--fix` is documented (`docguard.mjs:111` "Auto-create missing files from templates") and set (`:186`) but read **nowhere** — `init.mjs` never consumes `flags.fix`. `grep` the flag's *consumption*, not just its declaration.
- **2026-06-05** — Release CI gotchas (cost a failed v0.25.0 publish, then fixed): (1) `.github/workflows/release.yml`'s `test` job was MISSING `npm ci`, so `@babel/parser` (a regular dep) was absent and all 20 AST tests failed. It stayed latent because `detect-version` skips the job unless a release is due — so the job had literally never run. (2) `release.yml` is `paths`-filtered to `package.json`, so a workflow-only fix commit does NOT re-trigger it — use `gh workflow run release.yml --ref main` (the `workflow_dispatch` recovery trigger). (3) The `docguard watch` and `auto-fix prompts` CLI-spawn tests are CI-FLAKY (failed once on a2684e4, passed on identical-code re-run + locally) — a re-run, not a real failure.

## Decision Log

- **2026-06-02** — Triage-only pass on the websec-validator field report (no code changed, user's choice). Outcome that justified it: B1's reported root-cause was wrong (glob bug, not wiring), B4 is real-on-main via the dispatcher's `ensureSkills` (not the `--plan` code), B6 is partly-fixed/deferred-by-design. Full verified fix-list lives in the cross-session memory `websec-field-feedback-triage.md`.
- **2026-06-03** — F1 scope: **flag, don't suppress.** For scanner/tool false-positives, generate marks auto-extracted surface 'low' confidence for non-web kinds (cli/library/unknown) but never removes it from guard — suppressing a real surface would be a false-green, the failure mode this tool exists to prevent. User chose this over require-import (which risks false-negatives).
- **2026-06-03** — F3 scope: added `cli`/`library` **profiles** (non-web required sets) as the contained fix for the web-app-centric doc model. Deliberately did NOT build a bespoke `CLI-REFERENCE` doc *type* (template + documentTypes registry + TRACE_MAP + memory-plan + writer = 5+ files) — that's a separate larger feature. Until then `library` reuses API-REFERENCE as the module-API doc.
- **2026-06-03** — Pattern for non-trivial validator tests: provoke the deterministic always-emitted section (`tech-stack` in ARCHITECTURE, `memory-plan.mjs:243`) and assert with a **control** (unpinned→stale) + **fix** (pinned→exempt). Same control discipline used for B4 (.agent created by full generate, not by --plan) and F1 (cli→low, api→normal). Keeps tests non-vacuous.
