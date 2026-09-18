# Data Model

<!-- docguard:version 0.9.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-15 -->

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.9.0` |
| **Database** | None — DocGuard is a stateless CLI tool |
| **Storage** | File-system only (reads project files, writes generated docs) |

---

## Entities

DocGuard uses filesystem artifacts for configuration, optional caches, and history. Commands read project files and produce structured output. The "data model" consists of the configuration schemas, validator output formats, and document metadata structures documented below. All data is file-system based — DocGuard reads `.docguard.json`, scans the project directory, and validates canonical documents against the codebase.

## Configuration: `.docguard.json`

The primary data structure. Controls all CLI behavior.

### Identity and required files

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectName` | `string` | No | Inferred from `package.json` name or directory | Display name for reports |
| `version` | `string` | No | `"0.1"` | Config schema version |
| `projectType` | `string` | No | Auto-detected | One of: `cli`, `webapp`, `api`, `library`, `monorepo` |
| `requiredFiles.canonical` | `string[]` | No | 5 docs-canonical files | Paths to required CDD documents |
| `requiredFiles.agentFile` | `string[]` | No | `["AGENTS.md", "CLAUDE.md"]` | AI agent config file options |
| `requiredFiles.changelog` | `string` | No | `"CHANGELOG.md"` | Changelog file path |
| `requiredFiles.driftLog` | `string` | No | `"DRIFT-LOG.md"` | Drift log file path |

### Project-type behavior

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `projectTypeConfig.needsEnvVars` | `boolean` | No | `true` | Whether ENVIRONMENT.md should check for env var docs |
| `projectTypeConfig.needsEnvExample` | `boolean` | No | `true` | Whether `.env.example` is expected |
| `projectTypeConfig.needsE2E` | `boolean` | No | `true` | Whether E2E test docs are expected |
| `projectTypeConfig.needsDatabase` | `boolean` | No | `true` | Whether DATA-MODEL should expect entity docs |
| `projectTypeConfig.testFramework` | `string` | No | Auto-detected | Test framework name (e.g., `"node:test"`, `"jest"`) |
| `projectTypeConfig.runCommand` | `string` | No | Auto-detected | Command to run the project |

### Validator tuning

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `validators.*` | `boolean` | No | `true` | Enable/disable individual validators |
| `collections.*` | `string` (glob) | No | — | Binds a documentation noun to a code collection: `"extractors": "src/extractors/*.py"` lets Metrics-Consistency flag a documented count that disagrees with the file count |
| `docs.dirs` | `string[]` | No | Auto-detected | EXTENDS the auto-detected documentation homes (docs/, documentation/, guides/, …) with non-standard dirs; exclude via `.docguardignore` |
| `severity.*` | `"high" \| "medium" \| "low"` | No | `"medium"` | Per-validator exit-code weight — `high` promotes warnings to blocking, `low` demotes them (display unchanged) |
| `findingSeverity.<CODE>` | `"high" \| "medium" \| "low"` | No | — | Exact stable-code enforcement; takes precedence over validator policy. Intrinsic errors require an exact code entry to be demoted. |

### Example Configuration

```json
{
  "projectName": "docguard",
  "version": "0.3",
  "projectType": "cli",
  "requiredFiles": {
    "canonical": [
      "docs-canonical/ARCHITECTURE.md",
      "docs-canonical/DATA-MODEL.md",
      "docs-canonical/SECURITY.md",
      "docs-canonical/TEST-SPEC.md",
      "docs-canonical/ENVIRONMENT.md"
    ],
    "agentFile": ["AGENTS.md", "CLAUDE.md"],
    "changelog": "CHANGELOG.md",
    "driftLog": "DRIFT-LOG.md"
  },
  "projectTypeConfig": {
    "needsEnvVars": false,
    "needsE2E": false,
    "needsDatabase": false,
    "testFramework": "node:test"
  },
  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "architecture": false,
    "testSpec": true,
    "security": false,
    "environment": true,
    "freshness": true
  }
}
```

## Retirement Manifest: `.docguard-archive.json`

