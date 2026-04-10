/**
 * DocGuard CLI Tests — Tests all commands and flags
 * Run with: npm test
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');
const run = (args, cwd) => execSync(`node ${CLI} ${args}`, {
  encoding: 'utf-8',
  cwd: cwd || join(__dirname, '..'),
  env: { ...process.env, NO_COLOR: '1' },
});

describe('docguard --help', () => {
  it('shows help text', () => {
    const output = run('--help');
    assert.match(output, /Getting Started:/);
    assert.match(output, /Enforcement:/);
    assert.match(output, /guard/);
    assert.match(output, /score/);
    assert.match(output, /diff/);
    assert.match(output, /generate/);
    assert.match(output, /agents/);
    assert.match(output, /hooks/);
  });

  it('shows version', () => {
    const output = run('--version');
    assert.match(output, /docguard v\d+\.\d+\.\d+/);
  });
});

describe('docguard audit', () => {
  it('runs on DocGuard itself', () => {
    try {
      const output = run('audit');
      assert.match(output, /DocGuard Guard/);
    } catch (e) {
      // audit aliases to guard, which may exit with code 2 for warnings
      const output = e.stdout || '';
      assert.match(output, /DocGuard Guard/);
    }
  });

  it('runs validators like guard does', () => {
    try {
      const output = run('audit');
      assert.match(output, /Structure/);
    } catch (e) {
      const output = e.stdout || '';
      assert.match(output, /Structure/);
    }
  });

  it('shows validator results with --verbose', () => {
    try {
      const output = run('audit --verbose');
      assert.match(output, /Structure/);
    } catch (e) {
      const output = e.stdout || '';
      assert.match(output, /Structure/);
    }
  });
});


describe('docguard badge', () => {
  it('runs and shows badges', () => {
    const output = run('badge');
    assert.match(output, /DocGuard Badge/);
    assert.match(output, /Score Badge:/);
    assert.match(output, /Type Badge:/);
    assert.match(output, /README snippet:/);
    assert.match(output, /img\.shields\.io/);
  });

  it('outputs JSON with --format json', () => {
    const output = run('badge --format json');
    const jsonStart = output.indexOf('{');
    const jsonStr = output.substring(jsonStart);
    const parsed = JSON.parse(jsonStr);
    assert.equal(typeof parsed.score, 'number');
    assert.ok(parsed.grade);
    assert.ok(parsed.color);
    assert.ok(parsed.badges);
    assert.ok(parsed.badges.score);
    assert.ok(parsed.badges.type);
    assert.ok(parsed.badges.docguard);
    assert.ok(parsed.readmeSnippet);
  });
});

describe('docguard score', () => {
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

  it('respects projectTypeConfig — CLI projects not penalized for missing .env.example', () => {
    const output = run('score --format json');
    const jsonStart = output.indexOf('{');
    const json = JSON.parse(output.slice(jsonStart));
    // DocGuard is a CLI with needsEnvExample: false — env/security should get full marks
    assert.ok(json.categories.environment.score === 100,
      `environment should be 100 for CLI (got ${json.categories.environment.score})`);
    assert.ok(json.categories.security.score === 100,
      `security should be 100 for CLI (got ${json.categories.security.score})`);
  });

  it('gives full testing score for node:test projects', () => {
    const output = run('score --format json');
    const jsonStart = output.indexOf('{');
    const json = JSON.parse(output.slice(jsonStart));
    // DocGuard uses node:test — should get full testing marks
    assert.ok(json.categories.testing.score === 100,
      `testing should be 100 for node:test project (got ${json.categories.testing.score})`);
  });

  it('shows badge snippet', () => {
    const output = run('score');
    assert.match(output, /Badge:.*CDD_Score/);
  });
});

describe('docguard diff', () => {
  it('runs without errors', () => {
    const output = run('diff');
    assert.match(output, /DocGuard Diff/);
  });

  it('shows no false positives on DocGuard', () => {
    const output = run('diff');
    // Should not flag template words as entities
    assert.ok(!output.includes('− metadata'));
    assert.ok(!output.includes('− tbd'));
    assert.ok(!output.includes('− fields'));
  });
});

describe('docguard init', () => {
  it('creates docs in a temp directory', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-'));
    try {
      const output = run(`init --dir ${tmpDir} --force`);
      assert.match(output, /Created/);
      assert.ok(existsSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md')));
      assert.ok(existsSync(join(tmpDir, 'AGENTS.md')));
      assert.ok(existsSync(join(tmpDir, '.docguard.json')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('docguard generate', () => {
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

describe('docguard hooks', () => {
  it('lists available hooks', () => {
    const output = run('hooks --list');
    assert.match(output, /pre-commit/);
    assert.match(output, /pre-push/);
    assert.match(output, /commit-msg/);
  });
});

describe('docguard guard', () => {
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
  it('detects DocGuard as CLI project', () => {
    const output = run('score --format json');
    const jsonStart = output.indexOf('{');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok(json.score >= 80, `Score ${json.score} should be ≥80 for properly configured CLI project`);
  });
});

describe('docguard fix', () => {
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

      run(`init --dir ${tmpDir} --force`);

      const config = JSON.parse(readFileSync(
        join(tmpDir, '.docguard.json'), 'utf-8'
      ));
      assert.equal(config.projectType, 'cli');
      assert.equal(config.projectTypeConfig.needsDatabase, false);
      assert.equal(config.projectTypeConfig.needsEnvVars, false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('docguard help completeness', () => {
  it('lists all major commands', () => {
    const output = run('--help');
    const expectedCommands = ['init', 'guard', 'score', 'diff',
      'agents', 'generate', 'hooks', 'badge', 'ci', 'fix', 'watch', 'diagnose'];
    for (const cmd of expectedCommands) {
      assert.match(output, new RegExp(cmd), `Help should list '${cmd}' command`);
    }
  });

  it('shows profile options in help', () => {
    const output = run('--help');
    assert.match(output, /starter/);
    assert.match(output, /standard/);
    assert.match(output, /enterprise/);
    assert.match(output, /--profile/);
    assert.match(output, /--tax/);
  });
});

describe('compliance profiles', () => {
  it('starter profile creates minimal files', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-starter-'));
    try {
      run(`init --dir ${tmpDir} --profile starter --force`);

      // Should create ARCHITECTURE.md but NOT DATA-MODEL.md
      assert.ok(existsSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md')));
      assert.ok(!existsSync(join(tmpDir, 'docs-canonical', 'DATA-MODEL.md')));
      assert.ok(!existsSync(join(tmpDir, 'docs-canonical', 'SECURITY.md')));
      assert.ok(!existsSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md')));

      // Config should have starter profile
      const config = JSON.parse(readFileSync(join(tmpDir, '.docguard.json'), 'utf-8'));
      assert.equal(config.profile, 'starter');
      assert.equal(config.validators.freshness, false);
      assert.equal(config.validators.testSpec, false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('score --tax', () => {
  it('shows doc tax estimate', () => {
    const output = run('score --tax');
    assert.match(output, /Documentation Tax Estimate/);
    assert.match(output, /Tracked docs/);
    assert.match(output, /Est\. maintenance/);
    assert.match(output, /Tax-to-value ratio/);
  });
});

describe('docguard diagnose', () => {
  it('outputs remediation plan', () => {
    const output = run('diagnose');
    assert.match(output, /Diagnose/);
    // Should have either "All clear" or remediation/diagnostic content
    assert.ok(output.includes('Remediation') || output.includes('All clear') || output.includes('Warnings') || output.includes('AI-Ready Prompt'));
  });

  it('outputs valid JSON with --format json', () => {
    const output = run('diagnose --format json');
    // Extract JSON from output (skip banner)
    const jsonStart = output.indexOf('{');
    assert.ok(jsonStart >= 0, 'Should contain JSON');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok('issues' in json);
    assert.ok('fixCommands' in json);
    assert.ok('score' in json);
  });
});

describe('guard --format json', () => {
  it('outputs valid JSON', () => {
    let output;
    try {
      output = run('guard --format json');
    } catch (e) {
      output = e.stdout || '';
    }
    const jsonStart = output.indexOf('{');
    assert.ok(jsonStart >= 0, 'Should contain JSON');
    const json = JSON.parse(output.slice(jsonStart));
    assert.ok('validators' in json);
    assert.ok('status' in json);
    assert.ok('profile' in json);
  });

  it('shows diagnose hint on warnings', () => {
    try {
      run('guard');
    } catch (e) {
      const output = e.stdout || '';
      if (output.includes('WARN') || output.includes('FAIL')) {
        assert.match(output, /diagnose/);
      }
    }
  });
});

describe('help completeness v0.5', () => {
  it('lists diagnose command', () => {
    const output = run('--help');
    assert.match(output, /diagnose/);
    assert.match(output, /AI orchestrator/);
  });

  it('shows current version from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    const output = run('--version');
    assert.ok(output.includes(pkg.version), `Expected version ${pkg.version} in output: ${output}`);
  });
});

// ── New tests for v0.9.9 bug fixes ──────────────────────────────────────────

describe('shared ignore utility', () => {
  it('buildIgnoreFilter matches exact paths', async () => {
    const { buildIgnoreFilter } = await import('../cli/shared-ignore.mjs');
    const filter = buildIgnoreFilter(['src/foo.ts', 'backend/test.js']);
    assert.ok(filter('src/foo.ts'), 'Should match exact path');
    assert.ok(filter('backend/test.js'), 'Should match exact path');
    assert.ok(!filter('src/bar.ts'), 'Should not match different file');
  });

  it('buildIgnoreFilter matches glob patterns', async () => {
    const { buildIgnoreFilter } = await import('../cli/shared-ignore.mjs');
    const filter = buildIgnoreFilter(['packages/cdk/**', 'backend/src/__tests__/**']);
    assert.ok(filter('packages/cdk/lib/stacks/app-stack.ts'), 'Should match ** glob');
    assert.ok(filter('backend/src/__tests__/schemaContracts.test.ts'), 'Should match ** glob');
    assert.ok(!filter('backend/src/services/auth.ts'), 'Should not match non-test file');
  });

  it('shouldIgnore checks both global and validator-specific ignore', async () => {
    const { shouldIgnore } = await import('../cli/shared-ignore.mjs');
    const config = {
      ignore: ['example_settlement'],
      securityIgnore: ['backend/src/__tests__/**'],
    };
    assert.ok(shouldIgnore('example_settlement/foo.ts', config), 'Global ignore should work');
    assert.ok(shouldIgnore('backend/src/__tests__/foo.test.ts', config, 'securityIgnore'), 'Validator-specific ignore should work');
    assert.ok(!shouldIgnore('backend/src/services/auth.ts', config, 'securityIgnore'), 'Non-ignored file should pass');
  });

  it('empty patterns return false', async () => {
    const { buildIgnoreFilter } = await import('../cli/shared-ignore.mjs');
    const filter = buildIgnoreFilter([]);
    assert.ok(!filter('any/file.ts'), 'Empty patterns should not match anything');
  });
});

describe('securityIgnore config', () => {
  it('security validator respects securityIgnore', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-sec-'));
    try {
      // Create a file with a fake secret
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(join(tmpDir, 'src', 'config.ts'), 'const apiKey = "sk-live-abcdefghijklmnopqrstuvwxyz123456";');

      // Create .docguard.json with securityIgnore
      writeFileSync(join(tmpDir, '.docguard.json'), JSON.stringify({
        profile: 'enterprise',
        securityIgnore: ['src/config.ts'],
        validators: { security: true },
      }));

      // Create minimal required files
      writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'SECURITY.md'), '# Security\n## Authentication\n## Secrets Management\n');

      let output;
      try {
        output = run(`guard --dir ${tmpDir} --format json`);
      } catch (e) {
        output = e.stdout || '';
      }
      const jsonStart = output.indexOf('{');
      if (jsonStart >= 0) {
        const json = JSON.parse(output.slice(jsonStart));
        const secValidator = json.validators?.find(v => v.key === 'security');
        if (secValidator) {
          assert.equal(secValidator.errors.length, 0,
            `securityIgnore should suppress findings, but got: ${JSON.stringify(secValidator.errors)}`);
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('placeholder exclusions', () => {
  it('does not flag AWS example keys', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sg-placeholder-'));
    try {
      mkdirSync(join(tmpDir, 'src'), { recursive: true });
      writeFileSync(join(tmpDir, 'src', 'form.tsx'),
        'const placeholder = "AKIAIOSFODNN7EXAMPLE";\n');
      writeFileSync(join(tmpDir, '.gitignore'), '.env\n');
      writeFileSync(join(tmpDir, '.docguard.json'), JSON.stringify({
        profile: 'enterprise',
        validators: { security: true },
      }));
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'SECURITY.md'), '# Security\n## Authentication\n## Secrets Management\n');

      let output;
      try {
        output = run(`guard --dir ${tmpDir} --format json`);
      } catch (e) {
        output = e.stdout || '';
      }
      const jsonStart = output.indexOf('{');
      if (jsonStart >= 0) {
        const json = JSON.parse(output.slice(jsonStart));
        const secValidator = json.validators?.find(v => v.key === 'security');
        if (secValidator) {
          const awsFindings = secValidator.errors.filter(e => e.includes('AWS'));
          assert.equal(awsFindings.length, 0,
            `AKIAIOSFODNN7EXAMPLE should not be flagged, but got: ${JSON.stringify(awsFindings)}`);
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('testPatterns config', () => {
  it('score recognizes testPatterns in config', () => {
    const output = run('score --format json');
    const jsonStart = output.indexOf('{');
    const json = JSON.parse(output.slice(jsonStart));
    // DocGuard has a tests/ dir so testing should get full marks
    assert.ok(json.categories.testing.score >= 85,
      `Testing score should be >= 85 (got ${json.categories.testing.score})`);
  });
});

describe('globMatch — positive pattern matching with node_modules exclusion', () => {
  // Import globMatch dynamically
  let globMatch;

  it('loads globMatch from shared-ignore.mjs', async () => {
    const mod = await import(join(__dirname, '..', 'cli', 'shared-ignore.mjs'));
    globMatch = mod.globMatch;
    assert.ok(typeof globMatch === 'function', 'globMatch should be a function');
  });

  it('rejects paths containing node_modules at root', async () => {
    if (!globMatch) {
      const mod = await import(join(__dirname, '..', 'cli', 'shared-ignore.mjs'));
      globMatch = mod.globMatch;
    }
    const patterns = ['**/__tests__/**/*.test.ts'];
    assert.equal(globMatch('node_modules/zod/__tests__/foo.test.ts', patterns), false,
      'Should reject root-level node_modules');
  });

  it('rejects paths containing node_modules at any depth', async () => {
    if (!globMatch) {
      const mod = await import(join(__dirname, '..', 'cli', 'shared-ignore.mjs'));
      globMatch = mod.globMatch;
    }
    const patterns = ['backend/**/__tests__/**/*.test.ts'];
    assert.equal(globMatch('backend/node_modules/zod/__tests__/string.test.ts', patterns), false,
      'Should reject nested node_modules');
    assert.equal(globMatch('packages/foo/node_modules/bar/__tests__/baz.test.ts', patterns), false,
      'Should reject deeply nested node_modules');
  });

  it('matches valid test paths', async () => {
    if (!globMatch) {
      const mod = await import(join(__dirname, '..', 'cli', 'shared-ignore.mjs'));
      globMatch = mod.globMatch;
    }
    const patterns = ['backend/**/__tests__/**/*.test.ts'];
    assert.equal(globMatch('backend/src/__tests__/auth.test.ts', patterns), true,
      'Should match valid test file');
    assert.equal(globMatch('backend/src/controllers/__tests__/admin.test.ts', patterns), true,
      'Should match deeply nested test file');
  });

  it('handles multiple patterns', async () => {
    if (!globMatch) {
      const mod = await import(join(__dirname, '..', 'cli', 'shared-ignore.mjs'));
      globMatch = mod.globMatch;
    }
    const patterns = [
      'backend/**/__tests__/**/*.test.ts',
      'e2e/**/*.spec.ts',
    ];
    assert.equal(globMatch('backend/src/__tests__/auth.test.ts', patterns), true,
      'Should match first pattern');
    assert.equal(globMatch('e2e/login.spec.ts', patterns), true,
      'Should match second pattern');
    assert.equal(globMatch('frontend/src/app.ts', patterns), false,
      'Should not match unrelated file');
  });
});

