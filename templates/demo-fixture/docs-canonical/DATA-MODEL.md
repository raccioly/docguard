# Data Model

## charges

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` (PK) | |
| `customer_id` | `text` | |
| `amount_cents` | `bigint` | |
| `currency` | `text` | ISO-4217 |
| `status` | `text` | `pending` / `succeeded` / `failed` |
| `stripe_id` | `text` | nullable |
| `created_at` | `timestamptz` | default now() |

## refunds

| Column | Type |
|--------|------|
| `id` | `uuid` (PK) |
| `charge_id` | `uuid` (FK → charges) |
| `amount_cents` | `bigint` |
| `created_at` | `timestamptz` |

## customers

| Column | Type |
|--------|------|
| `id` | `text` (PK, `cus_...`) |
| `email` | `text` |
| `created_at` | `timestamptz` |
