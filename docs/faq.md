---
title: FAQ
nav_order: 6
---

# Frequently Asked Questions

## General

### What is DocGuard?

DocGuard is an AI-native CLI tool that enforces Canonical-Driven Development (CDD). It keeps your project documentation accurate, complete and in sync with your code. AI writes and maintains the docs.

### What is CDD?

Canonical-Driven Development is a method where the documentation is the source of truth. Many teams write code first and document it later, and the docs then rot. CDD requires that the docs exist, have a clear structure and stay fresh.

### Does DocGuard write documentation for me?

**No, but it tells your agent what to write.** DocGuard generates structured research prompts, and agents carry them out. The agent reads your code and writes the documentation. DocGuard then checks that the docs are correct. Your job is to review what the agent wrote.

### What's the difference between DocGuard and just writing docs manually?

DocGuard adds three things:
1. **Structure** — It enforces the same doc templates in all projects.
2. **Enforcement** — It checks that docs exist, have the required sections and stay fresh.
3. **AI automation** — It generates prompts, so an agent writes the docs and people do not.

---

## Commands

### What's the most important command?

**`docguard diagnose`** is the main command. It runs all checks, finds every problem and generates fix prompts for your agent, all in one output. Start here.

### What's the difference between `guard` and `diagnose`?

| Command | Purpose | When to use |
|---------|---------|-------------|
| `guard` | Find problems (pass/fail gate) | CI pipelines, pre-commit hooks |
| `diagnose` | Find problems and generate fix prompts | Development, agents, fixing docs |

`diagnose` runs `guard` internally and adds the fix prompts.

### What's the difference between `fix` and `diagnose`?

`fix` generates prompts for one document at a time (`fix --doc architecture`). `diagnose` runs everything at once and prints one combined fix plan. Use `diagnose` for a full health check. Use `fix --doc` when you know which doc needs work.

### What does `generate` do that `init` doesn't?

`init` creates empty skeleton templates. `generate` scans your existing code and creates pre-filled docs with real content (detected components, routes, env vars and so on).

---

## Profiles

### What profile should I use?

| Situation | Profile |
|-----------|---------|
| Side project, tutorial, prototype | `starter` |
| Team project, active development | `standard` (default) |
| Regulated, enterprise, compliance | `enterprise` |

### Can I switch profiles later?

Yes. Change the `"profile"` field in `.docguard.json` and run `docguard diagnose` to see what's missing.

### Can I override specific validators within a profile?

Yes. The profile sets the baseline, and your config overrides it:

```json
{
  "profile": "starter",
  "validators": {
    "freshness": true
  }
}
```

---

## Document Tax

### What is "document tax"?

The time and effort that documentation needs to stay current. Too little documentation leads to "document rot" (old, useless docs). Too much enforcement creates "document tax" (developers spend more time on docs than on code).

### How does DocGuard avoid document tax?

1. **AI writes the docs** — the cost to people is close to zero.
2. **Compliance profiles** — you choose the right level for your project.
3. **`score --tax`** — it measures your actual maintenance cost.
4. **Smart enforcement** — it flags a doc only when the related code changed.

### What does `score --tax` show?

```
📋 Documentation Tax Estimate
─────────────────────────────────
Tracked docs:        7 files
Active profile:      standard
Est. maintenance:    ~5 min/week
Tax-to-value ratio:  LOW
```

If the tax is HIGH, use the `starter` profile or let your agent do more.

---

## CI/CD

### How do I add DocGuard to CI?

```bash
npx docguard-cli ci --format json --threshold 70
```

Exit code 0 means pass. Exit code 1 means fail. Use `--threshold` to set the minimum score.

### Is there a GitHub Action?

Yes. DocGuard ships a template at `templates/ci/github-actions.yml`. Copy it to `.github/workflows/`, or use the reusable action in `action.yml`.

### Claude (or my AI agent) says DocGuard is "unknown" and wants a legitimacy check. Why?

The agent treats **any** third-party MCP server or npx package this way. MCP
servers run code with your permissions, so the agent asks you to trust an
unknown one. DocGuard is not singled out. DocGuard gives the agent this
information, so the check can pass:

