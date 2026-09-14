/**
 * Five-state evidence evaluation and stable identities.
 * @implements docguard.evidence-scoped-verification#FR-007
 * @implements docguard.evidence-scoped-verification#FR-008
 * @implements docguard.evidence-scoped-verification#FR-010
 * @implements docguard.evidence-scoped-verification#FR-011
 * @implements docguard.evidence-scoped-verification#FR-012
 */

import { createEvidenceReader, contentHash } from '../scanners/semantic-claims.mjs';
import { loadEvidenceManifest } from './manifest.mjs';
import { readEvidenceSource } from './adapters.mjs';
import { parseDocumentValue, selectMarkdownStatement } from './markdown.mjs';

export const EVIDENCE_SCOPE_LIMITATION = 'Verification applies only to the declared Markdown statement, source adapter, predicate, producer metadata, and captured local inputs. It does not establish whole-document, runtime, deployment, or compliance accuracy.';
export const EVIDENCE_STATES = ['verified-within-scope', 'contradicted', 'stale', 'inconclusive', 'unsupported'];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function identity(prefix, value) {
  return `${prefix}.${contentHash(JSON.stringify(canonical(value))).slice(7)}`;
}

function resultState(declaration, selection, source, state, reasonCode, message, extra = {}) {
  const selectedStatement = selection?.statement || declaration.target.statement;
  const claimId = identity('claim', {
    declaration,
    selectedStatement,
    sourceValue: source?.value,
    sourceEvidence: source?.sourceEvidence || null,
    inputHashes: source?.inputHashes || [],
  });
  const evidencePayload = {
    claimId,
    sourceEvidence: source?.sourceEvidence || null,
    inputHashes: source?.inputHashes || [],
    sourceValue: source?.value,
  };
  return {
    declarationId: declaration.id,
    state,
    claimId,
    evidenceId: identity('evidence', evidencePayload),
    document: declaration.target.document,
    location: selection?.line ? `${declaration.target.document}:${selection.line}` : declaration.target.document,
    heading: declaration.target.heading,
    statement: selectedStatement,
    adapter: declaration.source.adapter,
    predicate: declaration.predicate.kind,
    inputHashes: source?.inputHashes || [],
    evidenceHash: source?.sourceEvidence?.hash || identity('snapshot', evidencePayload),
    reasonCode,
    message,
    scopeLimitation: EVIDENCE_SCOPE_LIMITATION,
    ...extra,
  };
}

function compare(declaration, selection, source) {
  const predicate = declaration.predicate;
  if (predicate.kind === 'no-findings') {
    return source.value === 0
      ? { match: true, documentValue: null, sourceValue: 0 }
      : { match: false, documentValue: null, sourceValue: source.value };
  }
  const document = parseDocumentValue(selection.value, predicate);
  if (!document.ok) return { unsupported: false, inconclusive: true, ...document };
  if (predicate.kind === 'equals') {
    const expectedType = predicate.valueType;
    const actualType = source.value === null ? 'null' : typeof source.value;
    if (actualType !== expectedType || (actualType === 'number' && !Number.isFinite(source.value))) {
      return { unsupported: true, reasonCode: 'source-type-mismatch', message: `JSON source type ${actualType} does not match declared ${expectedType}.` };
    }
    return { match: Object.is(document.value, source.value), documentValue: document.value, sourceValue: source.value };
  }
  if (predicate.kind === 'set-equals') {
    if (!Array.isArray(source.value) || source.value.some(item => typeof item !== 'string')) {
      return { unsupported: true, reasonCode: 'source-set-shape', message: 'JSON source must be an array of strings for set-equals.' };
    }
    if (new Set(source.value).size !== source.value.length) {
      return { unsupported: true, reasonCode: 'duplicate-source-set-item', message: 'JSON source set contains duplicate items.' };
    }
    const left = [...document.value].sort();
    const right = [...source.value].sort();
    return { match: left.length === right.length && left.every((item, index) => item === right[index]), documentValue: document.value, sourceValue: source.value };
  }
  if (predicate.kind === 'count-equals') {
    if (!Number.isSafeInteger(source.value) || source.value < 0) {
      return { unsupported: true, reasonCode: 'source-count-shape', message: 'Collection source did not produce a non-negative safe integer.' };
    }
    return { match: document.value === source.value, documentValue: document.value, sourceValue: source.value };
  }
  return { unsupported: true, reasonCode: 'unsupported-predicate', message: `Predicate ${predicate.kind} is unsupported.` };
}

