import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync, lstatSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks, createEvidenceReader, contentHash, gitEvidence, taskEvidence } from '../cli/scanners/semantic-claims.mjs';
import { buildAgentTaskGraph } from '../cli/commands/agent.mjs';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;
const DOC = 'docs-canonical/LIMITS.md';
const SOURCE = 'src/limits.ts';
const config = { projectName: 'evidence', profile: 'starter', diskCache: true };
const plan = {
  profile: { kind: 'cli', languages: ['TypeScript'], frameworks: [] },
  docs: [{ path: DOC, sections: [
    { id: 'limits', source: 'code', body: 'See `src/limits.ts`. Retention is 30 days.' },
    { id: 'purpose', source: 'human', task: 'Explain the retention policy.' },
  ] }], notes: [],
};

function tree(dir) {
  const out = {};
  const walk = (rel = '') => {
    for (const name of readdirSync(join(dir, rel))) {
      const path = join(rel, name);
      const stat = lstatSync(join(dir, path));
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) out[path] = contentHash(readFileSync(join(dir, path)));
    }
  };
  walk();
  return out;
}

function cli(dir, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

function git(dir, ...args) {
  const result = spawnSync('git', args, {
    cwd: dir, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe('agent evidence and context provenance', () => {
  let dir;
  let outside;
  const write = (path, content) => safeWrite(join(dir, path), content);
  const tasks = () => buildSemanticVerifyTasks(extractSemanticClaims(dir));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-evidence-'));
    outside = mkdtempSync(join(tmpdir(), 'docguard-outside-'));
    write('package.json', JSON.stringify({ name: 'evidence', version: '1.0.0', type: 'module' }));
    write('.docguard.json', JSON.stringify(config));
    write(DOC, '# Limits\n\n## Retention\nRetention is 30 days. See `src/limits.ts:1`.\n');
    write(SOURCE, 'export const RETENTION_DAYS = 30;\n');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('preserves sequential IDs and keeps content IDs stable under claim reordering', () => {
    const a = 'Retention is 30 days. See `src/limits.ts`.\n';
    const b = 'Timeout is 5 seconds. See `src/limits.ts`.\n';
    write(DOC, `# Limits\n\n${a}\n\n${b}`);
    const first = tasks();
    write(DOC, `# Limits\n\n${b}\n\n${a}`);
    const second = tasks();
    assert.deepEqual(first.map(t => t.id), ['verify.semantic.1', 'verify.semantic.2']);
    assert.deepEqual(second.map(t => t.id), ['verify.semantic.1', 'verify.semantic.2']);
    for (const claim of first) {
      const moved = second.find(t => t.value === claim.value);
      assert.equal(moved.stableId, claim.stableId);
      assert.notEqual(moved.id, claim.id);
      assert.notEqual(moved.evidence.snapshotHash, claim.evidence.snapshotHash);
    }
  });

  it('invalidates document evidence without changing an unchanged claim identity', () => {
    const first = tasks()[0];
    write(DOC, readFileSync(join(dir, DOC), 'utf8') + '\nAdditional context.\n');
    const next = tasks()[0];
    assert.equal(next.stableId, first.stableId);
    assert.notEqual(next.evidence.document.hash, first.evidence.document.hash);
    assert.notEqual(next.evidence.snapshotHash, first.evidence.snapshotHash);
    assert.equal(next.evidence.citedSources[0].hash, first.evidence.citedSources[0].hash);
  });

  it('invalidates source evidence without changing document hashes or claim identity', () => {
    const first = tasks()[0];
    write(SOURCE, 'export const RETENTION_DAYS = 90;\n');
    const next = tasks()[0];
    assert.equal(next.stableId, first.stableId);
    assert.equal(next.evidence.document.hash, first.evidence.document.hash);
    assert.notEqual(next.evidence.citedSources[0].hash, first.evidence.citedSources[0].hash);
    assert.notEqual(next.evidence.snapshotHash, first.evidence.snapshotHash);
    assert.equal(next.evidence.verification, 'unverified');
  });

  it('changes identity when claim content changes', () => {
    const first = tasks()[0];
    write(DOC, '# Limits\n\n## Retention\nRetention is 90 days. See `src/limits.ts:1`.\n');
    assert.notEqual(tasks()[0].stableId, first.stableId);
  });

  it('marks absent and uncited code unknown, never verified', () => {
    rmSync(join(dir, SOURCE));
    const task = tasks()[0];
    assert.equal(task.evidence.citedSources[0].status, 'unknown');
    assert.equal(task.evidence.citedSources[0].hash, null);
    assert.equal(task.evidence.sourceCoverage, 'unknown');
    write(DOC, '# Limits\nRetention is 30 days.\n');
    assert.deepEqual(tasks()[0].evidence.citedSources, []);
    assert.equal(tasks()[0].evidence.sourceCoverage, 'unknown');
    assert.equal(tasks()[0].evidence.verification, 'unverified');
  });

  for (const citation of ['../outside.ts', '/tmp/outside.ts', '.local/private.ts', 'src/../limits.ts', 'src\\limits.ts', '.env', '.env.production', '.env.example.json', 'https://example.com/src/limits.ts']) {
    it(`rejects unsafe cited path ${citation}`, () => {
      const result = createEvidenceReader(dir)(citation);
      assert.equal(result.content, null);
      assert.equal(result.evidence.status, 'unknown');
      assert.equal(result.evidence.hash, null);
      assert.equal(result.evidence.reason, 'unsafe-path');
    });
  }

  it('does not hash environment values or private files even when they exist', () => {
    write('.env', 'SECRET=do-not-read');
    write('.local/private.ts', 'export const PRIVATE = 99;');
    write(DOC, '# Limits\nRetention is 30 days. See `.env`.\n');
    assert.equal(tasks()[0].evidence.citedSources[0].hash, null);
    assert.equal(tasks()[0].evidence.citedSources[0].reason, 'unsafe-path');
    write(DOC, '# Limits\nRetention is 30 days. See `.local/private.ts`.\n');
    assert.equal(tasks()[0].evidence.citedSources[0].reason, 'unsafe-path');
  });

  it('rejects file and directory symlink escapes, including secret aliases', () => {
    safeWrite(join(outside, 'outside.ts'), 'outside content');
    symlinkSync(join(outside, 'outside.ts'), join(dir, 'alias.ts'));
    symlinkSync(outside, join(dir, 'linked'));
    write('.env', 'SECRET=do-not-read');
    symlinkSync(join(dir, '.env'), join(dir, 'secret.json'));
    for (const path of ['alias.ts', 'linked/outside.ts', 'secret.json']) {
      assert.equal(createEvidenceReader(dir)(path).evidence.reason, 'symlink');
    }
    symlinkSync(outside, join(dir, 'docs-canonical/escaped'));
    safeWrite(join(outside, 'PRIVATE.md'), '# Private\nRetention is 99 days.\n');
    assert.equal(extractSemanticClaims(dir).length, 1);
  });

  it('does not extract a symlinked canonical document or symlinked ignore secrets', () => {
    rmSync(join(dir, DOC));
    safeWrite(join(outside, 'PRIVATE.md'), '# Private\nRetention is 99 days.\n');
    symlinkSync(join(outside, 'PRIVATE.md'), join(dir, DOC));
    write('.env', 'SECRET=do-not-read');
    symlinkSync(join(dir, '.env'), join(dir, '.docguardignore'));
    assert.deepEqual(extractSemanticClaims(dir), []);
  });

  it('bounds file size, source count, and per-run reads', () => {
    write('large.ts', 'x'.repeat(1024 * 1024 + 1));
    assert.equal(createEvidenceReader(dir)('large.ts').evidence.reason, 'file-too-large');
    const read = createEvidenceReader(dir);
    const citations = Array.from({ length: 20 }, (_, i) => `missing-${i}.ts`);
    assert.equal(taskEvidence(read, DOC, citations).citedSources.length, 8);
    for (let i = 0; i < 128; i++) read(`absent-${i}.ts`);
    assert.equal(read('extra.ts').evidence.reason, 'file-budget');
  });

  it('does not turn caller-supplied claims without captured provenance into verified evidence', () => {
    const task = buildSemanticVerifyTasks([{ doc: DOC, line: 1, text: '30 days', value: '30', kind: 'number', unit: 'days' }])[0];
    assert.equal(task.id, 'verify.semantic.1');
    assert.match(task.stableId, /^claim\.[a-f0-9]{64}$/);
    assert.equal(task.evidence.document.status, 'unknown');
    assert.equal(task.evidence.verification, 'unverified');
    assert.equal(task.evidence.factualAccuracy, 'unknown');
  });

  it('aligns final acceptance with warnings and requires separate prose review', () => {
    const graph = buildAgentTaskGraph(dir, config, plan);
    const gate = graph.tasks.find(t => t.id === 'verify.guard');
    assert.equal(gate.acceptance.expect, '0 errors');
    assert.match(gate.instruction, /0 errors/);
    assert.match(gate.instruction, /warnings do not fail/);
    assert.match(gate.instruction, /Neither guard nor score verifies prose/);
    const prose = graph.tasks.find(t => t.id === 'limits.purpose');
    assert.equal(prose.acceptance.reviewRequired, true);
    assert.equal(prose.acceptance.scope, 'structural-only');
    assert.equal(graph.assurance.status, 'unverified');
    assert.equal(graph.assurance.factualAccuracy, null);
    assert.ok(graph.tasks.every(t => t.evidence.verification === 'unverified'));
    assert.equal(graph.provenance.git.status, 'unknown');
  });

  it('invalidates agent task evidence when a cited source changes', () => {
    const first = buildAgentTaskGraph(dir, config, plan).tasks.find(t => t.id === 'limits.purpose');
    write(SOURCE, 'export const RETENTION_DAYS = 90;');
    const next = buildAgentTaskGraph(dir, config, plan).tasks.find(t => t.id === 'limits.purpose');
    assert.notEqual(first.evidence.snapshotHash, next.evidence.snapshotHash);
    assert.equal(next.evidence.verification, 'unverified');
  });

  it('keeps agent, semantic verify, and stdout packs read-only with disk cache enabled', () => {
    const before = tree(dir);
    const graph = JSON.parse(cli(dir, 'agent', '--format', 'json'));
    assert.equal(graph.tasks[0].evidence.verification, 'unverified');
    const verification = JSON.parse(cli(dir, 'verify', '--semantic', '--format', 'json'));
    assert.equal(verification.tasks[0].evidence.kind, 'snapshot');
    cli(dir, 'memory', '--pack', '--stdout');
    assert.deepEqual(tree(dir), before);
  });

  it('includes unknown Git, structural assurance and unverified count in a context pack', () => {
    const pack = cli(dir, 'memory', '--pack', '--stdout');
    assert.match(pack, /Git revision: unknown · dirty: unknown/);
    assert.match(pack, /structural-only · factual accuracy: unknown/);
    assert.match(pack, /Unverified claims: 1 extracted candidates/);
    assert.match(pack, /snapshot only — not reviewed or verified/);
    assert.ok(pack.includes(contentHash(readFileSync(join(dir, DOC)))));
    assert.equal(existsSync(join(dir, '.docguard/context-pack.md')), false);
  });

  it('records Git revision and dirty state and invalidates pack source fingerprints', () => {
    git(dir, 'init', '-q');
    git(dir, 'add', '.');
    git(dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const revision = git(dir, 'rev-parse', 'HEAD');
    assert.deepEqual(gitEvidence(dir), { revision, dirty: false, status: 'snapshot' });
    const first = cli(dir, 'memory', '--pack', '--stdout');
    assert.ok(first.includes(`Git revision: ${revision} · dirty: false`));
    write(SOURCE, 'export const RETENTION_DAYS = 90;');
    const next = cli(dir, 'memory', '--pack', '--stdout');
    assert.ok(next.includes(`Git revision: ${revision} · dirty: true`));
    const fingerprint = pack => pack.match(/Claim evidence fingerprint: (sha256:[a-f0-9]+)/)[1];
    assert.notEqual(fingerprint(first), fingerprint(next));
  });

  it('labels unscanned documentation homes without expanding claim or hash coverage', () => {
    write('README.md', '# Readme\nThere are 4 workers.\n');
    write('AGENTS.md', '# Agents\nThere are 2 roles.\n');
    write('docs-guides/LIMITS.md', '# Guide\nRetention is 90 days.\n');
    const claims = tasks();
    assert.equal(claims.length, 3);
    assert.ok(claims.every(t => /unscanned\/unsupported/.test(t.evidence.limitation)));
    assert.ok(claims.every(t => !t.doc.startsWith('docs-guides/')));
    const graph = buildAgentTaskGraph(dir, config, plan);
    assert.match(graph.assurance.limitation, /guard coverage labels do not extend this scope/);
    const first = cli(dir, 'memory', '--pack', '--stdout');
    assert.match(first, /Coverage limitation: Semantic claim discovery is limited to docs-canonical/);
    assert.match(first, /Other resolved documentation homes are unscanned\/unsupported/);
    write('docs-guides/LIMITS.md', '# Guide\nRetention is 180 days.\n');
    const next = cli(dir, 'memory', '--pack', '--stdout');
    const fingerprint = pack => pack.match(/Claim evidence fingerprint: (sha256:[a-f0-9]+)/)[1];
    assert.equal(fingerprint(first), fingerprint(next), 'unscanned docs are explicitly outside the fingerprint');
  });

  it('writes a pack only on opt-in and backs up the previous artifact', () => {
    cli(dir, 'memory', '--pack');
    const path = join(dir, '.docguard/context-pack.md');
    const first = readFileSync(path, 'utf8');
    cli(dir, 'memory', '--pack');
    assert.equal(readFileSync(path + '.bak', 'utf8'), first);
  });
});
