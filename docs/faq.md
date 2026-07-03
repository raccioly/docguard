# Frequently Asked Questions

## General

### What is DocGuard?

DocGuard is an AI-native CLI tool that enforces Canonical-Driven Development (CDD). It ensures your project documentation stays accurate, comprehensive, and in sync with your code — using AI to write and maintain the docs.

### What is CDD?

Canonical-Driven Development is a methodology where documentation is the source of truth. Instead of writing code first and documenting later (which leads to "document rot"), CDD enforces that documentation exists, is structured, and stays fresh.

### Does DocGuard write documentation for me?

**No — but it tells AI what to write.** DocGuard generates structured research prompts that AI agents execute. The AI reads your codebase, writes the documentation, and DocGuard verifies it's correct. Your role: review what the AI wrote.

### What's the difference between DocGuard and just writing docs manually?

DocGuard adds three things:
1. **Structure** — Enforces consistent doc templates across all projects
2. **Enforcement** — Validates docs exist, have required sections, stay fresh
3. **AI automation** — Generates prompts so AI writes the docs, not humans

---

## Commands

### What's the most important command?

**`docguard diagnose`** — it's the primary command. It runs all checks, identifies every issue, and generates AI fix prompts in a single output. Start here.

### What's the difference between `guard` and `diagnose`?

| Command | Purpose | When to use |
|---------|---------|-------------|
| `guard` | Identify issues (pass/fail gate) | CI pipelines, pre-commit hooks |
| `diagnose` | Identify + generate fix prompts | Development, AI agents, fixing docs |

`diagnose` runs `guard` internally and adds the fix layer on top.

### What's the difference between `fix` and `diagnose`?

`fix` generates prompts for individual documents (`fix --doc architecture`). `diagnose` runs everything at once and outputs a combined remediation plan. Use `diagnose` for a full health check; use `fix --doc` when you know exactly which doc needs work.

### What does `generate` do that `init` doesn't?

`init` creates empty skeleton templates. `generate` scans your existing codebase and creates pre-filled docs with real content (detected components, routes, env vars, etc.).

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

Yes. Profile sets the baseline, your config overrides:

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

The time and effort required to maintain documentation. Too little documentation leads to "document rot" (stale, useless docs). Too much enforcement creates "document tax" (developers spend more time on docs than code).

### How does DocGuard avoid document tax?

1. **AI writes the docs** — human cost drops to near-zero
2. **Compliance profiles** — choose the right level for your project
3. **`score --tax`** — measures your actual maintenance cost
4. **Smart enforcement** — only flags when relevant code changed

### What does `score --tax` show?

```
📋 Documentation Tax Estimate
─────────────────────────────────
Tracked docs:        7 files
Active profile:      standard
Est. maintenance:    ~5 min/week
Tax-to-value ratio:  LOW
```

If tax is HIGH, consider using `starter` profile or letting AI handle more.

---

## CI/CD

### How do I add DocGuard to CI?

```bash
npx docguard-cli ci --format json --threshold 70
```

Exit code 0 = pass, 1 = fail. Use `--threshold` to set minimum score.

### Is there a GitHub Action?

Yes — DocGuard ships a template at `templates/ci/github-actions.yml`. Copy it to `.github/workflows/` or use the reusable action in `action.yml`.

### Does DocGuard block commits?

Only if you install hooks (`docguard hooks`). Without hooks, it's advisory only.

---

## Technical

### Does DocGuard have dependencies?

**One.** `@babel/parser` (exact-pinned), for AST-accurate JS/TS parsing — and it's loaded *optionally*, so DocGuard still runs (on the regex fallback tier) if it's ever missing. Everything else is pure Node.js built-ins. Works with Node.js 18+. Python parsing optionally shells out to the project's own `python3`.

### Does it work with non-JavaScript projects?

Yes. DocGuard validates documentation structure, not code. It works with any project that has a `docs-canonical/` directory. Some validators (architecture import analysis) are JavaScript-focused, but the core CDD framework is language-agnostic.

### Does DocGuard read my code?

Yes — for features like `generate`, `diff`, and `architecture` validation. It reads local files only. No data is sent anywhere.

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

Or use a profile that has them disabled by default (like `starter`).

### Can my AI agent use DocGuard without parsing CLI output?

Yes — run the MCP server: `claude mcp add docguard -- npx docguard-cli mcp`
exposes guard, score, explain, verify-claims, and diagnose as native tools for
Claude, Cursor, and any MCP client. For CLI-driven agents, `guard --format json`
is the stable contract (findings with stable codes) and `guard --format sarif`
feeds GitHub Code Scanning. See [AI Integration](./ai-integration.md).

### Guard flagged something that isn't wrong. What do I do?

Suppress it **at the finding site** with its code — `// docguard:ignore SEC001`
on (or above) the flagged line — and report it with `docguard feedback` (a
local-first record plus a one-click prefilled GitHub issue). Don't disable the
whole validator for one false positive.
