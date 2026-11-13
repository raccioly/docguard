# Implementation Plan: File Kinds

**Spec**: [spec.md](spec.md) (`docguard.file-kinds`)

## Summary

| FR | Stage | Change |
|---|---|---|
| FR-001 to FR-005 | 1 | New `cli/shared-file-kind.mjs`: `fileKind(path, config, opts)`, the closed kind list, the vocabulary sets, the backup rules, the cached nested-checkout check, the `fileKinds.own` globs compiled once per config. No dependency beyond `shared-ignore.mjs` helpers used at call time. |
| FR-006 | 1 | `cli/shared-ignore.mjs`: `isNonProductPath` and `isNonProductDir` call `fileKind` (`kinds: ['fixture']`, `harnessFolders: 'all'`), `isPackageSegment` lower-cases its inputs, `DEFAULT_DETECTION_IGNORE_DIRS` is the fixture vocabulary. `cli/shared-agent-instructions.mjs`: `instructionCopyOf`, `TEMPLATE_DIRS`, `isDeclaredGoverning` are deleted. |
| FR-007, FR-008 | 1 | `computeDocs` and Path-Scoped-Rules drop a template copy (`describesFolder`) and a fixture ancestor anywhere (spec 094), unless `fileKinds.own` names the file. PSR006 reads `fileKind` with `describesFolder` and `kinds: ['template', 'fixture']`. |
| FR-009 | 1 | `measureInstructionChains(projectDir, config)` skips a copy; `structure.mjs` passes the config. |
| FR-010 | 1 | `agentInstructionDocs` records `excluded`; `computeFileKinds` in `cli/commands/guard.mjs` builds `files.kinds`; one text line. |
| FR-011 | 1 | `tests/file-kinds-registry.test.mjs`: scans `cli/` for private directory-name sets and unclassified walks; allowlist with a reason per entry, exact in both directions. |
| FR-012, FR-013 | 2 | Migrate each allowlisted file; fix D2, D3, D4, D6, D8, D9; walkers skip a nested checkout; the backup-document warning. |
| FR-014, FR-015 | 3 | Mirror grouping by content hash and drift warnings in Path-Scoped-Rules and the instruction validators. |

## Research decisions

- **Unknown is `own`.** Classifying a file as a copy removes it from checks, and strict mode fails on what it examines. A missed copy costs a finding; a wrongly dropped governing file costs a hidden defect.
- **The vocabulary is directory names only.** The survey shows placeholders in ordinary specs and identical files in legitimate places, so content decides nothing in Stages 1 and 2.
- **`describesFolder` is a caller's statement, not a path property.** `templates/AGENTS.md` governs `templates/`; `templates/new.js` is a template. Only the caller knows which it is looking at.
- **The role keeps spec 094's any-ancestor fixture rule.** `tests/AGENTS.md` stays out of the role (spec 099 Out of Scope), so the role asks `isNonProductPath` for fixtures and `fileKind` with `describesFolder` for templates. PSR006 and the budget use `describesFolder` for both.
- **`isNonProductPath` keeps its full-path behavior.** It passes `harnessFolders: 'all'` so `.agent/skills/x/tests/y.js` stays non-product; the dot-segment cutoff is for instruction and document questions.
- **`opts.root` for nested checkouts.** The vocabulary and backup rules stay pure functions of the path; only `nested-checkout` touches the disk, one `existsSync` per directory, cached.
- **`fileKinds.own` replaces `agentInstructions.governing`.** One override for every question, not one per feature. It never shipped, so there is no migration.
- **`files.kinds` counts tracked files and lists role exclusions.** Computed on the non-lite path beside `computeDocCoverage`, capped at 20 paths per kind to keep guard's JSON small.
- **Rejected: a per-validator opt-out list.** It is how the thirteen private sets happened.
- **Rejected: a new `isTemplatePath` beside `isNonProductPath`.** A second predicate is the same defect one level up.

## Verification

Each defect test fails before the change. A/B proof: guard JSON with the CLI at `origin/main` and at the branch on fresh `git archive` copies, one run at a time, on DocGuard and at least eight other real repositories; every new or removed finding is opened and labelled. Benchmarks: `node benchmarks/run.mjs --baseline benchmarks/baseline.json`.
