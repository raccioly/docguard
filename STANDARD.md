# DocGuard Standard v0.1

> **The open specification for Canonical-Driven Development.**  
> Document first. Any agent understands. Machine-enforceable.

---

## 1. Purpose

This standard defines **Canonical-Driven Development (CDD)** — a full-lifecycle methodology for building and maintaining software projects where documentation IS the source of truth, not an afterthought.

It provides a **universal, language-agnostic documentation structure** that makes any software project fully understandable by AI coding agents (Claude, Gemini, Copilot, Cursor, Kiro, and future agents) while keeping documentation useful for human developers.

**DocGuard** is the CLI tool that enforces this standard — auditing, generating, and guarding project documentation.

---

## 2. Canonical-Driven Development (CDD)

### 2.1 What Is CDD?

Canonical-Driven Development is a methodology where **canonical documentation drives every phase of a project** — from initial design through ongoing maintenance. Unlike traditional development where docs are written after code (and quickly rot), CDD treats documentation as the authoritative source that code must conform to.

> **Canonical** (adj.): accepted as being accurate and authoritative; the standard form.

### 2.2 CDD vs Other Methodologies

| Methodology | Core Idea | Limitation |
|-------------|-----------|------------|
| **TDD** (Test-Driven) | Write tests first, then code | Only covers correctness, not architecture or design intent |
| **BDD** (Behavior-Driven) | Write behaviors first, then code | Only covers user-facing behavior, not system internals |
| **SDD** (Spec-Driven) | Write specs first, then generate code | Stops after code generation — no ongoing governance |
| **DDD** (Domain-Driven) | Model the domain first | Focuses on domain modeling, not documentation lifecycle |
| **CDD** (Canonical-Driven) | **Write canonical docs first, code conforms, drift is tracked forever** | — |

### 2.3 CDD Lifecycle

CDD is not a phase — it's the entire lifecycle:

```
┌─────────────────────────────────────────────────────────────────┐
│               Canonical-Driven Development                      │
│                                                                 │
│  Phase 1: DEFINE              Phase 2: BUILD                    │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ Write canonical  │    →    │ Implement from   │               │
│  │ docs (design     │         │ canonical docs   │               │
│  │ intent)          │         │ (SDD lives here) │               │
│  └─────────────────┘          └────────┬────────┘               │
│                                        │                        │
│  Phase 3: GUARD               Phase 4: EVOLVE                   │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ Validate code    │    ←    │ Update canonical  │              │
│  │ matches docs     │    →    │ docs, log drift,  │              │
│  │ (DocGuard)      │         │ track changes     │              │
│  └─────────────────┘          └─────────────────┘               │
│                                                                 │
│  ↺ Continuous — Phases 2-4 repeat for every change              │
└─────────────────────────────────────────────────────────────────┘
```

**SDD (Spec-Driven Development) is Phase 1-2.** CDD adds Phase 3-4 and loops forever.

### 2.4 The Two-Tier Documentation Model

| Tier | Location | Purpose | Editing Rules |
|------|----------|---------|---------------|
| **Canonical** | `docs-canonical/` | Design intent — the "blueprint" | READ-ONLY during implementation. Only updated through deliberate design changes. |
| **Implementation** | `docs-implementation/` | Current state — what's actually built | Living documents, updated as code changes. |

When code must deviate from canonical docs:
1. Add `// DRIFT: reason` inline comment in the code
2. Log the deviation in `DRIFT-LOG.md`
3. Never silently deviate — all drift is conscious and documented

### 2.5 DocGuard: The CDD Enforcement Tool

| Mode | Command | What It Does |
|------|---------|-------------|
| **🔍 Audit** | `docguard audit` | Scan a project, report what documentation exists or is missing |
| **🏗️ Generate** | `docguard generate` | Analyze a codebase, auto-create canonical documentation |
| **✅ Guard** | `docguard guard` | Validate that code stays aligned with its documentation |

---

## 3. Design Principles

1. **Markdown-native** — All documentation is plain markdown. No proprietary formats. Any tool, any editor, any agent can read it.

2. **Language-agnostic** — Works for JavaScript, Python, Java, Go, Rust, Swift, Kotlin, or any language that uses files. Validation is file-system-based, not syntax-based.