The manifest is an append-only recovery ledger for documentation removed from
active context by `docguard retire`. Git content remains authoritative; the
manifest stores no retired prose.

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `number` | Manifest contract version; currently `1` |
| `strategy` | `"git-history"` | Recovery storage strategy |
| `entries[].path` | `string` | Former repository-relative document path |
| `entries[].archivedAt` | ISO timestamp | Historical field name for retirement time |
| `entries[].archivedFrom` | Git object ID | Source revision containing the exact document |
| `entries[].blob` | Git object ID | Exact retired content identity; length follows repository object format |
| `entries[].reason` | `string` | Reviewed retirement rationale |
| `entries[].supersededBy` | `string` | Optional current replacement document |
| `entries[].evidence` | `string[]` | Optional clean documents containing consolidated outcomes |
| `entries[].requirementIds` | `string[]` | Requirement identities declared by the retired file; traceability keeps them as tombstones and never treats them as active requirements |
| `entries[].retentionRef` | `string` | Branch ref proven to contain the source revision |
| `entries[].objectFormat` | `"sha1" \| "sha256"` | Git repository object format |
| `entries[].recoverability` | `"verified"` | Result of the retained-ref ancestor check at retirement time |
| `entries[].restore` | `string` | Convenience command derived from structured source/path fields |

Existing manifests may carry one shared top-level `retention` record for a
batch created before per-entry retention metadata was introduced. The spec
registry projects both forms into one normalized tombstone model. Lifecycle
and traceability consumers reject incomplete recovery entries; an unverified
manifest cannot suppress active-context or orphan-reference findings.

## Spec Lifecycle Registry: `.docguard-specs.json`

The committed registry indexes which specifications govern the project and what
the repository can prove about them. It never copies requirement prose. Its
normative JSON Schema is `schemas/docguard-specs.schema.json`.

| Field | Authority | Description |
|-------|-----------|-------------|
| `$schema`, `schemaVersion` | Contract | Exact schema URL and version `2`; version 1 is read for migration and projects stale until refreshed |
| `specs[].specId` | Spec metadata | Immutable lowercase namespaced identity; never generated or reused |
| `specs[].path` | Projection | Current spec path or former path for a retired record |
| `specs[].reviewed.lifecycle` | Human review | Orthogonal approval, delivery, context, retirement reason, storage, and persistence policy |
| `specs[].reviewed.relations` | Human review | `extends`, `duplicates`, `conflictsWith`, `supersedes`, and `supersededBy` spec-ID edges |
| `specs[].reviewed.scope.canonicalDocs` | Human review | Canonical documents affected by the specification |
| `specs[].reviewed.reconciliation.lastReviewedRevision` | Human review | Exact Git revision whose doc impact was reviewed, or `null` |
| `specs[].reviewed.reconciliation.outcomes` | Human review | Up to 20 reviewed implementation outcomes with revision, bounded rationale, evidence paths, deviations, and optional successor |
| `specs[].intent.requirements` | Projection | `specId#requirementId` identities parsed from the active spec |
| `specs[].observed.artifacts` | Projection | Paths and SHA-256 content identities for spec, plan, and tasks |
| `specs[].observed.taskCompletion` | Projection | Checked and total Markdown task boxes; not proof of delivery |
| `specs[].observed.testEvidence` | Projection | Explicitly spec-qualified test annotations or labels only |
| `specs[].observed.implementationEvidence` | Projection | Explicit `@implements specId#requirementId` source annotations only; names and proximity do not earn completion credit |
| `tombstones[]` | Recovery projection | Retired identities linked to source revision, blob, retention ref, object format, and recoverability |

`docguard specs --write` regenerates only projected fields and preserves the
entire `reviewed` block. Unknown reviewed fields, invalid lifecycle values,
duplicate identities, and archive/storage contradictions fail closed. The
output omits timestamps and sorts unordered collections, so `specs --check`
can compare a byte-stable result in CI. A non-current projection exposes up to
25 bounded `differences` with a JSON-style field path, kind, and explanation.
Order-only differences use kind `order`; changed, missing, and unexpected
content remain distinct. Additional differences are reported as truncated.

`docguard specs complete` requires a clean Git revision, coverage for every
requirement through qualified implementation or test evidence, existing affected
canonical documents, a supported reconciliation plan, and a guard result without
errors. Declared task ledgers must be non-empty and fully checked. An approved
`living` verification contract may omit the task ledger because its qualified
requirement evidence is the durable completion proof; other persistence models
still require one. Its staged transaction updates the bounded outcome,
registry, feature-spec outcome index, and `.docguard/current-context.json` as one
validated set. The context file contains pointers and content hashes rather than
copying governing prose, and excludes every retired spec. A verified or released
living spec can append a status-preserving maintenance outcome only when a new
linked source, test, canonical document, or decision changed after the last
reviewed revision. Generated registry and outcome updates do not satisfy that
gate.

