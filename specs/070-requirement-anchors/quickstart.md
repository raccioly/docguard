# Quickstart: Validating Requirement Anchors

Prerequisites:
- Node ≥ 18.
- `python3` 3.8+ for the Python scenarios. Without it, the Python fixtures
  report the pattern tier, and the test says so.
- This repository at the PR under test.

Fixtures live under `tests/fixtures/anchors/`. Each scenario names its test.

## US1: tags anchor to code

```bash
node --test tests/requirement-anchors.test.mjs
node cli/docguard.mjs anchors --format json --dir tests/fixtures/anchors/positions
```

Expected: every tag reports its scope and tier as in `positions/expected.json`.
The tag inside a string literal is absent. A file with unbalanced braces
reports file scope plus ANC006.

```bash
node cli/docguard.mjs guard --format json > /tmp/after.json   # project without lock
```

Expected: identical to the base release apart from the validator list and
timings (SC-002), and `.docguard-doc-lock.json` entries all current.

## US2: suspect, accept, baseline

```bash
cd "$(mktemp -d)" && cp -R <repo>/tests/fixtures/anchors/billing/. . && git init -q && git add -A && git commit -qm base
node <repo>/cli/docguard.mjs anchors accept --baseline --bulk --reason "adopt anchors for the fixture"
# five non-semantic edits (see fixture README), then:
node <repo>/cli/docguard.mjs anchors --state suspect --format json   # → 0 links
# one identifier edit inside applyDiscount, then:
node <repo>/cli/docguard.mjs anchors --state suspect --format json   # → 1 link, side "code"
```

Accepting that link clears it. A further edit flags it again (SC-004).

## US3: replay and failure policy

```bash
node tools/anchor-churn-replay.mjs --commits 100 --out specs/070-requirement-anchors/evidence/churn-replay.json
```

Expected: the evidence file lists suspects per commit, the formatting-only
count among exact-tier links, and the resulting `failOn` default.
`specs complete --id <spec with own suspects>` succeeds and lists them
(SC-006).

## US4–US10

| Story | Command | Expected |
|---|---|---|
| US4 | rename and move the fixture function, then `anchors` | `moved`, with 0 suspect and 0 lost |
| US5 | edit `a.mjs#f` in the ripple fixture, then `anchors --format json` | a ripple entry for `b.mjs` only |
| US6 | `anchors` in the testguard fixture (3 evidence variants) | re-verified, needs-reverification, needs-reverification with a hint |
| US7 | `anchors --orphans` | 2 symbols, then 1 after `anchors disposition` |
| US8 | `trace --matrix --format csv` and `--format reqif` | byte-identical across two runs (SC-010) |
| US9 | `anchors` in the importer fixture with `anchors.import` set | 2 anchors, plus an ANC007 for the unmapped ID |
| US10 | `node --test tests/requirement-anchors-golden.test.mjs`; the CI `anchor-oracle` job | golden values match; the oracle reports at least 99% agreement for Go, Rust and Java |
