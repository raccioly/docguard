# Feature Specification: Every Suppression Has an Owner and an End Date the Project Can Enforce

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-02

**Status**: Draft

**Spec ID**: `docguard.accountable-suppressions`

**Lineage**: Third feature of the DocGuard × AI-DLC program (issue 607). It extends `docguard.ignore-reasons` (spec 057), which built one model of every native suppression (FR-006), gave `.docguardignore` entries a reason and an expiry (FR-001 to FR-004), and reports IGN001 to IGN003 through the Suppressions validator (FR-005).

**Input**: The AWS AI-DLCOps sample makes a gate waiver a file that names who signed it and when it lapses, at most 7 days out, and refuses a waiver without both. DocGuard's suppressions can already carry a reason, and `.docguardignore` entries an expiry. Nobody owns any of them, only one of six suppression kinds can expire, and nothing caps how long a waiver may last.

## Problem

- **Only `.docguardignore` can expire.** An inline `docguard:ignore` pragma, a `docguard:validator … n/a` marker, a `docguard:section … n/a` marker and the `.docguard.json` arrays (`ignore`, `securityIgnore`, `todoIgnore`) last forever. A waiver granted for one release outlives it unnoticed.
- **No suppression names an owner.** When a waiver is questioned, nobody is accountable for it, and the model cannot report suppressions by person.
- **No policy caps the window.** `suppressions.requireReason` makes reasons mandatory. There is no equivalent for owners, and no ceiling on how far out an expiry may be set, so `expires:2099-01-01` defeats the purpose.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every kind of suppression can expire and name its owner (Priority: P1)

As a developer silencing a finding, I can write who owns the waiver and when it lapses, in the same place I write its reason, whatever kind of suppression it is.

**Independent Test**: A fixture with one suppression of each kind, each carrying `owner:` and `expires:`. `docguard ignore --format json` lists them.

**Acceptance Scenarios**:

1. **Given** `src/a.js` with `// docguard:ignore SEC001 — rotating key in #812 owner:@ana expires:2026-12-31`, **Then** the model entry has reason `rotating key in #812`, owner `@ana` and expiry `2026-12-31`.
2. **Given** `<!-- docguard:validator apiSurface n/a — CLI, no HTTP API owner:@ana expires:2027-06-30 -->`, **Then** the marker entry carries the owner and the expiry.
3. **Given** `.docguardignore` line `dist/** # build output owner:@ops expires:2027-01-01`, **Then** the entry carries the owner. Every existing form reads as it did.
4. **Given** `.docguard.json` `"ignore": [{ "pattern": "vendor/**", "reason": "third-party", "owner": "@ops", "expires": "2027-01-01" }]`, **Then** the object form is read the same way as a string entry with that metadata. A plain string entry reads as today.

### User Story 2 - An expired waiver stops suppressing, in every kind (Priority: P1)

As a team lead, I know an expired waiver of any kind no longer hides anything, and I see each one reported.

**Independent Test**: The US1 fixture with every expiry set to yesterday.

**Acceptance Scenarios**:

1. **Given** an expired inline pragma, **Then** the finding it suppressed is reported again. With `suppressions.requireOwner` or `suppressions.maxDays` set, IGN001 also names the pragma and its owner. Finding pragmas means reading every file, which costs 160–336 ms per run on measured projects, so that report comes only with a policy on. The pragma itself stops suppressing either way.
2. **Given** an expired validator N/A marker, **Then** the validator runs again and IGN001 is reported.
3. **Given** an expired `.docguard.json` object entry, **Then** its pattern excludes nothing and IGN001 is reported at its config key.
4. **Given** an entry expiring today (UTC), **Then** it still applies, as spec 057 FR-003 defines.

### User Story 3 - A project enforces owners and a maximum window (Priority: P2)

As a team lead, I can require every waiver to name an owner and to expire within a set number of days.

**Independent Test**: The US1 fixture with `suppressions.requireOwner: true` and `suppressions.maxDays: 30`.

**Acceptance Scenarios**:

1. **Given** `requireOwner: true`, **Then** every suppression that can carry metadata and has no owner gets IGN004. The suppression still applies, as IGN002 does today.
2. **Given** `maxDays: 30` and an expiry 90 days out, **Then** IGN005 reports the entry, its expiry and the latest allowed date. The suppression still applies.
3. **Given** `maxDays: 30` and an entry with no expiry, **Then** IGN005 reports it as having no end date.
4. **Given** baseline fingerprints, **Then** neither IGN004 nor IGN005 applies. A baseline is a team-wide adoption snapshot whose lifetime the baseline age line already reports.

### Edge Cases

