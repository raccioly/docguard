# Comparisons & Honest Limitations

> CDD vs the landscape, plus an honest assessment of what will and won't work.

---

## Part 1: CDD vs Everything Else

### CDD vs Spec-Driven Development (Spec Kit)

| Dimension | SDD (Spec Kit) | CDD (DocGuard) |
|-----------|---------------|-----------------|
| **Scope** | Feature-level specs | Full-project documentation |
| **Lifecycle** | Spec → Code (one-time) | Spec ↔ Code (continuous) |
| **Post-generation** | ❌ No governance | ✅ Drift tracking, validation |
| **Test enforcement** | ❌ None | ✅ TEST-SPEC.md with validators |
| **Brownfield support** | Partial | ✅ Generate mode reverse-engineers |
| **Architecture rules** | ❌ None | ✅ Layer boundary enforcement |
| **Change tracking** | ❌ None | ✅ CHANGELOG + DRIFT-LOG |
| **Agent support** | 20+ agents | 25+ agents (same format) |
| **Relationship** | CDD Phase 1-2 | CDD Phase 1-4 (full lifecycle) |

**Verdict**: SDD is a subset of CDD. Use Spec Kit for generation, DocGuard for governance. They complement each other.

---

### CDD vs AGENTS.md Standard

| Dimension | AGENTS.md | CDD |
|-----------|-----------|-----|
| **What it is** | Single instruction file | Full documentation methodology |
| **Scope** | Build/test commands, code style | Architecture, data, security, tests, drift, changelog |
| **Depth** | Shallow (one file, ~200 lines) | Deep (8+ files, full-stack coverage) |
| **Enforcement** | ❌ None (static context) | ✅ CLI validation |
| **Architecture** | Mentioned, not enforced | Enforced via validators |
| **Tests** | ❌ Not covered | ✅ TEST-SPEC.md |
| **Relationship** | CDD includes AGENTS.md | AGENTS.md is one of CDD's 8 required files |

**Verdict**: AGENTS.md is one component of CDD. CDD extends it with canonical docs and machine enforcement.

---

### CDD vs Kiro (AWS)

| Dimension | Kiro | CDD |
|-----------|------|-----|
| **Type** | IDE (proprietary) | Documentation standard + CLI (open-source) |
| **Portability** | ❌ Kiro IDE only | ✅ Any IDE, any agent |
| **Vendor lock-in** | ❌ AWS/Bedrock only | ✅ No vendor lock-in |
| **SDD built-in** | ✅ requirements → design → tasks | ✅ canonical docs → implementation |
| **Post-build governance** | ❌ Limited (hooks only) | ✅ Full governance (drift, tests, architecture) |
| **Reverse engineering** | ❌ No | ✅ Generate mode |

**Verdict**: Kiro is a great IDE but proprietary. CDD is portable and goes deeper on governance.

---

### CDD vs Cursor Rules

| Dimension | Cursor Rules | CDD |
|-----------|-------------|-----|
| **Portability** | ❌ Cursor only | ✅ Universal |
| **Format** | `.mdc` (Cursor-specific) | Markdown (universal) |
| **Enforcement** | ❌ None (suggestions only) | ✅ CLI validation |
| **Scope** | Code style preferences | Full project documentation |

**Verdict**: Cursor rules are IDE preferences. CDD is a project standard. They can coexist.

---

## Part 2: How LLMs ACTUALLY Work With Project Context

> This section exists because the user rightly asked: "Will this actually work with how LLMs process code?"

### What the Research Confirms ✅

**1. LLMs DO read and use project context files.**

AGENTS.md, CLAUDE.md, and similar files are loaded into the LLM's context window at session start. Research confirms these files "act as formal carriers of context, grounding subsequent LLM reasoning and reducing hallucinations" (EmergentMind, 2025). This is not theoretical — it's how Claude Code, Copilot, Cursor, and Antigravity work today.

