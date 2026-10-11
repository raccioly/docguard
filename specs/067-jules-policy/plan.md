# Implementation Plan: Jules Automation Policy

**Branch**: `ci/jules-policy` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `mergeVerdict` in `.github/scripts/jules-policy.mjs`: only added `tests/<name>.test.mjs`, 1 to 10 files. |
| FR-002 | `.github/workflows/auto-merge.yml` Jules branch: `repos.compareCommitsWithBasehead` against the verified head, then `mergeVerdict`; `pulls.merge` takes `sha: headSha`. |
| FR-003 – FR-006, FR-008 | `noiseReason`, `contractReason` and `triage` in the policy module. No title keyword closes a PR. |
| FR-004, FR-007 | `.github/scripts/jules-triage.mjs`: paginated open, closed (stopping at the 60-day window) and file lists; comments carry a marker and no handle. `.github/workflows/jules-triage.yml` only runs it. |
| FR-009, FR-010 | `pickTarget`, `bugHuntTargets`, `untestedExports`, `helpSubcommands`; `.jules/preflight.mjs` reads the queue and the repository and prints GO or STOP. |
| FR-011 | `.jules/setup.sh`; `.jules-setup.sh` removed. |
| FR-012 | `.jules/RULES.md` §5, `.jules/routines/{bug-hunt,test-gaps,docs-drift}.md`, `.jules/README.md`. |
| FR-013 | Persona notes removed; `AGENTS.md` Automated agents section, `docs-canonical/ARCHITECTURE.md` config-file table, `docs-canonical/TEST-SPEC.md` source-to-test map. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18 (the policy runs in `actions/github-script` on the runner's Node and in the Jules VM).
**Primary Dependencies**: none new. The policy is pure; the glue receives the `github`, `context` and `core` objects `actions/github-script` passes.
**Testing**: `node:test`. `tests/jules-policy.test.mjs` covers the pure policy with replays of real PR shapes, the triage glue against an in-memory GitHub double, and the workflow, setup and routine files as text.

## Research decisions

- **Port TestGuard's policy, narrowed.** raccioly/testguard#207 is reviewed and running. DocGuard drops its user-docs and claims-defender merge paths: a docs change here can be a prompt that ships to npm, and DocGuard's CI does not gate a claims file. Rejected: extending the old inline path filter, which is the defect.
- **No persona or subject rule.** TestGuard closes Sentinel, Bolt and Palette PRs by persona. Here that closes the security fix the audit asks to keep (spec Problem 6). Persona PRs fall to the same duplicate, decline and queue rules as everything else, and the README turns the personas off at the source.
- **Compare the verified head, not the branch.** `compareCommitsWithBasehead(base...head_sha)` is immutable for that SHA. Its file list stops at 300, which the 10-file limit already holds. Rejected: paginating `pulls.listFiles`, which reads the branch as it is now, not the commit CI verified.
- **Pin the merge.** `sha: headSha` makes GitHub refuse the merge if the branch moved after CI. The shared merge call carries it for Dependabot too; that only narrows what can merge.
- **Contract closes do not block the target.** A routine PR that breaks its contract is closed, but the target stays available, because the work itself was never judged. A queue-full close is treated the same way.
- **One open PR per routine.** Preflight stops a routine while its previous PR waits. Three weekly routines then never fill the five-PR queue alone; the cap still bounds untagged PRs.
- **`bug-hunt` targets carry a governing spec.** CI's spec-first gate needs a `cli/**` change to name its spec. Walking only modules with `@implements docguard.<id>` lets the PR name it instead of declaring an exemption.
- **Setup fetches full history.** CI checks out with `fetch-depth: 0` for the freshness validator; the Jules VM clones with depth 1. Setup unshallows before the suite runs, so a green snapshot means what a green CI run means.
- **CHANGELOG stays with the maintainer.** The weekly release infers its semver bump from the `[Unreleased]` headings, and `llms-full.txt` bundles the changelog, so a bot edit there changes a release. A held PR gets its entry when a maintainer merges it.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| VI (safe writes) | No CLI write path changes. |
| IX (honest assurance) | A merge reason states exactly what merged; anything else is held with its reason. |
| X (spec-first) | Spec, plan and tasks precede code. |
| Development Workflow | Actions stay pinned to commit SHAs. `pull_request_target` checks out only the default branch, without persisted credentials, and reads the PR through the API. |
| Development Workflow (CHANGELOG) | A Jules PR that only adds tests merges without a changelog entry, as Dependabot bumps already do: it changes nothing a user sees, and a changelog edit also regenerates `llms-full.txt`, which a bot may not merge. Held PRs get their entry from the maintainer who merges them. |

Pass.

## Project Structure

```text
.github/scripts/jules-policy.mjs        # NEW: FR-001, FR-003 – FR-010
.github/scripts/jules-triage.mjs        # NEW: FR-004, FR-007
.github/workflows/jules-triage.yml      # FR-004 – FR-007
.github/workflows/auto-merge.yml        # FR-001, FR-002
.jules/README.md, .jules/RULES.md       # NEW: FR-012
.jules/setup.sh                         # NEW: FR-011
.jules/preflight.mjs                    # NEW: FR-009, FR-010
.jules/routines/*.md                    # NEW: FR-008, FR-012
.jules-setup.sh, .jules/{sentinel,bolt,palette}.md   # REMOVED: FR-011, FR-013
AGENTS.md, docs-canonical/ARCHITECTURE.md, docs-canonical/TEST-SPEC.md   # FR-013
tests/jules-policy.test.mjs             # NEW
CHANGELOG.md, llms-full.txt
```
