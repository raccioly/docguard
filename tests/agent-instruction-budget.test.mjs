/**
 * Agent instruction budget (STR004/STR005) and spec number collisions (SPK012).
 *
 * @req docguard.agent-instruction-budget#FR-001
 * @req docguard.agent-instruction-budget#FR-002
 * @req docguard.agent-instruction-budget#FR-003
 * @req docguard.agent-instruction-budget#FR-004
 * @req docguard.agent-instruction-budget#FR-005
 * @req docguard.agent-instruction-budget#SC-001
 * @req docguard.agent-instruction-budget#SC-002
 * @req docguard.agent-instruction-budget#SC-003
 * @req docguard.agent-instruction-budget#SC-004
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { measureInstructionChains } from '../cli/scanners/agent-instructions.mjs';
import { validateStructure } from '../cli/validators/structure.mjs';
import { detectSpecNumberCollisions, validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-budget-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const bytes = n => 'x'.repeat(n);
const baseConfig = extra => ({ requiredFiles: { canonical: [], agentFile: ['AGENTS.md'], driftLog: 'DRIFT-LOG.md' }, ...extra });
const codes = (dir, config) => validateStructure(dir, baseConfig(config)).findings.map(f => f.code);

describe('instruction chains', () => {
  it('concatenates root to leaf and lets AGENTS.override.md replace AGENTS.md', () => {
    const dir = project({
      'AGENTS.md': bytes(100),
      'pkg/AGENTS.md': bytes(50),
      'pkg/AGENTS.override.md': bytes(20),
      'pkg/deep/AGENTS.md': bytes(5),
    });
    const chains = measureInstructionChains(dir);
    const deep = chains.find(c => c.leaf === 'pkg/deep/AGENTS.md');
    assert.deepEqual(deep.files, ['AGENTS.md', 'pkg/AGENTS.override.md', 'pkg/deep/AGENTS.md']);
    assert.equal(deep.bytes, 125);
  });

  it('skips node_modules and .docguardignore matches', () => {
    const dir = project({
      'AGENTS.md': bytes(10),
      'node_modules/x/AGENTS.md': bytes(99999),
      'fixtures/AGENTS.md': bytes(99999),
      '.docguardignore': 'fixtures/\n',
    });
    assert.deepEqual(measureInstructionChains(dir).map(c => c.leaf), ['AGENTS.md']);
  });

  it('measures this repository within the default budget (SC-003)', () => {
    const root = measureInstructionChains(process.cwd()).find(c => c.leaf === 'AGENTS.md');
    assert.ok(root && root.bytes <= 32768, `root chain is ${root?.bytes} bytes`);
  });
});

describe('STR004 / STR005', () => {
  it('reports a chain over the default budget and passes one within it', () => {
    assert.ok(codes(project({ 'AGENTS.md': bytes(30000), 'api/AGENTS.md': bytes(3000), 'DRIFT-LOG.md': '' })).includes('STR004'));
    assert.ok(!codes(project({ 'AGENTS.md': bytes(30000), 'DRIFT-LOG.md': '' })).includes('STR004'));
  });

  it('honours maxBytes', () => {
    assert.ok(codes(project({ 'AGENTS.md': bytes(200), 'DRIFT-LOG.md': '' }), { agentInstructions: { maxBytes: 100 } }).includes('STR004'));
  });

  it('an allowance freezes debt, regrowth reappears, slack is reported', () => {
    const at = size => project({ 'AGENTS.md': bytes(size), 'DRIFT-LOG.md': '' });
    const cfg = { agentInstructions: { allowances: { 'AGENTS.md': 40000 } } };
    assert.deepEqual(codes(at(40000), cfg).filter(c => c.startsWith('STR00') && c !== 'STR003'), []);
    assert.ok(codes(at(40001), cfg).includes('STR004'), 'one byte past the allowance must fail');
    assert.ok(codes(at(38000), cfg).includes('STR005'), 'slack must be reported');
  });
});

describe('SPK012 — spec number collisions', () => {
  it('reports each duplicated number once, naming every directory', () => {
    const dir = project({
      'specs/016-a/spec.md': '# A\n',
      'specs/016-b/spec.md': '# B\n',
      'specs/017-c/spec.md': '# C\n',
      'specs/20260319-143022-d/spec.md': '# D\n',
      'specs/20260319-150000-e/spec.md': '# E\n',
    });
    assert.deepEqual(detectSpecNumberCollisions(dir), [{ number: '016', dirs: ['016-a', '016-b'] }]);
    const spk = validateSpecKitIntegration(dir, {}).findings.filter(f => f.code === 'SPK012');
    assert.equal(spk.length, 1);
    assert.match(spk[0].message, /specs\/016-a, specs\/016-b/);
  });

  it('passes unique numbers', () => {
    const dir = project({ 'specs/001-a/spec.md': '# A\n', 'specs/002-b/spec.md': '# B\n' });
    assert.deepEqual(detectSpecNumberCollisions(dir), []);
  });
});
