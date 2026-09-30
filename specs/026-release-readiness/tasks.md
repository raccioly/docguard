# Tasks: Release Readiness

**Status**: Complete. SC-001 and SC-002 hold, and the audit's blockers are closed.
**Spec**: `specs/026-release-readiness/spec.md`
**Plan**: `specs/026-release-readiness/plan.md`

## Phase 1: Release automation

- [x] T001 `.github/scripts/release-changelog.mjs` and `.github/workflows/scheduled-release.yml`: auto bump and the changelog cut (FR-001, FR-002).
- [x] T002 `action.yml`, `.github/scripts/sync-release-version.mjs`, `cli/release-pr-policy.mjs`: the CLI pin and synced Action examples (FR-003).
- [x] T003 `packaging/homebrew/docguard.rb`, `.github/scripts/homebrew-formula.mjs`, `.github/scripts/publish-homebrew-tap.sh`, `.github/workflows/release.yml`: the Homebrew tap (FR-004).

## Phase 2: Shipped surfaces

- [x] T004 `cli/docguard.mjs`: top-level help summaries (FR-005).
- [x] T005 `schemas/docguard-config.schema.json`: `specKit.untouchedClaimCheck` (FR-006).
- [x] T006 `docs/commands.md`, `docs/configuration.md`, `README.md`, `docs/ai-integration.md`, `docs-canonical/CI-RECIPES.md`: document `generate --spec`, `specs complete|require`, `specFirst`, `agentInstructions`, `specKit`, the Action pin and the release flow.
- [x] T007 `CHANGELOG.md`: move the three #448 entries out of `[0.42.1]`, add upgrade notes, reference SPK012's PR, add #449.

## Phase 3: Verification

- [x] T008 `tests/release-readiness.test.mjs`, `tests/release-version-sync.test.mjs`: every FR, SC-001 and SC-002, with the FR-005 test shown to fail on `main`.
- [x] T009 Lifecycle: record approval and delivery for specs 014–027; review the docs FRS002 names; `npm run llms`; stage, then `docguard specs --write`; `docguard guard`; `npm test`. The `specs complete` runs move to the follow-up that anchors their revisions to `main`, because a completion recorded on this branch would not survive the squash merge.
