/**
 * Observation ledger — what a guard run could not observe.
 *
 * A shared helper that fails to observe something while its source is readable
 * (a git call that cannot spawn, times out, or exits outside its documented
 * codes) records a gap here instead of handing its caller an answer that looks
 * like "nothing". Guard opens one list around each validator, so every gap is
 * attributed to the validator during whose run it happened.
 *
 * Validators run synchronously, one at a time, so a stack is exact: a nested
 * guard run (the `memory` command) opens its own lists, and a helper called
 * outside guard (`rules`, `trace`) finds no open list and records nothing.
 *
 * @implements docguard.verdict-contract#FR-004
 * @implements docguard.verdict-contract#FR-005
 */

const stack = [];

/** Start collecting gaps for one validator. */
export function openObservations() {
  stack.push([]);
}

/**
 * Record one gap in the innermost open list; a no-op when none is open.
 * @param {{ operation: string, cause: string, scope: { count: number, paths?: string[] } }} gap
 */
export function recordGap(gap) {
  const list = stack[stack.length - 1];
  if (list) list.push(gap);
}

/** Stop collecting and return the innermost list's gaps (empty when none is open). */
export function closeObservations() {
  return stack.pop() || [];
}
