/**
 * The result-contract fields of a validator (specs/097-strict-by-default
 * FR-004 to FR-006), built in one place so every validator that returns them
 * builds them the same way. The contract itself, and `validateResultContract`
 * that checks it, live in cli/validator-coverage.mjs.
 *
 * A result that performed checks or found something carries `performed` and an
 * `applies` whose evidence says what ran. A result that did neither asks the
 * validator, once, whether this kind of check belongs to the project
 * (`decide`) and what the empty result means for that project (`empty`); the
 * scan that `decide` may run is therefore paid only by an empty result.
 *
 * @implements docguard.strict-by-default#FR-004
 * @implements docguard.strict-by-default#FR-005
 * @implements docguard.strict-by-default#FR-006
 */

/**
 * @param {object} spec
 * @param {number} spec.performed checks genuinely made (never the padded `total`)
 * @param {boolean} [spec.found] the result carries findings
 * @param {string} spec.ran evidence sentence when something was checked or found
 * @param {() => { applies: boolean, evidence: string }} spec.decide
 * @param {(decision: object) => { emptyCause?: string, note: string, howToConfigure: string }} spec.empty
 *   called only when nothing was performed and nothing found; `emptyCause`
 *   defaults to `nothing-of-this-kind` when the validator does not apply
 */
export function contractFields({ performed, found = false, ran, decide, empty }) {
  if (performed > 0 || found) return { performed, applies: { applies: true, evidence: ran } };
  const decision = decide();
  const { emptyCause, note, howToConfigure } = empty(decision);
  return {
    performed,
    applies: { applies: decision.applies, evidence: decision.evidence },
    emptyCause: emptyCause || (decision.applies ? 'needs-content' : 'nothing-of-this-kind'),
    note,
    howToConfigure,
  };
}

/** The empty-result pieces of a validator that does not apply: its fix names what it looks for. */
export function notApplicable(note, looksFor) {
  return { emptyCause: 'nothing-of-this-kind', note, howToConfigure: `Nothing to configure unless the project has this: ${looksFor}` };
}
