/**
 * Spec 104, Stage 2 (T024): with no `docs.language` (and with `docs.language`
 * "en" and no aliases), the changelog, decision-record, lifecycle, Spec Kit and
 * requirement-placeholder results are byte-identical to the ones the CLI produced
 * before the registry reached them.
 *
 * The golden was generated from the CLI at origin/main, before the change; this
 * test is green on both sides by design. It is the regression gate, not a
 * reproduction. Regenerate it only for a reviewed intentional English change:
 *   UPDATE_GOLDEN=1 node --test tests/document-languages-english-identity-stage2.test.mjs
 *
 * @req docguard.document-languages#FR-006
 * @req docguard.document-languages#SC-004
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateChangelog } from '../cli/validators/changelog.mjs';
import { validateDecisionRecords, normalizeStatus, parseAdrFile } from '../cli/validators/decision-records.mjs';
import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';
import { scanDocumentLifecycle } from '../cli/scanners/document-lifecycle.mjs';
import { parseLifecycleStatus, RETIRED_STATUSES } from '../cli/scanners/lifecycle-status.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { validateRequirementAnchors } from '../cli/validators/requirement-anchors.mjs';
import { hasPlaceholderSlot, isPlaceholderRequirement } from '../cli/shared-requirement-ids.mjs';
import { applyMechanicalFix } from '../cli/writers/mechanical.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = join(ROOT, 'tests/fixtures/languages/english-identity-stage2.golden.json');

const SPEC = (extra = '') => `# Feature Specification: Thing\n\n**Status**: Active\n\n## User Scenarios & Testing\n\n### Story 1\n\nGiven a user, when they act, then it works.\n\n## Requirements\n\n- **FR-001**: The system MUST do the thing.\n- **FR-002**: The system MUST [capability].\n\n## Success Criteria\n\n- **SC-001**: It works.\n${extra}`;
const PLAN = '# Plan\n\n## Summary\n\nx\n\n## Technical Context\n\nNode.\n\n## Project Structure\n\nsrc/\n';
const TASKS = '# Tasks\n\n## Phase 1: Setup\n\n- [ ] T001 do it\n';

const CASES = {
  'changelog-bracketed': { 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n' },
  'changelog-lowercase': { 'CHANGELOG.md': '# Changelog\n\n## [unreleased]\n\n## [1.0.0] - 2026-01-01\n' },
  'changelog-bare-heading': { 'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## [1.0.0] - 2026-01-01\n' },
  'changelog-none': { 'CHANGELOG.md': '# Changelog\n\n## [1.0.0] - 2026-01-01\n' },
  'changelog-no-versions': { 'CHANGELOG.md': '# Changelog\n\nNothing yet.\n' },
  'changelog-substring': { 'CHANGELOG.md': '# Changelog\n\nSee [Unreleased] work in the tracker.\n\n## [1.0.0] - 2026-01-01\n' },
  'changelog-marker-restating': { 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n<!-- docguard:heading unreleased -->\n\n## [1.0.0] - 2026-01-01\n' },
  'decisions-single-file': {
    'docs-canonical/ADR.md': '# ADR\n\n## ADR-001: a\n\n**Status**: ✅ Accepted\n\n## ADR-002: b\n\nNo status here.\n\n## ADR-003: c\n\n**Status:** Done\n\n## ADR-004: d\n\n### Status (ADR-004)\n**Approved**\n\n## ADR-005: e\n\n- Status: Superseded by ADR-006\n\n## ADR-006: f\n\n**Status**: Accepted\n\nSupersedes ADR-005\n\n## ADR-007: g\n\n**Status**: Accepted\n\nSupersedes: ADR-099\n\n## ADR-008: h\n\n| Status | Draft |\n|---|---|\n\n| ID | Status |\n|---|---|\n| ADR-001 | Accepted |\n| ADR-004 | Rejected |\n| ADR-042 | Accepted |\n',
  },
  'decisions-front-matter': {
    'docs/adr/0003-use-x.md': '---\nstatus: accepted\nsupersedes: [adr-0001]\n---\n# Use X\n',
    'docs/adr/0001-use-y.md': '---\nstatus: superseded\nsuperseded_by: adr-0003\n---\n# Use Y\n',
    'docs/adr/0002-use-z.md': '---\nstatus: Wibble\n---\n# Use Z\n',
    'docs/adr/0004-use-w.md': '---\nstatus: obsolete\n---\n# Use W\n',
    'docs/adr/0005-use-v.md': '# Use V\n\nStatus: replaced\n\nSuperseded by ADR-0003.\n',
  },
  'decisions-questions-terminal': {
    'specs/001-a/spec.md': '# A\n\n**Status**: Superseded\n\n## Clarifications\n\n- Q: what? → A:\n',
    'specs/002-b/spec.md': '# B\n\n**Status**: Active\n\n## Clarifications\n\n- Q: what? → A:\n',
    'docs-canonical/ADR.md': '# ADR\n\n## ADR-001: a\n\n**Status**: Accepted\n',
  },
  'lifecycle-statuses': {
    'docs/a.md': '# A\n\n**Status**: Archived\n\nText.\n',
    'docs/b.md': '# B\n\nStatus: superseded\n\nText.\n',
    'docs/c.md': '# C\n\n**Status:** Active\n\nText.\n',
    'docs/d.md': '# D\n\nStatus quo is that this is fine.\n',
    'docs/e.md': '# E\n\n## Status\n\nDeprecated\n',
    'docs/f.md': '# F\n\n**Status**: Complete\n',
    'README.md': '# R\n',
  },
  'speckit-complete': { '.specify/memory/constitution.md': '# C\n', 'specs/001-thing/spec.md': SPEC(), 'specs/001-thing/plan.md': PLAN, 'specs/001-thing/tasks.md': TASKS },
  'speckit-missing': {
    '.specify/memory/constitution.md': '# C\n',
    'specs/001-thing/spec.md': '# Spec\n\n##### Requirements\n\nx\n\n## Notes\n\nFR-001 only.\n',
    'specs/001-thing/plan.md': '# Plan\n\n## Overview\n\nx\n',
    'specs/001-thing/tasks.md': '# Tasks\n\n- [ ] T001 do it\n',
  },
  'speckit-deep-headings': {
    '.specify/memory/constitution.md': '# C\n',
    'specs/001-thing/spec.md': '# Spec\n\n#### Functional Requirements\n\nFR-001 x\n\n### User Scenarios\n\nx\n\n### Success Criteria\n\nSC-001 x\n',
    'specs/001-thing/plan.md': '# Plan\n\n#### Summary\n\nx\n\n### Technical Context\n\nx\n\n## Project Structure Overview\n\nx\n',
    'specs/001-thing/tasks.md': '# Tasks\n\nPhase 2 work\n\n- [ ] T001 do it\n',
  },
  'speckit-bugfix': {
    '.specify/memory/constitution.md': '# C\n',
    'specs/001-bug/spec.md': '# Bug\n\n<!-- docguard:spec-type bugfix -->\n\n## Root Cause\n\nx\n\n## Fix\n\ny\n',
    'specs/002-bug/spec.md': '# Bug\n\n<!-- docguard:spec-type bugfix -->\n\n## Symptom\n\nx\n',
  },
  'speckit-terminal-spec': {
    '.specify/memory/constitution.md': '# C\n',
    'specs/001-old/spec.md': SPEC().replace('Active', 'Archived'),
    'specs/001-old/plan.md': PLAN,
    'specs/001-old/tasks.md': TASKS,
  },
  'requirements-placeholders': {
    'docs-canonical/REQUIREMENTS.md': '# Req\n\n- **FR-001**: The system MUST [capability]\n- **FR-002**: Users MUST be able to [action]\n- **FR-003**: The exporter MUST write {file} to the output directory.\n- **FR-004**: O sistema DEVE [capacidade]\n- **FR-005**: El sistema DEBE [capacidad]\n- **FR-006**: The system MUST validate input.\n| FR-007 | System MUST [x] |\n',
    'src/a.js': '// @req FR-006\nexport const a = 1;\n',
  },
};

function writeProject(files) {
  const dir = makeTempDir('docguard-english-identity2-');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'fixture']);
  return dir;
}

const strip = value => JSON.parse(JSON.stringify(value));

/** A validator result reduced to what the readers decide: counts, applicability and each finding's code, message and location. */
const brief = result => strip({
  passed: result.passed, total: result.total, applicable: result.applicable, applicability: result.applicability,
  findings: (result.findings || []).map(f => [f.code, f.message, f.location]),
});

