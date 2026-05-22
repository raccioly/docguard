import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectIntegrations } from '../cli/scanners/integrations.mjs';
import { buildMemoryPlan } from '../cli/scanners/memory-plan.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-int-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('integrations scanner', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('detects polyglot integrations: AWS in JS + Stripe in Python', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: {
        '@aws-sdk/client-s3': '^3', '@aws-sdk/client-dynamodb': '^3', stripe: '^14',
      } }),
      'backend/pyproject.toml': '[project]\nname="api"\ndependencies = ["openai", "boto3", "sentry-sdk"]\n',
    });
    const r = detectIntegrations(dir);
    const names = r.map(i => i.name);
    assert.ok(names.includes('AWS'));
    assert.ok(names.includes('S3'));
    assert.ok(names.includes('DynamoDB'));
    assert.ok(names.includes('Stripe'));
    assert.ok(names.includes('OpenAI'));
    assert.ok(names.includes('Sentry'));
    const aws = r.find(i => i.name === 'AWS');
    assert.ok(aws.evidence.length >= 1, 'evidence carries the matching dep names');
  });

  it('returns empty when no recognized SDKs are present', () => {
    dir = make({ 'package.json': JSON.stringify({ dependencies: { lodash: '^4' } }) });
    assert.equal(detectIntegrations(dir).length, 0);
  });
});

describe('memory plan — extended doc set', () => {
  let dir;
  const openapi = ['openapi: 3.0.3','info:','  title: t','  version: 1.0.0','paths:','  /api/health:','    get:','      summary: h'].join('\n');
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('webapp plan includes ARCHITECTURE + FEATURES + INTEGRATIONS + docs-implementation', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: {
        react: '^19', 'react-router-dom': '^6', '@aws-sdk/client-s3': '^3', stripe: '^14',
      } }),
      'docs/openapi.yaml': openapi,
      'src/App.tsx': '<Route path="/dashboard" element={<DashboardPage/>}/><Route path="/admin/users" element={<AdminUsersPage/>}/>',
      'src/components/Button.tsx': 'export const Button=()=>null;',
    });
    const plan = buildMemoryPlan(dir, { sourceRoot: 'src' });
    const paths = plan.docs.map(d => d.path);

    // New canonical docs from this phase:
    assert.ok(paths.includes('docs-canonical/FEATURES.md'), 'FEATURES.md included for webapp with screens');
    assert.ok(paths.includes('docs-canonical/INTEGRATIONS.md'), 'INTEGRATIONS.md included when SDKs detected');

    // docs-implementation set (agent-only):
    assert.ok(paths.includes('docs-implementation/KNOWN-GOTCHAS.md'));
    assert.ok(paths.includes('docs-implementation/CURRENT-STATE.md'));
    assert.ok(paths.includes('docs-implementation/RUNBOOKS.md'));

    // INTEGRATIONS code section lists the detected SDKs.
    const ints = plan.docs.find(d => d.path.endsWith('INTEGRATIONS.md'));
    const intCode = ints.sections.find(s => s.source === 'code');
    assert.ok(/S3/.test(intCode.body) && /Stripe/.test(intCode.body), 'integrations table lists detected services');

    // FEATURES code section groups screens by area.
    const feats = plan.docs.find(d => d.path.endsWith('FEATURES.md'));
    const featCode = feats.sections.find(s => s.source === 'code');
    assert.ok(/admin/.test(featCode.body) && /dashboard/.test(featCode.body), 'feature areas grouped by URL prefix');

    // Implementation docs have ONLY agent tasks (no code-truth to derive).
    for (const p of ['docs-implementation/KNOWN-GOTCHAS.md', 'docs-implementation/CURRENT-STATE.md', 'docs-implementation/RUNBOOKS.md']) {
      const d = plan.docs.find(x => x.path === p);
      assert.ok(d.sections.every(s => s.source === 'human'), `${p} is agent-task-only`);
    }
  });

  it('a project with no integrations and no UI omits INTEGRATIONS.md and FEATURES.md', () => {
    dir = make({ 'Cargo.toml': '[package]\nname="lib"\n\n[dependencies]\nserde = "1"\n', 'src/lib.rs': 'pub fn x(){}' });
    const plan = buildMemoryPlan(dir);
    const paths = plan.docs.map(d => d.path);
    assert.ok(!paths.includes('docs-canonical/INTEGRATIONS.md'));
    assert.ok(!paths.includes('docs-canonical/FEATURES.md'));
    // But implementation docs are always included (agent-authored, applicable anywhere).
    assert.ok(paths.includes('docs-implementation/KNOWN-GOTCHAS.md'));
  });
});
