# Tasks: One Agent-Instruction Document Role

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Tests come first. Every acceptance scenario must fail on the base before its implementation lands (SC-001).

## Phase 1 — Failing tests first (SC-001)

- [x] T001 [US1] `tests/agent-instruction-role.test.mjs`: role membership and kinds for the US1 fixture; fixture copies excluded; `requiredFiles.agentFile` included (FR-001).
- [x] T002 [US1] Same file: every root-level reader reads AGENTS, CLAUDE, GEMINI and copilot-instructions (FR-002).
- [x] T003 [US1] Same file: FRS002 for an old `GEMINI.md` (FR-003).
- [x] T004 [US2] Same file: pointer detection (TestGuard's text, `@AGENTS.md`, an import to an untracked file, a cycle), no FRS for pointers, a skip naming the target, and the substantive `CLAUDE.md` control (FR-004, FR-005).
- [x] T005 [US3] Same file: manifest and DocGuard vendoring, Freshness excludes vendored files, PSR005 on an edited copy and not on an intact one, a malformed manifest gives partial coverage (FR-006, FR-007).
- [x] T006 Run the file on the base code and record which cases fail.

## Phase 2 — Implementation

- [x] T007 `cli/shared-agent-instructions.mjs` (FR-001, FR-002, FR-004, FR-006).
- [x] T008 Readers switched to `rootAgentDocs` (FR-002).
- [x] T009 Freshness: role documents and pointer skips (FR-003, FR-005).
- [x] T010 Path-Scoped-Rules: PSR005 (FR-007).

## Phase 3 — Docs, benchmark and generated files (FR-009, FR-010)

- [x] T011 `cli/findings.mjs` (PSR005, FRS help); `npm run docs:reference`.
- [x] T012 ARCHITECTURE exit-code lists and role description; DATA-MODEL; `CHANGELOG.md` `[Unreleased]`.
- [x] T013 Benchmark fixture and cases; re-record the baseline; `npm run generate:precision-evidence`.
- [x] T014 `npm run llms`; `docguard anchors accept --file … --bulk` for touched anchored files; `docguard specs --write`.

## Phase 4 — Proof (SC-002, SC-003)

- [x] T015 `npm test`, `guard`, `npm run budget`.
- [x] T016 A/B on the local projects; every changed finding reviewed by hand and recorded under Verification Notes.
