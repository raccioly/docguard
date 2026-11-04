# Implementation Plan: DocGuard Runs Inside AWS AI-DLC as a Plugin

**Branch**: `claude/docguard-aws-comparison-077b3f` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001, FR-002 | New `cli/commands/sensor.mjs`. `docguard sensor --aidlc` runs guard and prints one JSON line. `pass` combines effective errors, blocked validators, undecided required checks, and findings introduced since HEAD. The HEAD baseline is a guard run on a local `--no-checkout` clone checked out at HEAD; stable fingerprints are compared as a multiset, and findings in git-ignored files are excluded. Two caches: the tree key (HEAD, porcelain status plus changed-file content, `.docguard.json`, version) and the HEAD fingerprints per commit. The command is headless: no banner on stdout. |
| FR-003, FR-004 | `extensions/aidlc/docguard/` (the directory equals the manifest name, as AI-DLC requires):<br>• `plugin.json` with `marketplace: docguard-aidlc`;<br>• `sensors/aidlc-docguard-guard.md`;<br>• `tools/aidlc-sensor-docguard-guard.ts`, a thin wrapper that never exits 127;<br>• contributions adding the sensor to `code-generation` and `build-and-test`;<br>• a developer-agent knowledge guide and a README. |
| FR-005 | CI job `aidlc-plugin`: installs AI-DLC 2.11.2 from the release URL with the installer's SHA-256 pinned, configures a scratch project, then validates the plugin and builds the `claude` projection. |
| FR-006 | `.github/scripts/sync-release-version.mjs` stamps `plugin.json` with the package version when present; `cli/release-pr-policy.mjs` allows that file in release PRs. |
| FR-007 | README AI-DLC section, `docs/guides/aidlc.md`, ARCHITECTURE, TEST-SPEC, DATA-MODEL, `docs/commands.md`, CHANGELOG. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18. **Dependencies**: none new. **Plugin runtime**: Bun, inside AI-DLC 2.11.2, for the wrapper only. **Testing**: `tests/aidlc-plugin.test.mjs`.

## Research decisions

- **Why a CLI subcommand and a thin wrapper.** AI-DLC runs sensor scripts with Bun, and DocGuard's suite is Node-only. Every decision lives in DocGuard, where `node:test` covers it; the wrapper only passes arguments and output through.
- **Why compare with HEAD.** See Verification Notes in the spec. "No error" let drift through; "no finding" failed every stock AI-DLC project. "Nothing new since HEAD" is the drift the stage introduced.
- **Why a clone, not an archive**, for the baseline: history-based validators and ignored files made 11 phantom "new" findings with an archive.

## Project Structure

- `cli/commands/sensor.mjs` (new), `cli/sensor-cache.mjs` (new, spec 092), `cli/docguard.mjs`
- `extensions/aidlc/docguard/` (new): `.aidlc-plugin/plugin.json`, `sensors/`, `tools/`, `contributions/construction/`, `knowledge/`, `README.md`
- `.github/workflows/ci.yml`, `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`
- `tests/aidlc-plugin.test.mjs` (new)
- `docs/guides/aidlc.md` (new), `README.md`, `docs/`, `docs-canonical/`, `CHANGELOG.md`

## Verification

`tests/aidlc-plugin.test.mjs`; end-to-end with AI-DLC 2.11.2 (Verification Notes); the CI job; full suite; hermetic A/B.
