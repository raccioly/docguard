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

## MCP server (native tools, no shelling out)

```bash
# Claude Code
claude mcp add docguard -- npx docguard-cli mcp
# any MCP client: stdio transport, JSON-RPC 2.0
npx docguard-cli mcp
```

Five tools, each accepting an optional `projectDir`:

| Tool | Returns |
|------|---------|
| `docguard_guard` | The full guard JSON contract — status, findings (stable codes), coverage, unverified-claim count |
| `docguard_score` | `{score, grade, categories}` |
| `docguard_explain` | A finding code's contract: title, help, suppression pragma, owning validator |
| `docguard_verify_claims` | Documented numbers/limits/enums as verification tasks — **the caller checks each against the code** |
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
  - uses: raccioly/docguard@v0.12.0
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

Load the context pack at agent session start; regenerate any time — it is
never hand-edited.

## One source of truth for agent files

Teams hand-duplicate AGENTS.md into `CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, `GEMINI.md` — and the copies drift. Instead:

```bash
docguard agents --sync    # regenerate the family from AGENTS.md (hash-marked)
docguard agents --check   # CI gate: exit 2 if any generated variant is stale
```

Generated variants carry a source-hash marker. Files you wrote by hand (no
marker) are never touched without `--force`.

## Slash commands

`docguard init` installs `/docguard.*` commands into `.agent/commands/` (the
spec-kit convention; agents like Claude Code, Copilot, and Cursor pick them
up). They encode the full workflows below — `templates/commands/` in this repo
is the canonical source.

## The agent workflow

```
diagnose → fix (research + write) → guard → verify --semantic → done
```

1. **`docguard diagnose`** — one command that identifies everything, with
   AI-ready fix prompts (add `--format json` for structure).
2. **`docguard fix --doc <name>`** — emits research steps + expected structure
   for one doc. Execute the research, write real content, no placeholders.
3. **`docguard guard`** — verify. Loop until PASS.
4. **`docguard verify --semantic`** — extract every checkable documented claim
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

1. **MCP first** — native tools beat parsing CLI output.
2. **Trust the codes** — every finding has a stable code; `explain` it before
   acting, suppress at the site with it, report false positives via `feedback`.
3. **Run `guard` after every fix batch** — loop until PASS.
4. **Never treat `na` as a pass** — "nothing to validate" is a coverage gap.
5. **Check `semanticClaims.count` on green runs** — offer `verify --semantic`.
6. **Respect the drift protocol** — deviating from canonical docs requires
   `// DRIFT: reason` + a DRIFT-LOG.md entry, not a silent doc rewrite; the
   docs may be right and the code wrong.
7. **`score --tax`** periodically — documentation should stay an asset, not a
   burden.
