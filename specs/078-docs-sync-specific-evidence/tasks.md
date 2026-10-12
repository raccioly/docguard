# Tasks: Docs-Sync Counts Only Visible, Specific Names

**Spec**: `specs/078-docs-sync-specific-evidence/spec.md`
**Plan**: `specs/078-docs-sync-specific-evidence/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/docs-sync-specific-evidence.test.mjs`: unit tests for `visibleMarkdown`, `createUrlPathMatcher`, `namesDirectory` and `appRouterPath`. Fixtures for User Stories 1–3, each with its neighbouring valid case, and the `init` cases. Confirm the cases that expect a warning fail before the change (FR-001–FR-007, SC-001).

## Phase 2: Implementation

- [ ] T002 FR-001: `visibleMarkdown` in `cli/shared-html-comments.mjs`
- [ ] T003 FR-003: `appRouterPath` in `cli/scanners/routes.mjs`; `createUrlPathMatcher` in `cli/scanners/doc-references.mjs`
- [ ] T004 FR-005: `namesDirectory` in `cli/scanners/doc-references.mjs`
- [ ] T005 FR-001–FR-006: `cli/validators/docs-sync.mjs` reads visible text and `covers`, selects every file before scoping, and names each file by its identity

## Phase 3: Proof, docs and verification

- [ ] T006 SC-002: `guard --format json` with the base CLI and the new CLI on `git archive` copies of this repository and every local project with canonical documents, one copy per CLI, run one at a time. Record every changed finding, review a sample of at least 20 across every changed project, and record any false positive and how it was excluded. Guard on this repository and the budget job.
- [ ] T007 FR-007: DSY001 / DSY002 help and `npm run docs:reference`; `explain docsSync`; e2e allow-list comment; `CHANGELOG.md`; `npm run llms`.
- [ ] T008 TestGuard: claim `DOCS-SYNC-SPECIFIC-EVIDENCE` (`req:docguard.docs-sync-specific-evidence#FR-001`), one fault per rule; re-point `WHOLE-TOKEN-SIBLING-MATCHERS` F2 at the new module-name line. Probe with `--confirm 3 --serial`.
- [ ] T009 `npm test`; `docguard specs --write`; requirement anchors reviewed and accepted with `docguard anchors accept`; `docguard guard`.
