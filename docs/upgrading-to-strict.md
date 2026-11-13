---
title: Upgrading to Strict
nav_order: 4
---

# Upgrading to the strict default

Strict is now the default enforcement mode. A project with no `enforcement` key
runs under it, and a check that applies to the project and examined nothing now
fails the run with exit 4 instead of reading as green. The default changed
because a check that silently examines nothing is what let an agent-instruction
file go stale for seven weeks while guard exited 2. If your build turned red
after upgrading, each failure below names its cause and the way to clear it.

## What a strict failure looks like

This is a real run on a fixture: a small service with Express routes and a
DynamoDB client, no CHANGELOG, no API reference and no README.

```text
  Enforcement: strict — the default: no "enforcement" key
  Verdicts: 1 pass · 1 fail · 4 empty · 1 inconclusive · 0 blocked · 30 skipped

  Adopt — what strict found and how to resolve each item:
    • Changelog is empty (needs-declaration)
        Create CHANGELOG.md with a "## [Unreleased]" section and one "## [x.y.z] - YYYY-MM-DD" heading per release (Keep a Changelog); `docguard init` writes the file, and `requiredFiles.changelog` in .docguard.json names a different path.
    • API-Surface is inconclusive (needs-declaration)
        If the project already keeps the API reference in another Markdown file, set docs.roles.apiReference in .docguard.json to that file: "docs": { "roles": { "apiReference": "<path to that file>" } }. Otherwise create docs-canonical/API-REFERENCE.md with one table row per endpoint (`GET /path`); `docguard generate` drafts it from the routes it reads.
    • Docs-Coverage is empty (needs-declaration)
        Write README.md with "## Installation", "## Usage" and "## License" sections (`docguard init` creates a documentation set); Docs-Coverage then checks the project's configuration files, bin entries and source directories against it.
    Waive a validator that does not apply, with a reason, an owner and an expiry:
        <!-- docguard:validator <key> n/a — <reason> owner:<@handle> expires:<YYYY-MM-DD> -->
    Choose the lower mode on purpose:
        "enforcement": "standard"   (in .docguard.json)

  DocGuard could not read: (reported only; this does not change the exit code)
    • Schema-Sync is empty (layout-not-recognized)
        Schema-Sync found package.json depends on the database library @aws-sdk/client-dynamodb (DynamoDB), but no model in a form it reads, so it compared no table with docs-canonical/DATA-MODEL.md.
```

The first block is what fails the run. Each item is a validator that applies to
your project and examined nothing, with its cause (`needs-declaration`: a file
or key is missing; `needs-content`: the file exists and holds nothing to check)
and the fix. The second block is reported and never changes the exit code. The
same facts are in `--format json` under `strict.unexamined` and
`strict.couldNotRead`.

`docguard upgrade` prints this report for your project without running a gate
and without writing anything.

## Ways forward

Take them in this order.

1. **Fix or declare.** Apply the fix under each item: write the document, add
   the declaration, or map a document you already have. A document you keep
   somewhere else is mapped, not moved:

   ```json
   { "docs": { "roles": { "apiReference": "docs/api.md" } } }
   ```

   `docguard generate` drafts a document from the code it will be compared
   with. Edit what it drafted: a draft that nobody read proves little.

2. **Waive, with a reason, an owner and an expiry.** For a validator that does
   not apply to your project, put this in a canonical document or `AGENTS.md`:

   ```markdown
   <!-- docguard:validator apiSurface n/a — CLI only, no HTTP surface owner:@ana expires:2027-06-30 -->
   ```

   The validator is reported as waived on every run. From the day after the
   expiry it counts as unexamined again.

3. **Stay on the lower mode.** One line in `.docguard.json` restores the
   behavior before the default changed, with the exit codes it had:

   ```json
   { "enforcement": "standard" }
   ```

## Roll it out in stages with `asOf`

A new release can add a validator or a gating finding code to strict. To hold a
project at the set it already passes, name the release line:

```json
{ "enforcement": { "mode": "strict", "asOf": "0.48" } }
```

Anything added to strict after that release is reported as pending and does not
change the exit code. Remove `asOf`, or raise it, when you are ready for the
newer set. A validator or code added in the running release or the one before
it is labeled "new in vX.Y" when it fails.

## Existing findings: the baseline

Findings that already exist should not block the day you upgrade. Record them:

```bash
docguard guard --update-baseline
```

Commit `.docguard.baseline.json`. A finding whose fingerprint is in the file
does not fail the run, a new finding of the same code does, and every run under
strict prints how many findings are baselined. The baseline covers findings
only. A validator that examined nothing is cleared by a fix or a waiver.

## What does not fail a build

- A validator that does not apply to your project. It is skipped, with what it
  looked for as the reason.
- A partial result: a validator that did examine something and could not read
  the rest (some routes, an optional parser).
- A layout DocGuard does not read, such as a data layer it has no reader for.
  The report lists what the validator does read; nothing is asked of your
  project.
- A finding that is a warning. Under strict a finding fails the build only if
  its code could already fail a build before the default changed, or its
  measured precision clears the published bar.
- A validator you disabled in your own `.docguard.json` with
  `"validators": { "<key>": false }`. It is reported as disabled by
  configuration on every run.

## Stay on `standard`

Set `"enforcement": "standard"` and nothing else changes: findings and exit
codes equal the release before the default changed. `docguard init` writes no
`enforcement` key unless you ask: `docguard init --enforcement standard`
writes it, and the interactive setup asks once.

## In CI

A pipeline that fails on a non-zero exit fails on exit 4. See
[Continuous Integration](guides/ci.md) for the Action and the templates, and
[Configuration](configuration.md#enforcement-mode) for every key.
