/** Coverage describes what ran; a successful gate is not exhaustive assurance. */
import { existsSync } from 'node:fs';
import { resolveDocRole, docRolePath } from './shared-doc-roles.mjs';
const PREREQUISITES = { testSpec: 'testSpec', environment: 'environment', apiSurface: 'apiReference', architecture: 'architecture' };
const STATES = new Set(['checked', 'partial', 'disabled', 'not-applicable', 'missing-prerequisite', 'unsupported', 'no-matches', 'error']);
/**
 * The reason a status carries when nothing more specific is known; the compact
 * guard form states each once.
 *
 * @implements docguard.compact-guard-response#FR-007
 */
export const STANDARD_APPLICABILITY_REASONS = Object.freeze({
  checked: 'Completed the declared checks; this does not establish exhaustive language, framework, or semantic coverage.',
  disabled: 'Disabled by the effective configuration or selected command scope.',
  'no-matches': 'No checkable inputs matched this detector. This does not establish that the project has no relevant behavior.',
});
/**
 * The coarse axis that decides whether a skip is legitimate: only a check the
 * project disabled or declared N/A is `not-applicable`. Finding no inputs is
 * `unknown`, never proof that the check does not apply.
 * @implements docguard.verdict-contract#FR-002
 */
export const APPLICABILITY_CLASS = Object.freeze({
  checked: 'applicable', partial: 'applicable',
  disabled: 'not-applicable', 'not-applicable': 'not-applicable',
  'no-matches': 'unknown', 'missing-prerequisite': 'unknown', unsupported: 'unknown', error: 'unknown',
});

export const VERDICTS = Object.freeze(['pass', 'fail', 'empty', 'inconclusive', 'blocked', 'skipped']);

/** One reason naming each gap's operation, cause and scope. */
function gapReason(gaps) {
  const withheld = gaps.reduce((n, g) => n + (g.withheld || 0), 0);
  return 'Could not observe: ' + gaps.map(g => `${g.operation} (${g.cause}; ${g.scope?.count ?? 1} affected)`).join('; ')
    + (withheld ? `; ${withheld} absence finding${withheld === 1 ? '' : 's'} withheld` : '');
}

function baseCoverage(projectDir, config, result) {
  if (result.status === 'skipped') return { status: 'disabled', reason: STANDARD_APPLICABILITY_REASONS.disabled };
  if (result.note?.startsWith('declared N/A')) return { status: 'not-applicable', reason: result.note };
  if (STATES.has(result.applicability?.status) && typeof result.applicability.reason === 'string') return { status: result.applicability.status, reason: result.applicability.reason };
  if (result.total > 0) return { status: 'checked', reason: STANDARD_APPLICABILITY_REASONS.checked };
  const role = PREREQUISITES[result.key];
  if (role && !existsSync(resolveDocRole(projectDir, config, role))) return { status: 'missing-prerequisite', reason: 'No document available for role ' + role + ': ' + docRolePath(config, role) };
  return { status: 'no-matches', reason: result.note || STANDARD_APPLICABILITY_REASONS['no-matches'] };
}

/**
 * @implements docguard.verdict-contract#FR-002
 * @implements docguard.verdict-contract#FR-005
 */
export function describeCheckCoverage(projectDir, config, result) {
  const coverage = baseCoverage(projectDir, config, result);
  const gaps = Array.isArray(result.observations) ? result.observations : [];
  // A gap makes a complete-looking check partial; a more specific state stays.
  if (gaps.length && (coverage.status === 'checked' || coverage.status === 'no-matches')) {
    coverage.status = 'partial';
    coverage.reason = gapReason(gaps);
  }
  return { ...coverage, class: APPLICABILITY_CLASS[coverage.status] };
}

/**
 * The result contract of a validator (specs/097-strict-by-default FR-004 to
 * FR-006). A validator that returns it is "migrated"; one that does not keeps
 * working exactly as before and is listed in the registry test's
 * NOT_YET_MIGRATED array until it is. The fields, all on the validator's
 * result object:
 *
 *   performed      integer >= 0. How many checks the validator genuinely made.
 *                  Absent: the legacy `total` is used, and `total` is trusted
 *                  only where a validator does not inflate it (see
 *                  `performedChecks`). A result with no findings and zero
 *                  performed checks is `empty`, never `pass` (FR-004).
 *   applies        `{ applies: boolean, evidence: string }`. Whether this kind
 *                  of check belongs to the project, decided from the project's
 *                  files, with the evidence it used. `false` means the project
 *                  has none of what the validator checks; it must never be
 *                  `false` because the validator's own configuration is
 *                  missing (FR-006). Present on every result of a migrated
 *                  validator, `evidence` never empty.
 *   emptyCause     One of EMPTY_CAUSES. Required whenever the result performed
 *                  nothing and found nothing. `nothing-of-this-kind` if and
 *                  only if `applies.applies` is false.
 *   howToConfigure A non-empty text owned by the validator: the snippet, file
 *                  or command that makes it examine something (the cause's
 *                  fix), or what was looked for and not found.
 *   applicability  Its `reason` for an empty result names this validator's own
 *                  inputs, so no two validators share a generic sentence.
 *
 * Each validator also exports `applies(projectDir, config)` returning the same
 * `{ applies, evidence }` so the decision can be tested without a full run.
 * `validateResultContract` is the one definition of "complete"; the
 * registry-wide test (tests/strict-by-default.test.mjs) enforces it.
 *
 * @implements docguard.strict-by-default#FR-004
 * @implements docguard.strict-by-default#FR-005
 * @implements docguard.strict-by-default#FR-006
 */
