# Feature Specification: Whole-Token Matching in the Nudge Hook, Docs-Sync and Diff-Suspicion

**Feature Branch**: `fix/whole-token-matchers` (delivered in the spec 075 pull request)

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.whole-token-sibling-matchers`

**Lineage**: Applies the whole-token rule of `docguard.whole-token-doc-references` (spec 075, FR-001) to the three text matchers that spec lists as out of scope. No spec owned how these three decide that a document names a file, so this spec also records that rule as built. It does not touch the whole-path rule of `docguard.removed-file-attribution` (spec 069, FR-003), which rejects a leading `/` on purpose.

**Input**: Spec 075 made the shared reference matcher match a path or basename only as a whole token, through `namesToken` in `cli/scanners/doc-references.mjs`. Three other matchers still use a substring test:

1. The agent nudge hook (`docguard nudge-hook`, installed by `hooks --claude`) reads each canonical and root agent document whole and asks `includes(basename)`, so editing `src/b.mjs` nudges about any document that names `hub.mjs`.
2. Docs-Sync counts a route or service file as documented when the canonical documents contain its path or its extension-less name anywhere, so `user.js` is documented by `users`, `user-service` or `superuser`, and hides a real DSY001 / DSY002 warning.
3. Diff-Suspicion's `path` reference kind asks `line.includes(path)`, so `src/a.mjs` is found inside `othersrc/a.mjs`.

## Problem

Each matcher treats a name inside a longer name as a reference.

- **Nudge.** The hook tells the agent that documents "reference" a file they do not name: `config.js` is named by `tsconfig.json`, `anchors.mjs` by `ts-anchors.mjs`, `accounts.py` by `test_accounts.py`. On this repository 12 tracked code files nudge only because of such a name. An agent that follows the nudge runs `impact` and re-reads documents that do not describe the file.
- **Docs-Sync.** A false reference here is a false negative: the warning that a route or service is undocumented disappears. A route `user.js` passes because a document says `users`. Every Next.js `app/api/**/route.ts` passes because a document says "API routes". A service `exportRetention.ts` passes because a document names the field `exportRetentionDays`.
- **Diff-Suspicion.** `src/a.mjs` changes, and a document that names only `othersrc/a.mjs` is paired with it as a `path` reference. If the document shares removed tokens, DSP001 asks the reader to review it against a file it does not describe.

DocGuard's own blank templates depended on the same substring. After `init --skip-prompts`, a Next.js project's `route.ts` handlers passed DSY001 because the templates say "API routes", although no document names a route yet.

The extension-less name in Docs-Sync is not a file name. Documents write a module as `user.getById`, `app.routes.user` or `user.js`, so a period next to it is not part of a longer name. Spec 075's rule treats a period followed by a letter as a continuation (`b.mjs.bak`); applied to a module name it would drop those real references.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The nudge names only documents that name the edited file (Priority: P1)

**Independent Test**: A project whose architecture document names `src/hub.mjs` and `tsconfig.json`; an agent edits `src/b.mjs`, then `src/config.js`.

**Acceptance Scenarios**:

1. **Given** a canonical document that names only `hub.mjs`, **When** the agent edits `src/b.mjs`, **Then** the hook prints nothing.
2. **Given** a canonical document that names only `tsconfig.json`, **When** the agent edits `src/config.js`, **Then** the hook prints nothing.
3. **Given** a root `AGENTS.md` that names only `impact.test.mjs`, **When** the agent edits `src/test.mjs`, **Then** the hook prints nothing.
4. **Given** a canonical document that names `src/b.mjs`, `` `b.mjs` `` or `[b.mjs](src/b.mjs)`, **When** the agent edits `src/b.mjs`, **Then** the hook nudges toward `docguard impact` and lists that document.

### User Story 2 - Docs-Sync counts a route or service as documented only by its whole name (Priority: P1)

**Independent Test**: A project with `src/routes/user.js`, `src/services/auth.js` and `src/app/api/chat/route.ts`, and canonical documents that name each only inside longer names.

**Acceptance Scenarios**:

1. **Given** canonical documents that mention `users`, `user-service`, `superuser`, `user_id` and `userRoutes`, but not `user` alone, **Then** `src/routes/user.js` gets DSY001.
2. **Given** canonical documents that mention `authentication` and `oauth`, **Then** `src/services/auth.js` gets DSY002.
3. **Given** canonical documents that say "API routes" but never name `route` or the route's path, **Then** `src/app/api/chat/route.ts` gets DSY001.
4. **Given** `init --skip-prompts` on a Next.js project with route handlers, **Then** guard reports DSY001 for each handler, as a request to fill the blank templates; **When** `generate --plan --write` follows, **Then** guard reports none.
5. **Given** a canonical document that names `user` as `src/routes/user.js`, `./src/routes/user.js`, `user.js`, `` `user` ``, `user.getById`, `app.routes.user`, `/user/:id`, `**user**`, `| user |` or `the user route`, **Then** `src/routes/user.js` is documented and gets no DSY001.

### User Story 3 - A Diff-Suspicion path reference is the whole path (Priority: P2)

**Independent Test**: A two-commit Git fixture where `src/a.mjs` loses a symbol that a canonical document mentions.

**Acceptance Scenarios**:

1. **Given** a document that names only `othersrc/a.mjs` and shares the removed tokens, **Then** no DSP001 names that document.
2. **Given** a document that names `src/a.mjs` (bare, in backticks, after `lib/`, or as `src/a.mjs:12`) and shares the removed tokens, **Then** DSP001 names it as a `path` reference.
3. **Given** a document that backticks the module (`` `a` ``), **Then** DSP001 names it as a `module` reference, as today.

### Edge Cases

- A name at the start or end of a document is a whole token.
- The nudge reads each document whole; a line break is an edge.
- A module name has no extension, so a period on either side is an edge: `user.getById`, `app.routes.user` and `user.js` name `user`. The cost is that `user.service.ts` also names `user`, as it does today.
- A module name that is a common word (`index`, `route`, `utils`) still matches that word in prose, including placeholder comments in DocGuard's templates (`<!-- e.g. users table -->` names `users`). The whole-word rule removes names inside longer names; it does not make a common name specific.
- Docs-Sync's `--changed-only` scoping, its file selection and DSY003's OpenAPI comparison are unchanged.
- Diff-Suspicion's `module` kind and its rejection of bare basename references are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The nudge hook MUST treat a canonical or root agent document as referencing an edited code file only when the document names the file's basename as a whole file name, by `docguard.whole-token-doc-references#FR-001`. The documents it reads, its messages, its throttle and its silence on errors MUST stay as they are.
- **FR-002**: A module name (a file name without its extension) MUST match only as a whole word: the character before it is the start of the text or not a file-name character other than a period, and the same holds for the character after it. It MUST use the file-name character set of `docguard.whole-token-doc-references#FR-001`, defined once.
- **FR-003**: Docs-Sync MUST count a route file (DSY001) or service file (DSY002) as documented when the canonical documents name its module name by FR-002. That covers a mention of its path or file name, because `/` and `.` are edges. Which files it checks, its messages, severities and `--changed-only` scoping MUST stay as they are.
- **FR-004**: Diff-Suspicion's `path` reference kind MUST match the changed file's path by `docguard.whole-token-doc-references#FR-001`. The `module` kind and the rejection of bare basename references MUST stay as they are.
- **FR-005**: The help for DSY001 and DSY002, `docguard explain docsSync`, and the agent reference for the nudge hook MUST state that a name matches only as a whole name.
- **FR-006**: After `init --skip-prompts`, DSY001 and DSY002 MUST count among the requests to fill the blank templates in the allow-list of `docguard.generated-docs-consistency#SC-001`. The templates name no route or service, so the warning is true, and `init` followed by `generate --plan --write` MUST still report neither.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The User Story 1–3 cases that expect no reference fail before the change and pass after it; the cases that expect a reference pass before and after it.
- **SC-002**: Comparing the old and new rules on this repository and on other local projects, each matcher's new matches are a subset of its old ones, and every removed match is a name inside a longer name. `guard --format json` on this repository and on at least two other projects differs only by DSY001 / DSY002 warnings, each reviewed and recorded in tasks.md. `trace --reverse`, `impact` and `docguard_docs_for_path` do not change.

