# Routine: bug-hunt (weekly, Monday)

Find one defect in one validator or scanner: a place where DocGuard reports
something its own docs or spec say it must not, or misses something they say
it must catch. Prove it with a new test that fails, then fix it.

Follow `.jules/RULES.md` throughout.

## Steps

1. Run `node .jules/preflight.mjs bug-hunt`. On STOP, end the task. On GO,
   the `target:` line is the one module you work on, and `governing spec:`
   names the spec(s) it implements.
2. Read what is promised about the target. Only these count:
   - the governing spec, `specs/*/spec.md` with that Spec ID;
   - `docs-canonical/`, `docs/` and `README.md`;
   - the finding codes it emits, in `docs/reference/findings.md`.

   Never derive a promise from the implementation itself. A test that pins
   what the code happens to do is not a finding.
3. Look for an input on which the module breaks a promise from step 2: a
   false positive, a missed finding, a crash, a wrong path or line. Build the
   input as a small project in a temporary directory.
4. If you find none, end the task with no pull request. The summary names
   the module and what you tried.
5. Write the reproduction first, in a **new** file
   `tests/<area>-<behaviour>.test.mjs`. Start it with a JSDoc block that
   quotes the promise and names the governing spec. Run
   `node --test tests/<that file>` on the unchanged code and keep the
   failing output: that is the first half of the **Evidence**.
6. Fix the target with the smallest change that makes the new test pass.
   Change only the target module unless the fix cannot live there; then
   stop and describe the fix in the summary instead.
7. Run the new test again and see it pass, then the checks in
   `.jules/RULES.md` §4.
8. Open the pull request. The title is the preflight title, with a summary
   such as `false positive on nested docs`. The body names the governing
   spec ID on its own line, for example
   `Governing spec: docguard.path-scoped-rules`, because CI's spec-first gate
   requires a change to `cli/` to name one.

A bug-hunt PR always waits for maintainer review. A bug-hunt PR without a new
failing test is closed on arrival.
