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
 * @req docguard.file-kinds#FR-007
 * @req docguard.file-kinds#FR-008
 * @req docguard.file-kinds#FR-009
 * @req docguard.file-kinds#FR-010
 * @req docguard.file-kinds#SC-001
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
import { agentInstructionDocs } from '../cli/shared-agent-instructions.mjs';
import { fileKind } from '../cli/shared-file-kind.mjs';
import { measureInstructionChains } from '../cli/scanners/agent-instructions.mjs';
import { validateStructure } from '../cli/validators/structure.mjs';
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
    const copy = p => fileKind(p, {}, { describesFolder: true, kinds: ['template', 'fixture'] }).kind;
    assert.equal(copy('.cursor/rules/templates/x.mdc'), 'own');
    assert.equal(copy('.claude/skills/templates/SKILL.md'), 'own');
    assert.equal(copy('Templates/App/AGENTS.md'), 'template');
    assert.equal(copy('apps/web/templates/base/.claude/rules/a.md'), 'template');
    assert.equal(copy('src/main/java/com/example/AGENTS.md'), 'own');
  });
});

describe('FR-002 — fileKinds.own puts a file back in the role', () => {
  it('an own glob rescues a template and a fixture path, and silences PSR006', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': RULES, 'tests/fixtures/repo/AGENTS.md': RULES });
    const config = { fileKinds: { own: ['templates/new-app/**', 'tests/fixtures/repo/AGENTS.md'] } };
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
    assert.match(hits[0].suggestion.text, /fileKinds\.own/);
  });

  it('a fixture copy is reported with low confidence and names .docguardignore', t => {
    const dir = repo(t, { 'CLAUDE.md': RULES, 'tests/fixtures/repo/CLAUDE.md': RULES });
    const hits = psr006(dir);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].confidence, 'low');
    assert.match(hits[0].suggestion.text, /\.docguardignore/);
    assert.match(hits[0].suggestion.text, /fileKinds\.own/);
    assert.doesNotMatch(hits[0].suggestion.text, /agentInstructions\.governing/);
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

// ── spec 100 Stage 1 ────────────────────────────────────────────────────────

const chainLeaves = (dir, config = {}) => measureInstructionChains(dir, config).map(c => c.leaf);
const kb = n => 'x'.repeat(n * 1024);

describe('D1 — the instruction-chain budget does not count a copy (spec 100 FR-009)', () => {
  it('a template copy adds nothing to STR004; a governing package file still does', t => {
    const dir = repo(t, { 'AGENTS.md': kb(20), 'templates/app/files/AGENTS.md': kb(20) });
    assert.deepEqual(chainLeaves(dir), ['AGENTS.md']);
    const code = validateStructure(dir, { requiredFiles: { canonical: [], agentFile: ['AGENTS.md'], driftLog: 'DRIFT-LOG.md' } }).findings.map(f => f.code);
    assert.ok(!code.includes('STR004'), 'a template must not push the chain over 32 KiB');
    const real = repo(t, { 'AGENTS.md': kb(20), 'packages/api/AGENTS.md': kb(20) });
    assert.deepEqual(chainLeaves(real), ['AGENTS.md', 'packages/api/AGENTS.md']);
    const over = validateStructure(real, { requiredFiles: { canonical: [], agentFile: ['AGENTS.md'], driftLog: 'DRIFT-LOG.md' } }).findings.map(f => f.code);
    assert.ok(over.includes('STR004'));
  });

  it('a fixture copy is skipped, and a case-variant folder is skipped like the lowercase one (D5)', t => {
    const dir = repo(t, { 'AGENTS.md': kb(1), 'tests/fixtures/repo/AGENTS.md': kb(30), 'Examples/x/AGENTS.md': kb(30), 'Fixtures/f/AGENTS.md': kb(30), 'Templates/t/AGENTS.md': kb(30) });
    assert.deepEqual(chainLeaves(dir), ['AGENTS.md']);
  });

  it('templates/AGENTS.md governs its folder and is counted; the copy beside it is not', t => {
    const dir = repo(t, { 'AGENTS.md': kb(1), 'templates/AGENTS.md': kb(2), 'templates/app/files/AGENTS.md': kb(30) });
    assert.deepEqual(chainLeaves(dir), ['AGENTS.md', 'templates/AGENTS.md']);
  });

  it('fileKinds.own puts a copy back in the budget', t => {
    const dir = repo(t, { 'AGENTS.md': kb(1), 'templates/app/files/AGENTS.md': kb(2) });
    assert.deepEqual(chainLeaves(dir, { fileKinds: { own: ['templates/app/**'] } }), ['AGENTS.md', 'templates/app/files/AGENTS.md']);
  });

  it('tests/AGENTS.md governs tests/: counted by the budget, still out of the role (spec 094)', t => {
    const dir = repo(t, { 'AGENTS.md': kb(1), 'tests/AGENTS.md': RULES });
    assert.deepEqual(chainLeaves(dir), ['AGENTS.md', 'tests/AGENTS.md']);
    assert.deepEqual(agentInstructionDocs(dir, {}).docs.map(d => d.path), ['AGENTS.md']);
    assert.deepEqual(psr006(dir), []);
  });
});

describe('D5 — case-variant folders leave the role exactly as lowercase ones do', () => {
  it('Examples/, Fixtures/, TEMPLATES/ and Starter-Kit/ copies are out of the role', t => {
    const dir = repo(t, {
      'AGENTS.md': RULES, 'Examples/x/AGENTS.md': RULES, 'Fixtures/f/AGENTS.md': RULES, 'TEMPLATES/t/AGENTS.md': RULES,
      'Starter-Kit/s/AGENTS.md': RULES, 'skeleton/k/CLAUDE.md': RULES, 'corpus/c/AGENTS.md': RULES,
    });
    assert.deepEqual(agentInstructionDocs(dir, {}).docs.map(d => d.path), ['AGENTS.md']);
  });

  it('PSR006 names a case-variant copy', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'Examples/x/AGENTS.md': RULES, 'TEMPLATES/t/AGENTS.md': RULES });
    assert.deepEqual(psr006(dir).map(h => [h.location, h.confidence]), [['Examples/x/AGENTS.md', 'low'], ['TEMPLATES/t/AGENTS.md', 'high']]);
  });
});

