# Compliance Profiles

DocGuard supports three compliance profiles to match different project needs.

## The Problem: Document Tax

Requiring all 5 canonical docs for a weekend side project is overkill. Requiring only ARCHITECTURE.md for a regulated enterprise app is dangerous. Profiles solve this.

## Profiles

### `starter` — For side projects and prototypes

```bash
npx docguard init --profile starter
```

**Creates:** ARCHITECTURE.md, CHANGELOG.md, AGENTS.md, DRIFT-LOG.md

**Validators enabled:** structure, docsSync, changelog

**Validators disabled:** drift, architecture, testSpec, security, environment, freshness

**Use when:** Solo projects, hackathons, learning projects, anything where "some docs" beats "no docs."

### `standard` — For team projects (default)

```bash
npx docguard init                    # default profile
npx docguard init --profile standard # explicit
```

**Creates:** All 5 canonical docs + AGENTS.md + CHANGELOG.md + DRIFT-LOG.md

**Validators enabled:** structure, docsSync, drift, changelog, testSpec, environment, freshness

**Validators disabled:** architecture (deep import analysis), security (secrets scanning)

**Use when:** Active team projects, repos with 3+ contributors, anything that will live longer than a sprint.

### `enterprise` — For regulated and critical projects

```bash
npx docguard init --profile enterprise
```

**Creates:** All 5 canonical docs + all tracking files

**Validators enabled:** ALL — including architecture (import graph), security (secrets), and freshness

**Use when:** Regulated industries, SOC2/HIPAA compliance, mission-critical production systems, enterprise monorepos.

## Setting a Profile

### At init time

```bash
npx docguard init --profile starter
```

### In `.docguard.json`

```json
{
  "profile": "enterprise"
}
```

### Overriding specific validators

Profiles set defaults, but you can override anything:

```json
{
  "profile": "starter",
  "validators": {
    "freshness": true
  }
}
```

This uses the starter baseline but enables freshness checks.

## Graduating Between Profiles

As your project grows:

```
starter  →  standard  →  enterprise
```

1. Start with `starter` — just ARCHITECTURE + CHANGELOG
2. When your team grows, switch to `standard` — add all 5 docs
3. When you need compliance, switch to `enterprise` — enable all validators

Change the `"profile"` field in `.docguard.json` and run `docguard diagnose` to see what's missing.

## Measuring the Cost

```bash
npx docguard score --tax
```

Shows estimated weekly maintenance time. If the tax is HIGH, consider downgrading your profile. If LOW, you might benefit from upgrading.
