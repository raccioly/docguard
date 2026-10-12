# Tasks: Docs-Sync Counts Only Visible, Specific Names

**Status**: Complete.

**Spec**: `specs/078-docs-sync-specific-evidence/spec.md`
**Plan**: `specs/078-docs-sync-specific-evidence/plan.md`

## Evidence

- **SC-001.** Before the change, 16 of the 18 Docs-Sync and documentation cases in `tests/docs-sync-specific-evidence.test.mjs` fail: every case that expects a warning, and the cases that expect a URL path, a `covers` declaration or a qualified name to document a file, which the old rule did not read. Two pass before and after: visible text next to a comment, a quoted `<!--` or a fenced comment documents the file, and a unique module name documents its file by the word. After the change all 36 tests pass. That includes the unit tests for `visibleMarkdown`, `appRouterPath`, `createUrlPathMatcher`, `namesDirectory` and `treePaths`, and the repository oracle (SC-002).
- **Severity.** DSY001 and DSY002 stay warnings and their messages are byte-identical, so a baselined finding stays baselined. No guard status changed on any measured project (table below), so no pipeline that passes on 0.44.3 starts failing.
- **SC-002, per project.** Each CLI ran `guard --format json` on its own `git archive` copy of every local project with canonical documents (36 Git checkouts at HEAD; 2 projects without Git, copied without dependencies). The runs were one at a time, with no other load. Base is the commit that carries spec 077 (`f3bf73d`); 0.44.3 is the last release. Projects are described, not named.

  | Project | Stack | 0.44.3 | Base | Head | Head − base |
  |---|---|---:|---:|---:|---|
  | A1–A4 (four checkouts of one project) | Next.js, JavaScript | 50, 51, 51, 47 | 50, 51, 51, 47 | 84, 85, 85, 83 | +34, +34, +34, +36 DSY001 |
  | B | Next.js monorepo | 35 | 35 | 38 | +3 DSY001 |
  | C | Next.js | 97 | 97 | 99 | +2 DSY001 |
  | D | Next.js | 166 | 166 | 187 | +21 DSY001 |
  | E | Next.js | 57 | 58 | 67 | +9 DSY001 (the base's +1 ARC002 is spec 076) |
  | F | TypeScript backend | 469 | 472 | 483 | +11 DSY002 (the base's +3 DSY002 are spec 077) |
  | G | Next.js | 22 | 27 | 27 | none (the base's +5 DSY001 are spec 077) |
  | H | Next.js | 168 | 169 | 169 | none (the base's +1 DSY001 is spec 077) |
  | 30 others | mixed | | | | none |
  | **Total** | | **2,080** | **2,090** | **2,274** | **+184, none removed** |

  Statuses are identical in all three columns. B and E fail on errors from other validators in every column.
- **Review of the 184.** For each added finding, the canonical documents were searched for the last literal segment of the handler's path (or for the directory of a barrel). 109 findings have no path-like mention at all. The other 75 were read one by one: each mention is another route, a UI page, a different file or prose. A sample of 24, across every changed copy:

  | Copy | File | What the documents say instead |
  |---|---|---|
  | A1 | `src/app/api/access/route.js` | `/api/org-access` (another handler) and the `/access` page |
  | A1 | `src/app/api/review-pipeline/route.js` | nothing |
  | A1 | `src/app/api/assistant/conversations/route.js` | the `ASSISTANT_CONVERSATIONS` table partition, not the route |
  | A2 | `src/app/api/assistant/feedback/route.js` | `/api/feedback` and `/api/account/feedback`, other handlers |
  | A2 | `src/app/api/preferences/route.js` | `POST /api/preferences/notify` (another handler) and the `/preferences` page |
  | A3 | `src/app/api/admin/users/route.js` | only the `/admin/users` page |
  | A3 | `src/app/api/email/route.js` | `email` as a field name only |
  | A4 | `src/app/api/auth/entra/callback/route.js` | "Entra callback validation" in prose, never the path |
  | A4 | `src/app/api/tl-pipeline/route.js` | nothing |
  | B | `apps/portal/src/app/api/locator-embed/route.ts` | the Store Locator pages, not this handler |
  | B | `apps/portal/src/app/api/reference/route.ts` | "external reference" in a table |
  | B | `apps/portal/src/app/api/documentation/abmt/[document]/route.ts` | nothing |
  | C | `src/app/api/jobs/combine/route.ts` | "combine the facts" in prose about article synthesis |
  | C | `src/app/api/jobs/similar/route.ts` | "title similarity" in a deduplication requirement |
  | D | `src/app/api/oauth/register/route.ts` | a file tree that lists `auth/register/route.ts`, which no longer exists |
  | D | `src/app/api/health/route.ts` | "synergy health scores" |
  | D | `src/app/api/me/route.ts` | `/api/channels/:channelId/members/me`, another handler |
  | D | `src/app/api/clients/[clientId]/members/route.ts` | `/api/channels/:channelId/members`, another handler |
  | E | `src/app/api/csp-report/route.ts` | "CSP headers" in a table |
  | E | `src/app/api/dynamic-proxy/[...path]/route.ts` | `src/lib/auth-proxy/` and `src/lib/wallet-proxy/`, other modules |
  | E | `src/app/api/settings/tokens/route.ts` | `src/lib/tokens.ts`, another file |
  | F | `backend/src/services/auth/index.ts` | files inside `services/auth/` (`OktaAuthService.ts`), never the directory as a module or `auth/index` |
  | F | `backend/src/services/dashboard/index.ts` | `dashboardService.ts` and `dashboard/dashboardCache.ts`, other files |
  | F | `backend/src/services/sqs/types.ts` | `sqsProcessor.ts`; no `sqs/types` |

- **False positives found while measuring, and how they were excluded.**
  - *Wildcards.* A first prototype without wildcards flagged 230 handlers. One project documents its API groups as `/api/deals/*`, `/api/platform-admin/*` and so on. FR-003 now reads a trailing `*` or `**`.
  - *`/api/*`.* Counting it documented all 322 handlers of the four A checkouts, which write `/api/*` once. FR-003 requires a segment below `/api`.
  - *Drawn file trees.* 15 projects draw trees in their canonical documents. A handler listed only in a tree would have been a false positive. FR-008 reads trees, joining each entry to the entries and the directory line above it. On these projects it changes no result (239 Docs-Sync warnings with or without it); it removes the class.
  - *Path decoration.* A host or port, a base path, a query, a fragment, a trailing period, a Markdown link `[/api/x](#y)` and a table cell are all read as the same path (unit tests).
  - *Dotted module paths.* `app.services.auth` names the directory and `services.auth.types` names the tail, for Python projects.
  - No false positive remained among the 184 after review.
- **Comments (FR-001).** Among the 772 files Docs-Sync checks on these projects, none is documented only by text inside an HTML comment. That holds whether every comment is stripped, every comment but `docguard:` markers, or only DocGuard's template placeholders. No project's canonical documents use `covers`.
- **DocGuard's own `init` (FR-007).** After `init --skip-prompts`, the Express fixture now gets DSY001 for `src/routes/users.js`, which only the templates' placeholder comments named; the `init` and `init-spec` flows allow it. `init-plan` and `plan` report no DSY finding on any of the five fixture stacks (`tests/generated-docs-e2e.test.mjs`).
- **This repository.** It has no route or service directory, so Docs-Sync checks no file. The head CLI on the base tree reports exactly the base CLI's findings. On its own tree the differences are lifecycle findings for this branch's specs, and they clear at completion. Docs-Sync takes 2.2 ms here; the evidence is read only when a file is checked.
- **Budget** (`npm run budget -- --base <f3bf73d tree>`): PASS. Guard on this repository 16,940 → 17,429 ms (budget ≤ 19,481; Docs-Sync itself is under 5 ms of it); fixtures 441 → 452 and 528 → 523 ms; agent-facing bytes +40 to +147; package size +5,081 bytes; no new dependency or error.

## Phase 1: Tests first

- [x] T001 `tests/docs-sync-specific-evidence.test.mjs`: unit tests for `visibleMarkdown`, `createUrlPathMatcher`, `namesDirectory`, `appRouterPath` and `treePaths`. Fixtures for User Stories 1–3, each with its neighbouring valid case, and the `init` case. Confirm the cases that expect a warning fail before the change (FR-001–FR-008, SC-001).

## Phase 2: Implementation

- [x] T002 FR-001: `visibleMarkdown` in `cli/shared-html-comments.mjs`
- [x] T003 FR-003: `appRouterPath` in `cli/scanners/routes.mjs`; `createUrlPathMatcher` in `cli/scanners/doc-references.mjs`
- [x] T004 FR-005, FR-008: `namesDirectory` and `treePaths` in `cli/scanners/doc-references.mjs`
- [x] T005 FR-001–FR-006: `cli/validators/docs-sync.mjs` reads visible text, drawn trees and `covers`, selects every file before scoping, and names each file by its identity

## Phase 3: Proof, docs and verification

- [x] T006 SC-002: `guard --format json` with the base CLI and the new CLI on `git archive` copies of this repository and every local project with canonical documents, one copy per CLI, run one at a time. Every changed finding recorded; a sample of 24 reviewed across every changed copy; false positives recorded with how they were excluded; guard on this repository and the budget job.
- [x] T007 FR-007: DSY001 / DSY002 help and `npm run docs:reference`; `explain docsSync`; e2e allow-list comment; `CHANGELOG.md`; `npm run llms`.
- [x] T008 TestGuard: claim `DOCS-SYNC-SPECIFIC-EVIDENCE` (`req:docguard.docs-sync-specific-evidence#FR-001`), one fault per rule (17); `WHOLE-TOKEN-SIBLING-MATCHERS` F2 re-pointed at the new module-name line. Probed with `--confirm 3 --serial`. The first probe left F7 alive: the two-segment wildcard rule was enforced twice, so either copy alone was dead code. One copy was removed and F7 now mutates the other. Re-probed on `f10b51f` with every claim whose faults sit in an edited file (`DOCS-SYNC-SPECIFIC-EVIDENCE`, `WHOLE-TOKEN-SIBLING-MATCHERS`, `DOC-REFERENCES-WHOLE-TOKEN`, `MCP-DOC-TOOLS-EXACT-AND-BOUNDED`, `QUOTED-COMMENT-OPENER-HIDES-NOTHING`): 52 of 52 faults killed.
- [x] T009 `npm test`; `docguard specs --write`; requirement anchors reviewed and accepted per link (35 changed links in six files) and per spec (12 new links); `docguard guard`.
