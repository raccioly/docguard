# Implementation Plan: Release Dispatch Window

**Branch**: `fix/release-dispatch-window` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Change the `release.yml` cron from `17 * * * *` to `*/10 * * * *`, rewrite every
"hourly sweep" statement, and update `tests/scheduled-release.test.mjs`.

## Technical Context

**Language/Version**: GitHub Actions YAML; `node:test`
**Primary Dependencies**: none
**Testing**: `tests/scheduled-release.test.mjs`
**Project Type**: CI configuration

## Constitution Check

Development Workflow (third-party actions pinned; no `pull_request_target`): unchanged. Pass.

## Project Structure

```text
.github/workflows/release.yml
.github/workflows/scheduled-release.yml
docs-canonical/CI-RECIPES.md
tests/scheduled-release.test.mjs
```
