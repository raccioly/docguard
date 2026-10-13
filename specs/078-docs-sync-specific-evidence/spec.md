# Feature Specification: Docs-Sync Counts Only Visible, Specific Names

**Feature Branch**: `fix/docs-sync-specific-evidence`

**Created**: 2026-10-12

**Status**: Draft

**Spec ID**: `docguard.docs-sync-specific-evidence`

**Lineage**: Resolves the two weaknesses that `docguard.whole-token-sibling-matchers` (spec 077) lists as out of scope. It refines that spec's FR-003: a route or service is still documented by its module name as a whole word (FR-002 there), except where the module name does not identify the file. It applies `docguard.generated-docs-consistency` (spec 044, FR-006: template placeholder text is not a claim) to Docs-Sync, reads comments with the shared reader of `docguard.quoted-comment-openers` (spec 074, FR-001), and counts the `covers` declarations of `docguard.doc-dependency-lock` (spec 030, FR-001).

**Input**: Spec 077 made Docs-Sync (DSY001, DSY002) count a route or service file as documented only when a canonical document names its module name, the file name without its extension, as a whole word. Two weaknesses were found while measuring it:

1. Template placeholder comments count as documentation. After `docguard init --skip-prompts` on an Express project, `src/routes/users.js` passes DSY001 only because DocGuard's blank templates say `<!-- e.g. users table -->` and `<!-- e.g. Registered users -->` (DATA-MODEL.md) and `<!-- How users/services authenticate -->` (SECURITY.md).
2. A common module name is not specific. Every Next.js App Router handler is `route.ts`, so the word "route" anywhere in a canonical document documents all of them. `index` and other stems that several files share have the same problem.

## Problem

Docs-Sync reads every canonical document raw and asks whether the module name appears anywhere in it. That has two consequences.

- **Hidden text documents files.** An HTML comment is not rendered. Neither a reader of the document nor an agent that renders it sees it. DocGuard's templates fill every table cell and section with placeholder comments, and those name common words (`users`, `services`, `User`), so a blank `init` reports a route as documented when no document describes it. Spec 044 already established that placeholder text is not a claim: ENV004 and DDF001 ignore HTML comments. Docs-Sync does not.
- **A shared or conventional name identifies nothing.** On 38 local projects, 544 of the 772 files Docs-Sync checks are Next.js `route.ts` handlers. Each counts as documented as soon as any canonical document contains the word "route", whether or not the handler's URL appears anywhere. A Next.js handler's identity is its directory: `src/app/api/users/[id]/route.ts` serves `/api/users/{id}`. In the same way, `services/auth/index.ts` is the module `services/auth`, so the word "index" ("the message index") does not document it, and five `types.ts` files are documented by the word "types".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Text a reader cannot see does not document a file (Priority: P1)

**Independent Test**: A project with `src/routes/users.js` whose canonical documents name `users` only inside HTML comments.

**Acceptance Scenarios**:

1. **Given** documents that name `users` only in comments (`<!-- e.g. users table -->`, and a comment that spans several lines), **Then** `src/routes/users.js` gets DSY001.
2. **Given** `init --skip-prompts` on the Express fixture, **Then** guard reports DSY001 for `src/routes/users.js`, as a request to fill the blank templates; **When** `generate --plan --write` follows, **Then** guard reports no DSY finding.
3. **Given** a document that names `users` in visible text next to a comment (`users <!-- note -->`), in an inline code span that quotes `<!--` (`` `<!--` users ``), or inside a fenced code block that contains `<!--`, **Then** the file is documented.
4. **Given** a `docguard:section` marker whose `covers` lists `src/routes/users.js` (with or without a `#symbol`), **Then** the file is documented, although the marker is a comment.

### User Story 2 - A Next.js route handler is documented by its URL path (Priority: P1)

**Independent Test**: A project with `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/(admin)/audit/route.ts` and `src/app/api/deals/[dealId]/notes/route.ts`.

**Acceptance Scenarios**:

