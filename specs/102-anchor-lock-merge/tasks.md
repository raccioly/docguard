# Tasks: Anchor Lock Merges Cleanly

**Spec**: `specs/102-anchor-lock-merge/spec.md`
**Plan**: `specs/102-anchor-lock-merge/plan.md`

## Phase 1: Reproduce and test first

- [ ] T001 Reproduce on `main`: two branches accept one link after different edits, union merge, ANC009 only; record the output (spec Problem).
- [ ] T002 `tests/anchor-lock-merge.test.mjs`: real-git merge and rebase; each FR-002 case on the pure resolver; FR-003 (an accept keeps every other duplicated key; a second accept is byte-identical); FR-004, FR-005; FR-006; FR-008 against `git archive v0.48.0`; a property test over line order. Run it on `main`'s code and record which tests fail.

## Phase 2: Implementation

- [ ] T003 FR-001, FR-005: `parseAnchorLock`, `readAnchorLock`.
- [ ] T004 FR-002, FR-007: `resolveEntry`, `resolveLockLinks`, `computeAnchorStatus`.
- [ ] T005 FR-003: `readResolvedLock`; `accept`, `accept --remove`, `disposition` write from it.
- [ ] T006 FR-004, FR-005, FR-010: `anchors merge`; help; `docs/commands.md`.
- [ ] T007 FR-006: ANC009 leaves the validator; the registry entry says it is no longer reported; the ANC005 suggestion names the command.
- [ ] T008 FR-009: `AGENTS.md`, `CONTRIBUTING.md`, spec 070 amendment notes, the anchor-lock header comment.
- [ ] T009 The one existing test that asserted a refusal (`requirement-anchors-lock.test.mjs`, "two different lines for one key") changes its expectation.

## Phase 3: Verification

- [ ] T010 `npm test`, the CI lint, `node cli/docguard.mjs guard`, `node benchmarks/run.mjs --baseline benchmarks/baseline.json`.
- [ ] T011 SC-004: in a scratch clone, merge two branches that both ran `anchors accept` on one file; guard is clean with no manual step. Then resolve this branch's own merge with `origin/main` using the new reader and `anchors merge --write`.
- [ ] T012 CHANGELOG, `specs --write`, `npm run llms`, `npm run docs:reference`; scrub check; PR.
