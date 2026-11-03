# Feature Specification: DORA's Documentation and AI Capabilities, Measured From the Repository

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-03

**Status**: Draft

**Spec ID**: `docguard.dora-evidence`

**Lineage**: Builds on existing `score` mappings and does not depend on the AI-DLC work:
- `score` already renders ALCOA+ (`computeAlcoaCompliance`) and Agent Readability (`assessAgentReadability`) as display-only sections that never feed the CDD grade.
- It already has opt-in views (`--tax`, `--signals`).

This spec adds a DORA view the same way. It reads facts DocGuard already computes and adds no detector:
- guard findings (spec 081 verdicts);
- the `memory` accuracy diffs (`diffRoutes`, `diffEntities`, `diffEnvVars`, `diffTechStack`);
- Doc-Quality;
- freshness and the doc lock (`docLockStatus`);
- the document lifecycle (`parseLifecycleStatus`);
- the agent instruction budget (spec 017);
- Agent Readability.

It also gives the MCP document tools (spec 032) the lifecycle signal they lack.

**Input**: Two DORA sources.
- **DORA's documentation quality capability** (https://dora.dev/capabilities/documentation-quality/). DORA measures it with eight survey statements, listed in the 2022 questionnaire (https://dora.dev/research/2022/questions/, "Documentation"). In DORA's 2022 data, above-average documentation multiplied every technical capability's lift to organizational performance. Trunk-based development, for example, went from 36% with below-average documentation to 1525% with above-average documentation, and continuous integration from 34% to 750%.
- **DORA's AI Capabilities Model** (2025), summarized in Google Cloud's "From adoption to impact" post. It names seven capabilities that amplify AI's benefits:
  - a clear AI stance;
  - a healthy data ecosystem;
  - AI-accessible internal data;
  - strong version control;
  - working in small batches;
  - a user-centric focus;
  - quality internal platforms.

  Its context-engineering advice warns about context rot and deprecated examples.

DORA measures these by survey. A team cannot see, from its own repository, which of them it is weak on. DocGuard can show evidence for most of them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A team sees its documentation against DORA's eight items (Priority: P1)

**Independent Test**: `docguard score --dora --format json` on a fixture with canonical docs, an API reference listing a route the code does not have, a stale doc and no runbook.

**Acceptance Scenarios**:

1. **Given** that fixture, **Then** `dora.documentation` has eight entries, in DORA's order. Each carries:
   - `id` and a short `label` in DocGuard's words, with a link to DORA's questionnaire;
   - `score` (0–100, or `null`);
   - `measure` (`deterministic`, `proxy` or `survey-only`);
   - `evidence[]`;
   - `improve`.
2. **Given** the extra route, **Then** `reflects-capabilities` is lowered and its evidence names the route.
3. **Given** no runbook or troubleshooting doc, **Then** `used-in-incidents` is a `proxy` whose evidence says no incident document exists.
4. **Given** `easy-to-understand`, **Then** it is `proxy` (readability metrics), never `deterministic`.

### User Story 2 - A team sees the AI capabilities a repository can show (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a project, **Then** `dora.ai` reports `ai-accessible-data` from:
   - Agent Readability's metrics;
   - whether an MCP server for DocGuard is configured for an agent;
   - retired or superseded documents still referenced from agent instruction files;
   - the share of documented facts that match code.
2. **Given** a git project, **Then** `small-batches` reports, from local history over the last 90 days:
   - the median number of files changed per non-merge commit;
   - the share of commits over 20 files.

   **Given** a project with no git, **Then** the score is `null`, with a reason.
3. **Given** a project, **Then** `version-control` reports whether these are tracked in git: application code, application configuration, build and automation scripts (package manifests, Makefiles, CI workflows), and infrastructure as code.
4. **Given** a project, **Then** `ai-stance` is a `proxy`: an agent instruction file exists, and it states what agents may or must not do.
5. **Given** `user-centric-focus`, `healthy-data-ecosystem` and `quality-internal-platform`, **Then** each is `survey-only` with a `score` of `null` and a note on where its evidence lives.

### User Story 3 - Agents can tell a retired document from a current one (Priority: P2)

`docguard_docs_for_path` already returns the doc-lock review state of every covered section (`covers[].state`) and the section of every reference.

**Acceptance Scenarios**:

