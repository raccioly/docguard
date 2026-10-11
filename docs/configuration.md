---
title: Configuration
parent: Reference
nav_order: 2
---

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
  },
  "ignore": ["generated/"],
  "securityIgnore": ["tests/fixtures/"],
  "suppressions": { "requireReason": false }
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
| `structure` | `true` | `docs-canonical/` exists, required files present (STR001, STR002, STR004, STR005) |
| `docSections` | follows `structure` | Each canonical doc has its expected sections (STR003). Reported as its own result, key `docSections` with `parent: "structure"`; until a config names `docSections`, `validators.structure`, `severity.structure` and a `structure` N/A marker apply to it as before |
| `docsSync` | `true` | AGENTS.md references DocGuard workflow |
| `drift` | `true` | DRIFT-LOG.md exists and has entries when code deviates |
| `changelog` | `true` | CHANGELOG.md has [Unreleased] section, version entries |
| `architecture` | varies | Component map, layer boundaries, import graph analysis |
| `testSpec` | `true` | Test framework, coverage, critical flows documented |
| `security` | varies | Auth, secrets, RBAC documentation |
| `environment` | `true` | Setup steps, env vars, prerequisites, .env.example |
| `freshness` | varies | Docs updated recently relative to code changes (git-based) |
| `suppressions` | `true` | `.docguardignore` entries that expired (IGN001), cannot be read (IGN003), or have no reason while `suppressions.requireReason` is set (IGN002) |
| `requirementAnchors` | `true` | Reviewed code→requirement links whose code (ANC001) or requirement (ANC002) changed, reviewed links whose tag is gone (ANC003), an unreadable anchor lock (ANC005, error), tags citing an undeclared (ANC007) or retired (ANC008) requirement, lock merge conflicts (ANC009), and files read below their exact tier (ANC010). Not applicable until `.docguard-anchor-lock.jsonl` exists or `anchors.enabled` is set |

## Severity overrides

`severity.<validator>` changes a validator's **exit-code weight** without hiding
anything from display: `"high"` promotes its warnings to blocking (CI fails),
`"low"` demotes them (shown, but never fail the build). Valid values:
`high | medium | low`. To silence a validator entirely, use `validators.<key>: false`.

`findingSeverity.<CODE>` applies the same enforcement levels to one stable
finding code and takes precedence over the validator setting. This is the
preferred control for a noisy rule because neighboring findings retain their
policy. Intrinsic errors remain blocking unless their exact code is configured.
A few codes are informational by default (`STR005`); validator severity leaves
them informational, and `findingSeverity.<CODE>` can still promote them.
Machine outputs preserve `severity` and add `effectiveSeverity` plus the
enforcement source so audit consumers can distinguish detection from policy.

## Test files — `testPatterns`

DocGuard finds test files named `*.test.*` or `*.spec.*` on its own. When
yours follow another convention, list globs for them:

```json
{ "testPatterns": ["test_*.mjs", "tests/**/test_*.py"] }
```

`testPattern` (one string) is the older form and is merged into the list. The
patterns apply to both sides of Test Files drift (DDF002): files on disk that
match are tests, and a backticked name in TEST-SPEC.md that matches is a
documented test. A bare file name such as `test_bot.mjs` is compared with the
pattern's last segment, so `tests/**/test_*.py` accepts `test_api.py`.

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

## Excluding paths — `.docguardignore`

`.docguardignore`, at the project root, lists paths no validator should read.
One pattern per line, gitignore-style: `#` at the start of a line is a comment,
blank lines are skipped, and a pattern matches at a path-segment boundary at
any depth (`fixtures/` excludes `fixtures/` and `packages/a/fixtures/`).

Pattern syntax, shared by `.docguardignore` and every `.docguard.json` array
below:

| Syntax | Meaning |
|---|---|
| `*` | Any characters except `/` |
| `?` | One character except `/` |
| `[abc]`, `[a-z]`, `[!abc]` / `[^abc]` | One character from (or, negated, not from) the set; never `/`. An unclosed `[` is a literal `[`. POSIX classes such as `[[:alpha:]]` are not supported |
| `**/` at the start or after `/` | Zero or more directories: `**/fixtures/**` excludes `fixtures/x` and `a/fixtures/x`; `a/**/b` excludes `a/b` and `a/x/y/b` |
| `/**` at the end | Everything inside |
| Any other `**` (`a**`) | Any characters, `/` included |
| `\x` | The literal character `x` (`\*.md` is the file `*.md`) |
| Leading `/` | Anchors to the project root: `/build` excludes `build/` but not `src/build/` |
| Trailing `/` | Dropped: `dir/` also excludes a file named `dir` |
| Anything else | Literal, including `( ) + ^ $ \| { } .` (no `{a,b}` alternation) |

