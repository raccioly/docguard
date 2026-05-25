# Supply-Chain Security Audit Report
Date: 2026-05-25

## Phase 1: Known-Bad Packages
- No known-bad packages found.

## Phase 2: IOCs on Disk
- No IOCs found.

## Phase 3: Slopsquatting
- No slopsquatting found.

## Phase 4: Freshness Violations
- **MEDIUM**: Floating version range found: `express@^4.18.0` in `./examples/01-express-api/package.json`
- **MEDIUM**: Floating version range found: `@types/vscode@^1.80.0` in `./vscode-extension/package.json`

## Phase 5: Install-Script Exposure
- No install-script exposure found.

## Phase 6: CI/CD Attack Surface
- **HIGH**: Third-party action not pinned to commit SHA: `uses: "google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml@v2.3.8"` in `supply-chain.yml`
- **HIGH**: Third-party action not pinned to commit SHA: `uses: "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8"` in `supply-chain.yml`
- **MEDIUM**: Missing `permissions:` block in `ci.yml`