3. **Agent-agnostic** — Not tied to any specific AI agent or IDE. Works with Claude Code, Gemini CLI, GitHub Copilot, Cursor, Windsurf, Kiro, or any future agent.

4. **Progressive adoption** — Projects can adopt one piece at a time. Start with `ARCHITECTURE.md`, add more as needed. No all-or-nothing requirement.

5. **Documentation-first** — Canonical docs should be written BEFORE or ALONGSIDE code, not after. When starting a new project, write the docs first. When adopting CDD on an existing project, generate docs from the codebase.

6. **Drift-aware** — Code will sometimes deviate from specs. Instead of pretending it doesn't, this standard provides a structured way to document and track deviations.

7. **Enterprise-grade** — Designed for real production systems, not toy projects. Supports compliance, audit trails, and architectural governance.

---

## 4. File Structure

### 4.1 Required Files (Core)

Every CDD-compliant project MUST have these files:

```
project-root/
├── docs-canonical/              # Design intent (the "blueprint")
│   ├── ARCHITECTURE.md          # System design, components, boundaries
│   ├── DATA-MODEL.md            # Database/storage schemas, entity relationships
│   ├── SECURITY.md              # Auth, permissions, secrets, threat model
│   ├── TEST-SPEC.md             # Required tests, coverage rules, test mapping
│   └── ENVIRONMENT.md           # Environment variables, config, setup requirements
│
├── AGENTS.md                    # Agent behavior rules (or CLAUDE.md)
├── CHANGELOG.md                 # Change tracking (Keep-a-Changelog format)
└── DRIFT-LOG.md                 # Documented deviations from canonical docs
```

### 4.2 Recommended Files (Optional)

These files add depth but are not required for compliance. Adopt as needed for your project type.

```
project-root/
├── docs-canonical/                  # Extended canonical docs
│   ├── FEATURES.md                  # Feature inventory, status, roadmap
│   ├── MESSAGE-FLOWS.md             # API sequences, event flows, integrations
│   ├── DEPLOYMENT.md                # Infrastructure, environments, CI/CD pipelines
│   ├── ADR.md                       # Architecture Decision Records (why decisions were made)
│   ├── ERROR-CODES.md               # Error codes reference, categories, handling patterns
│   └── API-REFERENCE.md             # API surface documentation (or link to OpenAPI spec)
│
├── docs-implementation/             # Current-state docs (living, editable)
│   ├── CURRENT-STATE.md             # What's actually deployed now
│   ├── TROUBLESHOOTING.md           # Known issues, common fixes
│   ├── RUNBOOKS.md                  # Operational procedures
│   └── MIGRATION-GUIDE.md           # Breaking change guides between versions
│
├── AGENT-REFERENCE.md               # Lookup tables: "when X changes, update Y"
├── CONTRIBUTING.md                  # How to contribute (human & AI contributors)
└── README.md                        # Project overview (universal, not DocGuard-specific)
```

> [!NOTE]
> **Project type determines relevance.** A CLI tool may skip `DATA-MODEL.md`. A frontend may have a thin `SECURITY.md`. Use `.docguard.json` to configure which files are required for YOUR project.

### 4.3 Configuration

```
project-root/
└── .docguard.json              # Project-specific config (overrides defaults)
```

---

## 5. File Format Specifications

### 5.1 ARCHITECTURE.md

Describes the system's design: components, layers, boundaries, and how they interact.

**Required sections:**

```markdown
# Architecture

## System Overview
<!-- One-paragraph description of what this system does -->

## Component Map
<!-- List of major components/modules and their responsibilities -->
| Component | Responsibility | Location |
|-----------|---------------|----------|
| API Server | Handles HTTP requests | src/server/ |
| Auth Module | Authentication & authorization | src/auth/ |
| Data Layer | Database access & caching | src/data/ |

## Layer Boundaries
<!-- Which layers can import from which -->
| Layer | Can Import From | Cannot Import From |
|-------|----------------|-------------------|
| Handlers/Controllers | Services, Middleware | Repositories, Database |
| Services | Repositories, Utils | Handlers, Controllers |
| Repositories | Models, Utils | Services, Handlers |

## Tech Stack
<!-- Languages, frameworks, databases, infrastructure -->
| Category | Technology | Version |
|----------|-----------|---------|
| Runtime | Node.js | 20.x |
| Framework | Next.js | 16.x |
| Database | DynamoDB | — |
| Auth | NextAuth | 5.x |

## Diagrams
<!-- Architecture diagrams using Mermaid or linked images -->
```

