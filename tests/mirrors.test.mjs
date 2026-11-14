/**
 * Mirrors (specs/100-file-kinds, Stage 3): copies of one thing for different agent harnesses are
 * evaluated once and reported once, and mirrors that differ are drift. Every case is built so the
 * defect shows on the CLI from before the change.
 *
 * @req docguard.file-kinds#FR-014
 * @req docguard.file-kinds#FR-015
 * @req docguard.file-kinds#SC-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { fixtureGit } from './helpers/git.mjs';
import { clearFileKindCache } from '../cli/shared-file-kind.mjs';
import { collapseMirrorFindings, differingLines, lineSimilarity, mirrorDrift, mirrorOrder } from '../cli/shared-mirrors.mjs';
import { CODES } from '../cli/findings.mjs';

const CLI = resolve('cli/docguard.mjs');
const write = (dir, path, body) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };

function commit(dir, files, message, date) {
  for (const [p, b] of Object.entries(files)) write(dir, p, b);
  fixtureGit(dir, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00Z`, GIT_COMMITTER_DATE: `${date}T12:00:00Z` };
  fixtureGit(dir, ['commit', '-q', '-m', message], { env });
}

function repo(t, files = {}, date = '2025-03-01') {
  clearFileKindCache();
  const dir = makeTempDir('docguard-mirrors-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  commit(dir, { 'package.json': JSON.stringify({ name: 'fx', scripts: { test: 'node --test' } }, null, 2), 'src/main.mjs': 'export const a = 1;\n', ...files }, 'initial', date);
  return dir;
}

const guard = (dir, ...args) => spawnSync(process.execPath, [CLI, 'guard', ...args], { cwd: dir, encoding: 'utf8' });
const guardJson = (dir, ...args) => JSON.parse(guard(dir, '--format', 'json', ...args).stdout);
const findings = (dir, code) => guardJson(dir).findings.filter(f => f.code === code);

/** An instruction file with two dead pointers (lines 4 and 5) and enough lines to be a real document. */
const RULES = [
  '# Rules for agents', '', 'Use npm for every command.',
  'See docs/MISSING.md for the long version.', 'Setup lives in ./scripts/gone.sh and nowhere else.',
  'Run the tests before every commit.', 'Keep changes small and reviewed.', 'Never commit secrets.', '',
].join('\n');
const ROOT_MIRRORS = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];

