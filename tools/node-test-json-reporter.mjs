/**
 * node:test → Jest-shape JSON reporter.
 *
 * TestGuard's probe drives a runner with `--runner-cmd "... {files} ... {out}"`
 * and reads {out} as Jest/vitest JSON. node:test ships no `json` reporter
 * (default, dot, junit, lcov, spec, tap), so a node:test suite cannot be probed
 * without this translation.
 *
 * Emits only what src/probe/runners/shared.mjs reads:
 *   { testResults: [{ name, status, assertionResults: [{ status, fullName }] }],
 *     numTotalTests, numPassedTests, numFailedTests }
 *
 * A file whose status is 'failed' with an EMPTY assertionResults is how the
 * probe recognises "defenders failed to load" — so a file that never produced a
 * test must be reported that way rather than silently omitted.
 */
export default async function* jsonReporter(source) {
  const byFile = new Map();
  const fileOf = (event) => event.data?.file || event.data?.nesting === 0 && event.data?.name || 'unknown';
  const bucket = (file) => {
    if (!byFile.has(file)) byFile.set(file, { name: file, status: 'passed', assertionResults: [] });
    return byFile.get(file);
  };

  for await (const event of source) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      // Suites emit a pass/fail too; only leaf tests are assertions.
      if (event.data?.details?.type === 'suite') continue;
      const f = bucket(fileOf(event));
      const failed = event.type === 'test:fail';
      f.assertionResults.push({
        status: failed ? 'failed' : 'passed',
        fullName: event.data?.name ?? '',
        title: event.data?.name ?? '',
        failureMessages: failed ? [String(event.data?.details?.error?.message ?? 'failed')] : [],
      });
      if (failed) f.status = 'failed';
    } else if (event.type === 'test:fail' || event.type === 'test:stderr') {
      // no-op: captured above / not part of the contract
    }
  }

  const testResults = [...byFile.values()];
  const all = testResults.flatMap((f) => f.assertionResults);
  yield JSON.stringify({
    testResults,
    numTotalTests: all.length,
    numPassedTests: all.filter((t) => t.status === 'passed').length,
    numFailedTests: all.filter((t) => t.status === 'failed').length,
    success: all.every((t) => t.status === 'passed'),
  }) + '\n';
}
