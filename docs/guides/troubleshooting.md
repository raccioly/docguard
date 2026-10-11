---
title: Troubleshooting
parent: Guides
nav_order: 6
---

# Troubleshooting

Each section starts from a symptom, explains the cause, and gives the command or
setting that resolves it. For one finding code, `docguard explain <CODE>` and
the [finding reference](../reference/findings.md) are the fastest answer. For
general questions, see the [FAQ](../faq.md).

## Exit codes

### `guard`

| Code | Meaning | What usually treats it as failure |
|---|---|---|
| `0` | Pass | Nothing |
| `1` | At least one blocking finding, or an invalid flag combination (such as `--update-baseline --changed-only`) | Everything |
| `2` | Warnings only | Any wrapper that treats non-zero as failure: `set -e` scripts, the pre-commit framework, most CI steps |
| `3` | Blocking findings in a project with no `.docguard.json` | Same as `1` for CI. The Git hooks DocGuard installs let the commit through, because the project never adopted DocGuard |

Exit `3` usually means you ran guard in the wrong directory, or before
`docguard init`. Check the `Directory:` line at the top of the output, and see
[Monorepos](monorepo.md) if you are inside a package.

Blocking is decided by effective severity, not by how a finding looks.
`severity.<validator>` and `findingSeverity.<CODE>` in `.docguard.json` can
promote warnings to blocking (`"high"`) or demote them so they never fail
(`"low"`).

`guard --fail-on-warning` is accepted, but guard already exits `2` on warnings.
To make warnings exit `1`, use `docguard ci --fail-on-warning`, or
`fail-on-warning: 'true'` in the GitHub Action.

### Other commands

| Command | Exit codes |
|---|---|
| `docguard ci` | `0` pass; `1` errors, a score under `--threshold`, or warnings with `--fail-on-warning`; `2` warnings only |
| `docguard upgrade --check-only` | `1` when the CLI, the schema or the agent files are behind |
| `docguard specs --check` | `2` when the committed registry is missing, stale or inconsistent |
| `docguard specs require` | `1` a change is not covered by a spec; `2` inconclusive (for example, a missing base ref or shallow history) |
| `docguard retire --check` | `2` when high-confidence retirement candidates remain |
| `docguard report` | Always `0`. It produces evidence; it is not a gate |

The GitHub Action maps guard's `2` to a passing step with a `::warning`, unless
you set `fail-on-warning: 'true'`.

## Reading a finding

Every finding carries five independent fields. They answer different
questions, so read them separately.

| Field | Question | Values |
|---|---|---|
| `severity` / `effectiveSeverity` | Does CI block? | `error`, `warn`, `info` |
| `disposition` | Who decides: the tool or you? | `act`, `escalate` |
| `confidence` | How sure is the detector of what it observed? | `high`, `low` |
| `evidence.status` | Has the reviewed benchmark corpus ever measured this code? | `measured`, `not-measured` |
| `parserTier` | Which analyzer produced it? | `js-ast`, `py-ast`, `regex-fallback`, `fallback-language`, `mixed`, `not-applicable` |

- **`act`**: DocGuard names a defect and its correction. You can apply it, or
  let `docguard fix` or your agent apply it.
- **`escalate`**: DocGuard observed a signal and the judgement is yours. For
  example, FRS002 counts commits since a document was reviewed. The count is
  exact (`confidence: high`), but it shows only that a review is due, not that
  the document is wrong. Reviewing and leaving the document as it is can be the
  correct outcome. Do not edit a document just to make an escalation go quiet.
- **`evidence.status: not-measured`** means the confidence label is a
  maintainer's estimate. Most codes are not measured. That does not make their
  findings wrong, only unverified.
