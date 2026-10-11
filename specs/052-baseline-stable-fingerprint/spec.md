# Feature Specification: Baseline Fingerprints Ignore Advisory Hints

**Feature Branch**: `fix/baseline-stable-fingerprint`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.baseline-stable-fingerprint`

**Lineage**: Corrects the adoption baseline (`cli/writers/baseline.mjs`, v0.33), whose fingerprint excludes line numbers and volatile counts but not volatile advisory text. Reported in raccioly/docguard#478 (two reproductions on a real repository).

**Input**: raccioly/docguard#478.

## Problem

A baseline fingerprint hashes `code | path | message`, with digits masked. TRC004's message ends with an advisory hint, *"— IR soft-match: tests/unit/x.test.js (14% similar) may already cover it"*. The hint names whichever test file best matches the requirement right now.

Adding an unrelated test file can change that best match. The message then changes, so does the fingerprint, and a finding frozen in `.docguard.baseline.json` comes back as new. `--fail-on-warning` blocks the commit. The only workaround is to re-freeze, which also admits any new drift and defeats the baseline's ratchet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new test file does not resurface a baselined finding (Priority: P1)

1. **Given** a baselined TRC004 finding whose message carries a soft-match hint, **When** a new test file becomes the best match, **Then** guard still suppresses the finding.
2. **Given** a baselined TRC004 finding with no hint, **When** a hint appears later, **Then** it stays suppressed.

### User Story 2 - Existing baselines keep working (Priority: P1)

1. **Given** a `.docguard.baseline.json` written by an earlier release, whose TRC004 fingerprints include the hint, **When** guard runs on the same tree, **Then** every finding it froze is still suppressed.
2. **Given** that legacy baseline, **When** the user runs `guard --update-baseline`, **Then** the file is rewritten with the new, hint-free fingerprints.

### Edge Cases

- **Occurrence counts:** a finding consumes one unit of budget, whether it matched the new fingerprint or the legacy one. It never consumes from both.
- **Other findings:** every finding without an advisory tail keeps exactly the same fingerprint, so no other baseline entry changes.

## Requirements *(mandatory)*

- **FR-001**: A finding's fingerprint MUST exclude the advisory tail its code declares. TRC004 declares ` — IR soft-match: …`, up to the end of the message. The list of tails is explicit and keyed by finding code: no generic heuristics.
- **FR-002**: Guard MUST also accept the legacy fingerprint (the full message), so a baseline written by an earlier release keeps suppressing what it froze. A finding consumes budget from at most one entry.
- **FR-003**: `guard --update-baseline` MUST write only the new fingerprints.
- **FR-004**: A finding with no declared tail MUST keep its current fingerprint byte for byte.
- **FR-006** (amendment, 2026-10-10): Guard MUST try a finding's exact (legacy) fingerprint before its stable one. Findings that differ only in digits and in their advisory tail share a stable fingerprint; tried first, it let a hinted finding consume the unit a legacy baseline recorded for an unhinted one, which resurfaced. Found by dogfooding a real repository: 3 of 163 frozen findings resurfaced.
- **FR-005**: The CHANGELOG and the baseline section of `docs/configuration.md` MUST state which text is excluded and how legacy baselines behave.

## Success Criteria *(mandatory)*

- **SC-001**: On a fixture with a baselined TRC004 finding, adding a test file that changes the soft-match hint leaves guard at PASS. Before the fix it fails.
- **SC-002**: The full suite passes, and guard on this repository is unchanged.

## Out of Scope

- Changing what any finding says, or the baseline file format.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `c53c264a31179bd423e927ad63728dbec2084014` — Reviewed at c53c264 on main: all 4 tasks are checked and were delivered by #518; the full suite (2931 tests) passes on Node 18, 20, 22 and 24 in CI, and guard reports 0 errors at this revision. Evidence: `cli/writers/baseline.mjs`, `docs-canonical/DATA-MODEL.md`, `tests/baseline-stable-fingerprint.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
