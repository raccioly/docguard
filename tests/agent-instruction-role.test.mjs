/**
 * One agent-instruction document role (specs/094-agent-instruction-role).
 *
 * @req docguard.agent-instruction-role#FR-001
 * @req docguard.agent-instruction-role#FR-002
 * @req docguard.agent-instruction-role#FR-003
 * @req docguard.agent-instruction-role#FR-004
 * @req docguard.agent-instruction-role#FR-005
 * @req docguard.agent-instruction-role#FR-006
 * @req docguard.agent-instruction-role#FR-007
 * @req docguard.agent-instruction-role#FR-008
 * @req docguard.agent-instruction-role#FR-009
 * @req docguard.agent-instruction-role#FR-010
 * @req docguard.agent-instruction-role#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureGit } from './helpers/git.mjs';
import { agentInstructionDocs, rootAgentDocs } from '../cli/shared-agent-instructions.mjs';
import { validateFreshness } from '../cli/validators/freshness.mjs';
import { validatePathScopedRules } from '../cli/validators/path-scoped-rules.mjs';
import { candidateDocs } from '../cli/scanners/doc-deps.mjs';
import { extractSemanticClaims } from '../cli/scanners/semantic-claims.mjs';
import { extractInstructionRules } from '../cli/scanners/instruction-audit.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

/** A repository with `files` committed once, then `codeCommits` commits to src/app.js. */
function repo(t, files, { codeCommits = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-air-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  write(dir, 'src/app.js', 'export const n = 0;\n');
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-q', '-m', 'docs']);
  for (let i = 1; i <= codeCommits; i++) {
    write(dir, 'src/app.js', `export const n = ${i};\n`);
    fixtureGit(dir, ['commit', '-q', '-am', `code ${i}`]);
  }
  return dir;
}

const OLD = '<!-- docguard:last-reviewed 2025-01-02 -->\n';
const SUBSTANTIVE = `${OLD}# Rules\n\n${Array.from({ length: 12 }, (_, i) => `- Rule ${i + 1}: always run the suite before step ${i + 1}.`).join('\n')}\n`;

const US1 = {
  'AGENTS.md': SUBSTANTIVE,
  'CLAUDE.md': SUBSTANTIVE,
  'GEMINI.md': SUBSTANTIVE,
  '.github/copilot-instructions.md': SUBSTANTIVE,
  'packages/api/AGENTS.md': SUBSTANTIVE,
  '.claude/skills/deploy/SKILL.md': `---\nname: deploy\ndescription: deploy it\n---\n${SUBSTANTIVE}`,
  '.cursor/rules/style.mdc': `---\nalwaysApply: true\n---\n${SUBSTANTIVE}`,
  'tests/fixtures/sample/AGENTS.md': SUBSTANTIVE,
};

const paths = docs => docs.map(d => d.path).sort();
const frs = (results, code = 'FRS002') => results.filter(r => r.code === code).map(r => r.doc).sort();

describe('US1 — every agent instruction file is in one role', () => {
  it('lists root, nested, Copilot, Gemini, skill and Cursor files, not fixture copies (FR-001)', t => {
    const dir = repo(t, US1);
    const { docs } = agentInstructionDocs(dir, {});
    assert.deepEqual(paths(docs), [
      '.claude/skills/deploy/SKILL.md', '.cursor/rules/style.mdc', '.github/copilot-instructions.md',
      'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'packages/api/AGENTS.md',
    ]);
    const byPath = Object.fromEntries(docs.map(d => [d.path, d]));
    assert.equal(byPath['GEMINI.md'].kind, 'gemini-memory');
    assert.equal(byPath['AGENTS.md'].root, true);
    assert.equal(byPath['.github/copilot-instructions.md'].root, true);
    assert.equal(byPath['packages/api/AGENTS.md'].root, false);
    assert.equal(byPath['.claude/skills/deploy/SKILL.md'].root, false);
  });

  it('includes a configured requiredFiles.agentFile as a root document (FR-001, FR-002)', t => {
    const dir = repo(t, { 'docs/AGENT-GUIDE.md': SUBSTANTIVE });
    const config = { requiredFiles: { agentFile: ['docs/AGENT-GUIDE.md'] } };
    const doc = agentInstructionDocs(dir, config).docs.find(d => d.path === 'docs/AGENT-GUIDE.md');
    assert.ok(doc, 'configured agent file must be in the role');
    assert.equal(doc.kind, 'configured');
    assert.ok(rootAgentDocs(dir, config).includes('docs/AGENT-GUIDE.md'));
  });

  it('gives every root-level reader the same set (FR-002)', t => {
    const dir = repo(t, {
      ...US1,
      'GEMINI.md': `${OLD}# Gemini\n\nThe import job must finish within 45 seconds.\nYou must never edit generated files.\n`,
    });
    assert.deepEqual(rootAgentDocs(dir, {}).sort(), ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
    const candidates = candidateDocs(dir, {});
    for (const p of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']) {
      assert.ok(candidates.includes(p), `doc-deps candidates miss ${p}`);
    }
    const claims = extractSemanticClaims(dir, {});
    assert.ok(claims.some(c => c.doc === 'GEMINI.md'), 'semantic claims must read GEMINI.md');
    const rules = extractInstructionRules(dir, {});
    assert.ok(rules.some(r => r.file === 'GEMINI.md'), 'instruction audit must read GEMINI.md');
  });

  it('no reader outside the role module keeps its own agent-file list (FR-002)', () => {
    const offenders = [];
    const walk = d => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.mjs') && !p.endsWith('shared-agent-instructions.mjs')) {
          const src = readFileSync(p, 'utf8').split('\n').filter(l => !/agentFile:/.test(l)).join('\n');
          if (/\[\s*'AGENTS\.md',\s*'CLAUDE\.md'/.test(src) || /\[\s*'README\.md',\s*'AGENTS\.md'\s*\]/.test(src)
            || /\[\.\.\.evidenceDocs\([^)]*\),\s*'README\.md',\s*'AGENTS\.md'\]/.test(src)) offenders.push(p);
        }
      }
    };
    walk(resolve('cli'));
    assert.deepEqual(offenders, []);
  });

  it('reports FRS002 for an old GEMINI.md and authored skills (FR-003)', t => {
    const dir = repo(t, US1, { codeCommits: 11 });
    const due = frs(validateFreshness(dir, {}));
    for (const p of ['GEMINI.md', '.github/copilot-instructions.md', '.claude/skills/deploy/SKILL.md', 'packages/api/AGENTS.md']) {
      assert.ok(due.includes(p), `expected FRS002 for ${p}, got ${due.join(', ')}`);
    }
    assert.ok(!due.includes('tests/fixtures/sample/AGENTS.md'));
  });
});

