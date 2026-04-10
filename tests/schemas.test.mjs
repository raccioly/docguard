import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mock } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';

describe('schemas.mjs - walkDir error handling', () => {
  it('should gracefully handle readdirSync errors during schema scan', () => {
    // We create a temp dir structure that matches drizzle scanning (e.g. src/db)
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-schemas-'));
    const drizzleDir = join(tempDir, 'src', 'db');
    fs.mkdirSync(drizzleDir, { recursive: true });

    // Write a dummy file so it's not totally empty if we wanted it to be found
    fs.writeFileSync(join(drizzleDir, 'schema.ts'), 'export const users = pgTable("users", {});');

    const originalReaddirSync = fs.readdirSync;

    // Mock readdirSync to throw when reading the drizzle dir
    mock.method(fs, 'readdirSync', (path, options) => {
      if (typeof path === 'string' && path.includes(join('src', 'db'))) {
        throw new Error('EACCES: permission denied');
      }
      return originalReaddirSync(path, options);
    });

    try {
      // scanSchemasDeep will eventually call scanDrizzleSchemas, which calls walkDir
      // If walkDir doesn't catch the error, this will throw and fail the test.
      const result = scanSchemasDeep(tempDir, { orm: 'drizzle' }, {});

      // We expect it to complete successfully, even though no entities might be found due to the error
      assert.ok(result);
      assert.ok(Array.isArray(result.entities));
    } finally {
      mock.restoreAll();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
