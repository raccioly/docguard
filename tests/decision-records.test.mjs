/**
 * Decision records (specs/086-decision-records).
 *
 * @req docguard.decision-records#FR-001
 * @req docguard.decision-records#FR-002
 * @req docguard.decision-records#FR-003
 * @req docguard.decision-records#FR-004
 * @req docguard.decision-records#FR-005
 * @req docguard.decision-records#FR-006
 * @req docguard.decision-records#FR-007
 * @req docguard.decision-records#FR-008
 * @req docguard.decision-records#SC-001
 * @req docguard.decision-records#SC-003
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { normalizeStatus, parseAdrFile, validateDecisionRecords } from '../cli/validators/decision-records.mjs';
import { ABSENCE_CLAIM_CODES, codeDefaultLevel } from '../cli/findings.mjs';

function project(t, files) {
  const dir = makeTempDir('docguard-dec-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  return dir;
}
const codes = r => r.findings.map(f => `${f.code} ${f.message}`);

describe('US1 — every ADR has a known status', () => {
  it('reports missing and unknown statuses; reads emoji, emphasis, headings and synonyms', t => {
    const dir = project(t, { 'docs-canonical/ADR.md': '# ADR\n\n## ADR-001: a\n\n**Status**: ✅ Accepted\n\n## ADR-002: b\n\nNo status here.\n\n## ADR-003: c\n\n**Status:** Done\n\n## ADR-004: d\n\n### Status (ADR-004)\n**Approved**\n' });
    const r = validateDecisionRecords(dir, {});
    const dec1 = codes(r).filter(c => c.startsWith('DEC001'));
    assert.equal(dec1.length, 2);
    assert.ok(dec1.some(c => /ADR-002 .*has no status/.test(c)));
    assert.ok(dec1.some(c => /ADR-003 status "Done"/.test(c)));
    assert.equal(normalizeStatus('**superseded**'), 'superseded');
    assert.equal(normalizeStatus('Proposal'), 'proposed');
  });

  it('reads MADR front matter in one file per decision', t => {
    const dir = project(t, { 'docs/adr/0003-use-x.md': '---\nstatus: accepted\nsupersedes: [adr-0001]\n---\n# Use X\n', 'docs/adr/0001-use-y.md': '---\nstatus: superseded\nsuperseded_by: adr-0003\n---\n# Use Y\n' });
    assert.deepEqual(codes(validateDecisionRecords(dir, { docs: { dirs: ['docs'] } })), []);
  });
});

describe('US2 — supersession is reciprocal and names real records', () => {
  it('reports one-way links, dangling links and superseded without a successor', t => {
    const dir = project(t, { 'docs-canonical/ADR.md': '# ADR\n\n## ADR-003: old\n\n**Status**: Accepted\n\n## ADR-005: lone\n\n**Status**: Superseded\n\n## ADR-007: new\n\n**Status**: Accepted\n\nSupersedes ADR-003\n\n## ADR-008: gone\n\n**Status**: Superseded\n- Superseded by ADR-012\n\n## ADR-009: talk\n\n**Status**: Accepted\n\nThis supersedes the ADR-003 posture in spirit.\n' });
    const c = codes(validateDecisionRecords(dir, {}));
    assert.ok(c.some(x => /^DEC003 ADR-007 supersedes ADR-003, but ADR-003 still reads accepted/.test(x)));
    assert.ok(c.some(x => /^DEC002 ADR-008 links to ADR-012/.test(x)));
    assert.ok(c.some(x => /^DEC004 ADR-005 is superseded but names no successor/.test(x)));
    assert.ok(!c.some(x => /ADR-009/.test(x)), 'prose mention is not a supersession link');
  });

  it('"partially superseded by" is not supersession', () => {
    const r = parseAdrFile('## ADR-002: x\n\n**Status**: Accepted\n\n**Partially superseded by ADR-015.**\n', 'ADR.md').records[0];
    assert.deepEqual(r.supersededBy, []);
  });
});

describe('US3 — the index agrees with the records', () => {
  it('reports a status mismatch and an index row with no record', t => {
    const dir = project(t, { 'docs-canonical/ADR.md': '# ADR\n\n| # | Title | Status | Date |\n|---|---|---|---|\n| ADR-004 | x | ✅ Accepted | 2026 |\n| ADR-006 | y | Proposed | 2026 |\n\n## ADR-004: x\n\n**Status**: Deprecated\n' });
    const c = codes(validateDecisionRecords(dir, {}));
    assert.ok(c.some(x => /^DEC005 The index says ADR-004 is accepted; its record says deprecated/.test(x)));
    assert.ok(c.some(x => /^DEC002 The index lists ADR-006/.test(x)));
  });
});

describe('US4 — asked questions have answers', () => {
  it('reports empty clarifications and blank [Answer]: tags; wrapped and parenthetical answers count', t => {
    const dir = project(t, {
      'specs/001-a/spec.md': '# A\n\n## Clarifications\n\n### Session 2026-11-01\n\n- Q: Which store? → A:\n- Q: How long is a link valid, and how many emails does an unclaimed\n  invite get? → A: Seven days, one reminder.\n- Q: Can one tap skip it? → A (recommended, approved): No.\n\n## Requirements\n',
      'aidlc/spaces/default/intents/261101-x/inception/requirements-questions.md': '## Q1\n\nWhich region?\n\n[Answer]:\n\n## Q2\n\nWhich runtime?\n\n[Answer]: Node 22\n',
    });
    const c = codes(validateDecisionRecords(dir, {}));
    assert.equal(c.filter(x => x.startsWith('DEC006')).length, 2);
    assert.ok(c.some(x => /spec\.md:7 — question has no answer: Which store\?/.test(x)));
    assert.ok(c.some(x => /requirements-questions\.md:5/.test(x)));
  });
});

describe('FR-008, SC-003 — advisory, empty when absent, quiet on the scaffold', () => {
  it('ships advisory, treats DEC002 as an absence claim, and is not applicable with nothing to read', t => {
    for (const code of ['DEC001', 'DEC002', 'DEC003', 'DEC004', 'DEC005', 'DEC006']) assert.equal(codeDefaultLevel(code), 'info');
    assert.ok(ABSENCE_CLAIM_CODES.has('DEC002'));
    const r = validateDecisionRecords(project(t, { 'README.md': '# x\n' }), {});
    assert.equal(r.applicable, false);
  });

  it('the ADR template docguard init writes produces no finding', t => {
    const dir = project(t, { 'docs-canonical/ADR.md': readFileSync('templates/ADR.md.template', 'utf8') });
    assert.deepEqual(codes(validateDecisionRecords(dir, {})), []);
  });
});
