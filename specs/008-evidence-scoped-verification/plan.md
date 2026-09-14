# Implementation Plan: Evidence-Scoped Verification

**Status**: Implemented and verified; lifecycle closeout pending
**Spec**: `specs/008-evidence-scoped-verification/spec.md`

## Summary

Add one strict declaration manifest and a pure evaluation library, expose it
through `verify --evidence`, and integrate it as an optional guard validator.
Reuse the existing safe evidence-reader and ignore contracts. Keep upstream API
compatibility semantics in oasdiff and Buf by consuming saved outputs only.

## Technical Context

- Runtime: Node.js 18+ ES modules and built-ins.
- Inputs: Markdown, JSON, JSON Lines, repository file collections.
- Addressing: RFC 6901 for JSON and literal section-scoped Markdown templates.
- Safety: no symlinks, traversal, `.local`, `.env*`, external commands, or
  network; bounded bytes, files, declarations, and report findings.
- Output: deterministic declaration evaluations plus guard findings.

## Project Structure

```text
.docguard-evidence.json                     optional project declarations
schemas/docguard-evidence.schema.json       public manifest contract
cli/evidence/manifest.mjs                   strict loading and combinations
cli/evidence/adapters.mjs                   JSON, collection, oasdiff, Buf
cli/evidence/markdown.mjs                   heading/template selection
cli/evidence/evaluate.mjs                   states and stable identities
cli/validators/evidence.mjs                 guard mapping
cli/commands/verify.mjs                     --evidence presentation
tests/evidence-*.test.mjs                   paired fixtures and integrations
```

## Phase 1 — Contract and safe primitives

Publish the schema and strict loader. Reuse `createEvidenceReader` where its
contract fits, and extract shared safe path/hash helpers only if duplication
would otherwise diverge. Implement RFC 6901 and section-scoped template matching
with unit tests before adapters.

## Phase 2 — Exact adapters and states

Implement typed JSON scalar/set reads, bounded collection counts, saved oasdiff
JSON, and saved Buf JSON Lines. Validate producer metadata and external input
hashes before evaluating findings. Normalize each failure into the five-state
contract without collapsing missing and unsupported evidence.

## Phase 3 — CLI and guard integration

Add `verify --evidence` text/JSON output and an optional Evidence validator.
Register stable finding codes and applicability. Preserve semantic candidates as
a separate assurance stream; deduplicate only a proven identical selected claim.

## Phase 4 — Documentation and closeout

Add project examples and canonical architecture/security/test/CI guidance. Run
focused tests, full tests, guard, benchmark baseline, package dry-run, supported
Node versions, and pinned external corpus. Complete the spec lifecycle only after
all evidence is reviewed.
