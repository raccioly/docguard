/**
 * Compact guard response for agents (specs/037-compact-guard-response).
 *
 * The full guard JSON repeats facts: `reportable` copies a subset of
 * `findings`, `validators[].findings` copies all of them again, and every
 * finding carries its code's evidence. The compact form is a projection of
 * the full result, so the two always agree. It keeps every finding once,
 * every code's agent-facing evidence once, and every count, and leaves the
 * copies (and the raw benchmark statistics per code) to the full form.
 *
 * The same holds for coverage text: a validator whose applicability reason is
 * its status's standard reason carries only the status, and the standard
 * reasons it relies on appear once, in `applicabilityReasons`.
 * `checkCoverage.limitations` lists each non-checked validator's
 * applicability again, so the compact form keeps its counts and caveat only.
 *
 * @implements docguard.compact-guard-response#FR-001
 * @implements docguard.compact-guard-response#FR-002
 * @implements docguard.compact-guard-response#FR-007
 */

import { APPLICABILITY_CLASS, STANDARD_APPLICABILITY_REASONS } from './validator-coverage.mjs';

export const FULL_CONTRACT_HINT = 'Compact form: each fact once. For the full guard JSON contract call docguard_guard with {"detail":"full"} (CLI: docguard guard --format json).';

/** @param {object} full the result of runGuardInternal */
export function compactGuardResult(full) {
  const evidenceByCode = {};
  const findings = (full.findings || []).map(finding => {
    const { evidence, redactedContext, enforcement, ...rest } = finding;
    // The agent-safe evidence view (precision withheld unless quotable) is
    // per code; keep it once instead of on every finding.
    if (finding.code && evidence && !Object.hasOwn(evidenceByCode, finding.code)) evidenceByCode[finding.code] = evidence;
    return {
      ...rest,
      ...(redactedContext != null ? { redactedContext } : {}),
      // Intrinsic enforcement restates the severity; a configured one does not.
      ...(enforcement && enforcement.source !== 'intrinsic' ? { enforcement } : {}),
    };
  });
  const applicabilityReasons = {};
  // The class is a closed function of the status: stated once per status, not per validator.
  const applicabilityClasses = {};
  // docguard.verdict-contract#FR-012: each gap is stated once, in `verdicts.gaps`.
  const validators = (full.validators || []).map(({ findings: structured, errors, warnings, observations, ...validator }) => ({
    ...validator,
    // Only a validator with gaps carries a count; zero is the default.
    ...(Array.isArray(observations) && observations.length ? { observationCount: observations.length } : {}),
    ...(validator.applicability ? { applicability: compactApplicability(validator.applicability, applicabilityReasons, applicabilityClasses) } : {}),
    errorCount: Array.isArray(errors) ? errors.length : 0,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    // A validator without structured findings reports only through these
    // messages, and they never reach the top-level findings: keep them.
    ...(Array.isArray(structured) ? {} : { errors, warnings }),
  }));
  const { findings: _all, reportable: _reportable, validators: _validators, precisionEvidence, checkCoverage, emptyValidators, ...top } = full;
  let precision;
  if (precisionEvidence && typeof precisionEvidence === 'object') {
    const { codes: _codes, ...summary } = precisionEvidence;
    precision = summary;
  }
  return {
    detail: 'compact',
    hint: FULL_CONTRACT_HINT,
    ...top,
    ...(checkCoverage && typeof checkCoverage === 'object' ? { checkCoverage: withoutLimitations(checkCoverage) } : {}),
    findings,
    evidenceByCode,
    validators,
    applicabilityReasons,
    ...(Object.keys(applicabilityClasses).length ? { applicabilityClasses } : {}),
    ...(precision ? { precisionEvidence: precision } : {}),
    // docguard.staleness-visibility#FR-001: each reason is already on its
    // validator; the compact view names the empty ones and leaves the hints to
    // the full contract and `docguard explain <validator>`.
    ...(Array.isArray(emptyValidators) ? { emptyValidators: emptyValidators.map(v => v.key) } : {}),
  };
}

/** A standard reason is stated once, in `reasons`; any other reason stays where it is. */
function compactApplicability(applicability, reasons, classes) {
  const { status, reason, class: cls, ...rest } = applicability;
  const out = { status };
  if (cls !== undefined) {
    if (APPLICABILITY_CLASS[status] === cls) classes[status] = cls; else out.class = cls;
  }
  if (Object.hasOwn(STANDARD_APPLICABILITY_REASONS, status) && reason === STANDARD_APPLICABILITY_REASONS[status]) reasons[status] = reason;
  else if (reason !== undefined) out.reason = reason;
  return { ...out, ...rest };
}

/** Each limitation is a validator's own applicability, which `validators[]` already carries. */
function withoutLimitations({ limitations: _limitations, ...coverage }) {
  return coverage;
}
