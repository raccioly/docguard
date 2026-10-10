# Feature Specification: User Documentation a Large Project Would Ship

**Feature Branch**: `docs/user-guides`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.user-documentation`

**Lineage**: Extends the user docs under `docs/` (quickstart, installation, commands, configuration, ai-integration, profiles, doc-sections, faq). Modelled on the structure of github/spec-kit's `docs/` (install, guides, reference, concepts), and in particular its existing-projects guide. Maintainer request, 2026-10-10.

**Input**: "Make sure the repo has the documentation large repos have: languages available, setup for existing projects like Spec Kit's guide, and whatever else is missing."

## Problem

DocGuard has 9 pages of user docs. A reader cannot find out:
- how to adopt it on an existing repository;
- which programming languages and frameworks it reads, and how deeply;
- which coding agents it supports, and where their files go;
- how to install it any way other than npm or PyPI (Homebrew, Docker, Claude Desktop, offline);
- how to run it in a monorepo or in CI outside GitHub;
- how to upgrade;
- what each of its 147 finding codes means without running `docguard explain`.

GitHub Pages already serves `docs/`, but it has no index or navigation. The Spanish and Portuguese READMEs are short summaries and do not link to the English guides.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adopt DocGuard on an existing repository (Priority: P1)

A maintainer with an existing codebase follows one guide, from a reviewable baseline to a gated first PR: install, `init` on existing code, `generate`, a baseline for existing findings, a profile, CI, and Spec Kit if they use it.

### User Story 2 - Know what DocGuard can read (Priority: P1)

A reader finds, per language and framework, the parser tier and what is extracted (routes, models, env vars, imports), and what is reported as partial.

### User Story 3 - Find any page from one place (Priority: P1)

The Pages site has a landing page, sidebar navigation and search. Every page is reachable from it, and the README links to it.

### User Story 4 - Look up a finding code (Priority: P2)

A reference page lists every finding and blocker code with its title, explanation and suppression. It is generated from the code registry and cannot drift.

## Requirements *(mandatory)*

- **FR-001**: `docs/guides/existing-projects.md` MUST take an existing repository from a clean branch to a gated first PR, using only commands and flags that exist.
- **FR-002**: `docs/reference/languages.md` MUST list every language and framework DocGuard reads, with its parser tier and what is extracted, matching the scanners and `LANGUAGE_NAMES`.
- **FR-003**: `docs/reference/agents.md` MUST list every coding agent DocGuard installs skills or commands for, with the paths it writes, matching `cli/agent-surface.mjs` and the agent scaffolders.
- **FR-004**: `docs/reference/findings.md` MUST be generated from `CODES` and `BLOCKER_CODES` by `npm run docs:reference`, and a test MUST fail when it is stale.
- **FR-005**: The docs MUST also cover:
  - every install channel: npm, PyPI, Homebrew, Docker/GHCR, the GitHub Action, the Spec Kit extension, the Claude Desktop bundle, and offline use;
  - CI outside GitHub;
  - monorepos;
  - upgrading;
  - troubleshooting;
  - the MCP server;
  - Spec Kit integration.
- **FR-006**: `docs/` MUST have an index page and a Just the Docs navigation that GitHub Pages builds without a repository build step or dependency. Existing page paths MUST NOT change.
- **FR-007**: The README MUST link to the docs site and the new guides. The Spanish and Portuguese READMEs MUST link to the English guides and say that the guides are in English.
- **FR-008**: A test MUST check that:
  - every relative link in `docs/` resolves;
  - every `docguard <command>` the new pages mention exists;
  - every page carries navigation front matter.

- **FR-009**: Statements in existing docs and CLI help that the new pages' verification proved wrong MUST be corrected:
  - the Spec Kit install command: a bare `specify extension add docguard` fails, because the community catalog is discovery-only;
  - `quickstart.md`'s removed `specify init --ai` flag;
  - the README's nonexistent `--agent antigravity`, `/docguard.init` and `/docguard.update`, the wrong command directories, and the out-of-date skill count and hook table;
  - `ai-integration.md`'s install location, source directory and `GEMINI.md`;
  - the MCPB asset name;
  - `ci --help` ("Generate CI config"; it is the gate);
  - `guard --help`, which lists `--fail-on-warning` although guard never reads it;
  - the `init --with ci` description, which writes a workflow file.
  - the dead `templates/commands/` directory (the installer reads `commands/`), which the README's slash-command list and this repository's Surface-Sync check still followed.

## Success Criteria *(mandatory)*

- **SC-001**: A reader can reach every page from the docs landing page, and every link resolves.
- **SC-002**: The full suite passes, guard on this repository passes, and the Pages build succeeds.

## Out of Scope

- Full translations of every guide.
- A docs build tool or framework in the repository.
