/**
 * Baseline fingerprints ignore declared advisory tails (raccioly/docguard#478).
 *
 * @req docguard.baseline-stable-fingerprint#FR-001
 * @req docguard.baseline-stable-fingerprint#FR-002
 * @req docguard.baseline-stable-fingerprint#FR-003
 * @req docguard.baseline-stable-fingerprint#FR-004
 * @req docguard.baseline-stable-fingerprint#FR-005
 * @req docguard.baseline-stable-fingerprint#FR-006
 * @req docguard.baseline-stable-fingerprint#SC-001
 * @req docguard.baseline-stable-fingerprint#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { fingerprintFinding, legacyFingerprint, ADVISORY_TAILS, BASELINE_FILE } from '../cli/writers/baseline.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');
const run = (args, cwd) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });

const base = 'Requirement FR-004 (specs/018-music/spec.md:12) has no recognized test annotation or label; behavioral coverage is unknown.';
const trc = hint => ({ code: 'TRC004', location: 'specs/018-music/spec.md:12', message: hint ? `${base} — IR soft-match: ${hint} (14% similar) may already cover it` : base });

// The preimage every release before this one hashed: code | path | message.
const oldFingerprint = f => {
  const msg = String(f.message).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${f.code}|${f.location.replace(/:\d+$/, '')}|${msg}`).digest('hex').slice(0, 16);
};

describe('fingerprints exclude declared advisory tails (FR-001, FR-004)', () => {
  it('a TRC004 finding keeps one fingerprint whatever its soft-match hint says', () => {
    const fps = new Set([trc(null), trc('tests/unit/a.test.js'), trc('tests/unit/audio-check.test.js')].map(fingerprintFinding));
    assert.equal(fps.size, 1);
  });

  it('the tail list is explicit and keyed by code', () => {
    assert.deepEqual(Object.keys(ADVISORY_TAILS), ['TRC004']);
    // The same text under another code is part of that message, not a tail.
    const other = { ...trc('tests/unit/a.test.js'), code: 'TRC003' };
    assert.equal(fingerprintFinding(other), oldFingerprint(other));
  });

  it('every finding without a tail keeps its fingerprint byte for byte', () => {
    for (const f of [
      trc(null),
      { code: 'FRS002', location: 'docs/X.md:12', message: '21 code commits since last update' },
      { code: 'SEC001', location: 'src/a.js:3', message: 'Possible secret — AWS key pattern' },
    ]) assert.equal(fingerprintFinding(f), oldFingerprint(f), f.code);
  });

  it('legacyFingerprint reproduces the earlier preimage, hint included', () => {
    const f = trc('tests/unit/a.test.js');
    assert.equal(legacyFingerprint(f), oldFingerprint(f));
    assert.notEqual(legacyFingerprint(f), fingerprintFinding(f));
  });
});

// A project with two requirements no test annotates, and a test file whose
// vocabulary overlaps them enough to produce an IR soft-match hint.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-bsl-hint-'));
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'bsl-hint', profile: 'standard' }));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
  mkdirSync(join(dir, 'specs', '018-music'), { recursive: true });
  writeFileSync(join(dir, 'specs', '018-music', 'spec.md'), [
    '# Music', '', '## Requirements', '',
    '- **FR-004**: The audio mixer MUST lower music volume while narration audio plays.',
    '- **FR-005**: The audio mixer MUST fade music between rooms without clipping.', '',
  ].join('\n'));
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'unit', 'mixer.test.js'), "test('mixer lowers music volume', () => { /* audio mixer music volume */ });\n");
  return dir;
}
const trcFindings = dir => JSON.parse(run(['guard', '--format', 'json', '--no-baseline'], dir).stdout)
  .findings.filter(f => f.code === 'TRC004');

