/**
 * Honest-failure surfacing for the OpenAPI/doc-tools scanners.
 *
 *   - A spec that declares `paths:` but parses to ZERO endpoints is a PARSE
 *     failure (unsupported $ref/anchors/folded scalars), flagged `parseIncomplete`
 *     and surfaced as an API-Surface warning — not a silent "no API surface" pass.
 *   - A malformed package.json must NOT throw out of detectDocTools (which would
 *     abort the whole scan and make every validator see empty "truth" → false pass).
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectOpenAPI, detectDocTools } from '../cli/scanners/doc-tools.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-oa-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('OpenAPI parse-honesty', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('flags a spec with paths: but 0 parsed endpoints as parseIncomplete', () => {
    // `$ref` path item — the minimal YAML parser can't expand it into methods.
    dir = make({ 'openapi.yaml': 'openapi: 3.0.0\npaths:\n  /users:\n    $ref: "#/components/x"\n' });
    const oa = detectOpenAPI(dir);
    assert.equal(oa.found, true);
    assert.equal(oa.endpoints.length, 0);
    assert.equal(oa.parseIncomplete, true, 'a paths: section that yields 0 endpoints is a parse failure');
  });

  it('does NOT flag a healthy spec as parseIncomplete', () => {
    dir = make({ 'openapi.yaml': 'openapi: 3.0.0\npaths:\n  /users:\n    get:\n      summary: list\n' });
    const oa = detectOpenAPI(dir);
    assert.ok(oa.endpoints.length >= 1, 'healthy spec yields endpoints');
    assert.equal(oa.parseIncomplete, false);
  });

  it('API-Surface surfaces the unparseable spec as a warning (not a silent pass)', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'openapi.yaml': 'openapi: 3.0.0\npaths:\n  /users:\n    $ref: "#/components/x"\n',
    });
    const r = validateApiSurface(dir, {});
    assert.ok(
      r.warnings.some(w => w.includes('parsed 0 endpoints') && w.includes('openapi.yaml')),
      `expected an unparseable-spec warning; got ${JSON.stringify(r.warnings)}`
    );
  });

  it('detectDocTools survives a malformed package.json instead of throwing', () => {
    dir = make({ 'package.json': '{ not valid json ' });
    let threw = false;
    let tools;
    try { tools = detectDocTools(dir); } catch { threw = true; }
    assert.equal(threw, false, 'a malformed manifest must not abort the scan');
    assert.ok(tools && typeof tools === 'object');
  });
});
