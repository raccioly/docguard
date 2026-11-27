# Feature Specification: Quantities in Instruction Documents

**Feature Branch**: `feat/109-documented-quantities`

**Created**: 2026-11-27

**Status**: Active

**Spec ID**: `docguard.documented-quantities`

**Lineage**: Closes issue 629, the last open part of issue 628. Parts b and c of 628 were delivered by specs 095 and 097 (issues 631 and 632, closed with evidence). Recommendation H of the 628 investigation is this spec.

**Input**: "TestGuard's AGENTS.md said `npm test` takes about 15 seconds. The suite takes about 200 s, and CI enforces a 300 s budget. The claim extractor skipped the number twice: it was in a shell fence, and a bare `s` was not a unit. Compare the checkable subset where the source of truth is unambiguous."

## Problem

1. `semantic-claims.mjs` skips fenced code, but in an instruction file the trailing `#` comment of a shell command is prose about the command (`npm test # unit + fixture acceptance (~15s)`).
2. A bare `s` (`~15s`, `(20s)`) is not a duration unit, so `(~15s)` is no claim even outside a fence.
3. Two quantities have an unambiguous source of truth and are not compared: a documented minimum Node.js version (`engines.node`), and a documented command duration against the CI budget of the same command. A CI budget is a ceiling, not a duration, so "~15 s against 300 s" is evidence of drift, not a contradiction. A documented time above the budget is a contradiction.

## User Scenarios & Testing

### User Story 1 - The TestGuard case is seen (Priority: P1)

**Independent Test**: AGENTS.md with `npm test # ... (~15s)` in a bash fence, and a workflow step `run: npm test` with `TEST_BUDGET_MS: 300000`: MET007 (informational) says CI budgets 20x the documented time.

### User Story 2 - A wrong Node.js minimum is reported (Priority: P2)

**Independent Test**: `engines.node: ">=18"` and a README "Requires Node.js 20+": MET005 at the README line.

## Requirements

### Functional Requirements

- **FR-001**: The claim extractor reads the trailing `#` comment of a line in a shell fence (`bash`, `sh`, `shell`, `zsh`, `console`, `terminal`), and treats a bare `s` attached to a number of up to three digits as seconds, except before ` of` (`10s of`); a decade (`1990s`) is not a duration.
- **FR-002**: MET005 (warn): a document line states a minimum Node.js version (`Node.js 20+`, `Node ≥ 20`, `Node 20 or later`) whose major differs from the first number of `engines.node`. CHANGELOG and `specs/` are not read.
- **FR-003**: MET006 (warn): a document line (in prose, only when the duration is phrased as how long the command takes, never after `every`, `per`, `after` or `within`) names a package-script command (`npm test`, `npm run x`, `pnpm x`, `yarn x`, `bun run x`) and a duration that exceeds the budget CI gives the same command: the smallest of a `*_BUDGET_*`/`*_TIMEOUT_*`/`*_CEILING_*` env var with a unit suffix on the step, job or workflow, and `timeout-minutes` on the step or job. In a shell fence the command is the code and the duration its comment.
- **FR-004**: MET007 (informational, `defaultLevel: info`): the same comparison when an explicit budget variable (not a job's `timeout-minutes`, which is a safety net) is ten times or more the documented duration.
- **FR-005**: The codes are registered, explained, named in the CHANGELOG, and tested on the TestGuard shape.

## Success Criteria

- **SC-001**: The full suite passes by exit code.
- **SC-002**: A hermetic A/B against main on DocGuard and the local projects: no exit-code change; every new MET finding and every semantic-claim count change is listed.

## Verification Notes

- **SC-001**: `npm test` by exit code: 6010 pass, 0 fail.
- **SC-002**: hermetic A/B, main (`86a46ca`) against this branch, one fresh `git archive` per CLI, run one at a time. No exit code changed. The first candidate added 4 MET007 in one project, against a generic job `timeout-minutes`, and 1 MET006 in another, for a schedule interval ("every 24 hours") on a line that names a command. Both are false positives. FR-003 and FR-004 now require an explicit budget variable for MET007, and a prose duration phrased as how long the command takes; each shape has a test. On the rerun no MET005 to MET007 fires on any local project. Metrics-Consistency compares more lines (DocGuard: 7 → 17 checks), and the semantic-claim count grows in 8 projects, by 1 to 10 claims (fenced shell comments and bare `s`).
