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
  return 'Could not observe: ' + gaps.map(g => `${g.operation} (${g.cause}; ${g.scope?.count ?? 1} affected)`).join('; ');
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
 * The closed outcome of one validator in one run, from its own findings
 * (after baseline suppression), applicability and gaps. It describes the
 * check, not the gate: enforcement still decides the exit code.
 * @implements docguard.verdict-contract#FR-001
 * @implements docguard.verdict-contract#FR-003
 * @implements docguard.verdict-contract#FR-010
 */
export function deriveVerdict(result) {
  const state = result.applicability?.status;
  if (state === 'error') return 'blocked';
  if (APPLICABILITY_CLASS[state] === 'not-applicable') return 'skipped';
  const findings = Array.isArray(result.findings) ? result.findings.length : 0;
  if (findings > 0 || (result.errors?.length || 0) + (result.warnings?.length || 0) > 0) return 'fail';
  if ((result.observations?.length || 0) > 0 || state === 'partial' || state === 'missing-prerequisite' || state === 'unsupported') return 'inconclusive';
  if (state === 'no-matches') return 'empty';
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
    for (const g of r.observations || []) gaps.push({ validator: r.key, ...g });
  }
  return { counts, gaps };
}
export function summarizeCheckCoverage(results) {
  const counts = Object.fromEntries([...STATES].map(status => [status, 0]));
  for (const result of results) counts[result.applicability.status]++;
  return { counts, limitations: results.filter(r => r.applicability.status !== 'checked').map(r => ({ key: r.key, name: r.name, ...r.applicability })),
    limitation: 'Check coverage is distinct from document inventory and factual accuracy. Unsupported or unmatched inputs remain unverified.' };
}
