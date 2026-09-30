# Tasks: As-Built Specifications

**Status**: Complete. Deviation: the draft preflight (`specs preflight --path`) ran after the registry already held this spec, so it reported SPR004 and SPR001 as an ordering artifact. The briefing (`specs preflight`) passed with no overlaps.
**Spec**: `specs/024-as-built-specs/spec.md`
**Plan**: `specs/024-as-built-specs/plan.md`

## Phase 1: Facts and skeleton (US1)

- [x] T001 `cli/scanners/as-built.mjs`: `resolveArea`, `collectAreaFacts`, `areaTests`, `nextFeatureDir`, `renderAsBuiltSpec` (FR-001, FR-002); `cli/shared-source.mjs`: `grepEnvUsage(…, { within })`.
- [x] T002 `cli/commands/generate-as-built.mjs`, `cli/commands/generate.mjs`, `cli/docguard.mjs`: `generate --spec`, `--id`, `--write`, `--format json` (FR-001, FR-003).

## Phase 2: Registry and sync (US2, US3)

- [x] T003 `cli/scanners/spec-registry.mjs` + `schemas/docguard-specs.schema.json`: optional `origin`, `sourcePaths` (FR-004).
- [x] T004 `cli/validators/spec-registry.mjs` + `cli/findings.mjs`: SPR007 (FR-005).
- [x] T005 `tests/as-built-specs.test.mjs`: every scenario, SC-001 to SC-004, FR-006.

## Phase 3: Documentation and verification

- [x] T006 `README.md` generate row; `extensions/spec-kit-docguard/commands/generate.md`; `docs-canonical/ARCHITECTURE.md` row; `docs-canonical/DATA-MODEL.md` registry fields (FR-007).
- [x] T007 TestGuard claim for SPR007 and the write path; `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
