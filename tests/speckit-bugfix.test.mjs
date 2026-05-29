import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';

describe('Spec-Kit — bugfix spec type', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-speckit-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSpec(name, body) {
    const dir = join(tmpDir, 'specs', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), body);
  }

  const warnsFor = (results, name) =>
    results.warnings.filter(w => w.includes(`${name}/spec.md`));

  it('exempts a bugfix spec from the feature template when it states root cause + fix', () => {
    writeSpec('001-defect', [
      '# Defect: env-var detector false negative',
      '<!-- docguard:spec-type bugfix -->',
      '## Root Cause',
      'The scanner only matched backticked names.',
      '## Fix',
      'Also extract pipe-table rows.',
    ].join('\n\n'));

    const r = validateSpecKitIntegration(tmpDir, {});
    assert.deepEqual(
      warnsFor(r, '001-defect'), [],
      'a bugfix spec with Root Cause + Fix should not be flagged for feature-template sections'
    );
  });

  it('still requires root cause + fix in a bugfix spec (not a free pass)', () => {
    writeSpec('002-thin', [
      '# Defect report',                 // no "Root Cause"/"Fix" in the title
      '<!-- docguard:spec-type bugfix -->',
      'Some prose that never states a root cause or a fix.',
    ].join('\n\n'));

    const r = validateSpecKitIntegration(tmpDir, {});
    const w = warnsFor(r, '002-thin');
    assert.ok(w.some(x => /Root Cause/i.test(x)), 'expected a missing Root Cause warning');
    assert.ok(w.some(x => /\bFix\b/i.test(x)), 'expected a missing Fix warning');
  });

  it('holds a normal feature spec to the full template', () => {
    writeSpec('003-feature', [
      '# Feature: shiny new thing',
      'A description with none of the mandatory feature sections.',
    ].join('\n\n'));

    const r = validateSpecKitIntegration(tmpDir, {});
    const w = warnsFor(r, '003-feature');
    assert.ok(
      w.some(x => /Missing mandatory section/.test(x)),
      'a feature spec (no bugfix marker) must still be held to the spec template'
    );
  });
});
