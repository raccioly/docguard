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
