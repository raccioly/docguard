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
  },

  "severity": {
    "security": "high",
    "todoTracking": "low"
  },

  "collections": {
    "extractors": "src/extractors/*.py",
    "commands": "cli/commands/*.mjs"
  },

  "docs": {
    "dirs": ["reference", "website/docs"]
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

## Severity overrides

`severity.<validator>` changes a validator's **exit-code weight** without hiding
anything from display: `"high"` promotes its warnings to blocking (CI fails),
`"low"` demotes them (shown, but never fail the build). Valid values:
`high | medium | low`. To silence a validator entirely, use `validators.<key>: false`.

## Collections — verify documented counts against code

`collections` binds a documentation noun to a glob whose **file count is the
source of truth**. With `"extractors": "src/extractors/*.py"`, a doc claiming
"16 extractors" while the glob matches 19 files becomes a guard warning (and a
`fix --write`-able correction). Declaring the noun *is* the opt-in — no other
marker needed. Reserved nouns (`checks`, `validators`, `tests`) keep their
built-in DocGuard meaning. An unresolvable glob is skipped, never treated as 0.

## Documentation homes — `docs.dirs`

Conventional doc folders (`docs/`, `doc/`, `documentation/`, `guides/`,
`handbook/`, `manual/`, `wiki/`, Docusaurus `website/docs/`, …) are
**auto-detected** and claim-scanned without enrollment. `docs.dirs` EXTENDS
that set with non-standard homes — it never replaces auto-detection. To exclude
a conventional dir, list it in `.docguardignore`.

## Muting a validator

Two ways to turn a validator off, for two different intents:

| Intent | How | Renders as |
|--------|-----|-----------|
| Operational toggle (CI speed, not relevant *right now*) | `.docguard.json` → `"validators": { "testSpec": false }` | silent — disabled |
| **Intentional non-applicability** (POC with no tests, library with no auth) | inline marker in a canonical doc or `AGENTS.md`:<br>`<!-- docguard:validator testSpec n/a — POC, no automated tests yet -->` | `➖ Test-Spec [N/A] (declared N/A: …)` — visible, git-tracked |

The marker is preferred when the validator genuinely does not apply: the rationale lives next to the declaration, travels with the repo, and shows up honestly as N/A rather than a hidden skip or a fake green check. The key is the validator key from the table above (case/separator tolerant — `test-spec` works too); a mistyped key is reported as a warning rather than silently ignored. A no-tests POC typically marks both `testSpec` and `traceability` N/A.

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
