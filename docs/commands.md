# Commands Reference

DocGuard v0.5.0 — 13 commands, zero dependencies.

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
npx docguard diagnose                # Human-readable remediation plan
npx docguard diagnose --format json  # Structured for automation
npx docguard diagnose --format prompt # Raw AI prompt (all issues combined)
```

**JSON output includes:**
- `issues[]` — severity, validator, message, fix command
- `fixCommands[]` — unique commands to run
- `score` — current CDD maturity score
- `grade` — letter grade (A+ to F)

### `docguard guard`

**Identify issues.** Validate project against canonical docs. Use for CI gates and pre-commit hooks.

```bash
npx docguard guard                   # Text output
npx docguard guard --format json     # Structured JSON
npx docguard guard --verbose         # Show all check details
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
  "validators": [
    { "name": "Structure", "status": "pass", "passed": 8, "total": 8, "errors": [], "warnings": [] }
  ]
}
```

### `docguard score`

**CDD maturity score** (0-100) with category breakdown.

```bash
npx docguard score                   # Visual bar chart
npx docguard score --format json     # Structured JSON
npx docguard score --tax             # Documentation tax estimate
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
npx docguard init                           # Full CDD (standard profile)
npx docguard init --profile starter         # Minimal: ARCHITECTURE + CHANGELOG
npx docguard init --profile enterprise      # Everything + strict validators
npx docguard init --dir /path/to/project    # Specify directory
npx docguard init --skip-prompts            # No AI prompt output
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
npx docguard generate
npx docguard generate --dir /path/to/project
```

**Detects:** Next.js, React, Vue, Angular, Express, Fastify, Hono, Django, FastAPI, SvelteKit, and more.

### `docguard audit`

**Scan and report** which CDD documents exist, are missing, or need attention.

```bash
npx docguard audit
```

---

## AI Integration Commands

### `docguard fix`

**Find issues and generate AI fix instructions.**

```bash
npx docguard fix                    # Human-readable issue list
npx docguard fix --format json      # Machine-readable for VS Code/CI
npx docguard fix --format prompt    # AI-ready prompt
npx docguard fix --auto             # Create missing skeleton files
```

### `docguard fix --doc <name>`

**Generate a deep AI research prompt** for a specific document.

```bash
npx docguard fix --doc architecture
npx docguard fix --doc data-model
npx docguard fix --doc security
npx docguard fix --doc test-spec
npx docguard fix --doc environment
```

**Output includes:** TASK, PURPOSE, RESEARCH STEPS (what to grep/read), WRITE THE DOCUMENT (expected sections).

### `docguard agents`

**Generate agent-specific config files** from AGENTS.md.

```bash
npx docguard agents
npx docguard agents --list
```

---

## DevOps Commands

### `docguard ci`

**Single command for CI/CD pipelines.** Runs guard + score internally (no subprocess).

```bash
npx docguard ci                              # Basic check
npx docguard ci --threshold 70               # Fail below score 70
npx docguard ci --threshold 80 --fail-on-warning  # Strict mode
npx docguard ci --format json                # JSON for GitHub Actions
```

### `docguard hooks`

**Install git hooks** for automatic validation.

```bash
npx docguard hooks              # Install all hooks
npx docguard hooks --list       # Show installed hooks
npx docguard hooks --remove     # Remove hooks
```

**Hooks installed:**
- `pre-commit` → runs `docguard guard`
- `pre-push` → runs `docguard score` with threshold
- `commit-msg` → validates conventional commit format

### `docguard watch`

**Live watch mode** — re-runs guard on file changes.

```bash
npx docguard watch              # Watch and re-run guard
npx docguard watch --auto-fix   # Also output AI fix prompts on failure
```

### `docguard badge`

**Generate shields.io badges** for README.

```bash
npx docguard badge
npx docguard badge --format json
```

### `docguard diff`

**Show gaps** between documentation and actual codebase.

```bash
npx docguard diff
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