describe('FR-010 — nothing is dropped silently', () => {
  const guardJson = (dir, extra = {}) => {
    const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
    return JSON.parse(r.stdout);
  };
  const config = extra => JSON.stringify({ projectName: 'fx', enforcement: 'standard', ...extra });

  it('guard JSON counts every kind and lists the instruction files left out, per kind', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, 'tests/fixtures/r/CLAUDE.md': RULES, '.docguard.json': config() });
    const kinds = guardJson(dir).files.kinds;
    assert.equal(kinds.counts.template, 1);
    assert.ok(kinds.counts.fixture >= 1);
    assert.ok(kinds.counts.own >= 3);
    assert.deepEqual(kinds.excluded.template, ['templates/new-app/files/AGENTS.md']);
    assert.deepEqual(kinds.excluded.fixture, ['tests/fixtures/r/CLAUDE.md']);
    assert.equal(kinds.excluded.own, undefined);
  });

  it('caps each list at 20 paths and says how many more there were', t => {
    const files = { 'AGENTS.md': RULES, '.docguard.json': config() };
    for (let i = 0; i < 25; i++) files[`templates/app${String(i).padStart(2, '0')}/files/AGENTS.md`] = TEMPLATE;
    const kinds = guardJson(repo(t, files)).files.kinds;
    assert.equal(kinds.excluded.template.length, 20);
    assert.equal(kinds.counts.template, 25);
    assert.equal(kinds.excludedMore.template, 5);
  });

  it('fileKinds.own empties the list', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, '.docguard.json': config({ fileKinds: { own: ['templates/new-app/**'] } }) });
    const kinds = guardJson(dir).files.kinds;
    assert.deepEqual(kinds.excluded, {});
    assert.equal(kinds.counts.template, undefined);
  });

  it('text output prints one line naming the count and fileKinds.own, and none when nothing was left out', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, 'tests/fixtures/r/CLAUDE.md': RULES, '.docguard.json': config() });
    const out = spawnSync(process.execPath, [CLI, 'guard'], { cwd: dir, encoding: 'utf8' }).stdout;
    const lines = out.split('\n').filter(l => /left out of review as copies/.test(l));
    assert.equal(lines.length, 1, out.slice(0, 3000));
    assert.match(lines[0], /2 instruction file\(s\)/);
    assert.match(lines[0], /fileKinds\.own/);
    const clean = repo(t, { 'AGENTS.md': RULES, '.docguard.json': config() });
    assert.doesNotMatch(spawnSync(process.execPath, [CLI, 'guard'], { cwd: clean, encoding: 'utf8' }).stdout, /left out of review as copies/);
  });

  it('the lite (--changed-only) path carries no files field', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': TEMPLATE, '.docguard.json': config() });
    const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json', '--changed-only'], { cwd: dir, encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).files, undefined);
  });
});

describe('agentInstructions.governing is gone (spec 100 FR-004)', () => {
  it('the old key no longer rescues a copy', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'templates/new-app/files/AGENTS.md': RULES });
    assert.deepEqual(agentInstructionDocs(dir, { agentInstructions: { governing: ['templates/**'] } }).docs.map(d => d.path), ['AGENTS.md']);
  });
});
