import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectSpecDivergence, findAllOpenApiSpecs, validateApiSurface } from '../cli/validators/api-surface.mjs';

function openapi(paths) {
  const lines = ['openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:'];
  for (const [p, methods] of Object.entries(paths)) {
    lines.push(`  ${p}:`);
    for (const m of methods) { lines.push(`    ${m}:`); lines.push(`      summary: ${m} ${p}`); }
  }
  return lines.join('\n');
}

describe('multi-OpenAPI-spec divergence', () => {
  let tmp;
  const write = (rel, content) => {
    const full = join(tmp, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-multispec-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('finds specs in canonical locations and flags divergence', () => {
    write('package.json', JSON.stringify({ workspaces: [] }));
    write('backend/package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('backend/src/x.ts', 'export {};');
    // Served (sourceRoot) spec has /metrics; root generated spec does not.
    write('backend/docs/openapi.yaml', openapi({ '/api/live': ['get'], '/metrics': ['get'] }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));

    const config = { sourceRoot: 'backend/src' };
    const specs = findAllOpenApiSpecs(tmp, config);
    assert.equal(specs.length, 2, 'both canonical specs found');

    const div = detectSpecDivergence(tmp, config);
    assert.ok(div, 'divergence detected');
    assert.ok(div.divergent.some(k => k.includes('/metrics')), 'reports the /metrics divergence');
    assert.equal(div.authoritative, 'backend/docs/openapi.yaml', 'sourceRoot spec is authoritative');
  });

  it('does NOT flag divergence when specs agree', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('backend/package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('backend/src/x.ts', 'export {};');
    write('backend/docs/openapi.yaml', openapi({ '/api/live': ['get'] }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));

    const div = detectSpecDivergence(tmp, { sourceRoot: 'backend/src' });
    assert.equal(div, null);
  });

  it('validateApiSurface emits a multi-spec warning naming the authoritative file', () => {
    write('package.json', JSON.stringify({ workspaces: [] }));
    write('backend/package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('backend/src/x.ts', 'export {};');
    write('backend/docs/openapi.yaml', openapi({ '/api/live': ['get'], '/metrics': ['get'] }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));

    const r = validateApiSurface(tmp, { sourceRoot: 'backend/src' });
    assert.ok(r.warnings.some(w => /Multiple OpenAPI specs disagree/.test(w)));
    assert.ok(r.warnings.some(w => w.includes('backend/docs/openapi.yaml')));
  });

  it('ignores worktree/vendor copies (only canonical locations count)', () => {
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    write('docs/openapi.yaml', openapi({ '/api/live': ['get'] }));
    // A divergent copy buried in a worktree must NOT be picked up.
    write('.claude/worktrees/foo/docs/openapi.yaml', openapi({ '/api/live': ['get'], '/ghost': ['get'] }));

    const specs = findAllOpenApiSpecs(tmp, {});
    assert.equal(specs.length, 1, 'only the canonical root spec is considered');
    assert.equal(detectSpecDivergence(tmp, {}), null);
  });
});
