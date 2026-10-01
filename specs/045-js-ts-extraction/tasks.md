# Tasks: Accurate JS/TS Extraction for Express and Next.js Projects

**Status**: Complete. On the three fixtures every count matches the written truth: Express 8/8 routes and auth flags, 3/3 entities, 2/2 relations, 5/5 env vars with defaults, 8/8 import edges; Next.js 6/6 routes and auth flags, 3/3 entities, 2/2 relations, 4/4 env vars, 8/8 edges; Prisma 4/4 entities, 2 enums, 3/3 relations. Guard and generate report the same entities (SC-004). Claim JS-TS-EXTRACTION-MATCHES-TRUTH: 32/32 faults killed.
**Spec**: `specs/045-js-ts-extraction/spec.md`
**Plan**: `specs/045-js-ts-extraction/plan.md`

## Phase 1: Tests first

- [x] T001 `tests/fixtures/js-ts-projects.mjs`: the Express + Mongoose,
  Next.js + Drizzle and Prisma projects with their written ground truth.
- [x] T002 `tests/js-ts-extraction.test.mjs`, reproducing each defect before
  the fix:
  - route chains and mount prefixes, AST and regex fallback (FR-001);
  - per-route and per-mount auth, Next.js handler and matcher auth, regex
    fallback (FR-002);
  - env destructuring, sites and defaults (FR-003);
  - Next.js env roots, and unchanged roots elsewhere (FR-004);
  - alias edges, `extends`, JSONC, package imports, missing targets (FR-005);
  - Drizzle config discovery, `src/db` dedupe, columns, relations, types,
    regex fallback (FR-006);
  - Mongoose nested fields, arrays, refs, model names, `lib/models`, regex
    fallback (FR-007);
  - Prisma enums, relation counts, braces in defaults; stack libraries and
    the plan's tech-stack table (FR-008);
  - as-built dedupe and citations (FR-009);
  - guard/generate entity agreement (FR-010);
  - docs describe the new forms (FR-011);
  - SC-001 to SC-006 against the written truth.

## Phase 2: Implementation

- [x] T003 `cli/scanners/js-ast.mjs`, `cli/scanners/routes.mjs`: route chains, per-route auth, mount auth, Next.js handler and middleware auth, lines (FR-001, FR-002, FR-009).
- [x] T004 `cli/scanners/ts-paths.mjs`, `cli/scanners/import-graph.mjs`, `cli/scanners/routes.mjs`: alias resolution (FR-005).
- [x] T005 `cli/shared-source.mjs`: env destructuring and sites; Next.js roots (FR-003, FR-004).
- [x] T006 `cli/scanners/schemas.mjs`, `cli/validators/schema-sync.mjs`, `cli/writers/doc-generators.mjs`: shared discovery; Drizzle, Mongoose, Prisma parsing; enums; ER types (FR-006, FR-007, FR-008, FR-010).
- [x] T007 `cli/scanners/project-type.mjs`, `cli/scanners/memory-plan.mjs`: libraries (FR-008).
- [x] T008 `cli/scanners/as-built.mjs`: dedupe and citations (FR-009).

## Phase 3: Docs and verification

- [x] T009 `docs-canonical/ARCHITECTURE.md`, `docs/commands.md`, `CHANGELOG.md` (FR-011).
- [x] T010 `testguard.claims.json`: claim JS-TS-EXTRACTION-MATCHES-TRUTH, probed `--confirm 3`; gate; `npm test`; `npm run llms`; `docguard specs --write`; `docguard guard`.
