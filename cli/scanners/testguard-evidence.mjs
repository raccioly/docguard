/**
 * Saved-report adapter for TestGuard evidence: which tests re-verified a
 * requirement whose anchored code changed.
 *
 * Spec: specs/070-requirement-anchors (user story 6,
 * contracts/testguard-evidence.md).
 *
 * It reads two files, the evidence and the claims file, through the evidence
 * reader (no symlinks, no path outside the project, bounded size). It runs
 * no test, no probe and no TestGuard. Git is asked only whether the evidence
 * revision exists, after the revision is checked to be a commit id, so a
 * crafted report cannot pass an option to git. It lives with the scanners,
 * not in cli/evidence/, because that layer never runs an external tool.
 *
 * A claim speaks for requirement R only through the structured reference
 * TestGuard validates, `source: { kind: "spec", ref: "req:<spec-id>#<req>" }`.
 * Freshness follows TestGuard's own status rules: the claim's metadata and
 * fault set must equal the claims file, and every recorded target and
 * defender hash must equal the file today.
 *
 * Dependency-closure and external-claims fields come from a TestGuard
 * evidence schema that is not yet released. They are read tolerantly: evidence
 * without them keeps its verdicts, and a re-verified answer that rested on
 * something not checked says so in `notChecked`.
 *
 * @implements docguard.requirement-anchors#FR-033
 * @implements docguard.requirement-anchors#FR-045
 * @implements docguard.requirement-anchors#FR-046
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEvidenceReader } from './semantic-claims.mjs';
import { revisionResolves } from './doc-deps.mjs';

export const TESTGUARD_EVIDENCE_DEFAULT = '.testguard/evidence.json';
export const TESTGUARD_CLAIMS_DEFAULT = 'testguard.claims.json';
const MAX_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 50_000;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_DEPENDENCIES = 20_000;
const CLOSURE_VALUES = new Set(['complete', 'indeterminate']);
const ISSUE_CODES = new Set(['computed-specifier', 'unreadable-module', 'unsupported-syntax', 'graph-limit']);
const MAX_PRINTED_FILE = 120;

/** The structured form TestGuard's `requirementRef()` accepts (its `$defs/claimSource`). */
export const REQUIREMENT_REF = /^req:([A-Za-z0-9][A-Za-z0-9._-]{0,127})#([A-Za-z][A-Za-z0-9._-]{0,63})$/u;

/** `specId#requirementId` for a structured `spec` reference, else null. */
export function structuredRequirement(source) {
  if (!source || typeof source !== 'object' || source.kind !== 'spec' || typeof source.ref !== 'string') return null;
  const m = REQUIREMENT_REF.exec(source.ref);
  return m ? `${m[1]}#${m[2]}` : null;
}

const answer = (status, reason, message, extra = {}) => ({ status, reason, message, ...extra });

