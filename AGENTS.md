# AI Agent Instructions — DocGuard

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.
> DocGuard is an official [GitHub Spec Kit](https://github.com/github/spec-kit) community extension.

## Workflow

1. **Read** `docs-canonical/` before suggesting changes
2. **Check** existing patterns in the codebase
3. **Run** `docguard diagnose` to see what needs fixing
4. **Confirm** your approach before writing code
5. **Implement** matching existing code style
6. **Log** any deviations in `DRIFT-LOG.md` with `// DRIFT: reason`
7. **Verify** with `docguard guard` — all checks must pass

## Project Stack

- **Language**: JavaScript (ES modules)
- **Runtime**: Node.js 18+
- **Dependencies**: Zero (pure Node.js built-ins)
- **Testing**: `node:test` (built-in)
- **Distribution**: npm + PyPI
- **Version**: 0.9.6

## Key Files

| File | Purpose |
|------|---------|
| `docs-canonical/ARCHITECTURE.md` | System design |
| `docs-canonical/DATA-MODEL.md` | Database schemas |
| `docs-canonical/SECURITY.md` | Auth & secrets |
| `docs-canonical/TEST-SPEC.md` | Test requirements |
| `docs-canonical/ENVIRONMENT.md` | Environment setup |
| `docs-canonical/REQUIREMENTS.md` | Spec-kit aligned requirements |
| `CHANGELOG.md` | Change tracking |
| `DRIFT-LOG.md` | Documented deviations |

## Commands (15 total)

| Command | Purpose |
|---------|---------|
| `diagnose` | **Primary** — identify issues + generate AI fix prompts |
| `guard` | Validate project (CI gate) — 22 validators |
| `generate` | Reverse-engineer docs from code |
| `fix --doc <name>` | AI prompt for specific document |
| `score` | CDD maturity score (0-100) |
| `init` | Initialize CDD docs |
| `diff` | Compare canonical docs vs code |
| `agents` | Generate agent-specific configs |
| `trace` | Requirements traceability matrix |
| `ci` | CI/CD pipeline check |
| `watch` | Live watch mode |
| `hooks` | Install git hooks |
| `llms` | Generate llms.txt |
| `badge` | Generate CDD badge |
| `publish` | Publish validation |

## AI Skills (4 total)

DocGuard provides enterprise-grade AI behavior protocols via the Spec Kit extension:

| Skill | Purpose |
|-------|---------|
| `docguard-guard` | 6-step quality gate with severity triage and structured reporting |
| `docguard-fix` | 7-step research workflow with validation loops (max 3 iterations) |
| `docguard-review` | Read-only semantic cross-document consistency analysis |
| `docguard-score` | CDD maturity assessment with ROI-based improvement roadmap |

Skills are located at `extensions/spec-kit-docguard/skills/*/SKILL.md`. They tell agents **how to think**, not just what to run.

## Spec Kit Hooks

DocGuard integrates into the spec-kit workflow:

| Hook | When | Required? |
|------|------|-----------|
| `after_implement` | After `/speckit.implement` | Mandatory |
| `before_tasks` | Before `/speckit.tasks` | Optional |
| `after_tasks` | After `/speckit.tasks` | Optional |

## Extension Structure

```
extensions/spec-kit-docguard/
├── skills/                    # AI behavior protocols
│   ├── docguard-guard/SKILL.md
│   ├── docguard-fix/SKILL.md
│   ├── docguard-review/SKILL.md
│   └── docguard-score/SKILL.md
├── scripts/bash/              # Orchestration scripts (--json output)
├── commands/                  # Spec Kit slash commands
├── templates/                 # Hook registration templates
└── extension.yml              # Skills, scripts, hooks declaration
```

## Rules

- **PR-first workflow — no direct-to-main commits.** Create a branch (`git checkout -b <type>/<slug>`), push, `gh pr create`, let CI run, self-review, squash-merge. Tag releases only after merge on `main`. The only acceptable direct-to-main: typo fixes in comments or README badge URLs.
- Never commit without updating CHANGELOG.md
- If code deviates from docs, add `// DRIFT: reason`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
- Run `docguard guard` before pushing — all checks must pass
- All file writes use `safeWrite()` — backups before overwrite


## Agent Rules

### Dependencies
- Never add a package without first verifying it exists on the official registry (npm/PyPI).
- Always pin to exact versions in package.json/requirements.txt. No ^, ~, or >= ranges.
- Prefer packages with >10k weekly downloads and >1 maintainer.
- If you suggest a package, confirm its first-publish date is older than 30 days.
- Never modify .npmrc, pnpm-workspace.yaml, or dependabot.yml without explicit user confirmation.

### CI/CD
- Never write a workflow using `pull_request_target` with checkout of PR-controlled refs.
- Always pin third-party GitHub Actions to commit SHA, not @v1 or @main.
