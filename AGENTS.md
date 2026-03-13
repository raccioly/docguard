# AI Agent Instructions — docguard

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.

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
- **Version**: 0.5.0

## Key Files

| File | Purpose |
|------|---------|
| `docs-canonical/ARCHITECTURE.md` | System design |
| `docs-canonical/DATA-MODEL.md` | Database schemas |
| `docs-canonical/SECURITY.md` | Auth & secrets |
| `docs-canonical/TEST-SPEC.md` | Test requirements |
| `docs-canonical/ENVIRONMENT.md` | Environment setup |
| `CHANGELOG.md` | Change tracking |
| `DRIFT-LOG.md` | Documented deviations |

## Commands (13 total)

| Command | Purpose |
|---------|---------|
| `diagnose` | **Primary** — identify issues + generate AI fix prompts |
| `guard` | Validate project (CI gate) |
| `fix --doc <name>` | AI prompt for specific document |
| `score` | CDD maturity score (0-100) |
| `init` | Initialize CDD docs |
| `generate` | Reverse-engineer docs from code |
| `ci` | CI/CD pipeline check |

## Rules

- Never commit without updating CHANGELOG.md
- If code deviates from docs, add `// DRIFT: reason`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
- Run `docguard guard` before pushing — all checks must pass
