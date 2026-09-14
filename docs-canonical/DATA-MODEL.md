# Data Model

<!-- docguard:version 0.6.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-14 -->

| Metadata | Value |
|----------|-------|
| **Status** | ![Status](https://img.shields.io/badge/status-active-brightgreen) |
| **Version** | `0.6.0` |
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
| `$schema`, `schemaVersion` | Contract | Exact schema URL and version `1` |
| `specs[].specId` | Spec metadata | Immutable lowercase namespaced identity; never generated or reused |
| `specs[].path` | Projection | Current spec path or former path for a retired record |
| `specs[].reviewed.lifecycle` | Human review | Orthogonal approval, delivery, context, retirement reason, storage, and persistence policy |
| `specs[].reviewed.relations` | Human review | `extends`, `duplicates`, `conflictsWith`, `supersedes`, and `supersededBy` spec-ID edges |
| `specs[].reviewed.scope.canonicalDocs` | Human review | Canonical documents affected by the specification |
| `specs[].reviewed.reconciliation.lastReviewedRevision` | Human review | Exact Git revision whose doc impact was reviewed, or `null` |
| `specs[].intent.requirements` | Projection | `specId#requirementId` identities parsed from the active spec |
| `specs[].observed.artifacts` | Projection | Paths and SHA-256 content identities for spec, plan, and tasks |
| `specs[].observed.taskCompletion` | Projection | Checked and total Markdown task boxes; not proof of delivery |
| `specs[].observed.testEvidence` | Projection | Explicitly spec-qualified test annotations or labels only |
| `tombstones[]` | Recovery projection | Retired identities linked to source revision, blob, retention ref, object format, and recoverability |

`docguard specs --write` regenerates only projected fields and preserves the
entire `reviewed` block. Unknown reviewed fields, invalid lifecycle values,
duplicate identities, and archive/storage contradictions fail closed. The
output omits timestamps and sorts unordered collections, so `specs --check`
can compare a byte-stable result in CI.

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
| `findings` | `object[]` | Stable code, validator, severity, confidence, location, message, suggestion |
| `passed`, `total` | `number` | Applicable check counts |
| `errors`, `warnings` | `string[]` | Compatibility message arrays |
| `applicable` | `boolean` | Optional applicability indicator; false becomes N/A |

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
| 0.6.0 | 2026-09-14 | DocGuard Team | Add the document-retirement recovery manifest, retained-ref proof, and retired requirement tombstones |
| 0.4.0 | 2026-03-13 | DocGuard Team | Complete rewrite — documented all config formats, output schemas, metadata headers |
| 0.1.0 | 2026-03-13 | DocGuard Generate | Auto-generated skeleton |

## Score assurance contract

The numeric CDD score estimates structural maturity. Factual accuracy and regulatory assurance require separate evidence. Existing score and grade thresholds remain stable. Score JSON identifies its scope as `structural-maturity`. `memory.accuracy` is nullable: `null` represents unverified factual accuracy; the former proxy is exposed as `memory.structuralAlignment`. Consumers must preserve null as an unknown value.

An `assurance` object accompanies score, diagnose, CI, and report output. It contains `status` (`unverified`), `factualAccuracy` (`null`), and `unverifiedClaims` (a count of extracted candidates, or null if extraction failed). Even zero extracted candidates leaves prose unverified. Claim discovery uses a bounded heuristic. These fields explain evidence limits while existing CI thresholds retain their numeric meaning.

## Feedback contribution contract

`feedback` defaults to uncertain findings. `--code <CODE>` selects a finding regardless of confidence; `--all` includes all active findings. `--preview` emits reviewable output and skips feedback-record writes. Unknown codes fail with a clear error. Shared issue URLs contain only allowlisted finding identity, tool version, and contribution instructions. Source-derived messages, paths, snippets, and suggestions stay in the local record. Each result includes a search URL covering existing issues and pull requests, including closed work, so contributors can check for duplicates before submitting. The user controls submission through the reviewed issue draft.

## Check coverage and document roles

Each guard validator adds applicability with status and reason. checkCoverage contains counts by status, limitations naming checks that were not fully performed, and an explanatory limitation. These fields describe coverage independently from legacy status, totals, findings, and exit codes. CI/report consumers preserve them, including disabled-check counts.

Optional docs.roles maps canonical roles to safe project-relative Markdown paths. Configuration normalization replaces each mapped default in requiredFiles.canonical and documentTypes. Read-only callers accept the normalized mapping. Legacy document writers reject custom mappings until write semantics support existing layouts safely. The configuration schema and docs/configuration.md define the current role names and supported operations.