describe('FR-014: identical mirrors are evaluated once and reported once', () => {
  it('one defect in three identical root files is one finding naming all three (the audit case)', t => {
    const dir = repo(t, Object.fromEntries(ROOT_MIRRORS.map(p => [p, RULES])));
    const hits = findings(dir, 'PSR002');
    assert.equal(hits.length, 2, JSON.stringify(hits.map(h => [h.location, h.message])));
    for (const h of hits) {
      assert.equal(h.location.split(':')[0], 'AGENTS.md', 'raised on the first path in the fixed order');
      assert.deepEqual(h.mirrors, ROOT_MIRRORS);
    }
    assert.deepEqual(hits.map(h => h.location), ['AGENTS.md:4', 'AGENTS.md:5']);
  });

  it('GEMINI.md is read like the others: a fourth identical copy joins the one finding', t => {
    const dir = repo(t, Object.fromEntries([...ROOT_MIRRORS, 'GEMINI.md'].map(p => [p, RULES])));
    const hits = findings(dir, 'PSR002');
    assert.equal(hits.length, 2);
    assert.deepEqual(hits[0].mirrors, ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']);
  });

  it('a GEMINI.md that stands alone has its dead pointers reported (it was not read at all)', t => {
    const dir = repo(t, { 'GEMINI.md': RULES });
    const hits = findings(dir, 'PSR002');
    assert.deepEqual(hits.map(h => h.location), ['GEMINI.md:4', 'GEMINI.md:5']);
    assert.equal(hits[0].mirrors, undefined, 'one file is not a mirror group');
  });

  it('identical skill copies under two agent roots: one finding, both paths listed', t => {
    const skill = '---\nname: demo\ndescription: Demo skill\n---\n\nRun `scripts/missing.sh` first.\nThen report.\n';
    const dir = repo(t, { '.claude/skills/demo/SKILL.md': skill, '.agents/skills/demo/SKILL.md': skill });
    const hits = findings(dir, 'PSR002');
    assert.equal(hits.length, 1, JSON.stringify(hits.map(h => [h.location, h.message])));
    assert.equal(hits[0].location.split(':')[0], '.agents/skills/demo/SKILL.md', 'lexically first root');
    assert.deepEqual(hits[0].mirrors, ['.agents/skills/demo/SKILL.md', '.claude/skills/demo/SKILL.md']);
  });

  it('text output says where else the finding applies', t => {
    const dir = repo(t, Object.fromEntries(ROOT_MIRRORS.map(p => [p, RULES])));
    const out = guard(dir).stdout;
    assert.match(out, /also in: CLAUDE\.md, \.github\/copilot-instructions\.md/);
    assert.equal((out.match(/points at docs\/MISSING\.md/g) || []).length, 1);
  });

  it('a pointer file is not a mirror: its target is checked once and the pointer is not listed', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'CLAUDE.md': '@AGENTS.md\n' });
    const hits = findings(dir, 'PSR002');
    assert.equal(hits.length, 2);
    assert.equal(hits[0].mirrors, undefined);
  });

  it('a symlinked CLAUDE.md is not double counted and not listed', t => {
    const dir = repo(t, { 'AGENTS.md': RULES });
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-q', '-m', 'link']);
    const hits = findings(dir, 'PSR002');
    assert.equal(hits.length, 2);
    assert.equal(hits[0].mirrors, undefined);
  });

  it('findings that still differ after the path is replaced are different findings: all kept', () => {
    const f = (file, n) => ({ code: 'FRS002', location: `${file}:1`, message: `${file} has ${n} commits since review`, suggestion: { text: 'review' } });
    const clusters = [{ kind: 'instruction', paths: ['AGENTS.md', 'CLAUDE.md'] }];
    const { findings: out, removed } = collapseMirrorFindings([f('AGENTS.md', 12), f('CLAUDE.md', 9)], clusters);
    assert.equal(removed, 0);
    assert.equal(out.length, 2);
  });

  it('the kept finding is on the first path in the fixed order, whatever order validators listed them', () => {
    const f = file => ({ code: 'X', location: `${file}:3`, message: `${file}:3 broken`, suggestion: null });
    const clusters = [{ kind: 'instruction', paths: ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'] }];
    const { findings: out } = collapseMirrorFindings([f('.github/copilot-instructions.md'), f('CLAUDE.md'), f('AGENTS.md')], clusters);
    assert.equal(out.length, 1);
    assert.equal(out[0].location, 'AGENTS.md:3');
    assert.deepEqual(out[0].mirrors, ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']);
  });

  it('guard JSON counts mirrors under files.mirrors', t => {
    const dir = repo(t, Object.fromEntries(ROOT_MIRRORS.map(p => [p, RULES])));
    const m = guardJson(dir).files.mirrors;
    assert.equal(m.groups, 1);
    assert.equal(m.identical, 1);
    assert.deepEqual(m.drift, []);
  });
});

describe('FR-015: mirrors that differ are drift', () => {
  const SKILL = n => `---\nname: demo\ndescription: Demo skill\n---\n\nStep one.\nStep two.\nStep three: ${n}\nStep four.\n`;

  it('two copies of one skill that differ: one warning naming both paths, the line count and the newer', t => {
    const dir = repo(t, { '.agents/skills/demo/SKILL.md': SKILL('old') }, '2025-01-01');
    commit(dir, { '.claude/skills/demo/SKILL.md': SKILL('new') }, 'add claude copy', '2025-06-01');
    const hits = findings(dir, 'PSR007');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /\.agents\/skills\/demo\/SKILL\.md/);
    assert.match(hits[0].message, /\.claude\/skills\/demo\/SKILL\.md/);
    assert.match(hits[0].message, /1 line differs/);
    assert.match(hits[0].message, /\.claude\/skills\/demo\/SKILL\.md is newer \(2025-06-01\)/);
    assert.deepEqual(hits[0].mirrors, ['.agents/skills/demo/SKILL.md', '.claude/skills/demo/SKILL.md']);
    assert.equal(hits[0].severity, 'warn');
  });

  it('commands at the same relative path under .agent and .claude are mirrors too', t => {
    const dir = repo(t, { '.agent/commands/go.md': 'Do the thing.\nThen stop.\n', '.claude/commands/go.md': 'Do the other thing.\nThen stop.\n' });
    assert.equal(findings(dir, 'PSR007').length, 1);
  });

  it('a pair whose newer copy cannot be told says so rather than guessing', t => {
    const dir = repo(t, { '.agents/skills/demo/SKILL.md': SKILL('a'), '.claude/skills/demo/SKILL.md': SKILL('b') });
    const [hit] = findings(dir, 'PSR007');
    assert.match(hit.message, /which is newer is unknown/);
  });

  it('a skill DocGuard installs says the installer regenerates it', t => {
    const body = n => `---\nname: docguard-guard\ndescription: Guard\n---\n\nRun guard.\nVersion ${n}.\n`;
    const dir = repo(t, { '.agent/skills/docguard-guard/SKILL.md': body('0.20'), '.claude/skills/docguard-guard/SKILL.md': body('0.46') });
    const [hit] = findings(dir, 'PSR007');
    assert.match(hit.message, /docguard upgrade/);
  });

  describe('the refresh the suggestion names is a command that exists and clears the finding', () => {
    const bundled = readFileSync(resolve('extensions/spec-kit-docguard/skills/docguard-fix/SKILL.md'), 'utf8');
    const claudeProject = (t, claudeBody, agentsBody) => repo(t, {
      '.specify/integration.json': JSON.stringify({ integration: 'claude' }),
      '.specify/integrations/claude.manifest.json': JSON.stringify({ integration: 'claude', version: '1.0.13', files: {} }),
      '.claude/skills/docguard-fix/SKILL.md': claudeBody, '.agents/skills/docguard-fix/SKILL.md': agentsBody,
    });

    it('a stale copy in the folder DocGuard writes: the named command rewrites it and PSR007 is gone', t => {
      const dir = claudeProject(t, `${bundled}\nstale line\n`, bundled);
      const [hit] = findings(dir, 'PSR007');
      assert.ok(hit);
      assert.match(hit.message, /\.claude\/skills\/docguard-fix\/SKILL\.md is in a folder DocGuard writes for this project: `docguard upgrade --apply --schema-only` rewrites it/);
      const run = spawnSync(process.execPath, [CLI, 'upgrade', '--apply', '--schema-only'], { cwd: dir, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      fixtureGit(dir, ['add', '-A']);
      assert.deepEqual(findings(dir, 'PSR007'), []);
    });

    it('a stale copy in a folder no DocGuard command writes: the text says so and names no command for it', t => {
      const dir = claudeProject(t, bundled, `${bundled}\nstale line\n`);
      const [hit] = findings(dir, 'PSR007');
      assert.match(hit.message, /\.agents\/skills\/docguard-fix\/SKILL\.md is not written by any DocGuard command here \(DocGuard writes only \.claude\/skills for this project\)/);
      assert.match(hit.suggestion.text, /copy the newer file over it or delete it/);
      assert.doesNotMatch(hit.suggestion.text, /Run `docguard upgrade[^`]*` to rewrite \.agents/);
    });
  });

  it('each copy names its own installer: an extension copy is refreshed by the extension, not by docguard upgrade', t => {
    const dir = repo(t, { '.specify/extensions/docguard/commands/guard.md': 'Run guard.\nVersion one.\n', '.agent/commands/guard.md': 'Run guard.\nVersion two.\n' });
    const [hit] = findings(dir, 'PSR007');
    assert.match(hit.message, /\.specify\/extensions\/docguard\/commands\/guard\.md was installed by a Spec Kit extension/);
    assert.doesNotMatch(hit.message, /docguard upgrade/);
  });

  const manifest = (integration, version, file) => JSON.stringify({ integration, version, files: { [file]: 'a'.repeat(64) } });
  const planSkill = h => `---\nname: speckit-plan\n---\nPlan it.\nInvoke with ${h}speckit-tasks.\n`;

  it('Spec Kit renders a skill for each harness: two integrations at one version differ by design', t => {
    const dir = repo(t, {
      '.specify/integrations/claude.manifest.json': manifest('claude', '1.0.13', '.claude/skills/speckit-plan/SKILL.md'),
      '.specify/integrations/codex.manifest.json': manifest('codex', '1.0.13', '.agents/skills/speckit-plan/SKILL.md'),
      '.claude/skills/speckit-plan/SKILL.md': planSkill('/'), '.agents/skills/speckit-plan/SKILL.md': planSkill('$'),
    });
    assert.deepEqual(findings(dir, 'PSR007'), []);
    assert.equal(guardJson(dir).files.mirrors.renderings, 1);
  });

  it('...but two integrations at different versions are a stale install: drift', t => {
    const dir = repo(t, {
      '.specify/integrations/claude.manifest.json': manifest('claude', '1.0.13', '.claude/skills/speckit-plan/SKILL.md'),
      '.specify/integrations/codex.manifest.json': manifest('codex', '1.0.9', '.agents/skills/speckit-plan/SKILL.md'),
      '.claude/skills/speckit-plan/SKILL.md': planSkill('/'), '.agents/skills/speckit-plan/SKILL.md': planSkill('$'),
    });
    const [hit] = findings(dir, 'PSR007');
    assert.ok(hit, 'a stale integration install is reported');
    assert.match(hit.message, /installed by a Spec Kit integration/);
  });

  it('a drift finding lists both sides in `mirrors` and the text prints no `also in:` line for it', t => {
    const dir = repo(t, { '.agent/commands/a.md': 'One.\nTwo.\n', '.claude/commands/a.md': 'One.\nThree.\n' });
    assert.deepEqual(findings(dir, 'PSR007')[0].mirrors, ['.agent/commands/a.md', '.claude/commands/a.md']);
    assert.doesNotMatch(guard(dir).stdout, /also in:/);
  });

  it('two renderings that differ only in the harness a generator header names are not drift', t => {
    const body = h => `---\nname: sec\ndescription: Security pass\n---\n<!-- generated by sectool 0.22.0 - re-run \`sectool install ${h}\` to refresh -->\nLine one.\nLine two.\n`;
    const dir = repo(t, { '.agents/skills/sec/SKILL.md': body('Codex'), '.claude/skills/sec/SKILL.md': body('claude') });
    assert.deepEqual(findings(dir, 'PSR007'), []);
  });

  it('...but a different generator version is', t => {
    const body = v => `---\nname: sec\ndescription: Security pass\n---\n<!-- generated by sectool ${v} - re-run \`sectool install x\` to refresh -->\nLine one.\nLine two.\n`;
    const dir = repo(t, { '.agents/skills/sec/SKILL.md': body('0.22.0'), '.claude/skills/sec/SKILL.md': body('0.19.0') });
    assert.equal(findings(dir, 'PSR007').length, 1);
  });

  it('two root instruction files that share most lines but disagree: a drift warning', t => {
    const yarn = RULES.replace('Use npm for every command.', 'Use yarn for every command.');
    const dir = repo(t, { 'AGENTS.md': RULES, 'CLAUDE.md': yarn });
    const hits = findings(dir, 'PSR008');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].message, /AGENTS\.md and CLAUDE\.md/);
    assert.match(hits[0].message, /share 85% of their lines/);
    assert.deepEqual(hits[0].mirrors, ['AGENTS.md', 'CLAUDE.md']);
  });

  it('two root instruction files that are simply different documents are not drift', t => {
    const other = ['# Claude notes', '', 'This repository ships a CLI.', 'Prefer small commits.', 'Write tests first.', 'Explain trade-offs in reviews.', 'Ask before adding dependencies.', ''].join('\n');
    const dir = repo(t, { 'AGENTS.md': RULES, 'CLAUDE.md': other });
    assert.deepEqual(findings(dir, 'PSR008'), []);
  });

  it('a file docguard agents --sync wrote is compared by agents --check, not here', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'CLAUDE.md': `<!-- docguard:agents-sync source=AGENTS.md hash=abcd -->\n${RULES.replace('npm', 'yarn')}` });
    assert.deepEqual(findings(dir, 'PSR008'), []);
  });

  it('a project whose only content is a pair of differing commands still gets the warning', t => {
    const dir = repo(t, { '.agent/commands/a.md': 'One.\nTwo.\n', '.claude/commands/a.md': 'One.\nThree.\n' });
    const r = guardJson(dir);
    assert.equal(r.findings.filter(f => f.code === 'PSR007').length, 1);
    assert.equal(r.files.mirrors.drift.length, 1);
  });
});

