# Commands Reference

DocGuard CLI — one pinned runtime dependency (`@babel/parser`, optional-load); Node.js 18+. See `package.json` for the current version.

## The AI Loop

```
diagnose (identify + fix)  →  AI executes  →  guard (verify)
```

`diagnose` is the primary command. `guard` is the CI gate.

---

## Primary Commands

### `docguard diagnose` (alias: `dx`)

**The AI orchestrator.** Runs all validators, maps every failure to an AI fix prompt, outputs a remediation plan.

```bash
npx docguard-cli diagnose                # Human-readable remediation plan
npx docguard-cli diagnose --format json  # Structured for automation
npx docguard-cli diagnose --format prompt # Raw AI prompt (all issues combined)
```

**JSON output includes:**
- `issues[]` — severity, validator, message, fix command
- `fixCommands[]` — unique commands to run
- `score` — current CDD maturity score
- `grade` — letter grade (A+ to F)

### `docguard guard`

**Identify issues.** Validate project against canonical docs. Use for CI gates and pre-commit hooks.

```bash
npx docguard-cli guard                   # Text output
npx docguard-cli guard --format json     # Structured JSON (the stable agent contract)
npx docguard-cli guard --format json --compact   # Each fact once (what the MCP tool returns by default)
npx docguard-cli guard --format sarif    # SARIF 2.1.0 for GitHub Code Scanning
npx docguard-cli guard --format junit    # JUnit XML for GitLab/Jenkins/Azure DevOps
npx docguard-cli guard --update-baseline # Freeze current findings (brownfield adoption)
npx docguard-cli guard --no-baseline     # Ignore the committed baseline this run
```

**Adoption baseline:** on a legacy repo, `--update-baseline` writes
`.docguard.baseline.json` (commit it). From then on guard/ci suppress those
frozen findings — visibly — and gate only new drift. Fingerprints are stable
across line-number churn and volatile counts, so the baseline doesn't rot.

```bash
npx docguard-cli guard --verbose         # Show all check details
npx docguard-cli guard --changed-only    # Pre-commit lite mode (fast subset)
```

**Exit codes:** `0` (pass), `1` (errors), `2` (warnings)

When issues are found, guard outputs: `Run docguard diagnose to get AI fix prompts.`

**JSON output includes:**
```json
{
  "project": "my-app",
  "profile": "standard",
  "status": "WARN",
  "passed": 37,
  "total": 40,
  "findings": [
    { "code": "ENV003", "severity": "warn", "message": "…", "location": "docs-canonical/ENVIRONMENT.md", "suggestion": { "kind": "fix", "text": "…" } }
  ],
  "nextStep": "docguard diagnose",
  "coverage": { "canonical": 5, "tracked": 40, "ignored": 10, "unclassified": [] },
  "semanticClaims": { "count": 12 },
  "validators": [
    { "name": "Structure", "status": "pass", "passed": 8, "total": 8, "errors": [], "warnings": [] }
  ],
  "precisionEvidence": {
    "measures": "benchmark-precision",
    "caveat": "Benchmark precision on a deliberately balanced corpus …",
    "minN": 5,
    "source": { "toolVersion": "0.41.7", "runningVersion": "0.41.7", "matchesRunningVersion": true, "reviewStatus": "reviewed", "reviewedAt": "2026-09-18" },
    "coverage": { "codesInRun": 3, "measured": 1, "notMeasured": 2, "quotable": 1 },
    "codes": {
      "SEC005": { "status": "measured", "precision": 1, "precisionDenominator": 5, "precisionInterval": [0.565509, 1], "quotable": true },
      "ENV003": { "status": "not-measured", "reason": "No benchmark case exercises this finding code, …" }
    }
  }
}
```

Most codes report `not-measured`: DocGuard defines far more finding codes than
its corpus measures, and a code never inherits another code's precision just
because they share a validator. `docguard explain <CODE>` prints the same
evidence in prose.

Every finding carries a stable code — `docguard explain <CODE>` for its
contract, `// docguard:ignore <CODE>` to suppress a false positive at the site.

### `docguard score`

**CDD maturity score** (0-100) with category breakdown.

```bash
npx docguard-cli score                   # Visual bar chart
npx docguard-cli score --format json     # Structured JSON
npx docguard-cli score --tax             # Documentation tax estimate
```