1. **Given** documents that say "route", "routes", "route.ts", "users" and "the users route" but never a handler's path, **Then** every handler gets DSY001.
2. **Given** a document that names `/api/users/{id}`, `GET /api/users/:id`, `/api/users/[userId]`, `https://example.com/api/users/<id>`, `src/app/api/users/[id]/route.ts` or `app/api/users/[id]/`, **Then** `src/app/api/users/[id]/route.ts` is documented, and `src/app/api/users/route.ts` is not.
3. **Given** a document that names `/api/users`, **Then** `src/app/api/users/route.ts` is documented and `src/app/api/users/[id]/route.ts` is not.
4. **Given** a document that names `/api/audit` or `src/app/api/(admin)/audit/route.ts`, **Then** the route-group handler is documented.
5. **Given** a document that names `/api/deals/*`, **Then** `src/app/api/deals/[dealId]/notes/route.ts` is documented; **Given** only `/api/*` or `src/app/api/*/route.ts`, **Then** it is not.
6. **Given** a fenced file tree under `src/app/api/` that draws `users/` then `[id]/route.ts`, **Then** `src/app/api/users/[id]/route.ts` is documented; **Given** a tree that draws `auth/` then `register/route.ts`, **Then** `src/app/api/oauth/register/route.ts` is not.

### User Story 3 - A name that several files share is qualified by its directory (Priority: P2)

**Independent Test**: A project with `src/services/auth/index.ts`, `src/services/auth/types.ts`, `src/services/billing/index.ts`, `src/services/billing/types.ts`, `src/routes/index.ts` and `src/services/payments.ts`.

**Acceptance Scenarios**:

1. **Given** documents that say "index", "types", "auth" and "billing", and name `services/auth/OktaAuthService.ts`, **Then** each `index.ts` and `types.ts` gets DSY002 or DSY001.
2. **Given** a document that names `auth/types`, `auth/types.ts` or `services.auth.types`, **Then** `src/services/auth/types.ts` is documented and `src/services/billing/types.ts` is not.
3. **Given** a document that names `auth/index`, `services/auth`, `src/services/auth/` or `app.services.auth`, **Then** `src/services/auth/index.ts` is documented.
4. **Given** a document that names `src/routes` or `routes/index.ts`, **Then** `src/routes/index.ts` is documented; the word "routes" alone does not.
5. **Given** a document that says only "payments", **Then** `src/services/payments.ts`, whose module name no other checked file shares, is documented, as under spec 077.
6. **Given** `guard --changed-only` where only `src/services/auth/types.ts` changed, **Then** it is still qualified by its directory: whether a name is shared does not depend on which files changed.
7. **Given** a file tree that draws `services/`, `auth/`, then `index.ts`, **Then** `src/services/auth/index.ts` is documented.

### Edge Cases

