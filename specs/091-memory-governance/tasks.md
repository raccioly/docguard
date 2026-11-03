# Tasks: Agent Memory Stays True to the Code, Is Fed Verified Facts, and Is Consolidated Without Guessing

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/memory-governance.test.mjs`: rules naming deleted paths and unused env vars; CodeKB naming a deleted path; fences and URLs ignored; advisory absence claims (FR-001 to FR-003).
- [x] T002 [US2] Same file: dry run writes nothing; `--write` writes only the digest, with matched facts only; memory layers untouched; unknown space exits 1 (FR-004, SC-002).
- [x] T003 [US3] Same file: normalized duplicates grouped with every source; stale reference flagged; nothing written (FR-005, SC-002).

## Phase 2 — Implementation

- [x] T004 Scanner, validator, `memory-aidlc.mjs`, flags, codes.

## Phase 3 — Docs and proof

- [ ] T005 Docs, CHANGELOG; full suite; hermetic A/B (SC-003).
