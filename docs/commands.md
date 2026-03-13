# Commands Reference

## Core Commands

### `specguard audit`

Scan your project and report which CDD documents exist, are missing, or need attention.

```bash
npx specguard audit
```

### `specguard init`

Initialize CDD documentation from templates. Creates skeleton files and installs AI agent slash commands.

```bash
npx specguard init
npx specguard init --dir /path/to/project
```

**Creates**: `docs-canonical/`, `AGENTS.md`, `CHANGELOG.md`, `DRIFT-LOG.md`, `.specguard.json`, `.github/commands/`

### `specguard guard`

Validate your project against its canonical documentation. Runs all enabled validators.

```bash
npx specguard guard
npx specguard guard --format json
```

**Exit codes**: `0` (pass), `1` (fail), `2` (warn)

### `specguard score`

Calculate your CDD maturity score (0-100) with a letter grade.

```bash
npx specguard score
npx specguard score --format json
```

**Grades**: A+ (95+), A (90+), B (80+), C (70+), D (60+), F (<60)

---

## AI Integration Commands

### `specguard fix`

Find all CDD issues and generate AI-actionable fix instructions.

```bash
npx specguard fix                    # Human-readable issue list
npx specguard fix --format json      # Machine-readable for VS Code/CI
npx specguard fix --format prompt    # AI-ready prompt with research steps
npx specguard fix --auto             # Create missing skeleton files
```

### `specguard fix --doc <name>`

Generate a deep AI research prompt for a specific document. The AI reads the output and writes the doc.

```bash
npx specguard fix --doc architecture
npx specguard fix --doc data-model
npx specguard fix --doc security
npx specguard fix --doc test-spec
npx specguard fix --doc environment
```

**Output includes**: TASK, PURPOSE, RESEARCH STEPS (what to grep/read), WRITE THE DOCUMENT (expected sections).

---

## Generation Commands

### `specguard generate`

Reverse-engineer CDD documentation from an existing codebase. Scans source code and creates pre-filled docs.

```bash
npx specguard generate
npx specguard generate --dir /path/to/project
```

### `specguard agents`

Manage AI agent configuration files.

```bash
npx specguard agents              # Show current agent config
npx specguard agents --list       # List available agent types
```

---

## DevOps Commands

### `specguard ci`

Single command for CI/CD pipelines. Runs guard + score with configurable thresholds.

```bash
npx specguard ci
npx specguard ci --threshold 80
npx specguard ci --threshold 70 --fail-on-warning
npx specguard ci --format json
```

**Exit codes**: `0` (pass), `1` (fail), `2` (warn)

### `specguard hooks`

Install git hooks for automatic CDD validation.

```bash
npx specguard hooks
npx specguard hooks --remove
```

**Installs**:
- `pre-commit`: Runs `specguard guard`
- `pre-push`: Runs `specguard score`
- `commit-msg`: Validates conventional commit format

### `specguard badge`

Generate shields.io badge markdown for your README.

```bash
npx specguard badge
npx specguard badge --format json
```

### `specguard diff`

Show differences between your documentation and actual codebase.

```bash
npx specguard diff
```

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--dir <path>` | Project directory (default: current directory) |
| `--format <type>` | Output format: `text` (default), `json` |
| `--auto` | Auto-fix issues (with `fix` command) |
| `--doc <name>` | Target specific document (with `fix` command) |
| `--threshold <n>` | Minimum score for CI pass (with `ci` command) |
| `--fail-on-warning` | Fail CI on warnings (with `ci` command) |
| `--help` | Show help |
| `--version` | Show version |
