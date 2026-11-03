/**
 * AI-DLC validator (specs/089-aidlc-profile): what AI-DLC verified at its
 * gates stays true after the workflow ends.
 *
 *   AID001  a traceability `OK`/`Deferred` target path no longer exists
 *   AID002  a `GAP`/`ORPHAN` row left in a stage marked completed
 *   AID003  a path a unit's source-manifest claims no longer exists
 *   AID004  a table or manifest that cannot be read, or a path escaping the project
 *   MEM001  a learned rule (memory/{org,team,project}.md, phases/*.md) names a path or env var that is gone
 *   MEM002  a CodeKB file names a path that is gone (docguard.memory-governance)
 *
 * Advisory by default (docguard.enforcement-ladder). Never writes AI-DLC files.
 *
 * @implements docguard.aidlc-profile#FR-002
 * @implements docguard.aidlc-profile#FR-003
 * @implements docguard.aidlc-profile#FR-004
 * @implements docguard.aidlc-profile#FR-005
 * @implements docguard.aidlc-profile#FR-006
 * @implements docguard.aidlc-profile#FR-007
 */
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ENV_TOKEN, backtickRefs, codekbFiles, findAidlcRecords, findAidlcSpaces, isPathTarget, memoryLayerFiles, pathExists, readAidlcRecord, safeWorkspacePath } from '../scanners/aidlc.mjs';
import { walkFiles } from '../shared-ignore.mjs';
import { lastCommitHash, runGit } from '../shared-git.mjs';

const VALIDATOR = 'aidlc';
const CAP = 10;

/** Env var names some code or env example mentions, out of `candidates`. One walk. */
function envNamesInUse(projectDir, candidates) {
  const found = new Set();
  if (candidates.size === 0) return found;
  walkFiles(projectDir, full => {
    if (found.size === candidates.size) return;
    if (!/\.(?:m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|ya?ml|toml|tf|sh)$|(?:^|[\\/])\.env[^\\/]*$/.test(full)) return;
    let text;
    try { text = readFileSync(full, 'utf-8'); } catch { return; }
    for (const name of candidates) if (!found.has(name) && text.includes(name)) found.add(name);
  }, { keepDot: entry => entry.startsWith('.env') });
  return found;
}

