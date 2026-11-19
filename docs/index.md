---
title: Home
nav_order: 1
permalink: /
---

# DocGuard

DocGuard reads what your documentation says about your code. It reads the code
too, and it reports every claim where the two no longer agree. Each finding says
how sure DocGuard is. It also says whether DocGuard can name the fix or leaves
the decision to you. DocGuard runs offline and makes no model or network calls
when it checks your project. It works with any coding agent.

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
| Fix a build that turned red when strict became the default | [Upgrading to Strict](upgrading-to-strict.md) |
| Use it with GitHub Spec Kit | [Spec Kit](guides/spec-kit.md) |
| Use it with AWS AI-DLC | [AWS AI-DLC](guides/aidlc.md) |
| Gate pull requests | [Continuous Integration](guides/ci.md) |
| Know which languages and frameworks it reads | [Languages and Frameworks](reference/languages.md) |
| Write your documents in Portuguese, Spanish or another language | [Documents in Other Languages](languages.md) |
| Connect your coding agent | [Coding Agents](reference/agents.md) and [AI Integration](ai-integration.md) |
| Understand a finding code | [Finding Codes](reference/findings.md) |

## Guides

- [Existing Projects](guides/existing-projects.md): from a clean branch to a gated first pull request.
- [Spec Kit](guides/spec-kit.md): the extension, its hooks and the spec lifecycle registry.
- [AWS AI-DLC](guides/aidlc.md): reading AI-DLC workspaces and the `docguard` AI-DLC plugin.
- [Continuous Integration](guides/ci.md): GitHub Actions and other CI systems.
- [Monorepos](guides/monorepo.md): several packages in one repository.
- [Upgrading](guides/upgrading.md): moving between versions safely.
- [Upgrading to Strict](upgrading-to-strict.md): what a strict failure looks like, and three ways to fix it.
- [Troubleshooting](guides/troubleshooting.md): exit codes, false positives and partial coverage.
- [AI Integration](ai-integration.md) and [Compliance Profiles](profiles.md).

## Reference

- [Commands](commands.md) and [Configuration](configuration.md).
- [Languages and Frameworks](reference/languages.md), [Documents in Other Languages](languages.md), [Coding Agents](reference/agents.md) and the [MCP Server](reference/mcp.md).
- [Finding Codes](reference/findings.md), generated from the code that reports them.
- [FAQ](faq.md).
- [Section-Addressable Docs](doc-sections.md): the markers that keep code-derived sections apart from your own text.

## Background

- The [technical brief](docguard-explained.html) ([PDF](docguard-explained.pdf)) explains the method and the research behind the detectors. It also explains how DocGuard measures their numbers.
- [Philosophy](https://github.com/raccioly/docguard/blob/main/PHILOSOPHY.md), the [CDD Standard](https://github.com/raccioly/docguard/blob/main/STANDARD.md) and [Comparisons](https://github.com/raccioly/docguard/blob/main/COMPARISONS.md) live in the repository.

## Other languages

These guides are in English. A short introduction is also available in
[Spanish](https://github.com/raccioly/docguard/blob/main/README.es.md) and
[Portuguese (Brazil)](https://github.com/raccioly/docguard/blob/main/README.pt-BR.md).
