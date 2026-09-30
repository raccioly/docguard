# Implementation Plan: Release Readiness

**Branch**: `chore/release-prep-0.43` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Bump inference and the changelog cut move out of inline workflow shell
(`node -e`, `awk`) into `.github/scripts/release-changelog.mjs`, which is pure
and unit-tested. `action.yml` gains a stamped `DOCGUARD_RELEASED_VERSION` and a
`docguard-version` input. `sync-release-version.mjs` stamps it along with the
copyable README and docs examples, and `release-pr-policy.mjs` allows those
paths. The Homebrew formula becomes a template.
`.github/scripts/homebrew-formula.mjs` renders it from the registry tarball, and
`publish-homebrew-tap.sh` (ported from TestGuard) pushes it. `release.yml`'s
detect job reports `brew_missing` when the key exists and the tap is behind.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18 (release jobs use 24)
**Primary Dependencies**: none new
**Testing**: `node:test`; injected `fetch` for the registry poll
**Project Type**: CLI + release automation

## Constitution Check

- VIII (local-first): the new network access is in release CI only; the CLI is
  unchanged.
- Supply chain: actions are SHA-pinned, and the deploy key is scoped to one
  repository.
- IX (honest assurance): published notes are the reviewed ones, and a pinned
  action runs what it claims.

Pass.

## Project Structure

```text
.github/scripts/release-changelog.mjs    # NEW: inferBump, nextVersion, cutChangelog
.github/scripts/homebrew-formula.mjs     # NEW: render from the published tarball
.github/scripts/publish-homebrew-tap.sh  # NEW: ported from raccioly/testguard
.github/scripts/sync-release-version.mjs # action.yml pin, README/docs examples
.github/workflows/scheduled-release.yml  # auto bump, scripted cut
.github/workflows/release.yml            # brew_missing, publish-homebrew
action.yml                               # docguard-version input, stamped pin
cli/release-pr-policy.mjs                # allowlist
cli/docguard.mjs                         # top-level help summaries
schemas/docguard-config.schema.json      # specKit.untouchedClaimCheck
packaging/homebrew/docguard.rb           # template
tests/release-readiness.test.mjs         # NEW
tests/release-version-sync.test.mjs
```
