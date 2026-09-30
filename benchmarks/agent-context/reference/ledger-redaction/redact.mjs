// A run of 13 to 19 digits, with single spaces or dashes between digits,
// not part of a longer digit run (acme.ledger#FR-011).
const CARD = /(?<!\d)(?<!\d[ -])\d(?:[ -]?\d){12,18}(?!\d)(?![ -]\d)/g;

/** Remove card numbers from text before it is written to the audit log. */
export function redact(text) {
  return String(text).replace(CARD, match => `**** **** **** ${match.replace(/[ -]/g, '').slice(-4)}`);
}
