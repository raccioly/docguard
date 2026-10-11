# Routine: test-gaps (weekly, Wednesday)

Add tests for exported functions of one CLI module that no test imports yet.
This routine only adds new test files; it changes nothing else.

Follow `.jules/RULES.md` throughout.

## Steps

1. Run `node .jules/preflight.mjs test-gaps`. On STOP, end the task. On GO,
   the `target:` line is the one module you work on, and `untested exports:`
   lists its exported functions no test imports.
2. For each listed export, up to five, find what it is for:
   - its JSDoc and its callers in `cli/`;
   - the spec that the module's `@implements` lines name;
   - `docs-canonical/`, `docs/` and `README.md`.

   Drop an export whose behaviour no caller, comment or doc describes, and
   list it under **Dropped**. Never derive the expected value from running
   the function and copying its output.
3. Write the tests in **new** files only, `tests/<module>-<area>.test.mjs`,
   using `node:test` and `node:assert/strict`. Do not edit an existing test
   file, a fixture or a helper. A test that needs files builds them in a
   temporary directory and removes it afterwards.
4. Prove each test can fail: change the function's return value by hand,
   run `node --test tests/<new file>` and see it fail, then revert the change.
   Paste both runs in **Evidence**.
5. If a test fails on the unchanged code, you found a bug, not a gap: keep
   that test out of this pull request and describe the failure in the summary.
6. Run the checks in `.jules/RULES.md` §4, then open the pull request. The
   title is the preflight title, with a summary such as `three exports
   covered`.

A pull request that only adds new test files merges on a green CI without a
maintainer. Touch any other file and it is closed as off-contract.
