# Canonical Spec Kit — Project Vision

> **Date**: March 12, 2026  
> **Status**: DRAFT — For discussion before implementation  
> **Author**: Ricardo Accioly + AI  

---

## One-Line Pitch

> **A documentation standard + CLI that makes project knowledge machine-enforceable — so any AI agent (Claude, Gemini, Copilot, Cursor, or future ones) can understand, build, test, and govern your project.**

---

## The Problem

In 2026, AI agents can write code. But they can't *govern* it.

Today's tools:
- **Spec Kit** generates code from specs. But doesn't ensure code STAYS aligned with specs.
- **AGENTS.md / CLAUDE.md** tells agents how to build. But doesn't validate anything.
- **Cursor Rules** shapes AI behavior. But only inside Cursor.
- **Kiro** ties specs to an IDE. But only works in Kiro.

**What's missing**: a universal, repo-native, language-agnostic standard that defines what every project should document — architecture, data models, security, tests, deployment — AND a CLI that validates the project actually follows its own documentation.

---

## The Solution: Canonical Spec Kit

Two things, open-source, zero-dependency:

### 1. The Standard (documentation spec)
A defined set of markdown files that any project can adopt. These files serve as the "canonical source of truth" for:

- **What are we building?** (architecture, features, data model)
- **How is it secured?** (security model, auth, permissions)
- **What must be tested?** (test spec, coverage requirements, E2E flows)
- **What decisions were made?** (ADRs — architecture decision records)
- **How should AI agents work with this project?** (agent behavior rules)
- **Where has the code drifted from the spec?** (drift log)
- **What changed?** (changelog)

### 2. The CLI (enforcement tool)
A Node.js script (zero dependencies) that validates any project against the standard. Runs validators, reports pass/fail, integrates into CI/CD and pre-commit hooks.

---

## How It Relates to Spec Kit

```
  Spec Kit (Generation)          Canonical Spec Kit (Governance)
  ─────────────────────          ──────────────────────────────
  "Here's what to build"    →    "Is it still built correctly?"
  "Generate from specs"     →    "Validate against specs"
  "Create code"             →    "Guard code"
  
  BEFORE code exists             AFTER code exists (and forever)
```

**They complement each other perfectly:**
1. Use Spec Kit to generate initial specs and code
2. Use Canonical Spec Kit to ensure code stays aligned over time
3. Both use markdown. Both are agent-agnostic. Both are open-source.

---

## The Standard: What Files a Project Should Have

### Required (Core)

| File | Purpose | Validator |
|------|---------|-----------|
| `docs-canonical/ARCHITECTURE.md` | System design, components, boundaries | Structure check |
| `docs-canonical/DATA-MODEL.md` | Database schemas, entity relationships | Structure check |
| `docs-canonical/SECURITY.md` | Auth, permissions, secrets handling | Structure check |
| `docs-canonical/TEST-SPEC.md` | **NEW** — What tests must exist, coverage rules | Test check |
| `AGENTS.md` or `CLAUDE.md` | Agent behavior rules | Structure check |
| `CHANGELOG.md` | Change tracking (Keep-a-Changelog format) | Changelog check |
| `DRIFT-LOG.md` | Documented deviations from canonical docs | Drift check |

### Recommended (Optional)

| File | Purpose |
|------|---------|
| `docs-canonical/FEATURES.md` | Feature inventory and status |
| `docs-canonical/MESSAGE-FLOWS.md` | API flows, event sequences |
| `docs-canonical/DEPLOYMENT.md` | Infrastructure, environments, CI/CD |
| `docs-canonical/ADR.md` | Architecture Decision Records |
| `docs-implementation/` | Current-state documentation (living docs) |
| `AGENT-REFERENCE.md` | Lookup tables: "when X changes, update Y" |

### For Spec Kit Users (Compatibility)

| Spec Kit File | Canonical Spec Kit Equivalent |
|--------------|-------------------------------|
| `.specify/memory/constitution.md` | → `AGENTS.md` (agent governance rules) |
| `specs/<feature>/spec.md` | → `docs-canonical/FEATURES.md` |
| `specs/<feature>/plan.md` | → `docs-canonical/ARCHITECTURE.md` |
| `specs/<feature>/tasks.md` | → (tracked by project management, not canonical docs) |

---

## The CLI: What Gets Validated

### Validators (Progressive — Enable What You Want)

| # | Validator | What It Checks | Default |
|---|-----------|----------------|---------|
| 1 | **Structure** | Required canonical docs exist | ✅ On |
| 2 | **Docs-Sync** | Routes/handlers have matching doc entries | ✅ On |
| 3 | **Drift** | `// DRIFT:` comments have matching DRIFT-LOG entries | ✅ On |
| 4 | **Changelog** | Staged changes reflected in CHANGELOG.md | ⚠️ Warning |
| 5 | **Architecture** | Import patterns follow declared layer boundaries | ❌ Opt-in |
| 6 | **Test Spec** | Required tests exist per TEST-SPEC.md | ✅ On |
| 7 | **Security** | No secrets in code, auth patterns followed | ❌ Opt-in |

### Language Agnostic Design

The CLI reads MARKDOWN files and checks FILE EXISTENCE. It doesn't parse code syntax:

