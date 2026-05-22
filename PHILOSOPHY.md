# The Philosophy of Canonical-Driven Development

> Why every codebase needs a living, machine-readable memory — and how DocGuard builds and maintains one.

---

## The Problem We're Solving

In 2026, AI coding agents can write thousands of lines of code in minutes. But they have a fatal flaw: **they don't remember.**

Every new session, every new agent, every new conversation starts from zero. The agent re-reads your code, re-derives how the system works, makes assumptions, and builds on them. Humans hit the same wall: a new contributor faces 500 files and a 50-line README.

This is the **comprehension crisis of the AI era:**

> The faster AI writes code, the faster everyone loses the map of what was built.

---

## The Insight

A project needs a **canonical memory** — a complete, structured, always-current description of what the system *is*: every endpoint, screen, entity, the architecture, the tech stack, the setup. Written so an AI agent (or a human) can load it in seconds and understand the whole project without re-reading the code.

DocGuard's job is to **build that memory from the code, keep it true as the code changes, and protect the human reasoning inside it.**

> **Canonical** (adj.): accepted as accurate and authoritative; the standard form.

---

## The Three Pillars of CDD

### Pillar 1: Documentation is a first-class, validated artifact

In traditional development, docs are an afterthought — written late (if at all), never updated, quickly stale. CDD makes documentation a **required, validated, and maintained** artifact, on the same footing as tests. If it isn't validated on every change, it rots; so DocGuard validates it.

### Pillar 2: Two tiers — derived truth and human reasoning

CDD separates documentation into two kinds of content, and treats them differently:

- **Code-derived** (endpoints, entities, screens, tech stack, env vars): DocGuard generates and re-generates these *from the code*. They are mechanical, and DocGuard owns them.
- **Human reasoning** (the "why", design intent, trade-offs, gotchas): authored by people (or an AI agent), and **never overwritten** by the tool.

DocGuard keeps these in the same readable markdown using section markers
(`<!-- docguard:section id=… source=code -->`), so it can refresh the derived
parts surgically while leaving your writing untouched.

### Pillar 3: Generate AND Guard — bidirectional, continuous

Earlier versions of this document framed CDD as "validate code against docs, never generate docs from code." Experience proved that too narrow. The tool people actually want does **both directions, continuously:**

| Direction | Mode | What it does |
|-----------|------|--------------|
| code → docs | **Generate** | Reverse-engineer a complete canonical memory from any codebase. DocGuard scans and builds the code-truth skeleton; an AI agent writes the prose. |
| code ↔ docs | **Sync** | When code changes, refresh the affected doc sections automatically — mechanical where deterministic, agent-assisted for prose. |
| docs ↔ code | **Guard** | Validate that the memory still matches reality. Catch documented-but-deleted endpoints, undocumented routes, missing tests, unlogged drift. |

The CLI orchestrates (scan, structure, verify); the AI agent does the language-specific writing. Together they keep the memory both **complete** and **accurate**.

---

## Complete + Accurate = Trustworthy

A memory is only useful if you can trust it. DocGuard measures two things:

- **Completeness** — is the map whole? (No missing chapters: architecture, data model, API surface, screens, environment.)
- **Accuracy** — does the map match the territory? (The documented endpoints exist; the documented env vars are used; the schemas match the models.)

A document can be beautifully formatted and completely wrong. DocGuard's validators that compare docs against **code truth** are what make a green check mean something — and when a check has nothing to validate, it says so honestly instead of showing a misleading pass.

---

## Any language, any project

DocGuard documents **any** project, not just web/JS. It detects the ecosystem
(JavaScript/TypeScript, Python, Rust, Go, Java/Kotlin, Ruby, PHP, C#) and any
polyglot/monorepo mix, then builds a memory shaped for that project: a Rust CLI
gets a Rust-shaped doc set; a Django app a Django-shaped one; a React app gets
its screens and components.

---

## Why Now?

1. **AI agents are primary developers.** They need structured context to work well. A canonical memory is the highest-leverage context you can give them.
2. **Multi-agent development is real.** Claude Code, Copilot, Cursor, and humans touch the same repo in the same week. They need one shared, current source of truth.
3. **Code volume is exploding; comprehension isn't keeping up.** AI makes adding code trivial. DocGuard makes *understanding* it trivial — and keeps that understanding current.

---

## The Lifecycle

```
generate ──▶ guard ──▶ sync ──▶ guard ──▶ …
  (build)    (verify)  (keep    (verify)
                        current)
```

- **Day 1:** `docguard generate --plan` → a complete first-draft memory of your repo (agent fills the prose).
- **Every change:** `docguard sync` refreshes the derived sections; `docguard guard` verifies; the agent updates prose where flagged.
- **Forever:** the memory stays complete and true. Any agent or human can understand your project in seconds.

---

## CDD and Other Methodologies

- **+ Spec Kit (SDD):** Spec Kit generates code from specs (the build phase); DocGuard maintains the living memory and governance afterward. DocGuard ships as a Spec Kit extension.
- **+ TDD/BDD:** `TEST-SPEC.md` declares what must be tested; DocGuard verifies the tests exist; TDD/BDD drive their implementation.
- **+ Agile:** the memory grows sprint by sprint alongside the code. A 30-line `ARCHITECTURE.md` that is complete, current, and validated beats a 300-page document that's stale.

---

## Academic Foundations

CDD is a practitioner methodology whose patterns align with peer-reviewed research:

- **Generate → validate → evaluate pipeline** — inspired by the AITPG framework (Lopez et al., IEEE TSE 2026): multi-agent generation grounded in standards produces more comprehensive documentation while staying semantically aligned with expert references.
- **Calibrated quality evaluation** — DocGuard's HIGH/MEDIUM/LOW labels and multi-signal scoring adapt the CJE framework from TRACE (Lopez et al., IEEE TMLCN 2026).
- **Standards-grounded generation** — each canonical document maps to a relevant standard (arc42, C4, OWASP ASVS, ISO 29119, OpenAPI, 12-Factor App).

> **Lead researcher**: [Martin Manuel Lopez](https://github.com/martinmanuel9) · [ORCID 0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385), University of Arizona

---

## License

This philosophy document and the CDD methodology are released under the [MIT License](https://opensource.org/licenses/MIT). CDD is an open methodology — anyone can adopt, adapt, and contribute.
