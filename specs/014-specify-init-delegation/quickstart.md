# Quickstart: validating Spec Kit init delegation

Prerequisites: Node ≥ 18, this repository checked out, `specify` ≥ 0.10.0 on `PATH` for the
live scenario.

## Automated

```bash
node --test tests/spec-kit-delegation.test.mjs tests/security-init-injection.test.mjs tests/ensure-skills-idempotent.test.mjs
```

Expected: the removed-flag stub scenario fails on the pre-fix commit and passes after it; all
others pass.

## Live, against the real CLI

```bash
D=$(mktemp -d) && cd "$D" && git init -q && touch CLAUDE.md
node <repo>/cli/docguard.mjs init --skip-prompts
```

Expected output names `integration: claude`, reports the DocGuard extension as registered, and
`specify integration status` in `$D` reports `Default integration: claude`.
`.specify/extensions/.registry` lists `docguard`.

## Non-init commands do not initialize

```bash
D=$(mktemp -d) && cd "$D" && git init -q
node <repo>/cli/docguard.mjs sync
test ! -d .specify && echo "no Spec Kit writes"
```
