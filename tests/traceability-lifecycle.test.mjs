// @req docguard.adoption-workflow-integrity#FR-006
// @req docguard.adoption-workflow-integrity#SC-004
// @req docs-canonical/REQUIREMENTS.md#FR-011
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../cli/scanners/spec-registry.mjs';

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-trace-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  write(dir, 'specs/001-feature/spec.md', '# Feature\n\n**Spec ID**: `acme.feature`\n\n- **FR-001**: The system MUST eventually work.\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'spec');
  const registry = projectSpecRegistry(dir).registry;
  write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'review lifecycle');
  return dir;
}

describe('Traceability reviewed lifecycle', () => {
  it('defers TRC004 for a committed digest-current planned spec', t => {
    const dir = fixture(t);
    const result = validateTraceability(dir, { requiredFiles: { canonical: [] } });
    assert.ok(!result.findings.some(finding => finding.code === 'TRC004'));
    assert.deepEqual(result.requirementCoverage, {
      discovered: 1, applicable: 0, traced: 0, missing: 0, deferred: 1, lifecycleUnknown: 0,
    });
  });

  it('fails closed when the spec changed after lifecycle review', t => {
    const dir = fixture(t);
    const specPath = join(dir, 'specs/001-feature/spec.md');
    writeFileSync(specPath, `${readFileSync(specPath, 'utf8')}\nChanged after review.\n`);
    const result = validateTraceability(dir, { requiredFiles: { canonical: [] } });
    assert.ok(result.findings.some(finding => finding.code === 'TRC004'));
    assert.equal(result.requirementCoverage.deferred, 0);
    assert.equal(result.requirementCoverage.lifecycleUnknown, 1);
  });

  it('requires traceability once reviewed delivery is in progress', t => {
    const dir = fixture(t);
    const registryPath = join(dir, SPEC_REGISTRY_PATH);
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.specs[0].reviewed.lifecycle.approval = 'approved';
    registry.specs[0].reviewed.lifecycle.delivery = 'in_progress';
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, 'add', SPEC_REGISTRY_PATH);
    git(dir, 'commit', '-qm', 'start implementation');
    const result = validateTraceability(dir, { requiredFiles: { canonical: [] } });
    assert.ok(result.findings.some(finding => finding.code === 'TRC004'));
    assert.equal(result.requirementCoverage.applicable, 1);
  });
});
