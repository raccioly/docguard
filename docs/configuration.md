# Configuration

DocGuard is configured via `.docguard.json` in the project root. If no config file exists, sensible defaults are used with auto-detection.

## Full Reference

```json
{
  "projectName": "my-project",
  "version": "0.5",
  "profile": "standard",
  "projectType": "webapp",

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
    "needsEnvVars": true,
    "needsEnvExample": true,
    "needsE2E": true,
    "needsDatabase": true,
    "testFramework": "vitest",
    "runCommand": "npm run dev"
  },

  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "architecture": true,
    "testSpec": true,
    "security": true,
    "environment": true,
    "freshness": true
  },

  "severity": {
    "security": "high",
    "todoTracking": "low"
  },

  "collections": {
    "extractors": "src/extractors/*.py",
    "commands": "cli/commands/*.mjs"
  },

  "docs": {
    "dirs": ["reference", "website/docs"]
  }
}
```

## Profile Field

The `profile` field sets a baseline preset. User config overrides profile defaults.

| Profile | Description | Validators Enabled |
|---------|-------------|-------------------|
| `starter` | Minimal CDD — ARCHITECTURE + CHANGELOG | structure, docsSync, changelog |
| `standard` | Full CDD — all 5 canonical docs (default) | Most validators |
| `enterprise` | Strict — all docs + all validators | All validators + freshness |

See [Profiles](./profiles.md) for details.

## Validators

| Validator | Default | What It Checks |
|-----------|---------|----------------|
| `structure` | `true` | `docs-canonical/` exists, required files present, expected sections |
| `docsSync` | `true` | AGENTS.md references DocGuard workflow |
| `drift` | `true` | DRIFT-LOG.md exists and has entries when code deviates |
| `changelog` | `true` | CHANGELOG.md has [Unreleased] section, version entries |
| `architecture` | varies | Component map, layer boundaries, import graph analysis |
| `testSpec` | `true` | Test framework, coverage, critical flows documented |
| `security` | varies | Auth, secrets, RBAC documentation |
| `environment` | `true` | Setup steps, env vars, prerequisites, .env.example |
| `freshness` | varies | Docs updated recently relative to code changes (git-based) |

## Severity overrides

`severity.<validator>` changes a validator's **exit-code weight** without hiding
anything from display: `"high"` promotes its warnings to blocking (CI fails),
`"low"` demotes them (shown, but never fail the build). Valid values:
`high | medium | low`. To silence a validator entirely, use `validators.<key>: false`.

## Collections — verify documented counts against code

`collections` binds a documentation noun to a glob whose **file count is the
source of truth**. With `"extractors": "src/extractors/*.py"`, a doc claiming
"16 extractors" while the glob matches 19 files becomes a guard warning (and a
`fix --write`-able correction). Declaring the noun *is* the opt-in — no other
marker needed. Reserved nouns (`checks`, `validators`, `tests`) keep their
built-in DocGuard meaning. An unresolvable glob is skipped, never treated as 0.

## Documentation homes — `docs.dirs`

Conventional doc folders (`docs/`, `doc/`, `documentation/`, `guides/`,
`handbook/`, `manual/`, `wiki/`, Docusaurus `website/docs/`, …) are
**auto-detected** and claim-scanned without enrollment. `docs.dirs` EXTENDS
that set with non-standard homes — it never replaces auto-detection. To exclude
a conventional dir, list it in `.docguardignore`.

## Adoption baseline — `baseline`

When a committed `.docguard.baseline.json` exists (written by
`docguard guard --update-baseline`), guard/ci suppress the frozen findings
and gate only new drift. Set `"baseline": false` in `.docguard.json` to
ignore the file entirely (same as always passing `--no-baseline`):

```json
{ "baseline": false }
```

Suppression is always visible in output and in the `baselineSuppressed`
JSON field — nothing is silently hidden.

## Muting a validator

Two ways to turn a validator off, for two different intents:

| Intent | How | Renders as |
|--------|-----|-----------|
| Operational toggle (CI speed, not relevant *right now*) | `.docguard.json` → `"validators": { "testSpec": false }` | silent — disabled |
| **Intentional non-applicability** (POC with no tests, library with no auth) | inline marker in a canonical doc or `AGENTS.md`:<br>`<!-- docguard:validator testSpec n/a — POC, no automated tests yet -->` | `➖ Test-Spec [N/A] (declared N/A: …)` — visible, git-tracked |

The marker is preferred when the validator genuinely does not apply: the rationale lives next to the declaration, travels with the repo, and shows up honestly as N/A rather than a hidden skip or a fake green check. The key is the validator key from the table above (case/separator tolerant — `test-spec` works too); a mistyped key is reported as a warning rather than silently ignored. A no-tests POC typically marks both `testSpec` and `traceability` N/A.

## Project Type Detection

DocGuard auto-detects your project type from `package.json`:

| Signal | Detected Type |
|--------|--------------|
| `bin` field | `cli` |
| `next`, `react`, `vue`, `angular`, `svelte` | `webapp` |
| `express`, `fastify`, `hono`, `koa` | `api` |
| `main`, `exports`, `module` | `library` |
| `manage.py` | `webapp` (Django) |
| `pyproject.toml` | `library` (Python) |

