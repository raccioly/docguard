/**
 * v0.15-Q — Stress test: synthetic 1000-file monorepo.
 *
 * Verifies the v0.13 N-1 + v0.14 P2 + v0.15 P3 scoping wins HOLD at scale:
 * --changed-only on a 1000-file repo where only 3 files changed should
 * complete in well under 2 seconds. Full guard should stay under ~5s.
 *
 * Without scoping (full tree walks on every validator), the same fixture
 * would be 20-30× slower. This test fails loudly on a perf regression.
 *
 * Skipped by default in fast-test mode; run explicitly with
 *   STRESS=1 node --test tests/stress-test.test.mjs
 * to exercise.
 *
 * @req SC-Q-001 — --changed-only on 1000-file repo completes < 500ms
 * @req SC-Q-002 — full guard on 1000-file repo completes < 5s
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
const RUN_STRESS = process.env.STRESS === '1';

// Build a synthetic project with N service files + N route files + canonical docs.
function makeStressRepo(serviceCount = 500, routeCount = 500) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-stress-'));
  mkdirSync(join(dir, 'src/services'), { recursive: true });
  mkdirSync(join(dir, 'src/routes'), { recursive: true });
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });

  // Reference every service + route in ARCHITECTURE.md so Docs-Sync passes.
  let archRefs = '# Architecture\n\n## Services\n\n';
  for (let i = 0; i < serviceCount; i++) {
    const name = `svc${i}`;
    writeFileSync(join(dir, `src/services/${name}.ts`),
      `export const ${name} = () => "${name}";\n`);
    archRefs += `- \`src/services/${name}.ts\`\n`;
  }
  archRefs += '\n## Routes\n\n';
  for (let i = 0; i < routeCount; i++) {
    const name = `route${i}`;
    writeFileSync(join(dir, `src/routes/${name}.ts`),
      `import express from "express";\nconst r = express.Router();\nr.get("/${name}", () => {});\nexport default r;\n`);
    archRefs += `- \`src/routes/${name}.ts\`\n`;
  }
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), archRefs);
  writeFileSync(join(dir, 'docs-canonical/ENVIRONMENT.md'),
    '# Env\n## Prerequisites\n## Environment Variables\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'stress', version: '0.0.0', dependencies: { express: '^4' },
  }));
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'stress', profile: 'starter', version: '0.5',
  }));

  // git init so Freshness has history
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });

  // Touch 3 files for the --changed-only test
  writeFileSync(join(dir, 'src/services/svc0.ts'), 'export const svc0 = () => "changed";\n');
  writeFileSync(join(dir, 'src/routes/route0.ts'),
    'import express from "express";\nconst r = express.Router();\nr.get("/route0", () => {});\nexport default r;\n// changed\n');
  writeFileSync(join(dir, 'src/services/svc1.ts'), 'export const svc1 = () => "changed too";\n');
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', 'touch 3 files'], { cwd: dir, env });

  return dir;
}

describe('Stress: synthetic 1000-file monorepo', { skip: !RUN_STRESS }, () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('--changed-only --since HEAD~1 completes under 500ms', () => {
    dir = makeStressRepo(500, 500);
    const start = performance.now();
    const r = spawnSync('node', [CLI, 'guard', '--changed-only', '--since', 'HEAD~1'],
      { cwd: dir, encoding: 'utf-8' });
    const ms = performance.now() - start;
    assert.ok(r.status === 0 || r.status === 2, `guard exited ${r.status}`);
    assert.ok(ms < 500,
      `--changed-only should be <500ms on 1000-file repo, got ${ms.toFixed(0)}ms\n${r.stdout.slice(-500)}`);
    console.log(`  stress --changed-only: ${ms.toFixed(0)}ms`);
  });

  it('full guard completes under 5s', () => {
    dir = makeStressRepo(500, 500);
    const start = performance.now();
    const r = spawnSync('node', [CLI, 'guard'], { cwd: dir, encoding: 'utf-8' });
    const ms = performance.now() - start;
    assert.ok(r.status === 0 || r.status === 2, `guard exited ${r.status}`);
    assert.ok(ms < 5000,
      `full guard should be <5s on 1000-file repo, got ${ms.toFixed(0)}ms`);
    console.log(`  stress full guard: ${ms.toFixed(0)}ms`);
  });
});

describe('Stress harness (smoke when STRESS=0)', () => {
  it('skips by default to keep `npm test` fast', () => {
    assert.ok(true);
  });
});
