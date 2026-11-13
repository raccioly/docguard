# Implementation Plan: Strict by Default

**Spec**: [spec.md](spec.md) (`docguard.strict-by-default`)

## Summary

Guard gains an enforcement mode, `strict` or `standard`, and `strict` is what a project gets when it has not chosen. Under strict every validator that applies must examine something or the run exits 4, and a finding fails the build only if its code already could under the 0.47.0 defaults or its measured precision clears a bar. The work lands in three stages. Stage A makes verdicts truthful and gives every empty result a cause and a fix, in both modes, and ships the mode as something a project can select. Stage B makes strict the default. Stage C grows the precision evidence so codes can become gating.

The default changes when the proof passes (SC-001 to SC-003), not on a date.

## Technical Context

- **Language**: Node.js ESM, no runtime dependency (Constitution II).
- **Where the mode resolves**: `cli/config.mjs`, next to profile resolution. One function, `resolveEnforcement(config, userConfig)`, returns `{ mode, asOf, source }`. It reads the project's own file for FR-003 ("disabled by the project's own configuration") because the merged config cannot tell a profile's `false` from the project's.
- **Where verdicts are derived**: `cli/validator-coverage.mjs` (`deriveVerdict`, `APPLICABILITY_CLASS`). FR-004 adds a performed-check count to the result contract.
- **Where the exit code is chosen**: `exitFor` in `cli/commands/guard.mjs`, beside `requiredChecks` (`cli/required-checks.mjs`). FR-007 reuses the required-checks path with the set "every applicable validator".
- **Where findings resolve to a level**: `resolveFindingEnforcement` in `cli/shared.mjs`. FR-008 adds the mode as an input.
- **Precision evidence**: `cli/precision-evidence.mjs` and `cli/precision-evidence-data.mjs`. FR-009 derives the gating set from it.
- **Validators**: 37 registered. Each gets an `applies(project)` function and its empty causes. Four inventories from the audit list, per validator, what it needs and where it looks; they are the starting map, to be verified against the code, not trusted.

## Research decisions

0. **Amended during the build (2026-11-12): a test path does not lower a Security finding.** The first draft of FR-010 demoted any secret-shaped literal in a test path to a warning. The build found 23 existing tests that encode the opposite rule, decided earlier from field evidence: a real secret pasted into a test file is still a leaked secret. Demoting by path would also have changed levels under `standard`, against FR-019. The path now only classifies the finding and bars it from gating; only a value that is synthetic by its own text is exempt.

1. **A new key, not a new profile.** `profile` stores what `init` wrote, and for most adopters that is `standard`. Reading it as a choice would exempt every existing project, which is the outcome the maintainer rejected. A separate `enforcement` key that is absent everywhere today makes every project strict on upgrade without reinterpreting a stored value. `profile` goes back to meaning the shape of the project.
2. **Two modes.** `standard` is exactly the 0.47.0 behavior, which makes the opt-out provable by A/B (SC-003). A third advisory mode would need its own definition and proof, and nobody has asked for it.
3. **Exit 4 for an unexamined validator.** Spec 081 gave 4 the meaning "a check that had to decide did not". Strict widens who has to decide. A new exit code would force every CI recipe and the action to learn it.
4. **Errors that exist today stay errors; new failures need evidence.** The codes that can exit 1 under the 0.47.0 defaults keep doing so, so strict is never weaker than today. Anything beyond that fails a build only as a gating code. This keeps Security and Architecture, which strict turns on for everyone, from failing builds on unmeasured findings.
5. **The bar: n ≥ 30 and a 95% Wilson lower bound ≥ 0.85.** Thirty true findings out of thirty give a lower bound of 0.886; twenty-nine of thirty give 0.833 and do not pass. The bar therefore tolerates no known false finding at the minimum sample and one at about sixty. It is defined once, in the evidence module.
6. **The gating set starts empty.** No current code has thirty labeled findings. Stage B is still a real change: unexamined validators fail, and the existing errors apply to validators that were off.
7. **The baseline is the debt record.** It already freezes fingerprints, refuses to freeze when observations failed, and reports stale entries. Strict adds only the count on every run and the command in the Adopt block.
8. **No automatic configuration.** The audit applied two generated configurations and both produced a pass that checked nothing. `howToConfigure` is text for a person or an agent.
9. **Rolling by a shipped table, not by local state.** CI has no memory between runs. A table of what joined strict in which version, shipped in the package, lets guard say "new in vX.Y" and lets `asOf` hold a project at a version.

