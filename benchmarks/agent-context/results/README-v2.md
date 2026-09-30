# Agent context — protocol v2 (symbol map)

<!-- docguard:last-reviewed 2026-09-30 -->

**Status: frozen, not yet run.** No v2 observation exists, so there is no
decision. `memory --pack --symbols` stays opt-in until one is recorded here.

Protocol v2 asks one question: does the symbol map that
`memory --pack --symbols` adds help an agent enough to earn its bytes in every
session? (`specs/036-symbol-map`.) It compares three conditions:
- `task-only`;
- `context-pack`, the plain pack;
- `context-pack-symbols`.

The protocol was committed in `manifest-v2.json` before any model run. The
harness rejects the manifest if its conditions, tasks, thresholds, seed or
fixture digests change (`V2_MANIFEST_DIGEST` in `run.mjs`).

## Tasks

| Task | Fixture | Navigation-bound | Prompt names |
|---|---|---|---|
| `status-alias` | v1, 1 module | no | the file |
| `python-config` | v1, 1 module | no | the file |
| `option-migration` | v1, 1 module | no | the file |
| `ledger-rounding` | `ledger-service`, 29 modules | yes | `acme.ledger#FR-004` |
| `ledger-late-fee` | `ledger-service`, 29 modules | yes | `acme.ledger#FR-007` |
| `ledger-redaction` | `ledger-service`, 29 modules | yes | `acme.ledger#FR-011` |

The navigation-bound prompts name a requirement, never the file, so an agent
has to find the code; that is where a map could help. The three small v1
fixtures measure harm on small projects. Each task has a hidden evaluator and a
reference solution. `node benchmarks/agent-context/run.mjs --protocol v2`
checks that the visible tests pass before and after the reference, and that
the hidden checks fail as expected before and pass after.

## Decision rule (frozen in the manifest)

The rule compares `context-pack-symbols` with `context-pack`.

- **No regression:** at most one additional failed trial, zero additional
  requirement violations, zero additional unnecessary edits, and median
  uncached input tokens and median steps each no more than 5% higher.
- **Benefit:** more successful trials, or a median reduction of at least 15%
  in steps or in latency on the navigation-bound tasks.

| Result | Decision |
|---|---|
| No regression and a benefit | `promote`: the section may be on by default, in the PR that records this result, with a `Budget-Exempt: memory-pack-bytes` line citing it |
| No regression, no benefit | `opt-in`: `--symbols` stays available, off by default |
| Regression | `not-released`: the feature is withdrawn and the spec records "not promoted" with the numbers |
| Missing or infrastructure-failed trial | `incomplete`: no decision |

`decideSymbolPromotion` in `run.mjs` computes the decision from the
observations; nobody overrides it.

## Running it

The matrix is 6 tasks × 3 conditions × 3 repetitions = 54 agent runs. It uses
v1's harness and model (`codex-exec-jsonl-v1`, `gpt-5.3-codex-spark`, reasoning
`low`) and needs the maintainer's own Codex CLI, account and network.

```sh
node benchmarks/agent-context/run.mjs --protocol v2                      # verify fixtures, no model
node benchmarks/agent-context/run.mjs --protocol v2 --run --concurrency 3 # the 54-run matrix
```

Observations go to `results/observed-v2.json`
(`schemas/docguard-agent-context-result-v2.schema.json`) and keep every run.
The v1 manifest, fixtures, thresholds and result are unchanged.
