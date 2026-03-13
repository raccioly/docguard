# Agent Instructions

> This project follows **Canonical-Driven Development (CDD)**.  
> Read canonical docs before making changes. Log drift when deviating.

---

## Project Overview

<!-- What this project is, in 2-3 sentences -->

## Project Documentation (CDD)

This project uses Canonical-Driven Development. Key locations:

- **Canonical docs** (design intent, READ-ONLY): `docs-canonical/`
- **Implementation docs** (current state): `docs-implementation/`
- **Drift tracking**: `DRIFT-LOG.md`
- **Change tracking**: `CHANGELOG.md`

## Build & Dev Commands

| Command | Purpose |
|---------|---------|
| <!-- e.g. npm install --> | Install dependencies |
| <!-- e.g. npm run dev --> | Start development server |
| <!-- e.g. npm test --> | Run unit tests |

## DocGuard — Documentation Enforcement

This project uses **DocGuard** for CDD compliance. Run these commands to validate:

```bash
# Check documentation status
npx docguard audit

# Validate compliance (errors + warnings)
npx docguard guard

# See CDD maturity score
npx docguard score

# Find and fix CDD issues
npx docguard fix

# Get AI-ready fix prompt
npx docguard fix --format prompt
```

### AI Agent Workflow (IMPORTANT)

When working on this project, follow this workflow:

1. **Before any work**: Run `npx docguard guard` to understand current compliance state
2. **After making changes**: Run `npx docguard fix --format prompt` to find remaining issues
3. **Fix what DocGuard reports**: Each issue includes an `ai_instruction` telling you exactly what to do
4. **Run guard again**: Verify all issues are resolved before committing
5. **Update CHANGELOG.md**: All changes need a changelog entry

### Auto-Fix Available Issues

If DocGuard detects missing files, run:
```bash
npx docguard fix --auto
```

This auto-creates required documentation from templates. Then review and fill in project-specific content.

## Workflow Rules

1. **Research first** — Check `docs-canonical/` before suggesting changes
2. **Confirm before implementing** — Show a plan, wait for approval
3. **Match existing patterns** — Search codebase for similar implementations
4. **Document drift** — If deviating from canonical docs, add `// DRIFT: reason`
5. **Update changelog** — All changes need a `CHANGELOG.md` entry
6. **Run DocGuard** — After any documentation changes, run `npx docguard guard`

## Code Conventions

<!-- Project-specific style rules -->

## File Change Rules

- Changes to >3 files require explicit approval
- Schema/data model changes require `DATA-MODEL.md` update
- New dependencies require justification
- Never commit without explicit approval
- Documentation changes must pass `docguard guard` before commit
