# Implementation Plan: Language and Repository Coverage

**Status**: Implemented and verified; retained as a living contract
**Spec**: `specs/009-language-repository-coverage/spec.md`

## Summary

R6 was delivered in four reviewable slices: Python import graphs, current Cloudflare
binding forms, section-owned mapped writers, and monorepo-root guidance. Keep the
spec active as the shared contract for future coverage changes.

## Technical Context

- Runtime: Node.js 18+ ES modules and built-ins.
- Optional parsers: the existing exact-pinned `@babel/parser` and a local Python
  interpreter using only the standard-library `ast` module.
- Inputs: repository source, static package/workspace manifests, Wrangler files,
  mapped Markdown, and DocGuard configuration.
- Safety: no project-module execution, dynamic import resolution, network access,
  automatic scope widening, symlink traversal, or unowned prose writes.
- Output: structured applicability plus existing guard, diff, score, diagnose,
  agent, SARIF/JUnit, and MCP surfaces where the underlying result is exposed.

## Project Structure

```text
cli/scanners/py-ast.mjs                 batched Python import syntax
cli/validators/architecture.mjs         cross-language local import graph
cli/shared-source.mjs                   Cloudflare binding and workspace signals
cli/shared-doc-roles.mjs                mapped-document write authorization
cli/writers/sections.mjs                unique section ownership validation
cli/docguard.mjs                        selected-root guidance integration
tests/python-import-graph.test.mjs       Python graph and abstention fixtures
tests/worker-python-capability.test.mjs  Cloudflare positive/control fixtures
tests/doc-role-boundaries.test.mjs       mapped-write preservation fixtures
tests/repository-root.test.mjs           monorepo-root guidance fixtures
```

## Phase 1 — Python graph

Extend the existing batched Python AST extractor to return static imports and
unsupported runtime-import signals. Build unique local module identities from
declared and conventional import roots, add resolved edges to the common graph,
and propagate parse/root/namespace limitations into architecture applicability.

## Phase 2 — Cloudflare forms

Extend the AST scope model with imported-binding identity, exported Pages handler
context, and supported entrypoint-class inheritance. Keep the lexical fallback
limited and report its unsupported forms rather than guessing class semantics.

## Phase 3 — Mapped writers

Replace the blanket custom-role write prohibition with operation-specific write
authorization. Section writers must verify a unique `source=code` section. Whole-
document generators must verify a new target or full generated ownership and a
one-role target. Route all writes through backup-preserving helpers.

## Phase 4 — Root guidance and closeout

Add ancestor ownership discovery before config loading, preserve the selected
directory, and serialize guidance in every machine format. Update public and
canonical contracts, run all supported runtimes and the benchmark, then complete
the reviewed lifecycle transaction.
