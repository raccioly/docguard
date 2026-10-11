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
 * @implements docguard.requirement-anchors#FR-033
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
  if (unsafePath(claimsPath)) claimsError = `the TestGuard claims path ${JSON.stringify(claimsPath)} is not a project-relative path`;
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
  const hashOf = path => {
    if (unsafePath(path)) return null;
    const s = read(path);
    return s.content === null ? null : s.evidence.hash.replace(/^sha256:/, '');
  };
  return { status: 'ok', path: evidencePath, claimsPath, revision, claims, current, claimsError, hashOf };
}

/** Why a claim's saved records no longer describe the project, or null when they do. */
function staleness(evidence, entry) {
  const recorded = entry.claim;
  const now = evidence.current.get(recorded.id);
  if (!now) return answer('inconclusive', 'claim-changed', `claim ${recorded.id} is no longer in ${evidence.claimsPath}`);
  if (metadata(now) !== metadata(recorded)) return answer('inconclusive', 'claim-changed', `claim ${recorded.id} changed in ${evidence.claimsPath} since it was probed`);
  const probed = new Set(entry.records.map(r => r.subject.id));
  const faults = Array.isArray(now.faults) ? now.faults.map(f => f?.id) : [];
  const unprobed = faults.filter(id => !probed.has(id));
  if (unprobed.length) return answer('inconclusive', 'fault-unprobed', `${recorded.id}/${unprobed.join(', ')} has no record in ${evidence.path}`);
  const gone = [...probed].filter(id => !faults.includes(id));
  if (gone.length) return answer('inconclusive', 'claim-changed', `${recorded.id}/${gone.join(', ')} was probed but is no longer in ${evidence.claimsPath}`);
  for (const r of entry.records) {
    const inputs = r.inputs;
    if (!isObject(inputs) || !SHA256.test(String(inputs.targetHash)) || !isObject(inputs.defenderHashes) || typeof r.subject.file !== 'string') {
      return answer('inconclusive', 'inputs-stale', `${recorded.id}/${r.subject.id} records no input hashes, so its freshness cannot be checked`);
    }
    if (evidence.hashOf(r.subject.file) !== inputs.targetHash) return answer('inconclusive', 'inputs-stale', `${r.subject.file} changed since ${recorded.id}/${r.subject.id} was probed`);
    for (const [file, hash] of Object.entries(inputs.defenderHashes)) {
      if (evidence.hashOf(file) !== hash) return answer('inconclusive', 'inputs-stale', `${file} changed since ${recorded.id}/${r.subject.id} was probed`);
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
  for (const entry of defending) {
    const stale = staleness(evidence, entry);
    if (stale) return stale;
  }
  const notKilled = defending.flatMap(e => e.records.filter(r => r.verdict !== 'killed').map(r => `${e.claim.id}/${r.subject.id} ${r.verdict}`));
  if (notKilled.length) return answer('needs-reverification', 'fault-not-killed', `TestGuard did not prove the claim: ${notKilled.join(', ')}`);
  const ids = defending.map(e => e.claim.id);
  return answer('re-verified', 'evidence-current', `re-verified at ${short} by ${ids.join(', ')}`, { evidenceHead: evidence.revision, claims: ids });
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