/** Results of the Stage 2 readers on one project, with nothing volatile in them. */
function snapshot(dir, withDocs = null) {
  const loaded = loadConfig(dir);
  const config = withDocs ? { ...loaded, docs: { ...(loaded.docs || {}), ...withDocs } } : loaded;
  const out = {
    changelog: brief(validateChangelog(dir, config)),
    decisions: brief(validateDecisionRecords(dir, config)),
    speckit: brief(validateSpecKitIntegration(dir, config)),
    lifecycle: strip(scanDocumentLifecycle(dir, config)),
    traceability: brief(validateTraceability(dir, config)),
    anchors: brief(validateRequirementAnchors(dir, config)),
    scoreChangelog: runScoreInternal(dir, config).categories.changelog,
  };
  if (existsSync(join(dir, 'CHANGELOG.md'))) {
    const scratch = makeTempDir('docguard-english-identity2-fix-');
    cpSync(dir, scratch, { recursive: true });
    out.fixInsert = strip({
      result: applyMechanicalFix(scratch, { type: 'insert-changelog-unreleased', file: 'CHANGELOG.md' }, { config }),
      written: readFileSync(join(scratch, 'CHANGELOG.md'), 'utf8'),
    });
  }
  return out;
}

function pure() {
  const adr = '## ADR-001: a\n\n**Status**: Aceito\n\nSubstitui ADR-000\n\n## ADR-002: b\n\n**Status**: Accepted\n\nSupersedes ADR-001\n\n| ID | Status |\n|---|---|\n| ADR-002 | Approved |\n';
  const def = text => ({ id: 'FR-001', text: `- **FR-001**: ${text}`, file: 'docs/R.md' });
  return strip({
    statuses: ['Accepted', '✅ **Accepted**', 'Approved', 'draft', 'Proposal', 'obsolete', 'replaced', 'Aceito', 'en desuso', 'Done', '', null].map(raw => normalizeStatus(raw)),
    parsed: parseAdrFile(adr, 'ADR.md'),
    lifecycle: ['**Status**: Archived\n', 'Status: Active\n', '# T\n\n## Status\n\nDeprecated\n', 'Estado: Archivado\n', 'Situação: obsoleto\n', 'Status quo\n', 'no status\n'].map(text => parseLifecycleStatus(text)),
    retired: [...RETIRED_STATUSES].sort(),
    placeholders: ['The system MUST [capability]', 'O sistema DEVE [capacidade]', 'El sistema DEBE [capacidad]', 'Users MUST be able to [action]', 'The exporter MUST write {file} to the output directory.', 'Os usuários DEVEM [ação]', 'Deve [x]'].map(text => [hasPlaceholderSlot(def(text)), isPlaceholderRequirement(def(text))]),
  });
}

