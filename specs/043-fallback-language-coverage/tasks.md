# Tasks: Honest Coverage for Fallback Languages

**Status**: Draft.
**Spec**: `specs/043-fallback-language-coverage/spec.md`
**Plan**: `specs/043-fallback-language-coverage/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/fallback-language-coverage.test.mjs`, temporary Go (Gin),
  Spring (Maven layout, `com.example`, depth 7) and Rails projects:
  - `apiSurface` is `partial`, naming the language; API findings carry
    `fallback-language` (FR-001, FR-002, SC-001);
  - `tierApplicability` wording for `fallback-language`, `regex-fallback` and
    `mixed` (FR-001);
  - env patterns per language, including strings and comments that must not
    count, and Spring placeholders (FR-003);
  - a Swift file makes Environment `partial`, and `diff` prints the
    limitation (FR-004);
  - a Go module's files outside the conventional roots and Rails
    `config/*.rb` are read by the env scan (FR-005);
  - `isNonProductPath` package segments; `examples/` and `src/test/java`
    stay non-product (FR-006);
  - routes only under fixtures give an excluded-count reason (FR-007);
  - a depth-9 controller is found; the cap is disclosed (FR-008);
  - a detected pattern-only framework with no route is `partial`; with no
    API doc it stays `missing-prerequisite` (FR-009);
  - symbol map and module graph name Go and Java (FR-010);
  - a Go env rename produces ENV003 (SC-001);
  - Express and Flask controls are unchanged (SC-002).
- [ ] T002 `tests/fallback-language-coverage.test.mjs`: docs name the
  behaviour (FR-011); a temporary project shaped like this repository keeps
  its Environment coverage and module-graph bytes (SC-003).
- [ ] T003 `tests/parser-tier.test.mjs`: `fallback-language` is a coverage
  gap with its own reason (FR-001).

## Phase 2: Implementation

- [ ] T004 `cli/shared-source.mjs`: tier summary and applicability (FR-001).
- [ ] T005 `cli/shared-source.mjs`: env patterns, Spring config, unscanned
  languages, Go and Rails layouts (FR-003, FR-004, FR-005).
- [ ] T006 `cli/shared-ignore.mjs`, `cli/scanners/project-type.mjs`,
  `cli/scanners/inventory.mjs`: package segments (FR-006, FR-007).
- [ ] T007 `cli/scanners/routes.mjs`: route tiers, scan record, depth and cap
  (FR-002, FR-007, FR-008).
- [ ] T008 `cli/validators/api-surface.mjs`: coverage from the scan record
  (FR-001, FR-007, FR-008, FR-009).
- [ ] T009 `cli/validators/environment.mjs`, `cli/commands/diff.mjs`: env
  coverage, ENV003 tier, diff limitation (FR-002, FR-004).
- [ ] T010 `cli/scanners/import-graph.mjs`, `cli/scanners/symbol-map.mjs`,
  `cli/scanners/module-diagram.mjs`: unanalysed languages (FR-010).

## Phase 3: Docs and verification

- [ ] T011 README, `docs-canonical/ARCHITECTURE.md`,
  `docs-canonical/DATA-MODEL.md`, `schemas/docguard-config.schema.json`,
  `cli/commands/explain.mjs`, `cli/findings.mjs`, CHANGELOG (FR-011).
- [ ] T012 `testguard.claims.json`: claim
  FALLBACK-LANGUAGE-COVERAGE-IS-PARTIAL, probed `--confirm 3`. Then gate,
  `npm test`, `npm run llms`, `docguard specs --write`, `docguard guard`.
