# API Reference

> All requests require `Authorization: Bearer <jwt>` unless noted.

## Charges

### POST /charge
Create a new charge.

**Request body**
```json
{ "amount_cents": 1000, "currency": "USD", "customer_id": "cus_..." }
```

**Response** — `201 Created` with the charge object.

### POST /refund
Refund a previous charge.

**Request body**
```json
{ "charge_id": "ch_...", "amount_cents": 1000 }
```

## Balance

### GET /balance/:customer_id
Look up a customer's current balance.

**Response**
```json
{ "customer_id": "cus_...", "available_cents": 12345 }
```

<!-- Demo drift: code also exposes POST /webhooks (Stripe callbacks) but it's
     missing from this reference. DocGuard's API-Surface validator catches it. -->
