# Implementation Plan: DORA Evidence

**Spec**: [spec.md](spec.md) · **Spec ID**: `docguard.dora-evidence`

## Summary

`score --dora` maps facts DocGuard already computes onto DORA's eight documentation-quality items and its AI Capabilities Model. It labels each item deterministic, proxy or survey-only, and never feeds the CDD score. The MCP `docguard_docs_for_path` tool gains a per-document `docs` map with lifecycle, plus open findings from a cache for the current tree state.

## Technical Context

- Node ESM, zero new dependencies.
- A display-only view of `score`, the same way ALCOA+ and Agent Readability are already rendered (`cli/commands/score.mjs`). The CDD score and grade are computed before the view and never read from it.
- Nothing in it is a new detector. Every number is read from an existing function.

## Constitution Check

- **Read-only**: `score --dora` writes nothing.
- **Local only** (VIII): it makes no network call.
- **Honest evidence**: `null` with a reason, never 0, and `measure` says when a score is a proxy.
- **No exit-code change**: `score` exits as before. Guard is untouched.

## Design

### `cli/commands/score-dora.mjs` (new)

`computeDoraEvidence(projectDir, config, { scores, agentRead })` returns the `dora` object. The two inputs are computed once by `runScore` and reused, not recomputed.

**Documentation items**:

| id | Source |
|---|---|
| `reliable` | `docguard memory`'s overall accuracy over its four domains (`diffRoutes`, `diffEntities`, `diffEnvVars`, `diffTechStack`): matched ÷ (matched + only in docs + only in code), the same number `memory` shows |
| `easy-to-understand` | `scores.docQuality`, a proxy |
| `easy-to-find` | the mean of Agent Readability's `addressability` and `llms-txt` metrics, plus whether an ownership map exists |
| `code-documented` | the memory domains, matched ÷ (matched + only-in-code), for routes, entities and environment variables |
| `well-organized` | `scores.structure` |
| `updated-with-changes` | `docLockStatus`: `current` ÷ covered sections. With no covered sections, `scores.drift` stands in as a proxy |
| `reflects-capabilities` | documented routes and stack facts backed by code: matched ÷ (matched + only in docs), over endpoints and the tech stack |
| `used-in-incidents` | a tracked Markdown file whose name or H1 says runbook, troubleshooting, incident or playbook. 100 when present with a heading per scenario, 50 when present, 0 when absent; a proxy |

`_domainAccuracy` in `memory.mjs` is exported as `domainAccuracy`, so `memory` and `dora` share one definition of a match.

**AI capabilities**:
- `ai-accessible-data`: the mean of Agent Readability's score and documented-fact accuracy. Evidence lists:
  - a DocGuard MCP entry in `.mcp.json`, `.cursor/mcp.json` or `.vscode/mcp.json`;
  - agent instruction lines that point at retired or superseded docs (from `parseLifecycleStatus`).
- `small-batches`: `git log --since=90.days --no-merges --name-only --format=%x00%H` through `runGit` (spec 081 gaps apply). It reports:
  - the median number of files per commit;
  - the share of commits over 20 files;
  - a score of 100 when the share is ≤ 5%, falling linearly to 0 at 50%.
- `version-control`: four checks against `git ls-files`:
  - code: a source file;
  - configuration: a config-shaped file such as `*.json`, `*.yaml`, `*.toml` or `.env.example`;
  - build: a package manifest, Makefile, Dockerfile or `.github/workflows`;
  - infrastructure configuration: `*.tf`, `cdk.json`, `serverless.yml`, Kubernetes manifests, `Pulumi.yaml`, `template.yaml`, compose files and platform deploy configs.

  The score is the share of the first three present. Infrastructure configuration is evidence only. A repository without it may be a library, or an application whose infrastructure lives elsewhere, and nothing in the repository tells the two apart. (Treating a Dockerfile as a deploy signal would have scored this CLI's own image build as missing IaC.)
- `ai-stance`: a proxy. The agent entry file exists (50), and it holds a "must"/"never"/"do not" rule or a section on permissions or boundaries (50).
- `user-centric-focus`, `healthy-data-ecosystem` and `quality-internal-platform`: `survey-only`, with a `null` score and a note.

### `score` wiring

- Add the `--dora` flag to `cli/docguard.mjs`: the flag parser, usage and help.
- In `runScore`:
  - JSON output gets `dora` only when `flags.dora` is set;
  - human output gets a section after ALCOA+;
  - Agent Readability is computed once and passed in.

### MCP `docs` map (FR-005)

`docsForPath` builds `docs` from the distinct referencing documents. It lists under `lifecycle` only the documents whose `parseLifecycleStatus` is not active, normalized to `superseded` or `retired`, or else the raw status. It states `findingsBasis` once. The first version listed every document with all three fields, which put `docguard_docs_for_path` 22% over its byte budget.

`openFindings` is filled only when `.docguard/sensor-cache.json` has a `key` equal to `treeKey(projectDir)`. That requires the sensor cache to keep the location of every finding, not only the first 20:
- `runSensor` stores `fileCodes: { [file]: [code, …] }` beside the cached result;
- the sensor's stdout line is unchanged.

`treeKey` already exists in `sensor.mjs`. It costs a `git status`, and only runs when the cache file exists.

### Schema

`schemas/docguard-dora.schema.json`, draft 2020-12, describing `dora`. A test validates real output against it, using the repository's existing minimal schema checker (from the config-schema tests).

## Project Structure

- New:
  - `cli/commands/score-dora.mjs`
  - `schemas/docguard-dora.schema.json`
  - `tests/dora-evidence.test.mjs`
- Changed:
  - `cli/commands/score.mjs`
  - `cli/commands/memory.mjs` (export)
  - `cli/docguard.mjs`
  - `cli/scanners/doc-references.mjs`
  - `cli/commands/sensor.mjs`
  - `docs/commands.md`
  - `docs/ai-integration.md`
  - `docs-canonical/{ARCHITECTURE,DATA-MODEL,TEST-SPEC}.md`
  - `CHANGELOG.md`

## Risks

- **`score` runs memory diffs only under `--dora`.** That cost lands only on the opt-in flag.
- **MCP byte budget**: one small object per referencing document. Checked with `tools/budget.mjs`.
