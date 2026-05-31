/**
 * Tests for the `docguard upgrade` command + the schema-behind nudge in
 * `docguard guard`. Covers compareVersions, the checkUpgradeStatus helper,
 * and the CLI flag parsing for --check-only / --apply.
 *
 * @req SC-K2-001 — `docguard upgrade` reports current vs latest CLI version
 * @req SC-K2-002 — `docguard upgrade` reports project schema vs CURRENT_SCHEMA_VERSION
 * @req SC-K2-003 — `--check-only` exits 1 when behind, 0 when current
 * @req SC-K2-004 — Post-guard nudge fires only when project schema < CLI schema
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CURRENT_SCHEMA_VERSION,
  compareVersions,
  parseVersion,
} from '../cli/shared.mjs';
import { checkUpgradeStatus, migrateSchema } from '../cli/commands/upgrade.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-upgrade-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('shared.mjs — version helpers', () => {
  it('parseVersion handles dotted decimals', () => {
    assert.deepEqual(parseVersion('0.4'), [0, 4, 0]);
    assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseVersion('0.11.2'), [0, 11, 2]);
  });

  it('parseVersion tolerates suffixes', () => {
    assert.deepEqual(parseVersion('0.4-beta'), [0, 4, 0]);
    assert.deepEqual(parseVersion('1.0.0-rc.1'), [1, 0, 0]);
  });

  it('parseVersion returns null on garbage', () => {
    assert.equal(parseVersion(null), null);
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion('not-a-version'), null);
  });

  it('compareVersions orders correctly across major/minor/patch', () => {
    assert.equal(compareVersions('0.3', '0.4'), -1);
    assert.equal(compareVersions('0.4', '0.4'), 0);
    assert.equal(compareVersions('0.5', '0.4'), 1);
    assert.equal(compareVersions('0.11.2', '0.11.10'), -1);   // 2 < 10 numerically
    assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  });

  it('compareVersions returns 0 for unparseable input (no nag for weird data)', () => {
    assert.equal(compareVersions(null, '0.4'), 0);
    assert.equal(compareVersions('not-a-version', '0.4'), 0);
  });

  it('CURRENT_SCHEMA_VERSION is a parseable version string', () => {
    assert.ok(parseVersion(CURRENT_SCHEMA_VERSION), 'CURRENT_SCHEMA_VERSION must parse');
  });
});

describe('checkUpgradeStatus — the post-guard nudge driver', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns null when .docguard.json is missing (no nag for fresh dirs)', () => {
    dir = make({ 'package.json': '{}' });
    assert.equal(checkUpgradeStatus(dir), null);
  });

  it('returns null when project schema matches the CLI schema', () => {
    dir = make({
      'package.json': '{}',
      '.docguard.json': JSON.stringify({ version: CURRENT_SCHEMA_VERSION, projectName: 't' }),
    });
    assert.equal(checkUpgradeStatus(dir), null);
  });

  it('returns null when project schema is AHEAD of the CLI (newer config than CLI knows)', () => {
    // Simulates a teammate on a newer CLI committing a newer schema; we don't
    // nag the colleague who happens to be on an older CLI — they're warned
    // separately by `docguard upgrade`.
    dir = make({
      'package.json': '{}',
      '.docguard.json': JSON.stringify({ version: '9.9.9', projectName: 't' }),
    });
    assert.equal(checkUpgradeStatus(dir), null);
  });

  it('returns a nudge string when project schema is behind', () => {
    dir = make({
      'package.json': '{}',
      '.docguard.json': JSON.stringify({ version: '0.1', projectName: 't' }),
    });
    const msg = checkUpgradeStatus(dir);
    assert.ok(msg, 'expected a nudge string');
    assert.match(msg, /0\.1/, 'nudge should mention the old version');
    assert.match(msg, new RegExp(CURRENT_SCHEMA_VERSION.replace(/\./g, '\\.')),
      'nudge should mention CURRENT_SCHEMA_VERSION');
    assert.match(msg, /docguard upgrade/i, 'nudge should point at the upgrade command');
  });

  it('returns null when .docguard.json is unparseable (no crash, no nag)', () => {
    dir = make({
      'package.json': '{}',
      '.docguard.json': '{not valid json',
    });
    assert.equal(checkUpgradeStatus(dir), null);
  });

  it('returns a nudge when .docguard.json has no `version` field (pre-0.4 schema)', () => {
    // Real-world case from wu-whatsappinbox: a 2024-era config has fields
    // like `project` (not `projectName`) and no `version`. We want the
    // migration nudge to fire so users get upgraded to v0.5 cleanly.
    dir = make({
      'package.json': '{}',
      '.docguard.json': JSON.stringify({ project: 't' }),  // pre-0.4 — no version
    });
    const msg = checkUpgradeStatus(dir);
    assert.ok(msg, 'pre-0.4 schemas should get a migration nudge');
    assert.match(msg, /upgrade --apply/, 'nudge should point at the upgrade command');
  });
});

// #13 / Field Report #2 — the migration must not lose or break `requiredFiles`.
// Previously these paths had ZERO coverage: the existing tests only migrated
// configs WITHOUT a requiredFiles key, so a regression there would ship silent.
describe('migrateSchema — requiredFiles is preserved and shape-normalized', () => {
  it('preserves a well-formed requiredFiles object across a version migration', () => {
    const rf = {
      canonical: ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/SECURITY.md'],
      agentFile: ['AGENTS.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    };
    const { newConfig } = migrateSchema({ projectName: 't', requiredFiles: rf }, '0.0');
    assert.deepEqual(newConfig.requiredFiles, rf, 'requiredFiles must survive the migration byte-for-byte');
    assert.strictEqual(newConfig.version, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(newConfig.severity, {}, 'v0.5 additive field still applied');
  });

  it('normalizes a legacy ARRAY requiredFiles to { canonical: [...] }', () => {
    // A bare array could only ever have been the canonical doc list. Left as an
    // array, every validator reading requiredFiles.canonical sees undefined and
    // silently passes — the false-green this normalization closes.
    const legacy = ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/DATA-MODEL.md'];
    const { newConfig, changed, notes } = migrateSchema({ project: 't', requiredFiles: legacy }, '0.0');
    assert.deepEqual(newConfig.requiredFiles, { canonical: legacy });
    assert.ok(changed, 'normalization counts as a change');
    assert.ok(notes.some(n => /array .* canonical/i.test(n)), `expected a normalization note; got: ${notes.join(' | ')}`);
  });

  it('SURFACES (does not silently accept) a requiredFiles object missing canonical', () => {
    const { notes } = migrateSchema(
      { projectName: 't', version: CURRENT_SCHEMA_VERSION, requiredFiles: { agentFile: ['AGENTS.md'] } },
      CURRENT_SCHEMA_VERSION
    );
    assert.ok(
      notes.some(n => n.startsWith('⚠') && /canonical/.test(n)),
      `a missing canonical key must produce a visible warning; got: ${notes.join(' | ')}`
    );
  });

  it('warns when requiredFiles is absent entirely (no fabrication)', () => {
    const { newConfig, notes } = migrateSchema({ project: 't' }, '0.0');
    assert.strictEqual(newConfig.requiredFiles, undefined, 'must NOT fabricate a doc list');
    assert.ok(notes.some(n => n.startsWith('⚠') && /requiredFiles is missing/.test(n)));
  });
});
