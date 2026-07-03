import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { assessAgentReadability } from '../cli/scanners/agent-readability.mjs';

describe('Agent Readability scanner', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-agentread-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const metric = (res, key) => res.metrics.find(m => m.key === key);

  it('empty project → low score, agent-entry fails with a fix', () => {
    const res = assessAgentReadability(tmpDir, {});
    const entry = metric(res, 'agent-entry');
    assert.equal(entry.score, 0);
    assert.ok(entry.fix.includes('AGENTS.md'));
    assert.ok(res.score < 40, `expected F-range score, got ${res.score}`);
    assert.equal(res.grade, 'F');
  });

  it('well-formed repo → high score across metrics', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'),
      '# Agent Rules\n\n## Workflow\n\n- Read [ARCHITECTURE](docs-canonical/ARCHITECTURE.md) first\n- Run guard\n\n## Rules\n\n| Rule | Why |\n|---|---|\n| No deps | zero-dep core |\n');
    writeFileSync(join(tmpDir, 'llms.txt'), '# proj\n> AI index\n');
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'),
      '# Architecture\n<!-- docguard:last-reviewed 2026-07-01 -->\n\n## Components\n\n| Name | Role |\n|---|---|\n| cli | entry |\n\n## Data Flow\n\n- in → validate → out\n');
    const res = assessAgentReadability(tmpDir, {});
    assert.equal(metric(res, 'agent-entry').score, 100);
    assert.equal(metric(res, 'token-budget').score, 100);
    assert.equal(metric(res, 'llms-txt').score, 100);
    assert.equal(metric(res, 'marker-presence').score, 100);
    assert.equal(metric(res, 'self-containedness').score, 100);
    assert.ok(res.score >= 75, `expected ≥75, got ${res.score} (grade ${res.grade})`);
  });

  it('broken relative link in AGENTS.md → self-containedness penalized, link named', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'),
      '# Rules\n\n## Docs\n\nSee [missing](docs-canonical/NOPE.md) for details.\n');
    const res = assessAgentReadability(tmpDir, {});
    const sc = metric(res, 'self-containedness');
    assert.equal(sc.score, 0);
    assert.ok(sc.detail.includes('docs-canonical/NOPE.md'), sc.detail);
    assert.ok(sc.fix);
  });

  it('duplicate H2 headings in a canonical doc → addressability penalized and named', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'DATA-MODEL.md'),
      '# Data Model\n\n## Entities\n\nshort\n\n## Entities\n\nduplicate heading\n');
    const res = assessAgentReadability(tmpDir, {});
    const addr = metric(res, 'addressability');
    assert.ok(addr.detail.includes('duplicate headings'), addr.detail);
    assert.ok(addr.detail.includes('DATA-MODEL.md'), addr.detail);
    assert.ok(addr.score <= 70, `duplicate should cost ≥30 points, got ${addr.score}`);
  });

  it('bloated AGENTS.md → token-budget penalized', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'), '# Rules\n\n## X\n\n' + 'word '.repeat(9000));
    const res = assessAgentReadability(tmpDir, {});
    const tb = metric(res, 'token-budget');
    assert.ok(tb.score <= 40, `expected heavy penalty, got ${tb.score}`);
    assert.ok(tb.fix);
  });

  it('CLAUDE.md counts as the entry file when AGENTS.md is absent', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# Rules\n\n## Workflow\n\n- do the thing\n');
    const res = assessAgentReadability(tmpDir, {});
    assert.equal(metric(res, 'agent-entry').score, 100);
    assert.ok(metric(res, 'agent-entry').detail.includes('CLAUDE.md'));
  });
});
