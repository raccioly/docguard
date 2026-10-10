# Agent context — protocol v3 (symbol map, executable pin amended)

<!-- docguard:last-reviewed 2026-10-10 -->

**Status: frozen 2026-10-10, not yet run.** No v3 observation exists, so there
is no decision. `memory --pack --symbols` stays opt-in until one is recorded
here.

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
