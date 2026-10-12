# Implementation Plan: Docs-Sync Counts Only Visible, Specific Names

**Branch**: `fix/docs-sync-specific-evidence` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/shared-html-comments.mjs`: a new `visibleMarkdown(content)` returns a document without its HTML comments, line by line through `stripHtmlComments`, with fenced code blocks kept as text. Docs-Sync reads each canonical document through it. |
| FR-002 | `cli/validators/docs-sync.mjs`: the paths in each document's `covers` declarations (`coveredSections` from `cli/scanners/doc-deps.mjs`, path before `#`) count as documented. |
| FR-003 | `cli/scanners/routes.mjs`: the Next.js App Router path derivation moves into an exported `appRouterPath(relDir)`, used by the route scanner as before. `cli/scanners/doc-references.mjs`: a new `createUrlPathMatcher(text)` reads every path token in the text once and answers whether it names a URL path. Paths compare after `normalizePath` from `cli/scanners/api-doc.mjs`. Docs-Sync uses both for each `route` file under `app/api/`. |
| FR-004, FR-005 | `cli/validators/docs-sync.mjs`: `moduleIdentities(files)` gives each other file the shortest unshared tail of its extension-less path (at least two segments for `index` and `__init__`), and for `index` and `__init__` the directory path. `cli/scanners/doc-references.mjs`: a new `namesDirectory(text, parts)` beside `namesModule`. |
| FR-006 | `validateDocsSync` selects every route and service file first, computes identities over all of them, then checks those in `--changed-only` scope. Messages and severities are unchanged; the suggestion names the expected form. |
| FR-008 | `cli/scanners/doc-references.mjs`: a new `treePaths(text)` rebuilds the path of every entry of a drawn file tree. Docs-Sync appends those paths to the visible text, so every matcher sees them. |
| FR-007 | `cli/findings.mjs` (DSY001, DSY002 help), `npm run docs:reference`; `cli/commands/explain.mjs` (`docsSync`); `tests/generated-docs-e2e.test.mjs` comment; `CHANGELOG.md`; `npm run llms`. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/docs-sync-specific-evidence.test.mjs` unit-tests `visibleMarkdown`, `createUrlPathMatcher`, `namesDirectory` and `appRouterPath`, and runs `validateDocsSync` on fixtures for User Stories 1–3, each with its neighbouring valid case. The `init` cases run the CLI on the spec 044 fixtures.

## Research decisions

- **What exists.**
  - Docs-Sync concatenates the raw documents and asks `isDocumented(canonicalContent, file)`, which is `namesModule(canonicalContent, basename(file, extname(file)))` (spec 077).
  - `stripHtmlComments(line, inComment)` (spec 074) reads comments line by line and treats a `<!--` inside a code span as text. Its callers skip fenced code first: the requirement parser keeps its own fence state.
  - ENV004 and `diff`'s tech-stack reader strip comments with `/<!--[\s\S]*?-->/g` (spec 044 FR-006). That regex has the quoted-opener defect spec 074 fixed and does not keep fences, so it is not reused.
  - The route scanner derives a Next.js handler's URL inline in `scanNextJsRoutes`: route groups dropped, `[id]` → `:id`, `[...slug]` and `[[...slug]]` → `:slug*`.
  - `normalizePath` (API-Surface, `diff`) collapses every dynamic-segment syntax to `{}`.
  - `coveredSections(content)` (Doc-Dependency) parses `covers` declarations, skipping fenced examples.
- **Comments: skip all of them, keep `covers`.** Measured on 38 local projects (772 checked files): stripping every comment, stripping every comment except `docguard:` markers, and stripping only comments whose text appears in DocGuard's templates each change none of the 772 results. The choice therefore rests on what a comment is. A comment is not rendered, so a reader never sees it; spec 044 already treats comments as non-claims; and an author's `<!-- TODO: document /api/x -->` is the opposite of documentation. *Rejected:* skipping only DocGuard's placeholders. That needs a list of template texts that changes with every template edit, and it still counts author comments. The one DocGuard marker that names files is a section's `covers` attribute, which DocGuard defines as "this section documents this code", so its paths count (FR-002). On the measured projects no canonical document uses `covers`; only DocGuard's own documents do, and DocGuard has no route or service directory.
- **Next.js handlers: the URL path, not the stem.** On the same projects, 544 checked files are `route.ts`. Under spec 077, every one of them is documented by the word "route". By URL path, file path or wildcard, 360 are documented. Of the other 184, 11 were undocumented already and 173 lose their documentation; a review of the 173 (tasks.md) found no path, file path or wildcard naming any of them.
  - **Wildcards.** A first prototype without wildcards lost 230 handlers, because one project documents its API as `/api/deals/*`, `/api/platform-admin/*` and so on. A wildcard counts when its prefix has a segment below `/api`. Counting `/api/*` too documented all 322 handlers of four checkouts of one project that write `/api/*` once, which is the "API routes" problem again.
  - *Rejected:* the directory name as a word (`chat` for `api/chat/route.ts`). Directories such as `me`, `[id]`, `health` and `register` are common words or have no name.
  - *Rejected:* a fixed list of conventional stems. A list is a guess, and the route scanner already defines what a handler serves.
- **Shared and directory names.** Among non-Next files, only one project has stems that several checked files share: 7 `index` and 5 `types`, plus 2 `email`, which documents already name by a qualified path. Its documents name files inside `services/auth/`, but never `auth/index`, `auth/types` or `services/auth` as a module. The rule gives 11 new warnings there; each was checked (tasks.md).
  - *Rejected:* the directory name as the module name of an `index` file (Node.js resolution). `src/routes/index.ts` would then be documented by the word "routes", which is the spec 077 problem.
  - *Rejected:* letting a sibling's path (`services/auth/OktaAuthService.ts`) document the barrel `services/auth/index.ts`. That names a different file; Docs-Sync checks files.
- **Drawn file trees.** 15 of the 38 projects draw file trees in their canonical documents (`├──`, `└──`), and one lists Next.js handlers that way. A tree names a file across lines, so no line-based matcher sees it. `treePaths` keeps a stack of entries by the column of their connector, which tolerates any indent width, and joins them to the directory line above the tree. Measured: no Docs-Sync result changes on these projects (239 warnings either way), so it removes a class of false positives at no cost. *Rejected:* Markdown nested lists as trees; they are prose structure as often as paths.
- **Shared is decided over every selected file.** Under `--changed-only`, deciding over the changed files alone would make the same file's result depend on what else changed (FR-006).
- **Matchers live beside `namesToken` and `namesModule`.** `createUrlPathMatcher` and `namesDirectory` sit in `cli/scanners/doc-references.mjs` with the one file-name character set. The URL matcher is a factory because Docs-Sync asks it once per handler about the same text: it tokenizes once and answers from sets of path suffixes.
- **Cost.** Nothing is read until Docs-Sync checks a file. Then one `visibleMarkdown` and one `treePaths` pass per document, and one pass for path tokens when a Next.js handler is checked. Identities are counted in a map, O(files × depth). `coveredSections` runs only on documents that contain `covers=`. The budget job compares guard wall time on this repository, where Docs-Sync finds no route or service directory.
- **Messages stay byte-identical.** Baselines fingerprint `code`, location and message (`cli/writers/baseline.mjs`). Only the `suggestion` text changes, so a baselined DSY finding stays baselined.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IV (validators isolated) | Docs-Sync imports scanners and shared modules, never another validator. |
| IX (honest assurance) | A file counts as documented only by text a reader sees, or by a declaration, that identifies it. The findings stay warnings. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/shared-html-comments.mjs                  # FR-001: visibleMarkdown
cli/scanners/doc-references.mjs               # FR-003, FR-005, FR-008: createUrlPathMatcher, namesDirectory, treePaths
cli/scanners/routes.mjs                       # FR-003: appRouterPath (extracted, behaviour unchanged)
cli/validators/docs-sync.mjs                  # FR-001–FR-006
tests/docs-sync-specific-evidence.test.mjs    # NEW: FR-001–FR-007
tests/generated-docs-e2e.test.mjs             # FR-007: allow-list comment
testguard.claims.json                         # new claim DOCS-SYNC-SPECIFIC-EVIDENCE; spec 077 F2 re-pointed
cli/findings.mjs, cli/commands/explain.mjs, docs/reference/findings.md,
CHANGELOG.md, llms*.txt                       # FR-007
```
