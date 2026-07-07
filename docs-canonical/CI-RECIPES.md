# CI Recipes

<!-- docguard:quality negation-load off — operational doc: "read-only, never modifies your repo", "fork PRs won't run", "don't commit X" are precise prohibitions; positive rephrasing would reduce clarity -->

<!-- docguard:section id=overview source=human -->
This document covers the GitHub Action and CI integration patterns DocGuard ships.
Each recipe is a copy-pasteable workflow you can drop into `.github/workflows/`.

DocGuard exposes itself as a composite action at `raccioly/docguard@<tag>` and
also ships starter workflow templates under
`extensions/spec-kit-docguard/templates/github-workflows/`. Pin to a specific
tag (e.g. `@v0.12.0`) in production — `@main` is fine for tracking the bleeding edge.
<!-- /docguard:section -->

## Recipe 1 — Guard (mandatory CI gate)

Runs all 27 validators. Read-only — never modifies your repo.

```yaml
name: DocGuard Guard
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions:
  contents: read
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # Freshness validator needs git history
      - uses: raccioly/docguard@v0.12.0
        with:
          command: guard
          fail-on-warning: 'false' # flip to true once your repo is clean
```

Inputs that matter:
- `command: guard` (default)
- `fail-on-warning` — `false` (default) treats warnings as exit 0, `true` fails the job
- `format: json` — emits machine-readable output for downstream steps

## Recipe 2 — Auto-Fix (PR-time mechanical fixes)

Applies deterministic fixes — version bumps, count drift, removed endpoints,
changelog stubs — and commits them back to the PR branch.

```yaml
name: DocGuard Auto-Fix
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: write          # commit back to PR branch
  pull-requests: write     # post summary comment
jobs:
  autofix:
    runs-on: ubuntu-latest
    if: github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
      - uses: raccioly/docguard@v0.12.0
        with:
          command: fix
          auto-commit: 'true'
          comment-on-pr: 'true'
```

What gets fixed automatically (no AI involved):
- `replace-version` — bump `package.json`-derived version mentions in docs.
- `replace-count` — fix line/file/endpoint counts in canonical docs.
- `insert-changelog-unreleased` — drop an Unreleased stub when missing.
- `remove-endpoint` — strip an endpoint block from `API-REFERENCE.md` when the route was deleted from code (gated by a generated marker).

What does NOT get fixed automatically (run `/docguard.fix` from your editor):
- Entire prose rewrites — these need AI judgement.
- New endpoint documentation — needs human description of behavior.
- Schema docs for entities that don't have an obvious template.

**Fork PRs are skipped by design.** GitHub's branch protections won't let an
Action push to a fork, and the workflow refuses to try.

## Recipe 3 — Sync (memory refresh on a schedule or pre-merge)

`sync --write` regenerates code-truth doc sections marked
`<!-- docguard:section source=code -->`. Use it on a schedule for "always up
to date" guarantees, or pre-merge as a stricter version of Recipe 2.

```yaml
name: DocGuard Nightly Sync
on:
  schedule:
    - cron: '0 6 * * *'   # daily at 06:00 UTC
  workflow_dispatch: {}
permissions:
  contents: write
  pull-requests: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: raccioly/docguard@v0.12.0
        with:
          command: sync
          auto-commit: 'true'   # opens a commit on default branch
          commit-message: 'docs: nightly DocGuard memory sync'
```

For the PR variant (run sync against a PR rather than scheduled), use the same
config as Recipe 2 but with `command: sync` instead of `command: fix`.

## Recipe 4 — Score (track CDD maturity over time)

Posts the CDD score as a PR comment so reviewers see whether docs are getting
better or worse with each change.

```yaml
name: DocGuard Score
on:
  pull_request: { branches: [main] }
permissions:
  contents: read
  pull-requests: write
jobs:
  score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: raccioly/docguard@v0.12.0
        with:
          command: score
          format: json
          score-threshold: '70'   # fail PRs that drop below 70/100
```

## Pre-commit hook (no GitHub Actions required)

Run guard locally before every commit so you catch drift at typing time, not
in CI. Works with [husky](https://typicode.github.io/husky/),
[lefthook](https://github.com/evilmartians/lefthook), or plain Git hooks.

```yaml
# .lefthook.yml
pre-commit:
  commands:
    docguard:
      run: npx docguard-cli guard --changed-only
      glob: '**/*.{ts,tsx,js,jsx,py,go,rs,java,kt,rb}'
```

`--changed-only` ships in v0.12 and runs only Docs-Sync, Environment, and
API-Surface against the staged files (instead of all 27 validators against
the whole repo). See Recipe 5 below.

## Recipe 5 — Pre-commit lite (changed files only)

For developers who want zero-cost feedback before push:

```bash
npx docguard-cli guard --changed-only --since HEAD~1
```

This runs a curated subset of validators (Docs-Sync, Environment, API-Surface)
against files modified since the given ref. Designed to complete in under 2
seconds on average repos. See `docs-canonical/ARCHITECTURE.md` for the
selected-validators rationale.

## Permissions cheatsheet

| Recipe | `contents` | `pull-requests` | Notes |
|--------|------------|-----------------|-------|
| Guard | `read` | none (or `write` for score comment) | Safe on fork PRs. |
| Auto-Fix | `write` | `write` | Skips fork PRs automatically. |
| Sync | `write` | `write` (PR variant only) | Schedule variant pushes to default branch. |
| Score | `read` | `write` | Always safe. |

## Action inputs reference

| Input | Default | Used by |
|-------|---------|---------|
| `command` | `guard` | all |
| `working-directory` | `.` | all |
| `node-version` | `20` | all |
| `format` | `text` | guard / score / diff |
| `fail-on-warning` | `false` | guard |
| `score-threshold` | `0` | score |
| `auto-commit` | `false` | fix / sync |
| `commit-message` | `docs: apply DocGuard mechanical fixes` | fix / sync |
| `comment-on-pr` | `false` | fix / sync (also score has its own comment) |
| `bot-name` | `docguard-bot` | fix / sync |
| `bot-email` | `docguard-bot@users.noreply.github.com` | fix / sync |

## Action outputs reference

| Output | Type | Set by |
|--------|------|--------|
| `score` | number (0-100) | command=score |
| `grade` | string (A+..F) | command=score |
| `result` | JSON | command=score, format=json |
| `fixes-applied` | number (file count) | command=fix or sync |
| `changed-files` | newline-separated paths | command=fix or sync |
| `committed` | `"true"` / `"false"` | auto-commit=true |

Wire these into downstream steps:

```yaml
- id: fix
  uses: raccioly/docguard@v0.12.0
  with: { command: fix, auto-commit: 'true' }
- if: steps.fix.outputs.fixes-applied != '0'
  run: echo "Applied ${{ steps.fix.outputs.fixes-applied }} fixes"
```
