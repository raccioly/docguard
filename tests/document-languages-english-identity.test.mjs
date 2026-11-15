/**
 * Spec 104, Stage 1 (T009): with no `docs.language`, the structural results
 * are byte-identical to the ones the CLI produced before the label registry.
 *
 * Two pins:
 *   1. A golden file of STR003/STR007, ENV001/ENV002, DCV005, Test-Spec and the
 *      Score's section-driven categories on English projects (inline cases and
 *      the shipped examples and benchmark fixtures). The golden was generated
 *      from the CLI at origin/main, before the change; this test is green on
 *      both sides by design: it is the regression gate, not a reproduction.
 *   2. A differential check: `docHasSection` and `findSectionHeading` against a
 *      frozen copy of the legacy matcher, for every registered English label
 *      against every heading of every Markdown file in the repository.
 *
 * Regenerate the golden only for a reviewed intentional English change:
 *   UPDATE_GOLDEN=1 node --test tests/document-languages-english-identity.test.mjs
 *
 * @req docguard.document-languages#FR-006
 * @req docguard.document-languages#SC-004
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { docHasSection, findSectionHeading } from '../cli/shared.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';
import { LABELS } from '../cli/shared-labels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = join(ROOT, 'tests/fixtures/languages/english-identity.golden.json');

const FULL_ARCH = '# Architecture\n\n## System Overview\n\nA tool that checks documents against code for teams that ship often.\n\n## Component Map\n\n| Module | Role |\n|---|---|\n| cli | entry |\n\n## Tech Stack\n\nNode.js 18, ES modules, node:test for the tests.\n\n## Layer Boundaries\n\nCommands call validators; validators call scanners.\n\n## External Dependencies\n\nNone at run time.\n\n## Revision History\n\n| Date | Change |\n|---|---|\n| 2026-01-01 | first |\n\n```mermaid\ngraph TD\n  A-->B\n```\n';
const BODY = '\nParagraph one of real prose that describes the thing.\nParagraph two of real prose that describes the thing.\nParagraph three of real prose that describes the thing.\nParagraph four of real prose that describes the thing.\nParagraph five of real prose that describes the thing.\nParagraph six of real prose that describes the thing.\n';

const CASES = {
  'exact-headings': {
    'docs-canonical/ARCHITECTURE.md': FULL_ARCH,
    'docs-canonical/DATA-MODEL.md': `# Data Model\n\n## Entities\n${BODY}\n## Relationships\n\nUser has many Orders.\n`,
    'docs-canonical/SECURITY.md': `# Security\n\n## Authentication\n${BODY}\n## Secrets Management\n\nSecrets live in the vault.\n`,
    'docs-canonical/TEST-SPEC.md': `# Test Spec\n\n## Test Categories\n${BODY}\n## Coverage Rules\n\n80 percent.\n\n## Source-to-Test Map\n\n| Source | Test | Status |\n|---|---|---|\n| src/a.js | tests/a.test.js | ✅ |\n`,
    'docs-canonical/ENVIRONMENT.md': `# Environment\n\n## Setup Steps\n${BODY}\n## Environment Variables\n\n| Name | Purpose |\n|---|---|\n| PORT | port |\n`,
    'README.md': '# Tool\n\n## Installation\n\nnpm i\n\n## Usage\n\nrun it\n\n## License\n\nMIT\n\n## Contributing\n\nPRs welcome\n',
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n',
    'src/a.js': 'export const a = 1;\n',
    'tests/a.test.js': 'test("a", () => {});\n',
  },
  'arc42-and-synonyms': {
    'docs-canonical/ARCHITECTURE.md': `# Arch\n\n## 3. System Context\n${BODY}\n## 5.4 Layer boundaries\n\nx\n\n## Building Block View\n\ny\n\n## Technology Stack\n\nz\n`,
    'docs-canonical/DATA-MODEL.md': `# Data\n\n## Data Models\n${BODY}`,
    'docs-canonical/SECURITY.md': `# Sec\n\n## Auth\n${BODY}\n## Secrets\n\nx\n`,
    'docs-canonical/TEST-SPEC.md': `# TS\n\n## Test Strategy\n${BODY}\n## Coverage\n\nx\n\n### 2. Service-to-Test Map\n\n| Service | Test |\n|---|---|\n| src/a.js | tests/a.test.js |\n`,
    'docs-canonical/ENVIRONMENT.md': `# Env\n\n## Getting Started\n${BODY}\n## Configuration Reference\n\n| a | b |\n`,
    'README.md': '# T\n\n## Getting started\n\ntext\n\n## Examples\n\ntext\n\n## Licence\n\nMIT\n',
    'src/a.js': 'export const a = 1;\n',
    'tests/a.test.js': 'test("a", () => {});\n',
  },
  'missing-sections': {
    'docs-canonical/ARCHITECTURE.md': `# Arch\n${BODY}\n## Overview\n\nx\n`,
    'docs-canonical/DATA-MODEL.md': `# Data\n${BODY}`,
    'docs-canonical/SECURITY.md': `# Sec\n${BODY}`,
    'docs-canonical/TEST-SPEC.md': `# TS\n${BODY}\n## Test Categories\n\nx\n`,
    'docs-canonical/ENVIRONMENT.md': `# Env\n${BODY}\n## Environment\n\nx\n\n## Production environment\n\ny\n`,
    'README.md': '# T\n\nJust a paragraph with the word usage and a license mention but no headings.\n',
  },
  'na-markers-and-profile-sections': {
    '.docguard.json': JSON.stringify({ requiredSections: { 'SECURITY.md': ['Risk Assessment', 'Authentication'] } }),
    'docs-canonical/SECURITY.md': `# Sec\n\n<!-- docguard:section authentication n/a — a CLI with no accounts -->\n<!-- docguard:section secrets-management n/a — nothing secret is handled -->\n${BODY}`,
    'docs-canonical/ARCHITECTURE.md': FULL_ARCH,
    'README.md': '# T\n\n## Install\n\nx\n\n## How to use\n\nx\n\n## License\n\nMIT\n\n## How to contribute\n\nx\n\n## About\n\nx\n',
  },
  'test-spec-shapes': {
    'docs-canonical/TEST-SPEC.md': '# TS\n\n## Test Categories\n\nx\n\n## Coverage Rules\n\nx\n\n#### Source-to-Test Map extra\n\n| Source File | Unit Test | Status |\n|---|---|---|\n| src/a.js | tests/a.test.js | ✅ |\n| src/missing.js | tests/missing.test.js | ❌ |\n',
    'src/a.js': 'export const a = 1;\n',
    'tests/a.test.js': 'test("a", () => {});\n',
  },
  'test-spec-absent-map': {
    'docs-canonical/TEST-SPEC.md': '# TS\n\n## Test Categories\n\nx\n\n## Coverage Rules\n\nx\n',
    'src/a.js': 'export const a = 1;\n',
    'tests/a.test.js': 'test("a", () => {});\n',
  },
  'marker-restating-heading': {
    'docs-canonical/ARCHITECTURE.md': FULL_ARCH.replace('## System Overview\n', '## System Overview\n<!-- docguard:heading system-overview -->\n'),
    'docs-canonical/ENVIRONMENT.md': `# Env\n\n## Setup Steps\n${BODY}\n## Environment Variables\n\nx\n`,
  },
};

function writeProject(files) {
  const dir = makeTempDir('docguard-english-identity-');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

/** The structural results of one project, with nothing volatile in them. */
function snapshot(dir) {
  const config = loadConfig(dir);
  const dcv005 = validateDocsCoverage(dir, config).findings?.filter(f => f.code === 'DCV005').map(f => ({ code: f.code, message: f.message, location: f.location })) ?? [];
  const score = runScoreInternal(dir, config).categories;
  return {
    docSections: validateDocSections(dir, config),
    environment: validateEnvironment(dir, config),
    testSpec: validateTestSpec(dir, config),
    dcv005,
    score: { docQuality: score.docQuality, architecture: score.architecture },
  };
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

/** `only` limits the shipped projects to the ones the golden holds, so a fixture added later is not a difference. */
function collect(only = null) {
  const out = {};
  for (const [name, files] of Object.entries(CASES)) out[name] = snapshot(writeProject(files));
  for (const [name, dir] of shippedProjects()) if (!only || only.includes(name)) out[name] = snapshot(dir);
  return JSON.parse(JSON.stringify(out));
}

describe('English identity without docs.language (T009)', () => {
  it('structural results equal the golden generated before the label registry', () => {
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
});

// ── a frozen copy of the legacy matcher ───────────────────────────────────

const LEGACY_SYNONYMS = {
  'system overview': ['system context', 'system summary', 'introduction and goals', 'context and scope', 'overview and goals'],
  'component map': ['components', 'component overview', 'building block view', 'building blocks', 'containers', 'module overview'],
  'tech stack': ['technology stack', 'technologies', 'technical stack'],
  'entities': ['entity definitions', 'data model', 'domain model', 'data entities'],
  'authentication': ['auth', 'authn', 'authentication and authorization', 'identity'],
  'secrets management': ['secrets', 'secret management', 'secrets handling', 'credentials', 'credential management'],
  'test categories': ['test types', 'categories of tests', 'test strategy', 'testing strategy', 'test approach'],
  'coverage rules': ['coverage', 'coverage targets', 'coverage goals', 'coverage requirements', 'coverage policy'],
  'environment variables': ['env vars', 'environment variable', 'environment', 'configuration', 'config variables', 'environment configuration', 'runtime configuration'],
  'setup steps': ['setup', 'getting started', 'installation', 'setup instructions', 'local setup', 'quick start'],
  'layer boundaries': ['layers', 'layering', 'module boundaries', 'layer boundary', 'boundaries'],
  'external dependencies': ['dependencies', 'external systems', 'third party dependencies', 'integrations', 'external interfaces'],
  'revision history': ['changelog', 'change history', 'history', 'revisions', 'document history', 'change log'],
};
const legacyNorm = line => line.replace(/^#{1,6}\s*/, '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const WHOLE = new Set(['environment', 'configuration']);
const SUFFIXES = ['reference', 'variables', 'vars', 'env', 'settings', 'options', 'keys'];
const names = (norm, phrase) => (WHOLE.has(phrase) ? norm === phrase || SUFFIXES.some(s => norm === `${phrase} ${s}`) : norm.includes(phrase));
function legacyHas(content, heading) {
  const key = legacyNorm(heading);
  if (!key) return false;
  const syn = Object.hasOwn(LEGACY_SYNONYMS, key) ? LEGACY_SYNONYMS[key] : [];
  for (const line of content.match(/^#{2,6}\s+.+$/gm) || []) {
    const norm = legacyNorm(line);
    if (names(norm, key)) return true;
    for (const phrase of syn) if (names(norm, phrase)) return true;
  }
  return false;
}
function legacyFind(content, heading) {
  const key = legacyNorm(heading);
  if (!key) return -1;
  const syn = Object.hasOwn(LEGACY_SYNONYMS, key) ? LEGACY_SYNONYMS[key] : [];
  const lines = String(content).split('\n');
  const heads = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0]) fence = null; continue; }
    if (m) { fence = m[1]; continue; }
    if (/^#{2,6}\s+\S/.test(lines[i])) heads.push({ i, norm: legacyNorm(lines[i]) });
  }
  for (const test of [h => h.norm === key, h => h.norm.includes(key), h => syn.some(p => names(h.norm, p))]) {
    const hit = heads.find(test);
    if (hit) return hit.i;
  }
  return -1;
}

function markdownFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.worktrees') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) markdownFiles(full, out);
    else if (name.endsWith('.md') && st.size < 400000) out.push(full);
  }
  return out;
}

describe('the matcher equals the legacy matcher without a language or a marker (T009)', () => {
  const english = LABELS.flatMap(entry => entry.en.map(label => `## ${label}`));
  it('docHasSection and findSectionHeading agree on every registered label and every repository document', () => {
    let compared = 0;
    for (const file of [...markdownFiles(join(ROOT, 'docs-canonical')), ...markdownFiles(join(ROOT, 'docs')), ...markdownFiles(join(ROOT, 'specs')), join(ROOT, 'README.md'), join(ROOT, 'CHANGELOG.md')]) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('docguard:heading')) continue; // a marker is the one new behavior; documents about it are out of this comparison
      for (const heading of english) {
        assert.equal(docHasSection(content, heading), legacyHas(content, heading), `${relative(ROOT, file)} ${heading}`);
        assert.equal(findSectionHeading(content, heading), legacyFind(content, heading), `${relative(ROOT, file)} ${heading} (index)`);
        compared++;
      }
    }
    assert.ok(compared > 1000, `compared only ${compared} pairs`);
  });
});
