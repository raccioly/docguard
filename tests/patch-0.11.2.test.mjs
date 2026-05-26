/**
 * v0.11.2 patch coverage — locks in the bug fixes from the wu-whatsappinbox feedback.
 *
 *  B-1: Vite intrinsics (DEV/PROD/MODE/BASE_URL/SSR) on `import.meta.env.*`
 *       must NOT be reported as user env vars.
 *  B-2: diff Data Entities uses real exported names (not file basenames).
 *  B-3: literal env-var-prefix tokens like `VITE_` must not be captured.
 *
 * @req SC-008 — On the wu-whatsappinbox project, re-running guard after
 *   these fixes drops warnings substantially. Each test below targets one
 *   of the false-positive classes contributing to the warning reduction.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { grepEnvUsage } from '../cli/shared-source.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-patch-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('v0.11.2 — bug fixes from wu-whatsappinbox feedback', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('B-1: skips Vite intrinsics on import.meta.env (DEV / PROD / MODE / BASE_URL / SSR)', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { vite: '^7', react: '^19' } }),
      'src/config.ts': `
        const dev = import.meta.env.DEV;
        const prod = import.meta.env.PROD;
        const mode = import.meta.env.MODE;
        const base = import.meta.env.BASE_URL;
        const ssr = import.meta.env.SSR;
        const apiUrl = import.meta.env.VITE_API_URL;       // user-set → keep
        const dynaTable = process.env.DYNAMO_TABLE_NAME;   // user-set → keep
      `,
    });
    const names = grepEnvUsage(dir, { sourceRoot: 'src' });
    for (const intrinsic of ['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR']) {
      assert.ok(!names.has(intrinsic), `${intrinsic} must not be reported`);
    }
    assert.ok(names.has('VITE_API_URL'), 'real user env var still captured');
    assert.ok(names.has('DYNAMO_TABLE_NAME'));
  });

  it('B-3: literal `VITE_` (convention prefix in prose) is NOT captured as a var name', () => {
    // process.env.VITE_  is syntactically illegal in real code, so test the env-doc
    // parser which the user actually saw flag `VITE_` from prose `` `VITE_` ``.
    dir = make({
      'package.json': JSON.stringify({ dependencies: { vite: '^7' } }),
      'docs-canonical/ENVIRONMENT.md': [
        '# Environment',
        '## Prerequisites',
        '## Environment Variables',
        'All frontend variables MUST start with `VITE_` (Vite convention).',
        'The backend reads `DYNAMO_TABLE_NAME` from the environment.',
      ].join('\n'),
    });
    const result = validateEnvironment(dir, { projectTypeConfig: { needsEnvVars: true } });
    // Only the real var should be tracked; the `VITE_` literal prefix must be ignored.
    // The validator's warning text would mention it by name — assert it does NOT.
    assert.ok(!result.warnings.some(w => /\bVITE_\b/.test(w)),
      'VITE_ prefix should never appear as a flagged variable name');
  });

  it('B-2: diff Data Entities uses real exported names (Pydantic), not file basenames', async () => {
    // Construct a project whose model FILE is named in a way that would mislead
    // the old filename-stem heuristic. Pydantic class names inside the file are
    // the real entities.
    dir = make({
      'package.json': JSON.stringify({ name: 'svc' }),
      'pyproject.toml': '[project]\nname="svc"\ndependencies = ["pydantic"]\n',
      // Misleading filename: "models.py" basename would naively read "models".
      'api/models.py': `
from pydantic import BaseModel

class User(BaseModel):
    id: int
    email: str

class Order(BaseModel):
    id: int
    user_id: int
`,
      'docs-canonical/DATA-MODEL.md': '# Data Model\n### User\n### Order\n',
    });
    // Drive the same code-side scan diff.mjs uses (scanSchemasDeep).
    const { scanSchemasDeep } = await import('../cli/scanners/schemas.mjs');
    const r = scanSchemasDeep(dir, {}, { openapi: { found: false } });
    const names = r.entities.map(e => e.name).sort();
    assert.ok(names.includes('User'));
    assert.ok(names.includes('Order'));
    assert.ok(!names.includes('models'), 'file basename must NOT be reported as an entity');
  });
});
