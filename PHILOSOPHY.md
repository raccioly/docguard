# The Philosophy of Canonical-Driven Development

> Why documentation must come first in the age of AI agents.

---

## The Problem We're Solving

In 2026, AI coding agents can write thousands of lines of code in minutes. They can scaffold entire applications, implement complex features, and refactor entire codebases.

But they have a fatal flaw: **they don't remember.**

Every new session, every new agent, every new conversation starts from zero. The agent reads your code, makes assumptions, and builds on those assumptions. If the assumptions are wrong, the code drifts. If the code drifts long enough, nobody — human or AI — knows what the system was supposed to do in the first place.

This is the **documentation crisis of the AI era:**

> The faster AI writes code, the faster projects lose their design intent.

---

## The Insight

The solution isn't to write better code. It's to write better **canonical documentation** — and make it machine-enforceable.

> **Canonical** (adj.): accepted as being accurate and authoritative; the standard form.

When every AI agent starts by reading canonical documentation that describes what the system IS, what it SHOULD do, and where it has DRIFTED — the agent doesn't need to guess. It doesn't need to reverse-engineer intent from code. It has the source of truth, in a format it can understand instantly.

---

## The Three Pillars of CDD

### Pillar 1: Documentation IS the Source of Truth

In traditional development, code is the source of truth. Documentation is an afterthought — written after code (if at all), rarely updated, and quickly stale.

In CDD, this is inverted:

| Traditional | CDD |
|-------------|-----|
| Code first, docs maybe | Docs first, code conforms |
| Docs describe code | Code implements docs |
| Docs rot silently | Drift is tracked explicitly |
| Docs are optional | Docs are required and validated |

This doesn't mean you write a 500-page specification before writing any code. It means:
- When starting a project, write `ARCHITECTURE.md` before `index.ts`
- When adding a feature, update `FEATURES.md` before opening your editor
- When the code deviates, log it in `DRIFT-LOG.md` instead of pretending the docs are wrong

### Pillar 2: Two Tiers, Two Purposes

CDD separates documentation into two tiers:

**Canonical docs** (`docs-canonical/`) are the blueprint. They represent design intent — what we WANT the system to be. They're updated deliberately, through design decisions, not as a side effect of coding.

**Implementation docs** (`docs-implementation/`) are the map. They represent current state — what we HAVE built. They're updated as code changes, reflecting reality.

The gap between these two tiers is **drift** — and drift is not a bug, it's a feature. Real projects always have some gap between intent and reality. CDD acknowledges this and provides a structured way to track it (`DRIFT-LOG.md`), instead of the traditional approach of either:
- Pretending the docs are still accurate (lying)
- Silently updating docs to match the broken code (losing intent)

### Pillar 3: Machine-Enforceable, Not Machine-Generated

Many tools generate docs from code. CDD does the opposite: it validates code against docs.

This is a fundamental philosophical difference:

| Generated Docs (traditional) | Enforced Docs (CDD) |
|------------------------------|---------------------|
| Machine reads code → produces docs | Machine reads docs → validates code |
| Docs always match code (including bugs) | Docs represent intent (bugs are caught as drift) |
| Docs are disposable artifacts | Docs are authoritative sources |
| No governance, no warnings | Validators catch misalignment |

DocGuard CAN generate docs from existing codebases (for adoption). But the intent is that once generated, those docs become the canonical source — and future code must conform to them.

---

## Why Now?

Three forces are converging in 2025-2026 that make CDD necessary:

### 1. AI Agents Are Becoming Primary Developers

AI agents (Claude, Gemini, Copilot, Cursor) are writing an increasing share of production code. These agents need structured context to work effectively. The better the documentation, the better the output.

### 2. Multi-Agent Development Is Real

It's common for a single project to be worked on by Claude Code, Copilot, Cursor, and a human — sometimes in the same week. Each agent needs a common source of truth. `AGENTS.md` provides behavioral rules; canonical docs provide design knowledge.

### 3. The Documentation Crisis Is Accelerating

AI makes it trivially easy to add code. Nobody is making it easy to maintain documentation. The result: projects with 100,000 lines of code and a 50-line README. CDD addresses this by making documentation a first-class, validated artifact.

---

## CDD and Other Methodologies

CDD doesn't replace existing methodologies. It enhances them:

### CDD + TDD (Test-Driven Development)
Write canonical docs first. The TEST-SPEC.md in your canonical docs declares what tests must exist. TDD then drives the implementation of those tests. CDD governs the test policy; TDD governs the test implementation.

### CDD + BDD (Behavior-Driven Development)
Behavior specifications can live in `docs-canonical/FEATURES.md`. BDD's Given/When/Then scenarios become part of the canonical record. DocGuard can validate that corresponding E2E tests exist.

### CDD + SDD (Spec-Driven Development)
SDD tools like GitHub Spec Kit handle the generation phase (spec → code). CDD adds the governance phase (code ↔ spec, continuously). Use Spec Kit for Phase 1-2 of the CDD lifecycle, then DocGuard for Phase 3-4.

### CDD + Agile/Scrum
Canonical docs don't need to be waterfall-length documents. A 30-line `ARCHITECTURE.md` is valid. The key is that it EXISTS, is MAINTAINED, and is VALIDATED. Sprint-by-sprint, canonical docs grow alongside the codebase.

---

## The CDD Promise

If your project follows CDD:

1. **Any AI agent can onboard** to your project in seconds — not minutes of code analysis, but seconds of reading structured documentation.

2. **Design intent is never lost** — even when the original developer leaves, the canonical docs preserve WHY the system was designed the way it was.

3. **Drift is conscious** — every deviation from the plan is documented, justified, and trackable. No silent rot.

4. **Quality is enforceable** — DocGuard validators run in CI/CD, catching missing tests, undocumented routes, and unlogged drift before code ships.

5. **Documentation stays alive** — because it's validated on every commit, docs can't rot. If code changes, DocGuard catches the misalignment.

---

## Getting Started

CDD is designed for progressive adoption:

**Day 1**: Create `AGENTS.md` and `docs-canonical/ARCHITECTURE.md`. Two files. That's CDD.

**Week 1**: Add `DATA-MODEL.md`, `SECURITY.md`, `TEST-SPEC.md`, `ENVIRONMENT.md`. Run `docguard audit` to see your score.

**Month 1**: Add `DRIFT-LOG.md`, `CHANGELOG.md`. Run `docguard guard` in your pre-commit hook. You're now fully CDD-compliant.

**Forever**: Every commit is validated. Every drift is logged. Every agent understands your project.

---

## License

This philosophy document and the CDD methodology are released under the [MIT License](https://opensource.org/licenses/MIT).

CDD is an open methodology. Anyone can adopt, adapt, and contribute to it.
