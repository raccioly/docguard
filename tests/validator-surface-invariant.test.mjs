/**
 * Validator surface invariant — the public "N validators" number is one fact.
 *
 * Reported by PR #407: a contributor counted the rows `guard` prints (30) and
 * "corrected" README/VALIDATION/quickstart from 29 to 30. The rows are not the
 * validator surface — `structure.mjs` registers twice (`Structure` and
 * `Doc Sections`) under one key, so guard renders 30 rows from 29 modules.
 * See the note in cli/validators/canonical-sync.mjs: sub-check results "are
 * checks rather than shipped validators".
 *
 * Canonical-Sync and Metrics-Consistency already flag this drift, but they
 * emit warnings, and .github/workflows/ci.yml deliberately allows guard's
 * exit 2 (warnings-only). So the self-scan alone cannot keep a wrong count out
 * of main — PR #407 was green on all four Node legs. These assertions run in
 * `npm test`, which is a hard gate.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { countValidatorModules } from '../cli/shared-validator-surface.mjs';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VALIDATORS_DIR = join(ROOT, 'cli', 'validators');

/** Files carrying a public "N validators" claim. */
const SURFACE_DOCS = ['README.md', 'VALIDATION.md', 'docs/quickstart.md'];
const CLAIM_RE = /(\d+)\s+(?:automated\s+)?validators|Validators\s*\((\d+)\)/g;

describe('validator surface invariant', () => {
  it('registers exactly one key per shipped validator module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dg-surface-'));
    try {
      writeFileSync(join(dir, '.docguard.json'), '{"projectName":"surface-probe"}');
      // guard exits non-zero on a bare fixture (missing canonical docs); the
      // JSON payload is what matters here, not the verdict.
      const run = spawnSync('node', [CLI, 'guard', '--dir', dir, '--format', 'json'], {
        encoding: 'utf-8', timeout: 60000,
      });
      assert.ok(run.stdout, `guard produced no JSON (status ${run.status}): ${run.stderr}`);
      const keys = JSON.parse(run.stdout).validators.map(v => v.key);
      const modules = countValidatorModules(VALIDATORS_DIR);

      assert.equal(
        new Set(keys).size, modules,
        `guard registers ${new Set(keys).size} distinct validator keys but ` +
        `cli/validators ships ${modules} modules. Either a module is not wired ` +
        `into guard.mjs, or a key is registered with no module behind it.`,
      );
      // Rows may exceed keys (sub-checks). That is the trap PR #407 fell into,
      // so assert the relationship holds rather than leaving it implicit.
      assert.ok(keys.length >= new Set(keys).size, 'rows cannot be fewer than keys');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps every public "N validators" claim equal to the shipped module count', () => {
    const modules = countValidatorModules(VALIDATORS_DIR);
    const wrong = [];

    for (const rel of SURFACE_DOCS) {
      const text = readFileSync(join(ROOT, rel), 'utf-8');
      for (const m of text.matchAll(CLAIM_RE)) {
        const claimed = Number(m[1] ?? m[2]);
        if (claimed !== modules) wrong.push(`${rel}: claims ${claimed}`);
      }
    }

    assert.deepEqual(
      wrong, [],
      `DocGuard ships ${modules} validator modules, but these claims disagree:\n  ` +
      `${wrong.join('\n  ')}\nCount cli/validators/*.mjs — not the rows guard prints.`,
    );
  });
});
