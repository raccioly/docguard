# Tasks: Whole-Token Matching in the Nudge Hook, Docs-Sync and Diff-Suspicion

**Status**: Complete.

- **SC-001.** Before the change, 12 of the 13 fixture and documentation cases in `tests/whole-token-sibling-matchers.test.mjs` fail: each nudge, Docs-Sync and Diff-Suspicion case that expects no reference, and the three documentation checks. The neighbouring Docs-Sync case, where each whole-word form documents the file, passes. After the change, all 20 tests pass. That includes the 4 `namesModule` unit tests, which need the new export, the two repository oracles (SC-002) and the `init` case (FR-006).
- **SC-002, per matcher.** Old and new rules were compared on this repository and on 50 local projects. In every comparison the new matches are a subset of the old ones.
  - **Nudge.** Document pairs drop from 6,102 to 5,961, and 57 code files no longer nudge. Every removed pair is a basename inside a longer file name: `config.js` in `tsconfig.json`, `index.ts` in `rebuild-tag-index.ts`, `accounts.py` in `test_accounts.py`. On this repository, 515 pairs become 489 and 12 files go silent; `cli/commands/sync.mjs`, for example, was "referenced" only by `schema-sync.mjs`.
  - **Diff-Suspicion `path` kind.** 3,376 document-path pairs before, 3,376 after. A tracked path inside a longer path does not occur in these projects, so the change is visible only in the User Story 3 fixture.
  - **Docs-Sync.** 12 projects have route or service files (773 in all). Their DSY001/DSY002 warnings go from 47 to 61, with 14 added and none removed.
    - A strict whole-file-name rule on the module name was measured too. It added 24 warnings, 10 of them real references written as `module.member` (`jobLease.beginShutdown`). That measurement is why a period is an edge for a module name.
- **SC-002, `guard --format json`.** The old CLI (3666af4) and the new one were run on this repository and on 41 other local projects. Findings go from 2,500 to 2,514. Three projects change, no status changes, and no finding disappears. Each of the 14 added findings was reviewed: no canonical document names the file.
  - **Project A** (Next.js, 5 × DSY001): `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/content/route.ts`, `src/app/api/feedback/route.ts` and `src/app/api/progress/route.ts`. The documents say only "API routes".
  - **Project B** (Next.js, 6 × DSY001): `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/auth/refresh/route.ts`, `src/app/api/auth/register/route.ts` and `src/app/api/health/route.ts`. The documents say only "API routes".
  - **Project C** (TypeScript backend, 3 × DSY002): three services under `backend/src/services/`. Each is named only inside a longer identifier: a field (`exportRetention` in `exportRetentionDays`), a timestamp field (the stem plus `edAt`), and another file (the stem plus `Controller` and `Routes.ts`).
  - **This repository.** Guard findings are unchanged; it has no route or service directory. Running each CLI on the other's checkout adds `TDO002` on `cli/validators/todo-tracking.mjs:51,58` in both directions. That validator skips its own source by absolute path (`SELF_PATH`), so the difference comes from where the CLI runs, not from this change.
- **DocGuard's own `init` (FR-006).** The full suite caught it: in spec 044's end-to-end test, `init --skip-prompts` on the Next.js fixture now gets DSY001 for its three `route.ts` handlers, which its blank templates never name. DSY001 and DSY002 join that test's requests to fill the templates. `init` then `generate --plan --write` reports neither, on all five fixture stacks.
- **`trace --reverse`, `impact` and `docguard_docs_for_path`.** These are unchanged, because `namesModule` is used only by Docs-Sync.
  - `docsForPath` output is identical for all 902 tracked code files of this repository and one other project.
  - `diff --since` JSON is identical for `HEAD~1`, `HEAD~15` and `HEAD~40`, ignoring `timestamp`.
  - `trace --reverse` JSON is identical for 32 sampled `cli/` files.

**Spec**: `specs/077-whole-token-sibling-matchers/spec.md`
**Plan**: `specs/077-whole-token-sibling-matchers/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/whole-token-sibling-matchers.test.mjs`: `namesModule` rejects a name inside a longer name and accepts every User Story 2 form. Fixtures cover the nudge, Docs-Sync and Diff-Suspicion for User Stories 1–3, each with its neighbouring valid case. Confirm the no-reference cases fail before the change (FR-001–FR-004, SC-001).

## Phase 2: Implementation

- [x] T002 FR-002: `namesModule` in `cli/scanners/doc-references.mjs`
- [x] T003 FR-001: `docsReferencingFile` in `cli/commands/hooks.mjs`
- [x] T004 FR-003: `isDocumented` in `cli/validators/docs-sync.mjs`
- [x] T005 FR-004: `referenceKind` in `cli/validators/diff-suspicion.mjs`

## Phase 3: Proof, docs and verification

- [x] T006 SC-002: compare old and new rules per matcher on this repository and other local projects. Run `guard --format json` before and after on this repository and at least two other projects, and record every changed finding. Confirm `trace --reverse`, `impact` and `docguard_docs_for_path` are unchanged.
- [x] T007 FR-005: DSY001 / DSY002 help and `npm run docs:reference`; `explain docsSync`; `docs/reference/agents.md`; `CHANGELOG.md`; `npm run llms`.
- [x] T008 TestGuard: claim `WHOLE-TOKEN-SIBLING-MATCHERS` (`req:docguard.whole-token-sibling-matchers#FR-001`), with a fault for each matcher and each `namesModule` edge. Probe with `--confirm 3 --serial`. No existing fault's `find` string pins a changed line, and every one still matches exactly once.
- [x] T010 FR-006: DSY001 and DSY002 in the `init` flows' allow-list of `tests/generated-docs-e2e.test.mjs`; an `init` test in `tests/whole-token-sibling-matchers.test.mjs`.
- [x] T009 `npm test`; `docguard specs --write`; requirement anchors reviewed and accepted (21 changed file-scope links and the 4 new spec 077 links, selected per link or per spec and file so unchanged symbol links keep their review); `docguard guard`.
