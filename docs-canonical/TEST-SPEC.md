# Test Specification

<!-- docguard:version 0.8.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-07-03 -->

> DocGuard has a single optional-load npm dependency (`@babel/parser`) and an optional `python3` AST tier. CLI integration tests cover the full stack with `node:test` (zero dev dependencies) and exercise both AST extractors (`js-ast`, `py-ast`) plus their regex fallbacks. The Python AST tests skip themselves automatically on a machine that lacks `python3`.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Project Type** | CLI |
| **Test Framework** | `node:test` (built-in) |
| **Test Files** | `tests/` |

---

DocGuard's tests verify command behavior through subprocess execution. Each test runs the full CLI binary via execSync, capturing stdout and checking output patterns. This approach tests the complete stack in a single pass: argument parsing, config loading, validator execution, and output formatting.

Tests are designed to be config-aware. They verify that project-type settings like needsEnvExample and testFramework correctly influence scoring and validation behavior. Regression guards pin specific bug fixes with dedicated assertions, ensuring fixed issues cannot recur.

All tests use the built-in node:test framework with zero test dependencies. The test suite runs in under 10 seconds and is executed automatically by CI on every push.

Test names follow the pattern: "verb + expected behavior" (e.g., "runs and shows a score", "respects projectTypeConfig"). Each test is self-contained with no shared mutable state between tests.

## Test Categories

| Category | Framework | Location | Run Command |
|----------|-----------|----------|-------------|
| Unit | node:test | tests/ | `npm test` |
| CLI Integration | node:test | tests/ | `npm test` |

> **CLI integration tests cover the full stack** — this is a CLI tool with zero UI surface.
> Commands are validated end-to-end via Node.js subprocess execution, making separate E2E tests redundant.

All test files live in `tests/` and match the glob `tests/*.test.mjs` — individual files are not enumerated here (the suite grows every release); see the Source-to-Test Map below for the source→test traceability that matters.

## Coverage Rules

| Metric | Target | Current |
|--------|:------:|:-------:|
| Command Coverage | 100% | 100% (all commands) |
| Validator Coverage | 80% | 100% (all validators) |
| Flag Coverage | 80% | 100% |
| Test Count | — | 600+ tests (`npm test`) |

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
| `cli/validators/structure.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/validators/docs-diff.mjs` | `tests/commands.test.mjs` | ✅ |

> **Note**: `watch.mjs` is an interactive file-watcher (uses `fs.watch` + process signals). It is
> verified via manual execution rather than automated tests, which is appropriate for
> interactive/daemon-style commands per ISO/IEC/IEEE 29119-3 §7.2 (manual test procedures).

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
| `cli/scanners/schemas.mjs` | `tests/schemas.test.mjs` | ✅ |
