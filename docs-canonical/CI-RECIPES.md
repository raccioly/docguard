# CI Recipes

<!-- docguard:last-reviewed 2026-09-15 -->
<!-- docguard:status active -->

## Recipe 1 — Guard (mandatory CI gate)

Run `docguard init --with ci` to create `.github/workflows/docguard.yml`. Existing workflows are preserved; explicit `--force` backs up and replaces the file. The standalone `docguard ci` command continues to execute checks. Start from `templates/ci/github-actions.yml` or the Spec Kit guard workflow in `extensions/spec-kit-docguard/templates/github-workflows/`. These checked-in templates are the maintained source for action pins, runtime selection, and report handling. Copying a template does not configure repository branch protection; require its check independently.

Use a fixed tool version, full Git history for freshness, and explicit warning policy. Run the check against the actual revision proposed for merging. A missing executable, malformed report, or unexpected nonzero exit is a tool failure, not a successful scan. Configure merge-queue triggers if the repository uses a merge queue.

```sh
node_modules/.bin/docguard ci --format json --no-history > docguard-report.json
```

The CLI exits 0 for pass, 1 for failure, and 2 for warning-only results. A plain shell step treats both 1 and 2 as failures. To permit warnings, capture the exit status explicitly and allow only 0 or 2. To block warnings, use `ci --fail-on-warning`. Severity overrides retain their configured meaning.

When `.docguard-evidence.json` exists, guard also evaluates its declarations.
Contradictions are high-confidence errors. Stale input digests, missing or
ambiguous targets, malformed evidence, and unsupported report shapes remain
visible warnings. Inspect the complete contract with:

```bash
npx docguard-cli verify --evidence --format json
```

This direct command exits 0 when every configured declaration is verified, 2
when evidence is stale, inconclusive, or unsupported, and 1 when a declaration
is contradicted or the manifest is invalid. CI that permits unresolved evidence
must explicitly allow only status 2; a contradiction is always a failed gate.

Generate oasdiff or Buf reports in an earlier pinned CI step, save their machine
output, and declare SHA-256 identities for every repository input. DocGuard
consumes those artifacts; it does not install or invoke either producer. Keep
the broad freshness and semantic review paths enabled because exact evidence
does not cover undeclared prose.

## Recipe 2 — Auto-Fix (PR-time mechanical fixes)

Run `fix --write` on a controlled checkout when documentation mutation is intended. Review the resulting diff and rerun guard. Preserve human-authored intent; a disagreement may require fixing implementation rather than rewriting the specification.

Mechanical replacements require their existing provenance and generated-section safeguards. A scheduled or PR repair workflow should create a reviewable branch/PR and deduplicate existing repair work. Grant write privileges only to that explicitly enabled workflow. Fork contributions should receive read-only verification unless a separate trusted process handles repair.

The shipped auto-fix template and composite action expose optional commit/comment behavior. Review those flags and their permissions before enabling them. A generated workflow is executable code and deserves the same review as another repository change.

## Recipe 3 — Sync (memory refresh on a schedule or pre-merge)

`sync --write` regenerates sections declared as code-derived. Human sections retain judgment and rationale. Cache identity reflects relevant inputs, so ordinary source edits invalidate a prior plan.

On a schedule, produce a diff, check for an existing repair PR, and create a new proposal only when meaningful work remains. Keep clean runs quiet. Set an owner and response expectation for unresolved findings. Scheduled source scans cannot detect every external deployment or vendor change; operational checks need their own evidence.

## Recipe 3a — Protected scheduled releases

The repository's scheduled release workflow opens a reviewable `release/vX.Y.Z`
pull request because `main` requires pull requests and four runtime checks. GitHub
places pull-request workflows created with the repository `GITHUB_TOKEN` into an
approval-required state. Explicit `workflow_dispatch` events run, but their jobs
do not satisfy branch protection's required pull-request checks, and their
completion does not produce a downstream `workflow_run` when the repository token
authored the dispatch. GitHub documents a personal token or GitHub App as the
fully automated alternative. DocGuard instead keeps the repository token and one
explicit maintainer action: select **Approve workflows to run** on the generated
PR. No release credential is stored.

After approval, ordinary pull-request CI supplies the four required contexts.
Before the branch is pushed, the trusted scheduler validates the base repository,
bot author, branch/title/version agreement, next-version increment, synchronized
package surfaces, and changed-file allowlist. It then arms GitHub's native squash
auto-merge. Native auto-merge remains blocked by the four required checks, binds
eligibility to the current PR head, and resets when that head changes. The
scheduler waits up to ten minutes for the merge and then dispatches the
idempotent release workflow. An hourly tag-driven release sweep covers approvals
that happen after this bounded wait; tagged versions exit after the small detect
job. If publication is interrupted, either the hourly sweep or the next release
schedule sees the current package version without a tag and retries publication
before considering another bump. An orphaned release branch fails closed; an
existing open release PR is reused and has auto-merge re-armed.

Do not use a post-approval `workflow_run` listener as the release continuation.
The approval-required completion is the event that listener observes; approving
the held run executes its jobs without producing a second completion event for
the listener. Release PR #380 demonstrated this boundary while publishing
v0.40.1. Release PR #383 then proved repository-token native auto-merge, while
also proving that its resulting push is recursion-suppressed and cannot be the
sole publication trigger. The bounded wait handles the normal approval path; the
hourly tag sweep supplies durable recovery without continuous polling or another
credential.

