/**
 * Strict loader for evidence-scoped verification declarations.
 * @implements docguard.evidence-scoped-verification#FR-001
 * @implements docguard.evidence-scoped-verification#FR-002
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEvidenceReader } from '../scanners/semantic-claims.mjs';

export const EVIDENCE_MANIFEST_PATH = '.docguard-evidence.json';
export const EVIDENCE_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-evidence.schema.json';
export const EVIDENCE_SCHEMA_VERSION = 1;
export const MAX_DECLARATIONS = 128;
export const MAX_REPORT_INPUTS = 32;

const ID_RE = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const VALUE_PREDICATES = new Set(['equals', 'set-equals', 'count-equals']);
const REPORT_ADAPTERS = new Set(['oasdiff', 'buf']);

function issue(message, declarationId = null) {
  return { code: 'invalid-manifest', message, declarationId };
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label, errors, id = null) {
  if (!object(value)) {
    errors.push(issue(`${label} must be an object.`, id));
    return false;
  }
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) errors.push(issue(`${label} has unknown field(s): ${unknown.join(', ')}.`, id));
  return unknown.length === 0;
}

export function isSafeEvidencePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 512
    && !path.startsWith('/') && !/[\\:\0]/.test(path)
    && !path.split('/').some(part => part === '..' || part.toLowerCase() === '.local' || /^\.env(?:\.|$)/i.test(part));
}

function validateTarget(target, errors, id) {
  exactKeys(target, ['document', 'heading', 'statement'], `${id}.target`, errors, id);
  if (!isSafeEvidencePath(target?.document) || !target.document.endsWith('.md')) {
    errors.push(issue(`${id}.target.document must be a safe repository-relative Markdown path.`, id));
  }
  if (typeof target?.heading !== 'string' || !target.heading.trim() || target.heading.length > 200) {
    errors.push(issue(`${id}.target.heading must contain 1-200 characters.`, id));
  }
  if (typeof target?.statement !== 'string' || !target.statement.trim() || target.statement.length > 1000) {
    errors.push(issue(`${id}.target.statement must contain 1-1000 characters.`, id));
  }
}

function validateInputs(inputs, errors, id) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_REPORT_INPUTS) {
    errors.push(issue(`${id}.source.inputs must contain 1-${MAX_REPORT_INPUTS} input snapshots.`, id));
    return;
  }
  const seen = new Set();
  for (const [index, input] of inputs.entries()) {
    exactKeys(input, ['path', 'sha256'], `${id}.source.inputs[${index}]`, errors, id);
    if (!isSafeEvidencePath(input?.path)) errors.push(issue(`${id}.source.inputs[${index}].path is unsafe.`, id));
    if (!HASH_RE.test(input?.sha256 || '')) errors.push(issue(`${id}.source.inputs[${index}].sha256 must be a lowercase SHA-256 identity.`, id));
    if (seen.has(input?.path)) errors.push(issue(`${id}.source.inputs repeats ${input.path}.`, id));
    seen.add(input?.path);
  }
}

function validateSource(source, errors, id) {
  if (!object(source)) {
    errors.push(issue(`${id}.source must be an object.`, id));
    return;
  }
  if (source.adapter === 'json-pointer') {
    exactKeys(source, ['adapter', 'path', 'pointer'], `${id}.source`, errors, id);
    if (!isSafeEvidencePath(source.path)) errors.push(issue(`${id}.source.path is unsafe.`, id));
    if (typeof source.pointer !== 'string' || source.pointer.length > 512 || (source.pointer && !source.pointer.startsWith('/'))) {
      errors.push(issue(`${id}.source.pointer must be an RFC 6901 JSON Pointer.`, id));
    }
    return;
  }
  if (source.adapter === 'collection-count') {
    exactKeys(source, ['adapter', 'glob', 'allowEmpty'], `${id}.source`, errors, id);
    if (!isSafeEvidencePath(source.glob) || source.glob.length > 512) errors.push(issue(`${id}.source.glob is unsafe or unbounded.`, id));
    if (typeof source.allowEmpty !== 'boolean') errors.push(issue(`${id}.source.allowEmpty must be boolean.`, id));
    return;
  }
  if (REPORT_ADAPTERS.has(source.adapter)) {
    exactKeys(source, ['adapter', 'adapterVersion', 'path', 'producerVersion', 'command', 'inputs'], `${id}.source`, errors, id);
    if (!Number.isInteger(source.adapterVersion) || source.adapterVersion < 1 || source.adapterVersion > 100) {
      errors.push(issue(`${id}.source.adapterVersion must be an integer from 1-100.`, id));
    }
    if (!isSafeEvidencePath(source.path)) errors.push(issue(`${id}.source.path is unsafe.`, id));
    if (typeof source.producerVersion !== 'string' || !source.producerVersion.trim() || source.producerVersion.length > 80) {
      errors.push(issue(`${id}.source.producerVersion must contain 1-80 characters.`, id));
    }
    if (typeof source.command !== 'string' || !source.command.trim() || source.command.length > 40) {
      errors.push(issue(`${id}.source.command must contain 1-40 characters.`, id));
    }
    validateInputs(source.inputs, errors, id);
    return;
  }
  errors.push(issue(`${id}.source.adapter is unsupported.`, id));
}

function validatePredicate(predicate, source, statement, errors, id) {
  if (!object(predicate)) {
    errors.push(issue(`${id}.predicate must be an object.`, id));
    return;
  }
  if (predicate.kind === 'equals') {
    exactKeys(predicate, ['kind', 'valueType'], `${id}.predicate`, errors, id);
    if (!['string', 'number', 'boolean', 'null'].includes(predicate.valueType)) {
      errors.push(issue(`${id}.predicate.valueType is unsupported.`, id));
    }
  } else if (predicate.kind === 'set-equals') {
    exactKeys(predicate, ['kind', 'itemType', 'separator'], `${id}.predicate`, errors, id);
    if (predicate.itemType !== 'string') errors.push(issue(`${id}.predicate.itemType must be string.`, id));
    if (typeof predicate.separator !== 'string' || !predicate.separator || predicate.separator.length > 16) {
      errors.push(issue(`${id}.predicate.separator must contain 1-16 characters.`, id));
    }
  } else if (predicate.kind === 'count-equals' || predicate.kind === 'no-findings') {
    exactKeys(predicate, ['kind'], `${id}.predicate`, errors, id);
  } else {
    errors.push(issue(`${id}.predicate.kind is unsupported.`, id));
  }

  const slots = typeof statement === 'string' ? statement.split('{{value}}').length - 1 : 0;
  if (VALUE_PREDICATES.has(predicate.kind) && slots !== 1) {
    errors.push(issue(`${id}.target.statement must contain exactly one {{value}} slot for ${predicate.kind}.`, id));
  }
  if (predicate.kind === 'no-findings' && slots !== 0) {
    errors.push(issue(`${id}.target.statement cannot contain {{value}} for no-findings.`, id));
  }
  if (source?.adapter === 'json-pointer' && !['equals', 'set-equals'].includes(predicate.kind)) {
    errors.push(issue(`${id} combines json-pointer with an incompatible predicate.`, id));
  }
  if (source?.adapter === 'collection-count' && predicate.kind !== 'count-equals') {
    errors.push(issue(`${id} must combine collection-count with count-equals.`, id));
  }
  if (REPORT_ADAPTERS.has(source?.adapter) && predicate.kind !== 'no-findings') {
    errors.push(issue(`${id} must combine ${source.adapter} with no-findings.`, id));
  }
}

function validateDeclaration(declaration, index, errors) {
  const label = declaration?.id || `declarations[${index}]`;
  exactKeys(declaration, ['id', 'applicability', 'target', 'source', 'predicate'], label, errors, label);
  if (!ID_RE.test(declaration?.id || '')) errors.push(issue(`${label}.id is invalid.`, label));
  exactKeys(declaration?.applicability, ['mode'], `${label}.applicability`, errors, label);
  if (declaration?.applicability?.mode !== 'always') errors.push(issue(`${label}.applicability.mode is unsupported.`, label));
  validateTarget(declaration?.target, errors, label);
  validateSource(declaration?.source, errors, label);
  validatePredicate(declaration?.predicate, declaration?.source, declaration?.target?.statement, errors, label);
}

export function validateEvidenceManifest(manifest) {
  const errors = [];
  exactKeys(manifest, ['$schema', 'schemaVersion', 'declarations'], 'manifest', errors);
  if (manifest?.$schema !== EVIDENCE_SCHEMA_URL) errors.push(issue(`$schema must be ${EVIDENCE_SCHEMA_URL}.`));
  if (manifest?.schemaVersion !== EVIDENCE_SCHEMA_VERSION) errors.push(issue(`schemaVersion must be ${EVIDENCE_SCHEMA_VERSION}.`));
  if (!Array.isArray(manifest?.declarations) || manifest.declarations.length < 1 || manifest.declarations.length > MAX_DECLARATIONS) {
    errors.push(issue(`declarations must contain 1-${MAX_DECLARATIONS} entries.`));
    return errors;
  }
  const ids = new Set();
  for (const [index, declaration] of manifest.declarations.entries()) {
    validateDeclaration(declaration, index, errors);
    if (ids.has(declaration?.id)) errors.push(issue(`Duplicate declaration ID ${declaration.id}.`, declaration.id));
    ids.add(declaration?.id);
  }
  return errors;
}

export function loadEvidenceManifest(projectDir, read = createEvidenceReader(projectDir)) {
  const path = resolve(projectDir, EVIDENCE_MANIFEST_PATH);
  if (!existsSync(path)) return { exists: false, manifest: null, errors: [], evidence: null };
  const snapshot = read(EVIDENCE_MANIFEST_PATH);
  if (snapshot.content === null) {
    return { exists: true, manifest: null, errors: [issue(`Cannot safely read ${EVIDENCE_MANIFEST_PATH}: ${snapshot.evidence.reason}.`)], evidence: snapshot.evidence };
  }
  let manifest;
  try { manifest = JSON.parse(snapshot.content); }
  catch (error) {
    return { exists: true, manifest: null, errors: [issue(`${EVIDENCE_MANIFEST_PATH} is invalid JSON: ${error.message}`)], evidence: snapshot.evidence };
  }
  const errors = validateEvidenceManifest(manifest);
  return { exists: true, manifest: errors.length ? null : manifest, errors, evidence: snapshot.evidence };
}
