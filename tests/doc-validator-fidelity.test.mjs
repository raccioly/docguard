// @req docguard.doc-validator-fidelity#FR-001
// @req docguard.doc-validator-fidelity#FR-002
// @req docguard.doc-validator-fidelity#FR-003
// @req docguard.doc-validator-fidelity#FR-004
// @req docguard.doc-validator-fidelity#FR-005
// @req docguard.doc-validator-fidelity#FR-006
// @req docguard.doc-validator-fidelity#FR-007
// @req docguard.doc-validator-fidelity#FR-008
// @req docguard.doc-validator-fidelity#FR-009
// @req docguard.doc-validator-fidelity#FR-010
// @req docguard.doc-validator-fidelity#FR-011
// @req docguard.doc-validator-fidelity#FR-012
// @req docguard.doc-validator-fidelity#SC-001
// @req docguard.doc-validator-fidelity#SC-002
// @req docguard.doc-validator-fidelity#SC-003
// @req docguard.doc-validator-fidelity#SC-004
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixtureGit } from './helpers/git.mjs';

import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { validateDocsDiff, diffTechStack, extractDocumentedTests } from '../cli/validators/docs-diff.mjs';
import { validateDocQuality, countSyllables } from '../cli/validators/doc-quality.mjs';
import { loadConfig } from '../cli/config.mjs';
import { runScoreInternal, computeAlcoaCompliance } from '../cli/commands/score.mjs';
import { isUneditedScaffold, scaffoldLines } from '../cli/shared-scaffold.mjs';
import { assessAgentReadability } from '../cli/scanners/agent-readability.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = new Date().toISOString().slice(0, 10);

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A shipped template as `init` writes it: the date placeholder filled in. */
function template(name) {
  return readFileSync(join(ROOT, 'templates', `${name}.md.template`), 'utf-8').replaceAll('YYYY-MM-DD', TODAY);
}

const codes = result => (result.findings ?? []).map(f => f.code);

