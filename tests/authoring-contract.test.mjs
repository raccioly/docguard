/**
 * What DocGuard tells authors to write is what its validators accept
 * (specs/082-authoring-contract): a round trip from every piece of guidance
 * and every template back through the validators and parsers.
 *
 * @req docguard.authoring-contract#FR-001
 * @req docguard.authoring-contract#FR-002
 * @req docguard.authoring-contract#FR-003
 * @req docguard.authoring-contract#FR-004
 * @req docguard.authoring-contract#FR-005
 * @req docguard.authoring-contract#FR-006
 * @req docguard.authoring-contract#SC-001
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { CANONICAL_SECTIONS, requiredSectionMap, requiredSectionsSentence, sectionsFor, skillSectionBlock } from '../cli/authoring-contract.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { docHasSection, PROFILES } from '../cli/shared.mjs';
import { DOC_EXPECTATIONS } from '../cli/commands/fix.mjs';
import { runScoreInternal } from '../cli/commands/score.mjs';
import { parseAdrFile } from '../cli/validators/decision-records.mjs';
import { definedIds } from '../cli/scanners/chain-coverage.mjs';
import { incidentDocs } from '../cli/commands/score-dora.mjs';
import { withAuthoringBlock, AUTHORING_BLOCK_FILES } from '../tools/generate-docs-reference.mjs';

const CLI = resolve('cli/docguard.mjs');
const DOCS = Object.keys(CANONICAL_SECTIONS);
const name = path => path.replace('docs-canonical/', '');

function project(t, files) {
  const dir = makeTempDir('docguard-authoring-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
}
const str003 = (dir, config = {}) => validateDocSections(dir, config).findings.filter(f => f.code === 'STR003');

/** A document made of exactly these headings, each with a sentence. */
const docFrom = (title, headings) => `# ${title}\n\n${headings.map(h => `## ${h}\n\nThe project documents this here in plain words for its readers.\nIt names the real files and commands.\nIt is reviewed with every change.\n`).join('\n')}`;

/** Headings a piece of guidance names: "- Heading: what" lines, or a comma list after "**DOC.md**:". */
const promptHeadings = text => [...text.matchAll(/^- ([A-Z][^:(\n]+?)(?: \(recommended\))?:/gm)].map(m => m[1].trim());
const skillHeadings = (block, doc) => {
  const line = block.split('\n').find(l => l.includes(`**${name(doc)}**`));
  return line ? line.split('**:')[1].replace(/recommended:/, ',').replace(/\([^)]*\)/g, '').split(/[;,]/).map(s => s.trim()).filter(Boolean) : [];
};

/** Fail when a required section has no guidance heading the validator accepts for it. */
function unacceptedRequired(doc, headings) {
  const written = docFrom(name(doc), headings);
  return requiredSectionMap({})[doc].filter(req => !docHasSection(written, req));
}

describe('US1 — following DocGuard\'s guidance passes DocGuard', () => {
  it('the guidance before spec 082 did not: the old skill list fails three required sections', () => {
    const OLD = {
      'docs-canonical/ARCHITECTURE.md': ['System Overview', 'Component Map', 'Layer Boundaries', 'Data Flow', 'Technology Choices'],
      'docs-canonical/TEST-SPEC.md': ['Test Framework', 'Test Structure', 'Test Commands', 'Critical Flows', 'Coverage'],
      'docs-canonical/DATA-MODEL.md': ['Data Structures/Schemas', 'Field Types/Constraints', 'Relationships', 'Indexes'],
    };
    assert.deepEqual(Object.entries(OLD).map(([doc, hs]) => unacceptedRequired(doc, hs)), [['## Tech Stack'], ['## Test Categories'], ['## Entities']]);
  });

  for (const doc of DOCS) {
    it(`${name(doc)}: the fix prompt, the Spec Kit skill and explain name every required section`, () => {
      assert.deepEqual(unacceptedRequired(doc, promptHeadings(DOC_EXPECTATIONS[doc].aiResearchInstructions)), [], 'fix prompt');
      assert.deepEqual(unacceptedRequired(doc, skillHeadings(skillSectionBlock(), doc)), [], 'skill block');
      for (const req of requiredSectionMap({})[doc]) assert.ok(requiredSectionsSentence().includes(req.replace('## ', '')), `explain: ${req}`);
    });
  }

  it('a document written from exactly the guided headings has no STR003', t => {
    const files = Object.fromEntries(DOCS.map(doc => [doc, docFrom(name(doc), sectionsFor(doc).map(s => s.heading))]));
    assert.deepEqual(str003(project(t, files)), []);
  });
});

describe('FR-003 — the skill and its mirror carry the generated block', () => {
  it('both files are current with the registry', () => {
    for (const rel of AUTHORING_BLOCK_FILES) {
      const text = readFileSync(rel, 'utf8');
      assert.equal(withAuthoringBlock(text), text, `${rel} is stale — run npm run docs:reference`);
    }
  });
});

