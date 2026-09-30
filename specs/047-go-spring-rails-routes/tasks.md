# Tasks: Go, Spring and Rails Route Extraction

**Status**: Not started.
**Spec**: `specs/047-go-spring-rails-routes/spec.md`
**Plan**: `specs/047-go-spring-rails-routes/plan.md`

## Phase 1: Tests first

- [ ] T001 `tests/go-spring-rails-routes.test.mjs`: the eight reference projects
  with hand-written ground truth; the scanner reports exactly the truth set for
  each (SC-001). Written against today's scanner first, which fails them.
- [ ] T002 `tests/go-spring-rails-routes.test.mjs`: per-requirement cases:
  - Go groups, cross-file group parameters, returned routers, chi closures and
    mounts, block-scoped names, cycles (FR-001);
  - Go route forms, Go 1.22 patterns, comments, `_test.go`, client calls (FR-002);
  - Spring class bases and method mappings in Java and Kotlin, constants,
    comments, Feign clients (FR-003, FR-004);
  - Rails namespace/scope, resources/resource options, nesting, shallow,
    member/collection, verbs, match, root, concerns, draw, comments (FR-005);
  - unresolvable prefixes and paths are omitted; methods are standard or `ANY`
    (FR-006, SC-003);
  - Go module `/vN` classification and gorilla/mux (FR-007);
  - guard's API surface and `diff` agree on a documented Gin project (FR-008);
  - the docs describe the readers (FR-009).
- [ ] T003 `tests/routes-multilang.test.mjs`: correct the gin assertion that
  pinned `DELETE /users/:id` for a route on `r.Group("/api")` (SC-002).

## Phase 2: Implementation

- [ ] T004 `cli/scanners/go-routes.mjs` (FR-001, FR-002, FR-006).
- [ ] T005 `cli/scanners/spring-routes.mjs` (FR-003, FR-004, FR-006).
- [ ] T006 `cli/scanners/rails-routes.mjs` (FR-005, FR-006).
- [ ] T007 `cli/scanners/routes.mjs`: the three scanners call the readers.
- [ ] T008 `cli/scanners/project-type.mjs`: `/vN` suffix; gorilla/mux (FR-007).

## Phase 3: Docs and verification

- [ ] T009 `docs/commands.md`, `docs-canonical/TEST-SPEC.md`, `CHANGELOG.md` (FR-009).
- [ ] T010 `testguard.claims.json`: claim GO-SPRING-RAILS-ROUTES-COMPOSE-PREFIXES,
  probed `--confirm 3`; gate; `npm test`; `npm run llms`;
  `docguard specs --write`; `docguard guard`.
