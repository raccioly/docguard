# Implementation Plan: User Documentation a Large Project Would Ship

**Branch**: `docs/user-guides` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

New pages:
- `docs/guides/`: existing-projects, monorepo, ci, spec-kit, upgrading, troubleshooting
- `docs/reference/`: languages, agents, findings (generated), mcp

Changed:
- `docs/installation.md`: expanded to every channel.
- `docs/index.md` and `docs/_config.yml`: Just the Docs `remote_theme`, which GitHub Pages builds natively.
- Existing pages: navigation front matter.
- `tools/generate-docs-reference.mjs` and `npm run docs:reference`.
- `tests/user-docs.test.mjs`.
- The README, README.es.md and README.pt-BR.md.

## Technical Context

**Language/Version**: Markdown; JavaScript ES modules (Node ≥ 18) for the generator and tests
**Primary Dependencies**: none new. The theme is fetched by GitHub Pages at build time and is not a repository dependency.
**Testing**: `node:test`: generated-reference drift, relative-link resolution, mentioned commands exist, front matter present.

## Research decisions

- **Keep existing paths.** The README, the npm package, the llms bundles and the tests link to `docs/commands.md` and its siblings. New folders hold new pages; navigation comes from front matter, not moves.
- **Just the Docs through `remote_theme`.** GitHub Pages supports `jekyll-remote-theme`, so the site gets a sidebar and search with no build step. Rejected:
  - MkDocs or DocFX: a build tool and a workflow to maintain;
  - Pages' default theme: no navigation.
- **Generate the finding reference.** 147 codes typed by hand would drift. The generator follows `tools/generate-llms.mjs` and its drift test.
- **English guides, translated landing pages.** Full translations go stale. The Spanish and Portuguese READMEs stay concise and point to the English guides.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | Pages say what is partial or pattern-read. The language matrix matches `LANGUAGE_NAMES` and the scanners. |
| X (spec-first) | Spec, plan and tasks precede the pages. |

Pass.

## Project Structure

```text
docs/_config.yml, docs/index.md                      # NEW: site config and landing page
docs/guides/{index,existing-projects,spec-kit,ci,monorepo,upgrading,troubleshooting}.md   # NEW
docs/reference/{index,languages,agents,mcp,findings}.md                                    # NEW (findings generated)
docs/{quickstart,commands,configuration,doc-sections,ai-integration,profiles,faq}.md       # front matter; corrections
docs/installation.md                                 # expanded
tools/generate-docs-reference.mjs                    # NEW
cli/commands/explain.mjs                             # export DISPLAY_NAMES
tests/user-docs.test.mjs                             # NEW
README.md, README.es.md, README.pt-BR.md, extensions/spec-kit-docguard/README.md, mcpb/README.md
```
