/** Remove card numbers from text before it is written to the audit log. */
export function redact(text) {
  return String(text).replace(/\b\d{16}\b/g, digits => `**** **** **** ${digits.slice(-4)}`);
}
