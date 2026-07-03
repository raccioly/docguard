# DocGuard Surface Audit

<!-- docguard:quality negation-load off — analytical audit doc: findings are inherently stated as "guard cannot catch X", "names don't telegraph Y"; these negations are the substance, not sloppy phrasing -->

> ⚠️ **HISTORICAL SNAPSHOT — findings resolved.** This audit describes **v0.18.1
> (2026-05-26)** and its counts are NOT current. Its recommendations shipped:
> the `canonical-sync` validator landed in v0.19.0 (command/validator counts are
> now machine-governed — `guard` fails when they drift), and the surface
> consolidation landed in v0.20.0 (21 → 13 commands + deprecation aliases; see
> MIGRATION-v0.20.md). Kept as the worked example of the audit → fix loop.
> **Do not cite counts from this document** — the governed truth lives in
> README.md and is validated on every `guard` run.

> **Status:** Survey only — recommendations, no code changes.
> **Owner:** Ricardo Accioly · **Date:** 2026-05-26 · **DocGuard:** v0.18.1 (v0.19.0 staged but unpushed)
> **Scope:** Every command, every validator, every doc claim about either. The question: did 15 releases of additive work leave us with too many similar verbs for users to learn, and where is the doc-vs-code drift that `guard` can't see today?

---

## 1. Executive Summary

**TL;DR for the busy reader:**

