# Project Vision v2 — Updated With User Decisions

> **Date**: March 12, 2026  
> **Status**: DRAFT v2 — Incorporating user feedback  
> **Changes from v1**: Added auto-generation mode, expanded test spec, confirmed standard-first, Spec Kit bridge strategy, updated naming

---

## What Changed in v2

| Decision | v1 | v2 (User Decision) |
|----------|----|--------------------|
| **Core capability** | Validate only | **Validate + AUTO-GENERATE docs from existing codebases** |
| **Approach** | CLI or standard first? | **Standard first** (document what already works) |
| **Test spec** | Basic categories | **Full test taxonomy**: unit, integration, E2E, canary, load, security |
| **Spec Kit** | Complement or compete? | **Bridge** — learn from it, complement it, improve where possible |
| **Name** | Undecided | Shortlisted below (researched availability) |

---

## The Big Shift: Not Just Validation — AUTO-GENERATION

This is the key insight that separates this project from everything else:

```
Most tools:     spec → code      (one direction, one time)
Spec Kit:       spec → code      (one direction, one time)
Your project:   code ↔ spec      (BIDIRECTIONAL, CONTINUOUS)
```

### Three Modes of Operation

| Mode | When To Use | What Happens |
|------|------------|--------------|
| **🔍 Audit** | "What docs am I missing?" | Scans project, reports what exists/missing |
| **🏗️ Generate** | "Create docs for my existing project" | Analyzes codebase, generates canonical docs |
| **✅ Guard** | "Validate my project stays aligned" | Validates code matches docs (CI/pre-commit) |

### How Auto-Generation Works

For an existing project with NO docs:

```
$ canon init --generate

📋 Analyzing project structure...

  Found: Next.js project (TypeScript)
  Routes: 14 API routes in src/app/api/
  Services: 8 service files in src/services/
  Models: 5 schema files in src/schemas/
  Tests: 12 test files (jest), 0 E2E tests
  Auth: NextAuth + JWT pattern detected
  Database: DynamoDB (aws-sdk usage found)

🏗️ Generating canonical documentation...

  ✅ Created: docs-canonical/ARCHITECTURE.md
     - Auto-detected: Next.js App Router, DynamoDB, NextAuth
     - Mapped: 14 routes → 8 services → 5 schemas
     - Layer diagram generated

  ✅ Created: docs-canonical/DATA-MODEL.md
     - Extracted: 5 Zod schemas → table definitions
     - Relationships mapped

  ✅ Created: docs-canonical/SECURITY.md
     - Detected: NextAuth config, JWT strategy
     - Flagged: 2 routes without auth middleware

  ✅ Created: docs-canonical/TEST-SPEC.md
     - Existing: 12 unit tests covering 6/8 services
     - Missing: E2E tests (0 found)
     - Missing: 2 services with no tests (authService, cacheService)
     - Recommended: canary tests for critical flows

  ⚠️ Created: DRIFT-LOG.md (empty — starting fresh)
  ⚠️ Created: CHANGELOG.md (initialized with [Unreleased])
  ✅ Created: AGENTS.md (from your standard template)

📊 Project Health Score: 62/100
   - Structure: ✅ Complete
   - Docs: ✅ Generated (review recommended)
   - Tests: ⚠️ 75% service coverage, 0% E2E
   - Drift: ✅ Clean (fresh start)
```

> [!IMPORTANT]
> **The generated docs are high-quality drafts, not stubs.** The AI (Claude/Gemini/Copilot) does the heavy lifting — analyzing imports, reading schemas, tracing routes. The CLI orchestrates, the AI generates the actual content. This is what makes it enterprise-grade.

### For Projects That Already Have Docs

```
$ canon audit

📋 Auditing existing documentation...

  docs-canonical/ARCHITECTURE.md    ✅ Exists (last updated: 2 months ago)
  docs-canonical/DATA-MODEL.md      ✅ Exists
  docs-canonical/SECURITY.md        ❌ Missing
  docs-canonical/TEST-SPEC.md       ❌ Missing
  AGENTS.md                         ✅ Exists
  CHANGELOG.md                      ✅ Exists
  DRIFT-LOG.md                      ❌ Missing

  Would you like to generate missing docs? (Y/n)
```

---

## Expanded Test Specification

### Test Categories (Language-Agnostic)

| Category | What It Validates | Examples |
|----------|------------------|----------|
| **Unit** | Individual functions/methods work correctly | jest, pytest, junit, go test |
| **Integration** | Components work together (API routes, DB queries) | supertest, httpx, testcontainers |
| **E2E (End-to-End)** | Full user flows work in a real browser/app | playwright, cypress, detox |
| **Canary** | Critical paths still work (smoke tests for prod) | Custom health checks, synthetic monitors |
| **Load** | System handles expected traffic | k6, artillery, locust |
| **Security** | No vulnerabilities, auth works correctly | OWASP ZAP, snyk, custom auth tests |
| **Contract** | API responses match documented contracts | pact, dredd, your /keeper workflow |