**CDD impact**: Your canonical docs in `docs-canonical/` are markdown files that agents can read. When `AGENTS.md` says "check `docs-canonical/ARCHITECTURE.md` before making changes," compliant agents will do so.

**2. Context windows are large enough.**

Modern LLMs (March 2026):
- Claude: 200,000 tokens (some tiers: 1M tokens beta)
- GPT-4o: 128,000 tokens
- Gemini: 1M+ tokens

8 canonical docs at ~200 lines each ≈ 1,600 lines ≈ ~8,000 tokens. That's **4% of even the smallest context window.** Context size is NOT a limitation for CDD.

**3. "Context engineering" is a recognized discipline.**

The industry now treats context management as a first-class skill. Tools like Sourcegraph build dedicated "context engines" that rank and retrieve relevant project information. CDD's structured markdown docs are IDEAL for this — clearly labeled, consistently formatted, and easily parseable.

**4. Agents increasingly navigate codebases autonomously.**

By 2025-2026, AI agents don't just read what you give them — they actively explore codebases, collecting context without explicit instructions. Having canonical docs in a known location (`docs-canonical/`) makes this autodiscovery reliable.

---

### Known Risks and Honest Limitations ⚠️

**Here's where I challenge this approach:**

**1. LLMs suffer from "Lost in the Middle" problem.**

Research confirms LLMs prioritize information at the beginning and end of their context window, sometimes overlooking details in the middle. If canonical docs are loaded into a long context, some sections may get less attention.

**CDD mitigation**: Each canonical doc is a separate file, not one giant document. Agents read one file at a time as needed. Additionally, `AGENTS.md` serves as the index/pointer, directing the agent to the specific doc that matters for the current task.

**Is this enough?** Mostly yes. The risk is low because canonical docs are typically 50-200 lines each — well within the attention span of modern LLMs.

**2. Validation is structural, not semantic.**

DocGuard can check:
- ✅ "Does ARCHITECTURE.md exist?" (structure)
- ✅ "Does it have a `## Component Map` section?" (structure)
- ❌ "Is the component map ACCURATE?" (semantic — cannot validate)

If ARCHITECTURE.md says "we use PostgreSQL" but the code switched to MongoDB, DocGuard won't catch it. Only a human (or AI agent reading both code and docs) would notice.

**CDD mitigation**: This is why DRIFT-LOG.md exists. The discipline of logging drift means the HUMAN (or AI agent following the rules) documents when code deviates. It's not perfect — if someone silently deviates without adding `// DRIFT:`, DocGuard won't catch it.

**Is this a fatal flaw?** No. No tool can guarantee content accuracy — not Spec Kit, not Kiro, not anything. What CDD does is make non-compliance VISIBLE (missing drift entries, undocumented routes). It can't prevent bad behavior, but it can flag missing documentation.

**3. Documentation CAN rot — even with validators.**

The #1 criticism of any documentation-first approach: docs go stale. DocGuard validators prevent STRUCTURAL rot (missing files, missing sections). But CONTENT rot (outdated descriptions, wrong version numbers) can still happen.

**CDD mitigation**: 
- CI/CD integration (docguard guard on every PR) catches structural problems
- The two-tier model means canonical docs change LESS frequently than implementation docs
- DRIFT-LOG creates a paper trail that naturally prompts review
- AI agents asked to "research docs first" will flag obvious inconsistencies

**Is this enough?** It's significantly better than no docs or unvalidated docs. But it's honest to say: CDD reduces documentation rot, it doesn't eliminate it.

**4. Upfront effort is real.**

Writing 8 canonical docs before (or alongside) coding takes time. Research shows this can add hours per feature. For a solo developer, this feels expensive.

**CDD mitigation**: 
- Generate mode reverse-engineers docs from existing code — you don't START from zero
- Progressive adoption — start with 2 files, add more over time
- Templates mean you're filling in tables, not writing essays
- The time investment pays back when AI agents onboard instantly

**Is this worth it?** For projects that will be maintained long-term: absolutely. For throwaway scripts: probably not. CDD is for projects that matter.

