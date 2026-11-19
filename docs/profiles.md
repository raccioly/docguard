---
title: Compliance Profiles
parent: Guides
nav_order: 8
---

# Compliance Profiles

DocGuard has three compliance profiles. Choose the one that fits your project.

## The Problem: Document Tax

Requiring all 5 canonical docs for a weekend side project is too much. Requiring only ARCHITECTURE.md for a regulated enterprise app is too little, and it is risky. Profiles solve this.

## Profiles

### `starter` — For side projects and prototypes

```bash
npx docguard-cli init --profile starter
```

**Creates:** ARCHITECTURE.md, CHANGELOG.md, AGENTS.md, DRIFT-LOG.md

**Validators enabled:** structure, docsSync, changelog

**Validators disabled:** drift, architecture, testSpec, security, environment, freshness

**Use when:** Solo projects, hackathons, learning projects, and any project where some docs are better than none.

### `standard` — For team projects (default)

```bash
npx docguard-cli init                    # default profile
npx docguard-cli init --profile standard # explicit
```

**Creates:** All 5 canonical docs + AGENTS.md + CHANGELOG.md + DRIFT-LOG.md

**Validators enabled:** structure, docsSync, drift, changelog, testSpec, environment, freshness

**Validators disabled:** architecture (deep import analysis), security (secrets scanning)

**Use when:** Active team projects, repos with 3 or more contributors, and any project that will last longer than a sprint.

### `enterprise` — For regulated and critical projects

```bash
npx docguard-cli init --profile enterprise
```

**Creates:** All 5 canonical docs + all tracking files

**Validators enabled:** ALL, including architecture (import graph), security (secrets) and freshness

**Use when:** Regulated industries, SOC2/HIPAA compliance, critical production systems and enterprise monorepos.

## Setting a Profile

### At init time

```bash
npx docguard-cli init --profile starter
```

### In `.docguard.json`

```json
{
  "profile": "enterprise"
}
```

### Overriding specific validators

A profile sets defaults. You can override any of them:

```json
{
  "profile": "starter",
  "validators": {
    "freshness": true
  }
}
```

This uses the starter baseline and turns on the freshness checks.

## Graduating Between Profiles

As your project grows, move up one profile at a time:

```
starter  →  standard  →  enterprise
```

1. Start with `starter`: only ARCHITECTURE and CHANGELOG.
2. When your team grows, switch to `standard` to add all 5 docs.
3. When you need compliance, switch to `enterprise` to enable all validators.

Change the `"profile"` field in `.docguard.json`. Then run `docguard diagnose` to see what is missing.

## Measuring the Cost

```bash
npx docguard-cli score --tax
```

This shows the estimated weekly maintenance time. If the tax is HIGH, consider a lighter profile. If it is LOW, a stricter profile may help you.
