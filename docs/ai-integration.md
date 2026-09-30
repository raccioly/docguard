# AI Integration Guide

DocGuard is **AI-native by design**: a deterministic, zero-LLM core that finds
documentation-code drift, paired with surfaces that let any AI consumer act on
what it finds. The division of labour never changes:

> **Deterministic discovery, LLM judgment.** DocGuard extracts the facts
> (routes, schemas, env vars, documented claims, finding codes); the agent
> reads, verifies, and writes prose. DocGuard never calls an LLM itself.

## Pick your integration surface

| You are… | Use | One-liner |
|----------|-----|-----------|
| An MCP-capable agent (Claude Code, Cursor, …) | **MCP server** | `claude mcp add docguard -- npx docguard-cli mcp` |
| An agent that can run CLI commands | **JSON contract** | `npx docguard-cli guard --format json` |
| A slash-command workflow | **Installed commands** | `docguard init` installs `/docguard.*` into `.agent/commands/` |
| GitHub Code Scanning / SARIF dashboards | **SARIF output** | `npx docguard-cli guard --format sarif` |
| A PR reviewer (human or bot) | **GitHub Action** | inline annotations + sticky doc-impact comment, default on |
| An LLM reading the repo cold | **llms.txt / llms-full.txt / context pack** | `docguard llms`, `llms --full`, `memory --pack` |
| An agent starting one concrete change | **Task context** | `docguard agent --task "Implement acme.feature#FR-001" --format json` |

## MCP server (native tools, no shelling out)

```bash
# Claude Code
claude mcp add docguard -- npx docguard-cli mcp
# any MCP client: stdio transport, JSON-RPC 2.0
npx docguard-cli mcp
```

Every tool is read-only and accepts an optional `projectDir`:

| Tool | Returns |
|------|---------|
| `docguard_guard` | Status, every finding once (stable codes), each code's evidence once (`evidenceByCode`), per-validator status and counts, coverage, unverified-claim count. Pass `detail: "full"` for the complete guard JSON contract |
| `docguard_score` | `{score, grade, categories}` |
| `docguard_explain` | A finding code's contract: title, help, suppression pragma, owning validator |
| `docguard_verify_evidence` | Exact declared statement-to-source checks with scoped verification states |
| `docguard_verify_claims` | Documented numbers/limits/enums as verification tasks — **the caller checks each against the code** |
| `docguard_report` | Commit-stamped compliance evidence with a tamper-evident integrity hash |
| `docguard_docs_for_path` | Which canonical doc lines, agent-instruction lines, `@implements`/`@req` IDs, `@doc` annotations and `covers=` sections describe one file |
| `docguard_doc_structure` | One document's headings (with anchors, line ranges, bytes), section markers and fact markers |
| `docguard_read_section` | One section by id, anchor or heading, bounded (8 KiB default, 32 KiB cap, `nextOffset` when truncated) |
| `docguard_task_context` | The `agent --task` context packet: task-linked requirements, code and test pointers, excerpts |
| `docguard_diagnose` | Failing/warning validators with per-finding suggestions, shaped for action |

The server is read-only (never scaffolds), keeps stdout as a pure JSON-RPC
transport, and turns in-tool failures (e.g. a malformed `.docguard.json`) into
`isError` results instead of dying.

## The JSON contract (CLI automation)

```bash
npx docguard-cli guard --format json
```

| Field | Meaning |
|-------|---------|
| `status` | `PASS` / `WARN` / `FAIL` — severity-aware, matches the exit code (0/2/1) |
| `findings[]` | `{code, severity, confidence, message, location, suggestion}` — codes are stable API (`STR001`, `ENV003`, `XRF002`, …) |
| `nextStep` | The single suggested follow-up command (`null` on PASS) |
| `reportable[]` | Low-confidence findings (possible false positives) — verify before acting |
| `coverage` | Markdown tier map: canonical / tracked / ignored / `unclassified[]` |
| `semanticClaims.count` | Documented counts/limits/enums **not yet verified against code** |
| `validators[]` | Per-validator results — `na` means "nothing to validate", which is not a pass |
| `precisionEvidence` | Benchmark evidence for the finding codes in this run: `coverage` counts how many have ever been measured, `codes[CODE]` is `measured` or `not-measured`, and `caveat` must accompany any quoted rate |

`--compact` (and the MCP tool's default) prints each fact once. Findings are
listed once, without the copies in `reportable` and `validators[].findings`.
Each code's agent-facing evidence (a precision is withheld unless it is
quotable) moves to `evidenceByCode`. Validators keep status, counts and
applicability, and legacy validators without structured findings keep their
messages. An applicability reason that is the standard one for its status
appears once, in `applicabilityReasons`, and `checkCoverage` keeps its counts
without `limitations`, which repeat the validators' applicability. The raw
benchmark statistics per code stay in the full form. The compact response is
50–55% smaller on the benchmark fixtures, and about a quarter smaller for a
result with no findings.

