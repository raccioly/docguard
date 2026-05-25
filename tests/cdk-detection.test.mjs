import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectCDK, hasInfrastructureHeading } from '../cli/scanners/cdk.mjs';
import { detectIaC, buildIaCWarning } from '../cli/scanners/iac.mjs';
import { globMatch, DEFAULT_IGNORE_DIRS } from '../cli/shared-ignore.mjs';

describe('CDK Detector', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-cdk-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // @req FR-009 — CDK detector returns isCDK + cdkJsonPaths + cdkPackageDirs
  // @req SC-007 — detector unit tests
  it('detects CDK when packages/cdk/cdk.json exists', () => {
    mkdirSync(join(tmpDir, 'packages/cdk'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{"app": "npx ts-node bin/app.ts"}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, true);
    assert.deepStrictEqual(result.cdkJsonPaths, ['packages/cdk/cdk.json']);
    assert.deepStrictEqual(result.cdkPackageDirs, ['packages/cdk']);
  });

  it('detects CDK when cdk.json is at project root', () => {
    writeFileSync(join(tmpDir, 'cdk.json'), '{}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, true);
    assert.deepStrictEqual(result.cdkJsonPaths, ['cdk.json']);
    assert.deepStrictEqual(result.cdkPackageDirs, ['.']);
  });

  it('returns isCDK=false when no cdk.json is present', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), '{}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, false);
    assert.deepStrictEqual(result.cdkJsonPaths, []);
    assert.deepStrictEqual(result.cdkPackageDirs, []);
  });

  it('does NOT detect cdk.json inside node_modules', () => {
    mkdirSync(join(tmpDir, 'node_modules/aws-cdk-lib'), { recursive: true });
    writeFileSync(join(tmpDir, 'node_modules/aws-cdk-lib/cdk.json'), '{}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, false);
  });

  it('does NOT detect cdk.json inside .git or cdk.out', () => {
    mkdirSync(join(tmpDir, '.git'), { recursive: true });
    writeFileSync(join(tmpDir, '.git/cdk.json'), '{}');
    mkdirSync(join(tmpDir, 'cdk.out'), { recursive: true });
    writeFileSync(join(tmpDir, 'cdk.out/cdk.json'), '{}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, false);
  });

  it('finds multiple cdk.json files across packages', () => {
    mkdirSync(join(tmpDir, 'packages/cdk-app1'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages/cdk-app2'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cdk-app1/cdk.json'), '{}');
    writeFileSync(join(tmpDir, 'packages/cdk-app2/cdk.json'), '{}');

    const result = detectCDK(tmpDir);

    assert.strictEqual(result.isCDK, true);
    assert.strictEqual(result.cdkJsonPaths.length, 2);
    assert.ok(result.cdkPackageDirs.includes('packages/cdk-app1'));
    assert.ok(result.cdkPackageDirs.includes('packages/cdk-app2'));
  });
});

describe('hasInfrastructureHeading', () => {
  it('returns true for "## Infrastructure"', () => {
    assert.strictEqual(hasInfrastructureHeading('# Title\n## Infrastructure\nbody'), true);
  });

  it('returns true for "### CDK" at any level', () => {
    assert.strictEqual(hasInfrastructureHeading('# T\n### CDK Setup\n'), true);
  });

  it('returns true for "# IaC"', () => {
    assert.strictEqual(hasInfrastructureHeading('# IaC\n'), true);
  });

  it('is case-insensitive', () => {
    assert.strictEqual(hasInfrastructureHeading('## INFRASTRUCTURE\n'), true);
    assert.strictEqual(hasInfrastructureHeading('## infrastructure (cdk)\n'), true);
  });

  it('returns false when no heading is present', () => {
    assert.strictEqual(hasInfrastructureHeading('# Title\n## Components\nText'), false);
  });

  it('returns false for empty input', () => {
    assert.strictEqual(hasInfrastructureHeading(''), false);
    assert.strictEqual(hasInfrastructureHeading(null), false);
  });

  it('does not match the word in body text (only headings)', () => {
    assert.strictEqual(
      hasInfrastructureHeading('# Title\n\nWe deploy infrastructure using CDK.\n'),
      false
    );
  });
});

describe('globMatch worktree rejection (FP-4)', () => {
  // @req FR-007 — globMatch rejects worktree paths at any depth
  // @req SC-004 — worktree copies not double-counted
  it('rejects paths under .claude/worktrees/ at any depth', () => {
    assert.strictEqual(
      globMatch('.claude/worktrees/feature-x/src/services/foo.test.ts', ['**/*.test.ts']),
      false
    );
    assert.strictEqual(
      globMatch('a/b/.claude/worktrees/branch/foo.test.ts', ['**/*.test.ts']),
      false
    );
  });

  it('rejects paths under .git/worktrees/', () => {
    assert.strictEqual(
      globMatch('.git/worktrees/wt-1/some/file.test.ts', ['**/*.test.ts']),
      false
    );
  });

  it('rejects paths under .jj/', () => {
    assert.strictEqual(
      globMatch('.jj/repo/store/foo.test.ts', ['**/*.test.ts']),
      false
    );
  });

  it('still rejects node_modules (regression)', () => {
    assert.strictEqual(
      globMatch('node_modules/zod/lib/something.test.ts', ['**/*.test.ts']),
      false
    );
  });

  it('accepts a normal path matching a pattern', () => {
    assert.strictEqual(
      globMatch('src/services/foo.test.ts', ['**/*.test.ts']),
      true
    );
  });

  it('accepts a path that just contains "worktrees" as a name part outside reject prefixes', () => {
    // Not under .claude/, .git/, or .jj/ — should NOT be rejected
    assert.strictEqual(
      globMatch('src/worktrees-utils/foo.test.ts', ['**/*.test.ts']),
      true
    );
  });
});

describe('Multi-tool IaC Detector (Terraform, Pulumi, SAM, Serverless)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-iac-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects Terraform when *.tf files exist', () => {
    mkdirSync(join(tmpDir, 'infra'), { recursive: true });
    writeFileSync(join(tmpDir, 'infra/main.tf'), 'resource "aws_s3_bucket" "x" {}');

    const result = detectIaC(tmpDir);
    const tf = result.tools.find(t => t.tool === 'terraform');
    assert.ok(tf, 'Terraform should be detected');
    assert.ok(tf.markerPaths.some(p => p.endsWith('main.tf')));
    assert.deepStrictEqual(tf.packageDirs, ['infra']);
    assert.strictEqual(tf.label, 'Terraform');
  });

  it('detects Pulumi when Pulumi.yaml exists', () => {
    mkdirSync(join(tmpDir, 'cloud'), { recursive: true });
    writeFileSync(join(tmpDir, 'cloud/Pulumi.yaml'), 'name: my-stack\nruntime: nodejs\n');

    const result = detectIaC(tmpDir);
    const pulumi = result.tools.find(t => t.tool === 'pulumi');
    assert.ok(pulumi);
    assert.deepStrictEqual(pulumi.packageDirs, ['cloud']);
  });

  it('detects SAM when template.yaml has AWS::Serverless::', () => {
    writeFileSync(join(tmpDir, 'template.yaml'),
      'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  Fn:\n    Type: AWS::Serverless::Function\n');

    const result = detectIaC(tmpDir);
    const sam = result.tools.find(t => t.tool === 'sam');
    assert.ok(sam, 'SAM should be detected via AWS::Serverless::');
  });

  it('does NOT detect SAM when template.yaml lacks AWS::Serverless::', () => {
    writeFileSync(join(tmpDir, 'template.yaml'),
      'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n  Bucket:\n    Type: AWS::S3::Bucket\n');

    const result = detectIaC(tmpDir);
    assert.strictEqual(result.tools.find(t => t.tool === 'sam'), undefined);
  });

  it('detects Serverless Framework via serverless.yml', () => {
    writeFileSync(join(tmpDir, 'serverless.yml'), 'service: my-svc\nprovider:\n  name: aws\n');

    const result = detectIaC(tmpDir);
    const sls = result.tools.find(t => t.tool === 'serverless');
    assert.ok(sls);
  });

  it('detects multiple IaC tools in the same monorepo', () => {
    mkdirSync(join(tmpDir, 'packages/cdk'), { recursive: true });
    mkdirSync(join(tmpDir, 'packages/terraform'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{}');
    writeFileSync(join(tmpDir, 'packages/terraform/main.tf'), 'resource "x" "y" {}');

    const result = detectIaC(tmpDir);
    assert.strictEqual(result.isIaC, true);
    assert.strictEqual(result.tools.length, 2);
    const toolNames = result.tools.map(t => t.tool).sort();
    assert.deepStrictEqual(toolNames, ['cdk', 'terraform']);
  });

  it('returns isIaC=false for a non-IaC project', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), '{}');

    const result = detectIaC(tmpDir);
    assert.strictEqual(result.isIaC, false);
    assert.deepStrictEqual(result.tools, []);
  });

  it('buildIaCWarning produces actionable text naming tool and location', () => {
    mkdirSync(join(tmpDir, 'packages/cdk'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{}');

    const result = detectIaC(tmpDir);
    const msg = buildIaCWarning(result.tools[0]);
    assert.ok(msg.includes('AWS CDK detected at packages/cdk/cdk.json'),
      `Warning should name tool + path, got: ${msg}`);
    assert.ok(msg.includes('Infrastructure'), 'Warning should suggest Infrastructure section');
    assert.ok(msg.includes('bin/'), 'CDK warning should mention bin/');
  });

  it('detectCDK shim still returns the legacy shape', () => {
    mkdirSync(join(tmpDir, 'packages/cdk'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cdk/cdk.json'), '{}');

    const cdk = detectCDK(tmpDir);
    assert.strictEqual(cdk.isCDK, true);
    assert.deepStrictEqual(cdk.cdkJsonPaths, ['packages/cdk/cdk.json']);
    assert.deepStrictEqual(cdk.cdkPackageDirs, ['packages/cdk']);
  });
});

describe('DEFAULT_IGNORE_DIRS shared constant', () => {
  // @req FR-008 — exported shared constant
  it('is a non-empty Set containing the canonical entries', () => {
    assert.ok(DEFAULT_IGNORE_DIRS instanceof Set);
    assert.ok(DEFAULT_IGNORE_DIRS.has('node_modules'));
    assert.ok(DEFAULT_IGNORE_DIRS.has('.git'));
    assert.ok(DEFAULT_IGNORE_DIRS.has('cdk.out'));
    assert.ok(DEFAULT_IGNORE_DIRS.has('.next'));
    assert.ok(DEFAULT_IGNORE_DIRS.has('out'));
    assert.ok(DEFAULT_IGNORE_DIRS.has('.turbo'));
  });

  // @req FR-008 — entries added in v0.11.1 follow-up per wu-whatsappinbox feedback
  it('includes Rust, Java, and SvelteKit build outputs', () => {
    assert.ok(DEFAULT_IGNORE_DIRS.has('target'), 'Rust + Java build dir');
    assert.ok(DEFAULT_IGNORE_DIRS.has('.gradle'), 'Gradle cache');
    assert.ok(DEFAULT_IGNORE_DIRS.has('.svelte-kit'), 'SvelteKit synth output');
  });
});
