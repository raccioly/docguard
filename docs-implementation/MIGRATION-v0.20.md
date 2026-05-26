# Migration Guide: v0.19 → v0.20

> **Status:** v0.20.0 — the consolidation release.
> **What changed:** 21 user-facing commands consolidated to 13. Eleven aliases dropped. Every prior command still works in v0.20.x with a yellow deprecation warning; the dropped aliases error with a hint to the canonical command.
> **Why:** The [SURFACE-AUDIT](../docs-canonical/SURFACE-AUDIT.md) found that 15 releases of additive work had grown the verb surface beyond what a dev shopping for doc tools would tolerate. v0.20 cleans it up without breaking anyone who's already on v0.19.

---

## TL;DR

**Nothing breaks in v0.20.** Every command you used in v0.19 still works:

- Eight commands (`setup`, `agents`, `hooks`, `ci`, `badge`, `llms`, `publish`, `impact`) keep working but print a yellow stderr warning telling you the new shape. `--quiet` suppresses the warning.
- Ten "cute" aliases (`onboard`, `gen`, `repair`, `dx`, `pipeline`, `badges`, `update`, `pub`, `help-warning`, `traceability`) are **removed** — they error with a one-line hint to the canonical command. None of these were ever documented in `--help`, but they were in the router.
- `audit → guard` is the one **permanent** alias. No warning. No removal planned. Older CI scripts depend on it.

In **v1.0** the deprecated commands will be removed entirely. That's at least 2-3 months from v0.20 — plenty of runway.

---

## Before / After table

### Commands that gained a flag (recommended new shape)

| v0.19 (still works) | v0.20 canonical | Notes |
|---|---|---|
| `docguard setup` | `docguard init --wizard` | Same 7-step interactive flow. The wizard flag dispatches to the existing `runSetup` internally. |
| `docguard agents` | `docguard init --with agents` | Scaffolds AGENTS.md / CLAUDE.md / .cursor/rules / Copilot instructions. |
| `docguard hooks` | `docguard init --with hooks` | Installs pre-commit / pre-push git hooks. |
| `docguard ci` | `docguard init --with ci` | Generates GitHub Actions / pipeline config. |
| `docguard badge` | `docguard init --with badge` | Emits shields.io score badge URLs / markdown. |
| `docguard llms` | `docguard init --with llms` | Generates `llms.txt`. |
| `docguard publish` | `docguard init --with publish` | Scaffolds external doc-site config (Mintlify). Still experimental. |
| `docguard impact --since X` | `docguard diff --since X` | `diff` now branches on `--since`: without it, normal drift view; with it, the impact-mode "which docs reference the changed files" view. |

**Multiple at once:** `docguard init --with agents,hooks,ci,badge` runs them in sequence. Useful for a fresh project bootstrap that wants the full kit.

### Aliases dropped (now error)

These were never documented in `--help`, but lived in the router as shortcuts. Removed in v0.20:

| Removed | Use instead |
|---|---|
| `onboard` | `setup` (deprecated) or `init --wizard` |
| `gen` | `generate` |
| `badges` | `badge` (deprecated) or `init --with badge` |
| `pipeline` | `ci` (deprecated) or `init --with ci` |
| `repair` | `fix` |
| `dx` | `diagnose` |
| `pub` | `publish` (deprecated) or `init --with publish` |
| `traceability` | `trace` |
| `help-warning` | `explain` |
| `update` | `upgrade` |

### Permanent alias (no change)

| Alias | Dispatches to |
|---|---|
| `audit` | `guard` |

Kept silently — no warning, no removal planned. Older blog posts, tutorials, and CI scripts reference `docguard audit` from before `guard` was introduced; they keep working.

---

## What stays exactly the same

These commands didn't change shape and didn't gain a flag — same form in v0.19 and v0.20:

`init` · `guard` · `score` · `diff` · `sync` · `fix` · `diagnose` · `generate` · `explain` · `memory` · `trace` · `upgrade` · `watch`

That's the **13-command core surface** v0.20 settles on. Everything else is either folded into `init --with` or a deprecation alias.

---

## Concrete examples

### CI workflow update (recommended but not urgent)

**Before (v0.19):**
```yaml
- run: docguard audit       # or `docguard guard` — same thing
- run: docguard score --threshold 80
- run: docguard ci --fail-on-warning
```

