/**
 * Strict baseline envelope contract. A persisted benchmark result is quotable
 * only when it says what its ratios measure and carries the caveat a reader
 * must show beside them. Metrics are recomputed from the retained cases, so a
 * hand-edited ratio fails closed instead of becoming a published number.
 * @implements docguard.precision-evidence-loop#FR-009
 * @implements docguard.precision-evidence-loop#FR-018
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateMetrics } from './metrics.mjs';

export const BASELINE_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-benchmark-baseline.schema.json';
export const BASELINE_SCHEMA_VERSION = 2;
export const CORE_SCHEMA_VERSION = 1;
/** What every ratio in the envelope is: precision on labelled benchmark cases, never P(finding is real). */
export const BASELINE_MEASURES = 'benchmark-precision';
export const DEFAULT_METHODOLOGY = 'Labels were authored from pinned source and seeded mutations before DocGuard output was reviewed.';
export const DEFAULT_LIMITATIONS = 'Finite scoped cases do not establish exhaustive documentation or detector correctness.';

const ENVELOPE_KEYS = new Set(['$schema', 'schemaVersion', 'review', 'core', 'observations']);
const REVIEW_KEYS = new Set(['status', 'reviewedAt', 'reviewer', 'scope', 'methodology', 'limitations', 'measures', 'caveat']);
const CORE_KEYS = new Set(['schemaVersion', 'manifestDigest', 'tool', 'cases', 'metrics']);
const TOOL_KEYS = new Set(['version', 'revision']);
const OBSERVATION_KEYS = new Set(['environment', 'cases', 'retainedRoot', 'comparisonProtocol']);
const REVIEW_STATUSES = new Set(['candidate', 'reviewed']);
const CLASSIFICATIONS = new Set(['defect', 'clean_control', 'ambiguous', 'unsupported_syntax', 'policy_disagreement']);
const REPAIR_OUTCOMES = new Set(['accepted', 'rejected', 'not_evaluated']);
const CASE_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}.`);
}

function line(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a bounded non-empty single-line string.`);
  }
  return value;
}

function identities(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
    throw new Error(`${label} must be an array of finding identities.`);
  }
  return value;
}

/**
 * The one sentence a consumer must show beside any quoted ratio. Derived from
 * the retained cases so it cannot drift from the numbers it qualifies.
 */
export function benchmarkCaveat(cases) {
  const measured = cases.filter(item => ['defect', 'clean_control'].includes(item.classification));
  const defects = measured.filter(item => item.classification === 'defect').length;
  const controls = measured.length - defects;
  const repositories = new Set(measured.map(item => item.repositoryGroup)).size;
  const families = new Set(measured.map(item => item.causalFamily)).size;
  return `Benchmark precision on a deliberately balanced corpus of ${defects} defect and ${controls} clean-control cases `
    + `across ${repositories} repository groups and ${families} causal families. `
    + 'This is DocGuard\'s precision on labelled cases, not the probability that a finding in your repository is real; '
    + 'quote every ratio with its n and Wilson 95% bound.';
}

function validateCase(value, index) {
  const label = `core.cases[${index}]`;
  object(value, label);
  if (!CASE_ID.test(value.id || '')) throw new Error(`${label}.id is invalid.`);
  if (!CLASSIFICATIONS.has(value.classification)) throw new Error(`${label}.classification is invalid.`);
  if (!REPAIR_OUTCOMES.has(value.repairOutcome)) throw new Error(`${label}.repairOutcome is invalid.`);
  line(value.repositoryGroup, `${label}.repositoryGroup`, 128);
  line(value.causalFamily, `${label}.causalFamily`, 128);
  line(value.parserTier, `${label}.parserTier`, 64);
  object(value.scope, `${label}.scope`);
  line(value.scope.validatorKey, `${label}.scope.validatorKey`, 64);
  for (const field of ['expected', 'forbidden', 'actual', 'unexpected', 'missing', 'forbiddenObserved']) identities(value[field], `${label}.${field}`);
  if (typeof value.abstained !== 'boolean') throw new Error(`${label}.abstained must be a boolean.`);
  if (!['PASS', 'FAIL', 'UNSUPPORTED', 'ADJUDICATION'].includes(value.status)) throw new Error(`${label}.status is invalid.`);
  return value;
}

function validateCore(core) {
  object(core, 'core');
  exactKeys(core, CORE_KEYS, 'core');
  if (core.schemaVersion !== CORE_SCHEMA_VERSION) throw new Error(`core.schemaVersion must be ${CORE_SCHEMA_VERSION}.`);
  if (!SHA256.test(core.manifestDigest || '')) throw new Error('core.manifestDigest must be a sha256 digest.');
  object(core.tool, 'core.tool');
  exactKeys(core.tool, TOOL_KEYS, 'core.tool');
  line(core.tool.version, 'core.tool.version', 64);
  if (core.tool.revision !== null && !GIT_REVISION.test(core.tool.revision || '')) {
    throw new Error('core.tool.revision must be a full commit hash or null.');
  }
  if (!Array.isArray(core.cases) || !core.cases.length) throw new Error('core.cases must be a non-empty array.');
  core.cases.forEach(validateCase);
  const ids = core.cases.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('core.cases contains duplicate IDs.');
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (ids.some((id, index) => id !== sorted[index])) throw new Error('core.cases must be sorted by ID for deterministic comparison.');
  object(core.metrics, 'core.metrics');
  const recomputed = calculateMetrics(core.cases);
  if (JSON.stringify(core.metrics) !== JSON.stringify(recomputed)) {
    throw new Error('core.metrics does not match the metrics recomputed from core.cases; a baseline ratio cannot be edited by hand.');
  }
  return core;
}

