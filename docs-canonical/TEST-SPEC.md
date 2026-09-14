# Test Specification

<!-- docguard:version 0.8.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-11 -->

> DocGuard has a single optional-load npm dependency (`@babel/parser`) and an optional `python3` AST tier. CLI integration tests cover the full stack with `node:test` (zero dev dependencies) and exercise both AST extractors (`js-ast`, `py-ast`) plus their regex fallbacks. The Python AST tests skip themselves automatically on a machine that lacks `python3`.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Project Type** | CLI |
| **Test Framework** | `node:test` (built-in) |
| **Test Files** | `tests/` |

---

DocGuard's tests verify command behavior through subprocess execution. Each test runs the full CLI binary via execSync, capturing stdout and checking output patterns. This approach tests the complete stack in a single pass: argument parsing, config loading, validator execution, and output formatting.

Tests are designed to be config-aware. They verify that project-type settings like needsEnvExample and testFramework correctly influence scoring and validation behavior. Regression guards preserve known failures with dedicated assertions and neighboring valid cases.

All tests use the built-in node:test framework with zero test dependencies. CI runs the suite on Node 18, 20, 22, and 24. Its runtime budget catches large regressions; local timing depends on runtime and filesystem. Record measured timing with its environment rather than asserting a universal duration.

Test names follow the pattern: "verb + expected behavior" (e.g., "runs and shows a score", "respects projectTypeConfig"). Each test should isolate its mutable fixtures and clean up its resources.

## Test Categories

| Category | Framework | Location | Run Command |
|----------|-----------|----------|-------------|
| Unit | node:test | tests/ | `npm test` |
| CLI Integration | node:test | tests/ | `npm test` |

> **CLI integration tests cover the full stack** — this is a CLI tool with zero UI surface.
> Commands are validated end-to-end via Node.js subprocess execution, making separate E2E tests redundant.

All test files live in `tests/` and match the glob `tests/*.test.mjs` — the test runner supplies the current inventory as the suite grows; see the Source-to-Test Map below for the source→test traceability that matters.

## Coverage Rules

| Metric | Target | Current |
|--------|:------:|:-------:|
| Command Coverage | Every public command | Scenario coverage; inspect tests before claiming exhaustive behavior |
| Validator Coverage | Every validator | Positive, negative, and regression cases |
| Flag Coverage | Risk-based | Tested scenarios; no exhaustive coverage claim |
| Test Count | — | Current count is emitted by `npm test` |

## Source-to-Test Map

| Source File | Test File | Status |
|------------|-----------|:------:|
| `cli/docguard.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/shared.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/init.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/guard.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/score.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/diff.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/generate.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/agents.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/hooks.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/diagnose.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/badge.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/ci.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/fix.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/watch.mjs` | `tests/commands.test.mjs` | ✅ pass |
| `cli/commands/publish.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/trace.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/shared-requirements.mjs` | `tests/traceability.test.mjs`, `tests/archive.test.mjs` | ✅ |
| `cli/scanners/requirement-evidence.mjs` | `tests/traceability.test.mjs`, `tests/spec-registry.test.mjs` | ✅ |
| `cli/commands/retire.mjs` | `tests/archive.test.mjs` | ✅ |
| `cli/validators/document-lifecycle.mjs` | `tests/document-lifecycle.test.mjs` | ✅ |
| `cli/commands/specs.mjs`, `cli/scanners/spec-registry.mjs`, `cli/validators/spec-registry.mjs` | `tests/spec-registry.test.mjs` | ✅ |
| `cli/validators/structure.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/validators/docs-diff.mjs` | `tests/commands.test.mjs` | ✅ |

> **Note**: `watch.mjs` is an interactive file-watcher (uses `fs.watch` + process signals). It is
> covered by automated lifecycle tests, including filesystem watcher error handling.
> Manual checks supplement platform-specific event behavior.

## Critical CLI Flows

| # | Flow | Test File | Status |
|---|------|-----------|:------:|
| 1 | `docguard audit` | `tests/commands.test.mjs` | ✅ |
| 2 | `docguard init` | `tests/commands.test.mjs` | ✅ |
| 3 | `docguard guard` | `tests/commands.test.mjs` | ✅ |
| 4 | `docguard guard --format json` | `tests/commands.test.mjs` | ✅ |
| 5 | `docguard score` | `tests/commands.test.mjs` | ✅ |
| 6 | `docguard score --format json` | `tests/commands.test.mjs` | ✅ |
| 7 | `docguard score --tax` | `tests/commands.test.mjs` | ✅ |
| 8 | `docguard diagnose` | `tests/commands.test.mjs` | ✅ |
| 9 | `docguard diagnose --format json` | `tests/commands.test.mjs` | ✅ |
| 10 | `docguard generate` | `tests/commands.test.mjs` | ✅ |
| 11 | `docguard init --profile starter` | `tests/commands.test.mjs` | ✅ |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.7.0 | 2026-03-13 | @raccioly | Added trace, publish; watch.mjs coverage justified (ISO 29119); 15 commands |
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, guard JSON, profile, tax tests (24→30) |
| 0.3.0 | 2026-03-12 | @raccioly | Real tests, project-type-aware spec |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |

## Trust regression scenarios

`tests/score-assurance.test.mjs` checks that structural grades never claim factual verification and that CI, diagnose, and reports retain this boundary. `tests/feedback-contributions.test.mjs` checks confident-finding selection, preview behavior, and outbound metadata privacy. Cache tests must change source contents without changing a manifest or Git HEAD, including repeated edits and fresh-process reads. Hook tests execute generated scripts against controlled runtimes rather than merely matching shell text. Traceability tests pair synthetic fixture IDs with genuine requirement annotations.

A detector fix should include a clean near-miss and a real defect. Held-out neighboring cases are required to evaluate generalization. The proposed external benchmark is specified in `ROADMAP.md`; its targets are acceptance criteria, not measured results.

Retirement tests use disposable Git repositories and verify both sides of the boundary: completed planning material is reported for review, while active neighboring material stays clean. Write-path tests must prove retained-ref recovery metadata and refusal of source code, dirty, untracked, required, symlinked, private, protected, submodule, and out-of-root paths. Read-only plan and check modes must not modify repository state.

## Enterprise precision regressions

Regression cases are synthetic and name no consumer repositories. Keep a valid near-neighbor beside every detected defect: formatting versus declaration deletion; negated versus current technology use; explained versus unexplained skips; mock expectations versus credentials; implemented versus omitted contract endpoints; Worker bindings versus local variables; historical versus active documents. Check coverage tests distinguish unsupported and missing inputs from executed checks. Document-role tests exercise mapped findings, raw/loaded configuration parity, unsafe paths, and read-only planning without writes.

Independent review must challenge suppression paths, not only the original false-positive example. Cross-project runs use disposable snapshots and verify consumer content remains unchanged. Finding counts alone cannot establish precision or recall.
