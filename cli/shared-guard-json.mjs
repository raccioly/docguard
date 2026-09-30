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
 * @implements docguard.compact-guard-response#FR-001
 * @implements docguard.compact-guard-response#FR-002
 */

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
  const validators = (full.validators || []).map(({ findings: structured, errors, warnings, ...validator }) => ({
    ...validator,
    errorCount: Array.isArray(errors) ? errors.length : 0,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    // A validator without structured findings reports only through these
    // messages, and they never reach the top-level findings: keep them.
    ...(Array.isArray(structured) ? {} : { errors, warnings }),
  }));
  const { findings: _all, reportable: _reportable, validators: _validators, precisionEvidence, ...top } = full;
  let precision;
  if (precisionEvidence && typeof precisionEvidence === 'object') {
    const { codes: _codes, ...summary } = precisionEvidence;
    precision = summary;
  }
  return {
    detail: 'compact',
    hint: FULL_CONTRACT_HINT,
    ...top,
    findings,
    evidenceByCode,
    validators,
    ...(precision ? { precisionEvidence: precision } : {}),
  };
}