const TESTGUARD_CLAUDE = `# TestGuard\n\n${OLD}\nFollow \`AGENTS.md\` — it is the project's workflow and rules for every agent.\n\nIf a \`CLAUDE.local.md\` exists it carries the maintainer's local tooling\n(OpenWolf context hooks) and is not part of the repository.\n`;

describe('US2 — pointer files are reviewed through their target', () => {
  it('detects TestGuard-style and @import pointers (FR-004)', t => {
    const dir = repo(t, {
      'AGENTS.md': SUBSTANTIVE,
      'CLAUDE.md': TESTGUARD_CLAUDE,
      'GEMINI.md': '@AGENTS.md\n',
    });
    const byPath = Object.fromEntries(agentInstructionDocs(dir, {}).docs.map(d => [d.path, d]));
    assert.deepEqual(byPath['CLAUDE.md'].pointer, { target: 'AGENTS.md', via: 'path' });
    assert.deepEqual(byPath['GEMINI.md'].pointer, { target: 'AGENTS.md', via: 'import' });
    assert.equal(byPath['AGENTS.md'].pointer, null);
  });

  it('gives a pointer no FRS and names its target in a skip (FR-005)', t => {
    const dir = repo(t, { 'AGENTS.md': SUBSTANTIVE, 'CLAUDE.md': TESTGUARD_CLAUDE }, { codeCommits: 11 });
    const results = validateFreshness(dir, {});
    assert.deepEqual(frs(results), ['AGENTS.md']);
    const skip = results.find(r => r.status === 'skip' && r.doc === 'CLAUDE.md');
    assert.ok(skip, 'pointer must record a skip');
    assert.match(skip.message, /CLAUDE\.md points to AGENTS\.md; reviewed through it/);
  });

  it('a substantive CLAUDE.md is not a pointer (FR-004 control)', t => {
    const dir = repo(t, { 'AGENTS.md': SUBSTANTIVE, 'CLAUDE.md': `${SUBSTANTIVE}\nFollow \`AGENTS.md\` too.\n` }, { codeCommits: 11 });
    assert.deepEqual(frs(validateFreshness(dir, {})), ['AGENTS.md', 'CLAUDE.md']);
  });

  it('a pointer to an untracked local file has no reviewed target (FR-004, FR-005)', t => {
    const dir = repo(t, {
      'AGENTS.md': SUBSTANTIVE,
      'CLAUDE.md': '# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf for context management.\n',
    }, { codeCommits: 11 });
    const doc = agentInstructionDocs(dir, {}).docs.find(d => d.path === 'CLAUDE.md');
    assert.deepEqual(doc.pointer, { target: null, via: 'import' });
    const results = validateFreshness(dir, {});
    assert.ok(!frs(results).includes('CLAUDE.md'));
    assert.match(results.find(r => r.status === 'skip' && r.doc === 'CLAUDE.md').message, /no reviewed target/);
  });

  it('a pointer cycle has no reviewed target (edge case)', t => {
    const dir = repo(t, { 'CLAUDE.md': '@GEMINI.md\n', 'GEMINI.md': '@CLAUDE.md\n' });
    const byPath = Object.fromEntries(agentInstructionDocs(dir, {}).docs.map(d => [d.path, d]));
    assert.equal(byPath['CLAUDE.md'].pointer.target, null);
    assert.equal(byPath['GEMINI.md'].pointer.target, null);
  });
});

