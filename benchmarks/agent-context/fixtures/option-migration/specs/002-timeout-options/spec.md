# Timeout option compatibility

## Requirements

- **FR-001**: `resolveTimeout` in `src/options.mjs` MUST prefer an explicitly
  supplied `timeoutMs`, including `0`; otherwise it MUST use the legacy `timeout`
  value, then default to `5000`. Selected values MUST be finite non-negative
  numbers. Invalid selected values MUST throw `TypeError`.

## Verification

`tests/options.test.mjs` covers modern and default behavior. Hidden evaluation
checks legacy fallback, precedence including zero, and invalid selected values.