## Assumptions

- As in spec 075, non-ASCII letters are edges, so prose in Chinese, Japanese or Thai keeps naming files without spaces.
- A project that relied on a longer name to document a route or service would rather see the warning: the warning is the signal Docs-Sync exists to give, and DSY001 / DSY002 stay warnings.

## Out of Scope

- Making a common module name specific. A Next.js route handler is always `route.ts`; its identity is its directory. Matching a route by its URL path is a separate change.
- Which documents each matcher reads, and whether Docs-Sync should skip template placeholder comments.
- Changing `init` to name the routes it finds; `generate --plan --write` does.
- `namesWholePath` in reconciliation (spec 069): an evidence gate, where a missed match is the safe failure.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `4f46e9f6571abbd257c8c781b87cf6aaec9e3b52` — Reviewed at 4f46e9f (shipped in #571 with 075): the nudge hook, Docs-Sync and Diff-Suspicion match whole tokens. A/B on 42 projects: 2,500 to 2,514 findings, +14 real DSY001/DSY002, none lost, no status change; this repo unchanged. TestGuard WHOLE-TOKEN-SIBLING-MATCHERS 15/15. Canonical docs updated in the 0.45.0 verify PR. Deviations: none. Evidence: `cli/commands/hooks.mjs`, `cli/scanners/doc-references.mjs`, `cli/validators/diff-suspicion.mjs`, `cli/validators/docs-sync.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/generated-docs-e2e.test.mjs`, `tests/whole-token-sibling-matchers.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
