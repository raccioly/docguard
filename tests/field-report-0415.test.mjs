/**
 * Downstream field report, 2026-09-17 — the four confirmed tool defects.
 *
 * Each case reproduces a friction the report observed in a real working session,
 * not a hypothetical. Two other reported items were verified as NOT tool defects
 * (the generated hook template has no `set -e`; FRS002's repository-wide scope is
 * deliberate and says so in its own message) and are deliberately not asserted.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { digestSource } from '../cli/scanners/spec-registry.mjs';
import { validateFreshness } from '../cli/validators/freshness.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';

const runGit = (args, cwd) => execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });

describe('field report §3.4 — a review stamp is not a content change', () => {
  it('excludes docguard:last-reviewed from the digest source', () => {
    const reviewed = '# Spec\n<!-- docguard:last-reviewed 2026-09-17 -->\nbody\n';
    const rereviewed = '# Spec\n<!-- docguard:last-reviewed 2026-09-18 -->\nbody\n';
    const unstamped = '# Spec\nbody\n';

    assert.equal(digestSource(reviewed), unstamped,
      'stamping a document must not alter what gets digested');
    assert.equal(digestSource(reviewed), digestSource(rereviewed),
      're-reviewing (bumping the date) must not alter the digest source');
  });

  it('keeps version and status markers in the digest — those are real edits', () => {
    const before = '# Spec\n<!-- docguard:version 0.1.0 -->\n<!-- docguard:status draft -->\nbody\n';
    const after = '# Spec\n<!-- docguard:version 0.2.0 -->\n<!-- docguard:status active -->\nbody\n';
    assert.notEqual(digestSource(before), digestSource(after),
      'a lifecycle change must still re-digest');
    assert.ok(digestSource(before).includes('docguard:version'));
  });

  it('tolerates indentation and CRLF around the stamp', () => {
    assert.equal(digestSource('a\n   <!-- docguard:last-reviewed 2026-09-17 -->   \nb\n'), 'a\nb\n');
    assert.equal(digestSource('a\r\n<!-- docguard:last-reviewed 2026-09-17 -->\r\nb\r\n'), 'a\r\nb\r\n');
  });
});

describe('field report §3.1 — a document staged in this commit is not "review due"', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fr-staged-'));
    runGit('init', dir);
    runGit('config user.name "Test"', dir);
    runGit('config user.email test@example.com', dir);
    mkdirSync(join(dir, 'docs-canonical'));
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('skips a staged doc that the repository-wide heuristic would flag', () => {
    const doc = join(dir, 'docs-canonical/ARCHITECTURE.md');
    writeFileSync(doc, '<!-- docguard:last-reviewed 2020-01-01 -->\n# Arch\n');
    writeFileSync(join(dir, 'seed.go'), 'package main');
    runGit('add .', dir);
    runGit('commit -m seed', dir);

    // Enough code commits to trip FRS002.
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(dir, `f${i}.go`), `package main // ${i}`);
      runGit(`add f${i}.go`, dir);
      runGit(`commit -m c${i}`, dir);
    }

    const before = validateFreshness(dir, {}).find(r => r.doc === 'docs-canonical/ARCHITECTURE.md');
    assert.equal(before.status, 'warn', 'precondition: the doc is flagged while untouched');

    // Now the author edits that very doc and stages it — the work the finding asks for.
    writeFileSync(doc, '<!-- docguard:last-reviewed 2020-01-01 -->\n# Arch\n\nUpdated.\n');
    runGit('add docs-canonical/ARCHITECTURE.md', dir);

    const after = validateFreshness(dir, {}).find(r => r.doc === 'docs-canonical/ARCHITECTURE.md');
    assert.equal(after.status, 'skip', `staged doc must not be flagged, got: ${after.message}`);
    assert.match(after.message, /staged in this change/);
  });
});

describe('field report §3.3 — DocGuard must not report its own backup file', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fr-bak-'));
    mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'README.md'), '# Project\n\nDocs.\n');
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('does not raise DCV001 for a .bak DocGuard wrote itself', () => {
    writeFileSync(join(dir, '.docguard-specs.json.bak'), '{}');
    const result = validateDocsCoverage(dir, {});
    const bakFindings = (result.findings || []).filter(f =>
      f.code === 'DCV001' && String(f.location || '').endsWith('.bak'));
    assert.deepEqual(bakFindings, [], 'a DocGuard-written backup is not undocumented config');
  });
});
