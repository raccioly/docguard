/**
 * Spec 104, Stage 5 (T041, SC-006): every row of the R1 inventory has a test that
 * was red before the change, or an "unchanged by decision" entry with its reason
 * (`specs/104-document-languages/r1-coverage.md`). This test keeps that table
 * honest: one entry per R1 row, each cited test file exists and contains the
 * token it is cited by, each decision cites something the spec says. It also
 * holds the one R1 row (3, profile `requiredSections`) that no earlier stage
 * tested in another language.
 *
 * @req docguard.document-languages#SC-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';

const read = rel => readFileSync(resolve(rel), 'utf8');
const SPEC = read('specs/104-document-languages/spec.md');
const R1 = (() => {
  const start = SPEC.indexOf('### R1.');
  const end = SPEC.indexOf('Not matched by language', start);
  return SPEC.slice(start, end).split('\n').filter(line => /^\| `/.test(line));
})();
const COVERAGE = read('specs/104-document-languages/r1-coverage.md').split('\n')
  .filter(line => /^\| \d+ \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));

describe('SC-006: the R1 inventory is covered row by row', () => {
  it('the spec has 41 rows and the coverage table has one entry for each, in order', () => {
    assert.equal(R1.length, 41);
    assert.deepEqual(COVERAGE.map(row => Number(row[0])), R1.map((_, i) => i + 1));
  });

  it('each red-before entry cites a test file that exists and contains its token', () => {
    for (const [n, kind, stage, file, token] of COVERAGE.filter(row => row[1] === 'red-before test')) {
      const path = file.replace(/`/g, '');
      assert.ok(existsSync(resolve(path)), `row ${n}: ${path} exists`);
      assert.ok(read(path).includes(token.replace(/`/g, '')), `row ${n}: ${path} contains ${token}`);
      assert.match(stage, /^[0-5]$/, `row ${n}: a stage`);
    }
  });

  it('each unchanged-by-decision entry cites a decision or requirement the spec has, and gives a reason', () => {
    const decisions = COVERAGE.filter(row => row[1] === 'unchanged by decision');
    assert.ok(decisions.length >= 3);
    for (const [n, , , , token, reason] of decisions) {
      const cited = token.replace(/`/g, '');
      const found = cited.startsWith('Decision') ? new RegExp(`\\b${cited}\\b|\\*\\*${cited}`).test(SPEC) || SPEC.includes(cited) : SPEC.includes(`**${cited}**`);
      assert.ok(found, `row ${n}: the spec has ${cited}`);
      assert.ok(reason.length > 20, `row ${n}: a reason`);
    }
  });
});

describe('R1 row 3: a profile\'s requiredSections (STR007) read by id', () => {
  function project(docs) {
    const dir = makeTempDir('docguard-lang-str007-');
    const files = {
      'package.json': JSON.stringify({ name: 'p' }),
      'docs-canonical/ARCHITECTURE.md': '# Arquitetura\n\n## Pilha tecnológica\n\nNode.js com Express e um banco de dados local para os pedidos.\n',
      '.docguard.json': JSON.stringify({ projectName: 'p', requiredSections: { 'ARCHITECTURE.md': ['Tech Stack'] }, ...(docs ? { docs } : {}) }),
    };
    for (const [rel, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); }
    return dir;
  }
  const codes = dir => validateDocSections(dir, loadConfig(dir)).findings.map(f => f.code);

  it('with docs.language "pt-BR" a Portuguese heading satisfies the profile\'s Tech Stack', () => {
    assert.ok(!codes(project({ language: 'pt-BR' })).includes('STR007'));
  });

  it('without docs.language the profile section is still missing (unchanged)', () => {
    assert.ok(codes(project(null)).includes('STR007'));
  });
});
