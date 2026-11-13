/**
 * Agent-instruction copies (specs/099-instruction-copies): a template or
 * fixture copy of an instruction file is not this repository's instructions
 * (FR-001, FR-002), and a copy that shares the real file's name is PSR006
 * (FR-003).
 *
 * @req docguard.instruction-copies#FR-001
 * @req docguard.instruction-copies#FR-002
 * @req docguard.instruction-copies#FR-003
 * @req docguard.instruction-copies#FR-004
 * @req docguard.instruction-copies#FR-006
 * @req docguard.instruction-copies#SC-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fixtureGit } from './helpers/git.mjs';
import { validateFreshness } from '../cli/validators/freshness.mjs';
import { validatePathScopedRules } from '../cli/validators/path-scoped-rules.mjs';
import { agentInstructionDocs, instructionCopyOf } from '../cli/shared-agent-instructions.mjs';
import { CODES } from '../cli/findings.mjs';

const CLI = resolve('cli/docguard.mjs');
const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
const code = (n, tag = 'v') => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};`).join('\n') + '\n';
const MARK = '<!-- docguard:last-reviewed 2025-03-01 -->\n';
const RULES = `${MARK}# Agents\n\nRun \`npm test\` before pushing.\n\n${Array.from({ length: 8 }, (_, i) => `- Rule ${i}: keep changes small.`).join('\n')}\n`;
const TEMPLATE = `${MARK}# Rules for agents and people working on {{appName}}\n\nRun \`npm test\` before pushing.\n\n${Array.from({ length: 8 }, (_, i) => `- Rule ${i}: follow {{appName}} conventions.`).join('\n')}\n`;

function commit(dir, files, message, date) {
  for (const [p, b] of Object.entries(files)) write(dir, p, b);
  fixtureGit(dir, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` };
  fixtureGit(dir, ['commit', '-q', '-m', message], { env });
}

function repo(t, files) {
  const dir = makeTempDir('docguard-copies-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  commit(dir, {
    'package.json': JSON.stringify({ name: 'fx', scripts: { test: 'node --test' } }, null, 2),
    'src/main.mjs': code(30),
    ...files,
  }, 'initial', '2025-03-01');
  return dir;
}

const psr006 = (dir, config = {}) => validatePathScopedRules(dir, config).findings.filter(f => f.code === 'PSR006');

describe('FR-001 — a template is not reviewed as this repository\'s instructions', () => {
  it('the reported case: a reviewed template plus a new root script gives FRS007 on the root file only', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE });
    commit(dir, { 'package.json': JSON.stringify({ name: 'fx', scripts: { test: 'node --test', report: 'node src/main.mjs' } }, null, 2) }, 'script', '2025-05-02');
    const hits = validateFreshness(dir, {}).filter(r => r.code === 'FRS007');
    assert.deepEqual(hits.map(h => h.doc), ['AGENTS.md']);
    assert.match(hits[0].message, /`report`/);
  });

  it('the template is out of the role; the role still lists the root file', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, 'scaffolds/web/CLAUDE.md': TEMPLATE });
    assert.deepEqual(agentInstructionDocs(dir, {}).docs.map(d => d.path), ['AGENTS.md']);
  });

  it('a file directly in a folder named templates governs that folder and stays in the role', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/AGENTS.md': RULES, 'packages/templates/AGENTS.md': RULES });
    assert.deepEqual(agentInstructionDocs(dir, {}).docs.map(d => d.path).sort(), ['AGENTS.md', 'packages/templates/AGENTS.md', 'templates/AGENTS.md']);
  });

  it('a template segment inside a harness dot-directory does not make a copy', () => {
    assert.equal(instructionCopyOf('.cursor/rules/templates/x.mdc', {}), null);
    assert.equal(instructionCopyOf('.claude/skills/templates/SKILL.md', {}), null);
    assert.equal(instructionCopyOf('Templates/App/AGENTS.md', {})?.kind, 'template');
    assert.equal(instructionCopyOf('apps/web/templates/base/.claude/rules/a.md', {})?.kind, 'template');
    assert.equal(instructionCopyOf('src/main/java/com/example/AGENTS.md', {}), null);
  });
});

describe('FR-002 — agentInstructions.governing puts a file back in the role', () => {
  it('a governing glob rescues a template and a fixture path, and silences PSR006', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': RULES, 'tests/fixtures/repo/AGENTS.md': RULES });
    const config = { agentInstructions: { governing: ['templates/new-app/**', 'tests/fixtures/repo/AGENTS.md'] } };
    assert.deepEqual(agentInstructionDocs(dir, config).docs.map(d => d.path).sort(), ['AGENTS.md', 'templates/new-app/files/AGENTS.md', 'tests/fixtures/repo/AGENTS.md']);
    assert.deepEqual(psr006(dir, config), []);
  });
});

describe('FR-003 — PSR006: a copy shares the real file\'s name', () => {
  it('names a template copy, the file it shares a name with, and the rename', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE });
    const hits = psr006(dir);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].location, 'templates/new-app/files/AGENTS.md');
    assert.equal(hits[0].severity, 'warn');
    assert.equal(hits[0].confidence, 'high');
    assert.match(hits[0].message, /same name as AGENTS\.md/);
    assert.match(hits[0].suggestion.text, /AGENTS\.md\.template/);
  });

  it('a fixture copy is reported with low confidence and names .docguardignore', t => {
    const dir = repo(t, { 'CLAUDE.md': RULES, 'tests/fixtures/repo/CLAUDE.md': RULES });
    const hits = psr006(dir);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].confidence, 'low');
    assert.match(hits[0].suggestion.text, /\.docguardignore/);
  });

  it('copilot instructions are matched by path tail, and configured agent files by basename', t => {
    const dir = repo(t, {
      '.github/copilot-instructions.md': RULES, 'templates/app/.github/copilot-instructions.md': RULES,
      'RULES.md': RULES, 'templates/app/files/RULES.md': RULES,
    });
    const hits = psr006(dir, { requiredFiles: { agentFile: 'RULES.md' } });
    assert.deepEqual(hits.map(h => h.location).sort(), ['templates/app/.github/copilot-instructions.md', 'templates/app/files/RULES.md']);
  });

  it('a nested AGENTS.md copy is reported against a nested governing file too', t => {
    const dir = repo(t, { 'packages/api/AGENTS.md': RULES, 'examples/demo/AGENTS.md': RULES });
    assert.deepEqual(psr006(dir).map(h => h.location), ['examples/demo/AGENTS.md']);
  });
});

describe('FR-003 — files that govern a folder stay quiet', () => {
  it('monorepo packages: no PSR006', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'packages/api/AGENTS.md': RULES, 'packages/web/CLAUDE.md': RULES, 'CLAUDE.md': RULES });
    assert.deepEqual(psr006(dir), []);
  });

  it('templates/AGENTS.md and packages/templates/AGENTS.md: no PSR006', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/AGENTS.md': RULES, 'packages/templates/AGENTS.md': RULES });
    assert.deepEqual(psr006(dir), []);
  });

  it('a lone template with no file of the same name: no PSR006', t => {
    const dir = repo(t, { 'CLAUDE.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE });
    assert.deepEqual(psr006(dir), []);
  });

  it('a copy listed in .docguardignore: no PSR006', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, '.docguardignore': 'templates/new-app/\n' });
    assert.deepEqual(psr006(dir), []);
  });

  it('a renamed template (AGENTS.md.template) and SKILL.md files: no PSR006', t => {
    const dir = repo(t, {
      'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md.template': TEMPLATE,
      '.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nDo a.\n', 'templates/new-app/files/.claude/skills/a/SKILL.md': '---\nname: a\n---\n\nDo a.\n',
    });
    assert.deepEqual(psr006(dir), []);
  });

  it('a project with only root instruction files sees the same Path-Scoped-Rules result as before (FR-006)', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'CLAUDE.md': '@AGENTS.md\n' });
    const result = validatePathScopedRules(dir, {});
    assert.deepEqual(result.findings, []);
  });
});

describe('FR-004 — catalog and explain', () => {
  it('PSR006 is in the catalog and docguard explain describes it', () => {
    assert.equal(CODES.PSR006?.validator, 'pathScopedRules');
    const r = spawnSync(process.execPath, [CLI, 'explain', 'PSR006'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PSR006/);
    assert.match(r.stdout, /\.template/);
  });

  it('guard reports PSR006 end to end', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, '.docguard.json': JSON.stringify({ projectName: 'fx', enforcement: 'standard' }) });
    const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    const json = JSON.parse(r.stdout);
    assert.ok(json.findings.some(f => f.code === 'PSR006' && f.location === 'templates/new-app/files/AGENTS.md'), r.stdout.slice(0, 2000));
  });
});