### TEST-SPEC.md Structure

```markdown
# Test Specification

## Test Categories Required for This Project
| Category | Required | Applies To | Suggested Tools |
|----------|----------|-----------|-----------------|
| Unit | ✅ Yes | All services, utilities | jest, vitest |
| Integration | ✅ Yes | All API routes | supertest |
| E2E | ✅ Yes | Critical user journeys | playwright |
| Canary | ✅ Yes | Health endpoints, auth flow | custom |
| Load | ⚠️ Optional | High-traffic routes | k6 |
| Security | ✅ Yes | Auth, payment, PII access | custom + OWASP |
| Contract | ⚠️ Optional | Public APIs | pact |

## Service-to-Test Mapping
| Service File | Unit Test | Integration Test | Status |
|-------------|-----------|-----------------|--------|
| src/services/authService.ts | auth.test.ts | auth.integration.ts | ✅ Both exist |
| src/services/paymentService.ts | payment.test.ts | — | ⚠️ Missing integration |
| src/services/cacheService.ts | — | — | ❌ No tests |

## Critical User Journeys (E2E Required)
| # | Journey | Test File | Status |
|---|---------|-----------|--------|
| 1 | Login → Dashboard → View Data | login-flow.e2e.ts | ✅ Exists |
| 2 | Sign Up → Email Verify → First Login | signup-flow.e2e.ts | ❌ Missing |
| 3 | Admin → Create User → Assign Role | admin-flow.e2e.ts | ❌ Missing |

## Canary Tests (Must Pass Before Deploy)
| Canary | What It Checks | File |
|--------|---------------|------|
| Health endpoint | /api/health returns 200 | canary/health.test.ts |
| Auth flow | Login → get token → use token | canary/auth.test.ts |
| DB connectivity | Read from primary table | canary/db.test.ts |

## Coverage Rules
- All files in `src/services/` MUST have a corresponding `.test.*` file
- All files in `src/routes/` or `src/app/api/` MUST have integration tests
- All critical journeys MUST have E2E tests
- All canary tests MUST pass before any deployment
```

### What the CLI Validates

```
$ canon guard --test-spec

📋 Test Spec Validation

  Services with tests:     6/8  (75%)  ⚠️
  Routes with tests:       10/14 (71%) ⚠️
  E2E journeys covered:    1/3  (33%)  ❌
  Canary tests:            3/3  (100%) ✅
  
  Missing:
  ❌ src/services/cacheService.ts has no unit test
  ❌ src/services/exportService.ts has no unit test
  ❌ Critical journey #2 (signup-flow) has no E2E test
  ❌ Critical journey #3 (admin-flow) has no E2E test
  ⚠️ 4 routes missing integration tests

  💡 Suggestions:
  → Create tests/unit/cacheService.test.ts
  → Create tests/unit/exportService.test.ts
  → Create tests/e2e/signup-flow.e2e.ts
  → Create tests/e2e/admin-flow.e2e.ts
```

---

## Naming Research

### Availability Check (March 2026)

| Name | GitHub Org | GitHub Repo | npm | Domain | Verdict |
|------|-----------|-------------|-----|--------|---------|
| `autospec` | — | ✅ Taken (2 projects) | ? | ? | ❌ Taken |
| `devspec` | ✅ Taken (3 repos) | ? | ? | ? | ❌ Org exists |
| `codespec` | ✅ Taken (5 repos) | ? | ? | ? | ❌ Org exists |
| `repospec` | ✅ Taken (empty org) | ? | ? | ? | ⚠️ Org exists but empty |
| `codecanon` | — | — | ✅ Taken (npm) | ? | ❌ npm taken |
| `canonical-spec` | — | Various unrelated | — | ? | ⚠️ Partial matches |

### Proposed Names (Analyzed)

| Name | Pros | Cons | Score |
|------|------|------|-------|
| **`specguard`** | Clear purpose: "guard your specs". Short (9 chars). Action word. | Could sound security-focused | ⭐⭐⭐⭐ |
| **`repoguard`** | "Guard your repo." Universal. Repo-native by name. | A Google project called `repo-guard` exists | ⭐⭐⭐ |
| **`devcanon`** | "Developer canonical." Unique. Memorable. | Not immediately obvious what it does | ⭐⭐⭐ |
| **`projspec`** | "Project specification." Clear. Short. | `fsspec/projspec` exists on GitHub | ⭐⭐ |
| **`canon`** | Shortest possible. "The canon." Authority. | Too generic, hard to search, could mean many things | ⭐⭐ |
| **`specwise`** | "Be wise about your specs." Friendly. | Sounds like a SaaS product | ⭐⭐⭐ |
| **`docguard`** | "Guard your docs." Very clear. | Sounds like a document security tool | ⭐⭐ |
| **`codeprint`** | "The blueprint for your code." Unique. | Could confuse with printing/formatting | ⭐⭐ |
| **`repokit`** | "Your repo toolkit." Matches Spec Kit naming. | Very generic | ⭐⭐ |

### My Recommendation

