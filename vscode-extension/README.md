# DocGuard for VS Code

> Canonical-Driven Development (CDD) enforcement directly in your editor.

![CDD Score](https://img.shields.io/badge/CDD_Score-89%2F100_(A)-green)
![Type](https://img.shields.io/badge/type-cli-blue)
![DocGuard](https://img.shields.io/badge/guarded_by-DocGuard-cyan)

## Features

### 📊 Status Bar Score
Live CDD maturity score in the status bar — auto-refreshes when you edit documentation files.

### 🔍 Inline Diagnostics
- **Unfilled placeholders** — highlights `<!-- TODO -->` and `<!-- e.g. -->` in canonical docs
- **Draft status** — hints when documents are still in draft
- **Missing docs** — warnings for required CDD documents

### ⚡ Commands

| Command | Description |
|---------|-------------|
| `DocGuard: Audit Documentation` | Scan project documentation status |
| `DocGuard: Guard (Validate)` | Run all validators with pass/fail notification |
| `DocGuard: Show CDD Score` | Display score breakdown in output |
| `DocGuard: Generate Badges` | Copy badge markdown to clipboard |
| `DocGuard: Initialize CDD Docs` | Create CDD documentation from templates |
| `DocGuard: Refresh Score` | Manually refresh the status bar score |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `docguard.autoRefresh` | `true` | Auto-refresh score when docs change |
| `docguard.showStatusBar` | `true` | Show CDD score in status bar |
| `docguard.nodePath` | `node` | Path to Node.js executable |
| `docguard.scoreThreshold` | `60` | Below this score shows warning background |

## Requirements

- Node.js ≥ 18
- DocGuard installed globally (`npm i -g docguard`) or as project dependency

## How It Works

1. Extension activates when it detects `.docguard.json`, `docs-canonical/`, or `AGENTS.md`
2. Runs `docguard score --format json` to get the CDD score
3. Watches for file changes and auto-refreshes
4. Reports inline diagnostics on canonical documentation files
