# Requirements

## Status normalization

`normalizeStatus` is the public normalization boundary in `src/status.mjs`.
Canonical values remain `READY`, `QUEUED`, and `IN_PROGRESS`; unknown or
non-string values return `null`.
