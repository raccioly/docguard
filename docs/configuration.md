# Configuration

DocGuard is configured via `.docguard.json` in the project root. If no config file exists, sensible defaults are used with auto-detection.

## Full Reference

```json
{
  "projectName": "my-project",
  "version": "0.6",
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
  },
  "findingSeverity": {
    "TRC004": "low",
    "SEC001": "high"
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

`findingSeverity.<CODE>` applies the same enforcement levels to one stable
finding code and takes precedence over the validator setting. This is the
preferred control for a noisy rule because neighboring findings retain their
policy. Intrinsic errors remain blocking unless their exact code is configured.
Machine outputs preserve `severity` and add `effectiveSeverity` plus the
enforcement source so audit consumers can distinguish detection from policy.

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

## Spec-first gate — `specFirst`

`docguard specs require` (and the Action's `command: spec-first`) fails a change
to a governed path that neither names its spec nor declares an exemption.

```json
{
  "specFirst": {
    "paths": ["cli/**", "src/**"],
    "exemptKinds": ["release", "deps", "typo", "test-only"]
  }
}
```

- `paths`: glob patterns of governed paths. Default: every changed path except
  Markdown, `specs/**` and recognized test files.
- `exemptKinds`: the kinds accepted in `Spec-Exempt: <kind> — <reason>`. The
  reason is required.

## Agent instruction budget — `agentInstructions`

Agents stop reading instructions at a byte limit (Codex:
`project_doc_max_bytes`, 32 KiB). **STR004** reports an `AGENTS.md` chain (root
down to a directory; `AGENTS.override.md` replaces `AGENTS.md`) over the budget.
**STR005** reports an allowance that has slack to reclaim.

```json
{
  "agentInstructions": {
    "maxBytes": 32768,
    "allowances": { "packages/big/AGENTS.md": 40000 }
  }
}
```

`allowances` freezes existing debt per chain, keyed by the chain's deepest
instruction file: the chain may shrink, and growth past the allowance is
reported.

## Path-scoped agent rules — `validators.pathScopedRules`

The Path-Scoped-Rules validator (PSR001–PSR004) is on by default and not
applicable when the project has no agent instruction files. **PSR003** uses
the same `agentInstructions.maxBytes` for the bytes one harness loads for a
path, excluding `AGENTS.md` chains (STR004's). Its allowances are keyed by
harness, either for every path (`"claude"`) or for a group that contains a
given path (`"claude:src/web/app.tsx"`):

```json
{
  "agentInstructions": { "allowances": { "cursor:src/web/app.tsx": 40000 } },
  "validators": { "pathScopedRules": false }
}
```

Set `"pathScopedRules": false` to turn the check off. See
[`docguard rules`](commands.md#docguard-rules).

## Spec Kit checks — `specKit`

```json
{
  "specKit": {
    "phantomCheck": true,
    "untouchedClaimCheck": true
  }
}
```

- `phantomCheck: false` disables SPK008/SPK009: checked tasks whose named
  deliverables do not exist and carry no implementation evidence.
- `untouchedClaimCheck: false` disables SPK010/SPK011: checked tasks naming an
  existing path that no commit since the feature began changed. A named
  directory counts as changed when a file inside it changed.

## Doc dependency lock — `covers=` and `validators.docDependency`

The Doc-Dependency validator is on by default but has nothing to check until a
doc section declares the code it describes:

```markdown
<!-- docguard:section id=pricing source=human covers="src/pricing.mjs#discount, src/rules/**" -->
```

`docguard review --accept <doc>#<id> --reason "<what you checked>"` records the
review in `.docguard-doc-lock.json` (commit it). Set
`"validators": { "docDependency": false }` to turn the check off. See
[`docguard review`](commands.md#docguard-review).

## Doc ownership — `ownership`

Declares which doc section is responsible for which source paths. `trace
--reverse`, `review --suggest` and the MCP tool `docguard_docs_for_path` report
the owner, and the Doc-Ownership validator (OWN001–OWN007) keeps the map true.

```json
{
  "ownership": {
    "roots": ["src"],
    "entries": [
      { "doc": "docs-canonical/ARCHITECTURE.md", "section": "component-map",
        "purpose": "What each module is responsible for", "paths": ["src/**"] },
      { "doc": "docs-canonical/DATA-MODEL.md", "section": "entities",
        "purpose": "The schema", "paths": ["src/db/schema.ts"] }
    ]
  }
}
```

- `entries[].paths`: files, directories or globs. Each file has at most one
  owner: an exact path beats any glob, a longer literal directory prefix beats
  a shorter one, and any other overlap is a tie (OWN002).
- `entries[].section`: a `docguard:section` id or a heading anchor in `doc`.
- `roots`: directories whose source code must be owned (OWN001). By default,
  the top-level source modules, skipping test, fixture and example paths. A
  declared root is checked as declared.

DocGuard never writes this block; `docguard trace --owners --suggest` prints a
draft. Without it (and without `.devin/wiki.json`) the validator is not
applicable.

A committed `.devin/wiki.json` is linted against Devin's documented rules
(checked 2026-09-30): at most 30 pages, 100 notes and 10,000 characters per
note. Set `"devinWiki": { "maxPages": 80 }` on an enterprise plan.

## Code-derived diagrams — `diagrams.moduleGraph`

Shapes the `module-graph` section (see
[Diagrams drawn from code](doc-sections.md#diagrams-drawn-from-code)). All keys
are optional:

```json
{
  "diagrams": {
    "moduleGraph": { "depth": 2, "maxNodes": 30, "include": ["src"] }
  }
}
```

- `depth` (1–8, default 2): directory segments that make a module, so
  `src/api/routes.ts` belongs to `src/api`.
- `maxNodes` (2–60, default 30): the node limit before grouping and merging.
- `include`: directories to draw. Default: every product source file.

The `entity-diagram` section has no options.

## Symbol map budget — `memory.symbolMap`

`memory --pack --symbols` stops the symbol map at `memory.symbolMap.maxBytes`
bytes (default 4096, between 256 and 16384), at a whole line, and states how
many ranked files it left out. About 4 bytes stand for one token.

```json
{ "memory": { "symbolMap": { "maxBytes": 4096 } } }
```

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

Mapped paths use an explicit ownership contract for writes:

- A missing mapped target may be generated when exactly one role maps to it.
- An existing file with `<!-- docguard:generated true -->` grants DocGuard full-document ownership. Generation and mechanical whole-document repair keep their normal backup behavior.
- An existing human document grants bounded ownership only through one unique, well-formed `<!-- docguard:section id=<id> source=code -->` region. `generate --plan --write`, `sync --write`, and section regeneration may replace that region while preserving every surrounding byte.
- Missing, duplicate, nested, unclosed, or `source=human` markers reject the write before mutation. Several roles mapped to one file also reject whole-document generation.
- `--force` never grants ownership and cannot bypass these checks.

Broad legacy scaffolding such as `diagnose --auto` remains unavailable for a mapped layout because it cannot select an operation-specific owned target safely. Read-only plans identify mapped destinations without requiring ownership markers.

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

Wrangler configuration supplies static evidence for Worker classification and untyped official handler arguments; DocGuard never executes configuration or application code. With the optional Babel parser, environment extraction recognizes module-handler `env`, exported Pages `onRequest*` `context.env`, `this.env` on classes extending an entrypoint imported from `cloudflare:workers`, and `env` imported from that module. Lexical aliases are followed and shadows are excluded. Computed non-literal keys, indirect exports, user-defined lookalike classes, and other runtimes remain outside the bounded analysis. The fallback covers ordinary handler `env` scopes and reports AST-only forms as partial coverage.

### Evidence boundaries in documentation and schema scans

Documentation-coverage filename checks search supported Markdown in conventional and explicitly configured homes, mapped role files, and supported extension metadata. Configured homes extend the defaults. Excluded files, private paths and symlinks cannot satisfy a documentation reference. This search does not establish absence of an explanation in external sites, RST, or unsupported formats.

A parsed direct file-read/write call supplies stronger path evidence than a path construction or existence check. Ambiguous paths remain low-confidence review signals; a directory name alone does not establish a configuration file. The bounded detector does not resolve arbitrary import aliases or dynamic paths. Schema synchronization applies source exclusions and deduplicates overlapping roots by source file, preserving models in distinct files even when names match.

Feature requirement scoring recognizes eligible test annotations and labels using the validator parser. An arbitrary fixture string is not linkage evidence, and a recognized link is not proof of behavioral coverage. Duplicate requirement IDs across separate specifications remain a known scoping limitation.


### Requirement identity across documents

Requirement definitions are identified by repository-relative document path plus ID. A bare test annotation such as `@req FR-001` earns linkage credit only when that ID is defined in one document. When features reuse an ID, qualify the declaration: `@req specs/payments/spec.md#FR-001`. The same spelling works in a test label. Use forward slashes; an optional leading `./` is accepted. Qualifiers are exact repository-relative paths, not paths relative to the test file.

Validation and `trace --features` share definition parsing and reference resolution. A qualified reference credits only its target document. Ambiguous bare references credit neither feature and produce a review finding for each unresolved definition. A wrong qualifier is an orphan reference and never falls back to a bare match. Repeated mentions within one document do not create additional identities. Linkage remains evidence of a declaration, not proof of behavioral correctness; lifecycle and arbitrary verification-link semantics are separate concerns.