**Validator checks:**
- File exists in `docs-canonical/`
- Contains `## System Overview` section
- Contains `## Component Map` section
- Contains `## Tech Stack` section

---

### 5.2 DATA-MODEL.md

Describes the data structures: tables, schemas, entities, and their relationships.

**Required sections:**

```markdown
# Data Model

## Entities
<!-- List all data entities/tables/collections -->
| Entity | Storage | Primary Key | Description |
|--------|---------|-------------|-------------|
| User | users table | userId (UUID) | Registered users |
| Order | orders table | orderId (ULID) | Purchase orders |

## Schema Definitions
<!-- For each entity, define fields -->
### User
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| userId | UUID | Yes | Unique identifier |
| email | String | Yes | User email (unique) |
| role | Enum | Yes | admin, user, viewer |
| createdAt | ISO DateTime | Yes | Account creation time |

## Relationships
<!-- How entities relate to each other -->
| From | To | Type | Description |
|------|-----|------|-------------|
| User | Order | 1:many | A user can have many orders |

## Indexes
<!-- Database indexes for query performance -->
| Table | Index Name | Fields | Purpose |
|-------|-----------|--------|---------|
| users | email-index | email | Lookup by email |
```

**Validator checks:**
- File exists in `docs-canonical/`
- Contains `## Entities` section
- Contains at least one entity definition

---

### 5.3 SECURITY.md

Describes the security model: authentication, authorization, secrets handling, and known threats.

**Required sections:**

```markdown
# Security

## Authentication
<!-- How users/agents authenticate -->
| Method | Implementation | Details |
|--------|---------------|---------|
| JWT | RS256 tokens | Issued by auth service, 15min expiry |
| API Key | Header-based | For service-to-service calls |

## Authorization
<!-- Role-based or permission-based access control -->
| Role | Permissions | Scope |
|------|------------|-------|
| admin | read, write, delete, manage-users | All resources |
| user | read, write own | Own resources only |

## Secrets Management
<!-- Where secrets are stored, how they're accessed -->
| Secret | Storage | Access Pattern |
|--------|---------|---------------|
| DB credentials | AWS Secrets Manager | Loaded at startup |
| JWT signing key | Environment variable | Injected by CI/CD |

## Security Rules
<!-- Explicit rules for code to follow -->
- All API routes MUST require authentication except: /health, /public/*
- Secrets MUST NOT appear in code, logs, or error messages
- All user input MUST be validated before processing
- PII (email, phone) MUST be masked in logs
```

**Validator checks:**
- File exists in `docs-canonical/`
- Contains `## Authentication` section
- Contains `## Secrets Management` section

---

### 5.4 TEST-SPEC.md

Declares what tests MUST exist, organized by category. This is the file that no other standard provides.

**Required sections:**

```markdown
# Test Specification

## Test Categories
<!-- Which test types this project requires -->
| Category | Required | Applies To | Suggested Tools |
|----------|----------|-----------|-----------------|
| Unit | ✅ Yes | Services, utilities, helpers | jest, vitest, pytest, junit |
| Integration | ✅ Yes | API routes, DB operations | supertest, httpx, testcontainers |
| E2E | ✅ Yes | Critical user journeys | playwright, cypress, detox |
| Canary | ✅ Yes | Health checks, smoke tests | custom scripts |
| Load | ⚠️ Optional | High-traffic endpoints | k6, artillery, locust |
| Security | ⚠️ Optional | Auth flows, input validation | OWASP ZAP, custom |
| Contract | ⚠️ Optional | Public-facing APIs | pact, dredd |

## Coverage Rules
<!-- Glob patterns defining what must have tests -->
| Source Pattern | Required Test Pattern | Category |
|---------------|----------------------|----------|
| src/services/**/*.ts | tests/unit/**/*.test.ts | Unit |
| src/routes/**/*.ts | tests/integration/**/*.test.ts | Integration |
| src/app/api/**/*.ts | tests/integration/**/*.test.ts | Integration |

## Service-to-Test Map
<!-- Specific mapping of source files to test files -->
| Source File | Unit Test | Integration Test | Status |
|------------|-----------|-----------------|--------|
| src/services/authService.ts | auth.test.ts | auth.integration.ts | ✅ |
| src/services/paymentService.ts | payment.test.ts | — | ⚠️ Missing |

## Critical User Journeys (E2E Required)
<!-- Each journey MUST have a matching E2E test -->
| # | Journey Description | Test File | Status |
|---|-------------------|-----------|--------|
| 1 | Login → Dashboard → View Data | e2e/login-flow.spec.ts | ✅ |
| 2 | Signup → Email Verify → First Login | e2e/signup-flow.spec.ts | ❌ Missing |

## Canary Tests (Pre-Deploy Gates)
<!-- Tests that MUST pass before any deployment -->
| Canary | What It Checks | File |
|--------|---------------|------|
| Health | /health returns 200 | canary/health.test.ts |
| Auth | Login flow works | canary/auth.test.ts |
| DB | Primary table is accessible | canary/db.test.ts |
```

