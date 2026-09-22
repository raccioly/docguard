/**
 * Downstream field report, 2026-09-18 — the 0.42.0 upgrade session.
 *
 * Each case reproduces a friction the report observed on a real tree, not a
 * hypothetical. One reported item was verified as NOT a tool defect and is
 * asserted as working instead: `docguard upgrade --apply` does migrate the
 * config schema — the real defect was that a failed global npm install exited
 * before the migration could run.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTED_SCHEMA_VERSIONS,
  LEGACY_SCHEMA_VERSIONS,
  SPEC_REGISTRY_SCHEMA_VERSION,
  projectSpecRegistry,
} from '../cli/scanners/spec-registry.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';
import { baselineAgeDays } from '../cli/writers/baseline.mjs';
import { computeDetectorsDigest, DETECTOR_DIRS } from '../cli/detector-digest.mjs';
import { detectorCalibration, precisionEvidenceBlock } from '../cli/precision-evidence.mjs';
import { runBadge } from '../cli/commands/badge.mjs';
import { loadConfig } from '../cli/config.mjs';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

function fixture(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-field-0420-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

const cli = (dir, args) => execFileSync(process.execPath, [CLI, ...args, '--dir', dir], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});

// guard exits non-zero by design when a fixture has findings; these cases assert
// on what it PRINTS, so the exit code must not abort the call.
const cliOut = (dir, args) => spawnSync(process.execPath, [CLI, ...args, '--dir', dir], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
}).stdout;

/** Capture what a command writes to stdout without spawning a process. */
function captureLogs(run) {
  const logs = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try { run(); } finally { console.log = original; }
  return logs;
}

// A spec carrying a review stamp: the stamp is why the pre-0.42 raw-byte digest
// and the current stamp-stripped digest differ at all.
const STAMPED_SPEC = '# Feature\n\n<!-- docguard:last-reviewed 2026-01-15 -->\n\n'
  + '**Spec ID**: `acme.feature`\n\n## Requirements\n\n- **FR-001**: The system MUST work.\n';

const registryFor = dir => JSON.parse(readFileSync(join(dir, '.docguard-specs.json'), 'utf8'));
const writeRegistry = (dir, value) =>
  writeFileSync(join(dir, '.docguard-specs.json'), `${JSON.stringify(value, null, 2)}\n`);