Unlike gitignore, a slash in the middle does not anchor (`docs/old` also
excludes `site/docs/old`), and a leading `!` is a literal character: negation is
not supported. Before v0.44, `?`, `[`, `(`, `+`, `|` and the other regular
expression characters were passed through unescaped (`a|b` was read as an
alternation and excluded unrelated paths, and an unclosed `[` made the checks
that read the ignore list fail with a regular-expression error), and `**/x` did
not match a top-level `x`. A pattern without those
characters and without `**/` matches exactly what it matched before.

An entry can say why it exists and when it ends:

```gitignore
# pattern            [expires:YYYY-MM-DD]   [# reason]
build/                                      # generated output of the build
src/legacy/**        expires:2026-12-31     # removed with the v2 API
docs/archive/
```

- **Reason.** Text after a `#` that follows whitespace. A `#` inside a pattern
  (`C#/`, `notes#1.md`) is still part of the pattern.
- **Expiry.** `expires:YYYY-MM-DD` as the last word before the reason. The
  entry applies through the end of that day (UTC). From the next day it
  excludes nothing, and guard reports IGN001 so you can renew or delete it.
- **Unreadable expiry.** A date that is not a real `YYYY-MM-DD` day (for
  example `expires:2026-02-30`), or a line with an expiry or reason and no
  pattern, excludes nothing and is reported as IGN003: DocGuard cannot tell
  when it should end.

A line with no whitespace-then-`#` and no trailing `expires:` word means exactly
what it meant before v0.44. One that has them was read before as a pattern
containing that text, which matched nothing.

To require a reason on every entry:

```json
{ "suppressions": { "requireReason": true } }
```

Guard then reports IGN002 for each entry without one. The entry still applies.
Raise it to blocking with `"findingSeverity": { "IGN002": "high" }`.

`.docguard.json` has its own arrays: `ignore` (every validator; merged with
`.docguardignore` at load), `securityIgnore` (Security only) and `todoIgnore`
(TODO-Tracking only), and `documentLifecycle` (paths the Document-Lifecycle
check skips when it looks for terminal-status documents and completed specs).
They hold plain patterns and cannot carry a reason or an expiry;
`suppressions.requireReason` does not apply to them.

