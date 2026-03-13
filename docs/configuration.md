# Configuration

SpecGuard is configured via `.specguard.json` in the project root. If no config file exists, sensible defaults are used.

## Full Reference

```json
{
  "projectName": "my-project",
  "version": "0.3",
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
    "testFramework": "jest",
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

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projectName` | string | From `package.json` name | Display name in reports |
| `version` | string | `"0.1"` | Config schema version |
| `projectType` | string | Auto-detected | `cli`, `webapp`, `api`, `library`, `monorepo` |

### `projectTypeConfig`

Controls what validators expect based on your project type:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `needsEnvVars` | boolean | `true` | Expect environment variable documentation |
| `needsEnvExample` | boolean | `true` | Expect `.env.example` file |
| `needsE2E` | boolean | `true` | Expect E2E test documentation |
| `needsDatabase` | boolean | `true` | Expect database entity documentation |
| `testFramework` | string | Auto-detected | Test framework name |
| `runCommand` | string | Auto-detected | Command to run the project |

### `validators`

Enable/disable individual validators:

| Validator | Default | What It Checks |
|-----------|---------|---------------|
| `structure` | `true` | `docs-canonical/` exists, required files present |
| `docsSync` | `true` | SpecGuard metadata headers in docs |
| `drift` | `true` | DRIFT-LOG.md exists and is maintained |
| `changelog` | `true` | CHANGELOG.md has [Unreleased] section, version entries |
| `architecture` | `true` | Component map, layer boundaries, diagrams |
| `testSpec` | `true` | Test framework, coverage, critical flows documented |
| `security` | `true` | Auth, secrets, RBAC documentation |
| `environment` | `true` | Setup steps, env vars, prerequisites |
| `freshness` | `true` | Docs updated recently relative to code changes |

## Project Type Examples

### CLI Tool

```json
{
  "projectType": "cli",
  "projectTypeConfig": {
    "needsEnvVars": false,
    "needsEnvExample": false,
    "needsE2E": false,
    "needsDatabase": false
  }
}
```

### Web Application

```json
{
  "projectType": "webapp",
  "projectTypeConfig": {
    "needsEnvVars": true,
    "needsE2E": true,
    "needsDatabase": true,
    "testFramework": "jest"
  }
}
```

### API Service

```json
{
  "projectType": "api",
  "projectTypeConfig": {
    "needsEnvVars": true,
    "needsDatabase": true,
    "needsE2E": false
  }
}
```

## Auto-Detection

If no `.specguard.json` exists, SpecGuard auto-detects:

- **Project name**: From `package.json` → `name`, or directory name
- **Project type**: From `package.json` → `bin` (cli), `react`/`next`/`vue` (webapp), `express`/`fastify` (api)
- **Test framework**: From `package.json` → scripts or dependencies