## Closed lists

- **Codes that can exit 1 under the 0.47.0 defaults** (from the audit, to be confirmed by the T004 test against the v0.47.0 tag): STR001, STR002, DRF001, DRF002, API004 (contract mode), DLK005, ANC005, ANC001 and ANC003 under `reviewed-exact`, OWN007, EVD001, EVD002, REQ001.
- **Provably synthetic values for FR-010**, case-insensitive, added to the existing placeholder rule: contains `placeholder`, `synthetic`, `not-a-real`, `notreal`, `dummy`, `changeme` or `change-me`, or is a single repeated character. `example`, `xxx` and `your-` are left as the existing rule has them.
- **Empty causes**: `needs-declaration`, `needs-content`, `layout-not-recognized`, `nothing-of-this-kind`.

## Project Structure

```
cli/config.mjs                      resolveEnforcement
cli/enforcement.mjs                 new: mode, strict set, additions table, unexamined list
cli/strict-additions.mjs            new: version → validator keys and gating codes
cli/validator-coverage.mjs          performed-check count, causes, applies
cli/validators/*.mjs                applies() and howToConfigure per validator
cli/shared.mjs                      resolveFindingEnforcement takes the mode
cli/precision-evidence.mjs          gating set from evidence
cli/validators/security.mjs         test-or-placeholder classification
cli/commands/guard.mjs              exitFor, Adopt block, JSON fields, mode line
cli/commands/init.mjs               --enforcement, wizard question, closing text
cli/commands/upgrade.mjs            read-only strict report
schemas/docguard-config.schema.json enforcement
tests/strict-by-default.test.mjs    new
tests/validator-applicability.test.mjs  new: one applicable-and-empty fixture per validator
docs/upgrading-to-strict.md         new
```

## Stages

- **Stage A — truthful and explainable, mode selectable.** FR-001, FR-002, FR-004, FR-005, FR-006, FR-010, FR-014 to FR-016, FR-018. The default is still `standard` in this stage. A project can write `"enforcement": "strict"`. DocGuard's own repository does (FR-020), which is the dogfood. Three build sessions can work in parallel on disjoint files: (A1) the mode, exit code, output and `upgrade`; (A2) performed-check counts, causes and `applies` across the validators; (A3) Security context and placeholder vocabulary. A2 is the largest and is split by validator family if needed.
- **Stage B — the default changes.** FR-003, FR-007 as default, FR-008, FR-011 to FR-013, FR-017, FR-019, FR-022. One build session, after the Stage A proof.
- **Stage C — evidence.** FR-009 corpus growth and FR-021. The history-replay benchmark of spec 095 is its first input. Continues after the default changes.

## Risks

- **A validator answers "applies" where it should not.** Every adopter of that kind of project turns red with no true cause. Mitigation: SC-001 labels every reported validator on eight repositories before the default changes, and a validator that fails the label has its `applies` fixed or is held out of the strict set through the additions table.
- **`howToConfigure` leads to a vacuous pass.** Mitigation: FR-004 makes a pass with zero checks impossible, and SC-001 applies each fix and checks the result.
- **An older pinned DocGuard rejects the new key.** Mitigation: FR-002, tested against the v0.47.0 tag before anything else.
- **Adopters meet a red build with no warning.** Accepted by the maintainer. Mitigation: the Adopt block, `docguard upgrade`, the migration page, and a breaking-change entry.
- **The private audit repositories.** Their names must not reach a tracked file, a commit or a pull request. Results are written as "a project with X".

## Verification

- Failing tests first for every acceptance scenario; each shown red before the change.
- The full suite, `guard` on this repository under strict, and the workflow tests.
- Hermetic A/B (fresh `git archive` copy per CLI, no concurrent load) against v0.47.0: `standard` mode on the eight repositories and on DocGuard (SC-003), then strict on the same set with every reported validator and failing finding labeled (SC-001, SC-002).
- The issue 628 fixture (SC-004).
