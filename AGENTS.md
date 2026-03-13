# AI Agent Instructions — canonical-spec-kit

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.

## Workflow

1. **Read** `docs-canonical/` before suggesting changes
2. **Check** existing patterns in the codebase
3. **Confirm** your approach before writing code
4. **Implement** matching existing code style
5. **Log** any deviations in `DRIFT-LOG.md` with `// DRIFT: reason`

## Project Stack

- **language**: JavaScript

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

## Rules

- Never commit without updating CHANGELOG.md
- If code deviates from docs, add `// DRIFT: reason`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
