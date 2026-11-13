# Tasks: File Kinds

**Spec**: `specs/100-file-kinds/spec.md`
**Plan**: `specs/100-file-kinds/plan.md`

## Stage 1 (this change)

### Phase 1: Spec

- [x] T001 Spec, plan and tasks; amend spec 099 with a dated note (its classifier and override come from spec 100).

### Phase 2: Tests first

- [ ] T002 [US1] `tests/file-kinds.test.mjs`: the closed kind list; every vocabulary word in lower, upper and mixed case; `describesFolder` on and off; the dot-segment cutoff and `harnessFolders: 'all'`; package segments in any case; `kinds` restriction and precedence; backup names for documents and not for code; backup directories only inside documentation directories; nested checkout with `opts.root` and without; `fileKinds.own`; unknown paths are `own` (FR-001 to FR-005).
- [ ] T003 [US2] `tests/instruction-copies.test.mjs`: D1 (STR004 skips a template and a fixture copy, counts a governing nested file and `templates/AGENTS.md`); D5 (`Examples/` and `Fixtures/` leave the role as lowercase does); `fileKinds.own` replaces `agentInstructions.governing`; `tests/AGENTS.md` keeps spec 094's behavior (FR-007 to FR-009).
- [ ] T004 [US4] Same file: `files.kinds` in guard JSON (counts, excluded, capped at 20) and the text line; absent on the lite path (FR-010).
- [ ] T005 [US6] `tests/file-kinds-registry.test.mjs`: the heuristic, the allowlist with a reason per entry, exact in both directions (FR-011).

### Phase 3: Implementation

- [ ] T006 `cli/shared-file-kind.mjs` (FR-001 to FR-005).
- [ ] T007 `cli/shared-ignore.mjs` callers; delete `instructionCopyOf`, `TEMPLATE_DIRS`, `isDeclaredGoverning` (FR-006).
- [ ] T008 Role, Path-Scoped-Rules, PSR006 on `fileKind` (FR-007, FR-008).
- [ ] T009 `measureInstructionChains(projectDir, config)` and `structure.mjs` (FR-009).
- [ ] T010 `files.kinds` in `cli/commands/guard.mjs` (FR-010).

### Phase 4: Docs, evidence, verification

- [ ] T011 `docs/configuration.md`, schema, DATA-MODEL, ARCHITECTURE, TEST-SPEC, findings reference, CHANGELOG, `docguard explain PSR006`, strict additions, precision evidence.
- [ ] T012 Benchmarks (a D1 pair if the corpus supports STR004); A/B on DocGuard and eight other repositories, every difference labelled.
- [ ] T013 `npm test`; `node cli/docguard.mjs guard`; CI lint.

## Stage 2 (later)

- [ ] T020 Migrate every allowlisted file to `fileKind`; the allowlist ends empty (FR-012).
- [ ] T021 Fix D2 (REF001 symbol set), D3 (`uniqueSameNamedCanonical`), D4 (`detectCanonicalLayout`, role hint), D6 (backup-named documents, TODO tracking, nested checkouts), D8 (TODO tracking private set), D9 (`docguard llms`), each with a failing test first.
- [ ] T022 Walkers skip a nested checkout (FR-012).
- [ ] T023 The backup-document warning, with catalog row, strict addition, precision evidence, benchmark pair and `explain` text (FR-013).

## Stage 3 (later)

- [ ] T030 Mirror grouping by content hash across instruction files and skill copies; one finding naming every path (FR-014).
- [ ] T031 Drift warnings for same-skill copies and near-identical root instruction files; `GEMINI.md` like the others (FR-015).
