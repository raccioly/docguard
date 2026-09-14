# Implementation Plan: Task-Specific Agent Context

## Summary

Determine whether a deterministic, provenance-rich evidence packet gives coding
agents a better starting point than task-only prompts or DocGuard's existing
repository-wide context pack. Promote a product interface only after the frozen
evaluation gate passes.

## Technical Context

- Runtime: Node.js 18+ with ES modules and built-in `node:test`.
- Dependencies: Node built-ins plus the existing exact-pinned optional Babel
  parser; R7 adds no package.
- Inputs: task text, configured document roles, approved current spec registry,
  requirement evidence, canonical prose, and source/test path references.
- Output: deterministic bounded JSON/Markdown context packet or explicit
  abstention, with provenance and assurance boundaries.
- Evaluation: local Codex CLI observations scored by hidden executable tests and
  deterministic changed-file policy.

## Project Structure

```text
cli/
├── commands/agent.mjs             # Existing graph and promoted task interface
└── scanners/task-context.mjs      # Candidate selector after evaluation
benchmarks/agent-context/
├── manifest.json                  # Frozen tasks, conditions, model, and gates
├── fixtures/                      # Agent-visible synthetic repositories
├── hidden/                        # Evaluator-only tests and policies
├── run.mjs                        # Materialization, execution, and scoring
└── results/                       # Deterministic aggregate + observed runs
schemas/
├── docguard-agent-context-benchmark.schema.json
└── docguard-agent-context-result.schema.json
tests/
└── task-context.test.mjs
specs/010-task-specific-agent-context/
├── spec.md
├── plan.md
├── research.md
└── tasks.md
```

## Phase 1 — Freeze the contract and protocol

1. Commit the specification, research synthesis, fixtures, metrics, model/harness
   identity, trial count, timeout, and promotion threshold before observations.
2. Keep hidden tests outside agent-visible fixture copies and prove they fail on
   each original repository and pass on the reviewed reference behavior.
3. Separate deterministic fixture and packet digests from mutable run metadata.

## Phase 2 — Build the experimental selector

1. Reuse safe evidence readers, document-role resolution, spec lifecycle state,
   qualified requirement evidence, and existing verification surfaces.
2. Rank exact task references before bounded lexical overlap.
3. Emit a deterministic core with evidence citations, explicit omissions,
   assurance, verification commands, and an abstention state.
4. Expose the candidate to the benchmark harness first. Keep normal CLI behavior
   unchanged until the promotion decision.

## Phase 3 — Run controlled trials

1. Materialize a fresh Git repository per task, condition, and repetition.
2. Use Codex CLI 0.154.0-alpha.6.2, `gpt-5.3-codex-spark`, low reasoning effort,
   workspace-write sandbox, ignored user rules/config, no network instruction,
   one turn, and a 300-second timeout.
3. Run a deterministic shuffled order with seed `docguard-r7-v1`.
4. Apply hidden tests only after the agent exits; record patch, changed files,
   policy results, JSONL event counts, final token usage, latency, and status.

## Phase 4 — Decide and integrate

1. Compare the targeted condition with both baselines under SC-005.
2. If it passes, expose `docguard agent --task <text>` in human and JSON modes,
   document the scope, and lock the packet schema with tests.
3. If it fails, retain the benchmark and report, record why product behavior was
   rejected or deferred, and remove experimental selector code from distribution.
4. Run the supported Node matrix, full suite, package extraction, self-guard, and
   frozen detector benchmark before lifecycle verification.
