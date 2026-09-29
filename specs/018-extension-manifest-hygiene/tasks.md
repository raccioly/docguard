# Tasks: Extension Manifest Hygiene

**Status**: Complete — SC-003: `specify extension info docguard` on 1.0.13 reports Category docs, Effect read-write, 5 hooks
**Spec**: `specs/018-extension-manifest-hygiene/spec.md`
**Plan**: `specs/018-extension-manifest-hygiene/plan.md`

## Phase 1: Manifest and template

- [x] T001 `extensions/spec-kit-docguard/extension.yml`: floor `>=0.11.2`, `category: "docs"`, `effect: "read-write"`, explicit hook priorities (brief 5), drop `requires.framework`, move `provides.workflows` to `x-docguard.github_workflows` (FR-001–FR-003).
- [x] T002 `extensions/spec-kit-docguard/templates/extensions.yml`: Spec Kit 1.0.13 registry shape (FR-004).
- [x] T003 `extensions/spec-kit-docguard/commands/guard.md`: drop the "160+ automated checks" count (FR-006).

## Phase 2: Catalog submission

- [x] T004 `.github/scripts/speckit-submission.py`: read floor, description, category, effect, tags from the manifest (FR-005).

## Phase 3: Contract tests and verification

- [x] T005 `tests/hooks-contract.test.mjs`: floor ≥ newest event/field used; every hook has a priority; template hooks equal manifest hooks (SC-001).
- [x] T006 `tests/catalog-submission.test.mjs`: submission fields equal manifest fields (SC-002).
- [x] T007 SC-003: `npm run speckit:dev` with `specify` 1.0.13; `specify extension info docguard` shows category and effect.
- [x] T008 `CHANGELOG.md`; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`.
