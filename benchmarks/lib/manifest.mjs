/**
 * Strict benchmark manifest validation. Labels are input authority; this module
 * never derives expectations from DocGuard output.
 * @implements docguard.precision-evidence-loop#FR-001
 * @implements docguard.precision-evidence-loop#FR-003
 * @implements docguard.precision-evidence-loop#FR-004
 * @implements docguard.precision-evidence-loop#FR-005
 * @implements docguard.precision-evidence-loop#FR-008
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

export const BENCHMARK_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-benchmark.schema.json';
const CASE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const CODE = /^[A-Z]{3}\d{3}$/;
const IDENTITY = /^([A-Z]{3}\d{3})@(.+)$/;
const CLASSIFICATIONS = new Set(['defect', 'clean_control', 'ambiguous', 'unsupported_syntax', 'policy_disagreement']);
const SPLITS = new Set(['development', 'evaluation']);
const TIERS = new Set(['js-ast', 'py-ast', 'regex-fallback', 'fallback-language', 'mixed', 'not-applicable']);
const CASE_KEYS = new Set(['id', 'split', 'repositoryGroup', 'causalFamily', 'parserTier', 'classification', 'source', 'scope', 'config', 'mutations', 'expected', 'forbidden', 'oppositeControl']);
const SOURCE_KEYS = new Set(['kind', 'path', 'url', 'revision', 'license']);
const SCOPE_KEYS = new Set(['validatorKey', 'codes']);
const MUTATION_KEYS = new Set(['path', 'find', 'replace', 'expectedOccurrences']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}.`);
}

export function safeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || !value || value.includes('\\') || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty POSIX repository-relative path.`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')
    || parts.some(part => ['.git', '.local'].includes(part.toLowerCase()))) {
    throw new Error(`${label} escapes or enters a protected directory.`);
  }
  return value;
}

function string(value, label, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a bounded non-empty single-line string.`);
  }
  return value;
}

function strings(value, label, matcher = null) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates.`);
  if (matcher && value.some(item => !matcher.test(item))) throw new Error(`${label} contains an invalid value.`);
  return [...value].sort();
}

function validateConfigValue(value, label, depth = 0) {
  if (depth > 6) throw new Error(`${label} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string') {
    if (value.length > 10_000 || value.includes('\0')) throw new Error(`${label} contains an invalid or oversized string.`);
    if (isAbsolute(value) || /^(?:\.\.?[/\\]|~[/\\]|[A-Za-z]:[\\/])/.test(value) || value.includes('\\')) {
      throw new Error(`${label} contains a path-like value that could escape the disposable repository.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error(`${label} exceeds the maximum array size.`);
    value.forEach((item, index) => validateConfigValue(item, `${label}[${index}]`, depth + 1));
    return;
  }
  object(value, label);
  const keys = Object.keys(value);
  if (keys.length > 100 || keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error(`${label} contains too many or unsafe keys.`);
  }
  for (const key of keys) validateConfigValue(value[key], `${label}.${key}`, depth + 1);
}

function validateSource(source, label, manifestDir) {
  object(source, label);
  exactKeys(source, SOURCE_KEYS, label);
  if (source.kind === 'fixture') {
    exactKeys(source, new Set(['kind', 'path']), label);
    const path = safeRelativePath(source.path, `${label}.path`);
    if (!path.startsWith('fixtures/')) throw new Error(`${label}.path must be under fixtures/.`);
    const target = resolve(manifestDir, path);
    const fixtures = resolve(manifestDir, 'fixtures');
    if (!target.startsWith(`${fixtures}${sep}`) || !existsSync(target)) throw new Error(`${label}.path does not exist under fixtures/.`);
    const real = realpathSync(target);
    if (!real.startsWith(`${realpathSync(fixtures)}${sep}`) || lstatSync(target).isSymbolicLink()) {
      throw new Error(`${label}.path cannot use symlinked fixture roots.`);
    }
    return { kind: 'fixture', path };
  }
  if (source.kind === 'git') {
    exactKeys(source, new Set(['kind', 'url', 'revision', 'license']), label);
    let url;
    try { url = new URL(source.url); } catch { throw new Error(`${label}.url must be a valid HTTPS Git URL.`); }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.git$/i.test(url.pathname)) {
      throw new Error(`${label}.url must be a credential-free HTTPS URL ending in .git.`);
    }
    const host = url.hostname.toLowerCase();
    if (url.port || host === 'localhost' || host.endsWith('.local') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) {
      throw new Error(`${label}.url must name a public HTTPS Git host without a custom port.`);
    }
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(source.revision || '')) {
      throw new Error(`${label}.revision must be a full 40- or 64-character commit hash.`);
    }
    return { kind: 'git', url: source.url, revision: source.revision, license: string(source.license, `${label}.license`, 128) };
  }
  throw new Error(`${label}.kind must be fixture or git.`);
}

function validateMutation(value, label) {
  object(value, label);
  exactKeys(value, MUTATION_KEYS, label);
  const path = safeRelativePath(value.path, `${label}.path`);
  if (typeof value.find !== 'string' || !value.find || value.find.length > 20_000 || value.find.includes('\0')) {
    throw new Error(`${label}.find must contain 1-20000 characters.`);
  }
  if (typeof value.replace !== 'string' || value.replace.length > 20_000 || value.replace.includes('\0')) {
    throw new Error(`${label}.replace must contain at most 20000 characters.`);
  }
  if (!Number.isInteger(value.expectedOccurrences) || value.expectedOccurrences < 1 || value.expectedOccurrences > 20) {
    throw new Error(`${label}.expectedOccurrences must be an integer from 1 to 20.`);
  }
  return { path, find: value.find, replace: value.replace, expectedOccurrences: value.expectedOccurrences };
}

function validateCase(value, index, manifestDir) {
  const label = `cases[${index}]`;
  object(value, label);
  exactKeys(value, CASE_KEYS, label);
  const id = string(value.id, `${label}.id`, 128);
  if (!CASE_ID.test(id)) throw new Error(`${label}.id is invalid.`);
  if (!SPLITS.has(value.split)) throw new Error(`${label}.split is invalid.`);
  if (!CLASSIFICATIONS.has(value.classification)) throw new Error(`${label}.classification is invalid.`);
  if (!TIERS.has(value.parserTier)) throw new Error(`${label}.parserTier is invalid.`);
  const scope = object(value.scope, `${label}.scope`);
  exactKeys(scope, SCOPE_KEYS, `${label}.scope`);
  const codes = strings(scope.codes, `${label}.scope.codes`, CODE);
  if (!codes.length) throw new Error(`${label}.scope.codes cannot be empty.`);
  const expected = strings(value.expected, `${label}.expected`, IDENTITY);
  const forbidden = strings(value.forbidden, `${label}.forbidden`, IDENTITY);
  for (const identity of [...expected, ...forbidden]) {
    const [, code, path] = identity.match(IDENTITY);
    if (!codes.includes(code)) throw new Error(`${label} identity ${identity} is outside scope.codes.`);
    safeRelativePath(path, `${label} identity path`);
  }
  if (expected.some(identity => forbidden.includes(identity))) throw new Error(`${label} has an identity in both expected and forbidden.`);
  if (value.classification === 'defect' && (!expected.length || !value.oppositeControl)) {
    throw new Error(`${label} defects require expected findings and an oppositeControl.`);
  }
  if (value.classification === 'clean_control' && expected.length) throw new Error(`${label} clean controls cannot declare expected findings.`);
  if (value.config !== undefined) validateConfigValue(value.config, `${label}.config`);
  return {
    id,
    split: value.split,
    repositoryGroup: string(value.repositoryGroup, `${label}.repositoryGroup`, 128),
    causalFamily: string(value.causalFamily, `${label}.causalFamily`, 128),
    parserTier: value.parserTier,
    classification: value.classification,
    source: validateSource(value.source, `${label}.source`, manifestDir),
    scope: { validatorKey: string(scope.validatorKey, `${label}.scope.validatorKey`, 64), codes },
    config: value.config || null,
    mutations: (value.mutations || []).map((item, mutationIndex) => validateMutation(item, `${label}.mutations[${mutationIndex}]`)),
    expected,
    forbidden,
    oppositeControl: value.oppositeControl || null,
  };
}

function validateRelationships(cases) {
  const byId = new Map();
  for (const item of cases) {
    if (byId.has(item.id)) throw new Error(`Duplicate benchmark case ID: ${item.id}.`);
    byId.set(item.id, item);
  }
  for (const item of cases.filter(candidate => candidate.classification === 'defect')) {
    const control = byId.get(item.oppositeControl);
    if (!control || control.classification !== 'clean_control') throw new Error(`${item.id} oppositeControl must name a clean_control case.`);
    if (control.split !== item.split || control.repositoryGroup !== item.repositoryGroup || control.causalFamily !== item.causalFamily) {
      throw new Error(`${item.id} and its opposite control must share split, repositoryGroup, and causalFamily.`);
    }
  }
  const development = cases.filter(item => item.split === 'development');
  const evaluation = cases.filter(item => item.split === 'evaluation');
  for (const field of ['repositoryGroup', 'causalFamily']) {
    const dev = new Set(development.map(item => item[field]));
    const leaked = [...new Set(evaluation.map(item => item[field]).filter(value => dev.has(value)))];
    if (leaked.length) throw new Error(`Benchmark split leakage in ${field}: ${leaked.join(', ')}.`);
  }
}

export function parseBenchmarkManifest(value, manifestPath) {
  object(value, 'manifest');
  exactKeys(value, new Set(['$schema', 'schemaVersion', 'cases']), 'manifest');
  if (value.$schema !== BENCHMARK_SCHEMA_URL || value.schemaVersion !== 1 || !Array.isArray(value.cases) || !value.cases.length) {
    throw new Error('Benchmark manifest requires the supported schema, schemaVersion 1, and at least one case.');
  }
  const cases = value.cases.map((item, index) => validateCase(item, index, dirname(manifestPath)));
  validateRelationships(cases);
  return { $schema: BENCHMARK_SCHEMA_URL, schemaVersion: 1, cases: cases.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function loadBenchmarkManifest(manifestPath) {
  const absolute = resolve(manifestPath);
  let value;
  try { value = JSON.parse(readFileSync(absolute, 'utf8')); } catch (error) {
    throw new Error(`Benchmark manifest is not valid JSON: ${error.message}`);
  }
  return parseBenchmarkManifest(value, absolute);
}
