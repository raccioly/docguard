# Tasks: Volatile Lines in Requirement Anchors

**Spec**: `specs/072-volatile-anchor-lines/spec.md`
**Plan**: `specs/072-volatile-anchor-lines/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/volatile-anchor-lines.test.mjs`: marker detection, including a marker inside a string (FR-001); value change on a marked line keeps exact and floor at the Babel, python-ast, pattern, tree-sitter and file tiers, a multi-line literal still changes, and adding or removing the marker changes the fingerprint (FR-002, FR-003); unmarked files fingerprint as before (FR-004); ANC011 listed by `docguard anchors`, absent from guard (FR-005); run it and see each fail
- [ ] T002 [P] `tests/release-version-sync.test.mjs`: the version sync keeps a trailing `# docguard:volatile` on the lines it rewrites (FR-006)

## Phase 2: Implementation

- [ ] T003 FR-001: `cli/scanners/anchor-tags.mjs` `volatileLines`, with the fast path
- [ ] T004 FR-002, FR-003: `cli/scanners/fingerprint.mjs` `jsFingerprintV1`; `cli/scanners/pattern-lexer.mjs` `floorTokens`, `floorFingerprint`, opaque streams
- [ ] T005 FR-002: `cli/scanners/py-anchors.mjs` script and request; `cli/scanners/ts-decls.mjs`, `cli/scanners/ts-anchors-child.mjs`; `cli/scanners/anchors.mjs` batches
- [ ] T006 FR-005: `allVolatile` in the resolvers, ANC011 in `cli/scanners/anchors.mjs`, `cli/commands/anchors.mjs`, `cli/findings.mjs`
- [ ] T007 FR-006: mark the version lines in `action.yml` and `extensions/spec-kit-docguard/extension.yml`; re-accept the four links with `docguard anchors accept` and a reason naming this spec

## Phase 3: Docs and verification

- [ ] T008 FR-007: `docs/commands.md`, `docs-canonical/SECURITY.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`
- [ ] T009 [P] TestGuard claim `ANCHOR-VOLATILE-LINES` in `testguard.claims.json` with `req:docguard.volatile-anchor-lines#FR-00n` sources; probe it with `--confirm 3 --serial`
- [ ] T010 SC-002, SC-003: dry-run the release cut on a scratch worktree and compare guard with main; `docguard anchors` before and after; `docguard specs --write`; `docguard guard`; `npm test`
