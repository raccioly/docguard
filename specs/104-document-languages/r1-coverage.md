# R1 coverage (SC-006)

Every row of the spec's R1 inventory, in the order of the table there, with the test that was red before the change (the stage that wrote it ran it on the previous code; stage 0 is the parser fix) or the reason the row is unchanged by decision. `tests/document-languages-r1-coverage.test.mjs` checks that this table has one entry per R1 row, that each test file exists and contains the token it is cited by, and that each decision names a decision or requirement the spec has.

| R1 row | Coverage | Stage | Test file | Token in the test | Reason |
|---|---|---|---|---|---|
| 1 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `STR003` | - |
| 2 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `STR003` | - |
| 3 | red-before test | 5 | `tests/document-languages-r1-coverage.test.mjs` | `STR007` | - |
| 4 | red-before test | 4 | `tests/document-languages-generate.test.mjs` | `isUneditedScaffold` | - |
| 5 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `STR003` | English synonyms stay and English is always accepted; the aliases are the non-English forms |
| 6 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `Visao geral` | - |
| 7 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `ENV001` | - |
| 8 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `Score` | - |
| 9 | red-before test | 2 | `tests/document-languages-changelog.test.mjs` | `Score` | - |
| 10 | unchanged by decision | - | - | `Decision 6` | The DORA AI stance reads AGENTS.md or CLAUDE.md, which are agent-instruction files: out of scope by Decision 6, so they get no alias and no entry |
| 11 | red-before test | 1 | `tests/document-languages-fixtures.test.mjs` | `testSpec` | - |
| 12 | red-before test | 1 | `tests/document-languages-structure.test.mjs` | `DCV005` | - |
| 13 | red-before test | 2 | `tests/document-languages-changelog.test.mjs` | `CHG001` | - |
| 14 | red-before test | 2 | `tests/document-languages-decisions.test.mjs` | `DEC001` | - |
| 15 | red-before test | 2 | `tests/document-languages-decisions.test.mjs` | `terminal` | - |
| 16 | red-before test | 2 | `tests/document-languages-decisions.test.mjs` | `Substitui` | - |
| 17 | red-before test | 2 | `tests/document-languages-speckit.test.mjs` | `Estado` | - |
| 18 | red-before test | 2 | `tests/document-languages-speckit.test.mjs` | `SPK003` | - |
| 19 | red-before test | 2 | `tests/document-languages-speckit.test.mjs` | `SPK004` | - |
| 20 | red-before test | 2 | `tests/document-languages-speckit.test.mjs` | `SPK005` | - |
| 21 | red-before test | 2 | `tests/document-languages-speckit.test.mjs` | `Causa raiz` | - |
| 22 | unchanged by decision | - | - | `FR-015` | The `Spec ID` label is unchanged on purpose: the language-neutral `docguard:spec-id` comment is the form for a translated document (FR-015) |
| 23 | red-before test | 2 | `tests/document-languages-requirements.test.mjs` | `DEVE` | - |
| 24 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `não` | - |
| 25 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ001` | - |
| 26 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ002` | - |
| 27 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ003` | - |
| 28 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ004` | - |
| 29 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ006` | - |
| 30 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ007` | - |
| 31 | red-before test | 3 | `tests/document-languages-metrics.test.mjs` | `DQ008` | - |
| 32 | red-before test | 3 | `tests/document-languages-strict.test.mjs` | `Docs-Diff` | - |
| 33 | red-before test | 3 | `tests/document-languages-strict.test.mjs` | `Docs-Diff` | Docs-Diff reads no document in another language, so no translated change record is read as a claim |
| 34 | red-before test | 3 | `tests/document-languages-strict.test.mjs` | `Metrics-Consistency` | - |
| 35 | red-before test | 3 | `tests/document-languages-strict.test.mjs` | `semantic` | - |
| 36 | unchanged by decision | - | - | `Decision 6` | The instruction audit reads agent-instruction files: out of scope by Decision 6 |
| 37 | red-before test | 2 | `tests/document-languages-changelog.test.mjs` | `fix --write` | - |
| 38 | red-before test | 1 | `tests/document-languages-writers.test.mjs` | `upsertSection` | - |
| 39 | red-before test | 4 | `tests/document-languages-generate.test.mjs` | `init` | - |
| 40 | red-before test | 4 | `tests/document-languages-generate.test.mjs` | `as-built` | - |
| 41 | red-before test | 0 | `tests/document-languages-sections.test.mjs` | `nested-or-unclosed` | - |
