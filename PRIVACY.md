# Privacy Policy — DocGuard

**Effective: 2026-07-16**

DocGuard is a local-first command-line tool. This policy is short because the
honest answer is short: **DocGuard collects nothing.**

## What DocGuard does with your data

- **All analysis runs locally.** Validators, scoring, reports, the MCP server —
  everything reads files on your machine and writes output to your machine.
  Nothing is uploaded, sampled, or "improved" with your code or docs.
- **No telemetry, no analytics, no crash reporting.** There is no phone-home
  code path. The deterministic core makes no network calls at all.
- **No accounts.** DocGuard has no sign-up, no API keys of its own, and no
  server-side component operated by us.

## The explicit, user-initiated exceptions

Three commands can *prepare* outbound actions — each is opt-in, visible, and
executed by you or your own tooling, never silently by DocGuard:

| Command | What happens |
|---------|--------------|
| `docguard feedback` | Builds a **prefilled GitHub issue URL** (redacted and length-capped) and saves a local record. Nothing is sent unless you open the URL and submit it yourself. |
| `docguard upgrade --pr` / `impact --prs` | Shell out to **your** locally-authenticated `gh` CLI to interact with **your** repositories. DocGuard never holds credentials. |
| `docguard mcp --transport http` | Serves read-only tools over HTTP. Binds to loopback by default; binding a non-loopback address **refuses to start** without an `--api-key`. |

## Data written to disk (yours, locally)

State lives under `.docguard/` in your repo (fix history, score history,
caches) and `.docguard.baseline.json` if you create one. All of it is plain
text, in your repository, under your version control — delete it any time.

## Dependencies

One pinned runtime dependency (`@babel/parser`). The npm package is published
from GitHub Actions with provenance attestation, so you can verify the tarball
was built from this repository.

## Changes & contact

Changes to this policy land in this file with a dated entry in
[CHANGELOG.md](CHANGELOG.md). Questions: open an issue at
<https://github.com/raccioly/docguard/issues> (see [SUPPORT.md](SUPPORT.md)).
