# Implementation Plan: Extension Manifest Hygiene

**Branch**: `fix/extension-manifest-hygiene` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

Correct `extension.yml`:
- `speckit_version` floor, `category` and `effect`;
- explicit priorities on every hook;
- no `requires.framework`;
- `provides.workflows` moves to a top-level `x-docguard.github_workflows`.

Rewrite `templates/extensions.yml` in the shape Spec Kit 1.0.13 writes (verified against a real
`specify extension add` output in this repository). Make `.github/scripts/speckit-submission.py`
read the floor, description, category, effect and tags from the manifest. Extend
`tests/hooks-contract.test.mjs` and `tests/catalog-submission.test.mjs` with the contract.

Research, from the Spec Kit CHANGELOG:
- per-event hook lists with priority arrived in 0.10.0 (#2798);
- `category` and `effect` in 0.10.2 (#2899);
- `/speckit.converge` in 0.11.2 (#3001).

## Technical Context

**Language/Version**: YAML manifest; JavaScript ES modules (tests); Python 3 standard library (submission script)
**Primary Dependencies**: none new
**Testing**: `node:test`; live check with `specify` 1.0.13
**Project Type**: Spec Kit extension inside a CLI package

## Constitution Check

VII (manifest validates against the upstream schema; DocGuard follows Spec Kit conventions):
this feature implements it. II, VIII: no dependencies, no network. Pass.

## Project Structure

```text
extensions/spec-kit-docguard/extension.yml
extensions/spec-kit-docguard/templates/extensions.yml
extensions/spec-kit-docguard/commands/guard.md
.github/scripts/speckit-submission.py
tests/hooks-contract.test.mjs
tests/catalog-submission.test.mjs
```