function shippedProjects() {
  const out = [];
  for (const parent of ['examples', 'benchmarks/fixtures']) {
    const base = join(ROOT, parent);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name);
      if (statSync(dir).isDirectory()) out.push([`${parent}/${name}`, dir]);
    }
  }
  return out;
}

function collect(only = null, withDocs = null) {
  const out = { pure: pure() };
  for (const [name, files] of Object.entries(CASES)) out[name] = snapshot(writeProject(files), withDocs);
  for (const [name, dir] of shippedProjects()) if (!only || only.includes(name)) out[name] = snapshot(dir, withDocs);
  return JSON.parse(JSON.stringify(out));
}

describe('English identity of the changelog, decision, lifecycle, Spec Kit and requirement readers (T024)', () => {
  it('results equal the golden generated before the registry reached them', () => {
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(collect(), null, 2) + '\n');
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const actual = collect(Object.keys(golden));
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(golden).sort());
    for (const name of Object.keys(golden)) assert.deepEqual(actual[name], golden[name], `${name} changed for an English project`);
  });

  it('docs.language "en" without aliases gives the same results as no language', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const actual = collect(Object.keys(golden), { language: 'en' });
    for (const name of Object.keys(golden).filter(key => key !== 'pure')) assert.deepEqual(actual[name], golden[name], `${name} changed under docs.language "en"`);
  });
});
