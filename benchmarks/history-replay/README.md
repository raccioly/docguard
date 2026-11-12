# History-replay benchmark (FRS006, FRS007)

`node benchmarks/history-replay/run.mjs --repo <path> [--name <label>] [--labels <file>] [--out <file>]`

For every commit that set a document's `docguard:last-reviewed` marker, this replays the
per-reference measure at review + 14, 28 and 56 days, as guard would have computed it then. Each
hit gets a proxy label from what the project did next:

- **true** when the document rewrote a line naming that file (FRS006), or added a mention of that
  script or directory (FRS007), within 56 days of the evaluation point;
- **false** when that 56-day window was fully observed and it did not;
- **unlabeled** when the window runs past the repository's head.

Labels are a proxy, and `--labels` takes a JSON object of hit key to `true`/`false` for human
overrides.

`results-public.json` holds the run on DocGuard (020fa51) and TestGuard (f89ca46), the only
public repositories with review markers. Results from private projects are never committed.

**Limits:**
- Repositories with frequent reviews produce few hits.
- A young repository leaves most windows open: TestGuard's 2026-09-22 `AGENTS.md` hit on
  `src/probe/probe.mjs` (74%) is in the data, but unlabeled, until the rewrite lands.
- Precision is reported only for labeled hits, with a Wilson 95% interval, per role, horizon and
  threshold. FRS006 is emitted only for the agent-instruction role. The canonical rows are
  measured so that widening to that role can be decided on evidence (spec 095 FR-012).
