# Supply-Chain Security Audit

> **Purpose:** Recurring read-only audit of this repository for npm/PyPI supply-chain risks.
> Designed to run unattended in Jules Scheduled Tasks.

## ⚠️ Critical Safety Rule

**Do NOT run** `npm install`, `pip install`, `npm audit fix`, or any state-changing command.
This is a **read-only** audit.

---

## Audit Phases

### Phase 1: Known-Bad Packages

Scan all lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `requirements*.txt`, `poetry.lock`, `pyproject.toml`) for known-malicious packages:

**May 2026 — TanStack/Mini Shai-Hulud (CVE-2026-45321):**
- `@tanstack/router` 1.121.4–1.121.6
- `@tanstack/start`, `@tanstack/react-router`, `@tanstack/vue-router`, `@tanstack/solid-router`

**May 2026 — TeamPCP/Mistral:**
- `@mistralai/mistralai` 1.5.0 (npm) / `mistralai` 2.4.6 (PyPI)
- `intercom-client` 6.4.0, `@ctrl/tinycolor` 4.2.0
- `guardrails-ai` 0.10.1, `litellm` 1.82.8, `lightning` 2.6.2–2.6.3

### Phase 2: IOCs on Disk

Search for:
- Worm loaders: `router_init.js`, `router_runtime.js`, `setup.mjs` in `node_modules/`
- C2 domains: `filev2.getsession.org`, `git-tanstack.com`, `api.masscan.cloud`, `83.142.209.194`
- Persistence: `~/Library/LaunchAgents/com.user.gh-token-monitor.plist` (macOS), `~/.config/systemd/user/gh-token-monitor.service` (Linux)
- Git artifacts: remotes containing `shai-hulud`, commits by `claude <claude@users.noreply.github.com>`

### Phase 3: Slopsquatting

For every direct dependency:
- Flag packages with <1,000 weekly downloads named like a popular package
- Flag packages added in AI-authored commits
- Check for phantom imports (imported but not declared in package.json)

### Phase 4: Freshness Violations

- CRITICAL: package published <48 hours ago
- HIGH: package published <7 days ago
- MEDIUM: package published <30 days ago
- Flag any floating version ranges (`^`, `~`, `>=`, `*`, `latest`)

### Phase 5: Install-Script Exposure

- Check for `preinstall`/`postinstall` hooks in package.json
- Verify `.npmrc` has `ignore-scripts=true`
- Count packages with `hasInstallScript` in lockfile

### Phase 6: CI/CD Attack Surface

For each `.github/workflows/*.yml`:
- `pull_request_target` + checkout of PR code = CRITICAL
- Third-party actions not pinned to commit SHA = HIGH
- `secrets.*` exposed in PR workflows = HIGH
- Missing `permissions:` block = MEDIUM

---

## Output

Save findings to `./reports/SUPPLY-CHAIN-AUDIT-YYYY-MM-DD.md`.

If CRITICAL or HIGH findings exist, open a PR with title:
`[supply-chain] Audit findings for YYYY-MM-DD`

---

## Remediation

If Phase 1 or 2 hits:
> ⚠️ DO NOT revoke GitHub tokens first. Remove persistence daemon first, then rotate credentials.

If Phase 4 hits:
> Pin all versions to exact in package.json. Add `min-release-age=7d` to .npmrc.

If Phase 6 hits:
> Pin third-party actions to 40-char commit SHA. Replace `pull_request_target` with `pull_request`.