1. **Given** a reference in a document whose header says `Status: Superseded` or `Retired`, **Then** `docguard_docs_for_path` returns a `docs` map with `lifecycle` set for that document. The map has one entry per referencing document, not one per reference.
2. **Given** the sensor cache (spec 090) holds a guard run for the current tree state, **Then** each document's entry carries `openFindings`, the codes guard reported in that document. **Given** no matching cache, **Then** `openFindings` is `null` with `findingsBasis: "no-current-guard-run"`. It is never computed by running guard inside the MCP call.

### Edge Cases

- **No git**: the small-batch and version-control scores are `null`, with a reason.
- **No evidence**: an item without evidence is `null`, not 0.
- **Without `--dora`**: `score` output (human and JSON) is unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `docguard score --dora` MUST render a display-only "DORA" section, after ALCOA+. `score --dora --format json` MUST add a `dora` key. The DORA view MUST NOT change the CDD score, grade or exit code. Without `--dora`, `score` output MUST be byte-identical to before.
- **FR-002**: `dora.documentation` MUST hold DORA's eight items, in its order, each with `id`, `label`, `score`, `measure`, `evidence[]` and `improve`. Scores MUST come from:

  | Item | Measure | Evidence |
  |---|---|---|
  | `reliable` | deterministic | the share of documented routes, entities, environment variables and stack facts that match code |
  | `easy-to-understand` | proxy | Doc-Quality |
  | `easy-to-find` | deterministic | Agent Readability addressability, plus `llms.txt` and the doc ownership map |
  | `code-documented` | deterministic | the share of routes, entities and environment variables in code that the docs cover |
  | `well-organized` | deterministic | the structure score |
  | `updated-with-changes` | deterministic | doc-lock sections `current` out of covered sections, plus freshness |
  | `reflects-capabilities` | deterministic | documented facts with no code behind them |
  | `used-in-incidents` | proxy | a runbook or troubleshooting document exists |
- **FR-003**: `dora.ai` MUST hold the seven AI capabilities, with the evidence of US2. `user-centric-focus`, `healthy-data-ecosystem` and `quality-internal-platform` MUST be `survey-only`.
- **FR-004**: `dora` MUST carry `schemaVersion: 1`, `source` (DORA's URLs) and `caveat`. The caveat states that DORA measures these by survey, and that this is repository evidence which complements a survey and never replaces it. `schemas/docguard-dora.schema.json` MUST validate the `dora` object.
- **FR-005**: `docguard_docs_for_path` MUST add a `docs` map: each referencing document, with its `lifecycle` (header status, or `active`), plus `openFindings` and `findingsBasis` from the sensor cache when that cache is for the current tree state. Existing fields MUST NOT change.
- **FR-006**: `docs/commands.md`, `docs/ai-integration.md`, `docs-canonical/ARCHITECTURE.md`, `DATA-MODEL.md`, `TEST-SPEC.md` and `CHANGELOG.md` MUST describe the view and the `docs` map.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test.
- **SC-002**: On this repository, at least 6 of the 8 documentation items have a non-null score, and every score cites at least one evidence entry.
- **SC-003**: The hermetic A/B changes no `guard` finding or exit code, and no `score` output without `--dora`. The only change to agent-facing output is the additive `docs` map, which stays within spec 031's byte budget.

## Verification Notes

Run on this repository on 2026-11-03:
- All 8 documentation items had a score, and the documentation evidence came to 90% (SC-002).
- Reliable was 60%: 3 of 5 checked facts agree, and two documented environment variables are not read in code.
- Easy to find was 60%: 19 of 98 H2/H3 sections can be quoted alone.
- Working in small batches was 41%: 32% of the 238 commits in 90 days touched more than 20 files. This is the program's own batching, visible in its history.
- The view takes about 1.4 s, all spent in the memory diffs, and only under `--dora`.

A first draft treated a `Dockerfile` as a deploy signal. It would have scored this CLI's own image build as missing infrastructure as code, so infrastructure configuration became evidence only.

## Assumptions

- Labels are DocGuard's own short names for DORA's items. DORA's statements are linked, not copied.
- The full AI Capabilities Model report requires registration. This spec relies on DORA's public capability pages and Google Cloud's published summary.

## Out of Scope

- Surveys, team archetypes and value-stream mapping.
- Sending any data anywhere (Constitution VIII). The view is local output.