**`specguard`** — It's:
- 9 characters (sweet spot for memorability)
- Action-oriented: it *guards* your specifications
- Pairs naturally with Spec Kit: "Spec Kit creates, SpecGuard maintains"
- Easy to type: `npx specguard init`, `npx specguard guard`
- Not taken on GitHub or npm (as of research)

But this is YOUR project — pick what feels right to you.

---

## Spec Kit Bridge Strategy

### Learn → Bridge → Improve

| Strategy | What To Do |
|----------|-----------|
| **Learn** | Study Spec Kit's slash commands, file format, and workflow deeply. Understand what resonates with their 46K-star community. |
| **Bridge** | Make SpecGuard work alongside Spec Kit: if you run `specguard init` in a Spec Kit project, detect `.specify/` and import what exists. |
| **Improve** | Your standard goes deeper (governance, tests, drift). Don't apologize for having MORE — that's your value. Where Spec Kit stops (after code generation), you begin. |

### Concrete Compatibility

```
specguard init --from-speckit

📋 Detected Spec Kit project (.specify/ found)

  Importing from Spec Kit:
  ✅ constitution.md → AGENTS.md (agent rules imported)
  ✅ specs/001-feature/spec.md → docs-canonical/FEATURES.md (features mapped)
  ✅ specs/001-feature/plan.md → docs-canonical/ARCHITECTURE.md (architecture extracted)
  
  New (not in Spec Kit):
  🏗️ Generated: docs-canonical/DATA-MODEL.md
  🏗️ Generated: docs-canonical/SECURITY.md
  🏗️ Generated: docs-canonical/TEST-SPEC.md
  🏗️ Generated: DRIFT-LOG.md
  🏗️ Generated: CHANGELOG.md
```

---

## Updated Project Structure

```
specguard/                          (or whatever name you choose)
├── README.md                       # The pitch, quick start, beautiful examples
├── STANDARD.md                     # The full documentation standard definition
├── LICENSE                         # MIT
│
├── cli/                            # The CLI tool
│   ├── specguard.mjs               # Main CLI entry point (zero deps)
│   ├── commands/
│   │   ├── init.mjs                # Initialize a project with canonical docs
│   │   ├── audit.mjs               # Scan and report what's missing
│   │   ├── generate.mjs            # Auto-generate docs from codebase
│   │   └── guard.mjs               # Validate project against standard
│   └── validators/
│       ├── structure.mjs           # Required files exist
│       ├── docs-sync.mjs           # Routes documented
│       ├── drift.mjs               # Drift comments logged
│       ├── changelog.mjs           # Changes documented
│       ├── architecture.mjs        # Layer boundaries
│       ├── test-spec.mjs           # Tests exist per spec
│       └── security.mjs            # No secrets in code
│
├── templates/                      # Starter templates
│   ├── ARCHITECTURE.md.template
│   ├── DATA-MODEL.md.template
│   ├── SECURITY.md.template
│   ├── TEST-SPEC.md.template
│   ├── DRIFT-LOG.md.template
│   ├── CHANGELOG.md.template
│   └── AGENTS.md.template
│
├── configs/                        # Stack-specific configs
│   ├── nextjs.json
│   ├── fastify.json
│   ├── django.json
│   ├── spring-boot.json
│   ├── react-native.json
│   └── generic.json
│
├── bridges/                        # Compatibility with other tools
│   └── speckit.mjs                 # Import from Spec Kit projects
│
├── docs/                           # Project documentation
│   ├── PHILOSOPHY.md               # Why this exists
│   ├── COMPARISONS.md              # vs Spec Kit, AGENTS.md, Kiro
│   ├── CONTRIBUTING.md             # How to contribute
│   └── EXAMPLES.md                 # Real-world usage examples
│
├── Research/                       # Research archive (this folder)
│   ├── 00-landscape-analysis.md
│   ├── 01-github-spec-kit.md
│   ├── 02-other-standards.md
│   ├── 03-your-existing-methodology.md
│   ├── 04-test-documentation-gap.md
│   ├── 05-project-vision.md        # v1
│   └── 06-project-vision-v2.md     # This file
│
└── .github/                        # GitHub-specific
    ├── ISSUE_TEMPLATE/
    └── workflows/
        └── ci.yml                  # Test the CLI itself
```

---

## Confirmed Decisions

| Question | Decision |
|----------|----------|
| Standard vs CLI first? | **Standard first** — document what exists, then build the CLI |
| Validate only? | **No** — Audit, Generate, AND Guard (three modes) |
| Test spec scope? | **Full taxonomy** — unit, integration, E2E, canary, load, security, contract |
| Spec Kit relationship? | **Bridge** — learn, import, complement, improve where better |
| Language-specific? | **No** — language-agnostic, file-system-based checks |
| Open source? | **Yes** — MIT license, GitHub, community contributions |

## Still Need Your Input

1. **Project name** — Review the naming table above. Does `specguard` resonate, or do you prefer something else?
2. **When to start writing STANDARD.md?** — Ready to begin, or want more discussion first?
