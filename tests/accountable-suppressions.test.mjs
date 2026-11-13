/**
 * Every suppression has an owner and an end date the project can enforce
 * (specs/084-accountable-suppressions).
 *
 * @req docguard.accountable-suppressions#FR-001
 * @req docguard.accountable-suppressions#FR-002
 * @req docguard.accountable-suppressions#FR-003
 * @req docguard.accountable-suppressions#FR-004
 * @req docguard.accountable-suppressions#FR-005
 * @req docguard.accountable-suppressions#FR-006
 * @req docguard.accountable-suppressions#FR-007
 * @req docguard.accountable-suppressions#FR-008
 * @req docguard.accountable-suppressions#SC-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { splitWaiverMetadata } from '../cli/waiver-metadata.mjs';
import { parseInlinePragma, suppressesCode } from '../cli/findings.mjs';
import { parseDocguardIgnore, configIgnoreEntry, normalizeIgnoreConfig } from '../cli/shared-ignore.mjs';
import { collectSuppressions } from '../cli/scanners/suppressions.mjs';
import { validateSuppressions } from '../cli/validators/suppressions.mjs';
import { loadValidatorSuppressions } from '../cli/validator-markers.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';

const CLI = resolve('cli/docguard.mjs');
const PAST = '2000-01-01';
const FUTURE = '2999-12-31';
const TODAY = '2026-11-02';

function project(t, files) {
  const dir = makeTempDir('docguard-waiver-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
}

describe('FR-001 — one metadata rule', () => {
  it('peels owner and expires from the end, in either order', () => {
    assert.deepEqual(splitWaiverMetadata('rotating key in #812 owner:@ana expires:2026-12-31'), { reason: 'rotating key in #812', owner: '@ana', expires: '2026-12-31', problem: null });
    assert.deepEqual(splitWaiverMetadata('x expires:2026-12-31 owner:team/docs'), { reason: 'x', owner: 'team/docs', expires: '2026-12-31', problem: null });
    assert.equal(splitWaiverMetadata('mail owner:ana@example.com').owner, 'ana@example.com');
  });
  it('an owner word inside the prose stays prose; bad values and duplicates are problems', () => {
    assert.deepEqual(splitWaiverMetadata("see owner:@x's PR for context"), { reason: "see owner:@x's PR for context", owner: null, expires: null, problem: null });
    assert.match(splitWaiverMetadata('r expires:2026-02-30').problem, /not a real/);
    assert.match(splitWaiverMetadata('r owner:@a owner:@b').problem, /duplicate/);
    assert.match(splitWaiverMetadata('r owner:nobody').problem, /owner/);
  });
});

describe('FR-008 — every 0.45.2 form reads as before (golden)', () => {
  it('pragmas, .docguardignore lines and config strings keep their shape', () => {
    assert.deepEqual(parseInlinePragma('// docguard:ignore SEC001 — UI copy, not a credential'), { codes: ['SEC001'], reason: 'UI copy, not a credential' });
    assert.deepEqual(parseInlinePragma('x = 1 # docguard:ignore'), { codes: null, reason: null });
    assert.deepEqual(parseInlinePragma('// docguard:ignore-secret: sample key'), { codes: ['SEC*'], reason: 'sample key' });
    const [e] = parseDocguardIgnore('legacy/  expires:2999-01-01  # removed with v2', { today: TODAY });
    assert.equal(e.pattern, 'legacy/'); assert.equal(e.reason, 'removed with v2'); assert.equal(e.expires, '2999-01-01'); assert.equal(e.state, 'active'); assert.equal(e.owner, null);
    assert.deepEqual(configIgnoreEntry('vendor/**', TODAY), { pattern: 'vendor/**', reason: null, owner: null, expires: null, state: 'active' });
    const cfg = { ignore: ['a/', 'b/'] };
    assert.equal(normalizeIgnoreConfig(cfg).ignore, cfg.ignore, 'an all-string array is left untouched');
  });
});

describe('US1 + US2 — every kind carries metadata and expires', () => {
  it('an expired pragma suppresses nothing; a live one still does', () => {
    assert.equal(suppressesCode(`// docguard:ignore SEC001 — key owner:@ana expires:${PAST}`, 'SEC001'), false);
    assert.equal(suppressesCode(`// docguard:ignore SEC001 — key owner:@ana expires:${FUTURE}`, 'SEC001'), true);
    assert.equal(suppressesCode('// docguard:ignore SEC001 — key owner:bad', 'SEC001'), false, 'unreadable metadata suppresses nothing');
    assert.equal(suppressesCode('// docguard:ignore SEC001 — key', 'SEC001'), true);
  });

  it('the model carries owner and expiry for each kind; expired ones say so', t => {
    const dir = project(t, {
      'src/a.js': `const k = 1; // docguard:ignore SEC001 — rotating key in #812 owner:@ana expires:${FUTURE}\n`,
      'src/b.js': `const k = 2; // docguard:ignore SEC001 — old owner:@ana expires:${PAST}\n`,
      'AGENTS.md': `# Agents\n\n<!-- docguard:validator apiSurface n/a — CLI, no HTTP API owner:@ana expires:${FUTURE} -->\n<!-- docguard:validator drift n/a — none owner:@bo expires:${PAST} -->\n`,
      '.docguardignore': 'dist/**  # build output owner:@ops\n',
      '.docguard.json': JSON.stringify({ ignore: [{ pattern: 'vendor/**', reason: 'third-party', owner: '@ops', expires: FUTURE }, { pattern: 'old/**', owner: '@ops', expires: PAST }] }),
    });
    const m = collectSuppressions(dir, {}, { today: TODAY, validatorKeys: ['apiSurface', 'drift'] });
    const by = pred => m.entries.find(pred);
    assert.deepEqual(['owner', 'expires', 'state'].map(k => by(e => e.kind === 'code' && e.source.file === 'src/a.js')[k]), ['@ana', FUTURE, 'active']);
    assert.equal(by(e => e.kind === 'code' && e.source.file === 'src/b.js').state, 'expired');
    assert.equal(by(e => e.kind === 'validator' && e.key === 'apiSurface').owner, '@ana');
    assert.equal(by(e => e.kind === 'validator' && e.key === 'drift').state, 'expired');
    assert.equal(by(e => e.kind === 'path' && e.pattern === 'dist/**').owner, '@ops');
    assert.equal(by(e => e.kind === 'path' && e.pattern === 'vendor/**').reason, 'third-party');
    assert.equal(by(e => e.kind === 'path' && e.pattern === 'old/**').state, 'expired');
  });

  it('an expired validator marker no longer declares N/A, and IGN001 names it with its owner', t => {
    const dir = project(t, { 'AGENTS.md': `# Agents\n\n<!-- docguard:validator drift n/a — none owner:@bo expires:${PAST} -->\n` });
    assert.equal(loadValidatorSuppressions(dir, ['drift']).suppressed.has('drift'), false);
    const r = validateSuppressions(dir, {}, { today: TODAY });
    const f = r.findings.find(x => x.code === 'IGN001');
    assert.match(f.message, /validator N\/A marker validator drift expired on 2000-01-01, owner @bo/);
  });

  it('an expired section marker no longer owns the absence', t => {
    const dir = project(t, { 'docs-canonical/ARCHITECTURE.md': `# Architecture\n\n<!-- docguard:section system-overview n/a — tiny tool owner:@ana expires:${PAST} -->\n` });
    const live = project(t, { 'docs-canonical/ARCHITECTURE.md': `# Architecture\n\n<!-- docguard:section system-overview n/a — tiny tool owner:@ana expires:${FUTURE} -->\n` });
    const expiredWarn = validateDocSections(dir, {}).warnings.join('\n');
    const liveWarn = validateDocSections(live, {}).warnings.join('\n');
    assert.match(expiredWarn, /System Overview/i);
    assert.doesNotMatch(liveWarn, /System Overview/i);
  });

  it('an entry expiring today still applies (UTC)', () => {
    assert.equal(configIgnoreEntry({ pattern: 'x/', expires: TODAY }, TODAY).state, 'active');
    assert.deepEqual(normalizeIgnoreConfig({ ignore: [{ pattern: 'x/', expires: TODAY }, { pattern: 'y/', expires: PAST }, 'z/'] }, TODAY).ignore, ['x/', 'z/']);
  });
});

describe('US3 — owner and window policies', () => {
  const files = {
    'src/a.js': `const k = 1; // docguard:ignore SEC001 — rotating key expires:${FUTURE}\n`,
    '.docguardignore': 'dist/**  # build output\n',
    '.docguard.baseline.json': JSON.stringify({ version: 1, fingerprints: { '0123456789abcdef': 1 } }),
  };
  it('requireOwner reports IGN004 per ownerless waiver; baseline is exempt; the waiver still applies', t => {
    const dir = project(t, files);
    const r = validateSuppressions(dir, { suppressions: { requireOwner: true } }, { today: TODAY });
    const ign4 = r.findings.filter(f => f.code === 'IGN004');
    assert.equal(ign4.length, 2);
    assert.ok(ign4.some(f => /src\/a\.js:1/.test(f.message)));
    assert.ok(ign4.some(f => /\.docguardignore:1/.test(f.message)));
    assert.equal(suppressesCode(`// docguard:ignore SEC001 — rotating key expires:${FUTURE}`, 'SEC001'), true);
  });
  it('maxDays reports IGN005 for a far expiry and for none', t => {
    const dir = project(t, files);
    const r = validateSuppressions(dir, { suppressions: { maxDays: 30 } }, { today: TODAY });
    const ign5 = r.findings.filter(f => f.code === 'IGN005');
    assert.equal(ign5.length, 2);
    assert.ok(ign5.some(f => /expires 2999-12-31, later than suppressions.maxDays \(30\) allows: 2026-12-02/.test(f.message)));
    assert.ok(ign5.some(f => /has no end date/.test(f.message)));
  });
  it('without a policy or new tokens the validator result is what 0.45.2 gave', t => {
    const dir = project(t, { 'src/a.js': 'const k = 1; // docguard:ignore SEC001 — rotating key\n' });
    const r = validateSuppressions(dir, {}, { today: TODAY });
    assert.equal(r.applicable, false);
    assert.equal(r.total, 0);
  });
});

describe('FR-007 — ignore --owner', () => {
  it('lists only the named owner\'s suppressions', t => {
    const dir = project(t, {
      'src/a.js': `const k = 1; // docguard:ignore SEC001 — key owner:@ana expires:${FUTURE}\n`,
      'src/b.js': `const k = 2; // docguard:ignore SEC001 — key owner:@bo expires:${FUTURE}\n`,
    });
    const r = spawnSync(process.execPath, [CLI, 'ignore', '--owner', '@ana', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const data = JSON.parse(r.stdout);
    assert.deepEqual(data.entries.map(e => e.source.file), ['src/a.js']);
  });
});