`docguard ignore` lists every suppression the project has, including inline
pragmas, N/A markers and the baseline, with its reason and state;
`docguard ignore --format claimspec` exports the reasoned `.docguardignore`
entries as a claimspec `ignore` document ([commands](commands.md#docguard-ignore)).

### Directories skipped without configuration

DocGuard's file walkers skip dependency and build-output directories by name,
at any depth, with nothing in `.docguardignore` (`DEFAULT_IGNORE_DIRS` in
`cli/shared-ignore.mjs`):

- dependencies: `node_modules`, `vendor` (PHP, Go), `.venv`, `__pycache__`;
- build output: `dist`, `build`, `out`, `coverage`, `target` (Rust, Maven),
  `.gradle`, `obj` (.NET, C), `_build` (Mix, dune, Sphinx), `cdk.out`;
- framework caches: `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.vercel`,
  `.cache`;
- version control: `.git`, `.jj`, `.hg`, `.svn`.

A `bin` directory is skipped only when the directory holding it also holds a
.NET project file (`*.csproj`, `*.fsproj`, `*.vbproj`): there it is build and
publish output. Every other `bin/` is read, such as a Node CLI's `bin/cli.js`,
Ruby binstubs or shell scripts. To skip a directory this list does not name,
add it to `.docguardignore`.

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

A finding is matched by a fingerprint: its code, its file path without the
line number, and its message with every number masked. Text that changes when
unrelated files change is left out too. Today that is one case: the
` — IR soft-match: <test file> (N% similar) may already cover it` hint at the
end of a TRC004 message, which names whichever test file currently matches
best. Adding a test file therefore never brings back a baselined TRC004
finding. A baseline written before v0.44 still matches the findings it froze
until a hint changes, and `guard --update-baseline` rewrites it in the new form.

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
  reason is required and must be at least 10 characters.

## Agent instruction budget — `agentInstructions`

Agents stop reading instructions at a byte limit (Codex:
`project_doc_max_bytes`, 32 KiB). **STR004** reports an `AGENTS.md` chain (root
down to a directory; `AGENTS.override.md` replaces `AGENTS.md`) over the budget.
**STR005** reports an allowance that has slack to reclaim. It is informational:
it never changes guard's exit code unless `findingSeverity.STR005` says so.

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

## Requirement anchors — `anchors` and `validators.requirementAnchors`

`docguard anchors` lists, in any project, what each `@implements` / `@req` tag
anchors to.

Guard reports on anchors only once the project opts in. That means either a
committed `.docguard-anchor-lock.jsonl` or this setting:

```json
"anchors": { "enabled": true }
```

| Key | Default | Meaning |
|---|---|---|
| `anchors.enabled` | `false` | Report ANC findings in guard before the project has an anchor lock |
| `anchors.fanOutLimit` | `10` | Most importing files `docguard anchors` lists as ripple for one changed anchor before it collapses them into a count |
| `anchors.failOn` | `reviewed-exact` | Which suspect (ANC001) and lost (ANC003) links fail guard. `reviewed-exact` fails only links someone accepted as reviewed (never baselined ones), at symbol, statement or route scope, read at an exact tier (Babel, python3 `ast`). File-scope and pattern-tier links warn, because they change on edits that leave the requirement alone. `none` makes every anchor finding a warning. A requirement-text change (ANC002) never fails. The default comes from a replay of 150 commits of this repository, in which no exact-tier link was flagged by a formatting-only commit |
| `anchors.orphanPaths` | the `scope.sourcePaths` of current specs | Where `docguard anchors --orphans` looks for untagged symbols: globs (`src/**/*.go`), files or directories. Nothing is listed when neither is set |
| `anchors.testguard.evidence` | `.testguard/evidence.json` | The saved TestGuard evidence `docguard anchors` reads to mark the tests of a changed requirement re-verified. Project-relative; read through the same no-symlink, inside-the-project reader as other evidence. DocGuard never runs TestGuard or a test |
| `anchors.testguard.claims` | `testguard.claims.json` | The TestGuard claims file. A claim counts only while its statement, source and fault set still match what was probed |
| `validators.requirementAnchors` | `true` | Set `false` to turn the Requirement-Anchors validator off |

See [`docguard anchors`](commands.md#docguard-anchors).

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
many ranked files it left out. About 4 bytes stand for one token. The section
is opt-in, and the agent-context benchmark kept it that way
(`benchmarks/agent-context/results/README-v3.md`).

```json
{ "memory": { "symbolMap": { "maxBytes": 4096 } } }
```

## Project Type Detection

DocGuard auto-detects your project type from the manifest at the project root
(`package.json`, `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`,
`Cargo.toml`, `go.mod`, …). `init`, `generate` and a project without a
`.docguard.json` all use the same detector:

| Signal | Detected Type |
|--------|--------------|
| A Cloudflare Worker config | `api` |
| `bin` field | `cli` |
| `next`, `react`, `vue`, `angular`, `svelte` | `webapp` |
| `express`, `fastify`, `hono`, `koa`, `@nestjs/core` | `api` |
| `main`, `exports`, `module` | `library` |
| `django` dependency or `manage.py` | `webapp` (Django) |
| `fastapi`, `flask` or `starlette` dependency | `api` |
| `click` or `typer` dependency | `cli` |
| Web framework in Rust or Go (`axum`, `actix-web`, `gin`, …) | `api` |
| `clap` (Rust) or a Rust binary crate | `cli` |
| Any other package | `library` |

When the root holds two manifests (a Python service with a `package.json` for
tooling), the one that names a framework wins.

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

## Version-age note — `DOCGUARD_NO_UPDATE_HINT`

When the installed DocGuard was released more than 14 days ago, guard's text
output, the MCP server's `initialize` instructions and the context pack say
so, and suggest `docguard upgrade` to check npm. DocGuard reads its own
release date from the `CHANGELOG.md` it ships with: the note makes no network
call and never claims a newer version exists. The threshold is fixed.

It is silent when the date cannot be read for certain, in a DocGuard source
checkout, and in guard's text output when `CI` is set. Machine outputs (JSON,
SARIF, JUnit, MCP tool results) never carry it. Turn it off everywhere with:

```bash
export DOCGUARD_NO_UPDATE_HINT=1
```