function evaluateDeclaration(projectDir, config, declaration, read) {
  const document = read(declaration.target.document);
  if (document.content === null) {
    return resultState(declaration, null, document, 'inconclusive', `document-${document.evidence.reason}`, `Cannot safely read ${declaration.target.document}.`);
  }
  const selection = selectMarkdownStatement(document.content, declaration.target, declaration.predicate.kind);
  if (selection.status !== 'ok') {
    return resultState(declaration, selection, document, 'inconclusive', selection.reasonCode, selection.message);
  }
  const source = readEvidenceSource(projectDir, declaration, read, config);
  if (source.status !== 'ok') {
    return resultState(declaration, selection, source, source.status, source.reasonCode, source.message);
  }
  const compared = compare(declaration, selection, source);
  if (compared.unsupported) return resultState(declaration, selection, source, 'unsupported', compared.reasonCode, compared.message);
  if (compared.inconclusive) return resultState(declaration, selection, source, 'inconclusive', compared.reasonCode, compared.message);
  const state = compared.match ? 'verified-within-scope' : 'contradicted';
  const message = compared.match
    ? 'The selected statement matches its current declared evidence.'
    : 'The selected statement contradicts its current declared evidence.';
  return resultState(declaration, selection, source, state, compared.match ? 'predicate-satisfied' : 'predicate-mismatch', message, {
    documentValue: compared.documentValue,
  });
}

export function evaluateEvidence(projectDir, config = {}) {
  const read = createEvidenceReader(projectDir);
  const loaded = loadEvidenceManifest(projectDir, read);
  if (!loaded.exists) {
    return {
      command: 'verify --evidence', exists: false, manifest: '.docguard-evidence.json',
      status: 'not-configured', errors: [], results: [], summary: Object.fromEntries(EVIDENCE_STATES.map(state => [state, 0])),
      scopeLimitation: EVIDENCE_SCOPE_LIMITATION,
    };
  }
  if (loaded.errors.length) {
    return {
      command: 'verify --evidence', exists: true, manifest: '.docguard-evidence.json',
      status: 'invalid', manifestEvidence: loaded.evidence, errors: loaded.errors, results: [],
      summary: Object.fromEntries(EVIDENCE_STATES.map(state => [state, 0])), scopeLimitation: EVIDENCE_SCOPE_LIMITATION,
    };
  }
  const results = loaded.manifest.declarations.map(declaration => evaluateDeclaration(projectDir, config, declaration, read));
  const summary = Object.fromEntries(EVIDENCE_STATES.map(state => [state, results.filter(result => result.state === state).length]));
  const status = summary.contradicted > 0 ? 'contradicted'
    : summary.stale + summary.inconclusive + summary.unsupported > 0 ? 'attention-required'
      : 'verified-within-scope';
  return {
    command: 'verify --evidence', exists: true, manifest: '.docguard-evidence.json', status,
    manifestEvidence: loaded.evidence, errors: [], results, summary, scopeLimitation: EVIDENCE_SCOPE_LIMITATION,
  };
}

/** Reduce heuristic work only when one verified declaration maps to one exact extracted claim. */
export function coverSemanticClaims(claims, evaluation) {
  const verified = evaluation?.results?.filter(result => result.state === 'verified-within-scope') || [];
  const candidates = new Map();
  for (const claim of claims) {
    const matches = verified.filter(result => {
      const line = Number(String(result.location).match(/:(\d+)$/)?.[1]);
      if (result.document !== claim.doc || line !== claim.line || !String(claim.text).includes(result.statement)) return false;
      if (Array.isArray(result.documentValue)) return claim.kind === 'enum' && result.documentValue.join('/') === claim.value;
      if (result.documentValue === null) return false;
      return String(result.documentValue) === String(claim.value);
    });
    candidates.set(claim.stableId, matches);
  }
  const resultUse = new Map();
  for (const matches of candidates.values()) {
    for (const result of matches) resultUse.set(result.claimId, (resultUse.get(result.claimId) || 0) + 1);
  }
  const covered = claims.filter(claim => {
    const matches = candidates.get(claim.stableId) || [];
    return matches.length === 1 && resultUse.get(matches[0].claimId) === 1;
  });
  const coveredIds = new Set(covered.map(claim => claim.stableId));
  return {
    total: claims.length,
    verifiedWithinScope: covered.length,
    unverified: claims.length - covered.length,
    covered: covered.map(claim => claim.stableId),
    remaining: claims.filter(claim => !coveredIds.has(claim.stableId)),
  };
}