- **`parserTier`** says what the detector could see. See
  [Partial coverage](#partial-coverage-and-the-fallback-tiers) below.

The text output shows the act/escalate split under the verdict ("8 to fix · 1
to review"). `guard --format json`, SARIF `result.properties` and
`diagnose --format json` carry all five fields per finding.
`docguard explain <CODE>` prints what one code means, its benchmark evidence
and how to suppress it.

Guard lists a validator's findings only when that validator fails or warns. A
validator that passes overall can still hold findings, for example ones demoted
to `low`. Add `--show-failing` or `--verbose` to list every finding.

## A finding is wrong (false positives)

Work from the narrowest fix to the broadest.

### 1. Confirm what the code checks

```bash
docguard explain SEC001
```

The output says what triggers the code, whether its precision was measured,
and, when the code has one, the marker that suppresses it. `explain` also
accepts a validator key or pasted warning text.

### 2. Suppress the one occurrence

How you suppress depends on the code. `docguard explain` and the
[finding reference](../reference/findings.md) give the exact form.

**The inline pragma** works for SEC001 to SEC006, REF001, REF002 and SPK010.
Put it on the flagged line or the line directly above it, with a reason:

```js
// docguard:ignore SEC001 — UI copy, not a credential
const passwordHint = "Use at least twelve characters";
```

```markdown
<!-- docguard:ignore REF001 — still relevant, user-facing flag name -->
```

It also accepts a comma list (`SEC001,REF002`), a prefix wildcard (`SEC*`) and
`docguard:ignore-secret` for any SEC code. A bare `docguard:ignore` with no code
suppresses every code on that line; prefer naming the code.

**Other codes have their own marker.** Examples:

| Code | Marker |
|---|---|
| STR003 (missing section) | `<!-- docguard:section <slug> n/a — reason -->` |
| TRC002 (document with no matching source) | `// @doc <DOC-NAME>.md` near the top of a source file that implements it |
| DQ001, DQ007, APS001, APS002 | `<!-- docguard:quality <rule> off — reason -->`, with `passive-voice` (DQ001), `negation-load` (DQ007) or `api-smell` (APS001, APS002) |

Write the reason after the code list, as in the examples: `docguard ignore`
shows it next to the pragma, and a pragma without one is listed as `no reason`.

Some codes have no suppression marker. For those, use one of the broader
options below.

### 3. Broader options

| Situation | Use |
|---|---|
| Whole files or directories that are not yours to document (generated code, vendored libraries, fixtures) | Add a pattern to `.docguardignore` (gitignore wildcards; `dir/` matches at any depth, a leading `/` anchors to the root). Say why, and until when if it is temporary: `generated/  expires:2026-12-31  # replaced by the v2 build` |
| A finding code that is too noisy for your project, but you still want to see it | `"findingSeverity": { "<CODE>": "low" }` in `.docguard.json` |
| A validator that genuinely does not apply | `<!-- docguard:validator <key> n/a — reason -->` in a canonical document or `AGENTS.md`. It shows as `N/A` with your reason |
| Findings that predate adoption | The baseline: `docguard guard --update-baseline` |
| A validator you want off for now (for example, for CI speed) | `"validators": { "<key>": false }`. It disappears silently, so prefer the N/A marker when it does not apply |

### 4. Report it

```bash
docguard feedback                     # uncertain findings in this run
docguard feedback --code TRC005       # one code, whatever its confidence
docguard feedback --code TRC005 --preview
```

`feedback` writes a local record to `.docguard/feedback/` (skipped with
`--preview`) and prints a prefilled GitHub issue link and duplicate-search
links. The links carry only the finding's identity and tool metadata: no paths,
source text or messages. Nothing is sent automatically. The local record can
contain private details, so do not attach it as it is.

## Partial coverage and the fallback tiers

**Symptom:** guard passes, but a validator says `partial`, or findings carry
`parserTier: fallback-language` or `regex-fallback`.

DocGuard reads JavaScript and TypeScript with a syntax tree (`js-ast`) and
Python with the interpreter's own `ast` module (`py-ast`). When one of those is
unavailable for a file, it falls back to patterns (`regex-fallback`). Go, Java,
Kotlin, Ruby, Rust, PHP and C# have no syntax-tree tier at all: routes and
environment variables there are matched by pattern (`fallback-language`).

On those tiers, a missing finding is weak evidence. The owning validator
reports `applicability: partial`, with a reason naming the language and the
file count. A source language with no environment patterns at all (Swift,
Scala, …) makes the Environment check `partial` rather than a silent pass.

Each validator reports one of these states: `checked`, `partial`, `disabled`,
`not-applicable`, `missing-prerequisite`, `unsupported`, `no-matches`, `error`.
The text output summarises them ("Check coverage: 12 of 31 validator(s)
checked · 2 disabled · 19 no matches"), and `guard --format json` has the detail
in `checkCoverage` and in each validator's `applicability`. A passing gate means
the selected checks passed. It does not mean unsupported languages were
examined.

`docguard sync --write` will not write a code section drawn from partial
evidence unless you add `--allow-partial`.

What each language and framework supports is in
[Languages](../reference/languages.md).

## Python analysis is partial

**Symptom:** Python findings carry `parserTier: regex-fallback`, or
`generate --plan` reports `low` confidence for endpoints and entities.

The Python syntax-tree tier runs the project's own interpreter. DocGuard looks
for `python3`, then `python`, on your `PATH`, and uses the first one that can
import `ast` and `json`. It never imports your modules. Without one:

- routes, models and settings are read by the pattern tier, which composes
  router prefixes and Django URL configurations the same way on standard
  layouts;
- affected validators report the degraded tier;
- a documentation section that covers a Python symbol cannot be compared, so
  the doc-dependency check reports `partial`;
- the generated module graph says the interpreter was unavailable instead of
  drawing Python edges.

Install Python 3 on the machine or CI image that runs DocGuard, and make sure
`python3` is on the `PATH` of that process. The official Docker image
(`node:20-alpine`) does not include Python.

## History-based checks report a missing prerequisite (sandboxes)

**Symptom:** Freshness, Diff-Suspicion or Reference-Existence report
`missing-prerequisite` with "Git metadata is present but unreadable", or the
Spec-Kit check reports `partial`.

A `.git` exists, but Git commands fail. The usual cause is an agent sandbox
running in a linked worktree: there, `.git` is a file pointing at a Git
directory elsewhere, and sandboxes hide that directory by default. The same
state is reported when `git` is not installed.

DocGuard reports these checks as not run, with Git's own error message,
instead of a clean "no matches", and the badge is not shown as fully green.

Fix it by exposing the repository's Git directory to the sandbox (ai-jail:
`--worktree`; other sandboxes: mount the directory named in the `.git` file).
A project with no `.git` anywhere is unaffected: it has no history to read.

DocGuard needs no network access and no credentials. `guard` runs with a
read-only project mount; commands that write (`init`, `fix --write`,
`sync --write`, `review --accept`, `specs --write`, `memory --pack`) need a
writable one.

## Shallow clones

**Symptom:** freshness counts look too low, `diff --since <ref>` cannot find
the base, or `specs require` exits `2` with "unknown ref or shallow history".

DocGuard does not detect a shallow clone. Its Git metadata is readable, so the
history-based checks run, but they see only the commits that were fetched.

In CI, fetch the full history:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
```

For `specs require` and `diff --since origin/main`, the base branch must also be
fetched.

## Colour codes in logs, or no colour

DocGuard decides colour in this order:

1. `FORCE_COLOR` is set: any value but `0` forces colour on; `0` turns it off.
2. `NO_COLOR` is set to a non-empty value: colour is off.
3. Otherwise colour is on only when stdout is a terminal.

Piped or redirected output is therefore plain by default. If a CI log shows raw
escape codes, look for a `FORCE_COLOR` set by the CI image, and set
`NO_COLOR=1`. Because `FORCE_COLOR` takes precedence, unset it as well.

## `--format json` output does not parse

With `--format json`, `sarif` or `junit`, stdout carries only the artifact: no
banner, no colour, no notes. Everything else goes to stderr, including the
`--changed-only` note and the ancestor-root guidance (one JSON line of type
`docguard.repository-root-guidance`). The 14-day release-age note never appears
in machine output. Large payloads are flushed in full before the process exits.

If parsing fails, the cause is almost always stderr mixed into stdout. Keep the
streams apart:

```bash
docguard guard --format json > guard.json 2> guard.log
```

The exit code is set as usual in JSON mode, so read it separately from the
document. `--compact` (with `--format json`) prints each fact once, which is the
form the MCP guard tool returns.

## Slow runs

Find the slow validator first:

```bash
docguard guard --timings
```

It prints the ten slowest validators with wall time and share of the total.

Then:

- **Exclude what is not yours to check.** Large generated, vendored or fixture
  directories belong in `.docguardignore`. `node_modules`, `.git`, `dist`,
  `build`, `out`, `coverage`, `vendor`, `target` and similar build directories
  are already skipped.
- **Use the fast path locally.** `docguard guard --changed-only` runs a smaller
  validator set on the files changed since `HEAD~1` (or `--since <ref>`).
  Validators you marked `severity: "high"` still run. Keep the full run for CI.
- **Turn off a validator you do not need** with `"validators": { "<key>": false }`.

## Baselined findings come back

**Symptom:** a finding you froze with `--update-baseline` is reported again.

A baselined finding is matched by its code, its file path without the line
number, and its message with numbers masked. It comes back when one of those
changes, or when the baseline cannot apply:

| Cause | What to do |
|---|---|
| The file was moved or renamed | The path is part of the fingerprint. Review the finding and re-freeze |
| The message wording changed, often after an upgrade | Read the CHANGELOG, review, re-freeze |
| More occurrences than were frozen | Each fingerprint stores a count. Freezing one instance suppresses one; the extra one is new |
| `.docguard.baseline.json` is not valid JSON | A malformed baseline is ignored, so every finding shows. Restore it from Git or rewrite it |
| `"baseline": false` in `.docguard.json`, or `--no-baseline` | The baseline is turned off on purpose |
| The validator does not attach a structured finding to every message | Such results are never suppressed by the baseline |
| On 0.43.1 or earlier, a TRC004 finding returns after you add an unrelated test file | Its message ends with a soft-match hint that names the closest test file. The `[Unreleased]` section of the CHANGELOG describes the fix, which leaves the hint out of the fingerprint. Until you have that release, review and re-freeze |

Re-freezing captures every finding that fires at that moment. Run
`docguard guard --no-baseline` and read the list before running
`docguard guard --update-baseline`. Guard reports how many baselined entries
"no longer occur — safe to drop"; re-freezing removes them.

## Ignored files are checked again

**Symptom:** findings appear in a path that `.docguardignore` lists.

**Cause:** the entry no longer applies. Guard says which, at the entry's line:

- **IGN001**: its `expires:` date has passed (UTC). Set a new date if the
  reason still holds, or delete the line.
- **IGN003**: its `expires:` value is not a `YYYY-MM-DD` calendar date, or the
  line has no pattern. Fix the date or remove the token.

`docguard ignore` lists every entry with its state. One more case: a line like
`fixtures/ # test data` excluded nothing before v0.44 (the comment was read as
part of the pattern) and excludes `fixtures/` now.

## `docguard hooks` refuses: core.hooksPath points at a shared folder

When `core.hooksPath` comes from your global or system Git config, the command
line, or points outside the repository, every repository that uses that folder
runs its hooks. DocGuard will not install, replace or remove hooks there,
because the change would reach every one of those repositories. Pick one:

- Add DocGuard's check to the shared hooks yourself. The refusal prints the
  line, for example `npx docguard-cli guard --changed-only` for `pre-commit`.
- Give this repository its own hooks folder, then install. Git stops running
  the shared hooks in this repository:

  ```bash
  git config --local core.hooksPath .githooks
  docguard hooks
  ```

Find where the setting comes from with `git config --show-scope --show-origin --get core.hooksPath`.
`docguard setup` follows the same rule and does not offer to install there.

## Still stuck

- `docguard explain <CODE>` and the [finding reference](../reference/findings.md).
- The [Commands Reference](../commands.md) and [Configuration](../configuration.md).
- The [FAQ](../faq.md).
- Open an issue with `docguard feedback` if a detector is wrong, or at
  [github.com/raccioly/docguard/issues](https://github.com/raccioly/docguard/issues).