describe('CI detection expansion', () => {
  it('score detects buildspec.yml as CI config', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-ci-'));
    try {
      // Create minimal project structure
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-ci', version: '1.0.0',
        scripts: { test: 'vitest' },
      }));
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical/TEST-SPEC.md'), '# Test Spec\n');
      writeFileSync(join(tmpDir, 'buildspec.yml'), 'version: 0.2\nphases:\n  build:\n    commands:\n      - npm test\n');
      mkdirSync(join(tmpDir, 'tests'), { recursive: true });
      writeFileSync(join(tmpDir, 'tests/sample.test.js'), 'test("ok", () => {});\n');
      writeFileSync(join(tmpDir, 'vitest.config.ts'), 'export default {};\n');

      const output = execSync(`node "${CLI}" score --format json`, {
        cwd: tmpDir, encoding: 'utf-8', timeout: 15000,
      });
      const jsonStart = output.indexOf('{');
      if (jsonStart >= 0) {
        const json = JSON.parse(output.slice(jsonStart));
        // With buildspec.yml, the testing CI check should award full 15 points
        // testing score: tests exist (40) + TEST-SPEC.md (30) + vitest config (15) + CI (15) = 100
        assert.ok(json.categories.testing.score >= 85,
          `Testing score with buildspec.yml should be >= 85 (got ${json.categories.testing.score})`);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
