# Implementation Plan: Release Workflows Run Code Without Write Tokens

**Branch**: `ci/release-least-privilege` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | Every workflow defaults to `contents: read` (`release.yml`, `scheduled-release.yml`, `auto-merge.yml`, `jules-triage.yml`, `supply-chain.yml`, `sync-speckit-catalog.yml`); each writing job asks for its own scope. |
| FR-002 | `release.yml` `test` and `ci.yml`'s jobs that run tests or DocGuard set `persist-credentials: false` and hold read only. |
| FR-003, FR-004 | `release.yml`: `build-extension` and `build-mcpb` build read-only and upload artifacts; a new `attach-assets` job (contents: write, no checkout) runs `gh release upload`. `build-pypi` (read-only) builds `dist/`; `publish-pypi` (environment `pypi`, `id-token: write`) downloads it and runs the PyPA action only. |
| FR-005 | `scheduled-release.yml` becomes four jobs: `cut` (read: check, bump, cut CHANGELOG, sync versions, validate the candidate, upload the patch), `verify` (read: apply the patch, `npm ci`, `npm test`, guard), `open-pr` (contents, pull-requests and actions write: check the patch's paths, apply it, push, open the PR, arm auto-merge, dispatch publication; only `git`, `gh`, `jq`), `recover` (actions write only, no checkout). |
| FR-006 | `publish-ghcr`: `docker login` moves after build and smoke test. |
| FR-007 | `tests/workflow-permissions.test.mjs` (NEW): a dependency-free reader of the workflow files checks FR-001–FR-003 on every workflow, plus FR-004–FR-006 on the release workflows, and proves itself on a violating sample. |
| FR-008 | `docs-canonical/SECURITY.md`, `docs-canonical/CI-RECIPES.md` (Recipe 3a), `docs/installation.md` (supply-chain table), `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`. |

## Technical Context

**Language/Version**: GitHub Actions YAML; tests in JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new. Actions pinned to commit SHAs: `actions/upload-artifact@043fb46…` (v7.0.1, already used in `ci.yml`) and `actions/download-artifact@3e5f45b…` (v8.0.1, verified against the tag).
**Testing**: `node:test`; the workflows are read as text with an indentation reader (no YAML dependency, Principle II).

## Research decisions

- **Separate jobs, not stripped steps.** Within one job every step shares the runner, the workspace and `.git/config`; a token granted to the job is reachable from any step. Only a job boundary removes it. *Rejected:* `persist-credentials: false` alone in the scheduled job: the job still holds `GITHUB_TOKEN` with three write scopes, and its later steps push from a workspace test code could have changed.
- **Upload the patch before tests run, from a different job.** The writing job applies what the cut produced, never what a test run left behind. *Rejected:* one read-only job that cuts and tests: test code could rewrite the patch before upload.
- **The writing job checks the patch's paths itself.** It cannot call the repository's validator (that would run repository code with a write token), so it compares `git apply --numstat` against the same path list its `git add` already names; the read-only `cut` job still runs the full `validate-release-candidate.mjs`.
- **Artifacts for assets.** The pattern GitHub and PyPA recommend: build without credentials, publish only the built files. Trusted publishing on PyPI is bound to the workflow file and the `pypi` environment, not the job name, so moving the build out does not affect it.
- **npm publish unchanged.** Trusted Publishing has failed six releases on configuration details; `publish-npm` already holds only `contents: read` and `id-token: write`. Re-plumbing it to publish a prebuilt tarball is a separate risk for no repository-write gain.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added; the workflow reader is in the test. |
| VI (safe writes) | The release branch carries exactly the validated patch. |
| VIII (local-first) | No runtime change. |
| Supply chain | Every action stays pinned to a full commit SHA; no `pull_request_target` added. |
| X (spec-first) | Spec, plan and tasks precede the change. |

Pass.

## Project Structure

```text
.github/workflows/release.yml            # FR-001–FR-004, FR-006
.github/workflows/scheduled-release.yml  # FR-001, FR-002, FR-005
.github/workflows/ci.yml                 # FR-002
.github/workflows/auto-merge.yml, jules-triage.yml, supply-chain.yml, sync-speckit-catalog.yml   # FR-001
tests/workflow-permissions.test.mjs      # NEW (FR-007)
tests/scheduled-release.test.mjs, tests/release-readiness.test.mjs, tests/catalog-submission.test.mjs   # follow the new layout
docs-canonical/SECURITY.md, docs-canonical/CI-RECIPES.md, docs/installation.md, docs-canonical/TEST-SPEC.md, CHANGELOG.md   # FR-008
```