**Validator checks:**
- File exists in `docs-canonical/`
- Contains `## Test Categories` section
- Contains `## Coverage Rules` section
- For each coverage rule: matching test files exist (glob check)
- For each critical journey marked required: test file exists
- For each canary test: test file exists

---

### 5.5 ENVIRONMENT.md

Documents all environment variables, configuration files, and setup requirements needed to run the project.

**Required sections:**

```markdown
# Environment & Configuration

## Prerequisites
<!-- Runtime, tools, and accounts needed -->
| Requirement | Version | Purpose |
|------------|---------|----------|
| Node.js | 20.x+ | Runtime |
| Docker | 24.x+ | Local database |
| AWS CLI | 2.x | Cloud deployment |

## Environment Variables
<!-- All env vars the project needs -->
| Variable | Required | Default | Description | Where to Get |
|----------|----------|---------|-------------|-------------|
| DATABASE_URL | ✅ Yes | — | Database connection string | AWS Console → RDS |
| JWT_SECRET | ✅ Yes | — | Token signing key | Generate: openssl rand -hex 32 |
| API_PORT | ❌ No | 3000 | Server port | — |
| LOG_LEVEL | ❌ No | info | Logging verbosity | — |

## Configuration Files
<!-- Config files and their purpose -->
| File | Purpose | Template |
|------|---------|----------|
| .env.local | Local development secrets | .env.example |
| docker-compose.yml | Local infrastructure | Committed |

## Setup Steps
<!-- How to go from zero to running -->
1. Clone the repository
2. Copy `.env.example` to `.env.local`
3. Fill in required values (see table above)
4. Run `docker compose up -d` (starts local DB)
5. Run `npm install`
6. Run `npm run dev`
```

**Validator checks:**
- File exists in `docs-canonical/`
- Contains `## Environment Variables` section
- Contains `## Setup Steps` section
- If `.env.example` is referenced, it must exist

---

### 5.6 AGENTS.md

