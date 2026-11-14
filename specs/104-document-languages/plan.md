# Implementation Plan: Documents in Any Language

**Spec**: [spec.md](spec.md) (`docguard.document-languages`)

## Summary

Labels become ids. One registry owns every section id, its English label and the per-language aliases; one resolver answers "does this heading satisfy id X" for every validator, so STR003, ENV001, ENV002, the Score, Test-Spec, DCV005, CHG001, DEC001 and the Spec Kit checks stop keeping their own English strings. A heading marker, `<!-- docguard:heading <id> -->`, is the language-neutral form; `language` in `.docguard.json` selects built-in aliases for `pt` and `es`. Text metrics run only for languages with word lists and are otherwise reported as skipped. A check that cannot judge a document because of its language reports `couldNotRead`.

| FR | Stage | Change |
|---|---|---|
| FR-001 | 0 | Compatibility test against the v0.48.0 tag (new keys and marker are inert there). |
| FR-002 | 0 | `cli/writers/sections.mjs`: an open marker without `id=` does not open a bounded block; `docguard:heading` never matches the grammar. |
| FR-003 to FR-005 | 1 | New `cli/shared-labels.mjs` (closed id registry, aliases per primary subtag, the marker reader, the resolver). `cli/authoring-contract.mjs` carries an `id` per section. |
| FR-006, FR-007 | 1 | `cli/shared.mjs` keeps the legacy normalizer and gains the Unicode-aware one; `cli/config.mjs` reads `language` and `labelAliases`; `schemas/docguard-config.schema.json`. |
| FR-008 to FR-011 | 1 | `docHasSection`, `findSectionHeading`, `upsertSection`, `structure.mjs` (STR003, STR007), `environment.mjs`, `score.mjs`, `test-spec.mjs`, `sync-tests.mjs`, `docs-coverage.mjs` (DCV005); STR009 in `findings.mjs`. |
| FR-012 to FR-016 | 2 | `changelog.mjs`, `fix.mjs`, `mechanical.mjs`, `score.mjs`; `decision-records.mjs`; `lifecycle-status.mjs`; `scanners/speckit.mjs`; `shared-requirement-ids.mjs`. |
| FR-017 to FR-022 | 3 | `doc-quality.mjs` (capability table, Unicode tokenizer, skip report), new `cli/shared-language-detect.mjs`, `validator-coverage.mjs` (cause), `enforcement.mjs` (routing), `shared-guard-json.mjs`, `guard.mjs` (text line), the four English-prose validators. |
| FR-023, FR-024 | 4 | `writers/doc-generators.mjs`, `scanners/memory-plan.mjs`, `scanners/as-built.mjs`, `shared-scaffold.mjs`; `explain.mjs`, `findings.mjs` help, the generated reference page, README. |
| FR-025, FR-026 | 5 | Three fixture projects, the A/B, the closing documents. |

## Technical Context

- **Language/runtime**: JavaScript (ES modules), Node.js 18+. No new dependency. `Intl` and `String.prototype.normalize` (both in Node) supply Unicode folding; the language detector is a closed stop-word table in the repository.
- **Existing code this builds on**: `docHasSection` and `findSectionHeading` (`cli/shared.mjs`), the N/A marker and slug in `cli/validators/structure.mjs`, `CANONICAL_SECTIONS` (`cli/authoring-contract.mjs`), `EMPTY_CAUSES` and `buildStrictReport`/`addUnexaminedDocuments` (`cli/validator-coverage.mjs`, `cli/enforcement.mjs`), `parseSections` and `upsertSection` (`cli/writers/sections.mjs`), the `docguard:quality`, `docguard:spec-id` and `docguard:spec-type` marker readers.
- **Constraints**: no finding changes without `language` (FR-006, SC-004); a skip is never a number (FR-017); `couldNotRead` never changes the exit code (FR-019); closed vocabularies are registered once and tested for exactness in both directions, as spec 100's registry test is.
- **Testing**: `node --test` files in `tests/`; fixtures as committed projects under `tests/fixtures/languages/<tag>/`; v0.48.0 from a `git archive` copy in a temporary directory (spec 097 T001 is the pattern); hermetic A/B (fresh copy per CLI, no concurrent load).
- **Decision (D6 and spec 097)**: the new keys and the marker are inert on v0.48.0 (measured), so they ship with the feature, not in a release before it.

## Stages

One pull request each, in order. Tests are written first in every stage and shown red before the change.

