import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { applyAllMechanicalFixes, runFix } from '../cli/commands/fix.mjs';

describe('applyAllMechanicalFixes', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-fix-apply-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('runs mechanical fixes and returns summary', () => {
    const result = applyAllMechanicalFixes(dir, { projectType: 'cli' });
    assert.deepEqual(result, { applied: [], skipped: [], total: 0 });
  });
});

describe('runFix', () => {
  let dir;
  let logOut = '';
  const originalLog = console.log;
  const config = {
    projectType: 'cli',
    requiredFiles: { canonical: [], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md', agentFile: [] },
    validators: []
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-runfix-'));
    logOut = '';
    console.log = (...args) => { logOut += args.join(' ') + '\n'; };
  });

  afterEach(() => {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  });

  it('outputs JSON when format is json', () => {
    try {
      runFix(dir, config, { format: 'json' });
    } finally {
      console.log = originalLog;
    }
    const json = JSON.parse(logOut);
    assert.equal(json.status, 'issues-found');
    // issue count depends on validation, but it should be a successful run
    assert.ok(json.issueCount > 0);
  });

  it('runs history mode', () => {
    try {
      runFix(dir, config, { history: true, format: 'json' });
    } finally {
      console.log = originalLog;
    }
    const json = JSON.parse(logOut);
    assert.deepEqual(json.entries, []);
  });

  it('runs write mode', () => {
    try {
      runFix(dir, config, { write: true, format: 'json' });
    } finally {
      console.log = originalLog;
    }
    const json = JSON.parse(logOut);
    assert.equal(json.status, 'clean');
  });

  it('generates doc prompt', () => {
    try {
      runFix(dir, config, { doc: 'architecture', format: 'json' });
    } finally {
      console.log = originalLog;
    }
    const json = JSON.parse(logOut);
    assert.equal(json.doc, 'docs-canonical/ARCHITECTURE.md');
    assert.equal(json.action, 'CREATE');
  });
});