## Task Context Packet

`docguard agent --task <text> --format json` emits a transient
`docguard.task-context` object governed by
`schemas/docguard-task-context.schema.json`. The command does not persist the
task or packet.

| Field | Description |
|-------|-------------|
| `task.digest`, `task.characters` | Normalized task identity and bounded length; raw task text is omitted |
| `provenance.git`, `provenance.registry` | Captured Git and lifecycle-registry state |
| `assurance` | Retrieval-only scope, unknown factual accuracy, and unverified status |
| `selection` | Targeted or abstained state, threshold, candidate/omission counts, excluded lifecycle documents, and fixed budgets |
| `excerpts[]` | Repository-relative path, line range, content/file hashes, kind, optional spec ID, score, reasons, and bounded content |
| `pointers[]` | Safe task, cited-source, implementation, or test paths with hashes and qualified requirements |
| `verification[]` | Commands and purposes that still need execution |
| `navigation` | Safe canonical-document inventory and approved current spec paths |
| `limitations`, `coreDigest` | Explicit epistemic limits and deterministic packet-core identity |

Selection reads at most 32 documents and 256 chunks, emits at most six
16-line excerpts totaling 6,000 characters and eight pointers, and limits task
input to 2,000 characters. An abstention emits no excerpts or pointers.

## Document Metadata Headers

Every CDD document includes DocGuard metadata as HTML comments at the top:

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `docguard:version` | `string` | Yes | Semantic version of the document |
| `docguard:status` | `string` | Yes | One of: `draft`, `active`, `deprecated` |
| `docguard:last-reviewed` | `string` | Yes | ISO date (`YYYY-MM-DD`) |
| `docguard:generated` | `boolean` | No | `true` if auto-generated by DocGuard |

### Example Metadata Header

```markdown
<!-- docguard:version 0.4.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-03-13 -->
```

## Validator Output Format

Validators emit findings and aggregate counts. The guard adapter adds names and statuses:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Validator name (e.g., `"structure"`, `"changelog"`) |
| `status` | `string` | `"pass"`, `"warn"`, or `"fail"` |
| `findings` | `object[]` | Stable code, validator, intrinsic `severity`, `effectiveSeverity`, enforcement source/key, confidence, location, message, and normalized suggestion |
| `passed`, `total` | `number` | Applicable check counts |
| `errors`, `warnings` | `string[]` | Compatibility message arrays |
| `applicable` | `boolean` | Optional applicability indicator; false becomes N/A |
| `effectiveErrors`, `effectiveWarnings`, `effectiveInfos` | `number` | Exit-code counts after exact-code and validator policy |
| `effectiveStatus` | `string` | Per-validator `pass`, `warn`, or `fail` after policy; intrinsic `status` remains available |

## Precision evidence contract

`guard` results carry `precisionEvidence`, scoped to the finding codes that run emitted (`schemas/docguard-precision-evidence.schema.json`). The unit of evidence is the finding code. DocGuard defines many more codes than the reviewed corpus measures, so a code the corpus never exercised reports `status: "not-measured"`, carries no ratio, and never inherits the measured precision of another code in the same validator. A measured code whose own precision denominator is below `minN` is marked `quotable: false` with a reason, and may carry a `backoff` to a coarser measured tier that names that tier (`validator` or `aggregate`). `measures` is always `benchmark-precision`; `caveat` is the sentence a consumer must show beside any quoted ratio; `source.matchesRunningVersion` is false when the numbers were measured on a different build than the one reporting them. `coverage` counts codes in the run by measurement status.

The block is served from `cli/precision-evidence-data.mjs`, a generated module derived from `benchmarks/baseline.json` by `npm run generate:precision-evidence`, because `benchmarks/` is not part of the published package. A test compares the committed module against that projection, so a stale number fails the suite rather than shipping. Findings themselves are unchanged: they are written verbatim into feedback records, so their shape stays fixed.

## Fix Command Issue Format