export const EMPTY_CAUSES = Object.freeze(['needs-declaration', 'needs-content', 'layout-not-recognized', 'nothing-of-this-kind']);

/**
 * How many checks a validator genuinely performed. The explicit `performed`
 * field wins. Otherwise the existing `total` is the count: every validator
 * already reports it, and most keep it to checks actually made. Validators
 * that padded `total` to keep a 0/0 out of the output (Requirement-Anchors,
 * Doc-Ownership) set `performed` explicitly instead of changing `total`, which
 * would change counts and the badge under `standard`.
 */
export function performedChecks(result) {
  if (Number.isInteger(result?.performed) && result.performed >= 0) return result.performed;
  return Number.isFinite(result?.total) && result.total > 0 ? result.total : 0;
}

/**
 * Violations of the result contract, as sentences; an empty array means the
 * result is complete. Only a result that carries `applies` is held to it.
 * @param {object} result a validator result after `deriveVerdict`
 */
export function validateResultContract(result) {
  const problems = [];
  const key = result?.key || 'validator';
  const a = result?.applies;
  if (!a || typeof a.applies !== 'boolean') problems.push(`${key}: applies must be { applies: boolean, evidence: string }`);
  else if (typeof a.evidence !== 'string' || !a.evidence.trim()) problems.push(`${key}: applies.evidence is empty`);
  if (!Number.isInteger(result?.performed) || result.performed < 0) problems.push(`${key}: performed must be an integer >= 0`);
  const nothingFound = !(result?.findings?.length > 0) && (result?.errors?.length || 0) + (result?.warnings?.length || 0) === 0;
  const emptyish = nothingFound && result?.performed === 0;
  if (emptyish) {
    if (!EMPTY_CAUSES.includes(result.emptyCause)) problems.push(`${key}: an empty result needs emptyCause from ${EMPTY_CAUSES.join(' | ')}`);
    if (typeof result.howToConfigure !== 'string' || !result.howToConfigure.trim()) problems.push(`${key}: an empty result needs howToConfigure`);
    if (a && typeof a.applies === 'boolean' && (result.emptyCause === 'nothing-of-this-kind') !== (a.applies === false)) {
      problems.push(`${key}: emptyCause nothing-of-this-kind must hold exactly when applies.applies is false`);
    }
  } else if (result?.emptyCause !== undefined) {
    problems.push(`${key}: emptyCause is set on a result that performed checks or found something`);
  }
  return problems;
}

/**
 * The closed outcome of one validator in one run, from its own findings
 * (after baseline suppression), applicability and gaps. It describes the
 * check, not the gate: enforcement still decides the exit code.
 *
 * `strict` (enforcement mode strict): a validator that decided it does not
 * apply is `skipped` with its evidence as the reason, ahead of any
 * inconclusive state. Under `standard` the same validator keeps the verdict
 * it had, so no `standard` exit code (requiredChecks, --fail-on-inconclusive)
 * moves.
 *
 * @implements docguard.verdict-contract#FR-001
 * @implements docguard.verdict-contract#FR-003
 * @implements docguard.verdict-contract#FR-010
 * @implements docguard.strict-by-default#FR-004
 * @implements docguard.strict-by-default#FR-006
 */
export function deriveVerdict(result, { strict = false } = {}) {
  const state = result.applicability?.status;
  if (state === 'error') return 'blocked';
  if (APPLICABILITY_CLASS[state] === 'not-applicable') return 'skipped';
  const findings = Array.isArray(result.findings) ? result.findings.length : 0;
  if (findings > 0 || (result.errors?.length || 0) + (result.warnings?.length || 0) > 0) return 'fail';
  if (strict && result.applies?.applies === false) return 'skipped';
  if ((result.observations?.length || 0) > 0 || state === 'partial' || state === 'missing-prerequisite' || state === 'unsupported') return 'inconclusive';
  if (state === 'no-matches') return 'empty';
  // FR-004: a result that made no checks examined nothing, whatever it set.
  if (performedChecks(result) < 1) return 'empty';
  return 'pass';
}

/**
 * Run-level verdict counts and every gap with the validator it belongs to.
 * @implements docguard.verdict-contract#FR-012
 */
export function summarizeVerdicts(results) {
  const counts = Object.fromEntries(VERDICTS.map(v => [v, 0]));
  const gaps = [];
  for (const r of results) {
    counts[r.verdict]++;
    // A propagated entry only marks a validator that a gap elsewhere affected; it is not a gap itself.
    for (const g of r.observations || []) if (!g.propagated) gaps.push({ validator: r.key, ...g });
  }
  return { counts, gaps };
}
export function summarizeCheckCoverage(results) {
  const counts = Object.fromEntries([...STATES].map(status => [status, 0]));
  for (const result of results) counts[result.applicability.status]++;
  return { counts, limitations: results.filter(r => r.applicability.status !== 'checked').map(r => ({ key: r.key, name: r.name, ...r.applicability })),
    limitation: 'Check coverage is distinct from document inventory and factual accuracy. Unsupported or unmatched inputs remain unverified.' };
}