- **Stage 0 — compatibility and the parser fix.** FR-001, FR-002. Small, and independent of the rest. Open question Q10 asks whether it ships alone before the spec is approved.
- **Stage 1 — structure.** FR-003 to FR-011. The registry, the marker, `language`, `labelAliases`, the resolver, STR003 and its siblings, STR009. After it, the Problem table's headings and Test-Spec rows are green for `pt-BR`.
- **Stage 2 — changelog, decisions, lifecycle, Spec Kit.** FR-012 to FR-016. Each validator's English strings move to the registry.
- **Stage 3 — metrics and strict.** FR-017 to FR-022. The only stage that touches `enforcement.mjs`; it needs the Stage 1 resolver and the Stage 2 registry entries for the detector's per-document language.
- **Stage 4 — generators and explain.** FR-023, FR-024. New projects start language-ready.
- **Stage 5 — measurement and closing.** FR-025, FR-026, the final documents, the spec's move to `Implemented`.

## Project Structure

```
cli/shared-labels.mjs               new: id registry, aliases per subtag, marker reader, resolver
cli/shared-language-detect.mjs      new: stop-word table, per-document detector (skip only)
cli/authoring-contract.mjs          id per section; sectionsFor and requiredSectionMap carry ids
cli/shared.mjs                      docHasSection, findSectionHeading call the resolver; two normalizers
cli/config.mjs                      language, labelAliases, docs.language
cli/validators/structure.mjs        STR003, STR007 through the resolver; STR009
cli/validators/environment.mjs      ENV001, ENV002 through the resolver
cli/validators/test-spec.mjs        map heading through the resolver (and sync-tests.mjs)
cli/validators/docs-coverage.mjs    DCV005 README sections by id
cli/validators/changelog.mjs        CHG001 through the resolver
cli/validators/decision-records.mjs status words, terminal words, link words
cli/validators/doc-quality.mjs      capability table, Unicode tokenizer, skip report
cli/validators/{docs-diff,metrics-consistency}.mjs, cli/scanners/{semantic-claims,instruction-audit}.mjs
                                    language-not-supported for documents without rules
cli/scanners/lifecycle-status.mjs   Status label and retired words
cli/scanners/speckit.mjs            spec, plan, tasks, bugfix sections
cli/shared-requirement-ids.mjs      scaffold shape per language
cli/shared-scaffold.mjs             scaffold comparison by id
cli/writers/sections.mjs            open marker needs id=; upsertSection host via resolver
cli/writers/{mechanical,doc-generators}.mjs, cli/scanners/{memory-plan,as-built}.mjs
                                    markers and localized headings
cli/validator-coverage.mjs          EMPTY_CAUSES gains language-not-supported
cli/enforcement.mjs                 couldNotRead routing at validator and document level
cli/shared-guard-json.mjs           the new cause in strict.couldNotRead
cli/commands/{guard,score,fix,explain}.mjs, cli/findings.mjs
                                    text line, score, fix, help
schemas/docguard-config.schema.json language, labelAliases
tests/document-languages-*.test.mjs new, one per stage
tests/fixtures/languages/{pt-BR,es,de}/   committed fixture projects
docs/languages.md                   new: the closed id list, the marker, the sets, how to extend
```

## Risks

- **Aliases are wrong or incomplete.** A native review in Stage 1 (Open question Q4 for metrics), and the message of every label finding names the marker, which always works.
- **The resolver changes an English result.** The legacy normalizer stays on the English path; SC-004 and the A/B are the gate, and the Stage 1 PR carries the English A/B before Stage 2 starts.
- **A skip hides a real problem.** A skip is never silent: it is reported per document and per validator (FR-017, FR-019, FR-022).
- **Detector false positives.** It is used only to skip, abstains on a small margin, and never touches structure (FR-020).
- **The new empty cause leaks into the exit code.** Stage 3 tests assert that no run that only adds `language-not-supported` changes the exit code on any fixture.
- **Private repositories in the A/B.** Their names never reach a tracked file, a commit or a pull request; results are written as "a project with X".

## Verification

- Failing tests first for every acceptance scenario, each shown red on v0.48.0.
- The full suite, `guard` on this repository, the benchmark comparison and the v0.48.0 compatibility test.
- Hermetic A/B of D8 per stage that touches a validator (Stages 1 to 3), and once more at Stage 5.
- The three fixtures (`pt-BR`, `es`, `de`) run in strict mode; the report is checked for the exit code, `strict.unexamined` and `strict.couldNotRead`.
