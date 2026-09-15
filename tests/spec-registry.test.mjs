import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * @req docguard.document-lifecycle#FR-013
 * @req docguard.document-lifecycle#FR-012
 * @req docguard.document-lifecycle#FR-014
 * @req docguard.document-lifecycle#FR-015
 * @req docguard.document-lifecycle#SC-007
 */

import {
  parseSpecId,
  preflightSpec,
  projectSpecRegistry,
  SPEC_REGISTRY_PATH,
} from '../cli/scanners/spec-registry.mjs';
import { validateSpecRegistry } from '../cli/validators/spec-registry.mjs';

const CLI = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

function write(dir, path, content) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-spec-registry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) write(dir, path, content);
  return dir;
}

const spec = (id, requirement = 'FR-001') => `# Feature\n\n**Spec ID**: \`${id}\`\n\n## Requirements\n\n- **${requirement}**: The system MUST work.\n`;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, 'specs', '--dir', dir, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('Spec registry projection', () => {
  it('parses explicit metadata and ignores ordinary prose', () => {
    assert.equal(parseSpecId('**Spec ID**: `acme.billing-v2`\n'), 'acme.billing-v2');
    assert.equal(parseSpecId('<!-- docguard:spec-id acme.billing-v2 -->\n'), 'acme.billing-v2');
    assert.equal(parseSpecId('This document discusses Spec ID: fake.\n'), null);
  });

  it('fails closed when an active spec lacks an immutable ID', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': '# Feature\n\n- **FR-001**: Work.\n' });
    const projection = projectSpecRegistry(dir);
    assert.equal(projection.registry.specs.length, 0);
    assert.equal(projection.issues[0].code, 'SPR002');
    const finding = validateSpecRegistry(dir).findings.find(item => item.code === 'SPR002');
    assert.match(finding.suggestion.text, /\*\*Spec ID\*\*/);
    assert.equal(finding.suggestion.command, undefined,
      'specs --write cannot invent the immutable ID required by SPR002');
  });

  it('rejects duplicate spec IDs across active specs', t => {
    const dir = fixture(t, {
      'specs/001-feature/spec.md': spec('acme.feature'),
      'specs/002-feature/spec.md': spec('acme.feature'),
    });
    const projection = projectSpecRegistry(dir);
    assert.equal(projection.registry.specs.length, 1);
    assert.ok(projection.issues.some(issue => issue.code === 'SPR002' && /already declared/.test(issue.message)));
  });

  it('preserves reviewed fields while deterministically refreshing observations', t => {
    const dir = fixture(t, {
      'specs/001-feature/spec.md': spec('acme.feature'),
      'specs/001-feature/tasks.md': '# Tasks\n\n- [x] T001 Build\n- [ ] T002 Release\n',
    });
    let projection = projectSpecRegistry(dir);
    const seeded = projection.registry;
    seeded.specs[0].reviewed.lifecycle.approval = 'approved';
    seeded.specs[0].reviewed.lifecycle.delivery = 'in_progress';
    seeded.specs[0].reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(seeded, null, 2)}\n`);

    projection = projectSpecRegistry(dir);
    assert.equal(projection.current, true);
    assert.equal(projection.registry.specs[0].reviewed.lifecycle.approval, 'approved');
    assert.deepEqual(projection.registry.specs[0].observed.taskCompletion, { checked: 1, total: 2 });
    assert.equal(projectSpecRegistry(dir).serialized, projection.serialized);
  });

  it('requires qualified test identity for lifecycle evidence', t => {
    const dir = fixture(t, {
      'specs/001-feature/spec.md': spec('acme.feature'),
      'tests/bare.test.mjs': '/** @req FR-001 */\ntest("legacy", () => {});\n',
      'tests/path.test.mjs': '/** @req specs/001-feature/spec.md#FR-001 */\ntest("path", () => {});\n',
      'tests/id.test.mjs': '/** @req acme.feature#FR-001 */\ntest("id", () => {});\n',
    });
    const evidence = projectSpecRegistry(dir).registry.specs[0].observed.testEvidence;
    assert.deepEqual(evidence.map(item => item.file), ['tests/id.test.mjs', 'tests/path.test.mjs']);
  });

  it('projects valid archive events as stable tombstones', t => {
    const dir = fixture(t, {
      '.docguard-archive.json': JSON.stringify({
        schemaVersion: 1,
        strategy: 'git-history',
        retention: { ref: 'refs/heads/main', objectFormat: 'sha1', recoverability: 'verified' },
        entries: [{
          path: 'specs/old/spec.md',
          archivedFrom: '0'.repeat(40),
          blob: '1'.repeat(40),
          reason: 'Superseded',
          requirementIds: ['FR-001'],
        }],
      }),
    });
    const projection = projectSpecRegistry(dir);
    assert.deepEqual(projection.registry.tombstones[0].requirements, ['specs/old/spec.md#FR-001']);
  });

  it('reports a missing or stale registry through guard', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': spec('acme.feature') });
    let result = validateSpecRegistry(dir);
    assert.equal(result.findings[0].code, 'SPR001');
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    result = validateSpecRegistry(dir);
    assert.equal(result.findings.length, 0);
  });

  it('preflight excludes the draft from the baseline and blocks reused identity', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': spec('acme.feature') });
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    write(dir, 'specs/002-draft/spec.md', spec('acme.feature'));
    const result = preflightSpec(dir, {}, 'specs/002-draft/spec.md');
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some(issue => issue.code === 'SPR002' && /already belongs/.test(issue.message)));
    assert.ok(!result.blockers.some(issue => issue.code === 'SPR001'));
  });

  it('keeps semantic overlap advisory', t => {
    const original = '# Billing export\n\n**Spec ID**: `acme.billing`\n\n- **FR-001**: Export billing invoices to a CSV file.\n';
    const draft = '# Billing export v2\n\n**Spec ID**: `acme.billing-v2`\n\n- **FR-001**: Export billing invoices to a CSV file with dates.\n';
    const dir = fixture(t, { 'specs/001-feature/spec.md': original });
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    write(dir, 'draft.md', draft);
    const result = preflightSpec(dir, {}, 'draft.md');
    assert.equal(result.status, 'READY');
    assert.equal(result.overlaps[0].specId, 'acme.billing');
  });

  it('allows an initial briefing when the project has no prior specs', t => {
    const dir = fixture(t);
    const result = preflightSpec(dir);
    assert.equal(result.status, 'BRIEFING');
    assert.deepEqual(result.briefing, []);
    assert.deepEqual(result.blockers, []);
  });

  it('blocks private and out-of-project draft paths', t => {
    const dir = fixture(t);
    write(dir, '.local/private-spec.md', spec('acme.private'));
    const privateResult = preflightSpec(dir, {}, '.local/private-spec.md');
    assert.equal(privateResult.status, 'BLOCKED');
    assert.ok(privateResult.blockers.some(issue => issue.code === 'SPR003'));

    const outside = join(dirname(dir), 'outside-spec.md');
    writeFileSync(outside, spec('acme.outside'));
    t.after(() => rmSync(outside, { force: true }));
    const outsideResult = preflightSpec(dir, {}, outside);
    assert.equal(outsideResult.status, 'BLOCKED');
    assert.ok(outsideResult.blockers.some(issue => issue.code === 'SPR003'));
  });

  it('requires reciprocal lineage and an approved current successor', t => {
    const dir = fixture(t, {
      'specs/001-old/spec.md': spec('acme.old'),
      'specs/002-new/spec.md': spec('acme.new'),
    });
    const registry = projectSpecRegistry(dir).registry;
    const old = registry.specs.find(entry => entry.specId === 'acme.old');
    const successor = registry.specs.find(entry => entry.specId === 'acme.new');
    old.reviewed.lifecycle.context = 'retired';
    old.reviewed.lifecycle.storage = 'git_history';
    old.reviewed.lifecycle.retirementReason = 'superseded';
    old.reviewed.relations.supersededBy = ['acme.new'];
    successor.reviewed.lifecycle.approval = 'draft';
    successor.reviewed.relations.supersedes = ['acme.old'];
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    rmSync(join(dir, 'specs/001-old'), { recursive: true, force: true });
    write(dir, '.docguard-archive.json', JSON.stringify({
      schemaVersion: 1,
      strategy: 'git-history',
      retention: { ref: 'refs/heads/main', objectFormat: 'sha1', recoverability: 'verified' },
      entries: [{
        path: 'specs/001-old/spec.md',
        archivedFrom: '0'.repeat(40),
        blob: '1'.repeat(40),
        reason: 'Superseded',
        requirementIds: ['FR-001'],
        specId: 'acme.old',
      }],
    }));
    const projection = projectSpecRegistry(dir);
    assert.ok(projection.issues.some(issue => /must be an approved current spec/.test(issue.message)));

    successor.reviewed.relations.supersedes = [];
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    const brokenLineage = projectSpecRegistry(dir);
    assert.ok(brokenLineage.issues.some(issue => /must be mirrored/.test(issue.message)));

    successor.reviewed.relations.extends = ['acme.missing'];
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    const unknownTarget = projectSpecRegistry(dir);
    assert.ok(unknownTarget.issues.some(issue => /references unknown spec acme\.missing/.test(issue.message)));
  });

  it('refuses malformed reviewed lifecycle values instead of overwriting them', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': spec('acme.feature') });
    const registry = projectSpecRegistry(dir).registry;
    registry.specs[0].reviewed.lifecycle.delivery = 'done-ish';
    write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
    const projection = projectSpecRegistry(dir);
    assert.ok(projection.issues.some(issue => issue.code === 'SPR003' && /delivery/.test(issue.message)));
    assert.match(readFileSync(join(dir, SPEC_REGISTRY_PATH), 'utf8'), /done-ish/);
  });

  it('provides a read-only CI check and an explicit write path', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': spec('acme.feature') });
    const missing = run(dir, ['--check', '--format', 'json']);
    assert.equal(missing.status, 2, missing.stderr);
    assert.equal(JSON.parse(missing.stdout).status, 'MISSING');
    assert.equal(existsSync(join(dir, SPEC_REGISTRY_PATH)), false);

    const written = run(dir, ['--write', '--format', 'json']);
    assert.equal(written.status, 0, written.stderr);
    assert.equal(JSON.parse(written.stdout).status, 'WRITTEN');
    const current = run(dir, ['--check', '--format', 'json']);
    assert.equal(current.status, 0, current.stderr);
    assert.equal(JSON.parse(current.stdout).status, 'CURRENT');
  });

  it('emits the pre-specification briefing without a draft path', t => {
    const dir = fixture(t, { 'specs/001-feature/spec.md': spec('acme.feature') });
    write(dir, SPEC_REGISTRY_PATH, projectSpecRegistry(dir).serialized);
    const result = run(dir, ['preflight', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, 'BRIEFING');
    assert.equal(parsed.briefing[0].specId, 'acme.feature');
  });
});
