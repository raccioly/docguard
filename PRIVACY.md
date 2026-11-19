# Privacy Policy — DocGuard

**Effective: 2026-07-16**

DocGuard is a local-first command-line tool. This policy is short because the
answer is short: **DocGuard collects nothing.**

## What DocGuard does with your data

- **All analysis runs locally.** Validators, scoring, reports and the MCP server
  read files on your machine and write output to your machine.
  Nothing is uploaded or sampled. Nothing uses your code or docs to "improve" DocGuard.
- **No telemetry, no analytics, no crash reporting.** There is no code that
  phones home. The deterministic core makes no network calls at all.
- **No accounts.** DocGuard has no sign-up, no API keys of its own, and no
  server-side component that we operate.

## The explicit, user-initiated exceptions

These commands can make or *prepare* outbound actions. Each one is opt-in and
visible. You or your own tooling run it. DocGuard never runs it silently:

| Command | What happens |
|---------|--------------|
| `docguard feedback` | Builds a **prefilled GitHub issue URL** (redacted and length-capped) and saves a local record. DocGuard sends nothing. You must open the URL and submit it yourself. |
| `docguard upgrade --pr` / `impact --prs` | Run **your** locally authenticated `gh` CLI to work with **your** repositories. DocGuard never holds credentials. |
| `docguard upgrade` | Fetches the latest published version from `registry.npmjs.org` to compare it with yours. It does this only when you run it, and it sends no project data. `--apply` runs your own `npm install`. |
| `docguard mcp --transport http` | Serves read-only tools over HTTP. It binds to loopback by default. If you bind a non-loopback address, it **refuses to start** without an `--api-key`. |

## Data written to disk (yours, locally)

DocGuard keeps its state under `.docguard/` in your repo (fix history, score history,
caches) and in `.docguard.baseline.json` if you create one. All of it is plain
text in your repository, under your version control. Delete it any time.

## Dependencies

One pinned runtime dependency (`@babel/parser`). GitHub Actions publishes the npm
package with a provenance attestation. You can use it to verify that the tarball
came from this repository.

## Changes & contact

We record changes to this policy in this file, with a dated entry in
[CHANGELOG.md](CHANGELOG.md). Questions: open an issue at
<https://github.com/raccioly/docguard/issues> (see [SUPPORT.md](SUPPORT.md)).

## The version-age note

If your installed DocGuard was released more than 14 days ago, guard's text
output, the MCP server's instructions and the context pack say so. They also
suggest `docguard upgrade`. The note makes no network call: DocGuard reads its own
release date from the `CHANGELOG.md` it ships with. It compares that date to your
clock. Set `DOCGUARD_NO_UPDATE_HINT=1` to turn it off.
