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

const NOTHING_OF_THIS_KIND = 'The project has none of what this validator checks, so there is nothing to configure. The full form (detail "full") states what it looked for.';

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
  // The reason of a validator that has nothing to check is one sentence, stated once.
  const emptyCauses = {};
  // The class is a closed function of the status: stated once per status, not per validator.
  const applicabilityClasses = {};
  // docguard.verdict-contract#FR-012: each gap is stated once, in `verdicts.gaps`.
  const validators = (full.validators || []).map(({ findings: structured, errors, warnings, observations, ...raw }) => {
    const validator = compactContract(raw);
    if (validator.emptyCause === 'nothing-of-this-kind' && validator.applicability && validator.applicability.reason === undefined) emptyCauses['nothing-of-this-kind'] = NOTHING_OF_THIS_KIND;
    return {
    ...validator,
    // Only a validator with gaps carries a count; zero is the default.
    ...(Array.isArray(observations) && observations.length ? { observationCount: observations.length } : {}),
    ...(validator.applicability ? { applicability: compactApplicability(validator.applicability, applicabilityReasons, applicabilityClasses) } : {}),
    errorCount: Array.isArray(errors) ? errors.length : 0,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    // A validator without structured findings reports only through these
    // messages, and they never reach the top-level findings: keep them.
    ...(Array.isArray(structured) ? {} : { errors, warnings }),
    };
  });
  const { findings: _all, reportable: _reportable, validators: _validators, precisionEvidence, checkCoverage, strict, ...top } = full;
  let precision;
  if (precisionEvidence && typeof precisionEvidence === 'object') {
    const { codes: _codes, ...summary } = precisionEvidence;
    precision = summary;
  }
  return {
    detail: 'compact',
    hint: FULL_CONTRACT_HINT,
    ...top,
    ...(strict ? { strict: compactStrict(strict) } : {}),
    ...(checkCoverage && typeof checkCoverage === 'object' ? { checkCoverage: withoutLimitations(checkCoverage) } : {}),
    findings,
    evidenceByCode,
    validators,
    applicabilityReasons,
    ...(Object.keys(emptyCauses).length ? { emptyCauses } : {}),
    ...(Object.keys(applicabilityClasses).length ? { applicabilityClasses } : {}),
    ...(precision ? { precisionEvidence: precision } : {}),
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

/**
 * The result contract (specs/097-strict-by-default) is for the full form. An agent
 * pays for every byte of this response on every call, so the compact form carries
 * only what it can act on:
 *   - `performed` and `applies` are dropped: a validator that examined something
 *     needs neither, and one that did not says why in its applicability reason
 *     (the evidence sentence of `applies` is that reason);
 *   - `note` is dropped when it is the applicability reason it produced;
 *   - `layouts` (the layouts an unread-layout validator does read) is on `strict.couldNotRead`;
 *   - `applicability.before` (the status an `applies: false` remap replaced) is dropped;
 *   - `emptyCause` stays on a validator that examined nothing (empty, inconclusive,
 *     or skipped because it does not apply);
 *   - `howToConfigure` stays only where there is something to configure: the
 *     validator applies and examined nothing.
 * The full form (`docguard guard --format json`, MCP `detail: "full"`) keeps all of it.
 */
function compactContract(validator) {
  const { performed: _performed, layouts: _layouts, applies, note, howToConfigure, emptyCause, applicability, ...rest } = validator;
  const out = { ...rest };
  const reason = emptyCause === 'nothing-of-this-kind' && !Object.values(STANDARD_APPLICABILITY_REASONS).includes(applicability?.reason) ? undefined : applicability?.reason;
  if (applicability) {
    const { before: _before, reason: kept_reason, ...kept } = applicability;
    // A validator that does not apply has nothing to configure, so its own sentence (what it
    // looked for) is full-form detail; the compact form carries the cause and states it once.
    // A standard reason costs nothing (it is stated once in `applicabilityReasons`), so it stays.
    const standard = Object.values(STANDARD_APPLICABILITY_REASONS).includes(kept_reason);
    out.applicability = emptyCause === 'nothing-of-this-kind' && !standard ? kept : { ...kept, ...(kept_reason !== undefined ? { reason: kept_reason } : {}) };
  }
  if (note !== undefined && note !== reason && emptyCause !== 'nothing-of-this-kind') out.note = note;
  const examinedNothing = ['empty', 'inconclusive', 'skipped'].includes(validator.verdict);
  if (emptyCause && examinedNothing) out.emptyCause = emptyCause;
  if (howToConfigure && emptyCause && emptyCause !== 'nothing-of-this-kind' && applies?.applies !== false && ['empty', 'inconclusive'].includes(validator.verdict)) out.howToConfigure = howToConfigure;
  return out;
}

/** Each unexamined validator is on `validators[]` with its reason and fix; refer to it by key. */
function compactStrict(strict) {
  const { unexamined, couldNotRead, disabled, pending, ...rest } = strict;
  const short = (text, max = 160) => (typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1)}…` : text);
  return {
    ...rest,
    unexamined: (unexamined || []).map(({ name: _name, reason: _reason, howToConfigure: _fix, ...u }) => u),
    // Keys and a short reason: the validator's own entry carries the full text.
    couldNotRead: (couldNotRead || []).map(({ name: _name, reason, ...u }) => ({ ...u, reason: short(reason) })),
    // The reason for a disabled validator is the same sentence every time; the key says it.
    disabled: (disabled || []).map(({ validator }) => ({ validator })),
    // A held-back item: its key and the release that lists it; the validator's own entry has the rest.
    pending: (pending || []).map(({ name: _name, reason: _reason, ...p }) => p),
  };
}
