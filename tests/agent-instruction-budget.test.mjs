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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { measureInstructionChains } from '../cli/scanners/agent-instructions.mjs';
import { validateStructure } from '../cli/validators/structure.mjs';
import { detectSpecNumberCollisions, validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { CODES } from '../cli/findings.mjs';

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

// FR-004 says STR005 is informational. mkFinding only accepts error or warn,
// so the validator's `severity: 'info'` was read as a warning: slack in an
// allowance turned guard's status to WARN (exit 2) and failed
// `ci --fail-on-warning`. The code's registered default now sets the level.
describe('STR005 is informational (FR-004)', () => {
  const onlyStructure = extra => ({
    projectName: 'budget',
    ...baseConfig(extra),
    validators: Object.fromEntries(['docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security', 'freshness',
      'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync',
      'specKit', 'metricsConsistency', 'architecture'].map(k => [k, false]).concat([['structure', true]])),
  });
  const slack = () => project({ 'AGENTS.md': bytes(38000), 'DRIFT-LOG.md': '' });
  const allowance = { agentInstructions: { allowances: { 'AGENTS.md': 40000 } } };
  const str005 = r => r.findings.find(f => f.code === 'STR005');

  it('counts as info, not as a warning, and says the level came from the code', () => {
    const r = runGuardInternal(slack(), onlyStructure(allowance));
    const f = str005(r);
    assert.ok(f, 'STR005 fires');
    assert.equal(f.severity, 'warn', 'a finding\'s own severity stays error or warn');
    assert.equal(f.effectiveSeverity, 'info');
    assert.deepEqual(f.enforcement, { level: 'info', source: 'code', key: 'STR005' });
    assert.equal(r.effectiveWarnings, r.findings.filter(x => x.effectiveSeverity === 'warn').length);
    assert.ok(r.effectiveInfos >= 1);
    assert.equal(r.validators.find(v => v.key === 'structure').effectiveStatus, r.findings.some(x => x.validator === 'structure' && x.effectiveSeverity === 'warn') ? 'warn' : 'pass');
  });

  it('stays info under a stricter validator policy; an exact code policy still wins', () => {
    assert.equal(str005(runGuardInternal(slack(), onlyStructure({ ...allowance, severity: { structure: 'high' } }))).effectiveSeverity, 'info');
    const promoted = str005(runGuardInternal(slack(), onlyStructure({ ...allowance, findingSeverity: { STR005: 'medium' } })));
    assert.deepEqual(promoted.enforcement, { level: 'warn', source: 'finding', key: 'STR005' });
  });

  it('leaves the exit code alone, and guard names the code default rather than an override', () => {
    const dir = slack();
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify(onlyStructure(allowance)));
    const cli = resolve('cli/docguard.mjs');
    const json = spawnSync(process.execPath, [cli, 'guard', '--dir', dir, '--format', 'json'], { encoding: 'utf8' });
    const r = JSON.parse(json.stdout);
    assert.ok(str005(r), 'STR005 fires');
    assert.equal(json.status, r.effectiveErrors > 0 ? 1 : r.effectiveWarnings > 0 ? 2 : 0);
    assert.equal(r.findings.filter(x => x.effectiveSeverity === 'warn').some(x => x.code === 'STR005'), false);
    const text = spawnSync(process.execPath, [cli, 'guard', '--dir', dir], { encoding: 'utf8' }).stdout;
    assert.match(text, /informational by default \(STR005\)/);
    assert.doesNotMatch(text, /informational for exit code \(severity=low\)/);
  });
});

describe('a detector cannot ask for a severity mkFinding would coerce', () => {
  it('every literal severity under cli/validators, cli/scanners and cli/evidence is error or warn', () => {
    const offenders = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.mjs')) {
          readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
            const m = line.match(/\bseverity:\s*'([a-z]+)'/);
            if (m && m[1] !== 'error' && m[1] !== 'warn') offenders.push(`${path}:${i + 1} severity '${m[1]}'`);
          });
        }
      }
    };
    for (const dir of ['cli/validators', 'cli/scanners', 'cli/evidence']) walk(dir);
    assert.deepEqual(offenders, [], 'register defaultLevel on the code in CODES instead');
  });

  it('a registered default level is one the enforcement resolver supports', () => {
    for (const [code, entry] of Object.entries(CODES)) {
      if ('defaultLevel' in entry) assert.equal(entry.defaultLevel, 'info', code);
    }
    assert.equal(CODES.STR005.defaultLevel, 'info');
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
