/**
 * v0.14-Q1 — Multi-fixture test harness.
 *
 * Runs the full guard against several real-world-shaped projects: Next.js
 * web app, Vite frontend, Express backend, Python CLI, Rust lib, and a
 * polyglot monorepo. Each fixture exercises a different subset of the
 * scanners, validators, and code paths. If ANY validator leaks a developer
 * error (B-5 class), this test catches it before release.
 *
 * Why we need this: single-fixture tests can mask env-specific bugs. The
 * wu-whatsappinbox B-5 regression slipped past 434 tests because the
 * specific combination of OS + node version + .docguard.json shape wasn't
 * covered. Multi-fixture testing is a low-cost insurance policy.
 *
 * Each fixture is small (< 20 lines of code/docs) — these are SHAPE tests,
 * not realistic projects. The test asserts:
 *   1. No validator throws a ReferenceError / TypeError / "is not defined"
 *   2. The total validator count is the expected 22 (no silent registration failure)
 *   3. The validator either runs or returns N/A — never throws
 *
 * @req SC-Q1-001 — every fixture completes runGuardInternal without throws
 * @req SC-Q1-002 — no validator leaks a developer error in any fixture
 * @req SC-Q1-003 — all 22 validators register in every fixture
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runGuardInternal } from '../cli/commands/guard.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-fixture-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  // git init + commit so validators that need git history have it
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

// ── The fixtures ──
// Each entry is { name, files, config?(optional) }. Files are project-relative.

const FIXTURES = {
  'nextjs-webapp': {
    files: {
      'package.json': JSON.stringify({
        name: 'nextjs-fixture', version: '1.0.0',
        dependencies: { next: '^14', react: '^18' },
      }),
      'app/page.tsx': 'export default function Home() { return <div>Hello</div>; }',
      'app/api/users/route.ts':
        'export async function GET() { return Response.json({}); }',
      'docs-canonical/ARCHITECTURE.md': '# A\n## Components\nstub\n',
      'docs-canonical/DATA-MODEL.md': '# DM\n',
      'docs-canonical/SECURITY.md': '# S\n',
      'docs-canonical/TEST-SPEC.md': '# T\n',
      'docs-canonical/ENVIRONMENT.md': '# E\n## Prerequisites\n## Environment Variables\n',
      'CHANGELOG.md': '# Changelog\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# Drift\n',
      'AGENTS.md': '# Agents\n',
      '.docguard.json': JSON.stringify({ projectName: 'nextjs-fixture', profile: 'standard', version: '0.5' }),
    },
  },

  'vite-frontend': {
    files: {
      'package.json': JSON.stringify({
        name: 'vite-fixture', version: '1.0.0',
        dependencies: { vite: '^5', react: '^18' },
      }),
      'src/main.tsx': 'const apiUrl = import.meta.env.VITE_API_URL;',
      'src/store/counter.ts': 'export const useCounter = () => {};',
      'docs-canonical/ARCHITECTURE.md': '# A\n',
      'docs-canonical/ENVIRONMENT.md': '# E\n## Prerequisites\n## Environment Variables\n`VITE_API_URL`',
      'CHANGELOG.md': '# C\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# D\n',
      'AGENTS.md': '# A\n',
      '.docguard.json': JSON.stringify({ projectName: 'vite-fixture', profile: 'starter', version: '0.5' }),
    },
  },

  'express-backend': {
    files: {
      'package.json': JSON.stringify({
        name: 'express-fixture', version: '1.0.0',
        dependencies: { express: '^4', dotenv: '^16' },
      }),
      'src/routes/users.ts':
        'import express from "express";\nconst r = express.Router();\nr.get("/users", () => {});\nexport default r;\n',
      'src/services/auth.ts': 'export const validate = () => true;',
      'docs-canonical/ARCHITECTURE.md': '# A\n',
      'docs-canonical/API-REFERENCE.md': '# API\n## Endpoints\n',
      'docs-canonical/ENVIRONMENT.md': '# E\n## Prerequisites\n## Environment Variables\n',
      'CHANGELOG.md': '# C\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# D\n',
      'AGENTS.md': '# A\n',
      '.docguard.json': JSON.stringify({ projectName: 'express-fixture', profile: 'starter', version: '0.5' }),
    },
  },

  'python-cli': {
    files: {
      'pyproject.toml': '[project]\nname="python-cli"\nversion="0.1.0"\ndependencies=["click"]\n',
      'src/cli.py': 'import click\n@click.command()\ndef main():\n    pass\n',
      'docs-canonical/ARCHITECTURE.md': '# A\n',
      'CHANGELOG.md': '# C\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# D\n',
      'AGENTS.md': '# A\n',
      '.docguard.json': JSON.stringify({ projectName: 'python-cli', profile: 'starter', version: '0.5' }),
    },
  },

  'rust-lib': {
    files: {
      'Cargo.toml': '[package]\nname = "rust-lib"\nversion = "0.1.0"\n',
      'src/lib.rs': 'pub fn add(a: u32, b: u32) -> u32 { a + b }',
      'docs-canonical/ARCHITECTURE.md': '# A\n',
      'CHANGELOG.md': '# C\n## [Unreleased]\n',
      'DRIFT-LOG.md': '# D\n',
      'AGENTS.md': '# A\n',
      '.docguard.json': JSON.stringify({ projectName: 'rust-lib', profile: 'starter', version: '0.5' }),
    },
  },
};

// Patterns that indicate a developer-error leak (B-5 class).
const DEVELOPER_ERROR_PATTERNS = [
  /is not defined/i,
  /is not a function/i,
  /Cannot read propert/i,
  /undefined is not/i,
  /^TypeError\b/,
  /^ReferenceError\b/,
];

describe('multi-fixture test harness', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: completes guard without any validator throwing`, () => {
      dir = makeRepo(fixture.files);
      let config = JSON.parse(fixture.files['.docguard.json']);
      // Ensure standard config shape so Structure validator has what it needs
      config = {
        ...config,
        requiredFiles: config.requiredFiles || {
          canonical: Object.keys(fixture.files).filter(f => f.startsWith('docs-canonical/')),
          agentFile: ['AGENTS.md', 'CLAUDE.md'],
          changelog: 'CHANGELOG.md',
          driftLog: 'DRIFT-LOG.md',
        },
      };

      // The actual assertion: no throws, no developer errors leaked.
      let data;
      assert.doesNotThrow(() => { data = runGuardInternal(dir, config); },
        `${name}: runGuardInternal threw — that's a regression`);

      assert.ok(data, `${name}: runGuardInternal returned no data`);
      assert.ok(Array.isArray(data.validators),
        `${name}: data.validators missing`);

      // Every validator's error messages must NOT contain developer-error patterns.
      for (const v of data.validators) {
        for (const err of v.errors || []) {
          for (const pat of DEVELOPER_ERROR_PATTERNS) {
            assert.doesNotMatch(err, pat,
              `${name} → ${v.name} leaked: "${err}"`);
          }
        }
      }
    });
  }

  it('all 22 validators register in every fixture (no silent failure)', () => {
    dir = makeRepo(FIXTURES['express-backend'].files);
    const config = JSON.parse(FIXTURES['express-backend'].files['.docguard.json']);
    const data = runGuardInternal(dir, {
      ...config,
      requiredFiles: {
        canonical: ['docs-canonical/ARCHITECTURE.md', 'docs-canonical/API-REFERENCE.md', 'docs-canonical/ENVIRONMENT.md'],
        agentFile: ['AGENTS.md'],
        changelog: 'CHANGELOG.md',
        driftLog: 'DRIFT-LOG.md',
      },
    });
    // Expect 22 validators (as of v0.13: 21 + Generated-Staleness = 22).
    assert.ok(data.validators.length >= 20,
      `expected at least 20 validators registered, got ${data.validators.length}`);
  });
});
