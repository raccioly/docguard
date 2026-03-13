# Configuration

DocGuard is configured via `.docguard.json` in the project root. If no config file exists, sensible defaults are used with auto-detection.

## Full Reference

```json
{
  "projectName": "my-project",
  "version": "0.5",
  "profile": "standard",
  "projectType": "webapp",

  "requiredFiles": {
    "canonical": [
      "docs-canonical/ARCHITECTURE.md",
      "docs-canonical/DATA-MODEL.md",
      "docs-canonical/SECURITY.md",
      "docs-canonical/TEST-SPEC.md",
      "docs-canonical/ENVIRONMENT.md"
    ],
    "agentFile": ["AGENTS.md", "CLAUDE.md"],
    "changelog": "CHANGELOG.md",
    "driftLog": "DRIFT-LOG.md"
  },

  "projectTypeConfig": {
    "needsEnvVars": true,
    "needsEnvExample": true,
    "needsE2E": true,
    "needsDatabase": true,
    "testFramework": "vitest",
    "runCommand": "npm run dev"
  },

  "validators": {
    "structure": true,
    "docsSync": true,
    "drift": true,
    "changelog": true,
    "architecture": true,
    "testSpec": true,
    "security": true,
    "environment": true,
    "freshness": true
  }
}
```

## Profile Field

The `profile` field sets a baseline preset. User config overrides profile defaults.

| Profile | Description | Validators Enabled |
|---------|-------------|-------------------|
| `starter` | Minimal CDD — ARCHITECTURE + CHANGELOG | structure, docsSync, changelog |
| `standard` | Full CDD — all 5 canonical docs (default) | Most validators |
| `enterprise` | Strict — all docs + all validators | All validators + freshness |

See [Profiles](./profiles.md) for details.

## Validators

| Validator | Default | What It Checks |
|-----------|---------|----------------|
| `structure` | `true` | `docs-canonical/` exists, required files present, expected sections |
| `docsSync` | `true` | AGENTS.md references DocGuard workflow |
| `drift` | `true` | DRIFT-LOG.md exists and has entries when code deviates |
| `changelog` | `true` | CHANGELOG.md has [Unreleased] section, version entries |
| `architecture` | varies | Component map, layer boundaries, import graph analysis |
| `testSpec` | `true` | Test framework, coverage, critical flows documented |
| `security` | varies | Auth, secrets, RBAC documentation |
| `environment` | `true` | Setup steps, env vars, prerequisites, .env.example |
| `freshness` | varies | Docs updated recently relative to code changes (git-based) |

## Project Type Detection

DocGuard auto-detects your project type from `package.json`:

| Signal | Detected Type |
|--------|--------------|
| `bin` field | `cli` |
| `next`, `react`, `vue`, `angular`, `svelte` | `webapp` |
| `express`, `fastify`, `hono`, `koa` | `api` |
| `main`, `exports`, `module` | `library` |
| `manage.py` | `webapp` (Django) |
| `pyproject.toml` | `library` (Python) |

## Project Type Defaults

| Type | Env Vars | .env.example | E2E | Database |
|------|----------|-------------|-----|----------|
| `cli` | ✗ | ✗ | ✗ | ✗ |
| `library` | ✗ | ✗ | ✗ | ✗ |
| `webapp` | ✓ | ✓ | ✓ | ✓ |
| `api` | ✓ | ✓ | ✗ | ✓ |
