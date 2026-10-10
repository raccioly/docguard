---
title: Continuous Integration
parent: Guides
nav_order: 3
---

# Continuous Integration

DocGuard gates a pipeline with exit codes and writes reports in formats that CI
systems read. This page covers the GitHub Action, starter workflows for GitHub
Actions, and recipes for GitLab CI, Azure Pipelines, CircleCI, Jenkins and plain
shell.

In the examples, replace `X.Y.Z` with the DocGuard version you have reviewed.
The maintained source for these recipes is
[`docs-canonical/CI-RECIPES.md`](https://github.com/raccioly/docguard/blob/main/docs-canonical/CI-RECIPES.md).

## Before you add a gate

- **Adopt DocGuard in the repository first.** Commit `.docguard.json`. Without
  it, guard exits `3`, which means "not initialised". See
  [Existing Projects](existing-projects.md).
- **On an existing codebase, commit a baseline.** Otherwise the first run fails
  on every finding that already exists. See [Baselines in CI](#baselines-in-ci).
- **Pin the version.** Use `npx docguard-cli@X.Y.Z`, a pinned devDependency, or
  a pinned action tag.
- **Clone with full history.** Freshness, `diff --since`, `specs require` and
  `specs complete` read Git history. A shallow clone makes them partial or
  inconclusive.
- **Run against the revision that will merge.** Use the pull request's merge
  commit or a merge queue trigger, not an older branch head.
- **Require the check in branch protection.** Adding a workflow does not make
  it required.

## Choose the command

| | `guard` | `ci` |
|---|---|---|
| Runs | Every enabled validator | `guard`, then the structural maturity score |
| Fails on a low score | No | Yes, with `--threshold <n>` |
| Output formats | text, `json`, `sarif`, `junit` | text, `json` |
| Strict on warnings | Warnings already exit `2` | `--fail-on-warning` turns warnings into exit `1` |
| History | Not recorded | Appends to `.docguard/history.jsonl` unless `--no-history` |
| Uninitialised project | Exit `3` | Exit `1` |

Use `guard` when you need SARIF or JUnit. Use `ci` when you also want a minimum
score, or a single READY / ATTENTION / BLOCKED verdict in JSON. Both use the
committed baseline and the severity overrides in `.docguard.json`, so the same
findings give the same verdict from both.

The score measures documentation structure, not whether the documentation is
correct. Use guard findings for enforcement; a high score alone proves neither.

## Exit codes

| Command | `0` | `1` | `2` | `3` |
|---|---|---|---|---|
| `guard` (any format) | Pass | Errors, or an invalid flag combination | Warnings only | Errors in a project with no `.docguard.json` |
| `ci` | READY | BLOCKED: guard errors, a score below `--threshold`, or warnings with `--fail-on-warning` | ATTENTION: warnings only | (not used) |
| `specs require` | Covered | A governed change names no spec | Inconclusive: unknown base, shallow history or an oversized inventory | (not used) |
| `specs --check` | Registry current | (not used) | Registry missing, stale or inconsistent | (not used) |
| `verify --evidence` | Every declaration verified | A contradiction, or an invalid manifest | Stale, inconclusive or unsupported evidence | (not used) |

A plain shell step fails on any non-zero exit, so by default warnings fail the
job. To let warnings pass, capture the status and allow only `0` and `2`:

```sh
status=0
npx --yes docguard-cli@X.Y.Z guard || status=$?
[ "$status" -eq 0 ] || [ "$status" -eq 2 ]
```

Any other status is a failure, including a missing executable or a crash. Do
not treat it as a clean scan.

`guard` accepts `--fail-on-warning`, but it does not change guard's exit code,
because warnings already exit `2`. To make warnings fail, treat `2` as a failure
(the shell default), use `ci --fail-on-warning`, or set the action's
`fail-on-warning: 'true'`.

## Report formats

| Flag | Output | For |
|---|---|---|
| `--format json` | The guard or ci result as JSON | Scripts, dashboards, agents |
| `--format sarif` (guard only) | SARIF 2.1.0: finding codes become rules, locations become regions | GitHub code scanning and other SARIF viewers |
| `--format junit` (guard only) | JUnit XML, one test case per validator | GitLab, Jenkins, Azure DevOps, CircleCI test reports |

With a machine format, stdout contains only the report, and notes go to
stderr. A large report is flushed completely before the process exits, so
`> report.json` is safe.

Each SARIF result carries the finding's channels in `properties`:
`disposition`, `confidence`, `evidence`, `parserTier`, `reportable`,
`suggestionKind`, and the intrinsic and effective severities. Base automation on
`disposition`, not on severity alone:

- `act`: DocGuard names the correction.
- `escalate`: a person must judge it. Applying an automated fix to an escalation
  silences the signal without resolving it.

A `parserTier` of `regex-fallback` or `fallback-language` means no syntax tree
was available for that file. The absence of findings there is weak evidence.

## Baselines in CI

On a repository that already has findings, freeze them once and gate only new
ones:

```bash
npx docguard-cli@X.Y.Z guard --update-baseline   # writes .docguard.baseline.json
git add .docguard.baseline.json
```

`guard` and `ci` then suppress the frozen findings and fail only on new ones.
The suppression is always reported: a "N pre-existing finding(s) suppressed"
line in text output, and `baselineSuppressed` in JSON. `--no-baseline` shows
everything for one run. `"baseline": false` in `.docguard.json` turns the
baseline off.

- `--update-baseline` cannot be combined with `--changed-only`. The baseline
  must freeze the full validator set.
- Regenerate the baseline only in a reviewed change, so the diff shows what was
  accepted.

## GitHub Actions

### The DocGuard action

```yaml
name: DocGuard
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  pull-requests: write   # only for the sticky PR comment
jobs:
  docguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: raccioly/docguard@vX.Y.Z
        with:
          command: guard
```

The action installs the `docguard-cli` version it was released with, so pinning
`raccioly/docguard@vX.Y.Z` also pins the CLI. For a stronger pin, use a full
commit SHA and keep the release tag in a comment.

**Inputs** (from [`action.yml`](https://github.com/raccioly/docguard/blob/main/action.yml)):

| Input | Default | Description |
|---|---|---|
| `command` | `guard` | `guard`, `score`, `spec-first`, `fix`, `sync`, `audit` or `diff`. Any other value is passed to the CLI as a command name. |
| `format` | `text` | `text` or `json`. SARIF and JUnit are not available through this input; see [SARIF to code scanning](#sarif-to-code-scanning). |
| `fail-on-warning` | `false` | With `guard`: fail on warnings. Without it, warnings (exit `2`) pass with a `::warning`. |
| `score-threshold` | `0` | With `score`: fail when the score is below this value. |
| `working-directory` | `.` | Project directory to check, for example one package of a [monorepo](monorepo.md). |
| `node-version` | `20` | Node.js version to set up. |
| `docguard-version` | empty | Empty installs the CLI version the action was released with. Accepts `x.y.z` or `latest`. |
| `annotations` | `true` | With `guard`: inline `::error` / `::warning` annotations, one per finding, capped at 50. |
| `pr-comment` | `true` | With `guard` on `pull_request` events: one sticky comment with the verdict, the top findings and the canonical docs that the changed files affect. Needs `pull-requests: write`. Without it, the action logs a warning. |
| `auto-commit` | `false` | With `fix` or `sync`: commit the mechanical fixes to the PR branch. Needs `contents: write`. Skipped for pull requests from forks. |
| `commit-message` | `docs: apply DocGuard mechanical fixes` | Message for the auto-commit. |
| `comment-on-pr` | `false` | With `fix` or `sync`: post a summary comment on the PR. |
| `bot-name` / `bot-email` | `docguard-bot` / `docguard-bot@users.noreply.github.com` | Author of the auto-commit. |

**Outputs**: `score` and `grade` (with `command: score`), `result` (the JSON
result, with `command: score` and `format: json`), `fixes-applied`,
`changed-files` and `committed` (with `fix` or `sync`).

Annotations and the PR comment run even when guard fails, because that is when
they matter. The action passes every input and every piece of event data, such
as the PR body and branch names, through environment variables. None of it is
spliced into a script.

The action does not run `ci` with a threshold. `score-threshold` applies only
to `command: score`. To combine guard and a minimum score in one step, call the
CLI directly, as the starter workflow below does.

### Starter workflow

`docguard init --with ci` writes `.github/workflows/docguard.yml` from
[`templates/ci/github-actions.yml`](https://github.com/raccioly/docguard/blob/main/templates/ci/github-actions.yml).
It keeps an existing workflow; `--force` backs it up and replaces it. The
starter:

- checks out the full history with `persist-credentials: false`;
- installs a pinned `docguard-cli` with `--ignore-scripts`;
- runs `docguard ci --format json --threshold 70 --no-history`;
- validates that the report is JSON and records its verdict from the real exit
  code;
- writes the report to the job summary and uploads it as an artifact.

Its actions are pinned to commit SHAs. Review the pins and the threshold before
you commit it.

The Spec Kit extension ships two more starters in
[`extensions/spec-kit-docguard/templates/github-workflows/`](https://github.com/raccioly/docguard/tree/main/extensions/spec-kit-docguard/templates/github-workflows):

- `docguard-guard.yml` runs `guard --format json`. Warnings do not block unless
  you set its `FAIL_ON_WARNING` variable to `'true'`. On pull requests it also
  captures the score.
- `docguard-autofix.yml` applies mechanical fixes on pull requests.

### SARIF to code scanning

Write SARIF with the CLI and upload it with GitHub's `upload-sarif` action. The
repository must have code scanning available.

```yaml
permissions:
  contents: read
  security-events: write
jobs:
  docguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: DocGuard (SARIF)
        id: docguard
        run: |
          status=0
          npx --yes docguard-cli@X.Y.Z guard --format sarif > docguard.sarif || status=$?
          echo "status=$status" >> "$GITHUB_OUTPUT"
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: docguard.sarif
      - name: Gate (allow warnings)
        env:
          STATUS: ${{ steps.docguard.outputs.status }}
        run: '[ "$STATUS" -eq 0 ] || [ "$STATUS" -eq 2 ]'
```

Uploading comes before the gate, so findings reach code scanning even when the
job fails.

### Spec-first gate

Make every pull request that changes governed code name its spec:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: raccioly/docguard@vX.Y.Z
  with: { command: spec-first }
```

The action runs `docguard specs require --since origin/<base> --message-file
<PR body>`. A pull request passes in any of these cases:

- its description or a commit message names an existing `specs/<dir>` path or
  Spec ID;
- it edits a spec's own files;
- it has one line `Spec-Exempt: <kind> — <reason>`. The default kinds are
  `release`, `deps`, `typo` and `test-only`, and the reason must be at least 10
  characters.

A reference to a spec that does not exist never passes. Exit `1` (uncovered)
and exit `2` (inconclusive) both fail the job. Declare the governed paths in
`.docguard.json`; see [`specFirst`](../configuration.md#spec-first-gate--specfirst).

When you call the CLI from your own workflow, pass the PR body through `env`
into a file. Never put `${{ github.event.pull_request.body }}` inside a `run:`
script.

```yaml
- name: Spec-first
  env:
    PR_BODY: ${{ github.event.pull_request.body }}
    BASE_REF: ${{ github.base_ref }}
  run: |
    git fetch --no-tags origin "$BASE_REF"
    printf '%s' "$PR_BODY" > "$RUNNER_TEMP/pr-body.txt"
    npx --yes docguard-cli@X.Y.Z specs require \
      --since "origin/$BASE_REF" --message-file "$RUNNER_TEMP/pr-body.txt"
```

To fail when the spec registry is out of date, add
`npx --yes docguard-cli@X.Y.Z specs --check`. It exits `2` when
`.docguard-specs.json` is missing or stale. See the [Spec Kit guide](spec-kit.md).

## GitLab CI

The repository includes a GitLab job template,
[`templates/ci/gitlab-component.yml`](https://github.com/raccioly/docguard/blob/main/templates/ci/gitlab-component.yml).
It is not published to the GitLab CI/CD Catalog. Include it from a release tag:

```yaml
include:
  - remote: https://raw.githubusercontent.com/raccioly/docguard/vX.Y.Z/templates/ci/gitlab-component.yml
    inputs:
      command: ci            # guard, score or ci
      threshold: 70          # enforced by ci only
      fail_on_warning: false
      version: 'X.Y.Z'       # always set it; the file's default is an old release
```

The job uses `node:20` (input `node_image`) and `GIT_DEPTH: 0`. Exit `2` from
`guard` passes unless `fail_on_warning` is true. The job also saves
`docguard.sarif` as an artifact even when it fails. It does not produce a JUnit
report. For test-report integration, use your own job:

```yaml
docguard:
  image: node:20
  stage: test
  variables:
    GIT_DEPTH: "0"
  script:
    - |
      status=0
      npx --yes docguard-cli@X.Y.Z guard --format junit > docguard-junit.xml || status=$?
      [ "$status" -eq 0 ] || [ "$status" -eq 2 ]
  artifacts:
    when: always
    reports:
      junit: docguard-junit.xml
```

## Azure Pipelines

```yaml
steps:
  - checkout: self
    fetchDepth: 0
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
  - script: |
      status=0
      npx --yes docguard-cli@X.Y.Z guard --format junit > docguard-junit.xml || status=$?
      [ "$status" -eq 0 ] || [ "$status" -eq 2 ]
    displayName: DocGuard
  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: docguard-junit.xml
```

## CircleCI

The status is saved to a file so the report is stored before the gate step
runs.

```yaml
version: 2.1
jobs:
  docguard:
    docker:
      - image: cimg/node:lts
    steps:
      - checkout
      - run:
          name: DocGuard report
          command: |
            mkdir -p reports
            status=0
            npx --yes docguard-cli@X.Y.Z guard --format junit > reports/docguard-junit.xml || status=$?
            echo "$status" > /tmp/docguard-status
      - store_test_results:
          path: reports
      - run:
          name: DocGuard gate (allow warnings)
          command: |
            status=$(cat /tmp/docguard-status)
            [ "$status" -eq 0 ] || [ "$status" -eq 2 ]
workflows:
  docs:
    jobs: [docguard]
```

## Jenkins

```groovy
pipeline {
  agent { docker { image 'node:20' } }
  stages {
    stage('DocGuard') {
      steps {
        sh '''
          status=0
          npx --yes docguard-cli@X.Y.Z guard --format junit > docguard-junit.xml || status=$?
          [ "$status" -eq 0 ] || [ "$status" -eq 2 ]
        '''
      }
      post {
        always { junit 'docguard-junit.xml' }
      }
    }
  }
}
```

Make sure the checkout is not shallow.

The Azure Pipelines, CircleCI and Jenkins examples use each platform's own
syntax for Node.js setup and test reports. The DocGuard part is the `npx` call
and the exit-status check; the DocGuard repository does not test these platform
files.

## Any other CI system

Any runner with Node.js 18 or later and `git` can run the gate:

```sh
status=0
npx --yes docguard-cli@X.Y.Z ci --format json --threshold 70 --no-history > docguard-report.json || status=$?
[ "$status" -eq 0 ] || [ "$status" -eq 2 ]   # drop the second test to fail on warnings
```

The JSON has `status` (`PASS`, `WARN`, `FAIL`), `assessment.status` (`READY`,
`ATTENTION`, `BLOCKED`), `score`, `threshold`, `thresholdMet` and a `guard`
block with `dispositionCounts` (`act`, `escalate`, `unclassified`). The exit
code follows `status`.

## Score history across runs

`ci` appends one line per run to `.docguard/history.jsonl`: score, grade,
commit and guard counts. `docguard score --trend` reads it. On ephemeral
runners, the file disappears with the workspace.

- For stateless gates, pass `--no-history`. The starter workflow does this.
- To keep a trend, save and restore `.docguard/history.jsonl` with your CI's
  cache or artifact feature. DocGuard ships no recipe for this.
- Treat restored history as information, not as proof that the current
  checkout was verified.
- Do not share a writable cache between untrusted pull requests and privileged
  workflows.

## Permissions

| Operation | Needs |
|---|---|
| `guard`, `ci`, `score`, `report` | Read access to the repository |
| Action PR comment | `pull-requests: write` |
| SARIF upload | `security-events: write` |
| Action `auto-commit` | `contents: write`, on a same-repository branch only |

Grant write permissions only to workflows that need them. Pull requests from
forks should get read-only checks.

## Related

- [Installation](../installation.md): every way to install the CLI, including
  pre-commit hooks.
- [Monorepos](monorepo.md): `working-directory` and one gate per package.
- [Troubleshooting](troubleshooting.md): unexpected exit codes and partial
  coverage.
- [Finding Codes](../reference/findings.md): what each code means and how to
  suppress it.