**`--tax` output:**
```
📋 Documentation Tax Estimate
─────────────────────────────────
Tracked docs:        7 files
Active profile:      standard
Est. maintenance:    ~5 min/week
Tax-to-value ratio:  LOW
```

**Grades:** A+ (95+), A (80+), B (65+), C (50+), D (30+), F (<30)

---

## Setup Commands

### `docguard init`

**Initialize CDD documentation** from templates.

```bash
npx docguard-cli init                           # Full CDD (standard profile)
npx docguard-cli init --profile starter         # Minimal: ARCHITECTURE + CHANGELOG
npx docguard-cli init --profile enterprise      # Everything + strict validators
npx docguard-cli init --dir /path/to/project    # Specify directory
npx docguard-cli init --skip-prompts            # No AI prompt output
```

**Profiles:**

| Profile | Docs Created | Validators |
|---------|-------------|------------|
| `starter` | ARCHITECTURE, CHANGELOG, AGENTS, DRIFT-LOG | structure, docsSync, changelog |
| `standard` | All 5 canonical + tracking | Most validators (default) |
| `enterprise` | All docs | All validators + freshness |

### `docguard generate`

**Reverse-engineer docs from existing code.** Scans your codebase and creates pre-filled documentation.

```bash
npx docguard-cli generate
npx docguard-cli generate --dir ./my-project
```

**Detects:** Next.js, React, Vue, Angular, Express, Fastify, Hono, Django, FastAPI, SvelteKit, and more.

#### How routes are read

Guard's API-surface check, `diff` and `generate` take routes from one scanner.
It reads JavaScript, TypeScript and Python with a syntax tree. Go, Java, Kotlin
and Ruby are read by pattern (`fallback-language`), following each framework's
routing rules:

- **Go** (gin, echo, chi, fiber, gorilla/mux, net/http): route groups and
  sub-routers carry their prefix (`r.Group`, chi `Route` and `Mount`, gorilla
  `PathPrefix().Subrouter()`, `http.StripPrefix`). This holds when the group is
  passed to a function in another file, or a function returns the router. Go
  1.22 patterns (`"GET /items/{id}"`) are read; `HandleFunc` with no method is
  `ANY`. `_test.go` files and HTTP client calls are not routes.
- **Spring** (Java, Kotlin): the class-level `@RequestMapping` base, in any
  form (`path =`, `value =`, arrays, constants), joins every method mapping.
  `@RequestMapping(method = …)` names the method, `ANY` when it names none.
  `@FeignClient` interfaces are skipped.
- **Rails** (`config/routes.rb` and its `draw` files): `namespace` and `scope`
  prefixes, `resources`/`resource` with `only:`/`except:`, nesting, `shallow`,
  `member`/`collection`, `match … via:`, `root` and concerns, as `rails routes`
  lists them. Update is both `PATCH` and `PUT`.

A route is omitted when its path or prefix is not literal text or a constant
it can resolve: an environment variable, a `${…}` placeholder, a Ruby
interpolation, or a call it cannot pin to one function. It is never reported
at a guessed path.

#### As-built specs: `docguard generate --spec <area>`

For code that has no spec (a refactor, a migration, onboarding), DocGuard
proposes a Spec Kit spec for **one** directory. It scans the facts it can
establish without an LLM (routes, exported JS/TS symbols, environment variables
read, and data entities) and writes one `FR-NNN` candidate per fact. Each
candidate carries a `<!-- docguard:fact <kind> <key> -->` marker and a file
citation. DocGuard writes no requirement prose; every statement is an agent
task.

```bash
npx docguard-cli generate --spec src/billing                # preview the candidates
npx docguard-cli generate --spec src/billing --write        # create specs/NNN-as-built-src-billing/spec.md
npx docguard-cli generate --spec src/billing --id acme.billing --write --format json
```