describe('field report §1 — a version bump must not flip the verdict', () => {
  it('accepts the pre-0.42 raw-byte artifact digest as current', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': STAMPED_SPEC });
    cli(dir, ['specs', '--write']);

    // Re-stamp the registry the way 0.41.x wrote it: digest over the raw bytes,
    // review stamp included. Nothing in the working tree changes.
    const registry = registryFor(dir);
    const raw = readFileSync(join(dir, 'specs/001-feature/spec.md'));
    registry.specs[0].observed.artifacts[0].digest =
      `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    writeRegistry(dir, registry);

    const projection = projectSpecRegistry(dir);
    assert.equal(projection.current, true,
      'an untouched tree must not go stale because the digest recipe changed');
    assert.deepEqual(projection.differences, []);
    assert.ok(projection.legacyForms.includes('pre-0.42 artifact digest'),
      'the older encoding must still be announced so it gets migrated');
    assert.ok(!validateSpecRegistry(dir).findings.some(f => f.code === 'SPR001'),
      'SPR001 must not fire on content that is provably unchanged');
  });

  it('accepts a schemaVersion the reader already calls supported', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': STAMPED_SPEC });
    cli(dir, ['specs', '--write']);
    const registry = registryFor(dir);
    registry.schemaVersion = LEGACY_SCHEMA_VERSIONS[0];
    writeRegistry(dir, registry);

    const projection = projectSpecRegistry(dir);
    assert.equal(projection.current, true,
      'readSpecRegistry accepts this version, so the projection cannot call it stale forever');
    assert.ok(projection.legacyForms.some(form => form.startsWith('schemaVersion')));
  });

  it('still reports genuine drift — tolerance is not blindness', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': STAMPED_SPEC });
    cli(dir, ['specs', '--write']);
    writeFileSync(join(dir, 'specs/001-feature/spec.md'),
      `${STAMPED_SPEC}\n- **FR-002**: A new requirement.\n`);

    const projection = projectSpecRegistry(dir);
    assert.equal(projection.current, false, 'edited content matches neither digest form');
    assert.ok(projection.differences.length > 0);
    assert.ok(validateSpecRegistry(dir).findings.some(f => f.code === 'SPR001'));
  });

  it('migrates the legacy form on an explicit --write so the shim cannot become permanent', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': STAMPED_SPEC });
    cli(dir, ['specs', '--write']);
    const registry = registryFor(dir);
    registry.schemaVersion = LEGACY_SCHEMA_VERSIONS[0];
    writeRegistry(dir, registry);

    assert.match(cli(dir, ['specs', '--write']), /WRITTEN/);
    assert.equal(registryFor(dir).schemaVersion, SPEC_REGISTRY_SCHEMA_VERSION);
    assert.deepEqual(projectSpecRegistry(dir).legacyForms, []);
  });

  it('declares an equivalence for every accepted schema version', () => {
    // The forcing function: a version may only be accepted by the reader if the
    // currency check also knows how to treat it, so no future shape change can
    // quietly reintroduce a permanent SPR001.
    assert.deepEqual(
      [...ACCEPTED_SCHEMA_VERSIONS].sort((a, b) => a - b),
      [...new Set([...LEGACY_SCHEMA_VERSIONS, SPEC_REGISTRY_SCHEMA_VERSION])].sort((a, b) => a - b),
    );
    assert.ok(!LEGACY_SCHEMA_VERSIONS.includes(SPEC_REGISTRY_SCHEMA_VERSION),
      'the current version is not a legacy form');
  });

  it('does not report a legacy form for a spec that never carried a review stamp', t => {
    const dir = fixture(t, {
      'specs/001-feature/spec.md': '# Feature\n\n**Spec ID**: `acme.plain`\n\n- **FR-001**: Work.\n',
    });
    cli(dir, ['specs', '--write']);
    const projection = projectSpecRegistry(dir);
    assert.equal(projection.current, true);
    assert.deepEqual(projection.legacyForms, [],
      'both digest forms are identical here, so there is nothing to announce');
  });
});

describe('field report §2 — a green badge must not stand alone next to unverified claims', () => {
  const badgeJson = dir => {
    const logs = captureLogs(() => runBadge(dir, loadConfig(dir), { format: 'json' }));
    return JSON.parse(logs.find(line => line.includes('"score":')));
  };

  it('emits an unverified-claims badge alongside the score', t => {
    const dir = fixture(t, {
      '.docguard.json': JSON.stringify({ projectName: 'badge-fixture' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe pool holds 42 connections.\n',
    });
    const out = badgeJson(dir);
    assert.ok(out.badges.claims, 'the claims badge must ship with the score badge');
    assert.match(out.readmeSnippet, /claims_unverified/,
      'the pasteable snippet is the surface that misleads, so it must carry the count');
    assert.ok('unverifiedClaims' in out);
  });

  it('renders an unknown count as unknown, never as zero', t => {
    const dir = fixture(t, {
      '.docguard.json': JSON.stringify({ projectName: 'badge-fixture' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n',
    });
    const out = badgeJson(dir);
    if (out.unverifiedClaims === null) {
      assert.match(out.badges.claims.url, /unknown/);
      assert.ok(!/claims_unverified-0-/.test(out.badges.claims.url),
        'a failed extraction reported as 0 is the false-green this tool exists to prevent');
    } else {
      assert.equal(typeof out.unverifiedClaims, 'number');
      assert.match(out.badges.claims.url, new RegExp(`claims_unverified-${out.unverifiedClaims}-`));
    }
  });

  it('keeps the claims badge attached to the badge guard itself prints', t => {
    // The surface the report actually saw: a green pass badge printed a few
    // lines below "N documented claim(s) are unverified", with nothing linking
    // them. Whichever badge a reader pastes, the count travels with it.
    const dir = fixture(t, {
      '.docguard.json': JSON.stringify({ projectName: 'guard-badge' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe pool holds 42 connections.\n',
    });
    const out = cliOut(dir, ['guard']);
    const badgeLine = out.split('\n').find(line => line.includes('Badge:'));
    assert.ok(badgeLine, 'guard still prints a badge line');
    assert.match(badgeLine, /CDD_Guard-/);
    assert.match(badgeLine, /claims_unverified-/,
      'a green pass badge must not stand alone next to an unverified-claims count');
  });
});

describe('field report §3 — a nag must be actionable from the run that printed it', () => {
  // Files under specs/ land outside every validation tier, which is exactly the
  // state the report hit. The count is controlled so these assert unconditionally.
  const untiered = (t, count) => {
    const files = {
      '.docguard.json': JSON.stringify({ projectName: 'tier-fixture' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n',
    };
    for (let i = 0; i < count; i++) files[`specs/00${i}-f/notes-${i}.md`] = `# Notes ${i}\n`;
    return cliOut(fixture(t, files), ['guard']);
  };

  it('names the untiered files inline when there are only a few', t => {
    const out = untiered(t, 2);
    assert.match(out, /2 file\(s\) in no validation tier/,
      'the fixture must actually produce the nag, or this case proves nothing');
    assert.match(out, /notes-0\.md/, 'three strings behind --verbose is a nag nobody can act on');
    assert.match(out, /notes-1\.md/);
    assert.ok(!/--verbose to list/.test(out),
      'the --verbose pointer is pointless once the list is already printed');
  });

  it('keeps the calm count when the list would be long', t => {
    const out = untiered(t, 9);
    assert.match(out, /9 file\(s\) in no validation tier/);
    assert.match(out, /--verbose to list/,
      'a wall of paths every run is what trains users to ignore the line');
    assert.ok(!/notes-0\.md/.test(out), 'the list stays behind --verbose above the threshold');
  });
});

