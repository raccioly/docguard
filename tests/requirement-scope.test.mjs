import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { runTraceFeatures } from '../cli/commands/trace.mjs';
const id = ['FR', '001'].join('-');
for (const [name, refs, expected] of [
  ['bare duplicate is ambiguous', `// @req ${id}`, [0, 0]],
  ['qualified duplicate covers only its spec', `// @req specs/a/spec.md#${id}`, [1, 0]],
  ['two qualified declarations cover both', `// @req specs/a/spec.md#${id}\n// @req specs/b/spec.md#${id}`, [1, 1]],
  ['wrong qualifier never falls back', `// @req specs/missing/spec.md#${id}`, [0, 0]],
  ['qualified label covers only its spec', `test('specs/b/spec.md#${id}', () => {});`, [0, 1]],
  ['normalized relative qualifier', `// @req ./specs/a/spec.md#${id}`, [1, 0]],
]) {
  test(name, t => {
    const root = mkdtempSync(join(tmpdir(), 'dg-scoped-req-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const feature of ['a', 'b']) safeWrite(join(root, `specs/${feature}/spec.md`), `# Feature ${feature}\n- ${id}: implement ${feature}\n`);
    safeWrite(join(root, 'tests/link.test.mjs'), refs);
    const config = { projectName: 'fixture', requiredFiles: { canonical: [] } };
    const result = validateTraceability(root, config);
    assert.equal(result.findings.filter(f => f.code === 'TRC005').length, name === 'wrong qualifier never falls back' ? 1 : 0);
    const missing = result.findings.filter(f => f.code === 'TRC004');
    assert.equal(missing.length, 2 - expected.reduce((a,b) => a+b, 0));
    for (const [i, feature] of ['a','b'].entries()) assert.equal(missing.some(f => f.location.startsWith(`specs/${feature}/spec.md:`)), !expected[i]);
    const logs = [], previous = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try { runTraceFeatures(root, config, { format: 'json' }); } finally { console.log = previous; }
    const report = JSON.parse(logs.join('\n'));
    for (const [i, feature] of ['a','b'].entries()) {
      const row = report.features.find(f => f.dir === `specs/${feature}`);
      assert.equal(row.signals.reqCoverage.covered, expected[i]);
      assert.equal(row.signals.reqCoverage.total, 1);
    }
  });
}

for (const reference of [id, 'specs/a/spec.md#' + id, 'specs/missing/spec.md#' + id]) {
  test('unique identity resolution: ' + reference, t => {
    const root = mkdtempSync(join(tmpdir(), 'dg-unique-req-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    safeWrite(join(root, 'specs/a/spec.md'), '# Requirements\n- ' + id + ': implement\n- ' + id + ': repeated mention\n');
    safeWrite(join(root, 'tests/link.test.mjs'), '// @req ' + reference);
    const result = validateTraceability(root, { requiredFiles: { canonical: [] } });
    const invalid = reference.includes('missing');
    assert.equal(result.findings.filter(f => f.code === 'TRC004').length, invalid ? 1 : 0);
    assert.equal(result.findings.filter(f => f.code === 'TRC005').length, invalid ? 1 : 0);
    assert.equal(result.passed, invalid ? 0 : 1);
  });
}