describe('FR-004 — memory --plan prompts name registry sections', () => {
  it('every canonical section memory-plan asks for is in the registry', () => {
    const source = readFileSync('cli/scanners/memory-plan.mjs', 'utf8');
    const all = new Set(DOCS.flatMap(doc => CANONICAL_SECTIONS[doc].map(s => s.heading)));
    for (const asked of ['System Overview', 'Component Map', 'Test Categories', 'Coverage Rules', 'Setup Steps']) {
      assert.ok(source.includes(`'${asked}'`), `memory-plan no longer asks for ${asked}`);
      assert.ok(all.has(asked), `${asked} is not a registry section`);
    }
  });
});

describe('US2 — templates and generators yield documents the validators accept', () => {
  const template = n => readFileSync(`templates/${n}.md.template`, 'utf8');
  const fill = text => text.replace(/<!--(?!\s*docguard:)[\s\S]*?-->/g, 'Filled in by the round-trip test.').replace(/\|\s*\|/g, '| Filled |');

  it('every canonical template, filled, has no STR003 or STR006', t => {
    const files = Object.fromEntries(DOCS.map(doc => [doc, fill(template(name(doc).replace('.md', '')))]));
    const findings = validateDocSections(project(t, files), {}).findings.filter(f => ['STR003', 'STR006'].includes(f.code));
    assert.deepEqual(findings.map(f => `${f.code} ${f.message}`), []);
  });

  it('generate writes canonical docs with every required section', t => {
    const dir = project(t, {
      'package.json': '{"name":"fx","dependencies":{"express":"^4"}}\n',
      'src/app.js': "const express = require('express');\nconst app = express();\napp.get('/users', (req, res) => res.json([]));\nconst k = process.env.API_KEY;\nmodule.exports = app;\n",
    });
    const r = spawnSync(process.execPath, [CLI, 'generate', '--force'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(str003(dir).map(f => f.message), []);
  });

  it('each template\'s reader finds what the template promises', t => {
    const adr = parseAdrFile(fill(template('ADR')), 'docs-canonical/ADR.md');
    assert.ok(adr.records.some(r => r.status), 'ADR: a record with a status');
    // The example rows stay commented so a fresh document defines nothing; uncommented, they are definitions.
    assert.equal(definedIds(template('REQUIREMENTS')).size, 0, 'REQUIREMENTS: an empty template defines no requirement');
    const examples = template('REQUIREMENTS').replace(/<!--[^\n]*\n|-->/g, '');
    assert.ok(definedIds(examples).has('FR-001') && definedIds(examples).has('SC-001'), 'REQUIREMENTS: the example rows are definitions');
    const dir = project(t, { 'docs/RUNBOOKS.md': template('RUNBOOKS'), 'docs/TROUBLESHOOTING.md': template('TROUBLESHOOTING') });
    for (const d of incidentDocs(['docs/RUNBOOKS.md', 'docs/TROUBLESHOOTING.md'], dir)) assert.ok(d.scenarios >= 2, `${d.file}: scenario headings`);
    assert.match(template('CHANGELOG'), /^## \[Unreleased\]/m, 'CHANGELOG: [Unreleased]');
  });
});

describe('US3 — the score requires what STR003 requires', () => {
  it('a CLI project without Entities loses no Doc Quality points for it', t => {
    const files = Object.fromEntries(DOCS.map(doc => [doc, docFrom(name(doc), sectionsFor(doc, { needsDatabase: false }).map(s => s.heading))]));
    const dir = project(t, files);
    const cfg = { projectName: 'x', requiredFiles: { canonical: DOCS, agentFile: [], changelog: 'CHANGELOG.md', driftLog: 'DRIFT-LOG.md' }, projectTypeConfig: { needsDatabase: false } };
    assert.deepEqual(str003(dir, cfg), []);
    assert.equal(runScoreInternal(dir, cfg).categories.docQuality, 100);
  });
});

describe('US4 — a profile\'s extra sections are reported, advisory', () => {
  it('the enterprise-ai profile names Risk Assessment and Threat Model as STR007; a reasoned N/A marker owns one', t => {
    const dir = project(t, { 'docs-canonical/SECURITY.md': `${docFrom('Security', ['Authentication', 'Secrets Management', 'Threat Model'])}\n<!-- docguard:section risk-assessment n/a — a local tool with no deployment -->\n` });
    const config = { requiredSections: PROFILES['enterprise-ai'].requiredSections };
    assert.deepEqual(validateDocSections(dir, config).findings.filter(f => f.code === 'STR007'), []);
    const bare = project(t, { 'docs-canonical/SECURITY.md': docFrom('Security', ['Authentication', 'Secrets Management']) });
    const str007 = validateDocSections(bare, config).findings.filter(f => f.code === 'STR007');
    assert.deepEqual(str007.map(f => f.message.match(/"([^"]+)"/)[1]), ['Risk Assessment', 'Threat Model']);
  });
});