1. **The README counts are wrong in three different ways.** Filesystem says 21 command files; `--help` shows 16 publicly; the README claims "ships 19 commands." `guard` runs 22 validators (note: this audit was conducted before v0.19's canonical-sync validator was added — the post-v0.19 count is 23); only 20 files exist (2 are inlined). Three of those claims I changed in the just-rolled-back v0.19.0 commit were *also* wrong because I trusted the previous README instead of counting.
2. **6 commands exist but `--help` doesn't list them:** `audit` (alias of `guard`), `explain`, `impact`, `llms`, `memory`, `upgrade`. Plus 11 alias variants (`gen`, `repair`, `dx`, `pipeline`, `badges`, etc.) — none documented. Users discover these from release notes if they read them.
3. **The surface is meaningfully wider than the value justifies.** 21 user-facing commands. Three of them (`init`, `setup`, `generate`) all "initialize." Three more (`diff`, `sync`, `impact`) all "show what changed." Four (`agents`, `badge`, `ci`, `hooks`) are one-shot scaffolders that could be sub-modes of `init`. That's ~10 verbs that probably should be ~4.
4. **`guard` cannot catch the README drift today.** `metrics-consistency` only cross-checks doc-to-doc numbers. The truth lives in code (file count, what `--help` enumerates, what `guard` actually runs). We need one new validator — **canonical-sync** — that asserts those code-truth counts match what the docs claim. About 200 lines, fully mechanical.
5. **Recommended path for v0.19.0:** Don't expand the surface further. Ship the **smoke gate + e2e fix + correct counts + canonical-sync validator + surface the 6 ghost commands in `--help`** as v0.19.0. Defer the actual *consolidation* (renames, aliases, deprecations) to v0.20.0 where it's the headline change with a migration guide.

The rest of this doc is the evidence.

---

## 2. Hard Data — What's Actually in the Codebase

### 2.1 Commands

**Filesystem (`cli/commands/*.mjs`): 21 files**

| File | Routes to | In `--help`? | Aliases in router |
|------|-----------|--------------|-------------------|
| `agents.mjs` | `agents` | ✅ Utilities | — |
| `badge.mjs` | `badge` | ✅ Utilities | `badges` |
| `ci.mjs` | `ci` | ✅ CI/CD | `pipeline` |
| `diagnose.mjs` | `diagnose` | ✅ Enforcement | `dx` |
| `diff.mjs` | `diff` | ✅ Analysis | — |
| `explain.mjs` | `explain` | ❌ **ghost** | `help-warning` |
| `fix.mjs` | `fix` | ✅ Utilities | `repair` |
| `generate.mjs` | `generate` | ✅ Getting Started + Memory | `gen` |
| `guard.mjs` | `guard` (also handles `audit` alias) | ✅ Enforcement | `audit` |
| `hooks.mjs` | `hooks` | ✅ CI/CD | — |
| `impact.mjs` | `impact` | ❌ **ghost** | — |
| `init.mjs` | `init` | ✅ Getting Started | — |
| `llms.mjs` | `llms` | ❌ **ghost** | — |
| `memory.mjs` | `memory` | ❌ **ghost** | — |
| `publish.mjs` | `publish` | ⚠️ Experimental | `pub` |
| `score.mjs` | `score` | ✅ Analysis | — |
| `setup.mjs` | `setup` | ✅ Getting Started | `onboard` |
| `sync.mjs` | `sync` | ✅ Memory | — |
| `trace.mjs` | `trace` | ✅ Analysis | `traceability` |
| `upgrade.mjs` | `upgrade` | ❌ **ghost** | `update` |
| `watch.mjs` | `watch` | ✅ CI/CD | — |

**Aggregate: 21 commands · 16 surfaced in `--help` · 5 fully hidden ghosts · 1 experimental · 11 alias variants none of which are documented anywhere.**

The `audit` case still exists in the router (line 526) purely as an alias to `guard`. It's not in `--help`. So technically there are 22 routable command words, but `audit` is just historic compatibility.

### 2.2 Validators

**Filesystem (`cli/validators/*.mjs`): 20 files. `guard` actually runs 22.**

The 2 extras:
- **"Doc Sections"** — exported as `validateDocSections` from `structure.mjs` (same file as Structure validator). Two validators, one file. Defensible — they share a lot of code — but the file name doesn't telegraph it.
- **"Spec-Kit"** — exported as `validateSpecKitIntegration` from `cli/scanners/speckit.mjs`. A "validator" that lives in `scanners/`. **This is architecturally wrong** — scanners are supposed to be passive code-readers; validators are the things that have severity/pass/fail semantics. Moving this to `cli/validators/spec-kit.mjs` is a trivial cleanup.

Full guard-reported list (canonical names):

```
Structure · Doc Sections · Docs-Sync · Drift-Comments · Changelog · Test-Spec ·
Environment · Security · Architecture · Freshness · Traceability · Docs-Diff ·
API-Surface · Metadata-Sync · Docs-Coverage · Doc-Quality · TODO-Tracking ·
Schema-Sync · Spec-Kit · Cross-Reference · Generated-Staleness · Metrics-Consistency
```

22 — matches the README claim on lines 90 and 411. Only the architecture diagram (which I tried to "fix" from `(19)` to `(22)` in the rolled-back commit) was actually right with `(22)`. The `(19)` it started at was the stale one.

### 2.3 Where the truth lives

| Truth | Where to read it |
|------|------------------|
| Real command count | `ls cli/commands/*.mjs \| wc -l` (21) |
| User-facing command count | Count items in the `--help` Getting-Started/Enforcement/Memory/Analysis/CI-CD/Utilities/Experimental sections of `printHelp()` in `cli/docguard.mjs` |
| Real validator count | `runGuardInternal(...).validators.length` (22) — NOT `ls cli/validators/*.mjs \| wc -l` (which is 20) |
| Real validator name list | `runGuardInternal(...).validators.map(v => v.name)` |

This is what the new **canonical-sync** validator should read from, not the filesystem count.

---

## 3. Doc Drift — Every Count Claim, Marked

Run on v0.18.1 / current repo state:

| File:Line | Claim | Reality | Verdict |
|-----------|-------|---------|---------|
| `README.md:90` | "any of the 22 validators" | guard runs 22 ✓ | ✅ Correct (newly added in rolled-back commit) |
| `README.md:238` | "DocGuard ships **19 commands**" | 21 files, 16 in `--help` | ❌ Wrong both ways |
| `README.md:411` | "/docguard.guard … all 22 validators" | 22 ✓ | ✅ Correct |
| `README.md` architecture diagram `Commands (19)` | (in current HEAD it says "Commands (15)") | 21 files / 16 user-facing | ❌ Wrong both versions |
| `README.md` architecture diagram `Validators (22)` | (current HEAD says "Validators (19)") | 22 ✓ | ❌ Current HEAD wrong; rolled-back fix was right |
| `ROADMAP.md:50` | "the zero-dependency CLI tool with **9 validators** and 8 core templates" | Was true for v0.7-ish | ⚠️ Stale (intentional — phase log) |
| `ROADMAP.md:55` | "9 validators: structure, doc-sections, docs-sync, drift, changelog, test-spec, environment, security, architecture" | Was true for v0.7-ish | ⚠️ Stale (intentional — phase log) |
| `ROADMAP.md:102` | "VS Code extension … 6 commands" | Out of scope — VS Code ext is its own repo | n/a |
| `STANDARD.md` | (no count claims found) | n/a | ✅ |
| `PHILOSOPHY.md` | (no count claims found) | n/a | ✅ |
| `COMPARISONS.md` | (no count claims found) | n/a | ✅ |

**Insight:** ROADMAP entries are intentional historical phase logs and should stay. README is the live surface and should match code-truth. STANDARD/PHILOSOPHY/COMPARISONS already abstract over counts — good pattern, no regression risk there.

**The one validator we need (canonical-sync) catches lines 238 and the architecture diagram. That's the entire blast radius for v0.19.0.**

---

## 4. Overlap Matrix — Where the Surface Sprawled

Annotated by intent, not file structure. The right framing: "if I were a new user, would I know which one to reach for?"

### 4.1 Initialization cluster — three commands to start a project

| Command | What it does | Who reaches for it |
|---------|--------------|--------------------|
| `init` | Creates `docs-canonical/` skeleton, `.docguard.json`, optional spec-kit handoff | First-time setup of a *new* project |
| `setup` | Interactive 7-step wizard: project detection → docs → skills → slash commands → agent configs → integrations → hooks | Same first-time setup but with more hand-holding |
| `generate` | Reverse-engineers docs from existing code (the "killer feature") | First-time setup of a *project that already exists* |

**Honest overlap:** `init` is the bare-bones path, `setup` is the wizard, `generate` is the AI-fill-it-in path. Three valid mental models but the names don't telegraph that. A new user reading `--help` sees three "Getting Started" items and has to guess.

**Recommended renaming (v0.20):**
- `init` → unchanged (bare skeleton, the "I know what I want" path)
- `setup` → fold into `init --wizard` (interactive flag, not a separate verb)
- `generate` → `init --from-code` (or keep `generate` as a top-level since the AI integration is the marquee story, but make `init --from-code` an alias so users have a discoverable path)

### 4.2 "What changed" cluster — three commands answer one question

| Command | What it tells you | Granularity |
|---------|-------------------|-------------|
| `diff` | Current snapshot: gaps between docs and code right now | Whole project |
| `sync` | Same data, but *applies* the mechanical fix (`--write`) | Whole project |
| `impact` | "Files changed since `--since`; which doc sections reference any of them?" | Per-changed-file → affected docs |

Defensible separation if you squint: `diff` reports, `sync` writes, `impact` filters by recency. But the names don't telegraph that.

**Recommended renaming (v0.20):**
- Keep `diff` (read-only inspection — clear verb)
- Keep `sync` (write/apply — clear verb)
- Rename `impact` → `diff --since <ref>` (it's a filtered diff, not a different operation). Keep `impact` as a deprecation alias for one release.

### 4.3 Scaffolders cluster — four one-shot writers

| Command | Writes | Re-runs needed? |
|---------|--------|-----------------|
| `agents` | `.cursor/rules/`, `.clinerules`, `.github/copilot-instructions.md`, etc. | Rarely |
| `badge` | Shields.io URL or markdown | Rarely |
| `ci` | GitHub Actions / pipeline YAML | Rarely |
| `hooks` | `.husky/` git hooks | Rarely |

All four are "scaffold this thing once" commands. None of them have ongoing semantics. They're conceptually closer to `init --with=X` than to top-level verbs.

**Recommended renaming (v0.20):**
- Add `init --with agents,hooks,ci,badge[,llms,publish]` as the canonical entry point
- Keep the four top-level commands as deprecation aliases for one release with a `(now: \`init --with agents\`)` hint in their help text

### 4.4 Introspection cluster — five ways to ask "what's the state"

| Command | What you ask | What you get |
|---------|--------------|--------------|
| `score` | "How good are my docs (0-100)?" | Weighted category breakdown |
| `score --diff` | "What changed in the score between commits?" | Per-category delta |
| `memory` | "What does DocGuard remember about my code?" | Memory accuracy headline (same number `score` shows) |
| `memory --diff` | "Which doc claims don't match code right now?" | Per-domain drill-down |
| `trace` | "Map docs ↔ code ↔ tests" | Requirements traceability matrix |
| `trace --reverse` | "Which doc sections reference this code file?" | Reverse map |
| `explain` | "What is this validator/warning?" | Static help text |
| `diff` | "What's drifted right now?" | Current state snapshot |

**Defensible.** These genuinely answer different questions. The risk isn't overlap, it's discoverability — `memory` and `explain` are ghost commands in `--help` today.

**Recommended fix (v0.19):** Surface all of them in `--help`. Don't rename.

### 4.5 Action cluster — three ways to fix something

| Command | What it does | Manual / Automated |
|---------|--------------|--------------------|
| `fix` | Per-doc AI fix prompt generator (`--doc <name> --format prompt`) | Manual (AI writes) |
| `diagnose` | Run `guard` + emit AI fix prompts for everything in one shot | Manual (AI writes) |
| `sync --write` | Mechanical fix for source=code sections (no AI needed) | Automated |
| `fix --write` | Same `sync --write` data plus mechanical changelog/metrics/metadata patches | Automated |
| `upgrade --apply` | Migrate `.docguard.json` schema (and optionally CLI version) | Automated |

**Honest overlap:** `fix --write` and `sync --write` do the same mechanical fixes for the section-marker case. `fix` ≈ "AI fix for this one thing"; `diagnose` ≈ "AI fix for everything"; `sync --write` ≈ "no AI, just refresh"; `upgrade` ≈ "migrate config schema."

**Recommended (v0.20):** Document the mental model explicitly in `--help`:
- `fix` — manual, AI-assisted, one-doc-at-a-time
- `diagnose` — manual, AI-assisted, whole-project
- `sync` — automated, mechanical, idempotent

No renames. Just better grouping in `--help`.

---

## 5. Proposed Target Surface (v0.20+)

After consolidation, the verbs a new user has to learn:

### Tier 1 — "the daily five" (always in `--help` Quick Reference)

| Verb | Purpose | Replaces |
|------|---------|----------|
| `init` | Bootstrap (skeleton, wizard, or from-code via flags) | `init`, `setup`/`onboard`, parts of `generate` |
| `guard` | Validate | `guard`, `audit` |
| `diff` | Inspect drift (current + `--since <ref>` for impact) | `diff`, `impact` |
| `sync` | Apply mechanical fixes | `sync` (unchanged) |
| `score` | CDD maturity score (with `--diff` for delta) | `score` (unchanged) |

### Tier 2 — "the situational verbs" (in `--help` Tools section)

| Verb | Purpose |
|------|---------|
| `fix` | Generate per-doc AI fix prompt |
| `diagnose` | Whole-project AI fix orchestrator |
| `generate` | Reverse-engineer from existing code (keep as a top-level — marquee feature) |
| `explain` | Static help for a validator or warning |
| `memory` | Show what DocGuard remembers + `--diff` |
| `trace` | Traceability matrix + `--reverse` |
| `upgrade` | Migrate config / CLI |
| `watch` | Live re-validation |

### Tier 3 — folded into `init --with`

`agents`, `badge`, `ci`, `hooks`, `llms`, `publish` — all become `init --with <name>` with deprecation aliases for one release.

**Net surface for users:** 5 daily verbs + 8 situational verbs = **13 commands** instead of 21. Plus `--help` groups them by use-case, not by alphabet.

### What this audit explicitly does NOT recommend

- **No mass renames.** The names that already work (`guard`, `fix`, `diff`, `score`, `sync`) stay. Renaming a working verb is a tax users pay for cleanup-theater. The win is *removing* and *folding*, not *renaming*.
- **No breaking changes in v0.19.** Every existing command word keeps working through v0.20 with an alias.
- **No new aliases beyond what's needed for backwards-compat.** `gen`, `repair`, `dx`, `pipeline`, `badges`, `audit`, `update`, `onboard`, `help-warning`, `traceability`, `pub` — these 11 cute aliases are currently undocumented anywhere. v0.20 should pick one shape: either *document all of them* (don't) or *quietly drop them, keeping only `audit→guard` for backwards-compat* (do this).

---

## 6. Migration Plan (v0.19.0 → v0.20.0)

### v0.19.0 — "make `guard` self-aware"

Goal: ship the smoke gate + e2e fix from the rolled-back commit, plus the *minimum* surface fix that proves `guard` can police its own claims.

1. **Add `canonical-sync` validator** (see §7). Catches `cli/commands/*.mjs` count drift vs README claim, and `runGuardInternal().validators.length` drift vs README claim. ~200 lines + tests.
2. **Surface the 6 ghost commands in `--help`** — `explain`, `impact`, `llms`, `memory`, `upgrade`, plus a Utilities note for `audit` (alias).
3. **Correct README to real counts.** `21 commands (16 user-facing)` and `23 validators`. Architecture diagram numbers match.
4. **Pin alias usage in `--help`.** Each command's section shows the canonical name only; aliases are not documented (we'll deprecate them in v0.20).
5. **Move `validateSpecKitIntegration` from `cli/scanners/speckit.mjs` to `cli/validators/spec-kit.mjs`.** Architectural cleanup; file count then matches validator count (21 → 22).