**After (v0.20):**
```yaml
- run: docguard guard        # `audit` still works permanently if you prefer
- run: docguard score --threshold 80
- run: docguard ci --fail-on-warning    # `ci` keeps working as deprecation alias
```

You can also fold the `ci` setup into the init step:
```yaml
- run: docguard init --with ci          # one-shot generate the workflow
```

### Pre-commit hook (no change required)

**v0.19 / v0.20 — same hook content:**
```bash
#!/bin/sh
docguard guard --changed-only --quiet || exit 1
```

The `--quiet` flag suppresses both the banner AND any deprecation warnings from commands the hook invokes, so existing hooks stay clean.

### Fresh project bootstrap (recommended new flow)

**Before (v0.19) — multiple commands:**
```bash
docguard init
docguard setup            # interactive wizard
docguard agents           # generate agent configs
docguard hooks            # install git hooks
docguard badge            # add shields.io
docguard ci               # add GitHub Actions
```

**After (v0.20) — one composed command:**
```bash
docguard init --wizard --with agents,hooks,badge,ci
```

The wizard guides you through the canonical docs; the `--with` list scaffolds everything else in sequence.

### Post-commit "what docs am I responsible for?"

**Before (v0.19):**
```bash
docguard impact --since HEAD~1
```

**After (v0.20):**
```bash
docguard diff --since HEAD~1
```

`impact` keeps working as a deprecation alias.

---

## Deprecation timeline

| Phase | Version | What happens |
|---|---|---|
| **Warning** | v0.20.x → v0.x | Deprecated commands keep working, emit yellow stderr warning. `--quiet` suppresses. |
| **Removal** | v1.0.0 | Deprecated commands stop working. Their entries become "Unknown command" with a hint. |
| **Permanent** | forever | `audit → guard` stays. No plans to remove it. |

**v1.0 is at least 2-3 months out** as of v0.20.0. Plenty of time to migrate CI scripts, hooks, tutorials, etc.

---

## How to detect old usage in your repo

```bash
# Find any v0.19-style invocations in your repo
grep -rE 'docguard (setup|agents|hooks|ci|badge|llms|publish|impact|onboard|gen|repair|dx|pipeline|badges|update|pub|traceability|help-warning)\b' \
  --include='*.yml' --include='*.yaml' --include='*.sh' --include='*.md' \
  .github/ scripts/ docs/ 2>/dev/null
```

If anything turns up, the warning stream from v0.20 will catch it in CI too — the yellow `⚠ Deprecated since v0.20:` line goes to stderr but is captured in normal CI logs.

---

## The surface story

| | v0.19 | v0.20 |
|---|---|---|
| User-facing commands in `--help` | 16 (+5 ghost) | 13 |
| Total routable commands | 21 + 11 aliases | 13 + 8 deprecation aliases + 1 permanent alias (`audit`) |
| Lines in `--help` Usage section | ~40 | ~28 |
| Mental categories | 7 (Getting Started / Enforcement / Memory / Analysis / CI/CD / Utilities / Experimental) | 4 (Daily 5 / Tools / init --with / Deprecations) |

---

## Questions / edge cases

**Q: What if I'm scripting against `docguard --help` output?**
A: The Tier-1 / Tier-2 section names changed. If you parse the help output, update to the new section names (`The Daily 5`, `Tools`, `init --with <name>`, `Deprecation aliases`). If you're parsing the help output you probably want `docguard --format json` (machine-readable command list) instead — open an issue if you need this and it doesn't exist yet.

**Q: Will `init --with X` work in `--skip-prompts` mode?**
A: Yes. The scaffolders inherit the `--skip-prompts` flag so non-interactive CI works.

**Q: What about the `setup` interactive wizard — does it know it was called as `init --wizard`?**
A: The underlying `runSetup` function is the same code path. You won't notice a behavioral difference.

**Q: Can I disable the deprecation warnings without using `--quiet` (which suppresses banner too)?**
A: Not in v0.20. We considered a `--no-deprecation-warnings` flag but it adds surface for a problem that solves itself when you migrate. If you have a strong use case, open an issue.

**Q: Are there breaking changes I should test for?**
A: The deprecated commands all dispatch through the same `runInit` entry point now, which means subtle flag-passing differences are theoretically possible. The full test suite covers each combination, but if you depend on a non-standard combination, run `docguard guard` in CI and check exit codes match what you expect.