describe('different documents are never mirrors', () => {
  it('the same basename in different folders: no group, no finding', t => {
    const dir = repo(t, {
      'docs/X.md': '# One\n\nSee docs/MISSING.md for more.\nA second line.\n', 'docs/runbooks/X.md': '# Two\n\nSee docs/MISSING.md for more.\nA different line.\n',
      'docs-canonical/Y.md': '# Intent\n\nline\n', 'docs-implementation/Y.md': '# Built\n\nline\n',
      'packages/api/README.md': '# api\n', 'README.md': '# root\n',
    });
    const r = guardJson(dir);
    assert.equal(r.files.mirrors.groups, 0);
    assert.equal(r.findings.filter(f => /^PSR00[78]$/.test(f.code)).length, 0);
  });

  it('a nested AGENTS.md is compared only within its folder', t => {
    const dir = repo(t, { 'AGENTS.md': RULES, 'packages/api/AGENTS.md': RULES, 'packages/web/CLAUDE.md': '# web\n\nOne.\nTwo.\nThree.\nFour.\nFive.\n' });
    const m = guardJson(dir).files.mirrors;
    assert.equal(m.groups, 0, 'no folder holds two of the four names');
  });

  it('two instruction files under a template folder are not this project\'s mirrors', t => {
    const dir = repo(t, { 'templates/app/AGENTS.md': RULES, 'templates/app/CLAUDE.md': RULES });
    assert.equal(guardJson(dir).files.mirrors.groups, 0);
  });
});

