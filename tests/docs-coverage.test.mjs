import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';

describe('Docs-Coverage Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default zeroed object if no docs are found', () => {
    const result = validateDocsCoverage(tmpDir, {});
    assert.deepEqual(result, { errors: [], warnings: [], passed: 0, total: 0 });
  });

  it('Check 1: Project-specific config/dotfiles', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));

    // Warns if config is not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    writeFileSync(join(tmpDir, 'jest.config.js'), 'export default {}');

    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('jest.config.js')), true);

    // Passes if config is mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Uses jest.config.js');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('jest.config.js')), false);
  });

  it('Check 2: package.json bins', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ bin: { "my-cli": "./index.js" } }));

    // Warns if bin not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('my-cli')), true);

    // Passes if bin mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Run my-cli tool');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('my-cli')), false);
  });

  it('Check 3: Source Directories', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    mkdirSync(join(tmpDir, 'src'));
    mkdirSync(join(tmpDir, 'src', 'components'));

    // Warns if source dir not mentioned in ARCHITECTURE.md
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('src/components/')), true);

    // Passes if source dir mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'The src/components dir');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('src/components/')), false);
  });

  it('Check 4: Code Referenced Configs', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'));
    mkdirSync(join(tmpDir, 'src'));
    // The regex expects the config to be the first/only string argument matching the pattern
    // or capturing the last one if there are multiple.
    writeFileSync(join(tmpDir, 'src', 'index.js'), "readFileSync('.customrc');");

    // Warns if config not mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('.customrc')), true);

    // Passes if config mentioned
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Configures with .customrc');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('.customrc')), false);
  });

  it('Check 5: README sections completeness', () => {
    // Warns about missing sections
    writeFileSync(join(tmpDir, 'README.md'), '# Project Title\n\nSome text');
    let result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('Installation')), true);
    assert.equal(result.warnings.some(w => w.includes('Usage')), true);
    assert.equal(result.warnings.some(w => w.includes('License')), true);

    // Passes if sections are present
    writeFileSync(join(tmpDir, 'README.md'), '# Title\n\n## Installation\n\n## Usage\n\n## License');
    result = validateDocsCoverage(tmpDir, {});
    assert.equal(result.warnings.some(w => w.includes('Installation')), false);
    assert.equal(result.warnings.some(w => w.includes('Usage')), false);
    assert.equal(result.warnings.some(w => w.includes('License')), false);
  });

  // ── v0.11.1 regressions: FP-3, FP-4, FP-5 (CDK) ─────────────────────────

  describe('FP-3: build outputs and config.ignore', () => {
    // @req FR-005 — IGNORE_DIRS additions (cdk.out, out, .nuxt, .claude)
    // @req SC-003 — cdk.out not flagged
    it('does not flag cdk.out/ as undocumented source', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Architecture content');
      // CDK synth output (gitignored generated cloudformation)
      mkdirSync(join(tmpDir, 'packages/cdk/cdk.out'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages/cdk/cdk.out/Foo.template.json'), '{}');
      // Also: out/ and .nuxt/ should be ignored
      mkdirSync(join(tmpDir, 'out'), { recursive: true });
      mkdirSync(join(tmpDir, '.nuxt'), { recursive: true });

      const result = validateDocsCoverage(tmpDir, {});

      assert.equal(result.warnings.some(w => w.includes('cdk.out')), false,
        `cdk.out should be ignored, got: ${JSON.stringify(result.warnings)}`);
      assert.equal(result.warnings.some(w => /\/out\//.test(w) || /"out\/"/.test(w)), false);
      assert.equal(result.warnings.some(w => w.includes('.nuxt')), false);
    });

    // @req FR-015 — config.ignore honored in checkConfigFiles (Check 1)
    // @req SC-009 — .local in ignore is suppressed by Check 1
    // Reproduces the wu-whatsappinbox v0.11.0 case: `.local` in ignore but
    // still flagged as "Config file '.local' not mentioned".
    it('honors config.ignore for Check 1 dotfile scan', () => {
      writeFileSync(join(tmpDir, 'README.md'), '# X\n## Installation\n## Usage\n## License');
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
      writeFileSync(join(tmpDir, '.local'), 'scratch state');

      // Without ignore: .local is flagged as undocumented config
      let result = validateDocsCoverage(tmpDir, {});
      assert.ok(result.warnings.some(w => w.includes('.local')),
        `Baseline: .local should be flagged without ignore, got: ${JSON.stringify(result.warnings)}`);

      // With ignore: warning suppressed
      result = validateDocsCoverage(tmpDir, { ignore: ['.local'] });
      assert.equal(result.warnings.some(w => w.includes('.local')), false,
        `config.ignore should suppress .local, got: ${JSON.stringify(result.warnings)}`);
    });

    // @req FR-006 — config.ignore honored in checkSourceDirs (closes IR-5)
    it('honors config.ignore for source-dir scan (IR-5)', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');
      mkdirSync(join(tmpDir, 'src/custom-build-output'), { recursive: true });

      // Without ignore: warning fires
      let result = validateDocsCoverage(tmpDir, {});
      assert.equal(result.warnings.some(w => w.includes('custom-build-output')), true);

      // With ignore: warning suppressed
      result = validateDocsCoverage(tmpDir, { ignore: ['**/custom-build-output/**'] });
      assert.equal(result.warnings.some(w => w.includes('custom-build-output')), false,
        `config.ignore should suppress custom-build-output, got: ${JSON.stringify(result.warnings)}`);
    });
  });

  describe('FP-5: CDK-aware documentation', () => {
    // @req FR-010 — single consolidated CDK warning
    // @req SC-005 — exactly one CDK-specific warning, not multiple
    it('emits ONE consolidated warning when CDK detected and no Infrastructure section', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
        '# Architecture\n## Component Map\nFoo bar baz\n');
      // CDK package
      mkdirSync(join(tmpDir, 'packages/cdk/bin'), { recursive: true });
      mkdirSync(join(tmpDir, 'packages/cdk/lib/stacks'), { recursive: true });
      mkdirSync(join(tmpDir, 'packages/cdk/lib/constructs'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{"app": "npx ts-node bin/app.ts"}');
      writeFileSync(join(tmpDir, 'packages/cdk/bin/app.ts'), 'new App();');
      writeFileSync(join(tmpDir, 'packages/cdk/lib/stacks/api.ts'), 'export class ApiStack {}');

      const result = validateDocsCoverage(tmpDir, {});

      const cdkWarnings = result.warnings.filter(w => w.includes('CDK detected'));
      assert.strictEqual(cdkWarnings.length, 1,
        `Expected exactly 1 CDK warning, got: ${JSON.stringify(cdkWarnings)}`);
      assert.ok(cdkWarnings[0].includes('packages/cdk/cdk.json'));
      assert.ok(cdkWarnings[0].includes('bin/'));
      assert.ok(cdkWarnings[0].includes('lib/stacks/'));
      assert.ok(cdkWarnings[0].includes('lib/constructs/'));
    });

    // @req FR-010 — no warning when Infrastructure heading present
    it('does NOT warn when ARCHITECTURE.md has an Infrastructure heading', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
        '# Architecture\n\n## Infrastructure (CDK)\n\nApp entrypoint: packages/cdk/bin/app.ts\nStacks: packages/cdk/lib/stacks/\n');
      mkdirSync(join(tmpDir, 'packages/cdk/bin'), { recursive: true });
      mkdirSync(join(tmpDir, 'packages/cdk/lib'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{}');

      const result = validateDocsCoverage(tmpDir, {});

      assert.equal(result.warnings.some(w => w.includes('CDK detected')), false,
        `No CDK warning when Infrastructure section present, got: ${JSON.stringify(result.warnings)}`);
    });

    // @req FR-011 — per-dir warning suppression inside CDK packages
    it('suppresses generic per-dir warnings inside CDK package when Infra missing', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
        '# Architecture\n\nNo infrastructure section here\n');
      // Use `cdk` as a workspace package so resolveSourceRoots scans into it
      // and would normally emit per-dir warnings for bin/ and lib/.
      writeFileSync(join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }));
      mkdirSync(join(tmpDir, 'packages/cdk/bin'), { recursive: true });
      mkdirSync(join(tmpDir, 'packages/cdk/lib'), { recursive: true });
      writeFileSync(join(tmpDir, 'packages/cdk/package.json'),
        JSON.stringify({ name: 'cdk' }));
      writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{}');

      const result = validateDocsCoverage(tmpDir, {});

      // Per-dir warnings have the shape `Source directory "..."`.
      // The consolidated CDK warning starts with `CDK detected at ...`.
      // Filter to only per-dir warnings before asserting suppression.
      const perDirWarnings = result.warnings.filter(w => w.startsWith('Source directory'));
      const binWarnings = perDirWarnings.filter(w => /\bbin\//.test(w));
      const libWarnings = perDirWarnings.filter(w => /\blib\//.test(w));
      assert.strictEqual(binWarnings.length, 0,
        `bin/ inside CDK package should be suppressed, got: ${JSON.stringify(binWarnings)}`);
      assert.strictEqual(libWarnings.length, 0,
        `lib/ inside CDK package should be suppressed, got: ${JSON.stringify(libWarnings)}`);

      // The consolidated IaC warning for CDK should still fire
      assert.strictEqual(
        result.warnings.filter(w => /\bCDK detected\b/.test(w)).length, 1,
        `Expected 1 IaC CDK warning, got: ${JSON.stringify(result.warnings)}`
      );
    });

    // @req FR-009 — detector inactive without cdk.json
    it('does NOT activate CDK detector on projects without cdk.json', () => {
      mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
      // Non-CDK project with a legitimate bin/ (CLI tool)
      mkdirSync(join(tmpDir, 'src/bin'), { recursive: true });

      const result = validateDocsCoverage(tmpDir, {});

      assert.equal(result.warnings.some(w => w.includes('CDK detected')), false);
      // Regular per-dir warning for bin/ still fires (correct — it's a real gap)
      assert.equal(result.warnings.some(w => /src\/bin\//.test(w)), true,
        `Non-CDK bin/ should still produce per-dir warning, got: ${JSON.stringify(result.warnings)}`);
    });
  });
});
