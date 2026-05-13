# TanStack Supply-Chain Audit Report
Generated: 2026-05-13T18:16:32Z
Repo: /app

## Executive summary
- Compromised packages found: 0
- Pwn Request workflows: 0
- Floating action refs: 3
- Overall risk: CLEAN

## Phase 1 — Compromised package versions
None found

## Phase 2 — Indicators of compromise
None found

## Phase 3 — GitHub Actions findings
### Pwn Request patterns
None found

### Cache poisoning vectors
None found

### Floating refs on third-party actions
- `actions/checkout@v4` in `ci.yml`, `release.yml`, `sync-speckit-catalog.yml`
- `actions/setup-node@v4` in `ci.yml`, `release.yml`
- `actions/setup-python@v5` in `release.yml`

### OIDC publish config
None found

## Phase 4 — Suspicious install timing
None found
