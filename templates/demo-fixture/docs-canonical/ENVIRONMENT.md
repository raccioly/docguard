# Environment

Required environment variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key (server-side) |
| `REDIS_URL` | Yes | Redis URL for the job queue |

<!-- Demo drift: REDIS_URL is documented here but missing from .env.example.
     Also, JWT_SECRET is in .env.example + used in code, but not listed here.
     DocGuard's Environment validator catches both. -->

## Local development

```bash
cp .env.example .env
# Fill in the values above
```
