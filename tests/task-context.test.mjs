/**
 * @req docguard.task-specific-agent-context#FR-001
 * @req docguard.task-specific-agent-context#FR-002
 * @req docguard.task-specific-agent-context#FR-003
 * @req docguard.task-specific-agent-context#FR-004
 * @req docguard.task-specific-agent-context#FR-005
 * @req docguard.task-specific-agent-context#FR-006
 * @req docguard.task-specific-agent-context#FR-007
 * @req docguard.task-specific-agent-context#FR-008
 * @req docguard.task-specific-agent-context#FR-009
 * @req docguard.task-specific-agent-context#FR-010
 * @req docguard.task-specific-agent-context#SC-001
 * @req docguard.task-specific-agent-context#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTaskContextPacket, TASK_CONTEXT_LIMITS } from '../cli/scanners/task-context.mjs';
import { contentHash } from '../cli/scanners/semantic-claims.mjs';

const CLI = resolve('cli/docguard.mjs');

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function tree(root, prefix = '') {
  const result = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push([`${path}/`], ...tree(root, path));
    else if (entry.isSymbolicLink()) result.push([path, 'symlink']);
    else result.push([path, readFileSync(join(root, path), 'utf8')]);
  }
  return result;
}

function specEntry({ specId, path, content, context = 'current', approval = 'approved', evidence = true }) {
  return {
    specId,
    path,
    reviewed: {
      lifecycle: { approval, delivery: 'verified', context, retirementReason: context === 'retired' ? 'superseded' : null, storage: context === 'retired' ? 'git_history' : 'working_tree', persistenceModel: 'living' },
      relations: { extends: [], duplicates: [], conflictsWith: [], supersedes: [], supersededBy: [] },
      scope: { canonicalDocs: ['docs-canonical/REQUIREMENTS.md'] },
      reconciliation: { lastReviewedRevision: null, outcomes: [] },
    },
    intent: { requirements: [`${specId}#FR-001`] },
    observed: {
      artifacts: [{ path, digest: contentHash(content) }],
      taskCompletion: { checked: 1, total: 1 },
      implementationEvidence: evidence ? [{ requirementId: 'FR-001', file: 'src/status.mjs', line: 1 }] : [],
      testEvidence: evidence ? [{ requirementId: 'FR-001', file: 'tests/status.test.mjs', line: 1 }] : [],
    },
  };
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'docguard-task-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const active = '# Status Feature\n\n## Requirements\n\n- **FR-001**: `normalizeStatus` in `src/status.mjs` MUST accept queued aliases and return null for unknown values.\n';
  const retired = '# Old Nebula Plan\n\n- **FR-001**: Quasar nebula output MUST bypass normalization.\n';
  write(root, 'docs-canonical/REQUIREMENTS.md', '# Requirements\n\nStatus aliases preserve compatibility.\n');
  write(root, 'AGENTS.md', '# Agents\n\n## Workflow\n\nRun focused tests before the full suite.\n');
  write(root, 'src/status.mjs', 'export const normalizeStatus = value => value;\n');
  write(root, 'tests/status.test.mjs', 'test("status", () => {});\n');
  write(root, 'specs/001-status/spec.md', active);
  write(root, 'specs/000-old/spec.md', retired);
  write(root, '.docguard-specs.json', JSON.stringify({
    schemaVersion: 2,
    specs: [
      specEntry({ specId: 'acme.status', path: 'specs/001-status/spec.md', content: active }),
      specEntry({ specId: 'acme.old', path: 'specs/000-old/spec.md', content: retired, context: 'retired' }),
    ],
    tombstones: [],
  }, null, 2));
  return root;
}

describe('task-specific context selector', () => {
  it('prioritizes an exact requirement and returns its source and test pointers', t => {
    const root = fixture(t);
    const packet = buildTaskContextPacket(root, {}, 'Update src/status.mjs for acme.status#FR-001 normalization.');
    assert.equal(packet.selection.status, 'targeted');
    assert.equal(packet.excerpts[0].specId, 'acme.status');
    assert.ok(packet.excerpts[0].reasons.includes('qualified-requirement:acme.status#FR-001'));
    assert.ok(packet.pointers.some(item => item.path === 'src/status.mjs' && item.reasons.includes('named-by-task')));
    assert.ok(packet.pointers.some(item => item.path === 'tests/status.test.mjs' && item.requirements.includes('acme.status#FR-001')));
    assert.equal(packet.assurance.factualAccuracy, null);
    assert.equal(packet.assurance.verification, 'unverified');
  });

  it('is byte-deterministic, omits raw task text, and writes nothing', t => {
    const root = fixture(t);
    const before = tree(root);
    const task = 'Implement normalizeStatus alias behavior.';
    const first = buildTaskContextPacket(root, {}, task);
    const second = buildTaskContextPacket(root, {}, task);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.ok(!JSON.stringify(first).includes(task));
    assert.match(first.task.digest, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(tree(root), before);
  });

  it('abstains instead of returning weak lexical context', t => {
    const root = fixture(t);
    const packet = buildTaskContextPacket(root, {}, 'Calibrate quokka zephyr luminance.');
    assert.equal(packet.selection.status, 'abstained');
    assert.deepEqual(packet.excerpts, []);
    assert.deepEqual(packet.pointers, []);
    assert.ok(packet.limitations.includes('no-candidate-met-relevance-threshold'));
    assert.ok(packet.navigation.canonicalDocs.includes('docs-canonical/REQUIREMENTS.md'));
  });

  it('excludes retired specifications even when they are the strongest match', t => {
    const root = fixture(t);
    const packet = buildTaskContextPacket(root, {}, 'Change quasar nebula bypass behavior.');
    assert.ok(packet.excerpts.every(item => item.specId !== 'acme.old'));
    assert.ok(packet.navigation.activeSpecs.every(item => item.specId !== 'acme.old'));
    assert.equal(packet.selection.excludedLifecycleDocuments, 1);
  });

  it('rejects overlong and empty tasks before reading repository context', t => {
    const root = fixture(t);
    assert.throws(() => buildTaskContextPacket(root, {}, ' '), /non-empty/);
    assert.throws(() => buildTaskContextPacket(root, {}, 'x'.repeat(TASK_CONTEXT_LIMITS.taskChars + 1)), /limited/);
  });

  it('never reads private or symlinked mapped documentation', t => {
    const root = fixture(t);
    write(root, '.local/private.md', '# Private\nquasar-secret-token\n');
    const outside = mkdtempSync(join(tmpdir(), 'docguard-task-context-outside-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    write(outside, 'escaped.md', '# Escaped\nquasar-secret-token\n');
    symlinkSync(join(outside, 'escaped.md'), join(root, 'docs-canonical/escaped.md'));
    const packet = buildTaskContextPacket(root, { docs: { roles: { architecture: 'docs-canonical/escaped.md' } } }, 'Use quasar-secret-token.');
    const serialized = JSON.stringify(packet);
    assert.ok(!serialized.includes('.local/private.md'));
    assert.ok(!serialized.includes('escaped.md'));
    assert.ok(!serialized.includes('quasar-secret-token'));
  });

  it('enforces excerpt, line, and character budgets with visible truncation', t => {
    const root = fixture(t);
    const sections = Array.from({ length: 20 }, (_, i) => `## Status ${i}\nnormalizeStatus status alias ${i}\n${'bounded text '.repeat(80)}`).join('\n');
    write(root, 'docs-canonical/REQUIREMENTS.md', `# Requirements\n${sections}\n`);
    const packet = buildTaskContextPacket(root, {}, 'Update normalizeStatus status aliases.');
    assert.ok(packet.excerpts.length <= TASK_CONTEXT_LIMITS.selectedExcerpts);
    assert.ok(packet.excerpts.every(item => item.endLine - item.startLine + 1 <= TASK_CONTEXT_LIMITS.linesPerExcerpt));
    assert.ok(packet.excerpts.reduce((sum, item) => sum + item.content.length, 0) <= TASK_CONTEXT_LIMITS.totalChars);
    assert.equal(packet.selection.truncated, true);
    assert.ok(packet.limitations.includes('selection-budget-reached'));
  });

  it('excludes stale active spec content when its registry digest no longer matches', t => {
    const root = fixture(t);
    write(root, 'specs/001-status/spec.md', '# Changed\nnormalizeStatus mismatch\n');
    const packet = buildTaskContextPacket(root, {}, 'Update normalizeStatus.');
    assert.ok(packet.excerpts.every(item => item.specId !== 'acme.status'));
    assert.equal(packet.selection.excludedLifecycleDocuments, 2);
  });

  it('exposes aligned opt-in human and deterministic JSON CLI output', t => {
    const root = fixture(t);
    const task = 'Update src/status.mjs for acme.status#FR-001 normalization.';
    const json = spawnSync(process.execPath, [CLI, 'agent', '--task', task, '--format', 'json', '--dir', root], {
      encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(json.status, 0, json.stderr);
    const packet = JSON.parse(json.stdout);
    assert.equal(packet.kind, 'docguard.task-context');
    assert.equal(packet.selection.status, 'targeted');
    assert.ok(!json.stdout.includes(task));
    assert.ok(!Object.hasOwn(packet, 'timestamp'));

    const human = spawnSync(process.execPath, [CLI, 'agent', '--task', task, '--dir', root], {
      encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /DocGuard Task Context/);
    assert.match(human.stdout, /specs\/001-status\/spec\.md:\d+-\d+/);
    assert.match(human.stdout, /Retrieval only · factual accuracy remains unknown/);
    assert.match(human.stdout, /src\/status\.mjs \(task-path:/);
  });

  it('returns a stable machine error for a missing task value', t => {
    const root = fixture(t);
    const result = spawnSync(process.execPath, [CLI, 'agent', '--task', '--format', 'json', '--dir', root], {
      encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'error', code: 'TASK_CONTEXT_INPUT', message: 'Task context requires a non-empty task.',
    });
    assert.equal(result.stderr, '');
  });
});
