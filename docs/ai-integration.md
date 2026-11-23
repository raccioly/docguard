---
title: AI Integration
parent: Guides
nav_order: 7
---

# AI Integration Guide

DocGuard is **AI-native by design**. Its core is deterministic and uses no LLM.
It finds drift between your docs and your code. Other tools, such as agents,
then act on what it finds. The work is always split the same way:

> **Deterministic discovery, LLM judgment.** DocGuard extracts the facts
> (routes, schemas, env vars, documented claims, finding codes). The agent
> reads them, verifies them, and writes prose. DocGuard never calls an LLM
> itself.

## Pick your integration surface

| You are… | Use | One-liner |
|----------|-----|-----------|
| An MCP-capable agent (Claude Code, Cursor, …) | **MCP server** | `claude mcp add docguard -- npx docguard-cli mcp` |
| An agent that can run CLI commands | **JSON contract** | `npx docguard-cli guard --format json` |
| A slash-command workflow | **Installed skills and commands** | `docguard init` installs them where your agent reads them ([Coding Agents](reference/agents.md)) |
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

Every tool is read-only and accepts an optional `projectDir`. It must be the
directory the server serves, or a directory inside it, such as a package in a
monorepo. A relative path resolves against the served directory. The served
directory is the one where you started the server, or the one you give with
`--dir`. The server refuses anything else with an `isError` result. A client
cannot point a tool at another part of the disk. To serve more than one project
from one server, name each tree at startup:
`docguard mcp --root ~/work/api --root ~/work/web` (repeatable; applies to
stdio and `--transport http`).


| Tool | Returns |
|------|---------|
| `docguard_guard` | Status, every finding once (stable codes), each code's evidence once (`evidenceByCode`), per-validator status and counts, coverage, unverified-claim count. Pass `detail: "full"` for the complete guard JSON contract |
| `docguard_score` | `{score, grade, categories}` |
| `docguard_explain` | A finding code's contract: title, help, suppression pragma, owning validator |
| `docguard_verify_evidence` | Exact declared statement-to-source checks with scoped verification states |
| `docguard_verify_claims` | Documented numbers/limits/enums as verification tasks — **the caller checks each against the code** |
| `docguard_report` | Commit-stamped compliance evidence with a tamper-evident integrity hash |
| `docguard_docs_for_path` | Which canonical doc lines, agent-instruction lines, `@implements`/`@req` IDs, `@doc` annotations and `covers=` sections describe one file. `docs.lifecycle` names each referencing doc whose header status is not active (`superseded`, `retired`, or its status), so an agent can skip it. `docs.openFindings` gives each doc's finding codes when `docguard sensor --aidlc` has cached a guard run for the exact tree state; `docs.findingsBasis` says whether it has (`sensor-cache` or `no-current-guard-run`). |
| `docguard_doc_structure` | One document's headings (with anchors, line ranges, bytes), section markers and fact markers |
| `docguard_read_section` | One section by id, anchor or heading, bounded (8 KiB default, 32 KiB cap, `nextOffset` when truncated); `possiblyStale` when its document is due for review or its review no longer covers it, and `stalenessBasis` saying what was looked at |
| `docguard_task_context` | The `agent --task` context packet: task-linked requirements, code and test pointers, excerpts |
| `docguard_anchors` | Each `@implements`/`@req` tag, the requirement it resolves to, and the symbol, statement, route or file it anchors to, with its tier |
| `docguard_diagnose` | Failing/warning validators with per-finding suggestions, shaped for action |

The server is read-only and never scaffolds. It keeps stdout as a pure JSON-RPC
transport. When a tool fails (for example, because `.docguard.json` is
malformed), the server returns an `isError` result and keeps running.

**Version-age note.** When the installed release is more than 14 days old,
`initialize` returns `instructions` that say so. They give the version and its
release date. They say that a newer version *may* exist. They also say that the
agent should offer `docguard upgrade` and must not upgrade without the user's
agreement. Guard's text output and the context pack carry the same note. The
DocGuard skills say what to do with it. DocGuard reads its release date from
the `CHANGELOG.md` it ships with, so the note makes no network call. The note
does not appear in a source checkout or when `DOCGUARD_NO_UPDATE_HINT=1` is set.
It never appears in a tool result or in any JSON, SARIF or JUnit output.

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
| `validators[]` | Per-validator results — `na` means "nothing to validate", which is not a pass. Each carries `verdict`: `pass`, `fail`, `empty` (nothing to judge), `inconclusive` (could not decide), `blocked` (threw) or `skipped` (disabled or declared N/A), and `applicability.class` |
| `verdicts` | `counts` per verdict and `gaps[]`: git calls that failed this run (`validator`, `operation`, `cause`, `scope.count`). Findings that depended on a gap were withheld, not reported |
| `precisionEvidence` | Benchmark evidence for the finding codes in this run: `coverage` counts how many have ever been measured, `codes[CODE]` is `measured` or `not-measured`, and `caveat` must accompany any quoted rate |

