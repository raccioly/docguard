/**
 * A validator result without the spec 097 result-contract fields, for the tests
 * that pin the legacy shape (errors, warnings, passed, total) of an early return.
 * The contract fields have their own tests (tests/validator-applicability-a.test.mjs).
 */
export function legacyShape(result) {
  const { performed, applies, emptyCause, howToConfigure, note, ...legacy } = result;
  return legacy;
}
