/**
 * Strict by default, Stage A (specs/097-strict-by-default): truthful verdicts,
 * a cause and a fix on every empty result, and a selectable enforcement mode.
 * An absent `enforcement` key still resolves to `standard` in this stage, so
 * every `standard` assertion below is also a statement that no exit code moved.
 *
 * The v0.47.0 tests build a `git archive` of the tag in a scratch directory and
 * run its CLI as a subprocess. They skip, with a reason, when the tag is not in
 * the clone (a shallow checkout); CI checks out with `fetch-depth: 0`.
 *
 * @req docguard.strict-by-default#FR-001
 * @req docguard.strict-by-default#FR-002
 * @req docguard.strict-by-default#FR-004
 * @req docguard.strict-by-default#FR-005
 * @req docguard.strict-by-default#FR-006
 * @req docguard.strict-by-default#FR-007
 * @req docguard.strict-by-default#FR-008
 * @req docguard.strict-by-default#FR-014
 * @req docguard.strict-by-default#FR-015
 * @req docguard.strict-by-default#FR-016
 * @req docguard.strict-by-default#FR-018
 * @req docguard.strict-by-default#FR-020
 * @req docguard.strict-by-default#SC-005
 * @req docguard.strict-by-default#SC-006
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FIXTURE_GIT, fixtureGit } from './helpers/git.mjs';
import { FIXTURES as FIXTURES_A, run as runA } from './helpers/applicability-fixtures-a.mjs';
import { FIXTURES as FIXTURES_B, run as runB } from './helpers/applicability-fixtures-b.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

const temporary = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

/** A committed fixture project. `config` is the whole .docguard.json. */
function project(files, config) {
  const dir = scratch('docguard-strict-');
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  if (config) write(dir, '.docguard.json', JSON.stringify(config, null, 2));
  execFileSync('git', [...FIXTURE_GIT, 'init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

const ALL_KEYS = [
  'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry',
  'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence', 'crossReference',
  'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence',
  'apiDocSmells', 'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
const only = (...keys) => Object.fromEntries(ALL_KEYS.map(k => [k, keys.includes(k)]));
const cfg = (validators, extra = {}) => ({ projectName: 'strict-fixture', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators, ...extra });

function guard(dir, args = [], env = {}) {
  const r = spawnSync(process.execPath, [CLI, 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: { ...ENV, ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function guardJson(dir, extra = []) {
  const r = guard(dir, ['--format', 'json', ...extra]);
  return { ...r, json: JSON.parse(r.out) };
}
const verdictOf = (json, key) => json.validators.find(v => v.key === key);

// A project with an HTTP route and no API reference document.
const ROUTES = {
  'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', dependencies: { express: '4.18.2' } }),
  'src/routes/users.js': "const router = require('express').Router();\nrouter.get('/users', (req, res) => res.json([]));\nmodule.exports = router;\n",
};
// A project with no route, no spec and nothing an API reference would describe.
const NO_API = { 'package.json': JSON.stringify({ name: 'lib', version: '1.0.0' }), 'src/index.js': 'export const x = 1;\n' };

// ── T001: an older DocGuard must keep working on a config that carries the key (FR-002) ──
const TAG = 'v0.47.0';
const tagExists = (() => { try { fixtureGit(ROOT, ['rev-parse', '--verify', '-q', `${TAG}^{commit}`]); return true; } catch { return false; } })();
let V047 = null;
function baseCli() {
  if (V047) return V047;
  const dir = scratch('docguard-v047-');
  const tarball = join(dir, '.tag.tar');
  fixtureGit(ROOT, ['archive', '-o', tarball, TAG]);
  const tar = spawnSync('tar', ['-x', '-f', tarball, '-C', dir]);
  rmSync(tarball, { force: true });
  assert.equal(tar.status, 0, 'tar extract failed');
  V047 = dir;
  return dir;
}
function v047Guard(dir, args = []) {
  const r = spawnSync(process.execPath, [join(baseCli(), 'cli', 'docguard.mjs'), 'guard', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const skipNoTag = tagExists ? false : `${TAG} is not in this clone (shallow checkout); CI fetches full history`;

describe('FR-002: v0.47.0 loads a configuration that carries `enforcement`', { skip: skipNoTag }, () => {
  const files = { 'package.json': JSON.stringify({ name: 'p' }), 'docs-canonical/ARCHITECTURE.md': '# Architecture\n' };
  const variants = { absent: undefined, string: 'strict', object: { mode: 'strict', asOf: '0.49' } };
  const runs = {};
  before(() => {
    for (const [name, enforcement] of Object.entries(variants)) {
      const dir = project(files, { projectName: 'p', version: '0.6', ...(enforcement === undefined ? {} : { enforcement }) });
      runs[name] = v047Guard(dir, ['--format', 'json']);
    }
  });
  for (const name of ['string', 'object']) {
    it(`the ${name} form runs guard with no configuration error and the same findings as no key`, () => {
      const r = runs[name];
      assert.doesNotMatch(r.err, /Error parsing \.docguard\.json/);
      const json = JSON.parse(r.out);
      assert.ok(Array.isArray(json.validators) && json.validators.length > 0, 'guard produced a validator list');
      const base = JSON.parse(runs.absent.out);
      const key = j => JSON.stringify(j.findings.map(f => [f.code, f.location, f.message]).sort());
      assert.equal(key(json), key(base));
      assert.equal(r.status, runs.absent.status);
    });
  }
});

// ── T005: the mode resolves in one place (FR-001, FR-016) ──
describe('resolveEnforcement', () => {
  it('an absent key is the default mode with source "default"; Stage A default is standard', async () => {
    const { resolveEnforcement } = await import('../cli/config.mjs');
    assert.deepEqual(resolveEnforcement({}), { mode: 'standard', asOf: null, source: 'default' });
  });
  it('reads the string and the object form, with source "config"', async () => {
    const { resolveEnforcement } = await import('../cli/config.mjs');
    assert.deepEqual(resolveEnforcement({ enforcement: 'strict' }), { mode: 'strict', asOf: null, source: 'config' });
    assert.deepEqual(resolveEnforcement({ enforcement: { mode: 'standard', asOf: '0.49' } }), { mode: 'standard', asOf: '0.49', source: 'config' });
  });
  it('never reads `profile` as a mode', async () => {
    const { resolveEnforcement } = await import('../cli/config.mjs');
    for (const profile of ['standard', 'enterprise', 'starter', 'strict']) {
      assert.equal(resolveEnforcement({ profile }).source, 'default', profile);
    }
  });
  it('rejects a malformed value', async () => {
    const { resolveEnforcement } = await import('../cli/config.mjs');
    for (const bad of ['lenient', 3, [], { mode: 'lenient' }, { mode: 'strict', asOf: 'latest' }, { asOf: '0.49' }]) {
      assert.throws(() => resolveEnforcement({ enforcement: bad }), /enforcement/, JSON.stringify(bad));
    }
  });
  it('a malformed value is a configuration error from the CLI, not a silent default', () => {
    const dir = project(NO_API, cfg(only('structure'), { enforcement: 'lenient' }));
    const r = guard(dir, ['--format', 'json']);
    assert.equal(r.status, 1);
    assert.match(r.err, /Error parsing \.docguard\.json: enforcement/);
  });
  it('the schema accepts both forms', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'docguard-config.schema.json'), 'utf8'));
    const e = schema.properties?.enforcement;
    assert.ok(e, 'schema declares enforcement');
    const forms = e.oneOf || e.anyOf;
    assert.ok(Array.isArray(forms) && forms.length === 2, 'string form and object form');
    assert.deepEqual(forms.find(f => f.type === 'string').enum, ['strict', 'standard']);
    assert.deepEqual(forms.find(f => f.type === 'object').properties.mode.enum, ['strict', 'standard']);
  });
});

// ── T002: strict exit and listing (FR-006, FR-007) ──
describe('strict: a validator that applies and examined nothing exits 4', () => {
  const strictCfg = extra => cfg(only('apiSurface'), { enforcement: 'strict', ...extra });

  it('lists it with its cause and fix, and exits 4', () => {
    const dir = project(ROUTES, strictCfg());
    const { status, json } = guardJson(dir);
    assert.equal(status, 4);
    // Missing prerequisite is `inconclusive`: strict makes today's --fail-on-inconclusive the default.
    assert.equal(verdictOf(json, 'apiSurface').verdict, 'inconclusive');
    const u = json.strict.unexamined.find(x => x.validator === 'apiSurface');
    assert.ok(u, 'apiSurface is listed as unexamined');
    assert.equal(u.cause, 'needs-declaration');
    assert.match(u.howToConfigure, /API-REFERENCE\.md/);
    assert.deepEqual(json.strict.blocking, ['apiSurface']);
  });

  it('a validator that does not apply is skipped, with what was looked for, and does not affect the exit code', () => {
    const dir = project(NO_API, strictCfg());
    const { status, json } = guardJson(dir);
    assert.equal(status, 0);
    const v = verdictOf(json, 'apiSurface');
    assert.equal(v.verdict, 'skipped');
    assert.equal(v.applies.applies, false);
    assert.match(v.applicability.reason, /no OpenAPI/);
    assert.deepEqual(json.strict.unexamined, []);
  });

  it('spec 081 FR-003: under strict every skipped verdict has a not-applicable class, and the writers and coverage agree', () => {
    const dir = project({ ...NO_API, 'README.md': '# r\n\n<!-- docguard:validator docsSync n/a — nothing here owner:@maintainers expires:2099-12-31 -->\n' }, cfg(only('apiSurface', 'docsSync', 'surfaceSync', 'structure'), { enforcement: 'strict' }));
    const { json } = guardJson(dir);
    const skipped = json.validators.filter(v => v.verdict === 'skipped' && v.status !== 'skipped');
    assert.ok(skipped.length >= 2, 'a not-applicable remap and a waiver');
    for (const v of json.validators.filter(v => v.verdict === 'skipped')) {
      if (v.status === 'skipped') continue; // disabled by configuration: class not-applicable by its own path
      assert.equal(v.applicability.class, 'not-applicable', v.key);
    }
    const remapped = verdictOf(json, 'apiSurface');
    assert.equal(remapped.applicability.status, 'not-applicable');
    assert.ok(remapped.applicability.before.status, 'the original status is kept');
    assert.match(remapped.applicability.reason, /no OpenAPI/);
    const counts = json.checkCoverage.counts;
    assert.equal(counts['not-applicable'], json.validators.filter(v => v.applicability?.status === 'not-applicable').length);
    assert.ok(JSON.stringify(json.checkCoverage.limitations).includes('apiSurface'));
    const junit = guard(dir, ['--format', 'junit']).out;
    assert.match(junit, /name="API-Surface"[^>]*><skipped\/>/);
    const sarif = JSON.parse(guard(dir, ['--format', 'sarif']).out).runs[0].invocations[0].toolExecutionNotifications;
    assert.equal(sarif.some(n => n.descriptor.id === 'apiSurface'), false, 'a skipped validator is not a notification');
  });

  it('a waiver carries its owner and expiry into strict.waived', () => {
    const dir = project({ ...ROUTES, 'README.md': '# svc\n\n<!-- docguard:validator apiSurface n/a — internal service owner:@maintainers expires:2099-12-31 -->\n' }, strictCfg());
    const w = guardJson(dir).json.strict.waived.find(x => x.validator === 'apiSurface');
    assert.equal(w.owner, '@maintainers');
    assert.equal(w.expires, '2099-12-31');
  });

  it('a reasoned waiver removes it from the list and counts it as waived', () => {
    const dir = project({ ...ROUTES, 'README.md': '# svc\n\n<!-- docguard:validator apiSurface n/a — internal service, no public API owner:@maintainers expires:2099-12-31 -->\n' }, strictCfg());
    const { status, json } = guardJson(dir);
    assert.equal(status, 0);
    assert.deepEqual(json.strict.unexamined, []);
    assert.deepEqual(json.strict.waived.map(w => w.validator), ['apiSurface']);
  });

  it('--changed-only does not evaluate the unexamined rule and says so', () => {
    const dir = project(ROUTES, strictCfg());
    const r = guard(dir, ['--changed-only', '--format', 'json']);
    assert.notEqual(r.status, 4);
    assert.match(r.err, /not evaluated under --changed-only/);
    assert.equal(JSON.parse(r.out).strict.evaluated, false);
  });
});

// ── T003: standard reproduces the old exit codes (FR-001, FR-016, FR-019) ──
describe('standard: no exit code moves, and the mode line says where the mode came from', () => {
  const fixtures = {
    routes: [ROUTES, only('apiSurface')],
    'no api': [NO_API, only('apiSurface')],
    structure: [NO_API, only('structure')],
  };
  for (const [name, [files, validators]] of Object.entries(fixtures)) {
    it(`${name}: an absent key and "standard" exit like v0.47.0`, { skip: skipNoTag }, () => {
      const absent = project(files, cfg(validators));
      const explicit = project(files, cfg(validators, { enforcement: 'standard' }));
      const base = v047Guard(absent);
      assert.equal(guard(absent).status, base.status, 'absent key');
      assert.equal(guard(explicit).status, base.status, 'explicit standard');
    });
  }

  it('an absent key prints the default, with the key to choose another', () => {
    const dir = project(NO_API, cfg(only('structure')));
    const r = guard(dir);
    assert.match(r.out, /Enforcement: standard — the default/);
    const json = guardJson(dir).json;
    assert.deepEqual(json.enforcement, { mode: 'standard', asOf: null, source: 'default' });
    assert.equal(json.strict, undefined, 'strict block only when strict is the mode');
  });

  it('an explicit key prints that it came from the configuration', () => {
    const dir = project(NO_API, cfg(only('structure'), { enforcement: 'standard' }));
    assert.match(guard(dir).out, /Enforcement: standard — set by "enforcement"/);
    assert.deepEqual(guardJson(dir).json.enforcement, { mode: 'standard', asOf: null, source: 'config' });
  });

  it('the mode line is the first line of the summary, ahead of the verdict counts', () => {
    const dir = project(NO_API, cfg(only('structure'), { enforcement: 'strict' }));
    const lines = guard(dir).out.split('\n');
    const mode = lines.findIndex(l => l.includes('Enforcement: strict'));
    const verdicts = lines.findIndex(l => l.includes('Verdicts:'));
    assert.ok(mode >= 0 && verdicts === mode + 1, `mode line at ${mode}, verdicts at ${verdicts}`);
  });

  it('under standard an applicable-but-empty validator keeps its pre-strict verdict (no skipped remap)', () => {
    const dir = project(NO_API, cfg(only('apiSurface')));
    const v = verdictOf(guardJson(dir).json, 'apiSurface');
    assert.notEqual(v.verdict, 'skipped');
    assert.equal(v.applies.applies, false, 'the decision is still reported');
  });

  it('requiredChecks and --fail-on-inconclusive behave as before under standard', () => {
    const dir = project(NO_API, cfg(only('apiSurface'), { requiredChecks: ['apiSurface'] }));
    assert.equal(guard(dir).status, 4, 'a required check that found nothing still exits 4');
  });
});

// ── T004: the closed list of codes that could exit 1 under the 0.47.0 defaults (FR-008) ──
describe('the codes that can exit 1 under the 0.47.0 defaults', { skip: skipNoTag }, () => {
  // specs/097-strict-by-default/plan.md, "Closed lists".
  const PLAN = ['ANC001', 'ANC003', 'ANC005', 'API004', 'DLK005', 'DRF001', 'DRF002', 'EVD001', 'EVD002', 'OWN007', 'REQ001', 'STR001', 'STR002'];
  // ANC001 and ANC003 fail only for a link accepted as `reviewed-exact`: the source decides that per link.
  const CONDITIONAL = ['ANC001', 'ANC003'];

  /** `severity: 'error'` call sites at the tag, by the nearest code literal before each. */
  function derive() {
    const base = baseCli();
    const found = new Map();
    const files = [join(base, 'cli', 'required-checks.mjs')];
    const vdir = join(base, 'cli', 'validators');
    for (const f of readdirSync(vdir)) if (f.endsWith('.mjs')) files.push(join(vdir, f));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/severity:\s*'error'/g)) {
        const before = [...text.slice(Math.max(0, m.index - 400), m.index).matchAll(/\b([A-Z]{3}\d{3})\b/g)].map(x => x[1]).pop();
        if (before) found.set(before, relative(base, file));
      }
    }
    return found;
  }

  it('the error call sites in default-enabled validators equal the plan list, less the two conditional codes', async () => {
    const base = baseCli();
    const { CODES } = await import(join(base, 'cli', 'findings.mjs'));
    const defaults = await (async () => {
      const probe = scratch('docguard-defaults-');
      const { loadConfig } = await import(join(base, 'cli', 'config.mjs'));
      return loadConfig(probe).validators;
    })();
    const derived = [...derive().keys()]
      .filter(code => code === 'REQ001' || defaults[CODES[code]?.validator] !== false)
      .sort();
    assert.deepEqual(derived, PLAN.filter(c => !CONDITIONAL.includes(c)));
  });

  it('the two conditional codes are decided by the reviewed-exact policy in the source', () => {
    const text = readFileSync(join(baseCli(), 'cli', 'scanners', 'anchors.mjs'), 'utf8');
    assert.match(text, /export function isFailingProblem/);
    assert.match(text, /reviewed-exact/);
    for (const code of CONDITIONAL) assert.match(text, new RegExp(code));
  });

  it('the codes of validators the 0.47.0 defaults leave off are exactly Security and Architecture', async () => {
    const base = baseCli();
    const { CODES } = await import(join(base, 'cli', 'findings.mjs'));
    const { loadConfig } = await import(join(base, 'cli', 'config.mjs'));
    const defaults = loadConfig(scratch('docguard-defaults-')).validators;
    const off = [...derive().keys()].filter(code => code !== 'REQ001' && defaults[CODES[code]?.validator] === false);
    const owners = [...new Set(off.map(c => CODES[c].validator))].sort();
    assert.deepEqual(owners, ['architecture']);
  });
});

// ── T008: truthful verdicts (FR-004) ──
describe('deriveVerdict: pass requires a performed check', () => {
  it('no findings and zero performed checks is empty, whatever else the result sets', async () => {
    const { deriveVerdict } = await import('../cli/validator-coverage.mjs');
    const base = { errors: [], warnings: [], findings: [], observations: [] };
    assert.equal(deriveVerdict({ ...base, total: 1, passed: 0, performed: 0, applicability: { status: 'checked' } }), 'empty');
    assert.equal(deriveVerdict({ ...base, total: 0, passed: 0, applicability: { status: 'checked' } }), 'empty');
    assert.equal(deriveVerdict({ ...base, total: 3, passed: 3, applicability: { status: 'checked' } }), 'pass');
    assert.equal(deriveVerdict({ ...base, total: 3, passed: 3, performed: 3, applicability: { status: 'checked' } }), 'pass');
  });
  it('findings still make it fail with zero performed checks', async () => {
    const { deriveVerdict } = await import('../cli/validator-coverage.mjs');
    assert.equal(deriveVerdict({ errors: [], warnings: [], findings: [{}], performed: 0, total: 1 }), 'fail');
  });
  it('the performed count is the explicit field, else the legacy total', async () => {
    const { performedChecks } = await import('../cli/validator-coverage.mjs');
    assert.equal(performedChecks({ performed: 0, total: 5 }), 0);
    assert.equal(performedChecks({ total: 5 }), 5);
    assert.equal(performedChecks({}), 0);
  });
});

describe('Requirement-Anchors enabled with zero anchors is empty, not pass', () => {
  it('enabled, nothing tagged: empty', () => {
    const dir = project(NO_API, cfg(only('requirementAnchors'), { anchors: { enabled: true } }));
    const v = verdictOf(guardJson(dir).json, 'requirementAnchors');
    assert.equal(v.verdict, 'empty');
    assert.equal(v.performed, 0);
  });
  it('the printed check counts are unchanged under standard (total keeps its pad)', () => {
    const dir = project(NO_API, cfg(only('requirementAnchors'), { anchors: { enabled: true } }));
    const v = verdictOf(guardJson(dir).json, 'requirementAnchors');
    assert.equal(v.total, 1);
  });
});

describe('Doc-Dependency with a lock that covers nothing is empty, not pass', () => {
  it('performed counts compared sections, not the padded total', () => {
    const dir = project({ ...NO_API, '.docguard-doc-lock.json': JSON.stringify({ schemaVersion: 1, sections: {} }) }, cfg(only('docDependency')));
    const v = verdictOf(guardJson(dir).json, 'docDependency');
    assert.equal(v.performed, 0);
    assert.equal(v.total, 1, 'the printed total keeps its pad under standard');
    assert.equal(v.verdict, 'empty');
  });
});

describe('FR-004 and requiredChecks (a disclosed interaction, not an exit-code change by itself)', () => {
  it('a required validator that performed nothing now holds the gate under standard, as spec 083 intends', () => {
    // Requirement-Anchors enabled with zero anchors used to report pass (a padded total of 1).
    const dir = project(NO_API, cfg(only('requirementAnchors'), { anchors: { enabled: true }, requiredChecks: ['requirementAnchors'] }));
    assert.equal(guard(dir).status, 4);
    const without = project(NO_API, cfg(only('requirementAnchors'), { anchors: { enabled: true } }));
    assert.equal(guard(without).status, 0, 'unrequired: no exit code moves');
  });
});

describe('Doc-Ownership: a placeholder purpose is a finding', () => {
  const owned = purpose => project(
    { 'docs/arch.md': '# Arch\n', 'src/a.js': 'export const a = 1;\n' },
    cfg(only('docOwnership'), { ownership: { roots: ['src'], entries: [{ doc: 'docs/arch.md', ...(purpose === undefined ? {} : { purpose }), paths: ['src/**'] }] } }),
  );
  const own008 = dir => guardJson(dir).json.findings.filter(f => f.code === 'OWN008');
  for (const [label, purpose] of [['<purpose>', '<purpose>'], ['empty', ''], ['blank', '   '], ['an angle-bracket placeholder', '<what this section covers>']]) {
    it(`${label} is reported`, () => {
      const found = own008(owned(purpose));
      assert.equal(found.length, 1);
      assert.equal(found[0].severity, 'warn');
    });
  }
  it('a written purpose and an omitted purpose are not reported', () => {
    assert.equal(own008(owned('Explains the public API')).length, 0);
    assert.equal(own008(owned(undefined)).length, 0);
  });
  it('a map with one real entry still performs checks, so the validator passes', () => {
    const v = verdictOf(guardJson(owned('Explains the public API')).json, 'docOwnership');
    assert.equal(v.verdict, 'pass');
    assert.ok(v.performed > 0);
  });
  it('a map with no entries performs nothing and is empty', () => {
    const dir = project({ 'docs/arch.md': '# A\n' }, cfg(only('docOwnership'), { ownership: { entries: [] } }));
    const v = verdictOf(guardJson(dir).json, 'docOwnership');
    assert.equal(v.performed, 0);
    assert.equal(v.verdict, 'empty');
  });
});

// ── T009/T010: the result contract, enforced across the registry (FR-005, FR-006, SC-006) ──
import { runGuardInternal } from '../cli/commands/guard.mjs';
import * as coverage from '../cli/validator-coverage.mjs';
// Namespace access: against a tree without the contract each test fails on its own, not the whole file.
const EMPTY_CAUSES = () => coverage.EMPTY_CAUSES;
const validateResultContract = (r) => coverage.validateResultContract(r);

/**
 * Validators that have not been migrated to the result contract. Empty: every registered validator returns it,
 * and the registry tests below fail if one stops.
 */
const NOT_YET_MIGRATED = [
];
// Group A (tests/validator-applicability-a.test.mjs holds its fixtures) and group B
// (tests/validator-applicability-b.test.mjs) are migrated: nothing is left on this list.
const MIGRATED = [
  'apiSurface', 'docsSync', 'surfaceSync', 'security',
  'structure', 'docSections', 'drift', 'changelog', 'testSpec', 'environment', 'architecture', 'freshness', 'traceability',
  'docsDiff', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle',
  'specRegistry', 'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence',
  'crossReference', 'generatedStaleness', 'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells',
  'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];

/** Fixtures per migrated validator: where it applies and is empty, where it does not apply, and the fix applied. */
const API_ROUTES = { ...ROUTES };
const FIXTURES = {
  apiSurface: {
    'needs-declaration': { files: API_ROUTES },
    'needs-content': { files: { ...API_ROUTES, 'docs-canonical/API-REFERENCE.md': '# API Reference\n\nNothing yet.\n' } },
    'layout-not-recognized': { files: { ...NO_API, 'package.json': JSON.stringify({ name: 'svc', dependencies: { express: '4.18.2' } }), 'docs-canonical/API-REFERENCE.md': '# API\n\n| Method | Path |\n|---|---|\n| GET | `/users` |\n' } },
    'nothing-of-this-kind': { files: NO_API },
    fix: { files: { ...API_ROUTES, 'docs-canonical/API-REFERENCE.md': '# API Reference\n\n| Method | Path |\n|---|---|\n| GET | `/users` |\n' } },
  },
  docsSync: {
    'needs-declaration': { files: { 'src/routes/users.js': 'export const x = 1;\n' } },
    'layout-not-recognized': { files: { 'app/controllers/users.js': 'export const x = 1;\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n' } },
    'nothing-of-this-kind': { files: { ...NO_API, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n' } },
    fix: { files: { 'src/routes/users.js': 'export const x = 1;\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe `users` route lives in src/routes/users.js.\n' } },
  },
  surfaceSync: {
    'needs-declaration': { files: { 'cli/commands/a.mjs': '', 'cli/commands/b.mjs': '', 'cli/commands/c.mjs': '', 'README.md': '# R\n' } },
    'layout-not-recognized': { files: { 'cli/commands/a.mjs': '', 'README.md': '# R\n' }, extra: { surfaceSync: { surfaces: [{ name: 'commands', glob: 'bin/*.mjs', docs: ['README.md'] }] } } },
    'nothing-of-this-kind': { files: NO_API },
    fix: { files: { 'cli/commands/a.mjs': '', 'cli/commands/b.mjs': '', 'cli/commands/c.mjs': '', 'README.md': '# R\n\n| Command |\n|---|\n| `a` |\n| `b` |\n| `c` |\n' }, extra: { surfaceSync: { surfaces: [{ name: 'commands', glob: 'cli/commands/*.mjs', docs: ['README.md'] }] } } },
  },
};
// The documents of the `docs-missing` case: a declared surface whose document does not exist.
FIXTURES.surfaceSync['docs-missing'] = { files: { 'cli/commands/a.mjs': '', 'cli/commands/b.mjs': '', 'cli/commands/c.mjs': '' }, extra: { surfaceSync: { surfaces: [{ name: 'commands', glob: 'cli/commands/*.mjs', docs: ['docs/COMMANDS.md'] }] } }, cause: 'needs-declaration' };

function run(key, fixture, mode = 'strict') {
  const dir = project(fixture.files, cfg(only(key), { enforcement: mode, ...(fixture.extra || {}) }));
  const { loadConfig } = awaitedConfig;
  const data = runGuardInternal(dir, loadConfig(dir));
  return { dir, data, result: data.validators.find(v => v.key === key) };
}
let awaitedConfig;
before(async () => { awaitedConfig = await import('../cli/config.mjs'); });

describe('the result contract, per migrated validator', () => {
  for (const key of MIGRATED.filter(k => FIXTURES[k])) { // security: its fixtures live in validator-applicability-security.test.mjs
    describe(key, () => {
      for (const [cause, fixture] of Object.entries(FIXTURES[key])) {
        if (cause === 'fix') continue;
        const expected = fixture.cause || cause;
        it(`${cause}: reports cause, fix, applies and a complete contract`, () => {
          const { result } = run(key, fixture);
          assert.deepEqual(validateResultContract(result), []);
          assert.equal(result.performed, 0);
          assert.equal(result.emptyCause, expected);
          assert.ok(EMPTY_CAUSES().includes(result.emptyCause));
          assert.equal(result.applies.applies, expected !== 'nothing-of-this-kind');
          assert.ok(result.howToConfigure.length > 20, 'a real fix text');
        });
      }
      it('applying the fix makes it perform at least one check', () => {
        const { result } = run(key, FIXTURES[key].fix);
        assert.deepEqual(validateResultContract(result), []);
        assert.ok(result.performed >= 1, `performed ${result.performed}`);
        assert.equal(result.emptyCause, undefined);
        assert.equal(result.verdict === 'pass' || result.verdict === 'fail', true, `verdict ${result.verdict}`);
      });
      it('exports applies(projectDir, config) with the same decision', async () => {
        const mod = await import(`../cli/validators/${{ apiSurface: 'api-surface', docsSync: 'docs-sync', surfaceSync: 'surface-sync' }[key]}.mjs`);
        for (const [cause, fixture] of Object.entries(FIXTURES[key])) {
          if (cause === 'fix') continue;
          const { dir } = run(key, fixture);
          const a = mod.applies(dir, awaitedConfig.loadConfig(dir));
          assert.equal(a.applies, (fixture.cause || cause) !== 'nothing-of-this-kind', cause);
          assert.ok(a.evidence.length > 0);
        }
      });
    });
  }
});

describe('the registry', () => {
  let keys;
  before(() => {
    const dir = project(NO_API, cfg(only(...ALL_KEYS), {}));
    keys = runGuardInternal(dir, awaitedConfig.loadConfig(dir)).validators.map(v => v.key).filter(k => k !== 'requiredChecks');
  });

  it('every validator is either migrated or on the not-yet-migrated list, never both, never neither', () => {
    const migrated = new Set(MIGRATED);
    const pending = new Set(NOT_YET_MIGRATED);
    for (const k of keys) {
      assert.ok(migrated.has(k) !== pending.has(k), `${k} must be in exactly one of MIGRATED / NOT_YET_MIGRATED`);
    }
    for (const k of [...migrated, ...pending]) assert.ok(keys.includes(k), `${k} is not a registered validator`);
  });

  it('the not-yet-migrated list is honest: a validator on it returns no contract, a validator off it returns one', () => {
    // A validator that returns `applies` on any fixture has been migrated and must leave the list.
    for (const key of NOT_YET_MIGRATED) {
      const { data } = run(key, { files: NO_API });
      const result = data.validators.find(v => v.key === key);
      assert.equal(result.applies, undefined, `${key} returns the contract; remove it from NOT_YET_MIGRATED`);
    }
  });

  it('no migrated validator can be empty without a cause and a fix (SC-006)', () => {
    for (const key of MIGRATED.filter(k => FIXTURES[k])) { // security: its fixtures live in validator-applicability-security.test.mjs
      for (const [cause, fixture] of Object.entries(FIXTURES[key])) {
        if (cause === 'fix') continue;
        const { result } = run(key, fixture);
        if (result.verdict === 'empty' || result.performed === 0) {
          assert.ok(EMPTY_CAUSES().includes(result.emptyCause), `${key}/${cause}`);
          assert.ok(result.howToConfigure, `${key}/${cause}`);
        }
      }
    }
  });

  it('no two validators share an empty reason sentence (SC-006)', () => {
    const seen = new Map();
    for (const key of MIGRATED.filter(k => FIXTURES[k])) { // security: its fixtures live in validator-applicability-security.test.mjs
      for (const [cause, fixture] of Object.entries(FIXTURES[key])) {
        if (cause === 'fix') continue;
        const { result } = run(key, fixture);
        const reason = result.applicability?.reason;
        assert.ok(reason, `${key}/${cause} has a reason`);
        for (const [other, who] of seen) assert.notEqual(reason, other, `${key}/${cause} shares its reason with ${who}`);
        seen.set(reason, `${key}/${cause}`);
      }
    }
  });

  it('across every fixture table, every validator is covered, none shares an empty reason and none is empty without a cause (SC-006)', () => {
    // Core fixtures are { cause: fixture }; group A and B tables are { empties: { name: fixture } }.
    const tables = [
      [FIXTURES, (key, fixture) => run(key, fixture), (entry) => Object.entries(entry).filter(([name]) => name !== 'fix')],
      [FIXTURES_A, (key, fixture) => runA(key, fixture), (entry) => Object.entries(entry.empties)],
      [FIXTURES_B, (key, fixture) => runB(key, fixture), (entry) => Object.entries(entry.empties)],
    ];
    // Security never ends empty: a run that scanned nothing already carries the SEC011 warning, so its cause is in
    // its evidence (tests/validator-applicability-security.test.mjs).
    const covered = new Set(['security']);
    const seen = new Map();
    for (const [table, runOne, empties] of tables) {
      for (const [key, entry] of Object.entries(table)) {
        covered.add(key);
        for (const [name, fixture] of empties(entry)) {
          const result = runOne(key, fixture).result;
          const label = `${key}/${name}`;
          if (result.verdict === 'empty' || result.performed === 0) {
            assert.ok(EMPTY_CAUSES().includes(result.emptyCause), `${label} is empty without a cause`);
            assert.ok(result.howToConfigure, `${label} is empty without a fix`);
          }
          const reason = result.applicability?.reason;
          assert.ok(reason, `${label} has a reason`);
          if (seen.has(reason)) assert.fail(`${label} shares its reason with ${seen.get(reason)}: ${reason}`);
          seen.set(reason, label);
        }
      }
    }
    for (const k of keys) assert.ok(covered.has(k), `${k} has no fixture in any table`);
  });

  it('under strict, a migrated empty validator blocks and a skipped one does not', () => {
    const blocked = run('docsSync', FIXTURES.docsSync['needs-declaration']);
    assert.deepEqual(blocked.data.strict.blocking, ['docsSync']);
    const skipped = run('docsSync', FIXTURES.docsSync['nothing-of-this-kind']);
    assert.deepEqual(skipped.data.strict.blocking, []);
    assert.equal(skipped.result.verdict, 'skipped');
  });
});

describe('validateResultContract', () => {
  const ok = { key: 'k', performed: 0, applies: { applies: true, evidence: 'x' }, emptyCause: 'needs-content', howToConfigure: 'do it', findings: [], errors: [], warnings: [] };
  it('accepts a complete empty result', () => assert.deepEqual(validateResultContract(ok), []));
  it('rejects each missing piece', () => {
    assert.match(validateResultContract({ ...ok, applies: undefined }).join(), /applies must be/);
    assert.match(validateResultContract({ ...ok, applies: { applies: true, evidence: ' ' } }).join(), /evidence is empty/);
    assert.match(validateResultContract({ ...ok, emptyCause: undefined }).join(), /emptyCause/);
    assert.match(validateResultContract({ ...ok, emptyCause: 'because' }).join(), /emptyCause/);
    assert.match(validateResultContract({ ...ok, howToConfigure: '' }).join(), /howToConfigure/);
    assert.match(validateResultContract({ ...ok, performed: undefined }).join(), /performed/);
  });
  it('nothing-of-this-kind holds exactly when applies is false', () => {
    assert.match(validateResultContract({ ...ok, emptyCause: 'nothing-of-this-kind' }).join(), /nothing-of-this-kind/);
    assert.match(validateResultContract({ ...ok, applies: { applies: false, evidence: 'x' } }).join(), /nothing-of-this-kind/);
    assert.deepEqual(validateResultContract({ ...ok, emptyCause: 'nothing-of-this-kind', applies: { applies: false, evidence: 'x' } }), []);
  });
});

// ── T006: output (FR-014, FR-015) ──
describe('strict output', () => {
  const failing = () => project(ROUTES, cfg(only('apiSurface'), { enforcement: 'strict' }));

  it('prints the Adopt block, in order, when the exit code is 4', () => {
    const r = guard(failing());
    assert.equal(r.status, 4);
    const i = {
      adopt: r.out.indexOf('Adopt'),
      fix: r.out.indexOf('API-REFERENCE.md', r.out.indexOf('Adopt')),
      waiver: r.out.indexOf('docguard:validator <key> n/a'),
      mode: r.out.indexOf('"enforcement": "standard"'),
    };
    assert.ok(i.adopt >= 0 && i.fix > i.adopt && i.waiver > i.fix && i.mode > i.waiver, JSON.stringify(i));
    assert.match(r.out, /owner:<@handle> expires:<YYYY-MM-DD>/);
  });

  it('prints it with --quiet too', () => {
    const r = guard(failing(), ['--quiet']);
    assert.equal(r.status, 4);
    assert.match(r.out, /Adopt/);
  });

  it('offers the baseline command with the count when findings fail the build', () => {
    const dir = project({ 'package.json': '{}' }, { projectName: 'p', version: '0.6', enforcement: 'strict', validators: only('structure'), requiredFiles: { canonical: ['docs-canonical/A.md', 'docs-canonical/B.md'], agentFile: [] } });
    const r = guard(dir);
    assert.equal(r.status, 1);
    // Four missing files: the two named, the changelog and the drift log.
    assert.match(r.out, /Record the 4 existing finding\(s\)/);
    assert.match(r.out, /docguard guard --update-baseline/);
  });

  it('prints no Adopt block when the run is clean, or under standard', () => {
    assert.doesNotMatch(guard(project(NO_API, cfg(only('apiSurface'), { enforcement: 'strict' }))).out, /Adopt/);
    assert.doesNotMatch(guard(project(ROUTES, cfg(only('apiSurface'), { enforcement: 'standard' }))).out, /Adopt/);
  });

  it('JSON carries enforcement and the strict block', () => {
    const { json } = guardJson(failing());
    assert.deepEqual(json.enforcement, { mode: 'strict', asOf: null, source: 'config' });
    assert.deepEqual(Object.keys(json.strict).sort(), ['baselined', 'blocking', 'evaluated', 'gating', 'pending', 'unexamined', 'waived']);
    assert.deepEqual(Object.keys(json.strict.unexamined[0]).sort(), ['blocking', 'cause', 'howToConfigure', 'name', 'newIn', 'reason', 'validator', 'verdict']);
    assert.equal(json.strict.baselined, 0);
  });

  it('SARIF renders an unexamined validator as a warning notification with its cause and fix', () => {
    const r = guard(failing(), ['--format', 'sarif']);
    assert.equal(r.status, 4);
    const run0 = JSON.parse(r.out).runs[0];
    const n = run0.invocations[0].toolExecutionNotifications.find(x => x.descriptor.id === 'apiSurface');
    assert.equal(n.level, 'warning');
    assert.match(n.message.text, /needs-declaration/);
    assert.match(n.message.text, /API-REFERENCE\.md/);
    assert.equal(run0.invocations[0].executionSuccessful, true);
  });

  it('JUnit renders it as a skipped test case carrying the cause', () => {
    const r = guard(failing(), ['--format', 'junit']);
    assert.equal(r.status, 4);
    assert.match(r.out, /<testcase [^>]*name="API-Surface"[^>]*><skipped message="[^"]*needs-declaration/);
  });

  it('ci blocks on an unexamined validator under strict', () => {
    const dir = failing();
    const r = spawnSync(process.execPath, [CLI, 'ci', '--dir', dir, '--no-history', '--format', 'json'], { encoding: 'utf8', env: ENV });
    const out = JSON.parse(r.stdout);
    assert.equal(out.assessment.status, 'BLOCKED');
    assert.ok(out.assessment.reasons.includes('CI_STRICT_UNEXAMINED'));
    assert.deepEqual(out.assessment.strictUnexamined, ['apiSurface']);
  });
});

// ── T007: docguard upgrade reports what strict changes, and writes nothing (FR-018) ──
describe('upgrade: the read-only strict report', () => {
  /** Content hash of every file under `dir`, `.git` included; DocGuard's own self-ignoring `.docguard/` state directory excluded. */
  function snapshot(dir) {
    const out = {};
    const walk = d => {
      for (const name of readdirSync(d)) {
        const abs = join(d, name);
        const rel = relative(dir, abs).replace(/\\/g, '/');
        if (rel === '.docguard' || rel.startsWith('.docguard/')) continue;
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else out[rel] = createHash('sha256').update(readFileSync(abs)).digest('hex');
      }
    };
    walk(dir);
    return out;
  }
  const upgrade = (dir, args = []) => spawnSync(process.execPath, [CLI, 'upgrade', '--schema-only', ...args], { cwd: dir, encoding: 'utf8', env: ENV });

  it('lists the unexamined validators with cause and fix, and the lower-mode key', () => {
    const dir = project(ROUTES, cfg(only('apiSurface')));
    const r = upgrade(dir);
    assert.match(r.stdout, /Strict\s+mode/);
    assert.match(r.stdout, /API-Surface is inconclusive \(needs-declaration\)/);
    assert.match(r.stdout, /API-REFERENCE\.md/);
    assert.match(r.stdout, /"enforcement": "standard"/);
    assert.match(r.stdout, /Nothing was written/);
  });

  it('says so when strict would change nothing', () => {
    const dir = project(NO_API, cfg(only('apiSurface')));
    assert.match(upgrade(dir).stdout, /Strict would change nothing for this project/);
  });

  it('writes nothing: every file, the git directory included, is byte-identical afterwards', () => {
    const dir = project(ROUTES, cfg(only('apiSurface')));
    const before = snapshot(dir);
    upgrade(dir);
    assert.deepEqual(snapshot(dir), before);
  });

  it('prints nothing about strict for a project with no .docguard.json', () => {
    const dir = project(NO_API);
    assert.doesNotMatch(upgrade(dir).stdout, /Strict\s+mode/);
  });
});

describe('DocGuard runs its own strict mode (FR-020, SC-005)', () => {
  it('this repository selects strict and guard on it exits 0 or 2, never 1 or 4', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.docguard.json'), 'utf8'));
    assert.equal(config.enforcement, 'strict');
    const r = spawnSync(process.execPath, [CLI, 'guard'], { cwd: ROOT, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 });
    assert.ok([0, 2].includes(r.status), `guard exited ${r.status}\n${r.stdout.slice(-2000)}`);
    assert.match(r.stdout, /Enforcement: strict/);
    assert.doesNotMatch(r.stdout, /Adopt/);
  });
});