The `fix --format json` output follows this structure:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `"clean"` or `"issues-found"` |
| `project` | `string` | Project name |
| `projectType` | `string` | Detected project type |
| `issueCount` | `number` | Total issues found |
| `autoFixable` | `number` | Issues fixable by `--auto` |
| `issues[].type` | `string` | `"missing-file"`, `"empty-doc"`, `"partial-doc"`, `"missing-config"` |
| `issues[].severity` | `string` | `"error"`, `"warning"`, `"info"` |
| `issues[].file` | `string` | Affected file path |
| `issues[].autoFixable` | `boolean` | Can be auto-fixed |
| `issues[].fix.action` | `string` | `"create"`, `"rewrite"`, `"improve"` |
| `issues[].fix.ai_instruction` | `string` | AI-actionable fix instruction |

## Score Output Format

The `score --format json` output:

| Field | Type | Description |
|-------|------|-------------|
| `score` | `number` | CDD maturity score (0-100) |
| `grade` | `string` | Letter grade: `A+`, `A`, `B`, `C`, `D`, `F` |
| `categories` | `object` | Per-category score, weight, weighted contribution, and axis |
| `scoreKind` | `string` | `structural-maturity` |
| `assurance` | `object` | Factual accuracy remains unverified; extracted candidate count is heuristic |
| `memory` | `object` | Completeness and structural alignment proxies; accuracy is null |

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.9.0 | 2026-09-15 | DocGuard Team | Add bounded field-level spec-registry differences and direct evidence verification exit semantics |
| 0.6.0 | 2026-09-14 | DocGuard Team | Add the document-retirement recovery manifest, retained-ref proof, and retired requirement tombstones |
| 0.4.0 | 2026-03-13 | DocGuard Team | Complete rewrite — documented all config formats, output schemas, metadata headers |
| 0.1.0 | 2026-03-13 | DocGuard Generate | Auto-generated skeleton |

## Score assurance contract

The numeric CDD score estimates structural maturity. Factual accuracy and regulatory assurance require separate evidence. Existing score and grade thresholds remain stable. Score JSON identifies its scope as `structural-maturity`. `memory.accuracy` is nullable: `null` represents unverified factual accuracy; the former proxy is exposed as `memory.structuralAlignment`. Consumers must preserve null as an unknown value.

An `assurance` object accompanies score, diagnose, CI, and report output. It contains `status` (`unverified`), `factualAccuracy` (`null`), and `unverifiedClaims` (a count of extracted candidates, or null if extraction failed). Even zero extracted candidates leaves prose unverified. Claim discovery uses a bounded heuristic. These fields explain evidence limits while existing CI thresholds retain their numeric meaning.

## Evidence verification contract: `.docguard-evidence.json`

The optional version-1 manifest contains at most 128 declarations. Each immutable
ID owns an `always` applicability declaration, one Markdown target, one source,
and one compatible predicate. Unknown fields, duplicate IDs, unsafe paths, and
ambiguous predicate combinations invalidate the manifest.

| Source adapter | Required contract | Compatible predicate |
|---|---|---|
| `json-pointer` | Safe JSON file plus an RFC 6901 pointer | `equals` with an explicit JSON type, or `set-equals` for a duplicate-free string array |
| `collection-count` | One bounded repository-relative glob and explicit `allowEmpty` policy | `count-equals` |
| `python-literal-count` | Safe `.py` path, one ASCII module-level symbol, one uniquely assigned static list/tuple/set/dict literal, and explicit `allowEmpty` policy | `count-equals` |
| `oasdiff` | Saved bounded JSON array, adapter version, producer version, `breaking` or `changelog` command, and current input hashes | `no-findings` |
| `buf` | Saved bounded JSON Lines, adapter version, producer version, `breaking` command, and current input hashes | `no-findings` |

Every result contains the declaration ID, stable claim and evidence identities,
document location, adapter, predicate, captured input hashes, evidence hash,
reason code, and scope limitation. The state is exactly one of
`verified-within-scope`, `contradicted`, `stale`, `inconclusive`, or
`unsupported`. Line movement and unrelated file edits preserve identity;
changes to the selected statement, declaration, source, report, producer
metadata, or declared inputs invalidate it. A verified declaration removes a
heuristic claim from the unverified count only through a unique same-line,
same-value match.

