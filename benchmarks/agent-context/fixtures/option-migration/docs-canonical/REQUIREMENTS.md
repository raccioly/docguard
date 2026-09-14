# Requirements

## Timeout options

`resolveTimeout` in `src/options.mjs` accepts the current `timeoutMs` option and
the legacy `timeout` option. Explicit `timeoutMs` takes precedence, including
zero. The default remains 5,000 milliseconds.
