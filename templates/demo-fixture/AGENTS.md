# AGENTS.md — Acme Payments

> Rules for AI agents working in this repo.

## Project context
Acme Payments is a payments microservice. Money is involved — assume every change needs a test.

## Architecture
Three services: API, Worker, Scheduler. See `docs-canonical/ARCHITECTURE.md` for the canonical map.

## Style
- ES modules (`.mjs`)
- Async/await throughout, no callbacks
- Throw `PaymentError` for domain errors