Defines behavior rules for AI coding agents working with this project. Compatible with the [AGENTS.md standard](https://agents.md).

**Required sections:**

```markdown
# Agent Instructions

## Project Overview
<!-- What this project is, in 2-3 sentences -->

## Build & Dev Commands
<!-- How to install, build, run, test -->
| Command | Purpose |
|---------|---------|
| npm install | Install dependencies |
| npm run dev | Start development server |
| npm test | Run unit tests |
| npm run test:e2e | Run E2E tests |

## Workflow Rules
<!-- How agents should approach changes -->
1. **Research first** — Check docs-canonical/ before suggesting changes
2. **Confirm before implementing** — Show a plan before writing code
3. **Match existing patterns** — Search codebase for similar implementations
4. **Document drift** — If deviating from canonical docs, add `// DRIFT: reason`
5. **Update changelog** — All changes need a CHANGELOG.md entry

## Code Conventions
<!-- Project-specific style rules -->
- Use TypeScript strict mode
- Use named exports (no default exports)
- Error handling: use Result pattern, no thrown exceptions
- Logging: use structured logger, never console.log

## File Change Rules
<!-- What requires approval -->
- Changes to >3 files require explicit approval
- Schema changes require ADR entry
- Dependency additions require justification
```

**Validator checks:**
- `AGENTS.md` OR `CLAUDE.md` exists at project root
- Contains `## Build & Dev Commands` section
- Contains at least one build/test command

---

### 5.7 CHANGELOG.md

Tracks all project changes. Follows [Keep a Changelog](https://keepachangelog.com/) format.

**Required format:**

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- New feature description

### Changed
- Modified behavior description

### Fixed
- Bug fix description

### Removed
- Removed feature description

## [1.0.0] - 2026-03-01

### Added
- Initial release
```

**Validator checks:**
- File exists at project root
- Contains `## [Unreleased]` section
- When git-staged files exist, `CHANGELOG.md` should also be staged (warning)

---

### 5.8 DRIFT-LOG.md

Documents conscious deviations from canonical docs. Every `// DRIFT: reason` comment in code MUST have a matching entry here.

**Required format:**

```markdown
# Drift Log

Documented deviations from canonical specifications.

## Active Drift

| ID | File | Line | Canonical Doc | Deviation | Reason | Date |
|----|------|------|--------------|-----------|--------|------|
| D-001 | src/auth/jwt.ts | 42 | SECURITY.md | Using HS256 instead of RS256 | Legacy compatibility, migrating in Q2 | 2026-03-01 |
| D-002 | src/api/users.ts | 18 | ARCHITECTURE.md | Direct DB call from handler | Performance optimization, approved in ADR-005 | 2026-03-10 |

## Resolved Drift

| ID | Resolution | Date |
|----|-----------|------|
| D-000 | Migrated to proper service layer | 2026-02-15 |
```

**Validator checks:**
- File exists at project root
- Every `// DRIFT:` comment in source code has a matching entry in this file
- No orphaned drift log entries (entry exists but inline comment was removed)

---

## 6. Inline Code Markers

### 6.1 Drift Marker

When code intentionally deviates from canonical documentation:

```javascript
// DRIFT: Using in-memory cache instead of Redis (DRIFT-LOG D-003)
const cache = new Map();
```

**Rules:**
- Format: `// DRIFT: <reason> (<drift-log-reference>)`
- MUST have matching entry in `DRIFT-LOG.md`
- Language-agnostic: use the comment syntax of your language (`#`, `//`, `/* */`, `--`)

---

## 7. Configuration (.docguard.json)

Project-level configuration file that customizes validation for the specific project.

```json
{
  "$schema": "https://docguard.dev/schema/v0.1.json",
  "projectName": "my-project",
  "version": "0.1",

  "requiredFiles": {
    "canonical": [
      "docs-canonical/ARCHITECTURE.md",
      "docs-canonical/DATA-MODEL.md",
      "docs-canonical/SECURITY.md",
      "docs-canonical/TEST-SPEC.md"
    ],
    "agentFile": ["AGENTS.md", "CLAUDE.md"],
    "changelog": "CHANGELOG.md",
    "driftLog": "DRIFT-LOG.md"
  },

  "sourcePatterns": {
    "routes": "src/routes/**/*.ts",
    "services": "src/services/**/*.ts",
    "tests": "tests/**/*.test.ts"
  },

  "layers": {
    "handlers": {
      "dir": "src/handlers",
      "canImport": ["services", "middleware", "schemas"]
    },
    "services": {
      "dir": "src/services",
      "canImport": ["repositories", "utils", "models"]
    },
    "repositories": {
      "dir": "src/repositories",
      "canImport": ["models", "utils"]
    }
  },

  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "architecture": false,
    "testSpec": true,
    "security": false
  }
}
```

---

## 8. Validator Reference

| # | Validator | Checks | Default | Severity |
|---|-----------|--------|---------|----------|
| 1 | **structure** | All required files exist | ✅ On | Error |
| 2 | **docs-sync** | Source files have matching canonical doc entries | ✅ On | Warning |
| 3 | **drift** | `// DRIFT:` comments have DRIFT-LOG entries | ✅ On | Error |
| 4 | **changelog** | Staged changes have CHANGELOG entries | ✅ On | Warning |
| 5 | **architecture** | Imports follow declared layer boundaries | ❌ Off | Error |
| 6 | **test-spec** | Required tests exist per TEST-SPEC.md | ✅ On | Warning |
| 7 | **security** | No secrets in code, security patterns followed | ❌ Off | Error |
| 8 | **environment** | Env vars documented, .env.example exists | ✅ On | Warning |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks pass |
| 1 | One or more errors (hard failures) |
| 2 | No errors, but warnings present |

---

## 9. Compatibility

### 9.1 With AGENTS.md Standard

DocGuard is fully compatible with the [AGENTS.md standard](https://agents.md). Your `AGENTS.md` file serves dual purpose: both for the AGENTS.md ecosystem and for DocGuard validation.

### 9.2 With GitHub Spec Kit (SDD)

Spec-Driven Development (SDD) is the **Build phase** of CDD. DocGuard can import from Spec Kit projects:

| Spec Kit File | DocGuard Equivalent |
|--------------|---------------------|
| `.specify/memory/constitution.md` | `AGENTS.md` |
| `specs/<feature>/spec.md` | `docs-canonical/FEATURES.md` |
| `specs/<feature>/plan.md` | `docs-canonical/ARCHITECTURE.md` |

Use `docguard init --from-speckit` to bridge.

> [!TIP]
> **CDD encompasses SDD.** If you're already using Spec Kit, you're doing Phase 1-2 of CDD. Add DocGuard for Phase 3-4 (Guard + Evolve) and adopt the full CDD lifecycle.

### 9.3 With Cursor Rules

Cursor rules (`.cursor/rules/`) are IDE-specific. DocGuard's `AGENTS.md` provides the universal equivalent that works across all agents.

### 9.4 With Kiro

Kiro's steering files and specs are IDE-native. DocGuard's markdown files are repo-native and portable. Both can coexist.

---

## 10. Three Modes of Operation

### 10.1 Audit Mode

Scans a project and reports what DocGuard documentation exists or is missing.

```
$ docguard audit

📋 DocGuard Audit — my-project

  docs-canonical/ARCHITECTURE.md   ✅ Exists
  docs-canonical/DATA-MODEL.md     ✅ Exists
  docs-canonical/SECURITY.md       ❌ Missing
  docs-canonical/TEST-SPEC.md      ❌ Missing
  docs-canonical/ENVIRONMENT.md    ❌ Missing
  AGENTS.md                        ✅ Exists
  CHANGELOG.md                     ✅ Exists
  DRIFT-LOG.md                     ❌ Missing

  Score: 4/8 required files (50%)
```

### 10.2 Generate Mode

Analyzes an existing codebase and auto-generates canonical documentation.

```
$ docguard generate

📋 Analyzing codebase...

  Detected: TypeScript / Next.js 16 / DynamoDB
  Routes:   14 API routes
  Services: 8 service files
  Tests:    12 unit tests, 0 E2E tests

🏗️ Generating documentation...
  ✅ docs-canonical/ARCHITECTURE.md (architecture mapped)
  ✅ docs-canonical/DATA-MODEL.md (5 schemas extracted)
  ✅ docs-canonical/SECURITY.md (auth patterns detected)
  ✅ docs-canonical/TEST-SPEC.md (test coverage analyzed)
  ✅ DRIFT-LOG.md (initialized)
  ✅ CHANGELOG.md (initialized)

📊 Project Health: 62/100
```

> **Note**: Generate mode produces high-quality drafts by leveraging AI analysis. Human review is recommended before committing generated docs.

### 10.3 Guard Mode

Validates the project against its own canonical documentation. Designed for CI/CD and pre-commit hooks.

```
$ docguard guard

📋 DocGuard — my-project

  ✅ Structure      7/7 required files present
  ✅ Docs-Sync      14/14 routes documented
  ❌ Drift          2 unlogged drift comments
  ✅ Changelog      CHANGELOG.md updated
  ⚠️ Test-Spec      6/8 services have tests (75%)

  Result: FAIL (1 error, 1 warning)
```

---

## 11. Versioning

This standard follows [Semantic Versioning](https://semver.org/):

- **MAJOR** — Breaking changes to required file structure or format
- **MINOR** — New optional files or validator capabilities
- **PATCH** — Clarifications, typo fixes, examples

Current version: **v0.1.0** (Draft)

---

## 12. License

This standard is released under the [MIT License](https://opensource.org/licenses/MIT).

Projects adopting this standard are free to use, modify, and redistribute it.
