/**
 * DocGuard as an AWS AI-DLC plugin (specs/090-aidlc-plugin). The wrapper is
 * thin, so these tests cover the CLI side (`docguard sensor --aidlc`) and the
 * plugin's static contract; `aidlc engine plugin validate` runs in CI.
 *
 * @req docguard.aidlc-plugin#FR-001
 * @req docguard.aidlc-plugin#FR-002
 * @req docguard.aidlc-plugin#FR-003
 * @req docguard.aidlc-plugin#FR-004
 * @req docguard.aidlc-plugin#FR-005
 * @req docguard.aidlc-plugin#FR-006
 * @req docguard.aidlc-plugin#SC-002
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { sensorResult } from '../cli/commands/sensor.mjs';
import { fixtureGit } from './helpers/git.mjs';

const CLI = resolve('cli/docguard.mjs');
const PLUGIN = resolve('extensions/aidlc/docguard');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function project(t, files) {
  const dir = makeTempDir('docguard-sensor-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  return dir;
}
const sensor = (dir, ...args) => spawnSync(process.execPath, [CLI, 'sensor', '--aidlc', ...args], { cwd: dir, encoding: 'utf8' });
const CONFIG = (validators) => JSON.stringify({ projectName: 's', enforcement: 'standard', requiredFiles: { canonical: [], agentFile: [] }, validators });
const ONLY_PSR = Object.fromEntries(['structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security', 'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'specRegistry', 'docDependency', 'requirementAnchors', 'docOwnership', 'evidence', 'crossReference', 'generatedStaleness', 'surfaceSync', 'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells', 'canonicalSync', 'metricsConsistency', 'decisionRecords', 'aidlc'].map(k => [k, false]));

describe('US1 — the sensor contract', () => {
  it('prints one JSON line; pass follows blocking findings, blocked validators and undecided required checks', () => {
    assert.equal(sensorResult({ effectiveErrors: 0, findings: [], validators: [], verdicts: { counts: { pass: 1 } } }).pass, true);
    assert.equal(sensorResult({ effectiveErrors: 1, findings: [{ code: 'API001', severity: 'error', location: 'docs/API.md', message: 'gone' }], validators: [] }).pass, false);
    assert.equal(sensorResult({ effectiveErrors: 0, findings: [], validators: [{ key: 'x', verdict: 'blocked' }] }).pass, false);
    assert.equal(sensorResult({ effectiveErrors: 0, findings: [], validators: [], requiredChecks: { undecided: [{ key: 'apiSurface', verdict: 'inconclusive' }] } }).pass, false);
    const many = Array.from({ length: 30 }, (_, i) => ({ code: 'PSR002', severity: 'warn', location: { file: 'AGENTS.md', line: i }, message: `m${i}` }));
    const r = sensorResult({ effectiveErrors: 0, findings: many, validators: [] });
    assert.equal(r.findings.length, 20); assert.equal(r.findings_count, 30);
  });

  it('a project with drift reports it; the CLI exits 0 with the JSON line', t => {
    const dir = project(t, { '.docguard.json': CONFIG({ ...ONLY_PSR, pathScopedRules: true }), 'AGENTS.md': '# Agents\n\n- Billing: `docs/missing.md`\n' });
    const r = sensor(dir, '--stage', 'code-generation', '--output-path', 'aidlc/x.md');
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.findings_count, 1);
    assert.match(out.findings[0], /^PSR002 AGENTS\.md/);
    assert.equal(out.docguard, pkg.version);
  });
});

describe('US1 — pass means no drift introduced since HEAD', () => {
  it('a committed warning passes; the same kind of finding added in the working tree fails', t => {
    const dir = project(t, { '.docguard.json': CONFIG({ ...ONLY_PSR, pathScopedRules: true }), 'AGENTS.md': '# Agents\n\n- Billing: `docs/missing.md`\n' });
    const committed = JSON.parse(sensor(dir).stdout);
    assert.equal(committed.pass, true, 'pre-existing drift at HEAD does not fail the gate');
    assert.equal(committed.compared_with, 'HEAD');
    assert.equal(committed.new_findings_count, 0);
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\n- Billing: `docs/missing.md`\n- Ledger: `docs/ledger.md`\n');
    const introduced = JSON.parse(sensor(dir).stdout);
    assert.equal(introduced.pass, false);
    assert.equal(introduced.new_findings_count, 1);
    assert.match(introduced.findings[0], /docs\/ledger\.md/);
  });
});

describe('US2 — one guard run per tree state', () => {
  it('caches across fires and reruns when a file changes', t => {
    const dir = project(t, { '.docguard.json': CONFIG({ ...ONLY_PSR, pathScopedRules: true }), 'AGENTS.md': '# Agents\n' });
    const first = JSON.parse(sensor(dir).stdout);
    assert.equal(first.cached, undefined);
    for (let i = 0; i < 4; i++) assert.equal(JSON.parse(sensor(dir).stdout).cached, true);
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\n- Billing: `docs/missing.md`\n');
    const after = JSON.parse(sensor(dir).stdout);
    assert.equal(after.cached, undefined);
    assert.equal(after.findings_count, 1);
  });
});

describe('US3 — the plugin\'s static contract', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, '.aidlc-plugin/plugin.json'), 'utf8'));
  it('names itself docguard, depends on core, has its own catalogue, and tracks the package version', () => {
    assert.equal(manifest.name, 'docguard');
    assert.deepEqual(manifest.dependencies, ['core']);
    assert.equal(manifest.aidlc.marketplace, 'docguard-aidlc');
    assert.equal(manifest.version, pkg.version);
  });
  it('declares an advisory deterministic gate sensor whose tool file matches AI-DLC\'s naming rule', () => {
    const md = readFileSync(join(PLUGIN, 'sensors/aidlc-docguard-guard.md'), 'utf8');
    for (const line of ['id: docguard-guard', 'kind: deterministic', 'default_severity: advisory', 'fire_on: gate', 'command: bun {{HARNESS_DIR}}/tools/aidlc-sensor-docguard-guard.ts']) assert.ok(md.includes(line), line);
  });
  it('the wrapper holds no DocGuard logic, never exits 127, and follows the main(argv) contract', () => {
    const ts = readFileSync(join(PLUGIN, 'tools/aidlc-sensor-docguard-guard.ts'), 'utf8');
    // A native AI-DLC install imports the tool in-process and calls main(argv);
    // reading process.argv at load would see the engine's own arguments
    // (awslabs/aidlc-workflows#3326).
    assert.match(ts, /export function main\(argv: string\[\]\)/);
    assert.match(ts, /\["sensor", "--aidlc", \.\.\.argv\]/);
    assert.match(ts, /if \(import\.meta\.main\) main\(process\.argv\.slice\(2\)\);\s*$/);
    const code = ts.replace(/^\s*\/\/.*$/gm, '');
    assert.equal(code.match(/process\.argv/g).length, 1, 'process.argv is read only when run directly');
    assert.match(ts, /status === 127 \? 1 : status/);
    assert.match(ts, /if \(result\.error\)[\s\S]*process\.exit\(1\)/);
    assert.ok(ts.split('\n').length < 40, 'thin by design');
  });
  it('contributes the sensor to code-generation and build-and-test', () => {
    for (const stage of ['code-generation', 'build-and-test']) {
      const c = readFileSync(join(PLUGIN, `contributions/construction/${stage}.md`), 'utf8');
      assert.match(c, new RegExp(`target: ${stage}`));
      assert.match(c, /sensors:\n\s+- docguard-guard/);
    }
  });
});

describe('FR-005 — CI validates and builds the plugin on a checksum-verified AI-DLC', () => {
  it('pins the release and its installer hash, validates from a configured project, and builds the claude projection', () => {
    const wf = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = wf.slice(wf.indexOf('\n  aidlc-plugin:'), wf.indexOf('\n  publish-check:'));
    assert.match(job, /AIDLC_VERSION: \d+\.\d+\.\d+/);
    assert.match(job, /AIDLC_INSTALLER_SHA256: [0-9a-f]{64}/);
    assert.match(job, /sha256sum -c -/, 'the installer is verified before it runs');
    assert.match(job, /\(cd "\$project" && aidlc engine plugin validate "\$GITHUB_WORKSPACE\/extensions\/aidlc\/docguard"\)/);
    assert.match(job, /aidlc engine plugin build claude/);
    assert.match(job, /marketplace\.json/);
  });
});
