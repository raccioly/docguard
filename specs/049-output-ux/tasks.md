# Tasks: Truthful, Machine-Clean Command Output

**Status**: Draft
**Spec**: `specs/049-output-ux/spec.md`
**Plan**: `specs/049-output-ux/plan.md`

## Phase 1: Tests first (each reproduces a reported defect before the fix)

- [ ] T001 `tests/output-ux.test.mjs`: machine stdout. Every documented
  `--format json|sarif|junit` invocation, with and without `--changed-only`,
  parses; `memory --pack --stdout` and `llms --stdout` carry no banner;
  `fix --doc --format json` is JSON (FR-001, SC-001).
- [ ] T002 `tests/output-ux.test.mjs`: `colorEnabled` truth table; a piped
  run prints no escape, `FORCE_COLOR=1` does (FR-002).
- [ ] T003 `tests/output-ux.test.mjs`: the sync loop. GST002's command works
  on an unmarked doc; `sync --write` without `--force` names the skipped
  section; the `--force` preview's apply command has `--force`; a partial
  graph is reported skipped; `--since nosuchref` exits 1; prose review names
  only existing sections (FR-003–FR-005).
- [ ] T004 `tests/output-ux.test.mjs`: `upgrade --help`, `--schema-only`
  migrates offline, the guard footer suggests it; smart init writes
  `.docguard.json` and guard no longer exits 3; exit codes documented
  (FR-006, FR-007).
- [ ] T005 `tests/output-ux.test.mjs`: `docSections` key in full and compact
  output; `validators.structure: false`, `severity.structure` and the N/A
  marker still apply (FR-008, SC-003).
- [ ] T006 `tests/output-ux.test.mjs`: ownership loose files, `--suggest`
  roots and existing docs, tie in `trace --reverse` (FR-009).
- [ ] T007 `tests/output-ux.test.mjs`: `docs_for_path` nested instruction
  files with text; `rules --for` imports, PSR003 bytes, PSR002 for a missing
  import, depth and cycle (FR-010, FR-011).
- [ ] T008 `tests/output-ux.test.mjs`: review prune/suggest, tracked-only glob
  fingerprint, `doc_structure` bytes, init project type for Go/Java/Ruby,
  REF001 location, explain covers every code, `specs require` hint works
  (FR-012–FR-017).
- [ ] T009 `tests/output-ux.test.mjs`: the docs describe the behaviour
  (FR-018). `tests/sync-since.test.mjs`: the bad-ref test expects exit 1.

## Phase 2: Implementation

- [ ] T010 `cli/shared.mjs`, `cli/docguard.mjs`, `cli/commands/guard.mjs`,
  `cli/commands/fix.mjs`: colour and machine stdout (FR-001, FR-002).
- [ ] T011 `cli/commands/sync.mjs`, `cli/validators/generated-staleness.mjs` (FR-003–FR-005).
- [ ] T012 `cli/commands/upgrade.mjs`, `cli/commands/init.mjs`, `cli/config.mjs`, help text (FR-006, FR-007, FR-015).
- [ ] T013 `cli/commands/guard.mjs`, `cli/findings.mjs`, `cli/validators/structure.mjs`, `cli/config.mjs` (FR-008).
- [ ] T014 `cli/scanners/doc-ownership.mjs`, `cli/commands/trace.mjs` (FR-009).
- [ ] T015 `cli/scanners/instruction-scopes.mjs`, `cli/validators/path-scoped-rules.mjs`, `cli/scanners/doc-references.mjs` (FR-010, FR-011, FR-014).
- [ ] T016 `cli/commands/review.mjs`, `cli/scanners/doc-deps.mjs`, `cli/validators/reference-existence.mjs` (FR-012, FR-013, FR-016).

## Phase 3: Docs and verification

- [ ] T017 `docs/commands.md`, `docs/configuration.md`, `docs-canonical/DATA-MODEL.md`, `CHANGELOG.md` (FR-018).
- [ ] T018 Registry entry, `docguard specs --write`, `npm run llms`.
- [ ] T019 `testguard.claims.json`: claim OUTPUT-UX-TRUTHFUL, probed with
  `--confirm 3`; gate; `npm test`; `docguard guard`.
