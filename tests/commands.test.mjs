/**
 * SpecGuard CLI Tests — Tests all commands and flags
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dirname, '..', 'cli', 'specguard.mjs');
const run = (args, cwd) => execSync(`node ${CLI} ${args}`, {
  encoding: 'utf-8',
  cwd: cwd || join(import.meta.dirname, '..'),
  env: { ...process.env, NO_COLOR: '1' },
});

describe('specguard --help', () => {
  it('shows help text', () => {
    const output = run('--help');
    assert.match(output, /Commands:/);
    assert.match(output, /audit/);
    assert.match(output, /guard/);
    assert.match(output, /score/);
    assert.match(output, /diff/);
    assert.match(output, /generate/);
    assert.match(output, /agents/);
    assert.match(output, /hooks/);
  });

  it('shows version', () => {
    const output = run('--version');
    assert.match(output, /specguard v\d+\.\d+\.\d+/);
  });
});

describe('specguard audit', () => {
  it('runs on SpecGuard itself', () => {
    const output = run('audit');
    assert.match(output, /SpecGuard Audit/);
    assert.match(output, /Canonical Documentation/);
  });

  it('shows 100% for SpecGuard project', () => {
    const output = run('audit');
    assert.match(output, /100%/);
  });

  it('shows all categories with --verbose', () => {
    const output = run('audit --verbose');
    assert.match(output, /Implementation Documentation/);
  });
});

describe('specguard score', () => {
  it('runs and shows a score', () => {
    const output = run('score');
    assert.match(output, /CDD Maturity Score:/);
    assert.match(output, /\/100/);
  });

  it('outputs JSON with --format json', () => {
    const output = run('score --format json');
    // Output may contain banner before JSON — extract the JSON part
    const jsonStart = output.indexOf('{');
    assert.ok(jsonStart >= 0, 'Should contain JSON object');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok(typeof json.score === 'number');
    assert.ok(typeof json.grade === 'string');
    assert.ok(json.score >= 0 && json.score <= 100);
  });
});

describe('specguard diff', () => {
  it('runs without errors', () => {
    const output = run('diff');
    assert.match(output, /SpecGuard Diff/);
  });

  it('shows no false positives on SpecGuard', () => {
    const output = run('diff');
    // Should not flag template words as entities
    assert.ok(!output.includes('− metadata'));
    assert.ok(!output.includes('− tbd'));
    assert.ok(!output.includes('− fields'));
  });
});

describe('specguard init', () => {
  it('creates docs in a temp directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-'));
    try {
      const output = run(`init --dir ${tmpDir}`);
      assert.match(output, /Created/);
      assert.ok(existsSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md')));
      assert.ok(existsSync(join(tmpDir, 'AGENTS.md')));
      assert.ok(existsSync(join(tmpDir, '.specguard.json')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('specguard generate', () => {
  it('generates docs in empty dir', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-gen-'));
    try {
      const output = run(`generate --dir ${tmpDir}`);
      assert.match(output, /Generated: 8/);
      assert.ok(existsSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md')));
      assert.ok(existsSync(join(tmpDir, 'CHANGELOG.md')));
      assert.ok(existsSync(join(tmpDir, 'DRIFT-LOG.md')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips existing files without --force', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-gen-'));
    try {
      run(`generate --dir ${tmpDir}`);
      const output = run(`generate --dir ${tmpDir}`);
      assert.match(output, /Skipped: 8/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('specguard hooks', () => {
  it('lists available hooks', () => {
    const output = run('hooks --list');
    assert.match(output, /pre-commit/);
    assert.match(output, /pre-push/);
    assert.match(output, /commit-msg/);
  });
});

describe('specguard guard', () => {
  it('runs all validators', () => {
    try {
      run('guard');
    } catch (e) {
      // guard exits with code 2 for warnings, that's OK
      const output = e.stdout || '';
      assert.match(output, /Structure/);
      assert.match(output, /Freshness/);
    }
  });
});

describe('project type detection', () => {
  it('detects SpecGuard as CLI project', () => {
    const output = run('score --format json');
    const jsonStart = output.indexOf('{');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok(json.score >= 80, `Score ${json.score} should be ≥80 for properly configured CLI project`);
  });
});

describe('specguard fix', () => {
  it('runs and shows issues or clean status', () => {
    const output = run('fix');
    // Should either show "No issues" or show issue list
    assert.ok(output.includes('Fix') || output.includes('issues') || output.includes('No issues'));
  });

  it('outputs JSON with --format json', () => {
    const output = run('fix --format json');
    const jsonStart = output.indexOf('{');
    assert.ok(jsonStart >= 0, 'Should contain JSON object');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok(typeof json.status === 'string');
    assert.ok(typeof json.issueCount === 'number' || json.status === 'clean');
  });

  it('generates doc prompt with --doc architecture', () => {
    const output = run('fix --doc architecture');
    assert.match(output, /TASK:/);
    assert.match(output, /RESEARCH STEPS:/);
    assert.match(output, /WRITE THE DOCUMENT:/);
    assert.match(output, /VALIDATION:/);
  });

  it('generates prompt for all doc types', () => {
    for (const doc of ['architecture', 'data-model', 'security', 'test-spec', 'environment']) {
      const output = run(`fix --doc ${doc}`);
      assert.match(output, /TASK:/, `fix --doc ${doc} should include TASK`);
    }
  });
});

describe('init auto-detection', () => {
  it('auto-detects CLI project type and writes config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-autodetect-'));
    try {
      // Create a package.json with bin field (CLI)
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-cli',
        bin: { 'test-cli': './cli.js' }
      }));

      run(`init --dir ${tmpDir}`);

      const config = JSON.parse(readFileSync(
        join(tmpDir, '.specguard.json'), 'utf-8'
      ));
      assert.equal(config.projectType, 'cli');
      assert.equal(config.projectTypeConfig.needsDatabase, false);
      assert.equal(config.projectTypeConfig.needsEnvVars, false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('specguard help completeness', () => {
  it('lists all 12 commands', () => {
    const output = run('--help');
    const expectedCommands = ['audit', 'init', 'guard', 'score', 'diff',
      'agents', 'generate', 'hooks', 'badge', 'ci', 'fix', 'watch'];
    for (const cmd of expectedCommands) {
      assert.match(output, new RegExp(cmd), `Help should list '${cmd}' command`);
    }
  });
});
