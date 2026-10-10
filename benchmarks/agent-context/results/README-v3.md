# Agent context — protocol v3 (symbol map, executable pin amended)

<!-- docguard:last-reviewed 2026-10-10 -->

**Decision: `opt-in`.** All 54 trials ran on 2026-10-10 and every one
succeeded. The symbol map caused no regression, but it did not deliver either
benefit the protocol named in advance, so `memory --pack --symbols` stays
opt-in and the default pack is unchanged. `decideSymbolPromotion` computed this
from `observed-v3.json`, and nobody overrode it.

## Result

| Condition | Success | Requirement violations | Unnecessary edits | Median steps | Median uncached input | Median latency |
|---|---:|---:|---:|---:|---:|---:|
| Task only | 18/18 | 0 | 0 | 8 | 18,261 | 28,101 ms |
| Context pack | 18/18 | 0 | 0 | 8 | 21,287 | 29,283 ms |
| Context pack + symbol map | 18/18 | 0 | 0 | 8 | 21,509 | 27,076 ms |

Navigation-bound tasks only (`ledger-*`, 9 trials per condition):

| Condition | Success | Median steps | Median uncached input | Median latency |
|---|---:|---:|---:|---:|
| Task only | 9/9 | 9 | 20,142 | 28,682 ms |
| Context pack | 9/9 | 8 | 21,480 | 29,568 ms |
| Context pack + symbol map | 9/9 | 8 | 21,554 | 27,797 ms |

How the frozen rule read these numbers (symbol map against the plain pack):

- **No regression: met.** There were no extra failures, requirement
  violations or unnecessary edits. Median uncached input tokens rose 1.0% and
  median steps rose 0%, both within the 5% limits.
- **Benefit: not met.** Success could not rise, because both conditions
  succeeded 18 of 18 times. On the navigation-bound tasks, median steps fell
  0% and median latency fell 6.0%, short of the 15% threshold.

What the numbers do not show. Every condition solved every task, including
`task-only`, so this model did not need help finding the code in the 29-module
fixture. The benchmark measured cost only, and there the map made no
difference large enough to clear the bar set before the run. Per-task medians
move in both directions. On `ledger-late-fee` the map cut median steps from 9
to 6, but on `ledger-rounding` it raised them from 8 to 10. With three
repetitions per cell, these are not findings. The result applies to this model,
this reasoning effort and these fixtures. A different model, a harder fixture
or a stricter step budget would need a new protocol, frozen before it runs.

Provenance. The matrix took 13 min 36 s wall time with concurrency 2, and the
trials took 26.5 min of agent time in total. The result's `manifestDigest` is
`V3_MANIFEST_DIGEST`. Its `harnessDigest` matches `run.mjs` as committed in
the freeze commit, which precedes the run. Codex was `codex-cli
0.162.0-alpha.17.2` on darwin/arm64, Node v24.18.0.

Known confound. `--ignore-user-config` skips `$CODEX_HOME/config.toml` but not
the user-level `$CODEX_HOME/AGENTS.md`, so the maintainer's global agent
instructions were in every trial's context. They were the same in all three
conditions, so the comparison holds, but the absolute step and token counts
include them. A probe before the run showed the agent running, without being
asked, the `git status && git log -1` check those instructions require.

## Why v3 exists (amendment recorded before any run)

Protocol v2 (`README-v2.md`, `manifest-v2.json`) was frozen on 2026-09-30 and
never run. On 2026-10-10 it could not be:

- `run.mjs --protocol v2 --run` stops before the first trial: "Frozen CLI
  version 0.154.0-alpha.6.2 required; found codex-cli 0.162.0-alpha.17.2".
  The installed Codex CLI is the one bundled with the ChatGPT app.
- The v2 model is refused for the maintainer's account: Codex reports that
  `gpt-5.3-codex-spark` is not supported when using Codex with a ChatGPT
  account. Using an API key instead is ruled out.

No v2 trial has run, so no result was seen before this change. The amendment is
recorded in `specs/036-symbol-map/spec.md` (FR-011) and was committed before the
first v3 trial.

## What changed, and what did not

v3 is v2 with only the executable pin changed:

| Field | v2 | v3 |
|---|---|---|
| `protocol.id` | `docguard-agent-context-v2` | `docguard-agent-context-v3` |
| `protocol.frozenAt` | 2026-09-30 | 2026-10-10 |
| `protocol.model.cliVersion` | `0.154.0-alpha.6.2` | `0.162.0-alpha.17.2` |
| `protocol.model.id` | `gpt-5.3-codex-spark` | `gpt-6.1-sol` |

Everything else is identical: reasoning effort `low`, sandbox
`workspace-write`, harness `codex-exec-jsonl-v1`, seed, three repetitions, the
300 s timeout, the three conditions, the six tasks with their fixture and
hidden-evaluator digests, and the promotion rule. `run.mjs` holds
`V3_MANIFEST_DIGEST` and also rejects a v3 manifest that differs from v2
anywhere outside those four fields. The tasks and the decision rule are the
ones described in `README-v2.md`.

## Running it

6 tasks × 3 conditions × 3 repetitions = 54 agent runs, with the maintainer's
own Codex CLI and ChatGPT-account login.

```sh
node benchmarks/agent-context/run.mjs --protocol v3                      # verify fixtures, no model
node benchmarks/agent-context/run.mjs --protocol v3 --run --concurrency 2 \
  --codex /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
```

Observations go to `results/observed-v3.json`, in the v2 result format
(`schemas/docguard-agent-context-result-v2.schema.json`, `protocolId`
`docguard-agent-context-v3`), and keep every run. An interrupted run resumes
from `observed-v3.json.checkpoint`.
