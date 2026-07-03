import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8' });
}

describe('llms --full and memory --pack (v0.29)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-llmsfull-'));
    writeFileSync(join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'llms-fixture', version: '1.0.0', description: 'Fixture for llms tests' }));
    writeFileSync(join(tmpDir, '.docguard.json'),
      JSON.stringify({ profile: 'starter', projectName: 'llms-fixture' }));
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
      '# Architecture\n<!-- docguard:last-reviewed 2026-07-01 -->\n\nA tiny fixture architecture.\n\n## Components\n\n- cli\n');
    writeFileSync(join(tmpDir, 'docs-canonical', 'SECURITY.md'),
      '# Security\n\nNo secrets in the fixture.\n');
    writeFileSync(join(tmpDir, 'AGENTS.md'),
      '# Agent Instructions\n\n## Workflow\n\n1. Read docs\n2. Run guard\n\n## Rules\n\n- Never commit without CHANGELOG\n\n## Unrelated\n\nnot extracted\n');
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('llms --full writes llms-full.txt inlining every canonical doc', () => {
    const res = run(['llms', '--full'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    const out = readFileSync(join(tmpDir, 'llms-full.txt'), 'utf-8');
    assert.ok(out.includes('## docs-canonical/ARCHITECTURE.md'));
    assert.ok(out.includes('A tiny fixture architecture.'), 'doc body must be inlined');
    assert.ok(out.includes('## docs-canonical/SECURITY.md'));
    assert.ok(out.includes('No secrets in the fixture.'));
    assert.ok(out.includes('llms.txt is the index form') || out.includes('link-index form'),
      'must reference the index form');
  });

  it('llms --full caps a runaway doc at 400 lines with a truncation note', () => {
    writeFileSync(join(tmpDir, 'docs-canonical', 'HUGE.md'),
      '# Huge\n' + Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n'));
    const res = run(['llms', '--full'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    const out = readFileSync(join(tmpDir, 'llms-full.txt'), 'utf-8');
    assert.ok(out.includes('truncated:'), 'truncation note expected');
    assert.ok(out.includes('read docs-canonical/HUGE.md directly'));
    assert.ok(!out.includes('line 590'), 'content past the cap must not appear');
  });

  it('llms --full --stdout prints instead of writing', () => {
    const res = run(['llms', '--full', '--stdout'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('## docs-canonical/ARCHITECTURE.md'));
    assert.ok(!existsSync(join(tmpDir, 'llms-full.txt')));
  });

  it('plain llms still writes the index form (regression)', () => {
    const res = run(['llms'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    const out = readFileSync(join(tmpDir, 'llms.txt'), 'utf-8');
    assert.ok(out.includes('- [ARCHITECTURE](docs-canonical/ARCHITECTURE.md)'), 'index form links, not inlines');
    assert.ok(!out.includes('A tiny fixture architecture.'), 'index form must not inline bodies');
  });

  it('memory --pack writes .docguard/context-pack.md with surface counts + rules extract', () => {
    const res = run(['memory', '--pack'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    const pack = readFileSync(join(tmpDir, '.docguard', 'context-pack.md'), 'utf-8');
    assert.ok(pack.includes('# Context Pack — llms-fixture'));
    assert.ok(/\*\*Guard:\*\* (PASS|WARN|FAIL)/.test(pack), 'guard status line expected');
    assert.ok(pack.includes('## Code-truth surface'));
    assert.ok(/Tests: \d+ files, \d+ cases/.test(pack));
    assert.ok(pack.includes('docs-canonical/ARCHITECTURE.md (last-reviewed 2026-07-01)'));
    assert.ok(pack.includes('## Project rules (from AGENTS.md)'));
    assert.ok(pack.includes('Never commit without CHANGELOG'));
    assert.ok(!pack.includes('not extracted'), 'non-rules H2 sections must not be extracted');
    assert.ok(pack.includes('verify --semantic'));
  });

  it('memory --pack --stdout prints instead of writing', () => {
    const res = run(['memory', '--pack', '--stdout'], tmpDir);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('# Context Pack — llms-fixture'));
    assert.ok(!existsSync(join(tmpDir, '.docguard', 'context-pack.md')));
  });
});