`--compact` (and the MCP tool's default) prints each fact once. It lists each
finding once, without the copies in `reportable` and `validators[].findings`.
The evidence for each code moves to `evidenceByCode`. DocGuard withholds a
precision there unless you can quote it. Validators keep status, counts and
applicability. Legacy validators without structured findings keep their
messages. If an applicability reason is the standard one for its status, it
appears once, in `applicabilityReasons`. `checkCoverage` keeps its counts but
drops `limitations`, which repeat the validators' applicability. The raw
benchmark statistics per code stay in the full form. The compact response is
50–55% smaller on the benchmark fixtures. It is about a quarter smaller for a
result with no findings.

Working with findings:

```bash
npx docguard-cli explain XRF002        # any code → contract, cause, fix, suppression
npx docguard-cli fix --write           # apply deterministic fixes (provenance-checked)
npx docguard-cli feedback              # report a false positive (local-first + prefilled issue)
```

Suppress a confirmed false positive **at the finding site**. Never disable a
validator to do it: `// docguard:ignore SEC001` on (or above) the flagged line, or
`<!-- docguard:validator <key> n/a — reason -->` in a doc.

## SARIF (GitHub Code Scanning)

```bash
npx docguard-cli guard --format sarif > docguard.sarif
```

Findings map 1:1 onto SARIF 2.1.0. Codes become rules (with the registry's
title and help). Locations become regions. Low-confidence findings carry a
property bag. Upload the file with `github/codeql-action/upload-sarif`. DocGuard
findings then appear inline on PR diffs and in the Security tab. Exit codes do
not change (0/2/1), so the same run can gate and report.

## GitHub Action (PR feedback)

```yaml
permissions: { pull-requests: write }
steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: raccioly/docguard@v0.50.0
    with:
      command: guard
      # both default to 'true':
      # annotations: inline ::error/::warning per finding (capped at 50)
      # pr-comment: sticky comment — verdict, top findings, impacted canonical docs
```

The feedback steps run **even when guard fails**, because that is when you need
them. They still work, with less detail, on fork tokens and shallow clones.

## Context surfaces (for LLMs reading the repo)

| Artifact | Command | What it is |
|----------|---------|------------|
| `llms.txt` | `docguard llms` | Link index of the canonical docs ([llms.txt standard](https://llmstxt.org)) |
| `llms-full.txt` | `docguard llms --full` | Full doc bodies inlined — one fetch, per-doc 400-line cap |
| `.docguard/context-pack.md` | `docguard memory --pack` | Compact session-start context: guard status, scanner-derived surface counts, doc index with review dates, your AGENTS.md rules verbatim, known drift. Everything derived from code — regenerable, hallucination-free |
| `.docguard-specs.json` | `docguard specs --check` / `--write` | Committed spec lifecycle index: reviewed status and lineage plus deterministic artifact, task, and requirement-scoped test evidence. Requirement prose stays in each authoritative spec. |
| Task-context JSON | `docguard agent --task <text> --format json` | Read-only, bounded excerpts from approved current evidence plus source/test pointers. It excludes retired and unsafe material and abstains when relevance is weak. |

Load the context pack when an agent session starts. Regenerate it at any time.
Never edit it by hand. `memory --pack --symbols` adds a symbol map. The map names
the most central files and their exports, within a byte budget. It stays opt-in.
The agent-context benchmark, with its method declared in advance, compared it
with the plain pack (protocol v3, 54 trials, 2026-10-10). It found no regression
and no benefit. Every condition solved every task. On the navigation tasks, the
median steps did not change and the median latency fell 6%. That is below the
15% bar (`benchmarks/agent-context/results/README-v3.md`).

For a concrete change, task context can reduce the steps an agent needs to find the right files:

```bash
docguard agent --task "Implement acme.payments#FR-003 in src/payments.mjs" --format json
```

Treat the packet as a retrieval aid. Hashes prove which bytes DocGuard selected.
They do not prove that the prose is correct. Read more code or docs when the task
needs them. Use the navigation map when the selector abstains. Protocol v1 kept
all 27 synthetic task outcomes. It reduced median steps by 50% and latency by 17%
compared with `memory --pack`. It also increased median uncached input tokens by
80%. A team that wants to save tokens may prefer the context pack.

## One source of truth for agent files

Many teams copy AGENTS.md by hand into `CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md` and `.gemini/settings.json`. The copies then
drift. Use these commands instead:

```bash
docguard agents --sync    # regenerate the family from AGENTS.md (hash-marked)
docguard agents --check   # CI gate: exit 2 if any generated variant is stale
```

Generated variants carry a source-hash marker. DocGuard does not touch files you
wrote by hand (no marker) unless you pass `--force`.

## Path-scoped instructions, per harness

Agents load instructions by path, and each harness does it differently.
`docguard rules --for <path>` shows which instructions apply. The
Path-Scoped-Rules validator (PSR001–PSR004) reports scopes and pointers that
went stale. The formats below were checked against each vendor's documentation on 2026-09-30:

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
guide. A slashless `*.md` means the root only in Claude Code and Copilot, but any
depth in OpenHands. DocGuard follows each harness. No harness documents `!`
negation. DocGuard does not evaluate `[...]` classes or nested braces. It reports
those scopes as not checked and does not guess.

## Slash commands

`docguard init` installs DocGuard's skills. It also installs its `/docguard.*`
commands where the agent reads commands, at the paths your Spec Kit integration
uses. The `/docguard.*` files go to `.agent/commands/` only for Spec Kit's
`generic` integration or when no Spec Kit integration is present. The
[Coding Agents reference](reference/agents.md) lists each agent's paths. The
commands contain the full workflows below. The source of the commands is
`commands/` in this repository.

## The agent workflow

```
specs preflight → diagnose → fix (research + write) → guard → verify --evidence → verify --semantic → done
```

1. **`docguard specs preflight`** — before you write a spec, load the current intent
   briefing. After a draft exists, run it again with `--path <spec.md>`. Stop
   planning if it reports deterministic blockers. Review semantic overlap by hand.
2. **`docguard diagnose`** — one command that finds everything and gives fix
   prompts for the agent (add `--format json` for structured output).
3. **`docguard fix --doc <name>`** — gives research steps and the expected structure
   for one doc. Do the research and write real content. Leave no placeholders.
4. **`docguard guard`** — verify. Repeat until the result is PASS.
5. **`docguard verify --evidence`** — check exact, typed declarations against
   local JSON, bounded collections, or saved compatibility reports. Keep each
   state and its statement-level scope.
6. **`docguard verify --semantic`** — extract every remaining checkable claim in
   your docs (counts, limits, enums) with the nearest cited code path. **You**
   compare each value with the code. A green guard shows that the structure is
   right. It does not show that the documented numbers are true. This is the
   most valuable step an agent can run.

After a code change, use the mechanical steps first, before you edit docs:
`docguard sync --write` (regenerates `source=code` marked sections) and
`docguard fix --write` (counts, versions, anchors). Never edit by hand what the
tool can fix deterministically.

## Is your repo readable by agents?

```bash
docguard score
```

The **Agent Readability** block (display only) measures how well agents can read
the repo. It covers the agent entry file, the entry-file token budget, section
addressability, structured-content density, machine markers, llms.txt and link
integrity. Each failing metric names its fix.

## Best practices for AI agents

- Read `.docguard-specs.json` before you open earlier planning documents. Follow
  only entries whose reviewed context is `current`. Tombstones keep identity and
  recovery, and they keep retired prose out of normal context.
- Require `specId#requirementId` references for lifecycle evidence. A bare local
  ID or a checked task cannot show completion across a project with many specs.
- Run `docguard specs preflight` before you draft, and
  `docguard specs preflight --path <spec.md>` before you plan. Treat
  deterministic blockers as gates. Treat similarity as context for review only.

1. **MCP first** — native tools are better than parsing CLI output.
2. **Trust the codes** — every finding has a stable code. Run `explain` on it
   before you act. Suppress it at the finding site. Report false positives with
   `feedback`.
3. **Run `guard` after every batch of fixes** — repeat until the result is PASS.
4. **Never treat `na` as a pass** — "nothing to validate" is a coverage gap.
5. **Inspect `evidence` on every configured run** — resolve contradictions,
   stale inputs, inconclusive targets and unsupported formats. Do this before
   you say the selected statement is current.
6. **Check `semanticClaims.count` on green runs** — run `verify --semantic` for
   the claims that have no unique exact evidence.
7. **Follow the drift protocol** — to deviate from canonical docs, add
   `// DRIFT: reason` and a DRIFT-LOG.md entry. Do not rewrite the docs
   silently. The docs may be right and the code wrong.
8. **Run `score --tax`** from time to time — documentation should stay an asset,
   not a burden.
