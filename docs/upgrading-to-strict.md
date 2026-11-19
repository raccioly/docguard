---
title: Upgrading to Strict
nav_order: 4
---

# Upgrading to the strict default

Strict is now the default enforcement mode. A project with no `enforcement` key
runs under it. A check that applies to the project but examined nothing now fails
the run with exit 4. Before, it counted as green. We changed the default because
a check that silently examines nothing let an agent-instruction file go stale for
seven weeks while guard exited 2. If your build turned red after you upgraded,
each failure below names its cause and how to clear it.

## What a strict failure looks like

This is a real run on a fixture. The fixture is a small service with Express
routes and a DynamoDB client. It has no CHANGELOG, no API reference and no
README.

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

The first block is what fails the run. `— new in v0.48` marks an item added in
the running release or the one before it. Each item is a validator that applies
to your project and examined nothing. It shows the cause and the fix. The cause
`needs-declaration` means a file or key is missing. The cause `needs-content`
means the file exists and holds nothing to check. The second block is only
reported. It never changes the exit code. The same facts are in `--format json`
under `strict.unexamined` and `strict.couldNotRead`.

`docguard upgrade` prints this report for your project. It runs no gate and
writes nothing.

## Ways forward

Take them in this order.

1. **Fix or declare.** Apply the fix under each item. Write the document, add
   the declaration, or map a document you already have. If you keep a document
   somewhere else, map it. Do not move it:

   ```json
   { "docs": { "roles": { "apiReference": "docs/api.md" } } }
   ```

   `docguard generate` drafts a document from the code that DocGuard will
   compare it with. Edit the draft. A draft that nobody read proves little.

2. **Waive, with a reason, an owner and an expiry.** If a validator does not
   apply to your project, put this in a canonical document or `AGENTS.md`:

   ```markdown
   <!-- docguard:validator apiSurface n/a — CLI only, no HTTP surface owner:@ana expires:2027-06-30 -->
   ```

   Every run reports the validator as waived. From the day after the expiry, it
   counts as unexamined again.

3. **Stay on the lower mode.** One line in `.docguard.json` restores the
   behavior from before the default changed, with the same exit codes:

   ```json
   { "enforcement": "standard" }
   ```

## Your config says `false` for some checks

Older versions of `docguard init` wrote `"validators": { "architecture": false,
"security": false, ... }` into `.docguard.json` for most projects. The profile
wrote those entries, not a decision by you. Under strict, those entries do not
switch a validator off. Every validator runs, so checks you never asked for now
run too. On every run, guard prints the `Not honored under strict` line shown
above. It names the entries that it did not honor. `docguard upgrade` lists those
validators under what now runs. `--format json` carries them as
`strict.ignoredDisabled`.

To switch a validator off on purpose, use one of two ways:

- a reasoned waiver, for a validator that does not apply (see Ways forward);
- `"enforcement": "standard"`, under which the `validators` block works as it
  always did.

New projects no longer get `false` entries from `init`.

## Roll it out in stages with `asOf`

A new release can add a validator or a gating finding code to strict. To keep a
project at the set from an earlier release, name that release line:

```json
{ "enforcement": { "mode": "strict", "asOf": "0.47" } }
```

Every validator is listed under `0.48`. With `"asOf": "0.47"`, guard keeps the
exit codes that the project has today. It also prints the strict report beside
them. What a later release adds appears under `Pending (strict since a later
release; reported only, this does not change the exit code)` and in
`strict.pending[]`.

```text
  Enforcement: strict (as of 0.47) — set by "enforcement" in .docguard.json
  Pending (strict since a later release; reported only, this does not change the exit code):
    • Docs-Sync — strict since v0.48
    • Changelog — strict since v0.48
    • API-Surface — strict since v0.48
```

When you are ready for the newer set, raise `asOf` to `"0.48"` or remove it.

## Existing findings: the baseline

Existing findings should not block you on the day you upgrade. Record them:

```bash
docguard guard --update-baseline
```

Commit `.docguard.baseline.json`. A finding whose fingerprint is in the file does
not fail the run. A new finding of the same code does fail it. Every run under
strict prints how many findings are baselined, even if the number is zero. The
baseline covers findings only. To clear a validator that examined nothing, fix it
or waive it.

## What does not fail a build

- A validator that does not apply to your project. DocGuard skips it and gives
  what it looked for as the reason.
- A partial result. The validator examined something but could not read the rest
  (some routes, an optional parser).
- A layout DocGuard does not read, such as a data layer it has no reader for.
  The report lists what the validator does read. DocGuard asks nothing of your
  project.
- A finding that is a warning. Under strict, a finding fails the build only if
  its code could already fail a build before the default changed, or if its
  measured precision clears the published bar.

## Stay on `standard`

Set `"enforcement": "standard"` and nothing else changes. Findings and exit
codes are the same as in the release before the default changed. `docguard init`
writes no `enforcement` key unless you ask. `docguard init --enforcement standard`
writes it, and the interactive setup asks once.

## A new project

A project that has just run `docguard init` is on the strict default too. Its
generated documents hold nothing yet. The next `docguard guard` lists what is
still empty and exits 4. This is a real run on a small Node project, right after
`docguard init --profile standard --skip-prompts`:

```text
  Enforcement: strict — the default: no "enforcement" key ("enforcement": "standard" selects the lower mode)
  Adopt — what strict found and how to resolve each item:
    • Docs-Coverage is empty (needs-content) — new in v0.48
        Write README.md with "## Installation", "## Usage" and "## License" sections; Docs-Coverage checks each of them and every configuration file, bin entry and source directory the project has against the documentation.
    • Doc-Quality is empty (needs-content) — new in v0.48
        Write at least 50 words in 3 or more sentences of plain paragraphs, for example an overview in README.md; Doc-Quality then scores the passive voice, pronouns, readability and sentence length of each document with enough prose.
```

First, fill the generated documents, or run `docguard generate` to draft them from
your code. The hooks behave like this:

- The pre-commit hook that `docguard hooks` installs runs the full `guard`. It
  blocks a commit while items are open. `git commit --no-verify` skips it.
- `guard --changed-only` is the line for husky, lefthook and similar managers. It
  does not evaluate this rule, so it does not block.
- The generated pre-push hook runs `score`, which does not evaluate the rule.
  `docguard ci` does evaluate it, and it blocks.

A project with no `.docguard.json` keeps `standard`: guard exits 3 and says
`Enforcement: standard — this project has no .docguard.json; run docguard init
to adopt DocGuard (strict applies once it is initialized)`.

## In CI

A pipeline that fails on any non-zero exit also fails on exit 4. See
[Continuous Integration](guides/ci.md) for the Action and the templates, and
[Configuration](configuration.md#enforcement-mode) for every key.

Check out the full history. Freshness compares each document with the commits that
touched it. `actions/checkout` fetches one commit unless you say otherwise. A
shallow checkout like that no longer fails the build. On every run, guard reports
Freshness under "DocGuard could not read" (cause `history-unavailable`) and
leaves the exit code alone. But Freshness checks nothing until you fetch the full
history, so set `fetch-depth: 0` anyway:

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0
```

The Action's own examples and the templates already do this. A repository that
really has fewer than three commits (a fresh `git init`) is a different case. It
still exits 4. To fix it, commit your work.