Working with findings:

```bash
npx docguard-cli explain XRF002        # any code → contract, cause, fix, suppression
npx docguard-cli fix --write           # apply deterministic fixes (provenance-checked)
npx docguard-cli feedback              # report a false positive (local-first + prefilled issue)
```

Suppress a confirmed false positive **at the finding site**, never by disabling
a validator: `// docguard:ignore SEC001` on (or above) the flagged line, or
`<!-- docguard:validator <key> n/a — reason -->` in a doc.

## SARIF (GitHub Code Scanning)

```bash
npx docguard-cli guard --format sarif > docguard.sarif
```

Findings map 1:1 onto SARIF 2.1.0 — codes become rules (with the registry's
title/help), locations become regions, low-confidence findings carry a property
bag. Upload with `github/codeql-action/upload-sarif` and DocGuard findings
appear inline on PR diffs and in the Security tab. Exit codes are unchanged
(0/2/1), so the same run can gate and report.

## GitHub Action (PR feedback)

```yaml
permissions: { pull-requests: write }
steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: raccioly/docguard@v0.42.1
    with:
      command: guard
      # both default to 'true':
      # annotations: inline ::error/::warning per finding (capped at 50)
      # pr-comment: sticky comment — verdict, top findings, impacted canonical docs
```

The feedback steps run **even when guard fails** — that is when they matter —
and degrade gracefully on fork tokens and shallow clones.

## Context surfaces (for LLMs reading the repo)

