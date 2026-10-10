---
title: Home
nav_order: 1
permalink: /
---

# DocGuard

DocGuard reads what your documentation claims about your code, reads the code,
and reports every claim the two no longer agree on. Each finding says how sure
it is and whether it is a fix the tool can name or a judgement it hands to you.
It runs offline, makes no model or network calls at validation time, and works
with any coding agent.

```bash
npx docguard-cli demo
```

The demo runs against a sample project and needs no install or setup.

## Start here

| If you want to | Read |
|---|---|
| Try it on a new project in five minutes | [Quick Start](quickstart.md) |
| Install it as a CLI, Python package, Homebrew formula, container, Action or Spec Kit extension | [Installation](installation.md) |
| Adopt it on a repository that already has code | [Existing Projects](guides/existing-projects.md) |
| Use it with GitHub Spec Kit | [Spec Kit](guides/spec-kit.md) |
| Gate pull requests | [Continuous Integration](guides/ci.md) |
| Know which languages and frameworks it reads | [Languages and Frameworks](reference/languages.md) |
| Connect your coding agent | [Coding Agents](reference/agents.md) and [AI Integration](ai-integration.md) |
| Understand a finding code | [Finding Codes](reference/findings.md) |

## Guides

- [Existing Projects](guides/existing-projects.md): from a clean branch to a gated first pull request.
- [Spec Kit](guides/spec-kit.md): the extension, its hooks and the spec lifecycle registry.
- [Continuous Integration](guides/ci.md): GitHub Actions and other CI systems.
- [Monorepos](guides/monorepo.md): several packages in one repository.
- [Upgrading](guides/upgrading.md): moving between versions safely.
- [Troubleshooting](guides/troubleshooting.md): exit codes, false positives and partial coverage.
- [AI Integration](ai-integration.md) and [Compliance Profiles](profiles.md).

## Reference

- [Commands](commands.md) and [Configuration](configuration.md).
- [Languages and Frameworks](reference/languages.md), [Coding Agents](reference/agents.md) and the [MCP Server](reference/mcp.md).
- [Finding Codes](reference/findings.md), generated from the code that reports them.
- [FAQ](faq.md).
- [Section-Addressable Docs](doc-sections.md): the markers that separate code-derived sections from your prose.

## Background

- The [technical brief](docguard-explained.html) ([PDF](docguard-explained.pdf)) explains the method, the research behind the detectors and how their numbers are measured.
- [Philosophy](https://github.com/raccioly/docguard/blob/main/PHILOSOPHY.md), the [CDD Standard](https://github.com/raccioly/docguard/blob/main/STANDARD.md) and [Comparisons](https://github.com/raccioly/docguard/blob/main/COMPARISONS.md) live in the repository.

## Other languages

These guides are in English. A short introduction is available in
[Spanish](https://github.com/raccioly/docguard/blob/main/README.es.md) and
[Portuguese (Brazil)](https://github.com/raccioly/docguard/blob/main/README.pt-BR.md).