After v0.19.0, `node cli/docguard.mjs guard` will fail loudly if anyone changes a command file count without updating the README — exactly the missing check that let v0.13's stale "Commands (15)" survive five releases.

### v0.20.0 — "the consolidation release"

Goal: reduce the user-facing verbs from 21 to 13. Every existing command keeps working through this release; deprecation warnings flag the new shape.

1. **Deprecate `setup`/`onboard` → `init --wizard`.** Print the warning, keep working.
2. **Deprecate `impact` → `diff --since <ref>`.** Print the warning, keep working.
3. **Deprecate `agents`/`badge`/`ci`/`hooks`/`llms`/`publish` → `init --with <name>`.** Print warning, keep working.
4. **Drop the cute aliases** (`gen`, `repair`, `dx`, `pipeline`, `badges`, `update`, `pub`, `help-warning`, `traceability`). Keep only `audit → guard` (backward compat with historical CI scripts).
5. **Reorganize `--help` into the Tier-1 / Tier-2 / Tier-3 structure from §5.**
6. **Migration guide:** `docs-implementation/MIGRATION-v0.20.md` with a per-command before/after table.

### v1.0.0 — "remove the deprecation aliases"

After v0.20 has been out for ~2–3 months. Just delete the alias cases from the router. Print a clear error suggesting the v0.20 replacement.

