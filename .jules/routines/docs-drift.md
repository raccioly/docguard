# Routine: docs-drift (weekly, Friday)

Check what the user docs say about one subcommand against what the CLI
actually accepts, and fix the docs where they are wrong.

Follow `.jules/RULES.md` throughout.

## Steps

1. Run `node .jules/preflight.mjs docs-drift`. On STOP, end the task. On GO,
   the `target:` line is the one subcommand you check.
2. Read the truth from the CLI: `node cli/docguard.mjs <target> --help`, and
   `node cli/docguard.mjs --help` for the global options. Some subcommands
   have no help of their own and print the global help instead; for those,
   the options are the global ones plus what the subcommand's handler in
   `cli/commands/` reads.
3. Find every mention of `docguard <target>` in `README.md`,
   `README.<lang>.md` and `docs/**/*.md`.
4. A drift is any of these:
   - a flag or subcommand the docs show that the CLI does not accept;
   - a flag whose meaning or default the docs state differently from
     `--help`;
   - an example command for this subcommand that fails, or does something
     else, when you run it on a scratch project in a temporary directory.

   These are **not** drift:
   - wording or style;
   - counts of tests, checks or findings;
   - version numbers and links;
   - a feature the CLI does not have. That is a feature request; mention it in
     the summary.
5. If you found no drift, end the task with no pull request.
6. Where the docs are wrong, fix the docs.
   - Edit only `README.md`, `README.<lang>.md` and `docs/**/*.md`, except
     `docs/reference/findings.md`, which is generated.
   - In a translated README, fix only the same wrong flag or value.
   - Where the docs are right and the CLI is wrong, that is a bug: change
     nothing, and describe it in the task summary.
7. Run the checks in `.jules/RULES.md` §4, then open the pull request.

A docs change waits for maintainer review: the docs ship in the npm package.
Touching any other file closes the pull request as off-contract.
