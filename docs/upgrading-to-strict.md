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
  Enforcement: strict — the default: no "enforcement" key ("enforcement": "standard" selects the lower mode)
  Verdicts: 1 pass · 3 fail · 7 empty · 1 inconclusive · 0 blocked · 25 skipped
  Not honored under strict (these validators run): "validators": false for architecture, security
    Switch one off on purpose with a reasoned waiver (<!-- docguard:validator <key> n/a — <reason> owner:<@handle> expires:<YYYY-MM-DD> -->) or choose "enforcement": "standard".

  Adopt — what strict found and how to resolve each item:
    • Changelog is empty (needs-declaration) — new in v0.48
        Create CHANGELOG.md with a "## [Unreleased]" section and one "## [x.y.z] - YYYY-MM-DD" heading per release (Keep a Changelog); `docguard init` writes the file, and `requiredFiles.changelog` in .docguard.json names a different path.
    • API-Surface is inconclusive (needs-declaration) — new in v0.48
        If the project already keeps the API reference in another Markdown file, set docs.roles.apiReference in .docguard.json to that file: "docs": { "roles": { "apiReference": "<path to that file>" } }. Otherwise create docs-canonical/API-REFERENCE.md with one table row per endpoint (`GET /path`); `docguard generate` drafts it from the routes it reads.
    • Docs-Coverage is empty (needs-declaration) — new in v0.48
        Write README.md with "## Installation", "## Usage" and "## License" sections (`docguard init` creates a documentation set); Docs-Coverage then checks the project's configuration files, bin entries and source directories against it.
    (four more items of the same shape)
    Record the 2 existing finding(s) that fail the build (new ones of the same code still fail):
        docguard guard --update-baseline
    Waive a validator that does not apply, with a reason, an owner and an expiry:
        <!-- docguard:validator <key> n/a — <reason> owner:<@handle> expires:<YYYY-MM-DD> -->
    Choose the lower mode on purpose:
        "enforcement": "standard"   (in .docguard.json)

  DocGuard could not read: (reported only; this does not change the exit code)
    • Schema-Sync is empty (layout-not-recognized)
        Schema-Sync found package.json depends on the database library @aws-sdk/client-dynamodb (DynamoDB), but no model in a form it reads, so it compared no table with docs-canonical/DATA-MODEL.md.

  📋 0 findings baselined (.docguard.baseline.json; `docguard guard --update-baseline` records the existing ones)
```

The first block is what fails the run. `— new in v0.48` marks an item added in the running release or the one before it. Each item is a validator that applies to
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

## Your config says `false` for some checks

Older versions of `docguard init` wrote `"validators": { "architecture": false,
"security": false, ... }` into `.docguard.json` for most projects, from the
profile and not from a decision. Under strict those entries do not switch a
validator off: every validator runs, so the checks you never asked for now run
too. Guard prints, on every run, the `Not honored under strict` line shown above,
naming the entries it did not honor, and `docguard upgrade` lists those
validators under what now runs. `--format json` carries them as
`strict.ignoredDisabled`.

To switch a validator off on purpose, use one of two ways:

- a reasoned waiver, for a validator that does not apply (see Ways forward);
- `"enforcement": "standard"`, under which the `validators` block works as it
  always has.

New projects no longer get `false` entries from `init`.

## Roll it out in stages with `asOf`

A new release can add a validator or a gating finding code to strict. To hold a
project at the set of an earlier release, name that release line:

```json
{ "enforcement": { "mode": "strict", "asOf": "0.47" } }
```

Every validator is listed under `0.48`, so with `"asOf": "0.47"` guard keeps
the exit codes the project has today and prints the strict report beside them:
what a later release adds appears under `Pending (strict since a later
release; reported only, this does not change the exit code)` and in
`strict.pending[]`.

```text
  Enforcement: strict (as of 0.47) — set by "enforcement" in .docguard.json
  Pending (strict since a later release; reported only, this does not change the exit code):
    • Docs-Sync — strict since v0.48
    • Changelog — strict since v0.48
    • API-Surface — strict since v0.48
```

Raise `asOf` to `"0.48"`, or remove it, when you are ready for the newer set.

## Existing findings: the baseline

Findings that already exist should not block the day you upgrade. Record them:

```bash
docguard guard --update-baseline
```

Commit `.docguard.baseline.json`. A finding whose fingerprint is in the file
does not fail the run, a new finding of the same code does, and every run under
strict prints how many findings are baselined, zero included. The baseline covers findings
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

## Stay on `standard`

Set `"enforcement": "standard"` and nothing else changes: findings and exit
codes equal the release before the default changed. `docguard init` writes no
`enforcement` key unless you ask: `docguard init --enforcement standard`
writes it, and the interactive setup asks once.

## A new project

A project that has just run `docguard init` is on the strict default too, and
its generated documents hold nothing yet. The next `docguard guard` lists what
is still empty and exits 4. This is a real run, right after
`docguard init --profile standard --skip-prompts` on a small Node project:

```text
  Enforcement: strict — the default: no "enforcement" key ("enforcement": "standard" selects the lower mode)
  Adopt — what strict found and how to resolve each item:
    • Docs-Coverage is empty (needs-content) — new in v0.48
        Write README.md with "## Installation", "## Usage" and "## License" sections; Docs-Coverage checks each of them and every configuration file, bin entry and source directory the project has against the documentation.
    • Doc-Quality is empty (needs-content) — new in v0.48
        Write at least 50 words in 3 or more sentences of plain paragraphs, for example an overview in README.md; Doc-Quality then scores the passive voice, pronouns, readability and sentence length of each document with enough prose.
```

First step: fill the generated documents, or run `docguard generate` to draft
them from your code. What the hooks do about it:

- The pre-commit hook that `docguard hooks` installs runs the full `guard`, so
  it blocks a commit while items are open. `git commit --no-verify` skips it.
- `guard --changed-only`, the line for husky, lefthook and similar managers,
  does not evaluate this rule, so it does not block.
- The generated pre-push hook runs `score`, which does not evaluate the rule.
  `docguard ci` does, and blocks.

A project with no `.docguard.json` keeps `standard`: guard exits 3 and says
`Enforcement: standard — this project has no .docguard.json; run docguard init
to adopt DocGuard (strict applies once it is initialized)`.

## In CI

A pipeline that fails on a non-zero exit fails on exit 4. See
[Continuous Integration](guides/ci.md) for the Action and the templates, and
[Configuration](configuration.md#enforcement-mode) for every key.

Check out the full history. Freshness compares each document with the commits
that touched it, and a checkout with fewer than three commits gives it nothing
to read, so guard exits 4 and names Freshness in the Adopt block.
`actions/checkout` fetches one commit unless told otherwise:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
```

The Action's own examples and the templates already do this.
