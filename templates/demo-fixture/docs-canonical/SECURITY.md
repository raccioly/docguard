# Security

## Authentication
HTTP API requires `Authorization: Bearer <jwt>`. Tokens are signed with `JWT_SECRET`.

## Secrets
- `STRIPE_SECRET_KEY` — never logged
- `JWT_SECRET` — rotated quarterly

## Threat model
- Card data is never stored locally — Stripe-tokenized only
- `JWT_SECRET` rotation invalidates outstanding sessions (acceptable for an internal API)

## Audit log
Every charge / refund writes to the `audit_events` table.
