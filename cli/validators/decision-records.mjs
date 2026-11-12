/**
 * Decision-Records validator (specs/086-decision-records): ADRs carry a known
 * status, supersession holds both ways and names real records, the index
 * agrees with the records, and asked questions have answers.
 *
 *   DEC001  ADR status missing or unknown
 *   DEC002  supersession link or index row names an ADR no record defines
 *   DEC003  one-way supersession
 *   DEC004  superseded without a successor, or a successor without `superseded`
 *   DEC005  index status differs from the record's status
 *   DEC006  question with no answer (Spec Kit clarification, `[Answer]:` tag)
 *
 * All advisory by default (docguard.enforcement-ladder). Layouts are the ones
 * REF002 already recognizes: `## ADR-NNN` sections in one file, or one file
 * per decision under adr/, adrs/ or decisions/.
 *
 * @implements docguard.decision-records#FR-001
 * @implements docguard.decision-records#FR-002
 * @implements docguard.decision-records#FR-003
 * @implements docguard.decision-records#FR-004
 * @implements docguard.decision-records#FR-005
 * @implements docguard.decision-records#FR-006
 * @implements docguard.decision-records#FR-007
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { walkFiles } from '../shared-ignore.mjs';
import { resolveDocDirs } from '../shared.mjs';
import { contractFields } from '../shared-result-contract.mjs';

const VALIDATOR = 'decisionRecords';
const STATUS = new Set(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']);
const SYNONYM = { approved: 'accepted', draft: 'proposed', proposal: 'proposed', obsolete: 'deprecated', replaced: 'superseded' };
const ADR_HOME_RE = /(?:^|\/)(?:adrs?|decisions?)\//i;
const TERMINAL_STATUS_RE = /\b(?:superseded|retired|archived|withdrawn|obsolete|abandoned)\b/i;

/** Lines with fenced code and HTML comments blanked, keeping line numbers. */
function prose(text) {
  let fence = null;
  let comment = false;
  return text.split(/\r?\n/).map(line => {
    const f = line.trim().match(/^(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return ''; }
    if (f) { fence = f[1]; return ''; }
    let out = '', rest = line;
    while (rest) {
      if (comment) { const e = rest.indexOf('-->'); if (e < 0) { rest = ''; break; } comment = false; rest = rest.slice(e + 3); }
      else { const s = rest.indexOf('<!--'); if (s < 0) { out += rest; break; } out += rest.slice(0, s); comment = true; rest = rest.slice(s + 4); }
    }
    return out;
  });
}

/** `✅ **Accepted**` → 'accepted'; unknown text is returned lowercased for the message. */
export function normalizeStatus(raw) {
  const word = String(raw || '').replace(/[*_`]/g, '').replace(/[^\p{L}\s-]/gu, ' ').trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!word) return null;
  return SYNONYM[word] || word;
}

const num = s => Number.parseInt(String(s).replace(/^0+(?=\d)/, ''), 10);
// "Partially superseded by" keeps the older decision in force for the rest,
// so it is not a supersession link.
// Only a structured link counts: one that opens its line (after a bullet,
// quote or bold marker) or a status line. Prose such as "this supersedes the
// ADR-NNN posture" is discussion, not a record of supersession.
const LINK_LEAD = String.raw`(?:^|\n)\s*(?:[-*>]\s*)?(?:\*\*)?(?:status(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(?:\w+\s*[,;—–-]\s*)?)?`;
const linksIn = text => ({
  supersedes: [...text.matchAll(new RegExp(`${LINK_LEAD}supersedes(?:\\*\\*)?[:\\s[]*(?:ADR[-\\s]?)?(\\d{1,5})`, 'gi'))].map(m => num(m[1])),
  supersededBy: [...text.matchAll(new RegExp(`${LINK_LEAD}superseded[_\\s-]by(?:\\*\\*)?[:\\s[]*(?:ADR[-\\s]?)?(\\d{1,5})`, 'gi'))].map(m => num(m[1])),
});

function statusIn(lines, start, end) {
  for (let i = start; i < end; i++) {
    // `**Status**: x`, `**Status:** x`, `Status: x`, `- Status: x`, `| Status | x |`
    const m = lines[i].match(/^\s*(?:[-*>]\s*)?(?:\*\*)?status(?:\*\*)?\s*:(?:\*\*)?\s*(.+)$/i)
      || lines[i].match(/^\s*\|\s*(?:\*\*)?status(?:\*\*)?\s*\|\s*([^|]+)\|/i);
    if (m) return { status: normalizeStatus(m[1]), raw: m[1].trim(), line: i + 1 };
    if (/^#{2,4}\s+status\b[^:]*$/i.test(lines[i])) {
      for (let j = i + 1; j < end; j++) if (lines[j].trim()) return { status: normalizeStatus(lines[j]), raw: lines[j].trim(), line: j + 1 };
    }
  }
  return { status: null, raw: null, line: start + 1 };
}

/** Every ADR record and index row in one file. */
export function parseAdrFile(text, rel) {
  const lines = prose(text);
  const records = [];
  const index = [];
  const heads = [];
  lines.forEach((line, i) => { const m = line.match(/^#{2,3}\s+ADR[-\s]?(\d{1,5})\b\s*[:—–-]?\s*(.*)$/i); if (m) heads.push({ n: num(m[1]), title: m[2].trim(), i }); });
  if (heads.length) {
    heads.forEach((h, k) => {
      let end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
      for (let j = h.i + 1; j < end; j++) if (/^##\s/.test(lines[j]) && !/^##\s+ADR/i.test(lines[j])) { end = j; break; }
      const body = lines.slice(h.i, end).join('\n');
      // A scaffold placeholder (`## ADR-NNN: <!-- Title -->` and nothing but
      // comments) is not a decision yet.
      if (!h.title && !lines.slice(h.i + 1, end).some(l => l.trim() && !/^[-|:\s]+$/.test(l))) return;
      records.push({ n: h.n, title: h.title, ...statusIn(lines, h.i + 1, end), ...linksIn(body), file: rel, at: h.i + 1 });
    });
  } else {
    const name = basename(rel);
    // One file per decision only in an ADR home or an adr-NNN name: a dated or
    // numbered decision LOG elsewhere is not a single ADR.
    const fromName = (ADR_HOME_RE.test(rel) && name.match(/^(\d{1,5})[-_.]/)) || name.match(/^adr[-_ ]?(\d{1,5})\b/i);
    if (fromName) {
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      const fmStatus = fm?.[1].match(/^status:\s*(.+)$/im);
      const st = fmStatus ? { status: normalizeStatus(fmStatus[1]), raw: fmStatus[1].trim(), line: text.slice(0, fm.index + fm[0].indexOf(fmStatus[0])).split('\n').length } : statusIn(lines, 0, lines.length);
      const fmLinks = fm ? linksIn(fm[1].replace(/superseded_by/g, 'superseded by')) : { supersedes: [], supersededBy: [] };
      const body = linksIn(lines.join('\n'));
      records.push({ n: num(fromName[1]), title: (text.match(/^#\s+(.+)$/m) || [])[1] || name, ...st, supersedes: [...new Set([...fmLinks.supersedes, ...body.supersedes])], supersededBy: [...new Set([...fmLinks.supersededBy, ...body.supersededBy])], file: rel, at: 1 });
    }
  }
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const id = cells[0]?.match(/^ADR[-\s]?(\d{1,5})$/i);
    if (!id) return;
    const statusCell = cells.slice(1).map(normalizeStatus).find(s => s && STATUS.has(s));
    if (statusCell) index.push({ n: num(id[1]), status: statusCell, file: rel, line: i + 1 });
  });
  return { records, index };
}

function adrFiles(projectDir, config) {
  const files = new Set();
  try { for (const f of readdirSync(projectDir)) if (/\.md$/i.test(f) && /adr|decision/i.test(f)) files.add(resolve(projectDir, f)); } catch { /* unreadable root */ }
  for (const d of resolveDocDirs(projectDir, config)) {
    const abs = resolve(projectDir, d);
    if (!existsSync(abs)) continue;
    walkFiles(abs, full => {
      const rel = relative(projectDir, full).replace(/\\/g, '/');
      if (/\.md$/i.test(full) && (/adr|decision/i.test(basename(full)) || ADR_HOME_RE.test(rel))) files.add(full);
    });
  }
  return [...files].sort();
}

/** Unanswered questions in Spec Kit clarifications and `*questions.md` files. */
function unansweredQuestions(projectDir) {
  const out = [];
  const specs = resolve(projectDir, 'specs');
  if (existsSync(specs)) {
    let dirs = [];
    try { dirs = readdirSync(specs, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { /* none */ }
    for (const d of dirs) {
      const p = resolve(specs, d, 'spec.md');
      if (!existsSync(p)) continue;
      let text;
      try { text = readFileSync(p, 'utf-8'); } catch { continue; }
      if (!/^##\s+Clarifications/m.test(text)) continue;
      if (TERMINAL_STATUS_RE.test((text.slice(0, 2000).match(/\*\*Status\*\*:\s*(.+)/) || [])[1] || '')) continue;
      const lines = prose(text);
      let inClar = false;
      lines.forEach((line, i) => {
        if (/^##\s/.test(line)) inClar = /^##\s+Clarifications/i.test(line);
        if (!inClar) return;
        const q = line.match(/^\s*[-*]\s*Q:\s*(.*)$/);
        if (!q) return;
        // A wrapped question continues on indented, non-bullet lines.
        let full = q[1];
        for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*[-*]\s/.test(lines[j]); j++) full += ` ${lines[j].trim()}`;
        const a = full.match(/(?:→|->)\s*A(?:\s*\([^)]*\))?\s*:\s*(.*)$/);
        if (!a || !a[1].trim()) out.push({ file: `specs/${d}/spec.md`, line: i + 1, text: full.replace(/(?:→|->)\s*A\b.*$/, '').trim() });
      });
    }
  }
  for (const root of ['aidlc', 'aidlc-docs', 'docs', 'specs']) {
    const abs = resolve(projectDir, root);
    if (!existsSync(abs)) continue;
    walkFiles(abs, full => {
      if (!/questions\.md$/i.test(full)) return;
      let text;
      try { text = readFileSync(full, 'utf-8'); } catch { return; }
      const lines = prose(text);
      lines.forEach((line, i) => {
        const m = line.match(/\[Answer\]:\s*(.*)$/i);
        if (!m || m[1].trim()) return;
        const next = lines.slice(i + 1).find(l => l.trim());
        if (next && !/^\s*(?:#|[-*]\s*\[|\[Answer\]|\d+\.)/i.test(next)) return;
        out.push({ file: relative(projectDir, full).replace(/\\/g, '/'), line: i + 1, text: (lines.slice(0, i).reverse().find(l => l.trim()) || '').trim() });
      });
    });
  }
  return out;
}

function gather(projectDir, config) {
  const records = [];
  const index = [];
  for (const full of adrFiles(projectDir, config)) {
    let text;
    try { text = readFileSync(full, 'utf-8'); } catch { continue; }
    const parsed = parseAdrFile(text, relative(projectDir, full).replace(/\\/g, '/'));
    records.push(...parsed.records);
    index.push(...parsed.index);
  }
  return { records, index, questions: unansweredQuestions(projectDir) };
}

const describeSubject = ({ records, index, questions }) => `${records.length} decision record(s), ${index.length} index row(s) and ${questions.length} unanswered question(s)`;

/**
 * Does this kind of check belong to the project? It does when the project keeps
 * decision records (an ADR file, an adr/ or decisions/ directory, an index of
 * them) or asks questions that await an answer (a Spec Kit clarification).
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}, found = gather(projectDir, config)) {
  if (found.records.length === 0 && found.index.length === 0 && found.questions.length === 0) {
    return { applies: false, evidence: 'no ADR file, no adr/, adrs/ or decisions/ directory, no ADR index and no unanswered question in specs/*/spec.md or *questions.md' };
  }
  return { applies: true, evidence: describeSubject(found) };
}

export function validateDecisionRecords(projectDir, config = {}) {
  const found = gather(projectDir, config);
  const { records, index, questions } = found;
  if (records.length === 0 && index.length === 0 && questions.length === 0) {
    return {
      ...resultFromFindings([], { passed: 0, total: 0, applicable: false }),
      ...contractFields({
        performed: 0,
        decide: () => applies(projectDir, config, found),
        empty: d => ({ emptyCause: 'nothing-of-this-kind', note: `Decision-Records found no decision to judge: ${d.evidence}.`, howToConfigure: 'Nothing to configure unless the project records decisions: Decision-Records reads `## ADR-NNN` sections in one file, or one file per decision under adr/, adrs/ or decisions/ (`docguard init` writes templates/ADR.md).' }),
      }),
    };
  }
  const findings = [];
  const add = (code, message, location, suggestion, extra = {}) => findings.push(mkFinding({
    code, validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'act', message, location, suggestion: { kind: 'fix', text: suggestion }, ...extra,
  }));
  const byN = new Map();
  for (const r of records) if (!byN.has(r.n)) byN.set(r.n, r);
  const id = n => `ADR-${String(n).padStart(3, '0')}`;

  for (const r of records) {
    const where = `${r.file}:${r.line}`;
    if (!r.status) add('DEC001', `${id(r.n)} (${r.file}:${r.at}) has no status`, `${r.file}:${r.at}`, 'Add `**Status**: proposed | accepted | rejected | deprecated | superseded`');
    else if (!STATUS.has(r.status)) add('DEC001', `${id(r.n)} status "${r.raw.replace(/[*_]/g, '').slice(0, 60)}" is not proposed, accepted, rejected, deprecated or superseded`, where, 'Use one of the five ADR statuses');
    for (const target of [...r.supersedes, ...r.supersededBy]) {
      if (!byN.has(target)) add('DEC002', `${id(r.n)} links to ${id(target)}, which no decision record defines`, `${r.file}:${r.at}`, `Fix the number, or write ${id(target)}`);
    }
    for (const old of r.supersedes) {
      const o = byN.get(old);
      if (o && !o.supersededBy.includes(r.n) && o.status !== 'superseded') add('DEC003', `${id(r.n)} supersedes ${id(old)}, but ${id(old)} still reads ${o.status || 'no status'} and does not name its successor`, `${o.file}:${o.at}`, `Set ${id(old)} to superseded and add "Superseded by ${id(r.n)}"`, { disposition: 'act' });
    }
    for (const next of r.supersededBy) {
      const n = byN.get(next);
      if (n && !n.supersedes.includes(r.n)) add('DEC003', `${id(r.n)} says it is superseded by ${id(next)}, but ${id(next)} does not say it supersedes ${id(r.n)}`, `${n.file}:${n.at}`, `Add "Supersedes ${id(r.n)}" to ${id(next)}`);
    }
    const supersededSomehow = r.supersededBy.length > 0 || records.some(x => x.supersedes.includes(r.n));
    if (r.status === 'superseded' && !supersededSomehow) add('DEC004', `${id(r.n)} is superseded but names no successor`, where, 'Add "Superseded by ADR-NNN", or correct the status');
    if (r.supersededBy.length > 0 && r.status && r.status !== 'superseded' && STATUS.has(r.status)) add('DEC004', `${id(r.n)} names a successor but its status is ${r.status}`, where, 'Set the status to superseded');
  }
  for (const row of index) {
    const r = byN.get(row.n);
    if (!r) { if (records.length) add('DEC002', `The index lists ${id(row.n)}, which no decision record defines`, `${row.file}:${row.line}`, `Write ${id(row.n)} or remove the index row`); continue; }
    if (r.status && STATUS.has(r.status) && r.status !== row.status) add('DEC005', `The index says ${id(row.n)} is ${row.status}; its record says ${r.status}`, `${row.file}:${row.line}`, 'Make the index row match the record');
  }
  for (const q of questions) add('DEC006', `${q.file}:${q.line} — question has no answer: ${q.text.slice(0, 120)}`, `${q.file}:${q.line}`, 'Answer it (and update the artifacts written on a guess), or remove the question', { disposition: 'escalate' });

  const total = records.length + index.length + questions.length;
  return {
    ...resultFromFindings(findings, { passed: Math.max(0, total - findings.length), total, applicable: true }),
    ...contractFields({ performed: total, found: findings.length > 0, ran: `${describeSubject(found)} judged`, decide: () => applies(projectDir, config, found), empty: () => ({ note: '', howToConfigure: '' }) }),
  };
}