The v0.40.3 release is the retained end-to-end proof. Scheduled run
`34922506777` opened repository-token PR #386 and armed native auto-merge. After
one maintainer workflow approval, CI run `34922605581` and supply-chain run
`34922605917` passed, GitHub merged
`e27d6bf0203708ee8206a1434eb292520f4c4494`, and the bounded wait dispatched
publication run `34922784629`. That run published npm, PyPI, GHCR, the GitHub
Release, extension ZIP, and MCPB and refreshed the catalog reminder.

Catalog submission remains an explicit human action. The release and manual
catalog workflows maintain one open reminder in this repository: each run
refreshes the newest matching issue to the current version and closes older
matching reminders as superseded.

## Recipe 3b — Spec completion and post-hoc reconciliation

Run `docguard reconcile --since <merge-base> --format json` when implementation
may have changed approved behavior outside the original Spec Kit flow. Review
unsupported files and intent-change classifications; write mode can refresh only
DocGuard-owned mechanical sections. After declared tasks, source and test
evidence, and affected canonical docs are reviewed, run `docguard specs complete --id <spec-id>
--since <merge-base> --check` as the merge gate. Apply the same command with
`--write --reason "<reviewed outcome>"` on a clean controlled checkout to record
verification. A taskless living verification contract is eligible only when every
requirement has qualified evidence. Keep living specs current; archive only when the registry reports
that the selected persistence model is ready.

## Recipe 4 — Score (track CDD maturity over time)

`score --format json` reports structural maturity. Its numeric threshold is stable, while `assurance` explicitly states that factual accuracy remains unverified. Comparing scores is meaningful only with the same tool/configuration and a comparable coverage scope.

Use guard findings and declared verification evidence for enforcement. A high score alone does not establish current documentation, correct prose, or regulatory compliance.

## Recipe 1b — GitLab CI / Jenkins (JUnit output)

`guard --format junit` emits a test report suitable for GitLab/Jenkins ingestion. Install a fixed DocGuard version in the job, capture the exit status, and upload the report even on failures. Permitting exit 2 is an explicit warning policy; other nonzero statuses remain failures.

## Recipe 4b — Score history across ephemeral CI runs

`ci` records history by default. `--no-history` opts out. Ephemeral runners need an explicitly configured artifact or cache policy if trends are to span runs. Treat restored history as informational data, not proof that the current checkout was verified. Avoid sharing writable caches between untrusted pull requests and privileged release workflows.

## Recipe 4c — Multi-repo scorecard (no extra tooling)

Run `ci --format json` per repository and retain project, revision, tool version, configuration, status, and assurance scope. Aggregate findings by code while preserving their repository ownership. Report unsupported and unclassified coverage alongside successful checks.

## Recipe 4d — Detector precision regression

Run the network-free synthetic corpus on ordinary pull requests:

```sh
node benchmarks/run.mjs --baseline benchmarks/baseline.json
```

Run the full pinned public corpus in a separate trusted, network-enabled job when detector or scanner behavior changes:

```sh
node benchmarks/run.mjs --external --baseline benchmarks/baseline.json
```

Treat a core comparison failure as a quality regression. Persisted runtime snapshots stay advisory even when environment labels match. Apply the 20-percent gate only to at least five controlled samples from the same paired comparison session. Updating the baseline is a reviewed change: inspect every added or removed case, label, unsupported result, and confidence limit before using `--replace-baseline`.

## Pre-commit hook (no GitHub Actions required)

`docguard hooks --type pre-commit` installs a local gate that prefers the repository's installed DocGuard binary. The hook blocks an unavailable runtime. `--auto-fix` additionally applies mechanical fixes and stages their output; enable it only when that mutation is intended.

Regenerate installed hooks after upgrading to pick up changes in hook behavior. The pre-push score hook parses real JSON and enforces its configured minimum; it complements the full CI gate. Local hooks can be bypassed, so protected merges remain necessary for shared enforcement.

## Recipe 5 — Pre-commit lite (changed files only)

`guard --changed-only --since <ref>` runs its curated validator subset with changed-file scoping, plus explicitly escalated validators. Use a full guard at the merge boundary. The entry point and `guard.mjs` define the current subset; a copied list in this recipe would drift.

## Permissions cheatsheet

| Operation | Default authority | Additional authority |
|---|---|---|
| Guard, score, report | Repository read | Artifact storage if configured |
| Mechanical repair | Read/write controlled checkout | Branch/PR publication only when enabled |
| Feedback preview | Local analysis | User submits reviewed public metadata voluntarily |
| External precision corpus | Public read-only Git fetch | Network access to exact pinned commits; no project script execution |
| Scheduled review | Repository read | Notification or publication only when explicitly configured |

## Action inputs reference

`action.yml` is the authoritative composite-action input contract. Review command selection, warning policy, score threshold, working directory, and optional commit/comment flags. Pin the action to a reviewed commit and retain the corresponding release label for maintenance.

## Action outputs reference

Read the outputs declared in `action.yml` and the command's JSON schema before wiring downstream steps. Preserve unknown/unverified values. An integrity digest detects changes to covered report data; it is neither a trusted signature nor proof of a correct scanner.
