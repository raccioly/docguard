# Feature Specification: Language and Repository Coverage

**Status**: Active
**Spec ID**: `docguard.language-repository-coverage`
**Created**: 2026-09-14
**Owner**: DocGuard maintainers

## Problem

DocGuard's safety model makes unsupported analysis visible, but several common
repository shapes still stop at that boundary. Python imports do not participate
in architecture checks, current Cloudflare binding extraction misses official
entrypoint forms, mapped canonical documents cannot receive even section-bounded
mechanical updates, and a command launched from a nested workspace can silently
assess only that package when the repository-level governance files live above it.

Coverage must expand without turning ambiguous syntax, runtime resolution, or an
accidentally narrow project root into a clean result.

## User Scenarios & Testing

### US1 — Check Python architecture relationships

As a Python maintainer, I can detect cycles and declared layer violations across
ordinary packages in flat and `src/` layouts. Relative imports resolve according
to package position. Dynamic imports, unresolved roots, and ambiguous namespace
packages remain visible limitations rather than inferred edges.

### US2 — Detect current Cloudflare binding access

As a Workers or Pages maintainer, DocGuard recognizes bindings accessed through
the official handler argument, `context.env`, class `this.env`, and imported
`env` forms. Identical property access in unrelated functions or classes stays
out of the environment inventory.

### US3 — Update mapped documents safely

As an enterprise adopter with existing documentation paths, I can run section-
bounded synchronization and mechanical repair. DocGuard may replace only a
unique, well-formed `source=code` section in an existing human document. A new
mapped file or an explicitly generated document may receive a full generated
write; shared-role targets and malformed ownership markers fail closed.

### US4 — Select the intended monorepo root

As a maintainer running DocGuard from a nested package, I receive deterministic
guidance when an ancestor owns DocGuard configuration or declares that package
as a workspace. Explicit `--dir` remains authoritative and DocGuard never widens
the scan automatically.

## Functional Requirements

- **FR-001**: Python import extraction MUST use Python's `ast` module through the
  existing optional interpreter tier, batch file reads, and never import or
  execute project modules.
- **FR-002**: Python graph resolution MUST support regular packages, module and
  package targets, explicit relative imports, repository-root flat layout, and
  conventional or configured `src/` import roots.
- **FR-003**: Absolute Python imports MUST become project edges only when exactly
  one repository module resolves under the declared roots. Standard-library,
  third-party, missing, and ambiguous targets MUST NOT become guessed edges.
- **FR-004**: Dynamic Python imports, interpreter absence, parse failures,
  namespace ambiguity, import-root ambiguity, and unsupported path mutation MUST
  remain explicit applicability limitations. Supported static edges already
  found MUST remain usable when applicability is partial.
- **FR-005**: Python and JavaScript/TypeScript edges MUST share cycle and layer-
  boundary evaluation while retaining language and dynamic metadata in machine
  results.
- **FR-006**: Worker binding extraction MUST support official module handler
  `env`, Pages `onRequest*` `context.env`, `WorkerEntrypoint`/`DurableObject`/
  `WorkflowEntrypoint` `this.env`, and `env` imported from
  `cloudflare:workers`, including aliases that preserve lexical identity.
- **FR-007**: Worker extraction MUST require static entrypoint evidence and
  lexical scope resolution. Unrelated `context.env`, `this.env`, shadowed names,
  comments, strings, computed non-literal keys, and imports from other modules
  MUST not count.
- **FR-008**: Parser failure MUST retain a conservative documented fallback and
  MUST expose forms unavailable to that fallback rather than claiming full
  extraction.
- **FR-009**: Existing mapped Markdown documents MAY be changed only inside one
  unique, well-formed `docguard:section` whose `source=code`. Missing, duplicate,
  nested, human-source, or malformed markers MUST produce a no-write reason.
- **FR-010**: Full-document generation at a mapped path MUST require either a
  missing target or the existing `docguard:generated true` marker. Multiple roles
  mapped to one file MUST reject full-document writes.
- **FR-011**: `--force` MUST NOT bypass mapped-document ownership. Every mapped
  write MUST preserve bytes outside the owned region and retain backup/audit
  behavior used by the equivalent default-layout writer.
- **FR-012**: Repository-root discovery MUST be read-only, bounded to ancestors,
  and use explicit DocGuard configuration plus recognized workspace declarations.
  Git top level MAY supply context but MUST NOT alone imply one governance root.
- **FR-013**: When a more likely ancestor root exists and the user did not provide
  `--dir`, human output MUST show an exact rerun command and machine output MUST
  expose structured guidance. DocGuard MUST continue at the selected directory
  and MUST NOT silently broaden the scan.
- **FR-014**: An explicit `--dir`, a nested `.docguard.json`, or no recognized
  ancestor ownership MUST suppress root guidance.
- **FR-015**: Every capability slice MUST include a supported fixture and a
  neighboring unsupported or false-positive control. Scanner changes MUST pass
  the frozen precision benchmark before release.
- **FR-016**: Canonical architecture, environment, security, test, configuration,
  CLI, roadmap, and agent instructions MUST state the new support and its limits.

## Success Criteria

- **SC-001**: Flat-layout, `src/`-layout, and relative-import Python cycles are
  detected; dynamic imports and ambiguous namespace portions cannot produce a
  false supported pass.
- **SC-002**: Official Cloudflare examples for all supported access forms enter
  the environment inventory, while paired lookalikes remain excluded in both AST
  and fallback tiers.
- **SC-003**: Mapped sync and section-regeneration fixtures prove byte-for-byte
  preservation outside owned markers; malformed and shared targets perform no
  writes even with `--force`.
- **SC-004**: Nested npm/pnpm workspace fixtures receive actionable root guidance
  without changing the selected scan result; standalone nested repositories and
  explicit `--dir` do not.
- **SC-005**: The supported Node matrix, parser-absent package path, full suite,
  self-guard, and frozen benchmark show no regression.

## Non-Goals

- Reproducing Python's runtime finder, editable-install, import-hook, zip, network,
  or arbitrary `sys.path` behavior.
- Treating every directory without `__init__.py` as one complete namespace package.
- Executing Wrangler, loading project configuration, or discovering remote bindings.
- Giving DocGuard ownership of prose outside explicit code-source markers.
- Automatically changing the project directory selected by the user.

