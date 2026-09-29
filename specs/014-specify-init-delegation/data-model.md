# Data Model: Spec Kit Init Delegation

## SpecKitCapabilities

| Field | Type | Notes |
|-------|------|-------|
| `available` | boolean | `specify` resolved on `PATH` |
| `supported` | boolean | `init --help` lists `--integration` |
| `flags` | Set&lt;string&gt; | long options parsed from `init --help` |
| `error` | string \| null | bounded excerpt when help could not be read |

## IntegrationChoice

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | allowlisted `^[a-zA-Z0-9_-]{1,32}$`; `generic` when no signal |
| `source` | `'integration.json'` \| `'init-options.json'` \| `'signal'` \| `'default'` | |
| `signal` | string \| null | the path that matched, when `source` is `signal` |

## DelegationResult

| Field | Type | Notes |
|-------|------|-------|
| `status` | `'initialized'` \| `'already-initialized'` \| `'skipped'` \| `'unavailable'` \| `'unsupported-version'` \| `'failed'` | |
| `integration` | IntegrationChoice \| null | |
| `reason` | string \| null | bounded CLI error excerpt or explanation |
| `manualCommand` | string \| null | exact command the adopter can run |
| `extension` | `{ status: 'registered' \| 'already-registered' \| 'failed' \| 'not-attempted', reason }` | reported separately from `status` |

### State transitions

```text
unavailable ─(specify missing)
skipped ─(--no-spec-kit | starter profile)
already-initialized ─(integration.json or init-options.json present) → extension check
unsupported-version ─(help lacks --integration)
failed ─(non-zero exit | timeout)
initialized → extension: registered | already-registered | failed
```

Validation: `reason` is capped at 400 characters and stripped of ANSI sequences; `key` is
re-validated immediately before argv construction even when it came from the signal map.