---

## 7. New Validator Spec: `canonical-sync`

The check that would have prevented this entire audit being necessary.

**File:** `cli/validators/canonical-sync.mjs`
**Severity:** `high` (a doc lying about the tool's basic surface is a credibility-killer)
**Cost:** Cheap. Runs `runGuardInternal`-style validator-list query (already in memory) + reads `cli/commands/` directory + greps a handful of README patterns.

### Rules

For each of these claims in README, STANDARD, PHILOSOPHY, COMPARISONS, ROADMAP:

| Pattern | Code-truth source | Fail mode |
|---------|-------------------|-----------|
| `(\d+)\s+commands?` (in a sentence about DocGuard's surface, not a phase log) | Count of `cli/commands/*.mjs` files | Mismatch → WARN with the right number |
| `(\d+)\s+validators?` | `runGuardInternal(...).validators.length` | Mismatch → WARN |
| `(\d+)\s+checks?` | `runGuardInternal(...).validators.reduce((n,v)=>n+v.total,0)` (where `total` is the per-validator check count) | Mismatch → WARN |
| Validator names listed inline (e.g. "Structure, Doc Sections, Docs-Sync, ...") | `runGuardInternal(...).validators.map(v => v.name)` | Missing or extra name → WARN with diff |
| Command names listed in tables | Files in `cli/commands/*.mjs` | Missing or extra → WARN |

### Opt-out & scope

- Skips files in `docs-implementation/` and `ROADMAP.md` (phase logs are legitimately historical)
- Skips `<!-- docguard:section source=human -->` blocks (prose, not surface inventory)
- Honors `config.canonicalSyncIgnore` for project-specific opt-out

### Test cases (drives implementation)

1. README claims "21 commands", filesystem has 21 → pass.
2. README claims "19 commands", filesystem has 21 → warn with "expected 21".
3. README lists 22 validator names matching `guard` output → pass.
4. README lists 21 validator names + 1 wrong name → warn with diff.
5. ROADMAP.md says "9 validators" in a phase log → pass (file is excluded).
6. `docs-implementation/CURRENT-STATE.md` says "5 commands" → pass (file is excluded).

### Why not `--write` for this validator

Tempting, but no. The count-mismatch fix is often *not* "edit the number" — it's "go look at what changed in `--help` and reorganize the table around it." A mechanical patch that just bumps `19 → 21` would mask the real action item (which 5 commands are new and where do they belong in the doc's flow). WARN-only is the right shape.

---

## 8. Open Questions for the Owner

1. **`audit` alias:** keep forever or drop in v1.0? It's been in the router since v0.5-ish and may be in someone's CI script. Cost to keep: 2 router lines. **Recommend: keep.**
2. **`generate` vs `init --from-code`:** keep both? `generate` is the marquee story but `init --from-code` is more discoverable. **Recommend: keep `generate` as top-level; add `init --from-code` as an alias that prints "running `docguard generate`…" and dispatches.**
3. **`publish` (Mintlify scaffolder):** it's marked Experimental and is the only Tier-3 candidate that *isn't* purely additive (it talks to an external platform). Fold into `init --with publish` like the others, or pull it out to its own plugin? **Recommend: fold for v0.20 since it's still experimental.**
4. **Validator name consistency:** "Drift-Comments" in guard output but `drift.mjs` filename — same for "TODO-Tracking" / `todo-tracking.mjs`, etc. Mostly fine but worth one consistency pass in v0.20.
5. **`canonical-sync` validator's own credibility:** should the validator validate its own claim? (i.e. README says "23 validators including canonical-sync" — does `canonical-sync` count itself?). **Recommend: yes, count itself. The whole point is the count being self-policed.**

---

## 9. What Lives Where (for future-Ricardo)

For anyone reading this six months from now:

- **Hard count truth:** `cli/commands/*.mjs` (filesystem) + `cli/docguard.mjs` printHelp (user-facing) + `cli/commands/guard.mjs` validator registration array (validators)
- **Doc claims:** README.md (Usage, architecture diagram, validators section) + STANDARD.md (no counts, intentional) + PHILOSOPHY.md (no counts, intentional)
- **Phase logs (excluded from canonical-sync):** ROADMAP.md, CHANGELOG.md, docs-implementation/CURRENT-STATE.md
- **This audit:** `docs-canonical/SURFACE-AUDIT.md` — refresh quarterly or whenever surface changes more than ±3 commands

---

*End of audit. No code touched. Awaiting owner decision on v0.19.0 scope (§6.1) and v0.20.0 consolidation (§6.2).*
