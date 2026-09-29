# Implementation Plan: Unreadable Git Metadata

**Branch**: `fix/unreadable-git-metadata` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

`cli/shared-git.mjs` gains `gitMetadataStatus(dir)`, which returns `{ status: 'ok' | 'absent' |
'unreadable', reason }`. It runs `git rev-parse` once; on failure it looks for a `.git` entry in
`dir` and each ancestor. `unreadableGitApplicability(state)` turns an unreadable state into the
`missing-prerequisite` applicability object. The three validators check the state first. The
Spec-Kit validator sets `partial` when SPK010 is enabled and the state is unreadable. The
Freshness adapter in guard maps a prerequisite-skip to `missing-prerequisite`.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; linked-worktree fixture with its gitdir pointer broken
**Project Type**: CLI

## Constitution Check

IX: this closes a false-green path. IV: validators import the shared git helper, not each
other. VIII: git is local, no network. Pass.

## Project Structure

```text
cli/shared-git.mjs                     # gitMetadataStatus, unreadableGitApplicability
cli/validators/freshness.mjs           # shared helper, prerequisite skip
cli/validators/diff-suspicion.mjs
cli/validators/reference-existence.mjs
cli/scanners/speckit.mjs               # SPK010 partial
cli/commands/guard.mjs                 # freshness adapter
docs-canonical/ENVIRONMENT.md          # agent sandbox section
tests/unreadable-git-metadata.test.mjs # NEW
```
