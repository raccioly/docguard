import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { applyMechanicalFix } from '../cli/writers/mechanical.mjs';

describe('mechanical writers', () => {
  let dir;
  const write = (rel, content) => writeFileSync(join(dir, rel), content);
  const read = (rel) => readFileSync(join(dir, rel), 'utf-8');
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-mech-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('replace-count: rewrites the stale number and is idempotent', () => {
    write('R.md', 'DocGuard ships 19 validators. (also: 9/10 checks passed)\n');
    const r1 = applyMechanicalFix(dir, { type: 'replace-count', file: 'R.md', label: 'validators', found: 19, actual: 20 });
    assert.equal(r1.applied, true);
    assert.ok(read('R.md').includes('20 validators'));
    assert.ok(read('R.md').includes('9/10 checks'), 'ratio-style "9/10" not touched');
    const r2 = applyMechanicalFix(dir, { type: 'replace-count', file: 'R.md', label: 'validators', found: 19, actual: 20 });
    assert.equal(r2.applied, false, 'idempotent re-run');
  });

  it('replace-version: only edits actionable contexts, never prose', () => {
    write('R.md', [
      'Install: `npm i docguard-cli@0.9.5`',
      'Download: https://example.com/releases/v0.9.5/file.tgz',
      'config: { version: "0.9.5" }',
      'In v0.9.5 we shipped a feature (prose mention — must survive).',
    ].join('\n'));
    const r = applyMechanicalFix(dir, { type: 'replace-version', file: 'R.md', found: '0.9.5', actual: '0.10.0' });
    assert.equal(r.applied, true);
    const after = read('R.md');
    assert.ok(after.includes('docguard-cli@0.10.0'), '@-install rewritten');
    assert.ok(after.includes('releases/v0.10.0/'), 'URL rewritten');
    assert.ok(after.includes('version: "0.10.0"'), 'declaration rewritten');
    assert.ok(after.includes('In v0.9.5 we shipped a feature'), 'prose mention preserved');
  });

  it('insert-changelog-unreleased: inserts before the first version section, idempotent', () => {
    write('CHANGELOG.md', '# Changelog\n\n## [1.0.0] - 2023-01-01\n- init\n');
    const r1 = applyMechanicalFix(dir, { type: 'insert-changelog-unreleased', file: 'CHANGELOG.md' });
    assert.equal(r1.applied, true);
    const after = read('CHANGELOG.md');
    assert.ok(after.includes('## [Unreleased]'));
    // [Unreleased] must come BEFORE [1.0.0].
    assert.ok(after.indexOf('## [Unreleased]') < after.indexOf('## [1.0.0]'));
    const r2 = applyMechanicalFix(dir, { type: 'insert-changelog-unreleased', file: 'CHANGELOG.md' });
    assert.equal(r2.applied, false, 'idempotent — already present');
  });

  it('unknown fix type is reported, not applied', () => {
    const r = applyMechanicalFix(dir, { type: 'pretend-ai-fix', file: 'x' });
    assert.equal(r.applied, false);
    assert.match(r.skipped, /unknown fix type/);
  });
});
