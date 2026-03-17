---
name: docguard-fix
description: AI-driven documentation repair with structured research workflow, template-aware
  generation, and quality validation loops. Generates or fixes canonical documentation
  by researching the actual codebase, not using placeholders. Iterates until guard passes.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.9.9
  source: extensions/spec-kit-docguard/skills/docguard-fix
---
<!-- docguard:version: 0.9.9 -->

# DocGuard Fix Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).
If user specifies `--doc <name>`, focus on that single document.
If no arguments, fix ALL issues found by `docguard diagnose`.

## Goal

Research the actual codebase to generate or repair canonical documentation that passes DocGuard's 19-validator guard suite. This skill replaces generic templates with real, project-specific content and iterates until quality checks pass.

## Operating Constraints

- **NEVER use placeholder content** — every section must reference real files, real modules, real dependencies
- **ALWAYS back up before overwriting** — use `safeWrite()` pattern or create `.bak` files
- **Maximum 3 validation iterations** — if still failing after 3 rounds, report remaining issues and stop
- **Research before writing** — understand the codebase first, then generate documentation

## Execution Flow

### Step 1: Diagnose Current State

Run the diagnostic to identify all issues:

```bash
npx docguard-cli diagnose 2>&1
```

Parse the output to build an issue inventory:

| Issue ID | Severity | Category | File | Description | Autofix? |
|----------|----------|----------|------|-------------|----------|
| I001 | ERROR | Structure | SECURITY.md | Missing file | Yes |
| I002 | WARN | Freshness | ARCHITECTURE.md | 5 commits behind | Yes |
| ... | ... | ... | ... | ... | ... |

If `$ARGUMENTS` contains `--doc <name>`, filter to only issues affecting that document.

### Step 2: Prioritize Fix Order

Sort issues by fix dependency and impact:

1. **Structure** first (missing files must exist before checking sections)
2. **Doc Sections** second (sections must exist before checking quality)
3. **Doc-Quality** third (readability and language improvements)
4. **Freshness** fourth (update `last-reviewed` dates)
5. **Metadata-Sync** fifth (ensure headers are consistent)
6. **Everything else** last

### Step 3: Research the Codebase (Per Document)

For each document that needs fixing, execute a **targeted research pass**. Research must be thorough — read actual code, not just filenames.

#### For ARCHITECTURE.md:
1. Read `package.json` for project name, description, dependencies, scripts
2. List top-level directory structure (`ls -la`, focus on `src/`, `lib/`, `cli/`, `app/`)
3. Identify entry points — check `main`, `bin`, `exports` in package.json
4. For each major directory, read 2-3 representative files to understand purpose
5. Map the import graph — which modules import which
6. Identify external dependencies and their roles

#### For SECURITY.md:
1. Check `.gitignore` for security-related patterns (`.env`, secrets, keys)
2. Search for auth patterns: `grep -r "auth\|token\|jwt\|session\|password\|secret" src/ lib/ --include="*.js" --include="*.mjs"`
3. Check `package.json` for auth dependencies (passport, jwt, bcrypt)
4. Look for middleware, guards, or permission checks
5. Check for `.env` files (document variable names only, NEVER values)
6. Look for CORS, rate limiting, input validation

#### For TEST-SPEC.md:
1. Read `package.json` scripts for test commands
2. Find test files: `find . -name "*.test.*" -o -name "*.spec.*" | head -20`
3. Read test configuration (jest.config, vitest.config, etc.)
4. Read 2-3 test files to understand patterns
5. Check for E2E setup (playwright, cypress)
6. Look for CI config that runs tests

#### For DATA-MODEL.md:
1. Search for schema definitions: `grep -r "Schema\|model\|Table\|Entity\|interface\|type " src/ lib/`
2. Check for ORM configs (prisma, sequelize, mongoose, drizzle)
3. Look for migration files
4. Check for TypeScript interfaces/types defining data shapes
5. Look for Zod schemas, JSON schemas, validation files
6. If no database: document config file formats

#### For ENVIRONMENT.md:
1. Read `package.json` for engines, scripts, dependencies
2. Check for `.nvmrc`, `.node-version`, `.tool-versions`
3. Search for `process.env` usage: `grep -r "process.env" src/ lib/ cli/`
4. Check for `.env.example` or `.env.template`
5. Check for Docker/docker-compose files
6. Look for setup scripts