export function validateAidlc(projectDir) {
  const records = findAidlcRecords(projectDir).map(r => readAidlcRecord(projectDir, r));
  const tables = records.reduce((n, r) => n + r.tables.length, 0);
  const manifests = records.reduce((n, r) => n + r.manifests.length, 0);
  const spaces = findAidlcSpaces(projectDir);
  if (records.length === 0 && spaces.length === 0) return resultFromFindings([], { passed: 0, total: 0, applicable: false });

  const findings = [];
  const counts = { AID001: 0, AID002: 0, AID003: 0, AID004: 0, MEM001: 0, MEM002: 0 };
  const elided = { AID001: 0, AID002: 0, AID003: 0, AID004: 0, MEM001: 0, MEM002: 0 };
  let total = 0;
  let unknownDeletions = 0;
  const push = (code, make) => { if (counts[code] >= CAP) { elided[code]++; return; } counts[code]++; findings.push(mkFinding({ code, validator: VALIDATOR, severity: 'warn', confidence: 'high', ...make() })); };
  const unitOf = t => (t.unit ? ` (unit ${t.unit})` : '');

  for (const record of records) {
    for (const m of record.malformed) {
      total++;
      push('AID004', () => ({ disposition: 'act', message: `${m.file} cannot be read as AI-DLC ${m.file.endsWith('traceability.json') ? 'traceability' : 'source manifest'}: ${m.reason}`, location: m.file, suggestion: { kind: 'fix', text: 'Restore valid JSON in the shape AI-DLC writes, or regenerate the stage output' } }));
    }
    for (const t of record.tables) {
      const closed = record.stages.get(t.stage) === 'x';
      for (const row of t.coverage) {
        if (!row || typeof row !== 'object') continue;
        total++;
        const status = String(row.status || '').toUpperCase();
        if ((status === 'OK' || status === 'DEFERRED') && isPathTarget(row.target)) {
          const target = row.target.trim();
          const abs = safeWorkspacePath(projectDir, target.replace(/\/$/, ''));
          if (!abs) {
            push('AID004', () => ({ disposition: 'act', message: `${t.file}: ${row.id} targets ${target}, which escapes the project`, location: t.file, suggestion: { kind: 'fix', text: 'Use a workspace-relative path' } }));
          } else if (!pathExists(abs, target.endsWith('/'))) {
            push('AID001', () => ({ disposition: 'escalate', message: `${t.file}${unitOf(t)}: ${row.id} → ${target} was traced at the ${t.stage || 'stage'} gate, and ${target} no longer exists`, location: t.file, suggestion: { kind: 'review', text: `Point ${row.id} at the code that implements it now, or reopen the requirement if the code was removed` } }));
          }
        } else if ((status === 'GAP' || status === 'ORPHAN') && closed) {
          push('AID002', () => ({ disposition: 'escalate', message: `${t.file}${unitOf(t)}: ${row.id} is ${status} in ${t.stage}, a stage AI-DLC marks completed`, location: t.file, suggestion: { kind: 'review', text: status === 'GAP' ? `Build ${row.id}, or record it as Deferred/N/A with the reason` : `Remove ${row.id} from the table, or add the requirement upstream` } }));
        }
      }
    }
    for (const m of record.manifests) {
      for (const w of m.writes) {
        if (!w || typeof w.path !== 'string') continue;
        if (w.repo && record.layout === 'current') continue; // another repository of a multi-repo intent
        total++;
        const abs = safeWorkspacePath(projectDir, w.path.replace(/\/$/, ''));
        if (!abs) { push('AID004', () => ({ disposition: 'act', message: `${m.file}: ${w.path} escapes the project`, location: m.file, suggestion: { kind: 'fix', text: 'Use a workspace-relative path' } })); continue; }
        if (!pathExists(abs, w.path.endsWith('/'))) {
          // A manifest lists deleted paths too, with no marker. Only a path that
          // existed when the manifest was committed, and is gone now, was
          // removed after the unit; one absent then is the unit's own deletion.
          const rev = lastCommitHash(projectDir, m.file);
          if (!rev) { unknownDeletions++; continue; }
          const then = runGit(projectDir, ['cat-file', '-e', `${rev}:${w.path.replace(/\/$/, '')}`], { operation: 'git cat-file (AI-DLC manifest)', stdio: 'ignore' });
          if (then.error || then.signal) { unknownDeletions++; continue; }
          if (then.status !== 0) continue;
          push('AID003', () => ({ disposition: 'escalate', message: `${m.file}${unitOf(m)}: the unit claims ${w.path}, which no longer exists`, location: m.file, suggestion: { kind: 'review', text: 'Confirm the deliverable moved or was removed on purpose, and update the record' } }));
        }
      }
    }
  }
  // docguard.memory-governance#FR-001–FR-003: memory that names what is gone.
  const rel = f => relative(projectDir, f).replace(/\\/g, '/');
  const refsOf = (files, envToo) => files.flatMap(f => {
    let text;
    try { text = readFileSync(f, 'utf-8'); } catch { return []; }
    return backtickRefs(text)
      .filter(r => !/^[a-z]+:\/\//i.test(r.token))
      .filter(r => isPathTarget(r.token) || (envToo && ENV_TOKEN.test(r.token)))
      .map(r => ({ ...r, file: rel(f) }));
  });
  const ruleRefs = refsOf(spaces.flatMap(s => memoryLayerFiles(s.abs)), true);
  const codekbRefs = refsOf(spaces.flatMap(s => codekbFiles(s.abs)), false);
  const envInUse = envNamesInUse(projectDir, new Set(ruleRefs.filter(r => ENV_TOKEN.test(r.token)).map(r => r.token)));
  const gone = r => {
    if (ENV_TOKEN.test(r.token)) return !envInUse.has(r.token);
    const abs = safeWorkspacePath(projectDir, r.token.replace(/\/$/, ''));
    return abs ? !pathExists(abs, r.token.endsWith('/')) : false;
  };
  for (const r of ruleRefs) {
    total++;
    if (gone(r)) push('MEM001', () => ({ disposition: 'escalate', message: `${r.file}:${r.line} — a learned rule names \`${r.token}\`, which ${ENV_TOKEN.test(r.token) ? 'no code or env example uses' : 'no longer exists'}: ${r.text.slice(0, 120)}`, location: `${r.file}:${r.line}`, suggestion: { kind: 'review', text: 'Update or retire the rule through AI-DLC (DocGuard never edits memory layers)' } }));
  }
  for (const r of codekbRefs) {
    total++;
    if (gone(r)) push('MEM002', () => ({ disposition: 'escalate', message: `${r.file}:${r.line} — the CodeKB names \`${r.token}\`, which no longer exists`, location: `${r.file}:${r.line}`, suggestion: { kind: 'review', text: 'Rerun AI-DLC reverse engineering for this repository so the CodeKB matches the code' } }));
  }

  for (const code of Object.keys(elided)) {
    if (elided[code]) findings.push(mkFinding({ code, validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'escalate', message: `${elided[code]} more ${code} finding(s) elided after the first ${CAP}`, location: 'aidlc', suggestion: { kind: 'review', text: 'Run guard --format json and filter by code to list them all' } }));
  }
  const result = resultFromFindings(findings, { passed: Math.max(0, total - findings.length), total, applicable: true });
  result.aidlc = { records: records.length, units: new Set(records.flatMap(r => [...r.tables, ...r.manifests].map(x => x.unit).filter(Boolean))).size, tables, manifests };
  if (unknownDeletions) result.applicability = { status: 'partial', reason: `${unknownDeletions} missing manifest path(s) not judged: the manifest is not committed, so git cannot tell a later removal from the unit's own deletion` };
  if (total === 0) result.note = `AI-DLC workspace found (${records.length} record(s)) with no traceability tables or source manifests yet`;
  return result;
}