function unsafePath(path) {
  return typeof path !== 'string' || !path || path.startsWith('/') || /[\\:\0]/.test(path)
    || path.split('/').some(part => part === '..');
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = v => Array.isArray(v) && v.every(x => typeof x === 'string');

/** The fields this adapter reads, checked against TestGuard's evidence schema. */
function evidenceShapeError(doc) {
  if (!isObject(doc) || doc.schemaVersion !== 1) return 'schemaVersion is not 1';
  if (!isObject(doc.run) || !isObject(doc.run.repo)) return 'run.repo is missing';
  if (!COMMIT.test(String(doc.run.repo.head))) return 'run.repo.head is not a commit id';
  if (doc.run.repo.snapshot !== undefined && !COMMIT.test(String(doc.run.repo.snapshot))) return 'run.repo.snapshot is not a commit id';
  const source = doc.run.claimsSource;
  if (source !== undefined && (!isObject(source) || typeof source.external !== 'boolean' || (source.external && !SHA256.test(String(source.sha256))))) {
    return 'run.claimsSource is not { external, sha256 }';
  }
  if (!Array.isArray(doc.records) || doc.records.length > MAX_RECORDS) return 'records is not a bounded array';
  for (const [i, r] of doc.records.entries()) {
    if (!isObject(r) || !isObject(r.claim) || typeof r.claim.id !== 'string' || !isObject(r.claim.source)
      || !isObject(r.subject) || typeof r.subject.id !== 'string' || typeof r.verdict !== 'string') {
      return `records[${i}] lacks claim, subject or verdict`;
    }
  }
  return null;
}

/** Key order never matters; absent and present-but-different do. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const metadata = ({ id, statement, severity, source, producedBy }) => canonical({ id, statement, severity, source, producedBy });

/**
 * Read the saved evidence once per run.
 * @returns {{ status: 'absent'|'ok'|'inconclusive', reason?: string, message?: string, path: string,
 *   revision?: string, claims?: Map<string, {claim: object, records: object[]}>, current?: Map<string, object>|null,
 *   claimsError?: string, hashOf?: (path: string) => string|null }}
 */
export function loadTestguardEvidence(projectDir, config = {}) {
  const evidencePath = config.anchors?.testguard?.evidence ?? TESTGUARD_EVIDENCE_DEFAULT;
  const claimsPath = config.anchors?.testguard?.claims ?? TESTGUARD_CLAIMS_DEFAULT;
  if (unsafePath(evidencePath)) return answer('inconclusive', 'evidence-unreadable', `the TestGuard evidence path ${JSON.stringify(evidencePath)} is not a project-relative path`, { path: String(evidencePath) });
  if (!existsSync(resolve(projectDir, evidencePath))) return answer('absent', 'no-evidence', `no TestGuard evidence at ${evidencePath}`, { path: evidencePath });
  const read = createEvidenceReader(projectDir, { maxFileBytes: MAX_REPORT_BYTES });
  const snapshot = read(evidencePath);
  if (snapshot.content === null) return answer('inconclusive', 'evidence-unreadable', `${evidencePath} cannot be read safely (${snapshot.evidence.reason})`, { path: evidencePath });
  let doc;
  try { doc = JSON.parse(snapshot.content); } catch { return answer('inconclusive', 'evidence-invalid', `${evidencePath} is not valid JSON`, { path: evidencePath }); }
  const shape = evidenceShapeError(doc);
  if (shape) return answer('inconclusive', 'evidence-invalid', `${evidencePath} is not TestGuard evidence: ${shape}`, { path: evidencePath });
  if (doc.run.provisional === true || !(Number.isInteger(doc.run.confirmRuns) && doc.run.confirmRuns >= 3)) {
    return answer('inconclusive', 'evidence-provisional', `${evidencePath} is provisional (fewer than three confirmation runs); nothing in it is confirmed`, { path: evidencePath });
  }
  if ((doc.run.method ?? 'fault-injection') !== 'fault-injection') {
    return answer('inconclusive', 'evidence-method', `${evidencePath} was produced by method ${doc.run.method}, not fault injection`, { path: evidencePath });
  }
  // A working-tree probe records the dangling commit that captured the tree.
  const revision = doc.run.repo.snapshot ?? doc.run.repo.head;
  if (!revisionResolves(projectDir, revision)) {
    return answer('inconclusive', 'head-unresolvable', `the evidence revision ${revision.slice(0, 12)} does not exist in this repository (a garbage-collected snapshot, or another clone)`, { path: evidencePath });
  }
  const claims = new Map();
  for (const record of doc.records) {
    if (!claims.has(record.claim.id)) claims.set(record.claim.id, { claim: record.claim, records: [] });
    claims.get(record.claim.id).records.push(record);
  }
  let current = null;
  let claimsError = null;
  // Claims supplied from outside the repository: the default file is not the
  // file that was probed, so it is never read unless the project named one.
  const claimsExternal = doc.run.claimsSource?.external === true && config.anchors?.testguard?.claims === undefined;
  if (claimsExternal) { /* read each claim from the evidence alone */ }
  else if (unsafePath(claimsPath)) claimsError = `the TestGuard claims path ${JSON.stringify(claimsPath)} is not a project-relative path`;
  else {
    const c = read(claimsPath);
    if (c.content === null) claimsError = `${claimsPath} cannot be read safely (${c.evidence.reason})`;
    else {
      try {
        const parsed = JSON.parse(c.content);
        if (!Array.isArray(parsed?.claims)) throw new Error('shape');
        current = new Map(parsed.claims.filter(isObject).map(claim => [claim.id, claim]));
      } catch { claimsError = `${claimsPath} is not a TestGuard claims file`; }
    }
  }
  // A closure shared by many records is hashed once.
  const hashes = new Map();
  const hashOf = path => {
    if (hashes.has(path)) return hashes.get(path);
    let hash = null;
    if (!unsafePath(path)) {
      const s = read(path);
      hash = s.content === null ? null : s.evidence.hash.replace(/^sha256:/, '');
    }
    hashes.set(path, hash);
    return hash;
  };
  return { status: 'ok', path: evidencePath, claimsPath, revision, claims, current, claimsError, claimsExternal, hashOf };
}

/** Untrusted text from the evidence, printable and bounded, before it reaches a message. */
const bounded = text => {
  const clean = String(text).replace(/[^\x20-\x7e]/g, '?');
  return clean.length > MAX_PRINTED_FILE ? `${clean.slice(0, MAX_PRINTED_FILE)}…` : clean;
};

/** Whether a record's dependency fields are well formed: both or neither, with safe paths and sha256 values. */
function dependencyShapeOk(inputs) {
  const hasHashes = inputs.dependencyHashes !== undefined;
  const hasClosure = inputs.dependencyClosure !== undefined;
  if (hasHashes !== hasClosure) return false;
  if (!hasHashes) return true;
  if (!CLOSURE_VALUES.has(inputs.dependencyClosure) || !isObject(inputs.dependencyHashes)) return false;
  const entries = Object.entries(inputs.dependencyHashes);
  return entries.length <= MAX_DEPENDENCIES && entries.every(([file, hash]) => !unsafePath(file) && SHA256.test(String(hash)));
}

/** The first well-formed issue of an indeterminate closure, as text safe to print. */
function firstIssue(inputs) {
  const issue = Array.isArray(inputs.dependencyIssues) ? inputs.dependencyIssues.find(i => isObject(i) && ISSUE_CODES.has(i.code) && typeof i.file === 'string') : null;
  return issue ? ` (${issue.code} in ${bounded(issue.file)})` : '';
}

/**
 * Why a claim's saved records no longer describe the project, or null when
 * they do. `gaps` collects the checks that were not made.
 */
function staleness(evidence, entry, gaps) {
  const recorded = entry.claim;
  if (evidence.current) {
    const now = evidence.current.get(recorded.id);
    if (!now) return answer('inconclusive', 'claim-changed', `claim ${recorded.id} is no longer in ${evidence.claimsPath}`);
    if (metadata(now) !== metadata(recorded)) return answer('inconclusive', 'claim-changed', `claim ${recorded.id} changed in ${evidence.claimsPath} since it was probed`);
    const probed = new Set(entry.records.map(r => r.subject.id));
    const faults = Array.isArray(now.faults) ? now.faults.map(f => f?.id) : [];
    const unprobed = faults.filter(id => !probed.has(id));
    if (unprobed.length) return answer('inconclusive', 'fault-unprobed', `${recorded.id}/${unprobed.join(', ')} has no record in ${evidence.path}`);
    const gone = [...probed].filter(id => !faults.includes(id));
    if (gone.length) return answer('inconclusive', 'claim-changed', `${recorded.id}/${gone.join(', ')} was probed but is no longer in ${evidence.claimsPath}`);
  } else {
    gaps.add('claim-changed');
    gaps.add('fault-unprobed');
  }
  for (const r of entry.records) {
    const inputs = r.inputs;
    if (!isObject(inputs) || !SHA256.test(String(inputs.targetHash)) || !isObject(inputs.defenderHashes) || typeof r.subject.file !== 'string') {
      return answer('inconclusive', 'inputs-stale', `${recorded.id}/${r.subject.id} records no input hashes, so its freshness cannot be checked`);
    }
    if (evidence.hashOf(r.subject.file) !== inputs.targetHash) return answer('inconclusive', 'inputs-stale', `${r.subject.file} changed since ${recorded.id}/${r.subject.id} was probed`);
    for (const [file, hash] of Object.entries(inputs.defenderHashes)) {
      if (evidence.hashOf(file) !== hash) return answer('inconclusive', 'inputs-stale', `${file} changed since ${recorded.id}/${r.subject.id} was probed`);
    }
    if (!dependencyShapeOk(inputs)) return answer('inconclusive', 'inputs-stale', `${recorded.id}/${r.subject.id} has malformed dependency hashes, so its freshness cannot be checked`);
    if (inputs.dependencyClosure === undefined) { gaps.add('dependency-closure'); continue; }
    if (inputs.dependencyClosure === 'indeterminate') {
      return answer('inconclusive', 'closure-indeterminate', `${recorded.id}/${r.subject.id}: freshness cannot be established because TestGuard could not resolve the import closure${firstIssue(inputs)}`);
    }
    for (const file of Object.keys(inputs.dependencyHashes).sort()) {
      if (evidence.hashOf(file) !== inputs.dependencyHashes[file]) return answer('inconclusive', 'inputs-stale', `${file} changed since ${recorded.id}/${r.subject.id} was probed`);
    }
  }
  return null;
}

/**
 * The status of one test reference to requirement `requirement`, whose
 * anchored code is `atRevision` at the evidence revision (`unchanged`,
 * `changed`, or `missing`).
 */
export function testStatus(evidence, { requirement, testFile, atRevision, hint }) {
  if (evidence.status === 'absent') return answer('needs-reverification', 'no-evidence', `${evidence.message}; run the test, or probe its claim with TestGuard`);
  if (evidence.status !== 'ok') return answer('inconclusive', evidence.reason, evidence.message);
  const naming = [...evidence.claims.values()].filter(e => structuredRequirement(e.claim.source) === requirement);
  const short = evidence.revision.slice(0, 12);
  if (!naming.length) return answer('needs-reverification', 'no-structured-claim', `no TestGuard claim in ${evidence.path} names ${requirement} as source.ref "req:${requirement}"${hint ? `; ${hint}` : ''}`);
  if (evidence.claimsError) return answer('inconclusive', 'claims-unreadable', evidence.claimsError);
  if (atRevision !== 'unchanged') {
    return answer('needs-reverification', 'evidence-predates-change', `the evidence at ${short} ${atRevision === 'missing' ? 'predates the anchored code' : 'predates the change to the anchored code'}; probe again`);
  }
  const defending = naming.filter(e => e.records.some(r => strings(r.defenders?.resolved) && r.defenders.resolved.includes(testFile)));
  if (!defending.length) return answer('needs-reverification', 'not-a-defender', `not among the defenders TestGuard recorded for ${naming.map(e => e.claim.id).join(', ')}`);
  const gaps = new Set();
  for (const entry of defending) {
    const stale = staleness(evidence, entry, gaps);
    if (stale) return stale;
  }
  const notKilled = defending.flatMap(e => e.records.filter(r => r.verdict !== 'killed').map(r => `${e.claim.id}/${r.subject.id} ${r.verdict}`));
  if (notKilled.length) return answer('needs-reverification', 'fault-not-killed', `TestGuard did not prove the claim: ${notKilled.join(', ')}`);
  const ids = defending.map(e => e.claim.id);
  const base = { evidenceHead: evidence.revision, claims: ids };
  if (!gaps.size) return answer('re-verified', 'evidence-current', `re-verified at ${short} by ${ids.join(', ')}`, base);
  const notChecked = [...gaps].sort();
  const why = [];
  if (gaps.has('claim-changed')) why.push('the claims came from outside the repository, so they were not compared with a claims file');
  if (gaps.has('dependency-closure')) why.push('the evidence records no import closure, so imported modules were not hashed');
  return answer('re-verified', gaps.has('claim-changed') ? 'claims-not-compared' : 'evidence-current',
    `re-verified at ${short} by ${ids.join(', ')}; not checked: ${notChecked.join(', ')} (${why.join('; ')})`, { ...base, notChecked });
}

/**
 * For a requirement no structured claim names: the claims whose opaque
 * reference resolves to it, and the structured form to write instead.
 */
export function structuredHint(evidence, requirement, resolveRef, hasSpecId) {
  if (evidence.status !== 'ok') return null;
  if (!hasSpecId) return `${requirement} has no Spec ID, so no structured reference can name it`;
  const matches = [...evidence.claims.values()]
    .filter(e => typeof e.claim.source.ref === 'string' && !e.claim.source.ref.startsWith('req:') && resolveRef(e.claim.source.ref) === requirement)
    .map(e => `${e.claim.id} names ${e.claim.source.ref}`);
  const base = `write source as { "kind": "spec", "ref": "req:${requirement}" }`;
  return matches.length ? `${matches.slice(0, 3).join('; ')}: ${base}` : base;
}