### Step 4: Generate or Fix Document Content

For each document, follow this strict writing protocol:

1. **Load the metadata header template**:
   ```markdown
   # [Document Title]
   
   <!-- docguard:version X.X.X -->
   <!-- docguard:status active -->
   <!-- docguard:last-reviewed YYYY-MM-DD -->
   ```

2. **Write each mandatory section** using research findings:
   - Use **actual file paths**, module names, and dependency names
   - Use **markdown tables** for structured data (fields, types, constraints)
   - Use **code blocks** for command examples (with actual working commands)
   - Keep language **positive** (avoid negation — "MUST use" not "MUST NOT avoid")
   - Write at **Flesch-Kincaid grade level 8-10** (clear, professional, not academic)

3. **Validate mandatory sections exist**. Each canonical doc requires:
   - **ARCHITECTURE.md**: System Overview, Component Map, Layer Boundaries, Data Flow, Technology Choices
   - **SECURITY.md**: Auth Mechanism, Secrets Inventory, Secrets Storage, Permissions, Security Boundaries
   - **TEST-SPEC.md**: Test Framework, Test Structure, Test Commands, Critical Flows, Coverage
   - **DATA-MODEL.md**: Data Structures/Schemas, Field Types/Constraints, Relationships, Indexes
   - **ENVIRONMENT.md**: Prerequisites, Setup Steps, Environment Variables
   - **REQUIREMENTS.md**: Functional Requirements (FR-IDs), Non-Functional Requirements

4. **Apply DocGuard quality rules**:
   - Section count ≥ 3 per document
   - No TODO/placeholder text in final output
   - Positive language (IEEE 830 §4.3 compliance)
   - Each section has substantive content (not just a heading)

### Step 5: Format Compliance

Ensure every generated document follows CDD format rules:

- **Metadata header**: Must include `docguard:version`, `docguard:status`, `docguard:last-reviewed`
- **Heading hierarchy**: Single `# H1`, then `## H2` sections, then `### H3` subsections
- **Tables**: Use markdown tables for structured data (pipes aligned, header separators with 3+ dashes)
- **Code blocks**: Use fenced blocks with language identifier for all commands/code
- **Line length**: Keep lines under 120 characters for readability
- **No trailing whitespace**

### Step 6: Validation Loop (Max 3 Iterations)

After writing/fixing each document:

1. **Run guard on the specific validator**:
   ```bash
   npx docguard-cli guard 2>&1
   ```

2. **Parse results** for the affected validators
3. **If still failing**:
   - Identify exactly which checks are still failing
   - Apply targeted fixes (not a full rewrite)
   - Re-run guard
4. **If passing after iteration**: Move to next document
5. **If still failing after 3 iterations**: Report remaining issues with specific error details

### Step 7: Completion Report

After all fixes are applied, output:

```markdown
## DocGuard Fix Report

### Documents Fixed
| Document | Action | Checks Before | Checks After | Status |
|----------|--------|:------------:|:------------:|--------|
| SECURITY.md | Created | 0/2 | 2/2 | ✅ |
| ARCHITECTURE.md | Updated sections | 6/8 | 8/8 | ✅ |

### Guard Score
- **Before**: [X]/[Y] checks passed
- **After**: [X]/[Y] checks passed
- **Improvement**: +[N] checks

### Remaining Issues (if any)
- [Issue description] — [Why it couldn't be auto-fixed]

### Suggested Next Steps
- Run `/docguard.guard` to verify full compliance
- Review generated content for accuracy
- Commit with: `docs: fix CDD documentation [list of docs fixed]`
```

## Behavior Rules

- **Research FIRST, write SECOND** — never generate content without reading the codebase
- **Be specific to THIS project** — don't add generic boilerplate for features the project doesn't have
- **Back up before overwriting** — if file exists, create `.bak` first or use `safeWrite()`
- **Respect existing content** — when updating, preserve user-written sections and only add/fix missing parts
- **Log deviations** — if you deviate from canonical expectations, add `// DRIFT: reason` in DRIFT-LOG.md
- **Never include secrets** — document variable/secret NAMES only, never actual values

## Integration with Spec Kit

If `.specify/` directory exists:
- Check `constitution.md` for project principles before generating docs
- Align documentation language with constitutional requirements
- If `specs/*/spec.md` exists, cross-reference requirements with TEST-SPEC.md

## Context

$ARGUMENTS