```
✅ "Does src/services/auth.test.ts exist?" (file system check)
✅ "Does DRIFT-LOG.md mention line 42 of auth.ts?" (text search)
✅ "Does CHANGELOG.md have an [Unreleased] section?" (text search)
❌ "Is this function implemented correctly?" (NOT what we do)
```

This means it works for:
- JavaScript/TypeScript (Node, React, Next.js)
- Python (Django, FastAPI, Flask)
- Java (Spring Boot)
- Go, Rust, Swift, Kotlin
- Mobile apps (React Native, Flutter)
- Any language that uses files

---

## The TEST-SPEC.md Innovation

This is the piece nobody else has. A markdown file that declares:

```markdown
# Test Specification

## Required Test Categories
| Category | Applies To | Framework (suggested) |
|----------|-----------|----------------------|
| Unit | All service/utility files | jest, pytest, junit |
| Integration | All API routes/endpoints | supertest, httpx |
| E2E | All user-facing flows | playwright, cypress |

## Feature → Test Mapping
| Feature | Required Tests |
|---------|---------------|
| User authentication | auth.test.*, login.e2e.* |
| Payment processing | payment.test.*, checkout.e2e.* |
| Data export | export.test.* |

## Coverage Rules
- Every file in `src/services/` must have a matching `.test.*` file
- Every route in `src/routes/` must have a matching `.integration.*` file
- All critical user journeys listed below must have E2E tests

## Critical User Journeys (E2E Required)
1. Sign up → Verify email → First login
2. Browse → Add to cart → Checkout → Payment → Confirmation
3. Admin login → Create user → Assign role
```

The CLI can validate:
- ✅ "Test files exist for all services" (glob matching)
- ✅ "E2E tests exist for critical journeys" (file name matching)
- ⚠️ "These 2 services have no tests" (warning report)

---

## Target Audience

| Audience | Why They Care |
|----------|--------------|
| **Solo AI-assisted developers** | "I use Claude/Copilot/Cursor. This makes my projects well-documented so any agent can pick them up." |
| **Open source maintainers** | "Contributors (human or AI) can understand my project instantly." |
| **Teams using AI agents** | "We need governance guardrails. Code drift and undocumented changes are killing us." |
| **Enterprise** | "Compliance, audit trails, architecture enforcement." |

---

## Open Source Strategy

### GitHub Setup
- **License**: MIT (same as Spec Kit, AGENTS.md)
- **Repo name**: `canonical-spec-kit` (or discuss — see naming below)
- **Structure**:
  ```
  canonical-spec-kit/
  ├── README.md              # The pitch, quick start
  ├── STANDARD.md            # The full documentation standard
  ├── cli/
  │   └── canonical-guard.mjs  # The CLI tool
  ├── templates/             # Starter templates for docs-canonical/
  │   ├── ARCHITECTURE.md.template
  │   ├── DATA-MODEL.md.template
  │   ├── SECURITY.md.template
  │   ├── TEST-SPEC.md.template
  │   └── DRIFT-LOG.md.template
  ├── configs/               # Example .canonical-guard.json configs
  │   ├── nextjs.json
  │   ├── fastify.json
  │   ├── python.json
  │   └── java.json
  ├── docs/                  # Docs about the project itself
  │   ├── PHILOSOPHY.md
  │   ├── COMPARISONS.md     # vs Spec Kit, AGENTS.md, Kiro, etc.
  │   └── CONTRIBUTING.md
  └── Research/              # Your research notes (this folder)
  ```

### Naming Discussion

| Option | Pros | Cons |
|--------|------|------|
| `canonical-spec-kit` | Associates with Spec Kit | May imply dependency on Spec Kit |
| `canonical-guard` | Action-oriented, unique | Sounds like a security tool |
| `project-canon` | Clean, memorable | New brand, less association |
| `spec-guard` | Clear purpose | Generic |
| `canon-kit` | Short, catchy | Might be confused with camera brand |

---

## Roadmap (Suggested)

### Phase 1: Define the Standard
- [ ] Write `STANDARD.md` (the spec that defines the spec)
- [ ] Create template files for all canonical docs
- [ ] Write `PHILOSOPHY.md` explaining the "why"
- [ ] Write `COMPARISONS.md` (vs Spec Kit, AGENTS.md, Kiro)

### Phase 2: Build the CLI
- [ ] Build `canonical-guard.mjs` with validators
- [ ] Create `.canonical-guard.json` config schema
- [ ] Create example configs for common stacks
- [ ] Write CLI documentation

### Phase 3: Test on Real Projects
- [ ] Run on your wu-whatsapp-backend
- [ ] Run on your Whatsapp_Inbox
- [ ] Run on CCTAtlanta (different structure — tests portability)
- [ ] Iterate based on findings

### Phase 4: Open Source Launch
- [ ] Polish README with beautiful examples
- [ ] Create GitHub Actions integration
- [ ] Write a blog post / announcement
- [ ] Submit to AGENTS.md ecosystem
- [ ] Cross-reference with Spec Kit community

---

## Key Decisions Needed

1. **Project name** — What do you want to call this?
2. **Standard scope** — Start with core files only, or full recommended set?
3. **TEST-SPEC.md** — Is this the right format? Should it be more structured (JSON/YAML)?
4. **CLI first or Standard first?** — Write the standard document first, or build the tool and let the standard emerge?
5. **Spec Kit compatibility** — Should we actively build a bridge (e.g., auto-generate canonical docs from Spec Kit output)?