**5. AI agents don't always follow instructions.**

Even with a well-written AGENTS.md that says "research docs first," agents sometimes skip this step, especially on simple tasks.

**CDD mitigation**: 
- The user's existing enforcement rules (Step 1 Research, Step 2 Confirm) in AGENTS.md help
- DocGuard guard in pre-commit hooks catches the OUTPUT (missing changelog, unlogged drift) regardless of whether the agent followed the process
- This is the same as how linters catch style violations — you don't rely on discipline, you rely on automation

**Is this acceptable?** Yes. No governance system relies on 100% compliance. The combination of agent instructions + automated validation catches most issues.

---

## Part 3: When CDD Works and When It Doesn't

### ✅ CDD Works Best For

| Scenario | Why |
|----------|-----|
| **Long-lived projects** | Docs pay back over months/years of maintenance |
| **Multi-developer teams** | Shared source of truth prevents knowledge silos |
| **Multi-agent workflows** | Different AI agents share canonical context |
| **Enterprise/compliance** | Audit trails, architecture governance |
| **Open-source projects** | New contributors (human or AI) onboard instantly |
| **Projects with existing code but no docs** | Generate mode bootstraps documentation |

### ❌ CDD Adds Overhead Without Payoff For

| Scenario | Why |
|----------|-----|
| **Throwaway scripts** | Not worth documenting a 50-line script |
| **Hackathon/prototype** | Speed matters more than governance |
| **Solo, short-lived projects** | No other humans or agents need to understand it |
| **Projects changing architecture weekly** | Docs would be constantly outdated |

### ⚠️ Requires Judgment

| Scenario | Consideration |
|----------|--------------|
| **Early-stage startups** | Start with 2-3 files, add more as the project stabilizes |
| **Microservices** | Each service gets its own `docs-canonical/` — may feel heavy initially |
| **Data/ML pipelines** | DATA-MODEL.md becomes critical; TEST-SPEC.md needs custom categories |

---

## Part 4: Reverse Engineering — CDD for Existing Projects

The user correctly pointed out: **CDD doesn't require starting from scratch.**

For existing projects without documentation:

```
Existing project (no docs)
        │
        ▼
   docguard generate          ← AI analyzes codebase
        │
        ▼
   docs-canonical/ created     ← High-quality drafts
        │
        ▼
   Human reviews & refines     ← 30 min review vs 30 hours writing
        │
        ▼
   docguard guard enabled     ← Continuous enforcement from here
```

This is a CRUCIAL adoption path because:
1. Most projects in the world don't have canonical docs
2. Nobody wants to spend days writing docs for existing code
3. AI can analyze imports, schemas, routes, and test files to produce 80% accurate docs
4. Humans review and correct the 20% — far easier than starting from zero

---

## Part 5: The Bottom Line

**Is CDD a waste of time?**

No. Here's why, being completely honest:

1. **The problem is real.** AI agents are writing more code, documentation is falling further behind, and projects are losing their design intent. This is not theoretical — it's happening across the industry.

2. **The approach is grounded in proven patterns.** AGENTS.md (25+ agents, Linux Foundation backing), Spec-Driven Development (46K stars on GitHub), and project documentation standards (IEEE 829, ISO 29119) are all established. CDD synthesizes and extends them.

3. **The limitations are manageable.** Every limitation listed above has a mitigation strategy. None of them are fatal flaws. They're tradeoffs that are explicitly acknowledged — which is better than claiming perfection.

4. **Nothing else does governance.** This is the key differentiator. After exhaustive research: Spec Kit generates, AGENTS.md provides context, Kiro ties specs to an IDE. Nobody does continuous validation of project documentation. That gap is real and unaddressed.

5. **It works with how LLMs actually process context.** Context windows are large enough. Structured markdown is the ideal format. Agents do read project files. The architecture of CDD aligns with how these systems actually work.

**The honest risk**: If the open-source community doesn't adopt it, it's still valuable for your own projects. The standard makes YOUR projects better, regardless of whether others use it.
