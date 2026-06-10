import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildMemoryPlan } from '../cli/scanners/memory-plan.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-plan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const OPENAPI = [
  'openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:',
  '  /api/users:', '    get:', '      summary: list',
  '  /api/users/{id}:', '    get:', '      summary: one',
].join('\n');

describe('buildMemoryPlan', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('builds a complete plan for a React webapp (endpoints + screens + env)', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' }, devDependencies: { vite: '^7' } }),
      'docs/openapi.yaml': OPENAPI,
      'src/App.tsx': '<Routes><Route path="/login" element={<LoginPage/>} /><Route path="/inbox" element={<InboxPage/>} /></Routes>',
      'src/config.ts': 'export const u = import.meta.env.VITE_API_URL;',
      'src/components/Button.tsx': 'export const Button=()=>null;',
    });
    const plan = buildMemoryPlan(dir, { sourceRoot: 'src' });

    assert.equal(plan.profile.kind, 'webapp');
    assert.ok(plan.surface.endpoints.length >= 2, 'endpoints from openapi');
    assert.ok(plan.surface.screens.length >= 2, 'screens from React Router');
    assert.ok(plan.surface.envVars.includes('VITE_API_URL'));

    const paths = plan.docs.map(d => d.path);
    assert.ok(paths.includes('docs-canonical/ARCHITECTURE.md'));
    assert.ok(paths.includes('docs-canonical/API-REFERENCE.md'));
    assert.ok(paths.includes('docs-canonical/SCREENS.md'));
    assert.ok(paths.includes('docs-canonical/ENVIRONMENT.md'));

    // ARCHITECTURE has a code-truth section AND human agent tasks.
    const arch = plan.docs.find(d => d.path.endsWith('ARCHITECTURE.md'));
    assert.ok(arch.sections.some(s => s.source === 'code' && s.id === 'tech-stack'));
    assert.ok(arch.sections.some(s => s.source === 'human' && s.task));

    // Agent tasks carry grounding facts.
    assert.ok(plan.agentTasks.length >= 4);
    assert.ok(plan.agentTasks.every(t => t.doc && t.sectionId && t.instruction && t.grounding));
  });

  it('a Rust CLI gets a Rust-shaped plan (no API/Screens docs)', () => {
    dir = make({
      'Cargo.toml': '[package]\nname = "mytool"\n\n[dependencies]\nclap = "4"\n',
      'src/main.rs': 'fn main(){ println!("hi"); }',
    });
    const plan = buildMemoryPlan(dir, {});

    assert.ok(plan.profile.languages.includes('Rust'));
    assert.equal(plan.profile.kind, 'cli');
    assert.equal(plan.surface.endpoints.length, 0);
    assert.equal(plan.surface.screens.length, 0);

    const paths = plan.docs.map(d => d.path);
    assert.ok(paths.includes('docs-canonical/ARCHITECTURE.md'), 'always has architecture');
    assert.ok(!paths.includes('docs-canonical/API-REFERENCE.md'), 'no API doc for a CLI');
    assert.ok(!paths.includes('docs-canonical/SCREENS.md'), 'no screens doc for a CLI');

    // tech-stack code section reflects Rust.
    const arch = plan.docs.find(d => d.path.endsWith('ARCHITECTURE.md'));
    const techSec = arch.sections.find(s => s.id === 'tech-stack');
    assert.ok(techSec.body.includes('Rust'));
  });

  it('pre-fills a Component Map and a TEST-SPEC inventory from code (Phase 2a)', () => {
    dir = make({
      'pyproject.toml': '[project]\nname="tool"\ndependencies=["click"]\n',
      'src/tool/__init__.py': '',
      'src/tool/cli.py': 'def main(): pass\n',
      'src/tool/recon.py': 'x=1\n',
      'tests/test_cli.py': 'def test_run():\n  pass\ndef test_help():\n  pass\n',
    });
    const plan = buildMemoryPlan(dir, {});
    const paths = plan.docs.map(d => d.path);
    assert.ok(paths.includes('docs-canonical/TEST-SPEC.md'), 'TEST-SPEC is emitted');

    const arch = plan.docs.find(d => d.path.endsWith('ARCHITECTURE.md'));
    const compMap = arch.sections.find(s => s.id === 'component-map');
    assert.ok(compMap && compMap.source === 'code', 'component-map is a code-truth section');
    assert.ok(compMap.body.includes('cli.py') && compMap.body.includes('recon.py'),
      'real modules are pre-filled into the component map');

    const testSpec = plan.docs.find(d => d.path.endsWith('TEST-SPEC.md'));
    const inv = testSpec.sections.find(s => s.id === 'test-inventory');
    assert.ok(inv && inv.source === 'code', 'test-inventory is a code-truth section');
    assert.ok(inv.body.includes('test_cli.py'), 'the real test file is listed');
    assert.match(inv.body, /2 test case/, 'case count is pre-filled');
  });

  it('respects the active profile: cli suppresses API-REFERENCE despite an endpoint surface (Bug #5)', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'docs/openapi.yaml': OPENAPI, // a genuine endpoint surface
    });

    // cli profile: the endpoint surface must NOT produce API-REFERENCE.
    const cliPlan = buildMemoryPlan(dir, { profile: 'cli' });
    assert.ok(cliPlan.surface.endpoints.length >= 2, 'surface still detects the endpoints');
    const cliPaths = cliPlan.docs.map(d => d.path);
    assert.ok(!cliPaths.includes('docs-canonical/API-REFERENCE.md'), 'cli profile must not propose API-REFERENCE');
    assert.ok((cliPlan.notes || []).some(n => /API-REFERENCE/.test(n)),
      'a suppression note must explain why (anti-false-green)');

    // standard profile (permissive) still emits it from the same surface.
    const stdPlan = buildMemoryPlan(dir, { profile: 'standard' });
    assert.ok(stdPlan.docs.map(d => d.path).includes('docs-canonical/API-REFERENCE.md'),
      'standard profile is surface-driven');
  });

  it('code sections are marked and human sections carry a task + grounding', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'docs/openapi.yaml': OPENAPI,
    });
    const plan = buildMemoryPlan(dir, {});
    const api = plan.docs.find(d => d.path.endsWith('API-REFERENCE.md'));
    const code = api.sections.find(s => s.source === 'code');
    // Code section holds the raw code-truth body (a markdown table); the writer wraps it in markers.
    assert.equal(code.id, 'endpoints');
    assert.ok(/\| Method \| Path \| Auth \|/.test(code.body), 'code section body is the endpoints table');
    const human = api.sections.find(s => s.source === 'human');
    assert.ok(human.task && human.grounding);
  });
});
