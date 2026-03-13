# Test Specification

<!-- docguard:version 0.5.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-03-13 -->

> DocGuard is a zero-dependency CLI tool. No E2E tests needed.

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Project Type** | CLI |
| **Test Framework** | `node:test` (built-in) |
| **Test Files** | `tests/` |

---

## Test Categories

| Category | Framework | Location | Run Command |
|----------|-----------|----------|-------------|
| Unit | node:test | tests/ | `npm test` |
| CLI Integration | node:test | tests/ | `npm test` |

> **No E2E tests needed** — this is a CLI tool with no UI. CLI integration tests
> validate commands end-to-end via Node.js subprocess execution.

## Coverage Rules

| Metric | Target | Current |
|--------|:------:|:-------:|
| Command Coverage | 100% | 100% (13/13 commands) |
| Validator Coverage | 80% | 100% (10/10 validators) |
| Flag Coverage | 80% | 100% |
| Test Count | — | 30 tests, 17 suites |

## Source-to-Test Map

| Source File | Test File | Status |
|------------|-----------|:------:|
| `cli/docguard.mjs` | `tests/cli.test.mjs` | ✅ |
| `cli/commands/audit.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/init.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/guard.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/score.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/diff.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/generate.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/agents.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/hooks.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/diagnose.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/ci.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/fix.mjs` | `tests/commands.test.mjs` | ✅ |
| `cli/commands/watch.mjs` | — | ⚠️ Manual |
| `cli/validators/structure.mjs` | `tests/validators.test.mjs` | ✅ |

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
| 0.5.0 | 2026-03-13 | @raccioly | Added diagnose, guard JSON, profile, tax tests (24→30) |
| 0.3.0 | 2026-03-12 | @raccioly | Real tests, project-type-aware spec |
| 0.1.0 | 2026-03-12 | DocGuard Generate | Auto-generated (corrected) |