`--write` creates the spec in the next free feature directory (honouring Spec
Kit's `feature_numbering`) and registers it with `origin: as_built` and its
`sourcePaths`, in one transaction. From then on **SPR007** reports facts under
those paths that the spec neither marks nor lists under `## Out of Scope`, and
cited facts that no longer exist. An as-built spec needs no `tasks.md`.

### `docguard audit`

**Scan and report** which CDD documents exist, are missing, or need attention.

```bash
npx docguard-cli audit
```

---

## Specification Lifecycle Commands

### `docguard specs`

**Maintain the committed spec lifecycle registry.** The registry keeps reviewed
approval, delivery, context, lineage, and canonical-document scope separate from
deterministically observed artifacts, task counts, and requirement-scoped test
evidence.

```bash
npx docguard-cli specs --check                 # CI: registry must match the repository
npx docguard-cli specs --write                 # Refresh observations; preserve reviewed fields
npx docguard-cli specs preflight               # Brief prior intent before specification
npx docguard-cli specs preflight --path specs/007-feature/spec.md
npx docguard-cli specs approve --id acme.feature --delivery implemented # plan the approval
npx docguard-cli specs approve --id acme.feature --delivery implemented --write
npx docguard-cli specs complete --id acme.feature --since main          # plan the completion
npx docguard-cli specs complete --id acme.feature --write --reason "..." # apply it
npx docguard-cli specs require --since origin/main --message-file pr.txt # spec-first gate
npx docguard-cli specs reanchor --id acme.feature --write               # move a squash-discarded revision
```

`specs require` is the spec-first gate. A change to a governed path (see
[`specFirst`](configuration.md#spec-first-gate--specfirst)) must name its spec,
either as a `specs/<dir>` path or a Spec ID, in the commit messages or the
message file, or declare `Spec-Exempt: <kind> — <reason>`. The reason must be at
least 10 characters; a shorter one is listed as an invalid exemption. A Spec ID
written after `Spec:` or `Spec ID:` that matches no spec is listed as an
unresolved reference and covers nothing. Exit 1 means an uncovered change; exit
2 means the check could not decide (for example, the base ref is missing). The
GitHub Action runs it with `command: spec-first`.

Every active spec needs a stable project-scoped metadata identity such as
`Spec ID: acme.billing-export` near the top of the authoritative spec. Completion evidence uses
`specId#requirementId`; bare `FR-001` references remain navigation hints because
the same local ID commonly appears in several specs.

The generated-spec preflight blocks missing or duplicate identity, stale
registry state, unsafe paths, and broken lifecycle lineage. Text similarity is
low-confidence review context and never blocks by itself. It checks the
registry against every spec except the draft, so the draft's own entry may be
missing (not yet written) or stale (the draft is still changing). A project's
first spec therefore passes with no registry at all, and again after `specs
--write` has registered it.

`specs approve` records a person's approval in the registry's reviewed
lifecycle, and with `--delivery` the state `planned`, `in_progress` or
`implemented`. Without `--write` it prints the transition and writes nothing.
It needs a current registry and a current spec. It refuses `verified` and
`released`, which only `specs complete` records after checking evidence, and
never moves a verified spec back. Approval is never read from the spec's prose
(a `**Status**: Approved` line): prose is generated and observed, while
reviewed fields are attested by whoever runs the command and reviewed in the
pull request that commits the registry. `docguard explain SPC001` … `SPC008`
explains each blocker `specs approve`, `specs complete` and `specs reanchor`
print. `specs complete`
verifies exact-revision implementation evidence, canonical outcomes, and context
regeneration before marking a spec verified; `--write` requires a reviewed
reason and performs the registry, spec outcome, and current-context writes as
one rollback-safe transaction. Several completions can run back to back against
the same revision before one commit: the files completion writes do not count as
changes.

Completion traces every changed source or test file to a spec: through that
spec's recorded evidence, or through a requirement identity in the changed
text. A file that can name neither, such as a digest-pinned fixture or a
recorded output, is listed by hand under its owner's
`reviewed.scope.assetPaths` in `.docguard-specs.json`. An entry ending in `/`
covers a directory, and any other entry covers exactly one file; wildcards are
rejected. Guard reports **SPR009** for an entry that covers no tracked file.

`specs reanchor` repairs a recorded revision that a squash merge discarded
(guard reports it as **SPR008**). It finds the first commit on HEAD's
first-parent history whose evidence files are byte-identical to the reviewed
ones and moves the anchor there, recording `reanchoredFrom`. If the old revision
no longer exists anywhere, or no commit carries the reviewed bytes (the PR kept
changing after its completion), `--to <revision> --reason "<why>"` records an
attested anchor instead, listing the evidence files that differ. `--to` takes
anything git resolves to a commit on HEAD's history: a SHA (full or short), a
branch, a tag or `HEAD`. The full SHA is recorded. When one spec
has dangling revisions from different merges, add `--from <revision>` to attest
them one at a time; the others are left as they are.

### `docguard review`

**Know which docs to re-read when code changes.** A doc section declares the
code it describes on its marker, and a review records what that code looked
like:

```markdown
<!-- docguard:section id=pricing source=human covers="src/pricing.mjs#discount" -->
Orders over 100 get a 10% discount.
<!-- /docguard:section -->
```

```bash
npx docguard-cli review                                   # status of every covered section
npx docguard-cli review --accept docs-canonical/ARCHITECTURE.md#pricing --reason "Checked the discount rule"
npx docguard-cli review --prune                           # drop entries whose section is gone
npx docguard-cli review --suggest docs-canonical/ARCHITECTURE.md   # propose covers= (low confidence)
```

Guard then reports **DLK001** when a covered symbol's code changes
semantically. Reformatting, comments and moving the function do not count; a
same-size edit such as `0.9` → `0.8` does. The finding carries the `git diff`
command for the change. **DLK002** reports a dependency that no longer
resolves, **DLK003** a section never accepted or whose `covers=` changed,
**DLK004** a lock entry without a section, and **DLK005** an unreadable lock.
Only `review --accept` and `--prune` write `.docguard-doc-lock.json`; `sync`,
`fix` and agents never do.

### `docguard rules`

**Which instructions an agent loads for a path.** Each harness finds its
instructions its own way (nested `AGENTS.md`, `CLAUDE.md`, `.claude/rules`,
`.cursor/rules/*.mdc`, `.github/instructions`, skills). `rules --for` answers,
per harness, which files apply to a path, why (always, the directory chain, or
the pattern that matched) and how many bytes they add up to:

```bash
npx docguard-cli rules --for src/api/users.ts
npx docguard-cli rules --for src/api/users.ts --harness cursor --format json
```

The path need not exist yet. It must be project-relative: an absolute path,
`..`, or a symlink leaving the project is refused. Machine-local rules (untracked
or gitignored) are listed and marked `local`. Skills and rules that load by
description or keyword are counted as not path-scoped. Read-only.

Guard's **Path-Scoped-Rules** validator checks the same files, tracked ones
only:
- **PSR001**: a scope pattern matches no tracked file (the rule never loads);
- **PSR002**: an instruction file points at a path that does not exist,
  including routing-table rows and Markdown links;
- **PSR003**: the instructions one harness loads for some path exceed
  `agentInstructions.maxBytes`;
- **PSR004**: a scope the harness cannot read, or reads differently than
  written (for example `globs:` in a Claude Code rule, which reads only
  `paths:`).

### `docguard trace`

**Which docs describe which code.** Without flags, a requirements traceability
matrix from each canonical doc to the source files it usually covers.

```bash
npx docguard-cli trace                         # doc → code matrix
npx docguard-cli trace --reverse src/api/x.ts  # code → doc: the declared owner, then text mentions
npx docguard-cli trace --features              # per-feature Spec Kit adherence
npx docguard-cli trace --owners                # the ownership map: files per entry, unowned code, ties
npx docguard-cli trace --owners --suggest      # a draft ownership block; never writes
```

`--owners` reads the `ownership` block in `.docguard.json`
([configuration](configuration.md#doc-ownership--ownership)). `--suggest` builds
a draft from the top-level source modules, their `@doc` annotations and the
built-in doc patterns, and leaves every `purpose` as a placeholder for a person.
With a map, `trace --reverse` prints the owner first, labelled `declared`.

Guard's **Doc-Ownership** validator reports:
- **OWN001**: an unowned source directory;
- **OWN002**: two equally specific owners;
- **OWN003**: a pattern or root that matches nothing;
- **OWN004**: an entry naming a missing doc or section;
- **OWN005 / OWN006**: a committed `.devin/wiki.json` over Devin's limits, or
  naming a path that is gone;
- **OWN007**: an unreadable map or wiki file.

### `docguard retire`

**Remove reviewed stale documents from active AI context while preserving exact
recovery metadata in Git.** Planning and checking are read-only; writing requires
explicit paths and a reason.

```bash
npx docguard-cli retire --plan
npx docguard-cli retire --check --format json
npx docguard-cli retire --write --path docs/old-plan.md --reason "Superseded by current architecture"
```

Retirement fails closed for dirty, untracked, required, symlinked, private, or
out-of-project content. Generic retirement also refuses active registered specs;
their lifecycle must move through the dedicated `specs` control plane.

---

## AI Integration Commands

### `docguard fix`

**Find issues and generate AI fix instructions.**

```bash
npx docguard-cli fix                    # Human-readable issue list
npx docguard-cli fix --format json      # Machine-readable for VS Code/CI
npx docguard-cli fix --format prompt    # AI-ready prompt
npx docguard-cli fix --auto             # Create missing skeleton files
```

### `docguard fix --doc <name>`

**Generate a deep AI research prompt** for a specific document.

```bash
npx docguard-cli fix --doc architecture
npx docguard-cli fix --doc data-model
npx docguard-cli fix --doc security
npx docguard-cli fix --doc test-spec
npx docguard-cli fix --doc environment
```

**Output includes:** TASK, PURPOSE, RESEARCH STEPS (what to grep/read), WRITE THE DOCUMENT (expected sections).

### `docguard agent`

**Build an agent task graph or select bounded evidence for one task.** Existing
task-graph behavior is unchanged when `--task` is absent.

```bash
npx docguard-cli agent
npx docguard-cli agent --format json
npx docguard-cli agent --task "Implement acme.payments#FR-003 in src/payments.mjs"
npx docguard-cli agent --task "Fix SEC001 in src/config.mjs" --format json
```

Task mode reads only configured canonical documents, approved current specs,
project rules, and exact linked source/test pointers. It excludes retired,
unapproved, digest-stale, private, unsafe, and symlinked material. JSON output
uses `schemas/docguard-task-context.schema.json`, contains a task digest instead
of raw task text, and reports retrieval-only assurance. When no excerpt reaches
the frozen relevance threshold, it returns `selection.status: "abstained"` with
a navigation map rather than weak context.

### `docguard agents`

**Generate agent-specific config files** from AGENTS.md.

```bash
npx docguard-cli agents            # one-shot scaffold (skips existing files)
npx docguard-cli agents --sync     # AGENTS.md → CLAUDE.md/Copilot/Cursor/… (hash-marked, repeatable)
npx docguard-cli agents --check    # CI gate: exit 2 if any synced variant is stale
```

`--sync` treats AGENTS.md as the canonical source: generated variants carry a
source-hash marker and are regenerated on change; files you wrote by hand are
never touched without `--force`.

### `docguard mcp`

**MCP server over stdio** (or `--transport http`, loopback by default) — DocGuard's
read-only core as native agent tools
(`docguard_guard`, `docguard_score`, `docguard_explain`,
`docguard_verify_evidence`, `docguard_verify_claims`, `docguard_report`,
`docguard_docs_for_path`, `docguard_doc_structure`, `docguard_read_section`,
`docguard_task_context`, `docguard_diagnose`). `docguard_guard` returns each
fact once by default; pass `detail: "full"` for the complete contract. The four navigation tools answer
"which docs describe this file?" and read one bounded section at a time, so an
agent does not load whole documents; none of them calls a model.

```bash
claude mcp add docguard -- npx docguard-cli mcp
```

A tool call's optional `projectDir` must be the served directory (`--dir`, or
the directory the server was started in) or inside it; relative paths resolve
against the served directory, and symlinks are followed before the check.
Anything else gets an `isError` result naming the served directories.
`--root <dir>` (repeatable) serves another tree; a `--root` that does not exist
stops the server at startup.

### `docguard verify --semantic`

**Extract documented claims** (counts, limits, enums) as a verification task
list with cited code paths — the agent checks each value against the code.

### `docguard verify --evidence`

**Evaluate exact declared evidence** from `.docguard-evidence.json`. Supported
sources are typed RFC 6901 JSON values, bounded repository collections, saved
oasdiff JSON, and saved Buf JSON Lines. Output preserves
`verified-within-scope`, `contradicted`, `stale`, `inconclusive`, and
`unsupported`; a pass applies only to its selected Markdown statement.

### `docguard explain <CODE>`

**Explain any finding code** (`STR001`, `ENV003`, …): what it means, how to fix
it, how to suppress a false positive at the finding site.

### `docguard llms` / `docguard memory --pack`

**Context surfaces for LLMs reading the repo:**

```bash
npx docguard-cli llms              # llms.txt (link index)
npx docguard-cli llms --full       # llms-full.txt (full doc bodies inlined)
npx docguard-cli memory --pack     # .docguard/context-pack.md (session-start context)
npx docguard-cli memory --pack --symbols   # …plus a symbol map (opt-in)
```

`--symbols` adds a `## Symbol map`: the source files most central in the static
import graph (PageRank), each with the names it exports, cut to
`memory.symbolMap.maxBytes` (default 4096) at a whole line. It is byte-identical
for the same tree and names what it left out. It stays opt-in until the v2
agent-context benchmark decides whether the extra bytes pay for themselves
(`benchmarks/agent-context/results/README-v2.md`).

---

## DevOps Commands

### `docguard report`

**Compliance-evidence bundle for audits** — guard verdict, CDD score, ALCOA+
data-integrity attributes, findings grouped by code, and fix history, stamped
with the git commit and a tamper-evident sha256 integrity hash. Evidence, not
a gate: always exits 0 (`guard`/`ci` fail builds).

```bash
npx docguard-cli report                          # markdown to stdout
npx docguard-cli report --format json            # machine bundle
npx docguard-cli report --out evidence.md        # write to a file
```

### `docguard ci`

**Single command for CI/CD pipelines.** Runs guard + score internally (no
subprocess). Read-only and machine-clean: it never scaffolds or mutates the
workspace it validates. Each run appends one line to `.docguard/history.jsonl`
so `docguard score --trend` can show the trajectory (opt out: `--no-history`).

```bash
npx docguard-cli ci                              # Basic check
npx docguard-cli ci --threshold 70               # Fail below score 70
npx docguard-cli ci --threshold 80 --fail-on-warning  # Strict mode
npx docguard-cli ci --format json                # JSON for GitHub Actions
npx docguard-cli score --trend                   # Score history from past ci runs
```

### `docguard hooks`

**Install git hooks** for automatic validation.

```bash
npx docguard-cli hooks              # Install all hooks
npx docguard-cli hooks --list       # Show installed hooks
npx docguard-cli hooks --remove     # Remove hooks
```

**Hooks installed:**
- `pre-commit` → runs `docguard guard`
- `pre-push` → runs `docguard score` with threshold
- `commit-msg` → validates conventional commit format

### `docguard watch`

**Live watch mode** — re-runs guard on file changes.

```bash
npx docguard-cli watch              # Watch and re-run guard
npx docguard-cli watch --auto-fix   # Also output AI fix prompts on failure
```

### `docguard badge`

**Generate shields.io badges** for README.

```bash
npx docguard-cli badge
npx docguard-cli badge --format json
```

### `docguard diff`

**Show gaps** between documentation and actual codebase.

```bash
npx docguard-cli diff
```

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Project directory (default: current directory); explicit selection suppresses ancestor-root guidance |
| `--format <type>` | Output format: `text` (default), `json`, `prompt` |
| `--verbose` | Show detailed output |
| `--profile <name>` | Compliance profile: `starter`, `standard`, `enterprise` |
| `--tax` | Show documentation tax estimate (with `score`) |
| `--auto-fix` | Output AI fix prompts on failure (with `watch`) |
| `--skip-prompts` | Suppress AI prompts after init |
| `--auto` | Auto-fix issues (with `fix` command) |
| `--doc <name>` | Target specific document (with `fix` command) |
| `--threshold <n>` | Minimum score for CI pass (with `ci` command) |
| `--fail-on-warning` | Fail CI on warnings (with `ci` command) |
| `--force` | Overwrite existing files |
| `--help` | Show help |
| `--version` | Show version |

Without `--dir`, a command remains scoped to the current directory. DocGuard
reads only bounded ancestors for an owning `.docguard.json`, npm `workspaces`, or
pnpm `packages` declaration. When one includes the selected package, human
stderr prints an exact `--dir` rerun; JSON/SARIF/JUnit runs receive a typed JSON
diagnostic on stderr. Stdout and the selected scan scope do not change. A nested
Git root prevents a suggestion from crossing into an outer repository.
