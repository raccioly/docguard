# Test Spec

## Coverage rules
- Every route in `src/api.mjs` must have an integration test in `tests/api/`
- Every worker job must have a unit test in `tests/worker/`

## Layers
- **Unit** — pure logic, no I/O
- **Integration** — hits a local Postgres + Stripe in test mode
- **E2E** — against a staging stack (rare; only for release candidates)
