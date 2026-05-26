/**
 * v0.17.1-B7 — regression: NODE_ENV documented in BOTH ENVIRONMENT.md AND
 * .env.example should NOT appear in `docguard diff`'s "in code but not
 * documented" list. The wu repo reported asymmetry between guard (PASS)
 * and diff (warning) because my v0.16-P4 SYSTEM_ENV_VARS denylist
 * incorrectly included NODE_ENV / CI / GITHUB_*.
 *
 * @req SC-B7-001 — NODE_ENV present in both doc + .env.example is counted as documented by diff
 * @req SC-B7-002 — Environment validator agrees with diff on NODE_ENV (no asymmetry)
 * @req SC-B7-003 — PATH (truly system) still filtered out from doc-side prose mentions
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { diffEnvVars } from '../cli/commands/diff.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-b7-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('B-7: diff/validator symmetry on NODE_ENV', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('NODE_ENV in both ENVIRONMENT.md table AND .env.example is NOT flagged by diff', () => {
    dir = makeRepo({
      'docs-canonical/ENVIRONMENT.md':
        '# Environment\n\n' +
        '## Environment Variables\n\n' +
        '| Variable | Description |\n' +
        '|----------|-------------|\n' +
        '| `NODE_ENV` | App mode: development/production |\n',
      '.env.example': 'NODE_ENV=development\n',
      'src/index.ts': 'const m = process.env.NODE_ENV;',
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
    });
    const d = diffEnvVars(dir, {});
    assert.ok(d, 'diffEnvVars should produce a result');
    assert.ok(!d.onlyInCode.includes('NODE_ENV'),
      `NODE_ENV must not appear in 'in code but not documented' list; got onlyInCode: ${d.onlyInCode.join(', ')}`);
  });

  it('validator + diff agree: both count NODE_ENV as documented', () => {
    dir = makeRepo({
      'docs-canonical/ENVIRONMENT.md':
        '# Env\n## Prerequisites\n## Environment Variables\n\n| Variable | Description |\n|---|---|\n| `NODE_ENV` | mode |\n',
      '.env.example': 'NODE_ENV=development\n',
      'src/main.ts': 'export const x = process.env.NODE_ENV;',
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
    });
    const v = validateEnvironment(dir, { projectTypeConfig: { needsEnvVars: true } });
    // Validator should NOT emit a warning about NODE_ENV being undocumented
    assert.ok(
      !v.warnings.some(w => /NODE_ENV/.test(w) && /undocumented/i.test(w)),
      `validator should not flag NODE_ENV as undocumented; warnings: ${v.warnings.join(' | ')}`
    );
  });

  it('PATH (truly system) is still filtered from doc-prose mentions', () => {
    dir = makeRepo({
      // PATH is mentioned in prose with backticks but is NOT a real app env var
      'docs-canonical/ENVIRONMENT.md':
        '# Env\n\nThe `cli` binary is on the venv `PATH`.\n',
      'src/main.ts': 'export const x = 1;',  // no process.env.PATH reading
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
    });
    const d = diffEnvVars(dir, {});
    if (d) {
      assert.ok(!d.onlyInDocs.includes('PATH'),
        'PATH (system var in prose) should not appear in onlyInDocs');
    }
  });

  it('CI is no longer filtered (apps DO check process.env.CI)', () => {
    dir = makeRepo({
      'docs-canonical/ENVIRONMENT.md':
        '# Env\n\n## Environment Variables\n\n| Variable | Description |\n|---|---|\n| `CI` | true when running in CI |\n',
      '.env.example': 'CI=false\n',
      'src/main.ts': 'export const inCi = !!process.env.CI;',
      'package.json': JSON.stringify({ name: 't', version: '0.0.0' }),
    });
    const d = diffEnvVars(dir, {});
    assert.ok(d, 'should produce a result');
    assert.ok(!d.onlyInCode.includes('CI'),
      'CI documented + in code should not be flagged');
  });
});
