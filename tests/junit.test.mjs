/**
 * `docguard guard --format junit` — JUnit XML for GitLab/Jenkins/Azure (v0.33).
 *
 * @req SC-JUN-001 — toJUnit maps validators to testcases (pass/failure/skipped)
 * @req SC-JUN-002 — error findings become <failure>, warn-only becomes <system-out>
 * @req SC-JUN-003 — XML special characters are escaped (attributes AND bodies)
 * @req SC-JUN-004 — CLI emits parseable XML with no banner bytes; exit codes match guard
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { toJUnit } from '../cli/writers/junit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

describe('toJUnit — mapping', () => {
  it('maps pass/failure/warn/skipped validators to the right testcase shapes', () => {
    const xml = toJUnit({
      project: 'fixture',
      timestamp: '2026-07-15T00:00:00.000Z',
      validators: [
        { name: 'Structure', key: 'structure', status: 'pass', findings: [] },
        { name: 'Security', key: 'security', status: 'fail', findings: [
          { code: 'SEC001', severity: 'error', message: 'Hardcoded secret', location: 'src/a.js:3' },
        ] },
        { name: 'Freshness', key: 'freshness', status: 'warn', findings: [
          { code: 'FRS002', severity: 'warn', message: 'Doc is stale', location: 'docs-canonical/X.md' },
        ] },
        { name: 'Schema-Sync', key: 'schemaSync', status: 'na', findings: [] },
      ],
      findings: [],
    });
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /tests="4" failures="1" errors="0"/);
    assert.match(xml, /<testcase name="Structure" classname="docguard\.guard"\/>/);
    assert.match(xml, /<failure message="Hardcoded secret" type="SEC001">\[SEC001\] Hardcoded secret \(src\/a\.js:3\)<\/failure>/);
    assert.match(xml, /<system-out>\[FRS002\] Doc is stale/);
    assert.match(xml, /<testcase name="Schema-Sync" classname="docguard\.guard"><skipped\/><\/testcase>/);
  });

  it('M1 regression: a crashed validator (fail, no findings) renders as <error>, not a pass', () => {
    const xml = toJUnit({
      project: 'fixture',
      timestamp: 't',
      validators: [
        { name: 'Traceability', key: 'traceability', status: 'fail', errors: ['boom: undefined is not a function'], warnings: [], findings: [] },
      ],
      findings: [],
    });
    assert.match(xml, /errors="1"/);
    assert.match(xml, /<error message="boom: undefined is not a function" type="docguard\.crash">/);
    assert.ok(!/<testcase name="Traceability" classname="docguard\.guard"\/>/.test(xml),
      'must not render as a bare passing testcase');
  });

  it('escapes XML special characters in attributes and bodies', () => {
    const xml = toJUnit({
      project: 'fix<ture> & "co"',
      timestamp: 't',
      validators: [
        { name: 'Docs-Sync', key: 'docsSync', status: 'fail', findings: [
          { code: 'DSY001', severity: 'error', message: 'route </api?a=1&b=2> missing "docs"', location: null },
        ] },
      ],
      findings: [],
    });
    assert.ok(!/<\/api/.test(xml), 'raw < from message must not appear unescaped');
    assert.match(xml, /&lt;\/api\?a=1&amp;b=2&gt;/);
    assert.match(xml, /message="route &lt;\/api\?a=1&amp;b=2&gt; missing &quot;docs&quot;"/);
  });
});

describe('guard --format junit — CLI', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('emits parseable XML from byte 0 and exits 1 on a bare fixture (errors)', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-junit-'));
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'junit-fixture', profile: 'standard' }));
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
    const res = spawnSync('node', [CLI, 'guard', '--format', 'junit'], {
      cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.match(res.stdout, /^<\?xml version="1\.0"/, 'XML must start at byte 0 — no banner');
    assert.equal(res.status, 1, 'bare fixture has structure errors ⇒ exit 1');
    assert.match(res.stdout, /<failure /);
    // testsuites/testsuite well-formedness: every opened testcase closes
    const opens = (res.stdout.match(/<testcase /g) || []).length;
    const selfClosed = (res.stdout.match(/<testcase [^>]*\/>/g) || []).length;
    const closed = (res.stdout.match(/<\/testcase>/g) || []).length;
    assert.equal(opens, selfClosed + closed, 'well-formed testcases');
  });
});
