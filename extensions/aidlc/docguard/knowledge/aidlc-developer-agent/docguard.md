# DocGuard in AI-DLC

DocGuard (docguard plugin) checks that the project's docs, specs and AI-DLC
records still match the code. It runs as the `docguard-guard` sensor at the
code-generation and build-and-test gates.

## Reading a result

- `pass: false` lists finding codes such as `API001 docs-canonical/API-REFERENCE.md:12 …`.
  Run `docguard explain <CODE>` for what a code means and how to fix it.
- A validator DocGuard could not run, or a required check it could not decide,
  also makes `pass` false. That is a tooling or input problem, not a docs defect.
  Read the reason before changing any document.
- `AID00x` codes are about this AI-DLC workspace:
  - `AID001`: a traceability target no longer exists.
  - `AID002`: a gap was left in a completed stage.
  - `AID003`: a unit's deliverable was removed.
  - `AID004`: a record cannot be read.
- `MEM00x` codes mean a learned rule or the CodeKB names something that is gone.

## Fixing drift

1. Change the code or the doc so they agree. Prefer fixing the doc when the code
   is the intended behavior, and log a `// DRIFT:` reason when the code
   deliberately departs from a canonical decision.
2. Re-run the gate. The sensor caches by tree state, so any edit re-checks.

## Feeding verified facts

`docguard memory --export aidlc --write` writes the facts DocGuard verified to
this space's `knowledge/docguard/canonical-memory.md`. Index it with
`aidlc engine knowledge onboard <that path>`. DocGuard never edits memory layers.
