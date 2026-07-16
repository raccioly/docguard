/**
 * `docguard report` — compliance-evidence bundle (v0.33).
 *
 * @req SC-RPT-001 — buildReport returns the full evidence shape
 * @req SC-RPT-002 — integrity hash is deterministic for the same tree state
 * @req SC-RPT-003 — integrity hash excludes generatedAt (timestamps don't break reproducibility)
 * @req SC-RPT-004 — report exits 0 even when guard has errors (evidence, not a gate)
 * @req SC-RPT-005 — --format json emits pure parseable JSON (no banner bytes)
 * @req SC-RPT-006 — markdown mode emits the report with no ANSI banner (headless)
 * @req SC-RPT-007 — --out writes the artifact to a file
 * @req SC-RPT-008 — findings are grouped by code with counts
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildReport } from '../cli/commands/report.mjs';
import { loadConfig } from '../cli/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

/** Minimal project: a config + one canonical doc. Guard will flag plenty
 *  (missing required files) — which is exactly what the evidence tests need. */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-report-'));
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 'report-fixture',
    profile: 'standard',
  }));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n\nA fixture.\n');
  writeFileSync(join(dir, 'README.md'), '# report-fixture\n');
  return dir;
}

function spawnCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('buildReport — evidence payload shape', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns tool/project/guard/findings/score/alcoa/fixHistory/integrity', () => {
    dir = makeFixture();
    const r = buildReport(dir, loadConfig(dir));
    assert.equal(r.tool.name, 'docguard');
    assert.match(r.tool.version, /^\d+\.\d+\.\d+/);
    assert.equal(r.project.name, 'report-fixture');
    assert.equal(typeof r.guard.passed, 'number');
    assert.equal(typeof r.guard.total, 'number');
    assert.ok(Array.isArray(r.guard.validators));
    assert.ok(r.guard.validators.length > 0);
    assert.ok(Array.isArray(r.findings));
    assert.equal(typeof r.score.score, 'number');
    assert.ok(r.score.grade);
    assert.equal(r.alcoa.total, 9, 'ALCOA+ has 9 attributes');
    assert.equal(r.alcoa.attributes.length, 9);
    assert.equal(r.fixHistory.entries, 0);
    assert.equal(r.fixHistory.lastApplied, null);
    assert.match(r.integrity, /^sha256:[a-f0-9]{64}$/);
    assert.ok(r.generatedAt);
  });

  it('groups findings by code with counts (bare fixture ⇒ structure findings)', () => {
    dir = makeFixture();
    const r = buildReport(dir, loadConfig(dir));
    assert.ok(r.findings.length > 0, 'a bare fixture must yield findings');
    for (const f of r.findings) {
      assert.equal(typeof f.code, 'string');
      assert.ok(f.count >= 1);
      assert.ok(['error', 'warn', 'info', undefined].includes(f.severity) || typeof f.severity === 'string');
    }
    // Grouped: codes are unique
    const codes = r.findings.map(f => f.code);
    assert.equal(new Set(codes).size, codes.length, 'findings must be grouped — no duplicate codes');
  });

  it('integrity is deterministic for the same tree and excludes generatedAt', async () => {
    dir = makeFixture();
    const config = loadConfig(dir);
    const r1 = buildReport(dir, config);
    await new Promise(res => setTimeout(res, 15)); // force a different timestamp
    const r2 = buildReport(dir, config);
    assert.notEqual(r1.generatedAt, r2.generatedAt, 'timestamps should differ across runs');
    assert.equal(r1.integrity, r2.integrity, 'integrity must not depend on the timestamp');
  });
});

describe('docguard report — CLI behavior', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 even when guard finds errors (evidence, not a gate)', () => {
    dir = makeFixture();
    const res = spawnCli(['report'], dir);
    assert.equal(res.status, 0, `report must always exit 0 — got ${res.status}\n${res.stderr}`);
    assert.match(res.stdout, /^# Documentation Compliance Report — report-fixture/,
      'markdown must start at byte 0 — no banner chrome before the artifact');
    assert.ok(!res.stdout.includes('['), 'no ANSI escapes in the artifact');
  });

  it('--format json emits pure parseable JSON through a pipe', () => {
    dir = makeFixture();
    const res = spawnCli(['report', '--format', 'json'], dir);
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout); // throws if any banner byte leaked
    assert.equal(parsed.project.name, 'report-fixture');
    assert.match(parsed.integrity, /^sha256:[a-f0-9]{64}$/);
  });

  it('--out writes the artifact to a file', () => {
    dir = makeFixture();
    const res = spawnCli(['report', '--format', 'json', '--out', 'evidence.json'], dir);
    assert.equal(res.status, 0);
    const file = join(dir, 'evidence.json');
    assert.ok(existsSync(file), 'evidence.json must exist');
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    assert.equal(parsed.tool.name, 'docguard');
  });

  it('markdown includes the summary, validators, ALCOA+ and integrity sections', () => {
    dir = makeFixture();
    const res = spawnCli(['report'], dir);
    assert.match(res.stdout, /## Summary/);
    assert.match(res.stdout, /## Validators/);
    assert.match(res.stdout, /## ALCOA\+ Attributes/);
    assert.match(res.stdout, /## Integrity/);
    assert.match(res.stdout, /sha256:[a-f0-9]{64}/);
  });
});