describe('doc validator fidelity', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-fidelity-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // ── US1 (FR-001): ENV001/ENV002 match headings as STR003 does ─────────────
  describe('environment headings', () => {
    const envDoc = body => write(dir, 'docs-canonical/ENVIRONMENT.md', `# Environment\n\n${body}\n`);

    it('accepts sentence-case headings in ENV001, ENV002 and STR003', () => {
      write(dir, 'docs-canonical/TEST-SPEC.md', '# Test spec\n\n## Test categories\n\nUnit.\n\n## Coverage rules\n\n80%.\n');
      envDoc('## Setup steps\n\nnpm install\n\n## Environment variables\n\n`PORT` — port\n');
      const env = validateEnvironment(dir, {});
      assert.deepEqual(codes(env).filter(c => c === 'ENV001' || c === 'ENV002'), []);
      const sections = validateDocSections(dir, {});
      assert.ok(!codes(sections).includes('STR003'), 'TEST-SPEC and ENVIRONMENT sections are all present');
    });

    for (const heading of ['## setup', '## Getting Started', '## 2. Setup Steps', '## Prerequisites', '### Setup steps']) {
      it(`ENV001 accepts "${heading}"`, () => {
        envDoc(`${heading}\n\nnpm install\n\n## Environment Variables\n\nnone\n`);
        assert.ok(!codes(validateEnvironment(dir, {})).includes('ENV001'));
      });
    }

    for (const heading of ['## Environment variables', '## Env Vars', '## 3. environment variables', '## Configuration']) {
      it(`ENV002 accepts "${heading}"`, () => {
        envDoc(`## Setup Steps\n\nnpm install\n\n${heading}\n\nnone\n`);
        assert.ok(!codes(validateEnvironment(dir, {})).includes('ENV002'));
      });
    }

    it('still reports both when neither section exists, with the current text', () => {
      envDoc('Some prose without headings.');
      const result = validateEnvironment(dir, {});
      assert.deepEqual(codes(result).filter(c => c.startsWith('ENV00') && c <= 'ENV002'), ['ENV001', 'ENV002']);
      assert.ok(result.warnings.some(w => w.includes('missing "## Prerequisites" or "## Setup Steps" section')));
      assert.ok(result.warnings.some(w => w.includes('missing "## Environment Variables" section')));
    });
  });

  // ── US2 (FR-002): brace patterns document the files they expand to ────────
  describe('brace patterns in documented tests', () => {
    const testSpec = cell => write(dir, 'docs-canonical/TEST-SPEC.md',
      `# Test spec\n\n## Test Categories\n| Area | Test |\n|---|---|\n| Core | ${cell} |\n`);
    const ddf002 = () => validateDocsDiff(dir, {}).findings.filter(f => f.code === 'DDF002');
    const files = (...names) => names.forEach(n => write(dir, n, 'import test from "node:test";\n'));

    it('one brace line documents both real files', () => {
      files('src/tests/alpha.test.ts', 'src/tests/beta.test.ts');
      testSpec('`src/tests/{alpha,beta}.test.ts`');
      assert.deepEqual(ddf002(), []);
    });

    it('a missing expansion is reported by its expanded path, nothing else', () => {
      files('src/tests/alpha.test.ts', 'src/tests/beta.test.ts');
      testSpec('`src/tests/{alpha,beta,gamma}.test.ts`');
      const [finding, ...rest] = ddf002();
      assert.equal(rest.length, 0);
      assert.match(finding.message, /1 documented but not found in code: `src\/tests\/gamma\.test\.ts`/);
      assert.doesNotMatch(finding.message, /in code but not documented/);
    });

    it('extracts a token whose literal text has no .test. or .spec.', () => {
      const tests = extractDocumentedTests('`tests/foo.{test,spec}.ts`');
      assert.deepEqual([...tests].sort(), ['tests/foo.spec.ts', 'tests/foo.test.ts']);
    });

    it('expands several groups and empty alternatives', () => {
      assert.deepEqual([...extractDocumentedTests('`{src,lib}/{a,b}.test.ts`')].sort(),
        ['lib/a.test.ts', 'lib/b.test.ts', 'src/a.test.ts', 'src/b.test.ts']);
      assert.deepEqual([...extractDocumentedTests('`src/{a,}.test.ts`')].sort(), ['src/.test.ts', 'src/a.test.ts']);
    });

    it('leaves unbalanced, comma-less, nested and oversized patterns literal', () => {
      assert.deepEqual([...extractDocumentedTests('`src/tests/{alpha.test.ts`')], ['src/tests/{alpha.test.ts']);
      assert.deepEqual([...extractDocumentedTests('`src/{alpha}.test.ts`')], ['src/{alpha}.test.ts']);
      assert.deepEqual([...extractDocumentedTests('`src/{a,{b,c}}.test.ts`')], ['src/{a,{b,c}}.test.ts']);
      const wide = '`' + Array.from({ length: 3 }, () => '{' + Array.from({ length: 5 }, (_, i) => i).join(',') + '}').join('/') + '.test.ts`';
      assert.equal(extractDocumentedTests(wide).size, 1, '125 expansions exceed the cap of 64');
    });

    it('a brace glob is one pattern: it documents what any alternative matches', () => {
      files('src/lib/app.test.js', 'src/lib/util.test.js');
      testSpec('`src/**/*.test.{js,jsx}`');
      assert.deepEqual(ddf002(), [], 'no .jsx file exists, and the pattern still matches');
      assert.deepEqual([...extractDocumentedTests('`src/**/*.test.{js,jsx}`')], ['src/**/*.test.{js,jsx}']);
    });

    it('a brace glob that matches nothing is reported once, by the pattern as written', () => {
      files('src/app.ts');
      testSpec('`src/**/*.test.{js,jsx}`');
      const [finding, ...rest] = ddf002();
      assert.equal(rest.length, 0);
      assert.match(finding.message, /1 documented but not found in code: `src\/\*\*\/\*\.test\.\{js,jsx\}`/);
    });

    it('a brace glob with a non-test alternative is not extracted', () => {
      assert.equal(extractDocumentedTests('`src/*.{ts,md}`').size, 0);
    });

    it('docguard diff reads brace patterns as DDF002 does', () => {
      files('src/tests/alpha.test.ts', 'src/tests/beta.test.ts', 'src/lib/app.test.js');
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      testSpec('`src/tests/{alpha,beta}.test.ts` `src/**/*.test.{js,jsx}`');
      const run = spawnSync(process.execPath, [join(ROOT, 'cli', 'docguard.mjs'), 'diff', '--dir', dir, '--format', 'json'], { encoding: 'utf8' });
      const tests = JSON.parse(run.stdout).find(r => r.title === 'Test Files');
      assert.deepEqual([tests?.onlyInDocs ?? [], tests?.onlyInCode ?? []], [[], []]);
    });

    it('a brace pattern in a fenced block documents nothing', () => {
      assert.equal(extractDocumentedTests('```\n`src/{a,b}.test.ts`\n```\n').size, 0);
    });
  });

  // ── US3 (FR-003..FR-005): negation over lists, removal verbs, change records
  describe('tech-stack negation', () => {
    const documented = (sentence, { heading = '## Infrastructure', extra = '' } = {}) => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: { react: '18.0.0' } }));
      write(dir, 'docs-canonical/ARCHITECTURE.md',
        `# Architecture\n\n## Tech Stack\n\n| Category | Technology |\n|---|---|\n| UI | React |\n\n${heading}\n\n${sentence}\n${extra}`);
      return diffTechStack(dir, {}).onlyInDocs;
    };

    const clears = [
      'There are no Terraform modules.',
      'We do not use Terraform.',
      'Terraform is not used.',
      'There are no CDK, Terraform or Pulumi stacks.',
      'There are no Pulumi, CDK or Terraform stacks.',
      'We use neither Terraform, Pulumi nor CDK.',
      'Without Terraform or Pulumi.',
      'We removed Terraform in 1.0.',
      'Terraform was removed.',
      'We migrated off Terraform.',
      'We migrated away from Terraform.',
      'We dropped Terraform.',
      'We no longer use Terraform.',
      'Terraform was replaced by Pulumi.',
    ];
    for (const sentence of clears) {
      it(`does not document Terraform: ${sentence}`, () => {
        assert.ok(!documented(sentence).includes('Terraform'));
      });
    }

    it('keeps the technology that replaces another live', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: { react: '18.0.0' } }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\n## Tech Stack\n\nReact.\n\nWe replaced MySQL with PostgreSQL.\n');
      const stale = diffTechStack(dir, {}).onlyInDocs;
      assert.ok(stale.includes('PostgreSQL'));
      assert.ok(!stale.includes('MySQL'));
    });

    it('a negator does not reach across a clause break', () => {
      assert.ok(documented('We use Terraform, but there are no Pulumi stacks.').includes('Terraform'));
      assert.ok(documented('We do not use CDK, but Terraform manages DNS.').includes('Terraform'));
      assert.ok(documented('Pulumi is not used. Terraform manages DNS.').includes('Terraform'));
      assert.ok(documented('Terraform manages DNS. We removed Docker.').includes('Terraform'));
    });

    it('a Revision History or Changelog row is not a Tech Stack claim', () => {
      const rows = '| Version | Date | Change |\n|---|---|---|\n| 0.2.0 | 2026-10-01 | Added Terraform for DNS |\n';
      assert.ok(!documented('', { heading: '## Revision History', extra: rows }).includes('Terraform'));
      assert.ok(!documented('', { heading: '## Changelog', extra: rows }).includes('Terraform'));
      assert.ok(!documented('', { heading: '## Release Notes', extra: rows }).includes('Terraform'));
      assert.ok(!documented('', { heading: '## Revision History', extra: '| 0.2.0 | | Removed the template\'s Terraform blocks |\n' }).includes('Terraform'));
    });

    it('the same row under Tech Stack is still a claim', () => {
      assert.ok(documented('', { heading: '## Tech Stack', extra: '| IaC | Terraform |\n' }).includes('Terraform'));
    });

    it('a change-record section ends at the next heading of its level', () => {
      const after = '\n## Infrastructure\n\nTerraform manages DNS.\n';
      const rows = '| 0.2.0 | | Added Docker |\n';
      assert.ok(documented('', { heading: '## Revision History', extra: rows + after }).includes('Terraform'));
    });
  });

  // ── US5 (FR-012): a word that names an inherited property is still a word ──
  describe('readability of the word constructor', () => {
    const prose = word => Array.from({ length: 12 }, () =>
      `The ${word} builds the object. It sets each field once. We call it from the main file. ` +
      'Each test makes a new copy. The code is short and plain.').join(' ');
    const analyze = word => {
      write(dir, 'docs-canonical/TEST-SPEC.md', `# Test spec\n\n## Test Categories\n\n${prose(word)}\n`);
      return validateDocQuality(dir, {});
    };

    it('produces finite metrics, never NaN', () => {
      const result = analyze('constructor');
      assert.ok(result.findings.every(f => !/NaN/.test(f.message)), JSON.stringify(result.findings.map(f => f.message)));
    });

    it('reads constructor like another three-syllable word', () => {
      const shape = result => result.findings.map(f => f.code);
      assert.deepEqual(shape(analyze('constructor')), shape(analyze('instruction')));
    });

    it('counts constructor as three syllables in every case, and keeps the exception list', () => {
      for (const word of ['constructor', 'Constructor', 'CONSTRUCTOR']) assert.equal(countSyllables(word), 3);
      const exceptions = { the: 1, are: 1, were: 1, have: 1, there: 1, where: 1, here: 1, every: 3, everything: 4, create: 2, file: 1, style: 1, quite: 1 };
      for (const [word, count] of Object.entries(exceptions)) assert.equal(countSyllables(word), count, word);
    });

    it('returns a positive integer for any word, inherited property names included', () => {
      for (const word of ['constructor', 'valueOf', 'toString', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'prototype']) {
        const count = countSyllables(word);
        assert.ok(Number.isInteger(count) && count > 0, `${word} -> ${count}`);
      }
    });

    it('keeps the readability thresholds: hard prose still warns', () => {
      write(dir, 'docs-canonical/TEST-SPEC.md', '# Test spec\n\n## Test Categories\n\n' +
        Array.from({ length: 12 }, () => 'The constructor instantiation orchestrates comprehensive interdependent initialization responsibilities notwithstanding organizational considerations.').join(' ') + '\n');
      assert.ok(codes(validateDocQuality(dir, {})).includes('DQ004'));
    });
  });

  describe('isUneditedScaffold', () => {
    for (const name of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT', 'REQUIREMENTS']) {
      it(`${name}: the shipped template is a scaffold of itself, and one added line edits it`, () => {
        assert.equal(isUneditedScaffold(template(name), name), true);
        assert.equal(isUneditedScaffold(`${template(name)}\nThe billing service owns invoices.\n`, name), false);
      });
    }

    it('never for no template, an empty file, bare headings or unrelated headings', () => {
      assert.equal(isUneditedScaffold(template('ARCHITECTURE'), 'NOT-A-TEMPLATE'), false);
      assert.equal(isUneditedScaffold(template('ARCHITECTURE'), '../ARCHITECTURE'), true, 'a path is reduced to its base name');
      assert.equal(isUneditedScaffold('', 'ARCHITECTURE'), false);
      assert.equal(isUneditedScaffold('## System Overview\n## Component Map\n', 'ARCHITECTURE'), false);
      assert.equal(isUneditedScaffold('# Notes\n\n| A | B |\n|---|---|\n| | |\n', 'ARCHITECTURE'), false);
    });

    it('ignores comments, dates, separator rows, empty cells and the Metadata table', () => {
      const { lines } = scaffoldLines(template('ARCHITECTURE'));
      assert.ok(![...lines].some(l => l.includes('<!--') || l.includes('@your-github-username') || /^[|\s:-]+$/.test(l)));
      assert.ok(![...lines].some(l => l.startsWith('| **Status**') || l.startsWith('| **Owner**')));
    });
  });

  // ── US4 (FR-006..FR-010): an unedited template is not scored as finished ──
  describe('unedited scaffold', () => {
    const requiredDocs = ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT'];
    const scaffold = () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      for (const name of requiredDocs) write(dir, `docs-canonical/${name}.md`, template(name));
    };
    const report = () => {
      const config = loadConfig(dir);
      return { config, score: runScoreInternal(dir, config) };
    };

    it('STR006 is reported once per unedited document, as a warning', () => {
      scaffold();
      const result = validateDocSections(dir, {});
      const str006 = result.findings.filter(f => f.code === 'STR006');
      assert.equal(str006.length, requiredDocs.length);
      assert.ok(str006.every(f => f.severity === 'warn'));
      assert.match(str006[0].message, /@your-github-username/);
    });

    it('docQuality falls below the Legible line and ALCOA+ Legible is a gap', () => {
      scaffold();
      const { config, score } = report();
      assert.ok(score.categories.docQuality < 60, `docQuality was ${score.categories.docQuality}`);
      const legible = computeAlcoaCompliance(dir, config, score.categories).attributes.find(a => a.name === 'Legible');
      assert.equal(legible.evidence, null);
      assert.ok(legible.gap);
    });

    it('Machine markers counts no scaffold as marked', () => {
      scaffold();
      const marker = assessAgentReadability(dir, loadConfig(dir)).metrics.find(m => m.key === 'marker-presence');
      assert.match(marker.detail, /^0\/5 /);
      assert.equal(marker.score, 0);
    });

    it('a scaffold alone is 0%, not 100%, when it is the only document', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', template('ARCHITECTURE'));
      assert.equal(report().score.categories.docQuality, 0);
    });

    it('one prose sentence makes the document edited again', () => {
      scaffold();
      const edited = template('ARCHITECTURE').replace(
        '## System Overview\n\n', '## System Overview\n\nThis service reconciles invoices against the ledger.\n\n');
      write(dir, 'docs-canonical/ARCHITECTURE.md', edited);
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.equal(str006.length, requiredDocs.length - 1);
      assert.ok(!str006.some(f => f.location.endsWith('ARCHITECTURE.md')));
    });

    it('stays a scaffold when comments and headings are deleted or owner and status are filled in', () => {
      scaffold();
      const trimmed = template('ARCHITECTURE')
        .replace(/<!--[^]*?-->/g, '')
        .replace(/@your-github-username/g, '@maintainer')
        .replace('draft', 'approved');
      write(dir, 'docs-canonical/ARCHITECTURE.md', trimmed);
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.ok(str006.some(f => f.location.endsWith('ARCHITECTURE.md')));
    });

    it('an edited document that keeps the placeholder owner is not reported', () => {
      scaffold();
      write(dir, 'docs-canonical/ARCHITECTURE.md',
        template('ARCHITECTURE').replace('## System Overview\n\n', '## System Overview\n\nBatch reconciler for invoices.\n\n'));
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.ok(!str006.some(f => f.location.endsWith('ARCHITECTURE.md')));
    });

    it('a document with a docguard:generated section is not a scaffold', () => {
      scaffold();
      write(dir, 'docs-canonical/ARCHITECTURE.md',
        `${template('ARCHITECTURE')}\n<!-- docguard:generated true -->\n`);
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.ok(!str006.some(f => f.location.endsWith('ARCHITECTURE.md')));
    });

    it('the per-document n/a marker silences STR006 for the document', () => {
      scaffold();
      write(dir, 'docs-canonical/ARCHITECTURE.md',
        `${template('ARCHITECTURE')}\n<!-- docguard:section scaffold n/a — kept blank on purpose -->\n`);
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.ok(!str006.some(f => f.location.endsWith('ARCHITECTURE.md')));
    });

    it('a document with no shipped template is never a scaffold', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\n## System Overview\n\n## Component Map\n\n## Tech Stack\n');
      write(dir, 'docs-canonical/NOTES.md', '# Notes\n\n## Heading\n');
      const str006 = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR006');
      assert.ok(!str006.some(f => f.location.endsWith('NOTES.md')));
    });

    it('a scaffold makes no readability claim through the DQ validators', () => {
      scaffold();
      const result = validateDocQuality(dir, loadConfig(dir));
      assert.deepEqual(codes(result).filter(c => c.startsWith('DQ')), []);
    });
  });
});