const SPECKIT_SKILL = '---\nname: speckit-plan\n---\n\n## Outline\n\n1. Run `.specify/scripts/bash/setup-plan.sh --json`.\n';
const DG_SKILL = '---\nname: docguard-guard\n---\n\n# DocGuard guard\n\nRun `docguard guard`.\n';

function vendoredRepo(t, { edit = false, manifest } = {}) {
  const files = {
    'AGENTS.md': SUBSTANTIVE,
    '.claude/skills/speckit-plan/SKILL.md': edit ? `${SPECKIT_SKILL}\nLocal edit.\n` : SPECKIT_SKILL,
    '.claude/skills/docguard-guard/SKILL.md': DG_SKILL,
    '.claude/skills/deploy/SKILL.md': `---\nname: deploy\n---\n${SUBSTANTIVE}`,
    '.specify/integrations/claude.manifest.json': manifest ?? JSON.stringify({
      integration: 'claude', version: '1.1.3',
      files: { '.claude/skills/speckit-plan/SKILL.md': sha(SPECKIT_SKILL), '../outside.md': sha('x') },
    }),
  };
  return repo(t, files, { codeCommits: 11 });
}

describe('US3 — vendored copies are excluded and checked for drift', () => {
  it('marks manifest and DocGuard copies vendored with their source (FR-006)', t => {
    const dir = vendoredRepo(t);
    const byPath = Object.fromEntries(agentInstructionDocs(dir, {}).docs.map(d => [d.path, d]));
    assert.equal(byPath['.claude/skills/speckit-plan/SKILL.md'].vendored.source, 'spec-kit:claude');
    assert.equal(byPath['.claude/skills/speckit-plan/SKILL.md'].vendored.version, '1.1.3');
    assert.equal(byPath['.claude/skills/docguard-guard/SKILL.md'].vendored.source, 'docguard');
    assert.equal(byPath['.claude/skills/deploy/SKILL.md'].vendored, null);
  });

  it('Freshness checks only the authored skill (FR-003, FR-006)', t => {
    const due = frs(validateFreshness(vendoredRepo(t), {}));
    assert.ok(due.includes('.claude/skills/deploy/SKILL.md'));
    assert.ok(!due.includes('.claude/skills/speckit-plan/SKILL.md'));
    assert.ok(!due.includes('.claude/skills/docguard-guard/SKILL.md'));
  });

  it('PSR005 for an edited manifest copy, none for an intact one (FR-007)', t => {
    const edited = validatePathScopedRules(vendoredRepo(t, { edit: true }), {});
    const hits = edited.findings.filter(f => f.code === 'PSR005');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].location, '.claude/skills/speckit-plan/SKILL.md');
    assert.match(hits[0].message, /differs from the copy Spec Kit installed \(claude integration 1\.1\.3\)/);
    assert.equal(hits[0].disposition, 'escalate');
    const intact = validatePathScopedRules(vendoredRepo(t), {});
    assert.equal(intact.findings.filter(f => f.code === 'PSR005').length, 0);
  });

  it('a malformed manifest vendors nothing and is reported as partial coverage (FR-006)', t => {
    const dir = vendoredRepo(t, { manifest: '{ not json' });
    const { docs, limitations } = agentInstructionDocs(dir, {});
    // The manifest vendors nothing; the core Spec Kit name still marks it Spec Kit's, without hashes.
    assert.deepEqual(docs.find(d => d.path === '.claude/skills/speckit-plan/SKILL.md').vendored, { source: 'spec-kit' });
    assert.ok(limitations.some(l => /claude\.manifest\.json/.test(l)), limitations.join('; '));
    const psr = validatePathScopedRules(dir, {});
    assert.equal(psr.findings.filter(f => f.code === 'PSR005').length, 0);
    assert.match(psr.applicability?.reason || '', /claude\.manifest\.json/);
  });
});

