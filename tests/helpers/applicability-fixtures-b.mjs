/**
 * The fixtures of group B of spec 097 (applies and empty, does not apply, the fix applied),
 * shared by tests/validator-applicability-b.test.mjs and the registry-wide check of
 * tests/strict-by-default.test.mjs, so both read one table.
 */
import { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FIXTURE_GIT } from './git.mjs';
import { runGuardInternal } from '../../cli/commands/guard.mjs';
import { loadConfig } from '../../cli/config.mjs';

export const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

export function put(dir, files) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}

/**
 * A fixture project. `git: false` leaves it outside a repository; `history` is a
 * list of file maps, each committed on top of the first (so a diff exists).
 * `aged` is { path: days }: the file's mtime is moved back by that many days.
 */
export function project(files, config, { git = true, history = [], aged = {}, brokenGit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-applies-b-'));
  temporary.push(dir);
  put(dir, files);
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify(config, null, 2));
  for (const [path, days] of Object.entries(aged)) {
    const then = new Date(Date.now() - days * 86_400_000);
    utimesSync(join(dir, path), then, then);
  }
  // A `.git` that names a repository which is not there: present, and unreadable.
  if (brokenGit) { writeFileSync(join(dir, '.git'), 'gitdir: /nonexistent/docguard-test.git\n'); return dir; }
  if (!git) return dir;
  const run = (...args) => execFileSync('git', [...FIXTURE_GIT, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  run('init', '-q', '-b', 'main');
  run('add', '-A');
  run('commit', '-q', '-m', 'init');
  history.forEach((change, i) => {
    put(dir, change);
    run('add', '-A');
    run('commit', '-q', '-m', `change ${i + 1}`);
  });
  return dir;
}

export const KEYS = [
  'specRegistry', 'docDependency', 'requirementAnchors', 'pathScopedRules', 'docOwnership', 'evidence',
  'crossReference', 'generatedStaleness', 'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells',
  'decisionRecords', 'aidlc', 'canonicalSync', 'metricsConsistency',
];
// Every other validator is switched off so a fixture measures one validator.
export const ALL_KEYS = [
  ...KEYS, 'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment', 'security',
  'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface', 'metadataSync', 'docsCoverage',
  'docQuality', 'todoTracking', 'schemaSync', 'specKit', 'documentLifecycle', 'surfaceSync',
];
export const only = key => Object.fromEntries(ALL_KEYS.map(k => [k, k === key]));
export const cfg = (key, extra = {}) => ({ projectName: 'applies-b', version: '0.6', requiredFiles: { canonical: [], agentFile: [] }, validators: only(key), enforcement: 'strict', ...extra });

export const PKG = JSON.stringify({ name: 'svc', version: '1.2.0' });
export const SRC = { 'src/index.js': 'export const a = 1;\n' };
export const BASE = { 'package.json': PKG, ...SRC };
export const DOCS = { 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nA small service that returns a list.\n' };
export const SPEC = {
  'specs/001-demo/spec.md': '# Feature: Demo\n\n**Spec ID**: demo.feature\n\n## Requirements\n\n- **FR-001**: The service MUST return the list.\n',
};

/**
 * key -> { empties: { <name>: { files, extra?, opts?, cause } }, fix?, applying?, why? }
 * `fix` is the first applies-and-empty project with its fix applied. `applying`
 * replaces it for a validator that cannot be empty while it applies (`why` says
 * so). Both may carry `extra` (configuration) and `opts` (git history, file age).
 */
// A published template: its front matter says the status is final, its body quotes "Status: Draft / Approved"
// and has a horizontal rule after it (the draft pattern's lazy match ran from the front matter into the body).
export const FINAL_TEMPLATE = '---\nstatus: final\n---\n# Template\n\nStatus: Draft / Approved\n\n---\n\nFill in the sections below.\n';
// A spec template: requirement lines whose text is a bracketed placeholder.
export const SPEC_TEMPLATE = { 'specs/001-template/spec.md': '# Feature: [name]\n\n**Spec ID**: demo.template\n\n## Requirements\n\n- **FR-001**: System MUST [capability]\n- **FR-002**: System MUST [NEEDS CLARIFICATION: auth method]\n' };
// Requirement IDs of one digit, a form the scanner does not read (it reads two to four digits).
export const SPEC_SHORT_IDS = { 'specs/001-short/spec.md': '# Feature: Short\n\n## Requirements\n\n- **FR-1**: The service MUST return the list.\n- **FR-2**: The service MUST page the list.\n- **FR-3**: The service MUST sort the list.\n' };
// Tooling configuration is not product source: it sorts before src/ in a repository listing.
export const CONFIG_FILES = { 'eslint.config.js': 'export default [];\n', 'playwright.config.ts': 'export default {};\n', 'drizzle.config.ts': 'export default {};\n' };

// A project whose only IDs are decision, open-item, task and design-element identifiers: none is a requirement.
export const NON_REQUIREMENT_IDS = {
  'docs-canonical/adr/0001-queue.md': '# 0001 Use a queue\n\n**Status**: accepted\n\n- **REQ-001**: We chose a queue over cron.\n',
  'docs-canonical/OPEN-ITEMS.md': '# Open items\n\n- **FR-020**: Who owns the retries?\n',
  'docs-canonical/PLAN.md': '# Plan\n\n- [ ] T001 Set up the queue\n- [ ] T002 Write the worker\n\n- **ARCH-001**: The worker component\n- **MOD-002**: The queue module\n',
};

// Decision, open-item and task identifiers in a form the scanner does not read, in documents not named for them.
export const UNREAD_NON_REQUIREMENT_IDS = {
  'docs-canonical/NOTES.md': '# Notes\n\n- **D-7**: We chose a queue over cron.\n- **D-8**: The worker retries three times.\n- **OI-001**: Who owns the retries?\n- **OI-002**: Which region first?\n- **T-7**: Write the worker.\n- **T-8**: Write the queue.\n',
};
// Unfilled template rows in forms other than square brackets, and a template document.
export const PLACEHOLDER_FORMS = {
  'specs/001-unfilled/spec.md': '# Feature: Unfilled\n\n## Requirements\n\n- **FR-001**: System MUST <capability>\n- **FR-002**: The system shall {{behaviour}}\n- **FR-003**: TBD\n- **FR-004**:\n',
  'docs-canonical/templates/spec-template.md': '# Spec template\n\n- **FR-010**: The system MUST do something.\n- **NFR-010**: The system MUST be fast.\n',
};
// The same bare ID declared by two specs that carry no Spec ID.
export const SAME_ID_TWICE = {
  'specs/001-a/spec.md': '# Feature: A\n\n- **FR-001**: The system MUST do a.\n',
  'specs/002-b/spec.md': '# Feature: B\n\n- **FR-001**: The system MUST do b.\n',
};

export const FIXTURES = {
  // A project with specs is never empty here: a spec without registry evidence is a finding (SPR001), not silence.
  specRegistry: {
    empties: { 'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, ...SPEC } },
    why: 'every project that has specs has a registry to compare, or a finding that says it is missing',
  },
  docDependency: {
    empties: {
      'needs-declaration': { files: { ...BASE, ...DOCS }, cause: 'needs-declaration' },
      'needs-declaration (lock covers nothing)': { files: { ...BASE, ...DOCS, '.docguard-doc-lock.json': JSON.stringify({ schemaVersion: 1, sections: {} }) }, cause: 'needs-declaration' },
      'nothing-of-this-kind (no source)': { files: { 'package.json': PKG, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:section id=entry source=human covers="src/index.js" -->\nThe entry point exports a constant.\n<!-- /docguard:section -->\n' } },
  },
  requirementAnchors: {
    empties: {
      'needs-declaration': { files: { ...BASE, ...SPEC }, cause: 'needs-declaration' },
      'needs-content': { files: { ...BASE, ...SPEC }, extra: { anchors: { enabled: true } }, cause: 'needs-content' },
      'nothing-of-this-kind (no requirements)': { files: BASE, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no source)': { files: { 'package.json': PKG, ...SPEC }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (template placeholders only)': { files: { ...BASE, ...SPEC_TEMPLATE }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (only decision, open-item, task and design IDs)': { files: { ...BASE, ...NON_REQUIREMENT_IDS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (decision, open-item and task IDs in an unread form)': { files: { ...BASE, ...UNREAD_NON_REQUIREMENT_IDS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (unfilled template rows)': { files: { ...BASE, ...PLACEHOLDER_FORMS }, cause: 'nothing-of-this-kind' },
      'layout-not-recognized (IDs of one digit)': { files: { ...BASE, ...SPEC_SHORT_IDS }, cause: 'layout-not-recognized' },
    },
    fix: { files: { ...BASE, ...SPEC, 'src/index.js': '// @implements demo.feature#FR-001\nexport const a = 1;\n' }, extra: { anchors: { enabled: true } } },
  },
  // A project with an instruction file that has no scope and no path pointer has nothing for this validator to read.
  pathScopedRules: {
    empties: {
      'nothing-of-this-kind (no instruction files)': { files: BASE, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (prose only)': { files: { ...BASE, 'AGENTS.md': '# Agents\n\nBe kind to the reader.\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'AGENTS.md': '# Agents\n\nThe entry point is `src/index.js`.\n' } },
  },
  docOwnership: {
    // Declared-only (coordinator's decision on FR-006): no map, no subject; a declared empty block is needs-content.
    empties: {
      'nothing-of-this-kind (not declared)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'needs-content': { files: { ...BASE, ...DOCS }, extra: { ownership: { entries: [] } }, cause: 'needs-content' },
      'needs-content (declared, no source file)': { files: { 'package.json': PKG }, extra: { ownership: { entries: [] } }, cause: 'needs-content' },
    },
    fix: { files: { ...BASE, ...DOCS }, extra: { ownership: { roots: ['src'], entries: [{ doc: 'docs-canonical/ARCHITECTURE.md', purpose: 'Explains the entry point', paths: ['src/**'] }] } } },
  },
  // Declared-only (coordinator's decision on FR-006). A manifest always declares something (the strict loader
  // refuses an empty one with EVD001), so there is no declared-and-empty fixture.
  evidence: {
    empties: {
      'nothing-of-this-kind (not declared, a claim exists)': { files: { ...BASE, 'docs-canonical/LIMITS.md': '# Limits\n\n## Retention\n\nSessions expire after 30 days.\n' }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (not declared)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
    },
    fix: {
      files: {
        ...BASE,
        'docs-canonical/LIMITS.md': '# Limits\n\n## Retention\n\nSessions expire after 30 days.\n',
        'config.json': JSON.stringify({ retentionDays: 30 }),
        '.docguard-evidence.json': JSON.stringify({
          $schema: 'https://raccioly.github.io/docguard/schemas/docguard-evidence.schema.json',
          schemaVersion: 1,
          declarations: [{
            id: 'retention-days', applicability: { mode: 'always' },
            target: { document: 'docs-canonical/LIMITS.md', heading: 'Retention', statement: 'Sessions expire after {{value}} days.' },
            source: { adapter: 'json-pointer', path: 'config.json', pointer: '/retentionDays' },
            predicate: { kind: 'equals', valueType: 'number' },
          }],
        }),
      },
    },
  },
  crossReference: {
    empties: {
      'layout-not-recognized': { files: { ...BASE, 'docs/ARCHITECTURE.md': '# Architecture\n\nSee [the setup](./SETUP.md).\n', 'docs/SETUP.md': '# Setup\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind (no links)': { files: { ...BASE, 'README.md': '# Readme\n\nA small service.\n' }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    // The fix maps the document under docs.roles: it is read where it lives, and its relative links keep resolving.
    fix: { files: { ...BASE, 'docs/ARCHITECTURE.md': '# Architecture\n\nSee [the setup](./SETUP.md).\n', 'docs/SETUP.md': '# Setup\n' }, extra: { docs: { roles: { architecture: 'docs/ARCHITECTURE.md' } } } },
  },
  generatedStaleness: {
    empties: {
      // The generator's own draft marker is `<!-- docguard:status draft -->`; a current doc carries no draft marker.
      'needs-content (a marker names no generated section)': { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:section id=no-such-section source=code -->\nx\n<!-- /docguard:section -->\n' }, cause: 'needs-content' },
      'layout-not-recognized (a marker in a document DocGuard does not generate)': { files: { ...BASE, 'README.md': '# Readme\n\n<!-- docguard:section id=x source=code -->\nx\n<!-- /docguard:section -->\n' }, cause: 'layout-not-recognized' },
      'nothing-of-this-kind (front matter says final, the body quotes Draft)': { files: { ...BASE, 'docs-canonical/TEMPLATE.md': FINAL_TEMPLATE }, cause: 'nothing-of-this-kind' },
    },
    fix: {
      files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '<!-- docguard:status draft -->\n# Architecture\n\nA small service.\n' },
      opts: { aged: { 'docs-canonical/ARCHITECTURE.md': 40 } },
    },
  },
  suppressions: {
    empties: { 'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, '.docguardignore': 'dist/ # build output\n' } },
    why: 'a project that has a suppression has one to judge',
  },
  // A revision range that changes no documented code is the normal case, not a gap in the project.
  diffSuspicion: {
    empties: {
      'nothing-of-this-kind (one commit)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no git)': { files: { ...BASE, ...DOCS }, opts: { git: false }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (the change is not documented)': { files: { ...BASE, ...DOCS }, opts: { history: [{ 'src/index.js': 'export const b = 2;\n' }] }, cause: 'nothing-of-this-kind' },
    },
    applying: {
      files: { 'package.json': PKG, 'src/pricing.mjs': 'export const discountPercentage = 10;\nexport const loyaltyTier = "gold";\n', 'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Pricing\n\nThe `src/pricing.mjs` module sets the discountPercentage and the loyaltyTier.\n' },
      opts: { history: [{ 'src/pricing.mjs': 'export const rebate = 5;\n' }] },
    },
    why: 'a documented, changed file is a pair checked; without one there is nothing of this kind',
  },
  referenceExistence: {
    empties: {
      'nothing-of-this-kind (no references)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no git)': { files: { ...BASE, 'docs-canonical/ARCHITECTURE.md': '# A\n\nThe `computeTotal` helper.\n' }, opts: { git: false }, cause: 'nothing-of-this-kind' },
    },
    applying: { files: { 'package.json': PKG, 'src/index.js': 'export function computeTotal() { return 1; }\n', 'docs-canonical/ARCHITECTURE.md': '# A\n\nThe `computeTotal` helper.\n' } },
    why: 'a backticked code identifier in a document, or an ADR citation in code, is a reference checked',
  },
  apiDocSmells: {
    empties: {
      'nothing-of-this-kind (no API headings)': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' },
      'nothing-of-this-kind (no documents)': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    applying: { files: { ...BASE, 'docs-canonical/API.md': '# API\n\n### GET /users\n\nReturns the list of users, newest first, with the owner and the status of each one.\n' } },
    why: 'a document with an API-shaped heading has a unit to size',
  },
  decisionRecords: {
    empties: { 'nothing-of-this-kind': { files: { ...BASE, ...DOCS }, cause: 'nothing-of-this-kind' } },
    applying: { files: { ...BASE, 'docs-canonical/adr/0001-use-queue.md': '# 0001 Use a queue\n\n**Status**: accepted\n\nWe use a queue.\n' } },
    why: 'a decision record is a record to judge',
  },
  aidlc: {
    empties: {
      'needs-content': { files: { ...BASE, 'aidlc-docs/aidlc-state.md': '# State\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'aidlc-docs/inception/traceability.json': JSON.stringify({ stage: 'inception', upstream_ids: [], coverage: [{ id: 'REQ-1', status: 'OK', target: 'src/index.js' }] }) } },
  },
  canonicalSync: {
    empties: {
      'needs-content': { files: { 'package.json': JSON.stringify({ name: 'docguard-cli' }), 'cli/commands/a.mjs': '', 'cli/validators/b.mjs': '', 'README.md': '# Readme\n\nNothing counted here.\n' }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: BASE, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { 'package.json': JSON.stringify({ name: 'docguard-cli' }), 'cli/commands/a.mjs': '', 'cli/validators/b.mjs': '', 'README.md': '# Readme\n\nDocGuard ships 1 commands and has all 1 validators.\n' } },
  },
  metricsConsistency: {
    empties: {
      'needs-content (a declared glob matches no file)': { files: { ...BASE, 'README.md': '# Readme\n\nThe service has 16 extractors.\n' }, extra: { collections: { extractors: 'src/extractors/*.js' } }, cause: 'needs-content' },
      'nothing-of-this-kind': { files: { ...BASE, 'README.md': '# Readme\n\nA small service.\n' }, cause: 'nothing-of-this-kind' },
    },
    fix: { files: { ...BASE, 'src/extractors/one.js': 'export const one = 1;\n', 'README.md': '# Readme\n\nThe service has 1 extractor.\n' }, extra: { collections: { extractors: 'src/extractors/*.js' } } },
  },
};

export function run(key, fixture) {
  const dir = project(fixture.files, cfg(key, fixture.extra || {}), fixture.opts || {});
  const config = loadConfig(dir);
  const data = runGuardInternal(dir, config);
  return { dir, config, data, result: data.validators.find(v => v.key === key) };
}