// ── Review round (2026-10-15): cases an independent review found ──────────
describe('doc validator fidelity — review findings', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'docguard-fidelity-review-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const CLI = join(ROOT, 'cli', 'docguard.mjs');
  const cli = (args, cwd = dir) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 120000 });

  describe('negation does not hide real drift (FR-003, FR-004)', () => {
    const arch = (body, deps = { react: '18.0.0' }) => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: deps }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', `# Architecture\n\n## Tech Stack\n\nReact.\n\n## Notes\n\n${body}\n`);
      return diffTechStack(dir, {});
    };

    for (const [sentence, tech] of [
      ['No Docker, Express serves the API directly.', 'Express'],
      ['Removed all Redis keys on logout.', 'Redis'],
      ['We replaced the Redis client library with ioredis.', 'Redis'],
      ['There are no Docker, Terraform and Redis stacks.', 'Redis'],
    ]) {
      it(`still documents ${tech}: ${sentence}`, () => {
        assert.ok(arch(sentence).onlyInDocs.includes(tech));
      });
    }

    for (const sentence of [
      'There is no Redis, PostgreSQL stores sessions.',
      'No changes to PostgreSQL, Redis or Express are needed.',
      'Works without Docker and PostgreSQL runs locally.',
    ]) {
      it(`does not lose PostgreSQL: ${sentence}`, () => {
        const result = arch(sentence, { react: '18.0.0', pg: '8.0.0', express: '4.0.0', redis: '4.0.0' });
        assert.ok(!result.onlyInCode.includes('PostgreSQL'), JSON.stringify(result));
      });
    }

    it('reads "no longer use the Terraform modules" as negation', () => {
      assert.ok(!arch('We no longer use the Terraform modules.').onlyInDocs.includes('Terraform'));
    });

    it('stays linear on a long line of coordinators', () => {
      const line = 'There are no ' + Array.from({ length: 27 }, () => 'a or').join(' ') + ' x : Terraform';
      const start = process.hrtime.bigint();
      arch(line);
      assert.ok(Number(process.hrtime.bigint() - start) / 1e6 < 1000, 'under one second');
    });
  });

  describe('change records respect code fences and comments (FR-005)', () => {
    const tech = (body) => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: { react: '18.0.0' } }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', `# Architecture\n\n${body}\n\n## Tech Stack\n\n| UI | React |\n| DB | PostgreSQL |\n`);
      return diffTechStack(dir, {}).onlyInDocs;
    };
    it('a `# history` line inside a fence is code, not a heading', () => {
      assert.ok(tech('## Operations\n\n```bash\n# history\nls\n```').includes('PostgreSQL'));
    });
    it('a change-record heading inside an HTML comment hides nothing', () => {
      assert.ok(tech('<!--\n## Changelog\n-->').includes('PostgreSQL'));
    });
    it('the spec\'s own sentences and rows (US3.5, US3.6)', () => {
      assert.ok(tech('## Infra\n\nTerraform manages DNS. Pulumi is not used.').includes('Terraform'));
      assert.ok(tech('## Stack notes\n\n| 0.3.0 | | Added Terraform for DNS |').includes('Terraform'));
      assert.ok(!tech('## Changelog\n\n| 0.3.0 | | Added Terraform for DNS |').includes('Terraform'));
    });
  });

  describe('brace forms (FR-002)', () => {
    it('spaces after the commas are not part of the paths', () => {
      assert.deepEqual([...extractDocumentedTests('`src/tests/{alpha, beta}.test.ts`')].sort(),
        ['src/tests/alpha.test.ts', 'src/tests/beta.test.ts']);
    });
    it('`?` in a documented glob is one character', () => {
      write(dir, 'src/lib/a1.test.js', '');
      write(dir, 'docs-canonical/TEST-SPEC.md', '# T\n\n## Test Categories\n\n`src/lib/a?.test.{js,jsx}`\n');
      assert.deepEqual(validateDocsDiff(dir, {}).findings.filter(f => f.code === 'DDF002'), []);
    });
  });

  describe('heading synonyms (FR-001)', () => {
    const headings = ['## Setup steps', '## Getting Started', '## 2. Setup Steps', '## Environment variables', '## Env Vars',
      '## Configuration', '## Configuration Files', '## Production environment', '## Test environment', '## Environment'];
    for (const heading of ['## Configuration Files', '## Production environment', '## Test environment']) {
      it(`ENV002 is not satisfied by "${heading}"`, () => {
        write(dir, 'docs-canonical/ENVIRONMENT.md', `# Environment\n\n## Setup Steps\n\nnpm i\n\n${heading}\n\ntext\n`);
        assert.ok(codes(validateEnvironment(dir, {})).includes('ENV002'));
      });
    }
    it('ENV001/ENV002 and STR003 give the same answer for every heading', () => {
      for (const heading of headings) {
        write(dir, 'docs-canonical/ENVIRONMENT.md', `# Environment\n\n${heading}\n\ntext\n`);
        const env = codes(validateEnvironment(dir, {}));
        const str = validateDocSections(dir, {}).findings.filter(f => f.code === 'STR003').map(f => f.message);
        const envHasVars = !env.includes('ENV002');
        const strHasVars = !str.some(m => m.includes('Environment Variables'));
        const envHasSetup = !env.includes('ENV001');
        const strHasSetup = !str.some(m => m.includes('Setup Steps'));
        assert.equal(envHasVars, strHasVars, `${heading}: Environment Variables`);
        assert.equal(envHasSetup, strHasSetup, `${heading}: Setup Steps`);
      }
    });
  });

  describe('scaffolds as init writes them (FR-006..FR-009, SC-003)', () => {
    const init = () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      fixtureGit(dir, ['init', '-q']);
      const r = cli(['init', '--skip-prompts']);
      assert.equal(r.status, 0, r.stderr);
    };

    it('every canonical document init writes is a scaffold, Legible is a gap and Machine markers counts none', () => {
      init();
      const config = loadConfig(dir);
      for (const name of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT']) {
        assert.equal(isUneditedScaffold(readFileSync(join(dir, 'docs-canonical', `${name}.md`), 'utf8'), name), true, name);
      }
      const score = runScoreInternal(dir, config);
      assert.ok(score.categories.docQuality < 60);
      assert.equal(computeAlcoaCompliance(dir, config, score.categories).attributes.find(a => a.name === 'Legible').met, false);
      const marker = assessAgentReadability(dir, config).metrics.find(m => m.key === 'marker-presence');
      assert.equal(marker.score, 0, marker.detail);
    });

    it('a remapped document (docs.roles) is matched to its role template everywhere', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      write(dir, 'docs/architecture.md', template('ARCHITECTURE'));
      write(dir, '.docguard.json', JSON.stringify({ docs: { roles: { architecture: 'docs/architecture.md' } } }));
      const config = loadConfig(dir);
      assert.ok(validateDocSections(dir, config).findings.some(f => f.code === 'STR006' && f.location === 'docs/architecture.md'));
      const marker = assessAgentReadability(dir, config).metrics.find(m => m.key === 'marker-presence');
      assert.match(marker.detail, /^0\/1 /);
    });

    it('stays a scaffold with every heading deleted', () => {
      const headless = template('ARCHITECTURE').split('\n').filter(l => !/^#{1,6}\s/.test(l)).join('\n');
      // No heading is shared with the template, so it is not recognised: the safe direction.
      assert.equal(isUneditedScaffold(headless, 'ARCHITECTURE'), false);
      const withTitle = `## System Overview\n${headless}`;
      assert.equal(isUneditedScaffold(withTitle, 'ARCHITECTURE'), true);
    });

    it('names the unchosen status as evidence', () => {
      write(dir, 'docs-canonical/ARCHITECTURE.md', template('ARCHITECTURE'));
      const finding = validateDocSections(dir, {}).findings.find(f => f.code === 'STR006');
      assert.match(finding.message, /status not chosen/);
    });

    it('a reasoned section N/A marker owns the document: no STR006, and it is scored as written', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
      const owned = `${template('SECURITY')}\n<!-- docguard:section authentication n/a — CLI tool, no auth layer -->\n`;
      write(dir, 'docs-canonical/SECURITY.md', owned);
      assert.equal(isUneditedScaffold(owned, 'SECURITY'), false);
      assert.ok(!validateDocSections(dir, {}).findings.some(f => f.code === 'STR006'));
      const bare = `${template('SECURITY')}\n<!-- docguard:section authentication n/a -->\n`;
      assert.equal(isUneditedScaffold(bare, 'SECURITY'), true, 'a marker without a reason owns nothing');
    });
  });

  describe('dictionaries keyed by outside input (FR-012)', () => {
    it('explain and hooks report an unknown name instead of crashing', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x' }));
      for (const args of [['explain', 'constructor'], ['explain', 'CONSTRUCTOR'], ['explain', '__proto__'], ['hooks', '--type', 'constructor']]) {
        const r = cli(args);
        assert.doesNotMatch(`${r.stdout}${r.stderr}`, /TypeError|Cannot read properties/, args.join(' '));
      }
    });

    it('an MCP tool named after an Object.prototype property is an unknown tool', () => {
      write(dir, 'package.json', JSON.stringify({ name: 'x' }));
      const messages = [
        { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'constructor', arguments: {} } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'toString', arguments: {} } },
      ];
      const r = spawnSync(process.execPath, [CLI, 'mcp'], { cwd: dir, input: `${messages.map(m => JSON.stringify(m)).join('\n')}\n`, encoding: 'utf8' });
      const byId = new Map(r.stdout.trim().split('\n').map(l => JSON.parse(l)).map(m => [m.id, m]));
      for (const id of [1, 2]) {
        const m = byId.get(id);
        assert.ok(m.error || m.result?.isError, JSON.stringify(m));
      }
    });
  });
});