- A comment that never closes hides the rest of the document, as a browser does.
- A `<!--` inside an inline code span is text (spec 074), and a fenced code block is text, comments in it included (CommonMark).
- A URL path ends where it ends: `/api/users/{id}` does not name `/api/users`, and `/api/users` does not name `/api/users/{id}`. A trailing slash, a sentence period, a query string or a fragment ends the path.
- Any dynamic-segment syntax names any other (`[id]`, `[...slug]`, `[[...slug]]`, `{id}`, `:id`, `:id*`, `<id>`), as API-Surface compares them.
- A prefix before the path is allowed: a host, a base path, `src/app` or a monorepo package directory.
- A Next.js handler's directory is its identity, so naming the directory (`src/app/api/users/`, or `users/` drawn under `src/app/api/` in a tree) documents the handler in it.
- A drawn file tree names a file across several lines. Each entry is joined to the entries it is drawn under and to the directory line just above the tree; a tree with no such line starts at its first entry. Trees drawn with `├──`/`└──` and with `|--`/`` `-- `` are read alike.
- A trailing wildcard names the routes under its prefix only when the prefix has a segment below `/api`. `/api/*` is as unspecific as the word "routes".
- A Next.js handler is never documented by its module name, even when it is the only handler.
- Two files whose paths differ only by extension (`auth.ts`, `auth.js`) share every tail; either is documented by the path without extension.
- A module name that no other checked file shares keeps spec 077's rule, so a single `utils.ts` is still documented by the word "utils". Recognising common words is not a mechanical rule.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Docs-Sync MUST read each canonical document as a reader sees it: text inside an HTML comment does not document a file. Comments MUST be read with the shared reader of `docguard.quoted-comment-openers#FR-001`, so a `<!--` inside an inline code span is text. Fenced code blocks MUST be read as text, comments in them included.
- **FR-002**: A file that a `docguard:section` marker lists in its `covers` attribute (`docguard.doc-dependency-lock#FR-001`) MUST count as documented. The path before any `#symbol` must equal the file's project-relative path.
- **FR-003**: A Next.js App Router route handler (a `route` file under `app/api/`) MUST count as documented only when a canonical document names the URL path it serves, and never by its module name. The URL path is the one the route scanner derives, with route groups removed, and dynamic segments compare as API-Surface compares them. The path may appear as a URL (with a method, host or base path before it) or inside the handler's file or directory path. It MUST end there. A trailing `*` or `**` after a prefix with at least one segment below `/api` names the routes under that prefix.
- **FR-004**: Any other route or service file MUST be named by the shortest tail of its path, without the extension, that no other file Docs-Sync checks shares. The tail is matched as a whole word by `docguard.whole-token-sibling-matchers#FR-002`, with `/` or `.` between its segments. A module name that no other checked file shares is its own tail, so spec 077's rule is unchanged for it.
- **FR-005**: An `index` or `__init__` file is its directory's module. Its tail MUST include its directory (`auth/index`), and a document that names the directory as a module path also names it. That path is `services/auth`, `src/services/auth/` or `app.services.auth`: the directory and its parent, not continuing into a file or a deeper directory.
- **FR-006**: Which tails are shared MUST be decided over every file Docs-Sync selects, whatever `--changed-only` scopes. Which files it checks, its messages, its severities (warnings) and DSY003 MUST stay as they are. A finding's `suggestion` MUST say which name documents the file.
- **FR-007**: The help for DSY001 and DSY002 and `docguard explain docsSync` MUST state FR-001 to FR-005 and FR-008. After `init --skip-prompts`, DSY001 and DSY002 stay among the requests to fill the blank templates of `docguard.generated-docs-consistency#SC-001`; after `init` then `generate --plan --write`, and after `generate --plan --write` alone, guard MUST report neither on any fixture stack.

- **FR-008**: A file tree drawn in a canonical document (`├──`, `└──`, `|--`, `` `-- ``) MUST name the path of each entry it draws, joined to the entries above it and to the directory line just above the tree, for FR-003 to FR-005.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The User Story 1–3 cases that expect a warning fail before the change and pass after it. Every case that expects a file to be documented passes after it; those whose evidence the old rule also accepted pass before it too.
- **SC-002**: Run `guard --format json` with the base CLI and the new CLI on `git archive` copies of this repository and of the local projects with canonical documents, one copy per CLI. Findings differ only by added DSY001/DSY002 warnings, and none disappears. Every changed finding is recorded in tasks.md, a sample of at least 20 across every changed project is reviewed by hand, and any false positive found is recorded with how it was excluded. Guard on this repository is unchanged, and its wall time stays within the CI budget.

## Assumptions

- A canonical document's HTML comments are notes to its authors or DocGuard markers. Among 772 checked files on 38 local projects, none is documented only by text in a comment, so FR-001 changes no real project's findings.
- A documentation author names a Next.js handler by its URL. The 173 handlers that lose their documentation on the measured projects have no path, file path or wildcard in any canonical document (sample in tasks.md).
- DSY001 and DSY002 stay warnings. A pipeline that passes today keeps passing; it sees more warnings.

## Out of Scope

- Recognising common words (`utils`, `types`, `helpers`) as unspecific when only one checked file has that name. A list of words would be a guess; sharing is a fact.
- Next.js Pages Router handlers (`pages/api/`) and parallel-route or private folders; Docs-Sync does not select them today.
- Other validators that read HTML comments (ENV004, DDF001, traceability) and their own comment handling.
- Changing which files Docs-Sync selects, for example whether a `types.ts` under `services/` is a service.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `4f46e9f6571abbd257c8c781b87cf6aaec9e3b52` — Reviewed at 4f46e9f (shipped in #575): Docs-Sync ignores names in comments, names Next.js handlers by URL path, shared files by unique path tail, and reads drawn trees. A/B on 38 projects: +173 DSY001, +11 DSY002 on 9, none removed, severities unchanged; 24 hand-reviewed, no false positive; budget PASS; TestGuard 52/52. Canonical docs updated in the verify PR. Deviations: none. Evidence: `cli/scanners/doc-references.mjs`, `cli/scanners/routes.mjs`, `cli/shared-html-comments.mjs`, `cli/validators/docs-sync.mjs`, `docs-canonical/ARCHITECTURE.md`, `docs-canonical/TEST-SPEC.md`, `tests/docs-sync-specific-evidence.test.mjs`, `tests/generated-docs-e2e.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