| Artifact | Command | What it is |
|----------|---------|------------|
| `llms.txt` | `docguard llms` | Link index of the canonical docs ([llms.txt standard](https://llmstxt.org)) |
| `llms-full.txt` | `docguard llms --full` | Full doc bodies inlined — one fetch, per-doc 400-line cap |
| `.docguard/context-pack.md` | `docguard memory --pack` | Compact session-start context: guard status, scanner-derived surface counts, doc index with review dates, your AGENTS.md rules verbatim, known drift. Everything derived from code — regenerable, hallucination-free |
| `.docguard-specs.json` | `docguard specs --check` / `--write` | Committed spec lifecycle index: reviewed status and lineage plus deterministic artifact, task, and requirement-scoped test evidence. Requirement prose stays in each authoritative spec. |
| Task-context JSON | `docguard agent --task <text> --format json` | Read-only, bounded excerpts from approved current evidence plus source/test pointers. It excludes retired and unsafe material and abstains when relevance is weak. |

Load the context pack at agent session start; regenerate any time — it is
never hand-edited. `memory --pack --symbols` adds a symbol map, which names the
most central files and their exports within a byte budget. It stays opt-in until
the predeclared v2 benchmark measures it against the plain pack: default-on
needs no regression and a benefit, and a regression means it is not released.

For a concrete change, task context can reduce discovery steps:

```bash
docguard agent --task "Implement acme.payments#FR-003 in src/payments.mjs" --format json
```

Treat the packet as a retrieval aid. Hashes prove which bytes were selected;
they do not prove the prose is correct. Read additional code or documentation
when the task requires it, and use the navigation map when the selector
abstains. Protocol v1 preserved all 27 synthetic task outcomes and reduced
median steps by 50% and latency by 17% versus `memory --pack`, but increased
median uncached input tokens by 80%; teams optimizing token spend may prefer
the context pack.

## One source of truth for agent files

Teams hand-duplicate AGENTS.md into `CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, `GEMINI.md` — and the copies drift. Instead:

```bash
docguard agents --sync    # regenerate the family from AGENTS.md (hash-marked)
docguard agents --check   # CI gate: exit 2 if any generated variant is stale
```

Generated variants carry a source-hash marker. Files you wrote by hand (no
marker) are never touched without `--force`.

## Path-scoped instructions, per harness

Agents load instructions by path, and each harness does it differently.
`docguard rules --for <path>` shows what applies; the Path-Scoped-Rules
validator (PSR001–PSR004) reports scopes and pointers that went stale. The
formats below were checked against each vendor's documentation on 2026-09-30:

| Harness | Files | Scope field | Always loaded |
|---|---|---|---|
| Codex | `AGENTS.override.md` or `AGENTS.md` per directory, root to leaf | none | every file in the chain (32 KiB combined) |
| Claude Code | `CLAUDE.md` / `CLAUDE.local.md` per directory (`AGENTS.md` only when no CLAUDE file exists up the chain); `.claude/rules/**/*.md`; skills | `paths:` (list or comma string) | a rule without `paths:`; a rule whose frontmatter does not parse |
| Cursor | `.cursor/rules/**/*.mdc` at any depth (`.md` there is ignored); nested `AGENTS.md` | `globs:` (comma string) | `alwaysApply: true` |
| GitHub Copilot | `.github/copilot-instructions.md`; `.github/instructions/**/*.instructions.md`; the nearest `AGENTS.md` | `applyTo:` (comma string) | `copilot-instructions.md`, `applyTo: "**"` |
| OpenHands | `.agents/skills/*/SKILL.md`, `.openhands/skills`, legacy `.openhands/microagents` | `paths:` (list or comma string); a slashless pattern matches the file name at any depth | root `AGENTS.md` and `CLAUDE.md`; a legacy microagent with no `triggers:` or `paths:` |

Sources: code.claude.com/docs/en/memory and /skills, cursor.com/docs/context/rules,
docs.github.com (repository custom instructions), agentskills.io/specification
(no path field), docs.openhands.dev/overview/skills, and the Codex AGENTS.md
guide. A slashless `*.md` means the root only in Claude Code and Copilot, but
any depth in OpenHands. DocGuard follows each harness. No harness documents `!`
negation. DocGuard does not evaluate `[...]` classes or nested braces, and
reports those scopes as not checked instead of guessing.

## Slash commands

`docguard init` installs `/docguard.*` commands into `.agent/commands/` (the
spec-kit convention; agents like Claude Code, Copilot, and Cursor pick them
up). They encode the full workflows below — `templates/commands/` in this repo
is the canonical source.

## The agent workflow

```
specs preflight → diagnose → fix (research + write) → guard → verify --evidence → verify --semantic → done
```

1. **`docguard specs preflight`** — before specification, load the current intent
   briefing. After a draft exists, rerun with `--path <spec.md>` and stop planning
   on deterministic blockers. Review semantic overlap manually.
2. **`docguard diagnose`** — one command that identifies everything, with
   AI-ready fix prompts (add `--format json` for structure).
3. **`docguard fix --doc <name>`** — emits research steps + expected structure
   for one doc. Execute the research, write real content, no placeholders.
4. **`docguard guard`** — verify. Loop until PASS.
5. **`docguard verify --evidence`** — evaluate exact, typed declarations against
   local JSON, bounded collections, or saved compatibility reports. Preserve
   each state and its statement-level scope.
6. **`docguard verify --semantic`** — extract every remaining checkable documented claim
   (counts, limits, enums) with the nearest cited code path. **You** compare
   each value against the code: a green guard asserts structure, not the truth
   of documented numbers. This is the highest-value step an agent can run.

Before editing docs after code changes, prefer the mechanical layers:
`docguard sync --write` (regenerates `source=code` marked sections) and
`docguard fix --write` (counts, versions, anchors) — never hand-edit what the
tool can fix deterministically.

## Is your repo readable by agents?

```bash
docguard score
```

The **Agent Readability** block (display-only) measures how well AI consumers
can read the repo: agent entry file, entry-file token budget, section
addressability, structured-content density, machine markers, llms.txt, link
integrity. Each failing metric names its fix.

## Best practices for AI agents

- Read `.docguard-specs.json` before opening prior planning documents. Follow
  only entries whose reviewed context is `current`; tombstones preserve identity
  and recovery without putting retired prose back into normal context.
- Require `specId#requirementId` references for lifecycle evidence. A bare local
  ID or a checked task cannot establish completion across a multi-spec project.
- Run `docguard specs preflight` before drafting and
  `docguard specs preflight --path <spec.md>` before planning. Treat deterministic
  blockers as gates and similarity as review-only context.

1. **MCP first** — native tools beat parsing CLI output.
2. **Trust the codes** — every finding has a stable code; `explain` it before
   acting, suppress at the site with it, report false positives via `feedback`.
3. **Run `guard` after every fix batch** — loop until PASS.
4. **Never treat `na` as a pass** — "nothing to validate" is a coverage gap.
5. **Inspect `evidence` on every configured run** — resolve contradictions,
   stale inputs, inconclusive targets, and unsupported formats before claiming
   the selected statement is current.
6. **Check `semanticClaims.count` on green runs** — run `verify --semantic` for
   the claims that lack unique exact evidence.
7. **Respect the drift protocol** — deviating from canonical docs requires
   `// DRIFT: reason` + a DRIFT-LOG.md entry, not a silent doc rewrite; the
   docs may be right and the code wrong.
8. **`score --tax`** periodically — documentation should stay an asset, not a
   burden.
