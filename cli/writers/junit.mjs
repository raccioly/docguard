/**
 * JUnit XML writer — `docguard guard --format junit`.
 *
 * SARIF covers GitHub Code Scanning; JUnit covers everything else an
 * enterprise runs: GitLab CI (`artifacts:reports:junit`), Jenkins
 * (`junit` step), Azure DevOps, CircleCI, Bamboo. One testcase per
 * validator keeps the report readable in those UIs — a failed validator
 * shows its findings (code + message + location) as the failure body.
 *
 * Mapping (deterministic):
 *   validator error findings         → <failure> (red in every CI)
 *   validator crashed (fail, no
 *   structured findings)             → <error> from its string errors (red)
 *   warn-only validator              → passing testcase + findings in
 *                                      <system-out> (visible, non-gating)
 *   skipped / n/a                    → <skipped/>
 *
 * Zero npm dependencies — pure string assembly with strict XML escaping.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findingLine(f) {
  const code = f.code ? `[${f.code}] ` : '';
  const loc = f.location ? ` (${f.location})` : '';
  return `${code}${f.message}${loc}`;
}

/**
 * Build the JUnit XML document from runGuardInternal's data.
 * `data.validators` entries: { name, status, findings? }; `data.findings`
 * is the flat list with `validator` back-references — we group by the
 * validator display name via each result's own findings when present,
 * falling back to the flat list.
 */
export function toJUnit(data) {
  const cases = [];
  let failures = 0, errorCount = 0, skipped = 0;

  for (const v of data.validators || []) {
    const vFindings = Array.isArray(v.findings)
      ? v.findings
      : (data.findings || []).filter(f => f.validator === v.key || f.validator === v.name);
    const errors = vFindings.filter(f => f.severity === 'error');
    const warns = vFindings.filter(f => f.severity !== 'error');
    const attrs = `name="${esc(v.name)}" classname="docguard.guard"`;

    if (v.status === 'skipped' || v.status === 'na') {
      skipped++;
      cases.push(`    <testcase ${attrs}><skipped/></testcase>`);
    } else if (errors.length > 0) {
      failures++;
      const body = errors.map(findingLine).join('\n');
      cases.push(
        `    <testcase ${attrs}>\n` +
        `      <failure message="${esc(errors[0].message)}" type="${esc(errors[0].code || 'docguard')}">${esc(body)}</failure>\n` +
        `    </testcase>`
      );
    } else if (v.status === 'fail') {
      // A validator that failed WITHOUT structured error findings — the
      // crash path (guard catches the throw and records string errors only).
      // This must go red in CI, not render as a passing testcase (M1).
      errorCount++;
      const body = (v.errors || []).join('\n') || 'validator failed without structured findings';
      cases.push(
        `    <testcase ${attrs}>\n` +
        `      <error message="${esc((v.errors || [])[0] || 'validator failed')}" type="docguard.crash">${esc(body)}</error>\n` +
        `    </testcase>`
      );
    } else if (warns.length > 0) {
      const body = warns.map(findingLine).join('\n');
      cases.push(
        `    <testcase ${attrs}>\n` +
        `      <system-out>${esc(body)}</system-out>\n` +
        `    </testcase>`
      );
    } else {
      cases.push(`    <testcase ${attrs}/>`);
    }
  }

  const total = (data.validators || []).length;
  const suiteAttrs =
    `name="docguard guard — ${esc(data.project || 'project')}" ` +
    `tests="${total}" failures="${failures}" errors="${errorCount}" skipped="${skipped}" ` +
    `timestamp="${esc(data.timestamp || '')}"`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites tests="${total}" failures="${failures}" errors="${errorCount}">\n` +
    `  <testsuite ${suiteAttrs}>\n` +
    cases.join('\n') + (cases.length ? '\n' : '') +
    `  </testsuite>\n` +
    `</testsuites>`
  );
}
