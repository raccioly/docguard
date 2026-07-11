/**
 * v0.28 — the detection-gap items deferred from LLM field report #3.
 *
 *   #2  dynamic `import()` breaks an import cycle → not flagged as circular
 *   #4  API-Surface: spec declares an endpoint with no registered route
 *   #5  `verify --semantic` extracts documented numbers/enums for agent checking
 *   #10 `sync --tests` reconciles the TEST-SPEC source→test map from disk
 *   #11 freshness precedence + `init` marker stamping
 *
 * Each block pairs the fix with a non-vacuous control.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateArchitecture } from '../cli/validators/architecture.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';
import { reconcileTestMap } from '../cli/commands/sync-tests.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks } from '../cli/scanners/semantic-claims.mjs';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

// Minimal OpenAPI spec with the given { path: [methods] }.
function openapi(paths) {
  const lines = ['openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:'];
  for (const [p, methods] of Object.entries(paths)) {
    lines.push(`  ${p}:`);
    for (const m of methods) { lines.push(`    ${m}:`); lines.push(`      summary: ${m} ${p}`); }
  }
  return lines.join('\n');
}

function tmp() { return mkdtempSync(join(tmpdir(), 'docguard-fr3d-')); }
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

describe('field report #2 — dynamic import breaks a cycle', () => {
  it('a cycle closed only by a dynamic import() is NOT flagged as circular', () => {
    const dir = tmp();
    write(dir, {
      'src/a.ts': "import { b } from './b';\nexport const a = () => b();\n",
      // b breaks the cycle with `await import('./a')` — the canonical pattern.
      'src/b.ts': "export const b = async () => { const { a } = await import('./a'); return a(); };\n",
    });
    const r = validateArchitecture(dir, {});
    const cyc = (r.warnings || []).filter((w) => /Circular dependency/.test(w));
    assert.equal(cyc.length, 0, 'dynamic import() is a load-time cycle break, not an edge');
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: a cycle via STATIC imports IS still flagged', () => {
    const dir = tmp();
    write(dir, {
      'src/a.ts': "import { b } from './b';\nexport const a = () => b();\n",
      'src/b.ts': "import { a } from './a';\nexport const b = () => a();\n",
    });
    const r = validateArchitecture(dir, {});
    const cyc = (r.warnings || []).filter((w) => /Circular dependency/.test(w));
    assert.ok(cyc.length >= 1, 'control: static a↔b cycle must be flagged');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #11 — freshness markers stamped on init', () => {
  it('all canonical templates carry a last-reviewed marker', () => {
    const tdir = join(process.cwd(), 'templates');
    for (const t of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'ENVIRONMENT', 'TEST-SPEC', 'REQUIREMENTS']) {
      const c = readFileSync(join(tdir, `${t}.md.template`), 'utf-8');
      assert.ok(/docguard:last-reviewed/.test(c), `${t} template missing last-reviewed marker`);
    }
  });

  it('`init` stamps a today-dated last-reviewed marker into every canonical doc', () => {
    const dir = tmp();
    spawnSync('node', [CLI, 'init', '--fix', '--dir', dir], { encoding: 'utf-8' });
    const canonDir = join(dir, 'docs-canonical');
    assert.ok(existsSync(canonDir), 'docs-canonical created');
    const today = new Date().toISOString().split('T')[0];
    const docs = readdirSync(canonDir).filter((f) => f.endsWith('.md'));
    assert.ok(docs.length > 0, 'at least one canonical doc created');
    for (const d of docs) {
      const c = readFileSync(join(canonDir, d), 'utf-8');
      const markerLine = c.split('\n').find((l) => /docguard:last-reviewed/.test(l)) || '';
      assert.ok(markerLine, `${d} missing last-reviewed marker`);
      assert.ok(markerLine.includes(today), `${d} marker not dated today (${markerLine})`);
      assert.ok(!/YYYY-MM-DD/.test(markerLine), `${d} marker still has placeholder`);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #4 — spec declares an endpoint with no registered route', () => {
  it('flags a spec endpoint that no code route registers', () => {
    const dir = tmp();
    write(dir, {
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'docs/openapi.yaml': openapi({ '/api/users': ['get'], '/api/ghost': ['post'] }),
      'src/routes.js': "app.get('/api/users', h);\n", // only /api/users is registered
    });
    const r = validateApiSurface(dir, {});
    const ghost = (r.warnings || []).filter((w) => /declares \S+ \/api\/ghost but no route/i.test(w));
    assert.equal(ghost.length, 1, 'phantom spec endpoint must be flagged');
    const users = (r.warnings || []).filter((w) => /\/api\/users but no route/.test(w));
    assert.equal(users.length, 0, 'a registered endpoint must NOT be flagged');
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: no warning when every spec endpoint has a route', () => {
    const dir = tmp();
    write(dir, {
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'docs/openapi.yaml': openapi({ '/api/users': ['get'] }),
      'src/routes.js': "app.get('/api/users', h);\n",
    });
    const r = validateApiSurface(dir, {});
    assert.equal((r.warnings || []).filter((w) => /no route registers it/.test(w)).length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: skips the check when no routes are scannable (no false positives)', () => {
    const dir = tmp();
    write(dir, {
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'docs/openapi.yaml': openapi({ '/api/users': ['get'] }),
      // no route files at all → scanner finds nothing → check must stay silent
    });
    const r = validateApiSurface(dir, {});
    assert.equal((r.warnings || []).filter((w) => /no route registers it/.test(w)).length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #10 — sync --tests reconciles the Source-to-Test Map', () => {
  const TABLE = (rows) => [
    '# Test Specification', '', '## Source-to-Test Map', '',
    '| Source File | Unit Test | Status |',
    '|---|---|---|',
    ...rows,
    '', '## Notes', 'trailing content preserved', '',
  ].join('\n');

  it('removes ghost-source rows, adds new co-located pairs, reports ghost tests, preserves the rest', () => {
    const dir = tmp();
    write(dir, {
      'src/keep.ts': 'export const k = 1;\n',
      'src/keep.test.ts': 'test();\n',
      'src/partial.ts': 'export const p = 1;\n',   // source exists, its test does NOT
      'src/new.ts': 'export const n = 1;\n',
      'src/new.test.ts': 'test();\n',               // co-located test, absent from the table
      'docs-canonical/TEST-SPEC.md': TABLE([
        '| `src/keep.ts` | `src/keep.test.ts` | ✅ |',
        '| `src/ghost.ts` | `src/ghost.test.ts` | ✅ |',     // source deleted → ghost row
        '| `src/partial.ts` | `src/partial.test.ts` | ✅ |', // test deleted → ghost test
      ]),
    });
    const content = readFileSync(join(dir, 'docs-canonical/TEST-SPEC.md'), 'utf-8');
    const r = reconcileTestMap(content, dir, {});
    assert.ok(r.applicable);
    assert.deepEqual(r.removed.map((x) => x.source), ['src/ghost.ts']);
    assert.deepEqual(r.added.map((x) => x.source), ['src/new.ts']);
    assert.ok(r.ghostTests.some((x) => x.test === 'src/partial.test.ts'), 'ghost test reported');

    const out = r.newContent;
    assert.ok(out, 'content rewritten');
    assert.ok(!/src\/ghost\.ts/.test(out), 'ghost-source row removed');
    assert.ok(/src\/new\.ts.*src\/new\.test\.ts/.test(out), 'new pair appended');
    assert.ok(/src\/keep\.ts/.test(out), 'existing valid row preserved');
    assert.ok(/## Notes[\s\S]*trailing content preserved/.test(out), 'content outside the table preserved');
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: no rewrite when the table already matches disk', () => {
    const dir = tmp();
    write(dir, {
      'src/keep.ts': 'export const k = 1;\n',
      'src/keep.test.ts': 'test();\n',
      'docs-canonical/TEST-SPEC.md': TABLE(['| `src/keep.ts` | `src/keep.test.ts` | ✅ |']),
    });
    const content = readFileSync(join(dir, 'docs-canonical/TEST-SPEC.md'), 'utf-8');
    const r = reconcileTestMap(content, dir, {});
    assert.equal(r.removed.length, 0);
    assert.equal(r.added.length, 0);
    assert.equal(r.newContent, null, 'no rewrite when nothing drifted');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #5 — verify --semantic extracts documented claims', () => {
  it('extracts numbers-with-units + enum lists and ignores version/date/prose numbers', () => {
    const dir = tmp();
    write(dir, {
      'docs-canonical/LIMITS.md': [
        '# Limits', '',
        '## Retention', 'Audit logs are retained for 30 days. See `backend/src/retention.ts`.', '',
        '## Rate', 'The API allows 100/min for auth.', '',
        '## Status', 'A job status is one of PENDING/IDLE/RUNNING.', '',
        '## Counts', 'The jobs table has 4 GSIs and the system defines 29+ roles.', '',
        '## Noise', 'Released v0.27.0 on 2026-06-19 with Node 18/20/22 support.', '',
        '```', 'const RETENTION_DAYS = 730; // 99 days in a code fence — ignored', '```', '',
      ].join('\n'),
    });
    const claims = extractSemanticClaims(dir, {});
    const sig = claims.map((c) => (c.kind === 'enum' ? `enum:${c.value}` : `${c.value} ${c.unit}`));
    assert.ok(sig.includes('30 days'), '30 days');
    assert.ok(sig.includes('100 min'), '100/min rate');
    assert.ok(sig.includes('4 gsis'), '4 GSIs');
    assert.ok(sig.includes('29 roles'), '29+ roles');
    assert.ok(sig.some((s) => /enum:PENDING\/IDLE\/RUNNING/.test(s)), 'status enum list');
    // Noise excluded: version, date, Node matrix, and numbers inside a code fence.
    assert.ok(!claims.some((c) => /^(0|27|2026|18|20|22|730|99)$/.test(c.value)), 'version/date/fence numbers not claimed');
    // Citation: the retention claim resolves the file on its own line.
    assert.equal(claims.find((c) => c.value === '30').citedCode, 'backend/src/retention.ts');
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds an agent-actionable verify task per claim', () => {
    const dir = tmp();
    write(dir, { 'docs-canonical/X.md': '# X\n\n## Cfg\nThe request timeout is 5 seconds.\n' });
    const tasks = buildSemanticVerifyTasks(extractSemanticClaims(dir, {}));
    assert.ok(tasks.length >= 1);
    assert.match(tasks[0].instruction, /Verify .* against the code/);
    assert.equal(tasks[0].confidence, 'requires-human');
    rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL: a doc with no unit-bearing numbers yields no claims', () => {
    const dir = tmp();
    write(dir, { 'docs-canonical/Y.md': '# Y\n\nThis service handles user requests and returns JSON. Released v1.2.3.\n' });
    assert.equal(extractSemanticClaims(dir, {}).length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('honors .docguardignore — an ignored doc contributes no claims (bug-212)', () => {
    const dir = tmp();
    write(dir, {
      'docs-canonical/LIMITS.md': '# Limits\n\nRetention is 30 days.\n',
      'docs-canonical/OLD-AUDIT.md': '# Audit\n\nBack then we had 9 validators and 21 days retention.\n',
      '.docguardignore': 'docs-canonical/OLD-AUDIT.md\n',
    });
    const claims = extractSemanticClaims(dir, {});
    assert.ok(claims.some((c) => c.doc === 'docs-canonical/LIMITS.md'), 'non-ignored doc still scanned');
    assert.ok(!claims.some((c) => c.doc === 'docs-canonical/OLD-AUDIT.md'),
      `ignored doc must contribute nothing; got ${JSON.stringify(claims.map((c) => c.doc))}`);
    rmSync(dir, { recursive: true, force: true });
  });
});
