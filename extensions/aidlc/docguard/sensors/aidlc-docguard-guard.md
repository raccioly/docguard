---
id: docguard-guard
kind: deterministic
command: bun {{HARNESS_DIR}}/tools/aidlc-sensor-docguard-guard.ts
default_severity: advisory
fire_on: gate
description: Runs DocGuard guard over the whole project — docs, specs and AI-DLC records against the code (docguard plugin, advisory)
category: document-traceability
matches: "**/{aidlc-docs,intents}/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings_count: integer
  findings: string[]
timeout_seconds: 300
---

# docguard-guard sensor (docguard plugin)

ADVISORY by default, like AI-DLC's own sensors; a scope or team rule can make it
blocking. Runs `docguard sensor --aidlc`, which checks the whole project once per
tree state (cached in `.docguard/sensor-cache.json`), however many output files
the gate fires it for.

`pass` is false when DocGuard reports a blocking finding, a validator that could
not run, or a required check that could not decide. It is never true because a
check was skipped: a missing `docguard` makes the wrapper exit 1, which AI-DLC
records as SENSOR_COULD_NOT_RUN, not as a pass.

Install DocGuard first: `npm install -g docguard-cli` (or put `docguard` on PATH).