- **npm provenance** — GitHub Actions (Sigstore) signs each release. You can
  verify that the tarball was built from this repository.
- **Official MCP registry** — `io.github.raccioly/docguard` is a verified
  namespace at registry.modelcontextprotocol.io.
- **Read-only annotations** — every MCP tool declares `readOnlyHint`. The
  server never writes and never reaches the network.
- **[PRIVACY.md](../PRIVACY.md)** — no telemetry and no data collection.

To stop the prompt on your own machines, approve it with "Always allow". To
pre-trust it for a whole team, use a project-scoped `.mcp.json` or an
enterprise managed-settings allowlist.

### Does DocGuard block commits?

Only if you install hooks (`docguard hooks`). Without hooks, DocGuard gives advice only.

### I ran guard on our legacy repo and got dozens of findings. Now what?

Freeze them, then move forward:

```bash
npx docguard-cli guard --update-baseline   # writes .docguard.baseline.json — commit it
```

From then on, guard and ci pass. They suppress the frozen findings **visibly**
("N pre-existing finding(s) suppressed") and gate only NEW drift. Fix the
baselined findings at your own pace. `--no-baseline` shows the full picture at
any time.

---

## Document locations

### DocGuard adopted the wrong directory as my canonical docs

DocGuard never adopts a Spec Kit feature folder (`specs/003-my-feature/`). The
spec and data model of one feature are not the project's documentation. If
DocGuard adopted another directory and you did not want that, state the mapping
yourself:

```json
{ "docs": { "roles": { "architecture": "docs/canonical/ARCHITECTURE.md" } } }
```

DocGuard treats an explicit `docs.roles` as your answer and never second-guesses
it. To use DocGuard's own layout instead, remove `docs.roles` and create
`docs-canonical/`. Then run `init` again.

### Why will DocGuard not generate into my mapped documents?

On a mapped layout, `init` configures the project. It scaffolds only the roles
that your mapping has not placed. So it never writes into a document you
maintain, and it never creates a duplicate beside it. Generating or repairing a
mapped document is a separate matter. `setup`, `init --wizard` and
`diagnose --auto` name the mapped roles and stop, because that prose is yours to
edit.

## Technical

### Does DocGuard have dependencies?

**One.** `@babel/parser` (exact-pinned) parses JS and TS accurately. DocGuard loads it *optionally*. If it is missing, DocGuard still runs, on the regex fallback tier. Everything else uses Node.js built-ins only. DocGuard works with Node.js 18 and later. For Python parsing, DocGuard can run the project's own `python3`.

### Does it work with non-JavaScript projects?

Yes. DocGuard checks documentation structure, not code. It works with any project that has a `docs-canonical/` directory. Some validators (architecture import analysis) focus on JavaScript. The core CDD framework works with any language.

### Does DocGuard read my code?

Yes. Features such as `generate`, `diff` and `architecture` validation read it. DocGuard reads local files only. It sends no data anywhere.

### Can I disable validators I don't need?

Yes. In `.docguard.json`:

```json
{
  "validators": {
    "security": false,
    "freshness": false
  }
}
```

Or use a profile that disables them by default (like `starter`).

### Can my AI agent use DocGuard without parsing CLI output?

Yes. Run the MCP server: `claude mcp add docguard -- npx docguard-cli mcp`
exposes guard, score, explain, verify-claims and diagnose as native tools for
Claude, Cursor and any MCP client. For agents that use the CLI, `guard --format json`
is the stable contract (findings with stable codes). `guard --format sarif`
feeds GitHub Code Scanning. See [AI Integration](./ai-integration.md).

### Guard flagged something that isn't wrong. What do I do?

Run `docguard explain <CODE>` first. It says what the finding means and which
marker, if any, silences it. Put `// docguard:ignore <CODE> — reason` on the
flagged line, or above it. This works for the security codes, REF001, REF002 and
SPK010. Other codes have their own markers, listed in
[Finding Codes](reference/findings.md), and some have none. Report the false
positive with `docguard feedback` (a local-first record plus a one-click
prefilled GitHub issue). Do not disable the whole validator for one false
positive. See [Troubleshooting](guides/troubleshooting.md).
