export function resolveTimeout(options = {}) {
  const value = options.timeoutMs ?? 5000;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('timeoutMs must be a finite non-negative number');
  }
  return value;
}
