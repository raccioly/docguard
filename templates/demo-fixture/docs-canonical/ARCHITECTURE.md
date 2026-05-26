# ARCHITECTURE — Acme Payments

> The system has **3 services**. (Demo drift: code actually has 4 — see `src/`.)

## Components

```
┌───────────┐   queue   ┌──────────┐   cron   ┌────────────┐
│   API     │ ────────> │  Worker  │ <─────── │ Scheduler  │
│ (HTTP)    │           │ (jobs)   │          │ (timers)   │
└───────────┘           └──────────┘          └────────────┘
```

### API
Handles HTTP requests. Routes live in `src/api.mjs`.

### Worker
Consumes the job queue. Long-running tasks (capture, refund settlement).

### Scheduler
Cron-style triggers for retries and reconciliation.

## Data flow
1. Client POSTs to `/charge` → API validates → enqueues `process_charge` job
2. Worker dequeues → calls Stripe → writes result to DB
3. Scheduler reruns failed charges hourly

## See also
- `DATA-MODEL.md` for the persistence layer
- `SECURITY.md` for auth + secrets handling
