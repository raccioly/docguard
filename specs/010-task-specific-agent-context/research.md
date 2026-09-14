# Research: Task-Specific Agent Context

## Evidence synthesis

The strongest direct evidence argues against adding more generic context. The
2026 CTXbench study compared no context, model-generated context, and developer
context across SWE-bench and 138 tasks from 12 less-popular Python repositories.
Context did not significantly improve resolution rate, while generated context
increased inference cost by about 20–23 percent and increased steps. The agents
did follow instructions, which means irrelevant requirements can change behavior
even when they do not improve correctness. The study recommends keeping only
non-standard requirements and evaluating them rigorously.[^1]

Selective retrieval provides a narrower positive result. Repoformer found that
always retrieving cross-file context can be unhelpful or harmful; its learned
selective policy improved completion metrics while using retrieval less often.
Those experiments concern code completion models rather than autonomous issue
resolution, so they motivate abstention and selection but do not prove this
feature will help DocGuard users.[^2]

SWE-bench supplies the appropriate correctness boundary: restore the base
repository, apply the model patch, add tests hidden from the model, and require
both fail-to-pass and pass-to-pass tests to succeed.[^3] OpenAI's published
harness experience independently recommends a short map with progressive
disclosure instead of one large instruction manual, and mechanically maintained
repository knowledge rather than ad hoc prompt stuffing.[^4]

The resulting hypothesis is deliberately limited: exact task-linked requirements
and verification pointers may reduce exploration or prevent constraint misses,
provided weak retrieval abstains. Generic summaries and larger context packs are
not presumed beneficial.

## Frozen evaluation protocol v1

- **Tasks**: three synthetic repositories covering a JavaScript compatibility
  change, a Python path-security change, and a lifecycle-sensitive configuration
  migration. Each has decoy documentation and at least one hidden invariant.
- **Conditions**: task-only; task plus current `memory --pack` output; task plus
  the experimental targeted packet. The task text and terminal instruction are
  otherwise byte-identical.
- **Trials**: three repetitions for every task-condition pair, 27 total. Trial
  order is deterministically shuffled with seed `docguard-r7-v1`.
- **Agent**: Codex CLI 0.154.0-alpha.6.2, `gpt-5.3-codex-spark`, low effort,
  ephemeral one-turn execution, workspace-write sandbox, user config and project
  rules ignored, 300-second timeout. No network use is requested or needed.
- **Scoring**: hidden tests; pass-to-pass tests; changed-file allowlist; explicit
  policy predicates; command/file-change steps from JSONL; final input, cached
  input, output, and reasoning tokens; wall time; and a human-intervention proxy
  equal to one when the patch needs correction to pass.
- **Promotion**: targeted failures may exceed the best baseline by at most one of
  nine trials. Targeted must add zero requirement or unnecessary-edit violations
  relative to either baseline. It must also gain at least one success or reduce
  median uncached input tokens, steps, or latency against full context by at least
  15 percent. Every clause is mandatory.
- **Interpretation**: this is a product gate and regression corpus, not a claim of
  universal agent improvement. A positive result justifies an opt-in bounded
  packet and continued external evaluation.

## Security and validity controls

Fixtures contain synthetic data only. Hidden tests and scoring policy live
outside copied repositories. Trial worktrees have no credentials, no dependencies,
and no network requirement. The selector uses existing safe-reader controls for
path traversal, symlinks, secret names, file size, and read budgets. Raw model
traces are local observations; the committed result retains metrics, patches,
and redacted final messages without credentials or private repository content.

## Rejected shortcuts

- A DocGuard score or LLM judge cannot determine patch correctness.
- One completion per condition cannot establish repeatability.
- Token reduction alone cannot compensate for more hidden-test failures.
- A selector that always returns something cannot distinguish evidence from
  lexical noise.
- Real private repositories are unsuitable for a public reproducible benchmark.

## Sources

[^1]: Thibaud Gloaguen et al., [“Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?”](https://arxiv.org/html/2602.11988v2), revised June 23, 2026.
[^2]: Di Wu et al., [“Repoformer: Selective Retrieval for Repository-Level Code Completion”](https://arxiv.org/html/2403.10059), June 4, 2024.
[^3]: Carlos E. Jimenez et al., [“SWE-bench: Can Language Models Resolve Real-World GitHub Issues?”](https://arxiv.org/html/2310.06770), 2024.
[^4]: OpenAI, [“Harness engineering: leveraging Codex in an agent-first world”](https://openai.com/index/harness-engineering/), 2026.
