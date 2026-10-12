# Implementation Plan: Whole-Token Matching in the Nudge Hook, Docs-Sync and Diff-Suspicion

**Branch**: `fix/whole-token-matchers` | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

## Summary

| FR | Change |
|---|---|
| FR-001 | `cli/commands/hooks.mjs`: `docsReferencingFile` tests each document with `namesToken(content, base)`. |
| FR-002 | `cli/scanners/doc-references.mjs`: a new exported `namesModule(text, stem)` beside `namesToken`, bounded by the same `NAME_CHAR_NOT_DOT` class on both sides. `namesToken` and `referenceKind` are not edited. |
| FR-003 | `cli/validators/docs-sync.mjs`: a new `isDocumented(canonicalContent, file)` (`namesModule` on the file's extension-less name) replaces the two identical substring tests for DSY001 and DSY002. |
| FR-004 | `cli/validators/diff-suspicion.mjs`: the private `referenceKind` tests the path with `namesToken`. |
| FR-005 | `cli/findings.mjs` (DSY001, DSY002 help) and `npm run docs:reference`; `cli/commands/explain.mjs` (`docsSync`); `docs/reference/agents.md` (nudge hook); `CHANGELOG.md`; `npm run llms`. |
| FR-006 | `tests/generated-docs-e2e.test.mjs`: DSY001 and DSY002 join the `init` flows' `FILL_THE_TEMPLATE` allow-list; the `init-plan` and `plan` flows still allow neither. |

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`. `tests/whole-token-sibling-matchers.test.mjs` unit-tests `namesModule` and runs each matcher on fixtures: the hook as a subprocess (as `tests/nudge-hook.test.mjs` does), `validateDocsSync` and `validateDiffSuspicion` in process, the Git fixture through `tests/helpers/git.mjs`.

## Research decisions

- **What exists.** The three tests, verbatim:
  - `cli/commands/hooks.mjs`: `if (readFileSync(full, 'utf-8').includes(base)) docs.push(name);`
  - `cli/validators/docs-sync.mjs` (twice): `if (canonicalContent.includes(relPath) || canonicalContent.includes(name)) {`, where `name = basename(file, ext)`.
  - `cli/validators/diff-suspicion.mjs`: `if (line.includes(normalized)) return 'path';`

  Spec 075's `namesToken(line, name)` already states the whole-file-name rule; reconciliation's `namesWholePath` (spec 069) lists allowed edges and rejects a leading `/`, so it is not reused.
- **Nudge and Diff-Suspicion reuse `namesToken` unchanged.** Both test a file name with its extension, which is exactly what spec 075 defines. The nudge reads a document whole; `namesToken` is not line-bound (a newline is an edge), so no split is needed. Diff-Suspicion already tests line by line.
- **Docs-Sync needs a module-name variant, measured, not assumed.** Its fallback name has no extension. A strict `namesToken` on it was prototyped and compared with the substring test on 12 local projects with canonical documents and route or service directories (773 files checked). It turned 24 documented files into warnings; 10 of them are real references written as `module.member` (`jobLease.beginShutdown`, `whatsappRateService.loadRateTable`), which `namesToken` rejects because a period followed by a letter continues a file name. With a period as an edge on both sides, 14 files turn into warnings and none of them is a real reference (see tasks.md). *Rejected:* `\b` word boundaries, because a hyphen is a word boundary and `user-service` would still name `user`, the report's own example.
- **One character set.** `namesModule` sits beside `namesToken` and uses the same `NAME_CHAR_NOT_DOT` class, so the definition of a file-name character stays in one place; only the treatment of the period differs, and the comment says why. *Rejected:* an options flag on `namesToken`, which would edit the function spec 075 anchors and the `find` strings of its TestGuard faults for no gain in clarity.
- **Docs-Sync tests only the module name.** A whole-token path or file name implies a whole-word module name (`/` before it and `.` after it are edges), so keeping `namesToken(relPath)` beside it would be a branch no input can reach alone. The new set of documented files is a subset of the old one, because `namesModule` first requires the substring.
- **Leading period.** `app.routes.user` (Python) names `user`; a leading period is an edge for a module name. `impact.test.mjs` therefore still names a route called `test`, as it does today. Dotted names are ambiguous, and the old behaviour is kept for them.
- **DocGuard's own blank templates.** The full suite found that `init --skip-prompts` on the Next.js fixture of spec 044 now gets DSY001 for its three `route.ts` handlers. The templates only say "API routes". *Rejected:* teaching `init` to list routes. That is `generate --plan --write`'s job, and spec 044 already records the other post-`init` requests to fill the templates (DCV003, ENV003, SCH002, DDF001/DDF002, TRC002) as true statements about the project. The Express fixture still passes after `init`, because placeholder comments (`<!-- e.g. users table -->`) name `users` as a word. Whether Docs-Sync should skip placeholders is a separate question.
- **Cost.** `namesModule`, like `namesToken`, checks `includes` first and compiles the expression only when the name occurs. Docs-Sync runs it once per checked file over the concatenated documents; the hook once per document.
- **Shipping.** The coordinator for 0.45.0 asked that this land in the spec 075 pull request. It stays a separate spec because it changes guard findings and needs its own A/B record, and spec 075 lists it as out of scope.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| II (dependencies) | None added. |
| IX (honest assurance) | DSY001 / DSY002 stop reporting files as documented on evidence that does not name them; text matches stay labelled heuristics. |
| X (spec-first) | Spec, plan and tasks precede code. |

Pass.

## Project Structure

```text
cli/scanners/doc-references.mjs              # FR-002: namesModule
cli/commands/hooks.mjs                       # FR-001
cli/validators/docs-sync.mjs                 # FR-003
cli/validators/diff-suspicion.mjs            # FR-004
tests/whole-token-sibling-matchers.test.mjs  # NEW: FR-001–FR-006, SC-002
tests/generated-docs-e2e.test.mjs            # FR-006: init allow-list
testguard.claims.json                        # new claim WHOLE-TOKEN-SIBLING-MATCHERS
cli/findings.mjs, cli/commands/explain.mjs, docs/reference/agents.md,
docs/reference/findings.md, CHANGELOG.md, llms*.txt              # FR-005
```