`docguard verify --evidence` exits `0` for `verified-within-scope` and for an
unconfigured manifest, `2` for `attention-required` (stale, inconclusive, or
unsupported evidence), and `1` for `contradicted` or `invalid`. The JSON status
and process status therefore carry the same enforcement meaning in direct CI use.

## Feedback contribution contract

`feedback` defaults to uncertain findings. `--code <CODE>` selects a finding regardless of confidence; `--all` includes all active findings. Classifications are `false_positive`, `false_negative`, `unsupported_syntax`, `ambiguous`, and `policy_disagreement`. False-negative and unsupported intake require a strict synthetic fixture manifest with an exact expected identity, explicit interestingness predicate, same-path opposite control, parser tier, bounded configuration, and synthetic/redaction attestations.

`--fixture-manifest` verifies the reproduction and its control in separate temporary projects. `--reduce` removes fixture lines in deterministic order only while the declared predicate remains true. Duplicate identity hashes detector code, classification, parser tier, and normalized synthetic shape; preview returns all/open/closed GitHub searches and never submits. `--contribution tests/<name>.test.mjs` requires test-only, scope, and benchmark-delta evidence before writing a generated regression test. `--preview` skips every local write.

## Precision benchmark contract

`benchmarks/corpus.json` is a strict versioned manifest. Cases carry immutable ID, split, repository and causal groups, parser tier, classification, exact source revision or fixture digest, bounded config, scoped expected/forbidden identities, mutation preconditions, opposite control, and repair outcome. `benchmarks/baseline.json` is a strict envelope (`schemas/docguard-benchmark-baseline.schema.json`, envelope `schemaVersion` 2 around core `schemaVersion` 1) storing the reviewed deterministic core, grouped metrics, Wilson 95% confidence bounds, and separately identified environment/timing observations. Zero denominators remain `null`. The `review` block carries provenance: `status` (`candidate` from `--write-baseline`, `reviewed` only with `reviewedAt` and `reviewer`), `methodology`, `limitations`, `measures` (always `benchmark-precision` — never a calibrated probability), and `caveat`, the sentence a consumer must show beside any quoted ratio. `caveat` and `core.metrics` are derived from `core.cases`; `benchmarks/lib/baseline.mjs` recomputes both on load and rejects an envelope where either disagrees, an envelope with unknown fields, unsorted cases, or the pre-provenance `schemaVersion` 1 shape. Every run report also carries `provenance.{measures,caveat}` and `selection.{split,includeExternal,caseIds}`. Baseline comparison fails on case removal, new false positives, new false negatives, or new supported-case abstention even when aggregate warning count improves; baseline cases outside the run's selection (for example pinned public cases in a network-free run) are listed under `outOfSelection` and are not counted as removed.

## Check coverage and document roles

Each guard validator adds applicability with status and reason. checkCoverage contains counts by status, limitations naming checks that were not fully performed, and an explanatory limitation. These fields describe coverage independently from legacy status, totals, findings, and exit codes. CI/report consumers preserve them, including disabled-check counts.

Optional docs.roles maps canonical roles to safe project-relative Markdown paths. Configuration normalization replaces each mapped default in requiredFiles.canonical and documentTypes. A mapped write is authorized either for a unique `source=code` section in an existing human file or for a missing/explicitly generated single-role whole document. Marker shape, role cardinality, and ownership are validated before mutation; `--force` does not alter that model. The configuration schema and docs/configuration.md define the role names and operation-specific contract.

Repository-root guidance is an ephemeral diagnostic and is never persisted in
project configuration. Its machine shape is
`{selectedDir,suggestedDir,reason,evidence,packagePath,gitRoot,rerun,automaticScopeChange}`.
`reason` is `ancestor_docguard_config`, `npm_workspace`, or `pnpm_workspace`;
`automaticScopeChange` is always false. Machine modes wrap it with type
`docguard.repository-root-guidance` on stderr so their primary stdout schema is
unchanged.

## Readiness assessment contract

CI, diagnose, and report include `assessment`. Its status is `BLOCKED` when
guard enforcement fails, a configured structural threshold fails, or CI is set
to block warnings; `ATTENTION` means advisory guard warnings remain; `READY`
means guard and configured gates pass. The object carries reason codes, raw
guard status, effective finding counts, structural maturity, and threshold
state. It does not replace legacy status, score, grade, assurance, or exit-code
fields.