describe('the pieces', () => {
  it('differingLines counts a replaced line once and an added line once', () => {
    assert.equal(differingLines('a\nb\nc\n', 'a\nB\nc\n'), 1);
    assert.equal(differingLines('a\nb\n', 'a\nb\nc\nd\n'), 2);
    assert.equal(differingLines('a\nb\n', 'a\nb\n'), 0);
  });
  it('lineSimilarity is the shared share of the longer file, ignoring blank lines and order', () => {
    assert.equal(lineSimilarity('a\n\nb\nc\nd\n', 'd\nc\nb\na\n'), 1);
    assert.equal(lineSimilarity('a\nb\nc\nd\n', 'a\nb\nc\nx\n'), 0.75);
    assert.equal(lineSimilarity('a\nb\n', 'x\ny\n'), 0);
  });
  it('the fixed order puts AGENTS.md first and the Copilot file last', () => {
    const sorted = ['.github/copilot-instructions.md', 'GEMINI.md', 'CLAUDE.md', 'AGENTS.md'].sort(mirrorOrder('instruction'));
    assert.deepEqual(sorted, ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']);
  });
  it('mirrorDrift reports groups, identical clusters and what it left out as renderings', t => {
    const dir = repo(t, { '.agents/skills/s/SKILL.md': 'a\nb\n', '.claude/skills/s/SKILL.md': 'a\nb\n', '.agents/skills/t/SKILL.md': 'a\nb\n', '.claude/skills/t/SKILL.md': 'a\nc\n' });
    const d = mirrorDrift(dir, {});
    assert.equal(d.groups, 2);
    assert.equal(d.identical, 1);
    assert.equal(d.skills.length, 1);
  });
  it('PSR007 and PSR008 are in the catalog with an explain text', () => {
    for (const c of ['PSR007', 'PSR008']) { assert.ok(CODES[c], c); assert.equal(CODES[c].validator, 'pathScopedRules'); }
    const r = spawnSync(process.execPath, [CLI, 'explain', 'PSR007'], { encoding: 'utf8' });
    assert.match(r.stdout, /PSR007/);
  });
});

describe('mirrors in SARIF and JUnit', () => {
  const data = {
    project: 'fx', timestamp: '2026-11-13T00:00:00.000Z', status: 'WARN', effectiveErrors: 0, effectiveWarnings: 1,
    validators: [{ name: 'Path-Scoped-Rules', key: 'pathScopedRules', status: 'warn', findings: [] }],
    findings: [{
      code: 'PSR002', validator: 'pathScopedRules', severity: 'warn', message: 'AGENTS.md:4 points at docs/MISSING.md, which does not exist',
      location: 'AGENTS.md:4', suggestion: null, mirrors: ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'],
    }],
  };
  data.validators[0].findings = data.findings;

  it('SARIF lists the other mirror paths as relatedLocations', async () => {
    const { toSarif } = await import('../cli/writers/sarif.mjs');
    const [result] = toSarif(data, { projectDir: '/tmp/proj' }).runs[0].results;
    assert.deepEqual(result.relatedLocations.map(r => r.physicalLocation.artifactLocation.uri), ['CLAUDE.md', '.github/copilot-instructions.md']);
  });

  it('JUnit keeps the other mirror paths in the failure text', async () => {
    const { toJUnit } = await import('../cli/writers/junit.mjs');
    const xml = toJUnit(data);
    assert.match(xml, /\[also in: CLAUDE\.md, \.github\/copilot-instructions\.md\]/);
  });
});
