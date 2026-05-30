/**
 * v0.24 — env vars declared in a validation schema count as "used in code"
 * (field report #2, Issue 5).
 *
 * The bug: grepEnvUsage only matched direct `process.env.X` / `os.environ`
 * access. Projects that validate process.env through a Zod/envalid/convict
 * schema and read a typed `config.X` object had every documented var reported
 * as "in docs but missing from code" — a silent false drift.
 *
 * Fix: when a file validates process.env through such a schema, harvest the
 * schema's env keys. Gated on an actual `parse(process.env)` / cleanEnv /
 * convict signal so data schemas (parse(req.body), camelCase keys) are ignored.
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grepEnvUsage } from '../cli/shared-source.mjs';

function repoWith(relPath, content) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-envschema-'));
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return dir;
}

describe('grepEnvUsage — schema-defined env vars', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('detects Zod env keys validated against process.env', () => {
    dir = repoWith('src/config.ts', `
import { z } from 'zod';
const envSchema = z.object({
  STATE_BUCKET: z.string(),
  STATE_KEY: z.string(),
  AWS_REGION: z.string(),
});
export const config = envSchema.parse(process.env);
`);
    const names = grepEnvUsage(dir, {});
    for (const v of ['STATE_BUCKET', 'STATE_KEY', 'AWS_REGION']) {
      assert.ok(names.has(v), `${v} should be recognized as used-in-code`);
    }
  });

  it('detects convict env names (in the `env:` property value)', () => {
    dir = repoWith('src/config.js', `
const convict = require('convict');
const config = convict({
  bucket: { doc: 'x', format: String, default: '', env: 'STATE_BUCKET' },
});
config.validate();
`);
    assert.ok(grepEnvUsage(dir, {}).has('STATE_BUCKET'));
  });

  it('does NOT harvest data-schema keys (parse on non-process.env)', () => {
    dir = repoWith('src/api.ts', `
import { z } from 'zod';
const body = z.object({ userId: z.string(), firstName: z.string() });
export const h = (req) => body.parse(req.body);
const real = process.env.REAL_VAR;
`);
    const names = grepEnvUsage(dir, {});
    assert.ok(names.has('REAL_VAR'), 'direct process.env access still detected');
    assert.ok(!names.has('userId') && !names.has('firstName'),
      'camelCase data-schema keys must not be treated as env vars');
  });

  it('does not invent env vars in a plain module with no schema', () => {
    dir = repoWith('src/util.ts', `export const ADD = (a, b) => a + b;\n`);
    assert.equal(grepEnvUsage(dir, {}).size, 0);
  });
});
