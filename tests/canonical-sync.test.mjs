/**
 * v0.19-A — Canonical-Sync validator tests.
 *
 * Verifies the self-policing rules from SURFACE-AUDIT §7:
 *   - "ships N commands" claim must match cli/commands/ file count
 *   - "N validators" claims in surface contexts must match guard output
 *   - architecture-diagram counts must match
 *   - Validator returns N/A for non-DocGuard repos (gated by package.json name)
 *
 * @req SC-CANON-001 — N/A when package.json name is not "docguard-cli"
 * @req SC-CANON-002 — N/A when no package.json
 * @req SC-CANON-003 — Passes when README counts match code-truth
 * @req SC-CANON-004 — Warns when "ships N commands" is wrong
 * @req SC-CANON-005 — Warns when "N validators" is wrong (in surface context)
 * @req SC-CANON-006 — Warns when architecture-diagram counts are stale
 * @req SC-CANON-007 — Counts itself per §8.5 (claim includes canonical-sync)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCanonicalSync } from '../cli/validators/canonical-sync.mjs';

function makeFixture({ name = 'docguard-cli', commandFiles = 0, validatorFiles = 0, readme = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-canon-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.1' }));
  if (readme) writeFileSync(join(dir, 'README.md'), readme);
  mkdirSync(join(dir, 'cli/commands'), { recursive: true });
  mkdirSync(join(dir, 'cli/validators'), { recursive: true });
  for (let i = 0; i < commandFiles; i++) {
    writeFileSync(join(dir, `cli/commands/cmd${i}.mjs`), '// stub');
  }
  for (let i = 0; i < validatorFiles; i++) {
    writeFileSync(join(dir, `cli/validators/val${i}.mjs`), '// stub');
  }
  return dir;
}

describe('canonical-sync validator', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  it('returns N/A when package.json name is not docguard-cli', () => {
    dir = makeFixture({ name: 'some-other-project', readme: 'ships 5 commands\n' });
    const r = validateCanonicalSync(dir, {}, null);
    assert.equal(r.na, true);
    assert.match(r.naReason, /only runs in the docguard-cli repo/);
    assert.equal(r.warnings.length, 0);
  });

  it('returns N/A when no package.json exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-canon-nopkg-'));
    const r = validateCanonicalSync(dir, {}, null);
    assert.equal(r.na, true);
    assert.match(r.naReason, /no package.json/);
  });

  it('passes when README counts match code-truth (all checks)', () => {
    // 3 command files + 3 validator files → validator count = 4 (3 files + 1 for Doc Sections inlined)
    const readme = [
      '# DocGuard',
      '',
      'DocGuard ships **3 commands**:',
      '',
      'Runs all 4 validators.',
      '',
      '```mermaid',
      'Commands (3)',
      'Validators (4)',
      '```',
      '',
    ].join('\n');
    dir = makeFixture({ commandFiles: 3, validatorFiles: 3, readme });
    const r = validateCanonicalSync(dir, {}, []);
    assert.equal(r.warnings.length, 0, `expected no warnings; got: ${r.warnings.join(' / ')}`);
    assert.equal(r.passed, r.total);
  });

  it('warns when "ships N commands" is wrong', () => {
    const readme = 'DocGuard ships **5 commands**:\n';
    dir = makeFixture({ commandFiles: 7, readme });
    const r = validateCanonicalSync(dir, {}, []);
    // v0.20: wording changed to "7 command file(s)" (or "7 user-facing commands"
    // when the parser finds --help sections). For the test fixture there's no
    // cli/docguard.mjs to parse, so we get the file-count fallback.
    assert.ok(r.warnings.some(w => /"ships 5 commands"/.test(w) && /\b7\b.*file/.test(w)),
      `expected ships-count warning mentioning 7; got: ${r.warnings.join(' / ')}`);
  });

  it('warns when "N validators" claim in surface context is wrong', () => {
    const readme = 'Runs all 99 validators.\n';
    // 3 validator files → real count = 4 (3 + 1 for Doc Sections inlined)
    dir = makeFixture({ commandFiles: 0, validatorFiles: 3, readme });
    const r = validateCanonicalSync(dir, {}, []);
    assert.ok(r.warnings.some(w => /"99 validators"/.test(w) && /reports 4/.test(w)),
      `expected validator-count warning; got: ${r.warnings.join(' / ')}`);
  });

  it('warns when architecture-diagram counts are stale', () => {
    const readme = [
      '```mermaid',
      'Commands (15)',
      'Validators (19)',
      '```',
    ].join('\n');
    // 21 commands + 22 validator files → claimed Validators(N) should be 23 (22 + 1 for Doc Sections)
    dir = makeFixture({ commandFiles: 21, validatorFiles: 22, readme });
    const r = validateCanonicalSync(dir, {}, []);
    const w = r.warnings.join(' / ');
    assert.match(w, /Commands \(15\) → should be \(21\)/);
    assert.match(w, /Validators \(19\) → should be \(23\)/);
  });

  it('counts itself per §8.5 — validator count claim includes canonical-sync', () => {
    // 22 validator files (canonical-sync among them) + 1 inlined Doc Sections = 23.
    // README claiming "22" must warn; "23" must pass.
    const readme22 = 'Runs all 22 validators.\n';
    const readme23 = 'Runs all 23 validators.\n';

    dir = makeFixture({ validatorFiles: 22, readme: readme22 });
    const r22 = validateCanonicalSync(dir, {}, []);
    assert.ok(r22.warnings.some(w => /"22 validators"/.test(w)),
      `claim of 22 must warn (real count is 23 including Doc Sections); got: ${r22.warnings.join(' / ')}`);

    rmSync(dir, { recursive: true, force: true });
    dir = makeFixture({ validatorFiles: 22, readme: readme23 });
    const r23 = validateCanonicalSync(dir, {}, []);
    assert.ok(!r23.warnings.some(w => /validators/.test(w)),
      `claim of 23 must pass; got: ${r23.warnings.join(' / ')}`);
  });

  it('ignores irrelevant numbers (e.g. "9 tests", "5 fixtures")', () => {
    const readme = 'DocGuard ships **3 commands** and runs against 9 tests and 5 fixtures.\n';
    dir = makeFixture({ commandFiles: 3, readme });
    const r = validateCanonicalSync(dir, {}, [{ name: 'A' }, { name: 'B' }]);
    // No validator/commands mismatch; numbers about tests/fixtures are not in scope.
    assert.equal(r.warnings.length, 0, `expected no warnings; got: ${r.warnings.join(' / ')}`);
  });

  it('gracefully handles missing surface docs (no README or AGENTS.md)', () => {
    dir = makeFixture({ commandFiles: 3 });
    // no README or AGENTS.md written
    const r = validateCanonicalSync(dir, {}, []);
    assert.ok(r.warnings.some(w => /no README\.md or AGENTS\.md found/.test(w)),
      `expected missing-surface-docs warning; got: ${r.warnings.join(' / ')}`);
  });

  it('also scans AGENTS.md for surface-count claims (closes the AGENTS.md drift gap)', () => {
    // README is accurate; AGENTS.md carries a STALE "ships N commands" claim.
    // canonical-sync must catch it now that it scans both files.
    dir = makeFixture({ commandFiles: 3, readme: 'DocGuard ships 3 commands.' });
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nDocGuard ships 99 commands.\n');
    const r = validateCanonicalSync(dir, {}, []);
    assert.ok(r.warnings.some(w => /ships 99 commands/.test(w)),
      `a stale count in AGENTS.md must be caught; got: ${r.warnings.join(' / ')}`);
  });
});
