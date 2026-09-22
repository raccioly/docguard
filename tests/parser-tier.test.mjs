/**
 * Which analyzer produced the evidence, reported structurally.
 *
 * DocGuard has two AST tiers and both are optional by design (constitution II):
 * `@babel/parser` for JS/TS, and the developer's own `python3` for Python. When
 * one is unavailable the scanners fall back to regex and DocGuard keeps working
 * — correct behaviour, and it used to be completely invisible. A finding from
 * the pattern tier looked identical to one from a syntax tree in every output
 * channel, so "no findings" could mean "nothing found by a parser that cannot
 * see half the syntax".
 *
 * Confidence cannot express this. The detector is not uncertain; it is reading
 * a smaller input than it appears to be. That is a structural fact and belongs
 * in a structural field.
 *
 * @implements docguard.calibrated-finding-channels#FR-010
 * @implements docguard.calibrated-finding-channels#FR-011
 * @implements docguard.calibrated-finding-channels#FR-012
 * @req docguard.calibrated-finding-channels#FR-010
 * @req docguard.calibrated-finding-channels#FR-011
 * @req docguard.calibrated-finding-channels#FR-012
 * @req docguard.calibrated-finding-channels#FR-013
 * @req FR-019 — analyzer tier computed at run time; degraded coverage disclosed
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tierFor, summarizeTiers, tierApplicability, PARSER_TIERS } from '../cli/shared-source.mjs';
import { scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { resolveApiSurface } from '../cli/validators/api-surface.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');
const HAS_PYTHON = pyAstAvailable();

const dirs = [];
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-tier-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

/** A PATH containing node and git but deliberately NO python interpreter. */
function pathWithoutPython() {
  const dir = mkdtempSync(join(tmpdir(), 'dg-nopy-'));
  dirs.push(dir);
  for (const bin of ['node', 'git']) {
    const which = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' }).stdout.trim();
    if (which) symlinkSync(which, join(dir, bin));
  }
  return dir;
}

// A Flask app whose SECOND route uses a multi-line decorator. The pattern
// fallback matches neither: its regex only understands `@app.get(...)`, never
// `@app.route(..., methods=[...])`. So this fixture reads as TWO routes with an
// interpreter and ZERO without — the sharpest possible form of the problem.
const FLASK_APP = `from flask import Flask
app = Flask(__name__)

@app.route("/users", methods=["GET"])
def users():
    return []

@app.route(
    "/orders",
    methods=["POST"],
)
def orders():
    return []
`;

const FLASK_PROJECT = {
  'requirements.txt': 'flask\n',
  '.docguard.json': JSON.stringify({ projectName: 'tier', profile: 'starter', validators: { apiSurface: true } }),
  'src/main.py': FLASK_APP,
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nA Flask service.\n',
  'docs-canonical/API-REFERENCE.md': '# API Reference\n\n## GET /users\n\nList users.\n',
};

describe('tierFor (FR-010)', () => {
  // @req docs-canonical/REQUIREMENTS.md#FR-019 — the analyzer tier is computed at run time, not assumed
  test('a real syntax tree reports the full tier for its language', () => {
    assert.deepEqual(tierFor('a.py', { ok: true }), { tier: 'py-ast', tierReason: null });
    for (const f of ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.tsx', 'a.mts', 'a.cts']) {
      assert.equal(tierFor(f, { ok: true }).tier, 'js-ast', f);
    }
  });

  test('a per-file parse failure falls back for that file and names the error', () => {
    const r = tierFor('a.py', { ok: false, error: 'unexpected indent' });
    assert.equal(r.tier, 'regex-fallback');
    assert.match(r.tierReason, /unexpected indent/);
  });

  test('an unavailable batch tier falls back and names the cause', () => {
    assert.match(tierFor('a.py', null).tierReason, /python3/i);
    assert.match(tierFor('a.ts', null).tierReason, /parser unavailable/i);
    assert.match(tierFor('a.py', null, 'custom reason').tierReason, /custom reason/);
  });

  test('a language with no AST tier is fallback-language, which is not a gap', () => {
    for (const f of ['a.go', 'a.rs', 'a.java', 'a.rb', 'a.php', 'Makefile']) {
      assert.equal(tierFor(f, null).tier, 'fallback-language', f);
    }
    // Distinguishing this from regex-fallback matters: DocGuard has no Go
    // parser to be missing, so reporting a coverage gap would be noise.
    assert.equal(tierApplicability(summarizeTiers([{ tier: 'fallback-language' }]), 'file'), null);
  });

  test('every tier it can return is in the published vocabulary', () => {
    for (const parsed of [{ ok: true }, { ok: false }, null]) {
      for (const f of ['a.py', 'a.ts', 'a.go']) {
        assert.ok(PARSER_TIERS.includes(tierFor(f, parsed).tier));
      }
    }
  });
});

