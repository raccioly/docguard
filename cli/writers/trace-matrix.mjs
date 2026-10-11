/**
 * Trace-matrix serializers: CSV (RFC 4180) and ReqIF 1.2, for teams that hand
 * the requirement → code → test chain to a spreadsheet, DOORS or Polarion.
 *
 * Spec: specs/070-requirement-anchors (user story 8,
 * contracts/trace-matrix.md). Pure: rows in, text out. The rows come from
 * `traceMatrix()` in cli/scanners/anchors.mjs, already in their final order.
 *
 * @implements docguard.requirement-anchors#FR-037
 */

import { createHash } from 'node:crypto';

export const CSV_COLUMNS = Object.freeze([
  'requirement', 'requirement_fp', 'spec_state', 'file', 'anchor', 'scope', 'tier', 'confidence',
  'link_state', 'suspect_side', 'code_fp', 'reviewed_revision', 'reviewed_date', 'test_file', 'test_line', 'test_status',
]);

/** A spreadsheet runs a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One header row and one row per matrix row, `\n` line ends, trailing newline. */
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(col => csvCell(row[col])).join(','));
  return `${lines.join('\n')}\n`;
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Escape for an attribute or text node, dropping characters XML 1.0 cannot carry. */
export function xmlEscape(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"']/g, ch => XML_ESCAPES[ch]);
}

