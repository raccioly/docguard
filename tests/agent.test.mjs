import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildMemoryPlan } from '../cli/scanners/memory-plan.mjs';
import { buildAgentTaskGraph } from '../cli/commands/agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-agent-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('docguard agent — task graph (Phase 2b)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('emits an ordered, phased task graph with pre-filled code-truth', () => {
    dir = make({
      'pyproject.toml': '[project]\nname="tool"\ndependencies=["click"]\n',
      'src/tool/__init__.py': '',
      'src/tool/cli.py': 'def main(): pass\n',
      'tests/test_cli.py': 'def test_run():\n  pass\n',
    });
    const config = { projectName: 'tool', profile: 'cli' };
    const plan = buildMemoryPlan(dir, config);
    const graph = buildAgentTaskGraph(dir, config, plan);

    assert.deepEqual(graph.order, ['config', 'canonical-docs', 'verify']);
    assert.equal(graph.tasks[0].phase, 'config', 'config phase first');
    assert.equal(graph.tasks[graph.tasks.length - 1].phase, 'verify', 'verify phase last');

    // code-truth tasks ship ready-to-insert content
    const codeTask = graph.tasks.find(t => t.kind === 'code-truth');
    assert.ok(codeTask, 'has at least one code-truth task');
    assert.ok(codeTask.prefilled && codeTask.prefilled.length > 0, 'code-truth carries prefilled content');
    assert.equal(codeTask.confidence, 'high');

    // human-judgment tasks carry an instruction + grounding, never a committed guess
    const humanTask = graph.tasks.find(t => t.kind === 'human-judgment' && t.id !== 'config.setup');
    assert.ok(humanTask && humanTask.instruction);
    assert.equal(humanTask.prefilled, null);
    assert.equal(humanTask.confidence, 'requires-human');

    // every task has a self-check verify command
    assert.ok(graph.tasks.every(t => t.acceptance && t.acceptance.verify), 'every task has acceptance.verify');
    assert.equal(graph.counts.tasks, graph.tasks.length);
    assert.ok(graph.counts.codeTruth >= 1);
  });

  it('the CLI emits valid JSON with no banner and no side effects', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4' } }),
      'src/index.js': 'export const x = 1;\n',
    });
    const out = execSync(`node ${CLI} agent --format json`, { cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
    const graph = JSON.parse(out); // must parse — banner would corrupt it
    assert.equal(graph.project, 'app');
    assert.ok(Array.isArray(graph.tasks) && graph.tasks.length > 0);
    assert.deepEqual(graph.order, ['config', 'canonical-docs', 'verify']);
    assert.equal(existsSync(join(dir, '.agent')), false, 'agent is read-only — no scaffolding');
    assert.equal(existsSync(join(dir, '.specify')), false);
  });

  it('honors --profile to preview a profile without init (cli suppresses web docs)', () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'svc', dependencies: { express: '^4' } }),
      'docs/openapi.yaml': 'openapi: 3.0.3\ninfo:\n  title: t\n  version: 1.0.0\npaths:\n  /x:\n    get:\n      summary: s\n',
    });
    const out = execSync(`node ${CLI} agent --format json --profile cli`, { cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
    const graph = JSON.parse(out);
    assert.equal(graph.profile.name, 'cli', '--profile override flows through');
    assert.ok(!graph.tasks.some(t => t.file === 'docs-canonical/API-REFERENCE.md'),
      'cli profile preview must not include API-REFERENCE tasks');
  });
});

describe('runAgent CLI outputs', () => {
  it('runAgent outputs to console correctly', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };

    try {
      const { runAgent } = await import('../cli/commands/agent.mjs');
      const { loadConfig } = await import('../cli/config.mjs');
      let config; try { config = loadConfig(process.cwd()); } catch(e) { config = { projectName: "mock", profile: "cli" }; }
      runAgent(process.cwd(), config, {});
    } finally {
      console.log = originalLog;
    }

    assert.ok(logs.some(log => log.includes('DocGuard Agent Task Graph')));
    assert.ok(logs.some(log => log.includes('▸ config')));
    assert.ok(logs.some(log => log.includes('▸ verify')));
  });
});
