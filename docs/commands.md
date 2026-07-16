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
  ]
}
```

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
npx docguard-cli generate --dir /path/to/project
```

**Detects:** Next.js, React, Vue, Angular, Express, Fastify, Hono, Django, FastAPI, SvelteKit, and more.

### `docguard audit`

**Scan and report** which CDD documents exist, are missing, or need attention.

```bash
npx docguard-cli audit
```

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

**MCP server over stdio** — DocGuard's read-only core as native agent tools
(`docguard_guard`, `docguard_score`, `docguard_explain`,
`docguard_verify_claims`, `docguard_report`, `docguard_diagnose`).

```bash
claude mcp add docguard -- npx docguard-cli mcp
```

### `docguard verify --semantic`

**Extract documented claims** (counts, limits, enums) as a verification task
list with cited code paths — the agent checks each value against the code.

### `docguard explain <CODE>`

**Explain any finding code** (`STR001`, `ENV003`, …): what it means, how to fix
it, how to suppress a false positive at the finding site.

### `docguard llms` / `docguard memory --pack`

**Context surfaces for LLMs reading the repo:**

```bash
npx docguard-cli llms              # llms.txt (link index)
npx docguard-cli llms --full       # llms-full.txt (full doc bodies inlined)
npx docguard-cli memory --pack     # .docguard/context-pack.md (session-start context)
```

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
| `--dir <path>` | Project directory (default: current directory) |
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
