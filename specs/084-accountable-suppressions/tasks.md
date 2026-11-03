# Tasks: Every Suppression Has an Owner and an End Date the Project Can Enforce

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. The US1 and US2 cases must fail before the change, and the golden pins must pass before and after.

## Phase 1 — Failing tests first

- [ ] T001 [US1] `tests/accountable-suppressions.test.mjs`: model entries for a pragma, a validator marker, a section marker, a `.docguardignore` line and a `.docguard.json` object, each with `owner:` and `expires:` (FR-001 to FR-003, FR-007).
- [ ] T002 [US2] Same file: each kind expired yesterday no longer suppresses, and IGN001 names it with its owner; an entry expiring today still applies (FR-004).
- [ ] T003 [US3] Same file: `requireOwner` gives IGN004; `maxDays: 30` gives IGN005 for 90 days out and for no expiry; baseline fingerprints are exempt (FR-005, FR-006).
- [ ] T004 Same file: unreadable metadata (duplicate token, bad date, bad owner) gives IGN003 and the suppression applies nothing; an owner word inside the reason stays reason text (Edge Cases).
- [ ] T005 Same file: golden pins, where every 0.45.2 form parses to the same reason, codes, pattern and expiry as before (FR-008).
- [ ] T006 Same file: `ignore --owner @ana --format json` lists only her entries (FR-007).

## Phase 2 — Implementation

- [ ] T007 `cli/waiver-metadata.mjs`.
- [ ] T008 `parseInlinePragma` and `suppressesCode` in `cli/findings.mjs`.
- [ ] T009 `cli/validator-markers.mjs` and the section-marker pass in `cli/validators/structure.mjs`.
- [ ] T010 `parseDocguardIgnore` owner token and `normalizeIgnoreConfig` in `cli/shared-ignore.mjs`, called from `loadConfig` and `runGuardInternal`.
- [ ] T011 `cli/scanners/suppressions.mjs` (owner and expires on every kind), and `cli/validators/suppressions.mjs` (IGN001 for all kinds, IGN004, IGN005).
- [ ] T012 `cli/commands/ignore.mjs` `--owner` filter and help.

## Phase 3 — Docs and generated files

- [ ] T013 Config schema; `cli/findings.mjs` codes; `npm run docs:reference`; `docs/configuration.md`; `docs-canonical/DATA-MODEL.md` (suppression model fields), `TEST-SPEC.md` row; `CHANGELOG.md`; `npm run llms`; `specs --write`; `anchors accept`.

## Phase 4 — Proof

- [ ] T014 `npm test`, `guard`, `npm run budget`.
- [ ] T015 Hermetic A/B on every local project, plus a grep for existing reasons ending in `owner:` or `expires:` (Risks).
