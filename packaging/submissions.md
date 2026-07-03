# DocGuard — Distribution-Channel Submissions (v0.29.0)

Prepared texts and owner checklists for each distribution channel. Everything
here is copy-paste ready; steps marked **(owner)** need Ricardo's accounts.

---

## a) awesome-mcp-servers PR

Repo: https://github.com/punkpeye/awesome-mcp-servers — one line, alphabetical
within the category. Legend used: 🎖️ official implementation · 📇 TypeScript/JavaScript
codebase · 🏠 local service (stdio, runs on the user's machine).

**Category:** 🛠️ Developer Tools

```markdown
- [raccioly/docguard](https://github.com/raccioly/docguard) 🎖️ 📇 🏠 - Deterministic documentation-drift detection for AI agents — guard, score, explain, verify-claims and diagnose tools that validate a project's canonical docs against its code over stdio.
```

**PR title:** `Add DocGuard (deterministic doc-drift detection)`
**PR body:** one sentence — "Adds DocGuard, an official, zero-dependency Node.js MCP server (npm: `docguard-cli`, `docguard mcp`) exposing 5 read-only doc-governance tools."

---

## b) MCP directory blurbs

### mcp.so (https://mcp.so — Submit form)

- **Name:** DocGuard
- **Repository:** https://github.com/raccioly/docguard
- **Install:** `npx -y docguard-cli mcp`
- **Description:** Deterministic doc-drift detection for AI agents. DocGuard
  validates a project's canonical docs against its actual code — no LLM
  guessing, every finding has a stable code and a suggested fix. The MCP
  server exposes 5 read-only tools over stdio: `docguard_guard` (run all
  validators, structured findings), `docguard_score` (CDD maturity 0-100 with
  grade), `docguard_explain` (what a finding code means + suppression),
  `docguard_verify_claims` (extract documented numbers/limits/enums as a
  verification task list), `docguard_diagnose` (only what needs fixing,
  shaped for an agent to act on).
- **Capabilities:** tools only (no resources/prompts); read-only; zero npm
  dependencies at runtime beyond Node.js >= 18; optional per-call `projectDir`
  argument so one server can inspect multiple projects.

### Glama (https://glama.ai/mcp/servers — claimed via GitHub)

- **Name:** DocGuard
- **One-liner (<=100 chars):** Deterministic doc-drift detection: guard, score, explain, verify-claims and diagnose MCP tools.
- **Long description:** DocGuard is the enforcement CLI for Canonical-Driven
  Development. Its MCP server (`docguard mcp`, stdio) gives agents a
  deterministic ground truth about documentation health: which docs drifted
  from code, the project's CDD maturity score, and a pre-digested fix list —
  so the agent spends tokens on judgment, not discovery.
- **Tools:** `docguard_guard`, `docguard_score`, `docguard_explain`,
  `docguard_verify_claims`, `docguard_diagnose`
- **Server command:** `npx -y docguard-cli mcp`
- Glama auto-indexes from GitHub; claiming the server (Sign in with GitHub →
  claim `raccioly/docguard`) unlocks editing the listing and adds the
  "official" badge.

---

## c) GitHub Actions Marketplace listing (owner)

The repo already ships `action.yml` (composite action "DocGuard — CDD
Compliance", icon `shield`, color `blue`). To list it:

1. **(owner)** Ensure the repo is public and `action.yml` is at the repo root
   (it is), with unique `name` in the Marketplace namespace.
2. **(owner)** Create a release: on GitHub → Releases → "Draft a new release" →
   tag `v0.29.0`. The release page shows a "Publish this Action to the
   GitHub Marketplace" checkbox — tick it.
3. Accept the GitHub Marketplace Developer Agreement (first time only) and
   pick two categories — suggested: **Continuous integration** and
   **Code quality**.
4. GitHub validates `name`/`description`/`branding` from `action.yml`
   automatically; fix any flagged fields and publish.
5. Keep the moving major tag updated so users can pin `@v0`:
   `git tag -f v0 v0.29.0 && git push -f origin v0`.

---

## d) GitLab CI/CD Catalog publish (owner — needs a GitLab account)

The component is staged at `templates/ci/gitlab-component.yml` in this repo.
GitLab components must live in their own GitLab project:

1. **(owner)** Create a GitLab project, e.g. `gitlab.com/raccioly/docguard-component`,
   with a short README and this repo linked.
2. Copy `templates/ci/gitlab-component.yml` to `templates/docguard.yml` at that
   project's root (components are discovered from top-level `templates/`).
3. Mark it as a catalog project: Settings → General → Visibility, project
   features, permissions → toggle **CI/CD Catalog project**.
4. Add a release job to the project's `.gitlab-ci.yml`:

   ```yaml
   create-release:
     stage: deploy
     image: registry.gitlab.com/gitlab-org/release-cli:latest
     rules:
       - if: $CI_COMMIT_TAG
     script: echo "Releasing $CI_COMMIT_TAG to the CI/CD Catalog"
     release:
       tag_name: $CI_COMMIT_TAG
       description: "DocGuard component $CI_COMMIT_TAG"
   ```

5. Push a semver tag (`0.29.0`). The release publishes the component; consumers
   then use:

   ```yaml
   include:
     - component: gitlab.com/raccioly/docguard-component/docguard@0.29.0
   ```

Docs: https://docs.gitlab.com/ci/components/#publish-a-new-release

---

## e) Official MCP Registry publish (owner)

`server.json` at the repo root already conforms to the
`2025-12-11` registry schema. To publish to registry.modelcontextprotocol.io:

1. Install the publisher CLI: `brew install mcp-publisher` (or download from
   https://github.com/modelcontextprotocol/registry/releases).
2. From the repo root: `mcp-publisher login github` (the `io.github.raccioly/*`
   namespace is proven via GitHub auth).
3. The npm package must prove ownership: add
   `"mcpName": "io.github.raccioly/docguard"` to `package.json` before the
   next `npm publish` (the registry checks the published package for it).
4. `mcp-publisher publish` — validates `server.json` and creates the listing.
5. Repeat per release (bump both `version` fields in `server.json`).

## f) Smithery (owner)

`smithery.yaml` is staged at the repo root. On https://smithery.ai: sign in
with GitHub → Add server → point it at `raccioly/docguard`. Smithery reads
`smithery.yaml` from the default branch; the stdio command it derives is
`npx -y docguard-cli mcp`.

## g) Homebrew tap (owner)

Formula staged at `packaging/homebrew/docguard.rb` (real sha256 of the
published 0.29.0 npm tarball). Create `github.com/raccioly/homebrew-tap`,
copy the file to `Formula/docguard.rb`, then:

```bash
brew tap raccioly/tap
brew install raccioly/tap/docguard
```

## h) pre-commit (no submission needed)

`.pre-commit-hooks.yaml` at the repo root makes the repo a pre-commit hook
source as soon as the `v0.29.0` git tag exists — consumers reference
`repo: https://github.com/raccioly/docguard, rev: v0.29.0`. Optionally submit
to https://pre-commit.com/hooks.html via PR to pre-commit/pre-commit.com
(`all-hooks.json` is generated; add the repo to `all-repos.yaml`).
