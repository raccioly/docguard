# The Philosophy of Canonical-Driven Development

> Why every codebase needs a living, machine-readable memory — and how DocGuard builds and maintains one.

---

## The Problem We're Solving

In 2026, agents can write thousands of lines of code in minutes. But they have one big flaw: **they don't remember.**

Every new session, agent or conversation starts from zero. The agent re-reads your code and works out again how the system works. It makes assumptions and builds on them. Humans hit the same wall: a new contributor faces 500 files and a 50-line README.

This is the **comprehension crisis of the AI era:**

> The faster AI writes code, the faster everyone loses the map of what was built.

---

## The Insight

A project needs a **canonical memory**. This is a complete, structured, current description of what the system *is*: every endpoint, screen and entity, plus the architecture, the tech stack and the setup. An agent (or a human) can load it in seconds and understand the whole project without re-reading the code.

DocGuard's job is to **build that memory from the code, keep it true as the code changes, and protect the human reasoning inside it.**

> **Canonical** (adj.): accepted as accurate and authoritative; the standard form.

---

## The Three Pillars of CDD

### Pillar 1: Documentation is a first-class, validated artifact

In traditional development, docs come last. People write them late, if at all, and never update them, so they go stale. CDD makes documentation a **required, validated, and maintained** artifact, like tests. Docs that no one validates on every change rot. So DocGuard validates them.

### Pillar 2: Two tiers — derived truth and human reasoning

CDD splits documentation into two kinds of content and treats them differently:

- **Code-derived** (endpoints, entities, screens, tech stack, env vars): DocGuard generates and regenerates these *from the code*. They are mechanical, and DocGuard owns them.
- **Human reasoning** (the "why", design intent, trade-offs, gotchas): people (or an agent) write this, and the tool **never overwrites** it.

DocGuard keeps both kinds in the same readable markdown. It uses section markers
(`<!-- docguard:section id=… source=code -->`). This lets it refresh the derived
parts and leave your writing untouched.

### Pillar 3: Generate AND Guard — bidirectional, continuous

Earlier versions of this document said CDD means "validate code against docs, never generate docs from code." That was too narrow. People want a tool that works in **both directions, continuously:**

| Direction | Mode | What it does |
|-----------|------|--------------|
| code → docs | **Generate** | Build a complete canonical memory from any codebase. DocGuard scans the code and builds the skeleton from it. An agent writes the prose. |
| code ↔ docs | **Sync** | When code changes, refresh the affected doc sections: automatically for mechanical content, with agent help for prose. |
| docs ↔ code | **Guard** | Check that the memory still matches the code. Find documented endpoints that no longer exist, undocumented routes, missing tests and unlogged drift. |

The CLI scans, structures and verifies. The agent does the language-specific writing. Together they keep the memory **complete** and **accurate**.

---

## Complete + Accurate = Trustworthy

A memory is only useful if you can trust it. DocGuard measures two things:

- **Completeness** — does the memory cover everything? (No missing chapters: architecture, data model, API surface, screens, environment.)
- **Accuracy** — does the memory match the code? (The documented endpoints exist; the documented env vars are used; the schemas match the models.)

A document can be well formatted and completely wrong. DocGuard's validators compare docs against **code truth**, so a green check means something. When a check has nothing to validate, it says so instead of showing a misleading pass.

---

## Any language, any project

DocGuard documents **any** project, not just web/JS. It detects the ecosystem
(JavaScript/TypeScript, Python, Rust, Go, Java/Kotlin, Ruby, PHP, C#) and any
polyglot or monorepo mix. Then it builds a memory that fits the project. A Rust CLI
gets a Rust doc set, a Django app gets a Django doc set, and a React app gets
its screens and components.

---

## Why Now?

1. **Agents are primary developers.** They need structured context to work well. A canonical memory is the most useful context you can give them.
2. **Multi-agent development is real.** Claude Code, Copilot, Cursor, and humans change the same repo in the same week. They need one shared, current source of truth.
3. **Code volume is growing fast; comprehension isn't keeping up.** Agents make adding code easy. DocGuard makes *understanding* it easy, and keeps that understanding current.

---

## The Lifecycle

```
generate ──▶ guard ──▶ sync ──▶ guard ──▶ …
  (build)    (verify)  (keep    (verify)
                        current)
```

- **Day 1:** `docguard generate --plan` → a complete first-draft memory of your repo (the agent fills in the prose).
- **Every change:** `docguard sync` refreshes the derived sections, `docguard guard` verifies, and the agent updates prose where DocGuard flags it.
- **Forever:** the memory stays complete and true. Any agent or human can understand your project in seconds.

---

## CDD and Other Methodologies

- **+ Spec Kit (SDD):** Spec Kit generates code from specs (the build phase). After that, DocGuard maintains the living memory and the governance. DocGuard ships as a Spec Kit extension.
- **+ TDD/BDD:** `TEST-SPEC.md` declares what you must test. DocGuard verifies that the tests exist. TDD/BDD drive how you write them.
- **+ Agile:** the memory grows sprint by sprint alongside the code. A 30-line `ARCHITECTURE.md` that is complete, current, and validated beats a 300-page document that's stale.

---

## Academic Foundations

CDD is a practitioner methodology whose patterns align with peer-reviewed research:

- **Generate → validate → evaluate pipeline** — inspired by the AITPG framework (Lopez et al., IEEE TSE 2026): multi-agent generation grounded in standards produces more comprehensive documentation while staying semantically aligned with expert references.
- **Stratified quality evaluation** — DocGuard's HIGH/MEDIUM/LOW labels and multi-signal scoring use the label names and the composite-scoring structure of the CJE framework from TRACE (Lopez et al., IEEE TMLCN 2026). They are deterministic strata (a validator's check pass-ratio, a finding's heuristic confidence tier), not calibrated probabilities. DocGuard has never measured P(finding is real) and does not claim to. What *is* measured is detector precision on a labeled, deliberately balanced benchmark corpus. [`benchmarks/baseline.json`](benchmarks/baseline.json) publishes it with sample sizes and Wilson 95% bounds, and [VALIDATION.md](VALIDATION.md) summarizes it. Every ratio there carries a caveat: benchmark precision on a balanced corpus is not the base rate of stale claims in your repository.
- **Standards-grounded generation** — each canonical document maps to a relevant standard (arc42, C4, OWASP ASVS, ISO 29119, OpenAPI, 12-Factor App).
- **Enforcement over instructions** — a 2026 ETH Zurich study (138 repos, 5,694 agent PRs) found that the most common style of agent-instruction file *degrades* agent performance. Practitioner reports reach the same conclusion: agents routinely ignore written rules and respect programmatic checks. CDD's answer is to make the docs machine-verified, not only machine-readable.

> **Lead researcher**: [Martin Manuel Lopez](https://github.com/martinmanuel9) · [ORCID 0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385), University of Arizona

---

## License

This philosophy document and the CDD methodology are released under the [MIT License](https://opensource.org/licenses/MIT). CDD is an open methodology — anyone can adopt, adapt, and contribute.