/** A stable ReqIF identifier: `_` + the first 16 hex digits of sha1(key) (research P9). */
export const reqifId = key => `_${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;

const TEST_STATUS_RANK = { 'needs-reverification': 3, inconclusive: 2, 're-verified': 1, linked: 0 };

/**
 * The ReqIF objects and relations behind matrix rows: each requirement,
 * anchor and test once, in row order. A test cited by several links of one
 * requirement takes its most cautious status.
 */
export function matrixModel(rows, requirements) {
  const reqs = requirements.map(r => ({ key: r.identity, id: reqifId(`requirement|${r.identity}`), fingerprint: r.fingerprint, specState: r.specState }));
  const reqId = new Map(reqs.map(r => [r.key, r.id]));
  const anchors = new Map();
  const tests = new Map();
  const relations = new Map();
  for (const row of rows) {
    const target = reqId.get(row.requirement);
    if (row.key && !anchors.has(row.key)) {
      anchors.set(row.key, { key: row.key, id: reqifId(`anchor|${row.key}`), file: row.file, anchor: row.anchor, scope: row.scope, tier: row.tier, state: row.link_state, fingerprint: row.code_fp });
      relations.set(`implements|${row.key}`, { key: `implements|${row.key}`, id: reqifId(`implements|${row.key}`), type: 'implements', source: anchors.get(row.key).id, target });
    }
    if (row.test_file) {
      const key = `${row.requirement}|${row.test_file}|${row.test_line}`;
      const prior = tests.get(key);
      if (!prior) {
        tests.set(key, { key, id: reqifId(`test|${key}`), file: row.test_file, line: row.test_line, status: row.test_status });
        relations.set(`verifies|${key}`, { key: `verifies|${key}`, id: reqifId(`verifies|${key}`), type: 'verifies', source: tests.get(key).id, target });
      } else if ((TEST_STATUS_RANK[row.test_status] ?? 0) > (TEST_STATUS_RANK[prior.status] ?? 0)) prior.status = row.test_status;
    }
  }
  return { requirements: reqs, anchors: [...anchors.values()], tests: [...tests.values()], relations: [...relations.values()] };
}

const NAMESPACE = 'http://www.omg.org/spec/ReqIF/20110401/reqif.xsd';
export const FIXED_CREATION_TIME = '1970-01-01T00:00:00Z';

const OBJECT_TYPES = [
  { key: 'Requirement', attrs: [['ID', 'key'], ['Fingerprint', 'fingerprint'], ['Spec state', 'specState']] },
  { key: 'Anchor', attrs: [['File', 'file'], ['Anchor', 'anchor'], ['Scope', 'scope'], ['Tier', 'tier'], ['State', 'state'], ['Fingerprint', 'fingerprint']] },
  { key: 'Test', attrs: [['File', 'file'], ['Line', 'line'], ['Status', 'status']] },
];
const RELATION_TYPES = [['implements', 'Anchor implements Requirement'], ['verifies', 'Test verifies Requirement']];

/**
 * The matrix as a ReqIF 1.2 document: requirements, anchors and tests as spec
 * objects; `implements` (anchor → requirement) and `verifies` (test →
 * requirement) as spec relations; one specification listing the requirements.
 * @param {{ requirements: object[], anchors: object[], tests: object[], relations: object[] }} model
 * @param {{ creationTime?: string, toolVersion?: string }} [options]
 */
export function toReqif(model, options = {}) {
  const time = xmlEscape(options.creationTime || FIXED_CREATION_TIME);
  const stamp = `LAST-CHANGE="${time}"`;
  const typeId = name => reqifId(`type|${name}`);
  const attrId = (type, name) => reqifId(`attr|${type}|${name}`);
  const stringType = reqifId('datatype|string');
  const out = [];
  const push = (depth, line) => out.push(`${'  '.repeat(depth)}${line}`);

  const ids = new Set();
  const claim = (id, what) => {
    if (ids.has(id)) throw new Error(`ReqIF identifier collision on ${what}`);
    ids.add(id);
    return id;
  };

  push(0, '<?xml version="1.0" encoding="UTF-8"?>');
  push(0, `<REQ-IF xmlns="${NAMESPACE}">`);
  push(1, '<THE-HEADER>');
  push(2, `<REQ-IF-HEADER IDENTIFIER="${claim(reqifId('header'), 'header')}">`);
  push(3, `<CREATION-TIME>${time}</CREATION-TIME>`);
  push(3, '<REQ-IF-TOOL-ID>DocGuard</REQ-IF-TOOL-ID>');
  push(3, '<REQ-IF-VERSION>1.0</REQ-IF-VERSION>');
  push(3, `<SOURCE-TOOL-ID>${xmlEscape(`docguard-cli ${options.toolVersion || ''}`.trim())}</SOURCE-TOOL-ID>`);
  push(3, '<TITLE>DocGuard trace matrix</TITLE>');
  push(2, '</REQ-IF-HEADER>');
  push(1, '</THE-HEADER>');
  push(1, '<CORE-CONTENT>');
  push(2, '<REQ-IF-CONTENT>');

  push(3, '<DATATYPES>');
  push(4, `<DATATYPE-DEFINITION-STRING IDENTIFIER="${claim(stringType, 'string datatype')}" ${stamp} LONG-NAME="String" MAX-LENGTH="10000"/>`);
  push(3, '</DATATYPES>');

  push(3, '<SPEC-TYPES>');
  for (const type of OBJECT_TYPES) {
    push(4, `<SPEC-OBJECT-TYPE IDENTIFIER="${claim(typeId(type.key), type.key)}" ${stamp} LONG-NAME="${type.key}">`);
    push(5, '<SPEC-ATTRIBUTES>');
    for (const [name] of type.attrs) {
      push(6, `<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="${claim(attrId(type.key, name), `${type.key}.${name}`)}" ${stamp} LONG-NAME="${name}">`);
      push(7, `<TYPE><DATATYPE-DEFINITION-STRING-REF>${stringType}</DATATYPE-DEFINITION-STRING-REF></TYPE>`);
      push(6, '</ATTRIBUTE-DEFINITION-STRING>');
    }
    push(5, '</SPEC-ATTRIBUTES>');
    push(4, '</SPEC-OBJECT-TYPE>');
  }
  for (const [key, label] of RELATION_TYPES) push(4, `<SPEC-RELATION-TYPE IDENTIFIER="${claim(typeId(key), key)}" ${stamp} LONG-NAME="${key}" DESC="${xmlEscape(label)}"/>`);
  push(4, `<SPECIFICATION-TYPE IDENTIFIER="${claim(typeId('specification'), 'specification type')}" ${stamp} LONG-NAME="Trace matrix"/>`);
  push(3, '</SPEC-TYPES>');

  push(3, '<SPEC-OBJECTS>');
  const objects = [['Requirement', model.requirements], ['Anchor', model.anchors], ['Test', model.tests]];
  for (const [typeKey, items] of objects) {
    const type = OBJECT_TYPES.find(t => t.key === typeKey);
    for (const item of items) {
      push(4, `<SPEC-OBJECT IDENTIFIER="${claim(item.id, `${typeKey} ${item.key}`)}" ${stamp}>`);
      push(5, '<VALUES>');
      for (const [name, field] of type.attrs) {
        push(6, `<ATTRIBUTE-VALUE-STRING THE-VALUE="${xmlEscape(item[field])}">`);
        push(7, `<DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>${attrId(typeKey, name)}</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>`);
        push(6, '</ATTRIBUTE-VALUE-STRING>');
      }
      push(5, '</VALUES>');
      push(5, `<TYPE><SPEC-OBJECT-TYPE-REF>${typeId(typeKey)}</SPEC-OBJECT-TYPE-REF></TYPE>`);
      push(4, '</SPEC-OBJECT>');
    }
  }
  push(3, '</SPEC-OBJECTS>');

  push(3, '<SPEC-RELATIONS>');
  for (const rel of model.relations) {
    push(4, `<SPEC-RELATION IDENTIFIER="${claim(rel.id, `relation ${rel.key}`)}" ${stamp}>`);
    push(5, `<TARGET><SPEC-OBJECT-REF>${rel.target}</SPEC-OBJECT-REF></TARGET>`);
    push(5, `<SOURCE><SPEC-OBJECT-REF>${rel.source}</SPEC-OBJECT-REF></SOURCE>`);
    push(5, `<TYPE><SPEC-RELATION-TYPE-REF>${typeId(rel.type)}</SPEC-RELATION-TYPE-REF></TYPE>`);
    push(4, '</SPEC-RELATION>');
  }
  push(3, '</SPEC-RELATIONS>');

  push(3, '<SPECIFICATIONS>');
  push(4, `<SPECIFICATION IDENTIFIER="${claim(reqifId('specification'), 'specification')}" ${stamp} LONG-NAME="DocGuard trace matrix">`);
  push(5, `<TYPE><SPECIFICATION-TYPE-REF>${typeId('specification')}</SPECIFICATION-TYPE-REF></TYPE>`);
  if (model.requirements.length) {
    push(5, '<CHILDREN>');
    for (const req of model.requirements) {
      push(6, `<SPEC-HIERARCHY IDENTIFIER="${claim(reqifId(`hierarchy|${req.key}`), `hierarchy ${req.key}`)}" ${stamp}>`);
      push(7, `<OBJECT><SPEC-OBJECT-REF>${req.id}</SPEC-OBJECT-REF></OBJECT>`);
      push(6, '</SPEC-HIERARCHY>');
    }
    push(5, '</CHILDREN>');
  }
  push(4, '</SPECIFICATION>');
  push(3, '</SPECIFICATIONS>');

  push(2, '</REQ-IF-CONTENT>');
  push(1, '</CORE-CONTENT>');
  push(0, '</REQ-IF>');
  return `${out.join('\n')}\n`;
}