describe('FR-008 — the common layout is unchanged', () => {
  it('AGENTS.md plus a substantive CLAUDE.md: both checked, as before', t => {
    const dir = repo(t, { 'AGENTS.md': SUBSTANTIVE, 'CLAUDE.md': SUBSTANTIVE }, { codeCommits: 11 });
    assert.deepEqual(frs(validateFreshness(dir, {})), ['AGENTS.md', 'CLAUDE.md']);
  });
});

describe('FR-009, FR-010 — documented and benchmarked', () => {
  it('PSR005 is registered and documented; ARCHITECTURE lists exit 4 (FR-009)', async () => {
    const { CODES } = await import('../cli/findings.mjs');
    assert.equal(CODES.PSR005?.validator, 'pathScopedRules');
    assert.match(readFileSync(resolve('docs/reference/findings.md'), 'utf8'), /PSR005/);
    const arch = readFileSync(resolve('docs-canonical/ARCHITECTURE.md'), 'utf8');
    assert.match(arch, /Exit code: 0 \(pass\) \| 1 \(fail\) \| 2 \(warn\) \| 3 [^\n]*\| 4 /);
    assert.match(arch, /`4` \(a validator that had to decide did not/);
  });

  it('the corpus holds a PSR005 defect and control in each split, in disjoint groups (FR-010)', () => {
    const { cases } = JSON.parse(readFileSync(resolve('benchmarks/corpus.json'), 'utf8'));
    const psr = cases.filter(c => c.scope.codes.includes('PSR005'));
    for (const split of ['development', 'evaluation']) {
      const mine = psr.filter(c => c.split === split);
      assert.deepEqual(mine.map(c => c.classification).sort(), ['clean_control', 'defect'], split);
    }
    const groups = new Set(psr.map(c => `${c.split}:${c.repositoryGroup}`));
    assert.equal(groups.size, 2);
  });
});

describe('FR-006 — Spec Kit extension and core skills are vendored', () => {
  it('reads extension skills from .specify/extensions/.registry and core skill names in a Spec Kit project', t => {
    const dir = repo(t, {
      'AGENTS.md': SUBSTANTIVE,
      '.specify/extensions/.registry': JSON.stringify({ schema_version: '1.0', extensions: {
        docguard: { version: '0.46.0', registered_commands: { claude: ['speckit.docguard.guard'] }, registered_skills: [] },
        git: { version: '1.0.1', registered_commands: {}, registered_skills: ['speckit-git-feature'] },
      } }),
      '.claude/skills/speckit-docguard-guard/SKILL.md': DG_SKILL,
      '.claude/skills/speckit-git-feature/SKILL.md': SUBSTANTIVE,
      '.agent/skills/speckit-analyze/SKILL.md': SUBSTANTIVE,
      '.claude/skills/release-checklist/SKILL.md': SUBSTANTIVE,
    }, { codeCommits: 11 });
    const byPath = Object.fromEntries(agentInstructionDocs(dir, {}).docs.map(d => [d.path, d]));
    assert.equal(byPath['.claude/skills/speckit-docguard-guard/SKILL.md'].vendored.source, 'spec-kit-extension:docguard');
    assert.equal(byPath['.claude/skills/speckit-git-feature/SKILL.md'].vendored.source, 'spec-kit-extension:git');
    assert.equal(byPath['.agent/skills/speckit-analyze/SKILL.md'].vendored.source, 'spec-kit');
    assert.equal(byPath['.claude/skills/release-checklist/SKILL.md'].vendored, null);
    const due = frs(validateFreshness(dir, {}));
    assert.ok(due.includes('.claude/skills/release-checklist/SKILL.md'));
    assert.ok(!due.some(p => /speckit-/.test(p)), due.join(', '));
  });

  it('core Spec Kit names are not vendored in a project without .specify/', t => {
    const dir = repo(t, { '.claude/skills/speckit-plan/SKILL.md': SUBSTANTIVE });
    assert.equal(agentInstructionDocs(dir, {}).docs.find(d => d.path === '.claude/skills/speckit-plan/SKILL.md').vendored, null);
  });
});

describe('A/B regressions — pointer and generated-file boundaries', () => {
  it('a short CLAUDE.md with its own commands is not a pointer (FR-004)', t => {
    const dir = repo(t, {
      'AGENTS.md': SUBSTANTIVE,
      'CLAUDE.md': '# OpenWolf\n\n@.wolf/OPENWOLF.md\n\nThis project uses OpenWolf. Read and follow .wolf/OPENWOLF.md every session.\n\n## Local Development\n- `./start.sh` starts both servers.\n- Backend dev: `cd backend && pnpm dev`\n- Frontend dev: `cd frontend && pnpm dev`\n',
    });
    assert.equal(agentInstructionDocs(dir, {}).docs.find(d => d.path === 'CLAUDE.md').pointer, null);
  });

  it('a skill with a "generated by <tool>" header is vendored by that tool (FR-006)', t => {
    const dir = repo(t, {
      '.claude/skills/security-pass/SKILL.md': '---\nname: security-pass\n---\n<!-- generated by websec-validator 0.19.0 — re-run `websec install claude` to refresh -->\n\n## Security reviews\n',
      '.claude/skills/owned/SKILL.md': '---\nname: owned\n---\n<!-- generated by setup-workspace; edit freely, then delete this line so it is kept -->\nDo the thing.\n',
    });
    const byPath = Object.fromEntries(agentInstructionDocs(dir, {}).docs.map(d => [d.path, d]));
    assert.equal(byPath['.claude/skills/security-pass/SKILL.md'].vendored.source, 'generated:websec-validator');
    assert.equal(byPath['.claude/skills/owned/SKILL.md'].vendored, null);
  });
});