describe('summarizeTiers (FR-011)', () => {
  test('agreeing items keep their tier', () => {
    assert.equal(summarizeTiers([{ tier: 'py-ast' }, { tier: 'py-ast' }]).tier, 'py-ast');
    assert.equal(summarizeTiers([{ tier: 'py-ast' }, { tier: 'py-ast' }]).degraded, 0);
  });

  test('disagreeing items are mixed and the reason names the WEAKEST input', () => {
    // A conclusion drawn from several files is only as strong as its weakest
    // input, never the average.
    const s = summarizeTiers([{ tier: 'py-ast' }, { tier: 'regex-fallback', tierReason: 'no python3' }]);
    assert.equal(s.tier, 'mixed');
    assert.equal(s.tierReason, 'no python3');
    assert.equal(s.degraded, 1);
  });

  test('an empty or unrecognized set is not-applicable, never a false full tier', () => {
    assert.equal(summarizeTiers([]).tier, 'not-applicable');
    assert.equal(summarizeTiers(undefined).tier, 'not-applicable');
    assert.equal(summarizeTiers([{ tier: 'bogus' }]).tier, 'not-applicable');
  });
});

describe('tierApplicability (FR-012)', () => {
  test('full coverage reports no gap', () => {
    assert.equal(tierApplicability(summarizeTiers([{ tier: 'js-ast' }]), 'file'), null);
    assert.equal(tierApplicability(null, 'file'), null);
  });

  test('a degraded tier is partial coverage, and findings are still retained', () => {
    const a = tierApplicability(summarizeTiers([{ tier: 'regex-fallback', tierReason: 'No usable python3.' }]), 'source file');
    assert.equal(a.status, 'partial');
    assert.match(a.reason, /retained/i, 'coverage is downgraded, findings are not suppressed');
    assert.match(a.reason, /weak evidence/i, 'the reason must say what absence means here');
    assert.match(a.reason, /python3/);
  });
});

describe('route scanning carries its tier (FR-011)', () => {
  test('the scan tier survives even when the scan found nothing', () => {
    // The whole point: an empty result from a degraded tier is exactly the
    // case a caller must be able to tell apart from "this project has no
    // routes", so the tier cannot ride on the individual results.
    const dir = project(FLASK_PROJECT);
    const routes = scanRoutesDeep(dir, { framework: 'Flask' }, { openapi: { found: false } }, { config: {} });
    assert.ok(routes.scanTier, 'scanTier must survive the dedup/filter pass');
    assert.ok(PARSER_TIERS.includes(routes.scanTier.tier));
  });

  test('routes found by a syntax tree are tagged py-ast', { skip: HAS_PYTHON ? false : 'no python3 on this host' }, () => {
    const dir = project(FLASK_PROJECT);
    const routes = scanRoutesDeep(dir, { framework: 'Flask' }, { openapi: { found: false } }, { config: {} });
    assert.equal(routes.length, 2, 'the AST tier reads the multi-line decorator');
    assert.ok(routes.every(r => r.tier === 'py-ast'));
    assert.ok(routes.every(r => r.tierReason === null));
  });
});

describe('Python frameworks are reachable at all (regression)', () => {
  // `detectFramework` considered package.json alone, so it returned '' for every
  // Python project. scanRoutesDeep gates its Flask/FastAPI/Django walkers on the
  // framework name, so none of them could run: a Flask service reported
  // `no-matches` and its API surface went silently unchecked. On a real
  // repository this hid six undocumented endpoints.
  test('a Flask project resolves a code surface', { skip: HAS_PYTHON ? false : 'no python3 on this host' }, () => {
    const dir = project(FLASK_PROJECT);
    const surface = resolveApiSurface(dir, {});
    assert.equal(surface.confidence, 'code');
    assert.equal(surface.endpoints.length, 2);
    assert.deepEqual(surface.endpoints.map(e => `${e.method} ${e.path}`).sort(),
      ['GET /users', 'POST /orders']);
  });

  test('the resolved surface names the tier that produced it', { skip: HAS_PYTHON ? false : 'no python3 on this host' }, () => {
    assert.equal(resolveApiSurface(project(FLASK_PROJECT), {}).tier.tier, 'py-ast');
  });
});

describe('end to end: the same project, with and without an interpreter', () => {
  const guard = (dir, extraPath) => {
    const env = extraPath ? { ...process.env, PATH: extraPath } : process.env;
    const run = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(run.stdout);
  };

  test('with an interpreter: the undocumented endpoint is found and tagged', { skip: HAS_PYTHON ? false : 'no python3 on this host' }, () => {
    const data = guard(project(FLASK_PROJECT));
    const api = data.findings.filter(f => f.code === 'API005');
    assert.equal(api.length, 1, 'POST /orders is undocumented');
    assert.equal(api[0].parserTier, 'py-ast');
    assert.equal(data.validators.find(v => v.key === 'apiSurface').applicability.status, 'checked');
  });

  test('without one: the validator reports partial and names the interpreter', () => {
    const data = guard(project(FLASK_PROJECT), pathWithoutPython());
    const applicability = data.validators.find(v => v.key === 'apiSurface').applicability;
    assert.equal(applicability.status, 'partial',
      'an empty surface from the pattern tier must not read as a completed check');
    assert.match(applicability.reason, /python3/i);
    assert.match(applicability.reason, /weak evidence/i);
  });
});

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
