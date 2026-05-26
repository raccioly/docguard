/**
 * v0.16-P7 — N/A markers for required doc sections.
 *
 * User report: had to write boilerplate "## Authentication — absent by design"
 * sections in SECURITY.md just to clear Doc-Sections warnings, even though
 * the project genuinely has no auth (CLI tool). Now: a `<!-- docguard:section
 * <slug> n/a — reason -->` marker satisfies the check without the prose.
 *
 * @req SC-P7-001 — N/A marker with reason satisfies the required-section check
 * @req SC-P7-002 — N/A marker without reason does NOT satisfy (no silent opt-out)
 * @req SC-P7-003 — Both real heading AND N/A marker pass (no double-fail)
 * @req SC-P7-004 — Warning text suggests the N/A marker template
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocSections } from '../cli/validators/structure.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-na-marker-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('validateDocSections — N/A markers', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('N/A marker with reason satisfies the required-section check', () => {
    dir = makeRepo({
      'docs-canonical/SECURITY.md':
        '# Security\n\n' +
        '<!-- docguard:section authentication n/a — CLI tool, no user accounts -->\n' +
        '<!-- docguard:section secrets-management n/a — no secrets handled, fully local -->\n',
    });
    const r = validateDocSections(dir, {});
    const securityWarnings = r.warnings.filter(w => w.includes('SECURITY.md'));
    assert.equal(securityWarnings.length, 0,
      `expected no SECURITY.md warnings; got: ${securityWarnings.join(' | ')}`);
  });

  it('N/A marker WITHOUT reason does NOT satisfy (prevents silent opt-out)', () => {
    dir = makeRepo({
      // No reason after the dash — the marker should be ignored
      'docs-canonical/SECURITY.md':
        '# Security\n\n<!-- docguard:section authentication n/a -->\n<!-- docguard:section secrets-management n/a -->\n',
    });
    const r = validateDocSections(dir, {});
    assert.ok(r.warnings.some(w => /Authentication/.test(w)),
      'N/A marker without reason should not silence the warning');
  });

  it('real heading still passes (regression)', () => {
    dir = makeRepo({
      'docs-canonical/SECURITY.md':
        '# Security\n\n## Authentication\nJWT.\n\n## Secrets Management\nVault.\n',
    });
    const r = validateDocSections(dir, {});
    const securityWarnings = r.warnings.filter(w => w.includes('SECURITY.md'));
    assert.equal(securityWarnings.length, 0);
  });

  it('warning text suggests the exact N/A marker template', () => {
    dir = makeRepo({
      'docs-canonical/SECURITY.md': '# Security\n\nNothing here.\n',
    });
    const r = validateDocSections(dir, {});
    const w = r.warnings.find(x => x.includes('Authentication'));
    assert.ok(w);
    assert.match(w, /docguard:section authentication n\/a/,
      'warning should show users the exact marker syntax');
  });

  it('mix of heading + N/A marker in same doc works', () => {
    dir = makeRepo({
      'docs-canonical/SECURITY.md':
        '# Security\n\n## Authentication\nJWT.\n\n' +
        '<!-- docguard:section secrets-management n/a — secrets externalized to AWS Secrets Manager -->\n',
    });
    const r = validateDocSections(dir, {});
    const securityWarnings = r.warnings.filter(w => w.includes('SECURITY.md'));
    assert.equal(securityWarnings.length, 0);
  });
});