function validateReview(review, cases) {
  object(review, 'review');
  exactKeys(review, REVIEW_KEYS, 'review');
  if (!REVIEW_STATUSES.has(review.status)) throw new Error('review.status must be candidate or reviewed.');
  if (review.status === 'reviewed') {
    if (!ISO_DATE.test(review.reviewedAt || '')) throw new Error('review.reviewedAt (YYYY-MM-DD) is required once a baseline is reviewed.');
    line(review.reviewer, 'review.reviewer', 128);
  } else if (review.reviewedAt !== undefined || review.reviewer !== undefined) {
    throw new Error('review.reviewedAt and review.reviewer belong to a reviewed baseline, not a candidate.');
  }
  if (review.scope !== undefined) line(review.scope, 'review.scope', 1024);
  line(review.methodology, 'review.methodology', 1024);
  line(review.limitations, 'review.limitations', 1024);
  if (review.measures !== BASELINE_MEASURES) {
    throw new Error(`review.measures must be "${BASELINE_MEASURES}": the envelope reports benchmark precision, not a calibrated probability.`);
  }
  const expectedCaveat = benchmarkCaveat(cases);
  if (review.caveat !== expectedCaveat) {
    throw new Error('review.caveat does not match the caveat derived from core.cases; regenerate the envelope instead of editing it.');
  }
  return review;
}

function validateObservations(observations) {
  object(observations, 'observations');
  exactKeys(observations, OBSERVATION_KEYS, 'observations');
  object(observations.environment, 'observations.environment');
  for (const field of ['node', 'platform', 'arch']) line(observations.environment[field], `observations.environment.${field}`, 64);
  if (!Array.isArray(observations.cases)) throw new Error('observations.cases must be an array.');
  observations.cases.forEach((item, index) => {
    object(item, `observations.cases[${index}]`);
    if (!CASE_ID.test(item.id || '')) throw new Error(`observations.cases[${index}].id is invalid.`);
    for (const phase of ['coldMs', 'warmMs']) {
      if (typeof item[phase] !== 'number' || !Number.isFinite(item[phase]) || item[phase] < 0) {
        throw new Error(`observations.cases[${index}].${phase} must be a non-negative number.`);
      }
    }
  });
  if (observations.retainedRoot !== null && typeof observations.retainedRoot !== 'string') {
    throw new Error('observations.retainedRoot must be a string or null.');
  }
  if (observations.comparisonProtocol !== undefined) object(observations.comparisonProtocol, 'observations.comparisonProtocol');
  return observations;
}

export function parseBaseline(value) {
  object(value, 'baseline');
  if (value.schemaVersion === 1 && value.$schema === undefined) {
    throw new Error('Baseline envelope schemaVersion 1 predates the provenance contract (measures, caveat); '
      + 'regenerate it with --write-baseline --replace-baseline after review.');
  }
  exactKeys(value, ENVELOPE_KEYS, 'baseline');
  if (value.$schema !== BASELINE_SCHEMA_URL) throw new Error(`baseline.$schema must be ${BASELINE_SCHEMA_URL}.`);
  if (value.schemaVersion !== BASELINE_SCHEMA_VERSION) throw new Error(`baseline.schemaVersion must be ${BASELINE_SCHEMA_VERSION}.`);
  const core = validateCore(value.core);
  const review = validateReview(value.review, core.cases);
  const observations = validateObservations(value.observations);
  return { $schema: BASELINE_SCHEMA_URL, schemaVersion: BASELINE_SCHEMA_VERSION, review, core, observations };
}

export function loadBaseline(baselinePath) {
  const absolute = resolve(baselinePath);
  let value;
  try { value = JSON.parse(readFileSync(absolute, 'utf8')); } catch (error) {
    throw new Error(`Baseline is not valid JSON: ${error.message}`);
  }
  return parseBaseline(value);
}

/** Provenance every report carries, persisted or not: what the ratios are and the sentence that must accompany them. */
export function benchmarkProvenance(core) {
  return { measures: BASELINE_MEASURES, caveat: benchmarkCaveat(core.cases) };
}

/** Builds a candidate envelope from a run. The caveat is derived, never supplied. */
export function buildBaselineEnvelope({ core, observations, review = {} }) {
  const envelope = {
    $schema: BASELINE_SCHEMA_URL,
    schemaVersion: BASELINE_SCHEMA_VERSION,
    review: {
      status: 'candidate',
      ...review,
      methodology: review.methodology || DEFAULT_METHODOLOGY,
      limitations: review.limitations || DEFAULT_LIMITATIONS,
      measures: BASELINE_MEASURES,
      caveat: benchmarkCaveat(core.cases),
    },
    core,
    observations,
  };
  return parseBaseline(envelope);
}
