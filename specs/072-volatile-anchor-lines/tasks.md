# Tasks: Volatile Lines in Requirement Anchors

**Spec**: `specs/072-volatile-anchor-lines/spec.md`
**Plan**: `specs/072-volatile-anchor-lines/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/volatile-anchor-lines.test.mjs`: marker detection, including a marker inside a string (FR-001); value change on a marked line keeps exact and floor at the Babel, python-ast, pattern, tree-sitter and file tiers, a multi-line literal still changes, and adding or removing the marker changes the fingerprint (FR-002, FR-003); unmarked files fingerprint as before (FR-004); ANC011 listed by `docguard anchors`, absent from guard (FR-005); run it and see each fail
- [x] T002 [P] `tests/release-version-sync.test.mjs`: the version sync keeps a trailing `# docguard:volatile` on the lines it rewrites (FR-006)

## Phase 2: Implementation

- [x] T003 FR-001: `cli/scanners/fingerprint.mjs` `volatileLines` (with the fast path) and `cli/scanners/anchor-tags.mjs` `volatileLinesFor`, the one source every resolver and both out-of-process tiers use
- [x] T004 FR-002, FR-003: `cli/scanners/fingerprint.mjs` `jsFingerprintV1`; `cli/scanners/pattern-lexer.mjs` `floorTokens`, `floorFingerprint`, opaque streams
- [x] T005 FR-002: `cli/scanners/py-anchors.mjs` script and request; `cli/scanners/ts-decls.mjs`, `cli/scanners/ts-anchors-child.mjs`; `cli/scanners/anchors.mjs` batches
- [x] T006 FR-005: `volatileOnly` (`cli/scanners/pattern-lexer.mjs`) flagged by the resolvers; ANC011 in `cli/scanners/anchors.mjs`, `cli/commands/anchors.mjs`, `cli/findings.mjs`
- [x] T007 FR-006: mark the version lines in `action.yml` and `extensions/spec-kit-docguard/extension.yml`; re-accept, file by file with `docguard anchors accept --file … --bulk` and a reason saying what changed, the links of every file this spec touched (the four release-file links among them)

## Phase 3: Docs and verification

- [x] T008 FR-007: `docs/commands.md`, `docs-canonical/SECURITY.md`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md`; `npm run llms`
- [x] T009 [P] TestGuard claim `ANCHOR-VOLATILE-LINES` in `testguard.claims.json` with `req:docguard.volatile-anchor-lines#FR-00n` sources; probe it with `--confirm 3 --serial`
- [x] T010 SC-002, SC-003: dry-run the release cut on a scratch worktree and compare guard with main; `docguard anchors` before and after; `docguard specs --write`; `docguard guard`; `npm test`

## Verification

- **SC-001.** `tests/volatile-anchor-lines.test.mjs` (46) and `tests/release-version-sync.test.mjs` (5).
  - Before the change, every marker case failed and every control passed.
  - Each tier has a control: the same edit without the marker changes the fingerprint.
- **SC-002.** The 0.45.0 release cut, dry-run on 16f6aa3 in a scratch worktree (bump, CHANGELOG cut, version sync, release-candidate validation):
  - `docguard guard` PASS with no findings;
  - `docguard anchors` PASS, 127 reviewed and 568 baselined;
  - both markers still on their lines.
  - The same dry run on 711c2ac, before this spec, left four ANC001 warnings.
- **SC-003.** `docguard anchors` on this repository reports the same links as before.
  - The links of every file this spec touched were re-accepted file by file, with reasons in the lock.
  - Full suite 3,753/3,753 at 16f6aa3.
  - A/B against 0.44.3 on a `git archive` export:
    - this repository: identical apart from spec 070's FR-005 projection and validator count;
    - nine other repositories: identical guard output.
  - Benchmark core PASS.
- **T009.** TestGuard 0.15.0 `--confirm 3 --serial` on all 12 requirement-anchor claims at 85cfe48: 112 of 115 faults killed. The three unproven faults were fixed and probed again at 1e2f1a9, 26/26 killed:
  - ANCHOR-VOLATILE-LINES/F10: the python-ast case was always skipped, gated on `pythonRuns()`, a run counter, instead of `pythonVersion()`;
  - ANCHOR-VOLATILE-LINES/F3: the whole-word test never reached the check, because its input lacked the fast-path text;
  - ANCHOR-FINGERPRINT-GOLDEN/F5: its anchor moved.

