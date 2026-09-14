# Status aliases

## Requirements

- **FR-001**: `normalizeStatus` in `src/status.mjs` MUST trim input and compare
  case-insensitively. It MUST preserve `READY`, `QUEUED`, and `IN_PROGRESS`, map
  the legacy aliases `queued` to `QUEUED` and both `in-progress` and
  `in_progress` to `IN_PROGRESS`, and return `null` for unknown or non-string
  values.

## Verification

`tests/status.test.mjs` preserves current canonical behavior. Hidden evaluation
checks aliases, whitespace, unknown values, and non-string inputs.
