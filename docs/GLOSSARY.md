---
title: Glossary
parent: Reference
nav_order: 10
---

# Glossary

<!-- One row per concept. Use is the term to write. Avoid lists other names for
the same concept, separated by commas; DocGuard reports them in prose (GLS001).
Code, links, quotes and the headings DocGuard requires are not checked. -->

| Use | Avoid | Meaning |
|---|---|---|
| canonical docs | | The documents under `docs-canonical/`, or the ones `docs.roles` maps, that state the design. |
| finding | | One result of a check, with a stable code such as `GLS001`. |
| validator | | A group of checks that reads one part of the project, for example Doc-Quality. |
| check | | One test that a validator runs. `guard` counts checks as passed or not. |
| agent | | An AI coding agent, such as Claude Code or Codex, that reads the docs and changes the code. |
| spec | | A feature description under `specs/`, written with Spec Kit. |
| Spec Kit | | GitHub's spec-driven workflow. DocGuard is one of its extensions. |
| guard | | The command that runs every validator and sets the exit code. |
| strict | | The default enforcement mode: a validator that applies and checked nothing fails the run. |
| glossary | | This file: one term for each concept, read by the Glossary validator. |