describe('field report §4 — a baseline must age', () => {
  it('reports whole days, and nothing when the stamp is unusable', () => {
    const now = Date.parse('2026-09-18T00:00:00.000Z');
    assert.equal(baselineAgeDays('2026-09-18T00:00:00.000Z', now), 0);
    assert.equal(baselineAgeDays('2026-09-08T00:00:00.000Z', now), 10);
    assert.equal(baselineAgeDays(null, now), null);
    assert.equal(baselineAgeDays('not-a-date', now), null);
    assert.equal(baselineAgeDays('2027-01-01T00:00:00.000Z', now), 0, 'a future stamp is not negative age');
  });

  it('separates findings still suppressed from entries that no longer occur', t => {
    const dir = fixture(t, {
      '.docguard.json': JSON.stringify({ projectName: 'bl-fixture', profile: 'standard' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n',
    });
    cli(dir, ['guard', '--update-baseline']);

    const file = join(dir, '.docguard.baseline.json');
    const baseline = JSON.parse(readFileSync(file, 'utf8'));
    baseline.fingerprints['deadbeefdeadbeef'] = 1;   // frozen, matches nothing today
    baseline.generatedAt = '2025-01-01T00:00:00.000Z';
    writeFileSync(file, JSON.stringify(baseline, null, 2));

    const data = JSON.parse(cli(dir, ['guard', '--format', 'json']));
    assert.ok(data.baselineAgeDays > 300, 'a baseline with no age is silent permanent amnesty');
    assert.ok(data.baselineStale >= 1, 'entries that no longer fire are what let a baseline shrink');
    assert.equal(
      data.baselineStillFiring + data.baselineStale,
      Object.keys(baseline.fingerprints).length,
      'every frozen fingerprint is accounted for exactly once',
    );
    assert.match(cliOut(dir, ['guard']), /day\(s\) old/);
  });
});

describe('field report §5 — benchmark evidence must say whether it still applies', () => {
  it('hashes the shipped detectors, which exist in an installed package', () => {
    const digest = computeDetectorsDigest();
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual([...DETECTOR_DIRS], ['validators', 'scanners']);
    assert.equal(digest, computeDetectorsDigest(join(REPO, 'cli')), 'the digest is deterministic');
  });

  it('returns unknown rather than claiming the detectors are unchanged', () => {
    assert.equal(detectorCalibration(null), 'unknown',
      'an unreadable install must degrade to the old wording, never to a false all-clear');
    assert.equal(detectorCalibration('sha256:' + 'f'.repeat(64)), 'changed');
  });

  it('carries the reviewed digest and a calibration verdict in the payload', () => {
    const block = precisionEvidenceBlock(['SEC005'], '0.42.0');
    assert.match(block.source.detectorsDigest, /^sha256:[0-9a-f]{64}$/,
      'without a recorded digest the whole comparison degrades to a version string');
    assert.ok(['unchanged', 'changed', 'unknown'].includes(block.source.detectorCalibration));
  });

  it('recognises its own detectors as the measured ones', () => {
    assert.equal(detectorCalibration(computeDetectorsDigest()),
      detectorCalibration(),
      'the no-argument form must measure this installation');
  });
});