- **Token order.** `owner:` and `expires:` may appear in either order after the reason, and each at most once. A second occurrence makes the entry unreadable (IGN003), which spec 057 already defines for a bad expiry.
- **An owner token inside the reason** (`see owner:@x's PR`). Only a whitespace-separated token at the end of the text counts as metadata, which is the rule spec 057 FR-001 uses for `expires:`.
- **Owner syntax.** `@handle`, `team/name` or an email address. Anything else is unreadable (IGN003). DocGuard does not resolve owners against any service (Constitution VIII).
- **Suppressions that cannot carry metadata**: baseline fingerprints. They are listed with `owner: null` and are exempt from IGN004 and IGN005.
- **The claimspec export** (spec 057 FR-008) carries `owner` only where claimspec's `ignore` schema has a field for it. Otherwise the owner is reported as dropped on stderr, the way every omitted field already is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An inline `docguard:ignore` / `docguard:ignore-secret` pragma, a `docguard:validator <key> n/a` marker and a `docguard:section <id> n/a` marker MUST accept trailing `owner:<owner>` and `expires:YYYY-MM-DD` tokens after the reason. The reason is the text before them.
- **FR-002**: A `.docguardignore` entry MUST accept a trailing `owner:<owner>` token inside its `# reason` comment, beside spec 057's `expires:` token.
- **FR-003**: `.docguard.json` `ignore`, `securityIgnore` and `todoIgnore` MUST accept, beside plain pattern strings, objects `{ pattern, reason?, owner?, expires? }`. A string entry MUST behave exactly as before.
- **FR-004**: An expired suppression of any kind MUST suppress nothing from the UTC day after its expiry, in every command and validator that reads it. It MUST be reported as IGN001 with its kind, location and owner, except an inline pragma when no waiver policy (FR-005, FR-006) is set: finding pragmas needs a full project read, and guard does not pay that cost on every run.
- **FR-005**: `suppressions.requireOwner: true` MUST report IGN004 for each suppression able to carry metadata (FR-001 to FR-003) that has no owner. The suppression still applies.
- **FR-006**: `suppressions.maxDays: <n>` MUST report IGN005 for each suppression able to carry metadata whose expiry is more than `n` days after today (UTC), or which has no expiry. The suppression still applies.
- **FR-007**: The suppression model (spec 057 FR-006) and `docguard ignore` (text and JSON) MUST carry `owner` on every entry (`null` when absent), and `docguard ignore --owner <owner>` MUST filter the listing.
- **FR-008**: Every form that 0.45.2 accepts MUST produce exactly the suppression it produced before, unless it ends with a well-formed `owner:` token.
- **FR-009**: `schemas/docguard-config.schema.json`, `docs/configuration.md`, `docs/reference/findings.md` (IGN004, IGN005, and IGN001/IGN003 wording), `cli/findings.mjs` and `CHANGELOG.md` MUST describe the forms and policies.

### Key Entities

- **Waiver metadata**: The reason, owner and expiry a suppression carries. Owner and expiry are new for every kind except `.docguardignore` expiry, which spec 057 introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each acceptance scenario has a test. The US1 and US2 tests fail on 0.45.2, and the controls (plain forms) pass there.
- **SC-002**: A hermetic A/B on this repository and every local project shows no change in findings, suppression counts or exit codes, because none of them uses the new tokens.
- **SC-003**: Every suppression in this repository is listed by `docguard ignore --format json` with its owner field present (`null` or set).

## Verification Notes

- **SC-002**: no `.docguardignore`, `.docguard.json`, pragma or marker in any local project carries an `owner:` or `expires:` token. `docguard ignore --format json` from v0.45.2 and from this branch, on a fresh clone of each of 46 local projects, lists the same suppressions by kind and expired count on every one. That is 878 entries across the 21 projects that have any. The final guard A/B added no IGN finding and changed no exit code.
- **SC-003**: every entry `docguard ignore --format json` lists for this repository carries an `owner` field; checked by `tests/program-verification.test.mjs`.

## Assumptions

- `owner:` and `expires:` use the same token style as spec 057's `expires:`, so one rule covers every kind.
- Owners are opaque strings. Validating them against a forge or directory would need network access and credentials, which the deterministic core does not have (Constitution VIII).
- `maxDays` counts calendar days in UTC, like spec 057 expiry.

## Out of Scope

- Signatures or approvals on waivers (AI-DLCOps' "decision-maker signature"). Ownership is a declared field, and review happens in the pull request that adds it.
- Expiring baseline fingerprints individually.
- Notifying owners.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `da9a26e1bfecd4a989362a8bf74af9f72f1edb53` — Owner and expiry on every suppression kind through one parser; suppression listings identical on 46 projects (878 entries); no IGN finding added. Evidence: `cli/shared-ignore.mjs`, `cli/validators/suppressions.mjs`, `cli/waiver-metadata.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/DATA-MODEL.md`, `docs-canonical/TEST-SPEC.md`, `tests/accountable-suppressions.test.mjs`, `tests/program-verification.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
