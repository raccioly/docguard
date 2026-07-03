/**
 * Instruction Audit scanner tests (field report #11 — MemoryLint-inspired).
 *
 * Drift/conflict audit WITHIN agent instruction files: duplicates, direct
 * negation pairs, stale pointers, stale docguard commands (deterministic) +
 * topically-clustered rule pairs staged as LLM judgment tasks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  auditInstructions,
  extractInstructionRules,
  buildInstructionAuditTasks,
} from '../cli/scanners/instruction-audit.mjs';
import { runVerify } from '../cli/commands/verify.mjs';

describe('Instruction Audit scanner', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-instraudit-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const write = (name, content) => writeFileSync(join(tmpDir, name), content);

  it('(a) duplicate rule across AGENTS.md and CLAUDE.md is detected', () => {
    write('AGENTS.md', '# Agent Rules\n\n## Workflow\n\nThis project uses ESM.\n\n- Always run `docguard guard` before committing.\n');
    write('CLAUDE.md', '# Claude Rules\n\n## Checks\n\n- Always run `docguard guard` before committing.\n');
    const { rules, deterministic } = auditInstructions(tmpDir, {});
    // "This project uses ESM." has no imperative signal — not a rule (precision).
    assert.equal(rules.length, 2);
    assert.equal(rules[0].section, 'Workflow');
    assert.equal(rules[1].section, 'Checks');
    assert.equal(deterministic.duplicates.length, 1);
    const files = deterministic.duplicates[0].rules.map(r => r.file).sort();
    assert.deepEqual(files, ['AGENTS.md', 'CLAUDE.md']);
    // Identical copies are a duplicate, not a negation conflict.
    assert.equal(deterministic.negations.length, 0);
  });

  it('(b) never-vs-always negation pair is detected', () => {
    write('AGENTS.md', '# Rules\n\n## Style\n\n- Never use tabs for indentation.\n');
    write('CLAUDE.md', '# Rules\n\n## Style\n\n- Always use tabs for indentation.\n');
    const { deterministic, tasks } = auditInstructions(tmpDir, {});
    assert.equal(deterministic.negations.length, 1);
    const n = deterministic.negations[0];
    assert.deepEqual([n.a.file, n.b.file].sort(), ['AGENTS.md', 'CLAUDE.md']);
    assert.ok(n.common.includes('tabs'), n.common);
    // Not double-reported: neither a duplicate nor an LLM task.
    assert.equal(deterministic.duplicates.length, 0);
    assert.equal(tasks.length, 0);
  });

  it('(c) rule pointing at a missing file is flagged as a stale pointer; existing paths are not', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    write(join('docs-canonical', 'REAL.md'), '# Real\n');
    write('AGENTS.md', [
      '# Rules', '', '## Docs', '',
      '- You must read `docs-canonical/NOPE.md` before editing docs.',
      '- You should consult `docs-canonical/REAL.md` for the architecture.',
      '',
    ].join('\n'));
    const { deterministic } = auditInstructions(tmpDir, {});
    assert.equal(deterministic.stalePointers.length, 1);
    assert.equal(deterministic.stalePointers[0].path, 'docs-canonical/NOPE.md');
    assert.equal(deterministic.stalePointers[0].file, 'AGENTS.md');
    assert.equal(deterministic.stalePointers[0].line, 5);
  });

  it('(d) `docguard frobnicate` is flagged as an unknown command; `docguard guard` is not', () => {
    write('AGENTS.md', [
      '# Rules', '', '## CI', '',
      '- You must run `docguard frobnicate` after every merge.',
      '- Always run `docguard guard` in CI.',
      '- The `audit` alias must keep working: `docguard audit`.',
      '',
    ].join('\n'));
    const { deterministic } = auditInstructions(tmpDir, {});
    assert.equal(deterministic.staleCommands.length, 1);
    assert.equal(deterministic.staleCommands[0].command, 'frobnicate');
    assert.equal(deterministic.staleCommands[0].line, 5);
  });

  it('(e) generated CLAUDE.md (docguard:agents-sync marker) is skipped', () => {
    const rule = '- Always run `docguard guard` before committing.\n';
    write('AGENTS.md', `# Rules\n\n## Workflow\n\n${rule}`);
    write('CLAUDE.md', `<!-- docguard:agents-sync source=AGENTS.md hash=0123456789abcdef -->\n<!-- Do not edit — regenerate with: docguard agents --sync -->\n# Rules\n\n## Workflow\n\n${rule}`);
    const { rules, deterministic } = auditInstructions(tmpDir, {});
    assert.ok(rules.every(r => r.file === 'AGENTS.md'), 'generated mirror must contribute no rules');
    assert.equal(deterministic.duplicates.length, 0, 'a generated mirror must not be flagged against its source');
  });

  it('(f) topically-clustered pair (≥2 shared stems) produces an LLM task, cross-file first', () => {
    write('AGENTS.md', '# Rules\n\n## Testing\n\n- Always write unit tests for new validators.\n');
    write('CLAUDE.md', '# Rules\n\n## Testing\n\n- Unit tests should be skipped for experimental validators.\n');
    const { tasks } = auditInstructions(tmpDir, {});
    assert.equal(tasks.length, 1);
    const t = tasks[0];
    assert.equal(t.id, 'verify.instructions.1');
    assert.equal(t.crossFile, true);
    assert.deepEqual([t.a.file, t.b.file].sort(), ['AGENTS.md', 'CLAUDE.md']);
    assert.ok(t.sharedTerms.length >= 2, `expected ≥2 shared terms, got ${t.sharedTerms}`);
    assert.ok(t.instruction.includes('AGENTS.md:'), t.instruction);
    assert.ok(t.instruction.includes('CLAUDE.md:'), t.instruction);
    assert.equal(t.confidence, 'requires-human');
  });

  it('(g) clean file → zero findings, zero tasks (precision check)', () => {
    write('AGENTS.md', [
      '# Agent Rules', '', '## Workflow', '',
      '- Always run the linter before pushing.',
      '- Never store secrets in the repository.',
      '',
    ].join('\n'));
    const { rules, deterministic, tasks } = auditInstructions(tmpDir, {});
    assert.equal(rules.length, 2);
    assert.equal(deterministic.duplicates.length, 0);
    assert.equal(deterministic.negations.length, 0);
    assert.equal(deterministic.stalePointers.length, 0);
    assert.equal(deterministic.staleCommands.length, 0);
    assert.equal(tasks.length, 0);
  });

  it('extraction skips fenced code blocks and captures paragraph sentences', () => {
    write('AGENTS.md', [
      '# Rules', '', '## Setup', '',
      '```bash', '# you must never run this comment as a rule', 'docguard frobnicate', '```', '',
      'Install deps first. You must never commit node_modules.',
      '',
    ].join('\n'));
    const { rules, deterministic } = auditInstructions(tmpDir, {});
    assert.equal(rules.length, 1);
    assert.equal(rules[0].text, 'You must never commit node_modules.');
    assert.equal(rules[0].line, 10);
    // The fenced `docguard frobnicate` is an example, not a rule.
    assert.equal(deterministic.staleCommands.length, 0);
  });

  it('buildInstructionAuditTasks caps at 40 tasks', () => {
    const rules = [];
    for (let i = 0; i < 25; i++) {
      rules.push({ file: 'AGENTS.md', line: i + 1, section: 'X', text: `Always validate the payload schema strictly variant${i}.` });
    }
    const tasks = buildInstructionAuditTasks(rules);
    assert.ok(tasks.length <= 40, `expected ≤40 tasks, got ${tasks.length}`);
    assert.equal(tasks.length, 40); // 25 clustered rules → 300 pairs, capped
  });

  it('runVerify --instructions --format json emits the machine artifact', () => {
    write('AGENTS.md', '# Rules\n\n## Style\n\n- Never use tabs for indentation.\n- You must read `docs-canonical/NOPE.md` first.\n');
    write('CLAUDE.md', '# Rules\n\n## Style\n\n- Always use tabs for indentation.\n');
    const lines = [];
    const orig = console.log;
    console.log = (s) => lines.push(String(s));
    try {
      runVerify(tmpDir, { projectName: 'fixture' }, { instructions: true, format: 'json' });
    } finally {
      console.log = orig;
    }
    const out = JSON.parse(lines.join('\n'));
    assert.equal(out.command, 'verify --instructions');
    assert.equal(out.project, 'fixture');
    assert.equal(out.findings.negations.length, 1);
    assert.equal(out.findings.stalePointers.length, 1);
    assert.equal(out.findingCount, 2);
    assert.ok(Array.isArray(out.tasks));
    assert.ok(out.howToVerify.length > 0);
  });

  it('default semantic mode is untouched by the instructions branch', () => {
    write('AGENTS.md', '# Rules\n\nRetention is 30 days.\n');
    const lines = [];
    const orig = console.log;
    console.log = (s) => lines.push(String(s));
    try {
      runVerify(tmpDir, { projectName: 'fixture' }, { format: 'json' });
    } finally {
      console.log = orig;
    }
    const out = JSON.parse(lines.join('\n'));
    assert.equal(out.command, 'verify --semantic');
    assert.equal(out.claimCount, 1); // "30 days" duration claim
  });
});