## Project Type Defaults

| Type | Env Vars | .env.example | E2E | Database |
|------|----------|-------------|-----|----------|
| `cli` | ✗ | ✗ | ✗ | ✗ |
| `library` | ✗ | ✗ | ✗ | ✗ |
| `webapp` | ✓ | ✓ | ✓ | ✓ |
| `api` | ✓ | ✓ | ✗ | ✓ |

## Existing documentation layouts

Use explicit document roles to validate Markdown files in an existing layout. A mapping replaces the default path for that role, makes the mapped file required, and enrolls it in the canonical inventory. Missing files and content defects remain findings. No project names or framework-specific paths are required.

```json
{
  "docs": {
    "roles": {
      "architecture": "docs/design.md",
      "dataModel": "specs/data-model.md",
      "environment": "operations/setup.md",
      "apiReference": "reference/http.md"
    }
  }
}
```

Supported roles are architecture, dataModel, security, testSpec, environment, apiReference, and requirements. Paths must name Markdown files within the project; private directories, parent traversal, absolute paths, and symlink destinations are rejected. Several roles may reference one document. Each role's content checks still apply; a mapping is not a correctness attestation. Default roles remain unchanged unless explicitly mapped.

This first version supports validation, scoring, and read-only planning. Legacy automatic document generation, sync writes, and repair writes refuse custom mappings before scaffolding or modifying files. This protects existing documents while writer behavior is extended and reviewed. Read-only plans identify mapped destinations; a human or agent can review the proposed work against the existing document structure.

The docs.dirs setting extends document inventory and explicitly opts additional directories into freshness review. Inventory membership does not mean every detector checks every file. Semantic extraction covers canonical Markdown, explicitly mapped Markdown roles, README, and AGENTS within its safety and size limits; other prose remains unverified.

## Review signals and historical material

Freshness findings describe repository-history review signals with low confidence. They do not establish semantic drift or instruct automatic rewriting. After reviewing the relevant intent and implementation, record a review date or propose the appropriate code/document change.

Use an explicit historical, superseded, or deprecated status when a document records past decisions rather than current instructions:

```markdown
<!-- docguard:status historical -->
```

These statuses skip currentness assertions; they do not hide structural or other applicable findings. A filename containing ADR does not automatically exempt an active decision. Existing explicit validator/section exemptions continue to require reasons.

## Understanding check coverage

Guard JSON includes checkCoverage and an applicability record per validator. States distinguish checked, partial, disabled, not-applicable, missing-prerequisite, unsupported, no-matches, and error. A passing gate means the selected policy passed; it does not mean unsupported languages or unmatched inputs were examined. CI and reports preserve this disclosure. Python architecture analysis uses the installed Python interpreter's AST without importing project modules. It resolves unique repository-local modules in regular flat and `src/` packages plus explicit relative imports. Dynamic imports, runtime `sys.path` changes, parser failure or absence, and ambiguous modules remain partial or unsupported coverage while supported edges and findings are retained.

Wrangler configuration supplies evidence for Worker classification. Supported typed Worker bindings participate in environment extraction without executing configuration or application code. Dynamic names, alias/dataflow tracking, and unsupported forms remain outside this bounded analysis. The existing optional Babel parser resolves lexical bindings; the fallback covers ordinary tested scopes and has lower syntax coverage.

### Evidence boundaries in documentation and schema scans

Documentation-coverage filename checks search supported Markdown in conventional and explicitly configured homes, mapped role files, and supported extension metadata. Configured homes extend the defaults. Excluded files, private paths and symlinks cannot satisfy a documentation reference. This search does not establish absence of an explanation in external sites, RST, or unsupported formats.

A parsed direct file-read/write call supplies stronger path evidence than a path construction or existence check. Ambiguous paths remain low-confidence review signals; a directory name alone does not establish a configuration file. The bounded detector does not resolve arbitrary import aliases or dynamic paths. Schema synchronization applies source exclusions and deduplicates overlapping roots by source file, preserving models in distinct files even when names match.

Feature requirement scoring recognizes eligible test annotations and labels using the validator parser. An arbitrary fixture string is not linkage evidence, and a recognized link is not proof of behavioral coverage. Duplicate requirement IDs across separate specifications remain a known scoping limitation.


### Requirement identity across documents

Requirement definitions are identified by repository-relative document path plus ID. A bare test annotation such as `@req FR-001` earns linkage credit only when that ID is defined in one document. When features reuse an ID, qualify the declaration: `@req specs/payments/spec.md#FR-001`. The same spelling works in a test label. Use forward slashes; an optional leading `./` is accepted. Qualifiers are exact repository-relative paths, not paths relative to the test file.

Validation and `trace --features` share definition parsing and reference resolution. A qualified reference credits only its target document. Ambiguous bare references credit neither feature and produce a review finding for each unresolved definition. A wrong qualifier is an orphan reference and never falls back to a bare match. Repeated mentions within one document do not create additional identities. Linkage remains evidence of a declaration, not proof of behavioral correctness; lifecycle and arbitrary verification-link semantics are separate concerns.
