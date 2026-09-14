export function resolveTimeout(options = {}) {
  const value = Object.hasOwn(options, 'timeoutMs')
    ? options.timeoutMs
    : (Object.hasOwn(options, 'timeout') ? options.timeout : 5000);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('timeout must be a finite non-negative number');
  }
  return value;
}
