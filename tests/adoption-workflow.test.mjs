/**
 * Release-gating replay of the adopter journey that exposed the v0.40.5 bugs.
 * The source tree is insufficient evidence: this test uses the npm tarball,
 * starts from an existing partially configured repository, follows the CLI's
 * remediation, and verifies the resulting state.
 *
 * @req docguard.adoption-workflow-integrity#FR-001
 * @req docguard.adoption-workflow-integrity#FR-002
 * @req docguard.adoption-workflow-integrity#FR-003
 * @req docguard.adoption-workflow-integrity#FR-012
 * @req docguard.adoption-workflow-integrity#SC-001
 * @req docguard.adoption-workflow-integrity#SC-006
 * @req docs-canonical/REQUIREMENTS.md#FR-008
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const run = (args, cwd) => spawnSync(process.execPath, args, {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});

describe('packed adopter workflow', () => {
  let root;
  let cli;
  let project;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'docguard-adoption-'));
    const packDir = join(root, 'pack');
    const extractDir = join(root, 'extract');
    project = join(root, 'project');
    mkdirSync(packDir);
    mkdirSync(extractDir);
    mkdirSync(project);
    const packed = spawnSync('npm', ['pack', '--pack-destination', packDir], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = readdirSync(packDir).find(name => name.endsWith('.tgz'));
    const extracted = spawnSync('tar', ['xzf', join(packDir, tarball), '-C', extractDir], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    cli = join(extractDir, 'package/cli/docguard.mjs');

    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'adopter-project', version: '1.0.0' }));
    writeFileSync(join(project, '.docguard.json'), JSON.stringify({
      version: '0.6', projectName: 'adopter-project', profile: 'starter',
      requiredFiles: { canonical: [] },
      validators: { specRegistry: true },
    }));
    mkdirSync(join(project, 'specs/001-existing'), { recursive: true });
    writeFileSync(join(project, 'specs/001-existing/spec.md'), '# Existing feature\n\n## Requirements\n\n- **FR-001**: It works.\n');
    spawnSync('git', ['init', '-q'], { cwd: project });
    mkdirSync(join(project, '.git/hooks'), { recursive: true });
    writeFileSync(join(project, '.git/hooks/pre-commit'), '#!/bin/sh\nnpm test\n');
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('inspects a foreign hook through nested init without mutating the project', () => {
    const result = run([cli, 'init', '--with', 'hooks', '--list', '--dir', project], project);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /existing non-DocGuard/i);
    assert.doesNotMatch(result.stdout, /pre-commit.*installed/i);
    assert.equal(readFileSync(join(project, '.git/hooks/pre-commit'), 'utf8'), '#!/bin/sh\nnpm test\n');
    assert.equal(existsSync(join(project, 'docs-canonical')), false, 'read-only hook inventory must not initialize docs');
    assert.equal(existsSync(join(project, '.agent')), false, 'read-only hook inventory must not install agent assets');
  });

  it('renders every finding remediation without undefined text', () => {
    const jsonResult = run([cli, 'guard', '--format', 'json', '--dir', project], project);
    assert.ok([0, 1, 2].includes(jsonResult.status), jsonResult.stderr);
    const data = JSON.parse(jsonResult.stdout);
    assert.ok(data.findings.length > 0, 'fixture must produce at least one finding');
    for (const finding of data.findings) {
      assert.ok(finding.suggestion === null || (
        typeof finding.suggestion.text === 'string' && finding.suggestion.text.trim().length > 0
      ), `${finding.code} emitted an invalid suggestion`);
    }

    const textResult = run([cli, 'guard', '--show-failing', '--dir', project], project);
    assert.ok([0, 1, 2].includes(textResult.status), textResult.stderr);
    assert.doesNotMatch(textResult.stdout, /→\s+undefined|Watch — undefined/);
  });

  it('offers an achievable missing-ID remediation and verifies it end to end', () => {
    const guard = JSON.parse(run([cli, 'guard', '--format', 'json', '--dir', project], project).stdout);
    const missingId = guard.findings.find(finding => finding.code === 'SPR002');
    assert.ok(missingId, 'fixture must expose SPR002');
    assert.equal(missingId.suggestion.command, undefined, 'missing metadata cannot be repaired by specs --write alone');
    assert.match(missingId.suggestion.text, /\*\*Spec ID\*\*/);

    const specPath = join(project, 'specs/001-existing/spec.md');
    const current = readFileSync(specPath, 'utf8');
    writeFileSync(specPath, current.replace('# Existing feature', '# Existing feature\n\n**Spec ID**: `adopter.existing`'));
    const write = run([cli, 'specs', '--write', '--format', 'json', '--dir', project], project);
    assert.equal(write.status, 0, write.stderr);
    assert.equal(JSON.parse(write.stdout).status, 'WRITTEN');
    const check = run([cli, 'specs', '--check', '--format', 'json', '--dir', project], project);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).status, 'CURRENT');
  });
});