describe('a new test file does not resurface a baselined finding (SC-001, FR-002, FR-003)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('stays suppressed after a better-matching test file changes the hint', () => {
    dir = fixture();
    const before = trcFindings(dir);
    assert.ok(before.some(f => /IR soft-match: tests\/unit\/mixer\.test\.js/.test(f.message)), 'fixture produces a soft-match hint');
    assert.equal(run(['guard', '--update-baseline'], dir).status, 0);

    writeFileSync(join(dir, 'tests', 'unit', 'narration-audio.test.js'),
      "test('narration audio lowers music volume in the audio mixer while narration plays', () => { /* narration audio mixer music volume plays */ });\n");
    const after = trcFindings(dir);
    assert.ok(after.some(f => /IR soft-match: tests\/unit\/narration-audio\.test\.js/.test(f.message)), 'the hint now names the new file');
    const json = JSON.parse(run(['guard', '--format', 'json'], dir).stdout);
    assert.equal(json.findings.filter(f => f.code === 'TRC004').length, 0, 'baselined TRC004 findings stay suppressed');
  });

  it('a legacy baseline keeps suppressing, and --update-baseline rewrites it', () => {
    dir = fixture();
    const findings = trcFindings(dir);
    assert.ok(findings.some(f => /IR soft-match/.test(f.message)));
    run(['guard', '--update-baseline'], dir);
    const frozen = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8'));
    // Rewrite the TRC004 entries the way an earlier release wrote them. Digit
    // masking gives FR-004 and FR-005 one stable fingerprint, so re-key counts.
    for (const f of findings) delete frozen.fingerprints[fingerprintFinding(f)];
    for (const f of findings) frozen.fingerprints[oldFingerprint(f)] = (frozen.fingerprints[oldFingerprint(f)] || 0) + 1;
    writeFileSync(join(dir, BASELINE_FILE), JSON.stringify(frozen, null, 2));
    const json = JSON.parse(run(['guard', '--format', 'json'], dir).stdout);
    assert.equal(json.findings.filter(f => f.code === 'TRC004').length, 0, 'legacy entries still suppress');

    run(['guard', '--update-baseline'], dir);
    const rewritten = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8')).fingerprints;
    for (const f of findings) {
      assert.ok(rewritten[fingerprintFinding(f)] >= 1, 'new fingerprint written');
      if (/IR soft-match/.test(f.message)) assert.equal(rewritten[oldFingerprint(f)], undefined, 'legacy fingerprint dropped');
    }
  });

  it('one finding consumes budget from one entry only', () => {
    dir = fixture();
    const hinted = trcFindings(dir).filter(f => /IR soft-match/.test(f.message));
    assert.ok(hinted.length > 0);
    run(['guard', '--update-baseline'], dir);
    const frozen = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8'));
    // Both forms present: the finding takes one unit; the other entry stays unconsumed.
    frozen.fingerprints[oldFingerprint(hinted[0])] = 1;
    writeFileSync(join(dir, BASELINE_FILE), JSON.stringify(frozen, null, 2));
    const json = JSON.parse(run(['guard', '--format', 'json'], dir).stdout);
    assert.equal(json.findings.filter(x => x.code === 'TRC004').length, 0);
    const budget = Object.values(frozen.fingerprints).reduce((a, b) => a + b, 0);
    assert.equal(json.baselineSuppressed, budget - 1, 'exactly one unit is left unconsumed');
  });
});

describe('the docs describe the change (FR-005)', () => {
  it('configuration.md and the CHANGELOG name the excluded hint and the legacy behaviour', () => {
    const config = readFileSync('docs/configuration.md', 'utf8');
    assert.match(config, /IR soft-match/);
    assert.match(config, /`guard --update-baseline` rewrites it/);
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    assert.match(changelog, /specs\/052-baseline-stable-fingerprint/);
  });
});

describe('a legacy entry is matched exactly before a shared stable one (FR-006)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  // Found dogfooding a real repository (wu-whatsappinbox, 2026-10-10): TRC004
  // messages that differ only in digits and in the hint share one stable
  // fingerprint. With the stable form tried first, a hinted finding spent the
  // budget the legacy file had recorded for an unhinted one, which resurfaced.
  it('every finding a legacy baseline froze stays suppressed when hinted and unhinted findings share a stable fingerprint', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-bsl-order-'));
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'bsl-order', profile: 'standard' }));
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
    mkdirSync(join(dir, 'specs', '018-music'), { recursive: true });
    writeFileSync(join(dir, 'specs', '018-music', 'spec.md'), [
      '# Music', '', '## Requirements', '',
      '- **FR-004**: The audio mixer MUST lower music volume while narration audio plays.',
      '- **FR-005**: Quarterly invoices MUST round totals to whole cents.', '',
    ].join('\n'));
    mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'unit', 'mixer.test.js'), "test('mixer lowers music volume', () => { /* audio mixer music volume */ });\n");
    const findings = trcFindings(dir);
    const hinted = findings.filter(f => /IR soft-match/.test(f.message));
    const plain = findings.filter(f => !/IR soft-match/.test(f.message));
    assert.ok(hinted.length >= 1 && plain.length >= 1, 'fixture has a hinted and an unhinted TRC004');
    assert.equal(fingerprintFinding(hinted[0]), fingerprintFinding(plain[0]), 'they share one stable fingerprint');
    // A baseline as an earlier release wrote it: one legacy entry per finding.
    run(['guard', '--update-baseline'], dir);
    const frozen = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8'));
    for (const f of findings) delete frozen.fingerprints[fingerprintFinding(f)];
    for (const f of findings) frozen.fingerprints[oldFingerprint(f)] = (frozen.fingerprints[oldFingerprint(f)] || 0) + 1;
    writeFileSync(join(dir, BASELINE_FILE), JSON.stringify(frozen, null, 2));
    const json = JSON.parse(run(['guard', '--format', 'json'], dir).stdout);
    assert.equal(json.findings.filter(f => f.code === 'TRC004').length, 0, 'no frozen finding resurfaces');
    assert.equal(json.baselineStale, 0, 'every legacy entry was consumed by its own finding');
  });
});
