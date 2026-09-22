# AI Agent Instructions — DocGuard

<!-- docguard:last-reviewed 2026-09-18 -->

> This project follows **Canonical-Driven Development (CDD)**.
> Documentation is the source of truth. Read before coding.
> DocGuard is an official [GitHub Spec Kit](https://github.com/github/spec-kit) community extension.

## Workflow

1. **Read** `docs-canonical/` before suggesting changes
2. **Check** existing patterns in the codebase
3. **Run** `docguard diagnose` to see what needs fixing
4. **Confirm** your approach before writing code
5. **Implement** matching existing code style
6. **Log** any deviations in `DRIFT-LOG.md` with `// DRIFT: reason`
7. **Verify** with `docguard guard` — all checks must pass

## Project Stack

- **Language**: JavaScript (ES modules)
- **Runtime**: Node.js 18+
- **Dependencies**: One — `@babel/parser` (exact-pinned, optional-load); Node.js built-ins otherwise
- **Testing**: `node:test` (built-in)
- **Distribution**: npm + PyPI
- **Version**: see `package.json` (single source of truth — do not hardcode here)

## Key Files

| File | Purpose |
|------|---------|
| `docs-canonical/ARCHITECTURE.md` | System design |
| `docs-canonical/DATA-MODEL.md` | Database schemas |
| `docs-canonical/SECURITY.md` | Auth & secrets |
| `docs-canonical/TEST-SPEC.md` | Test requirements |
| `docs-canonical/ENVIRONMENT.md` | Environment setup |
| `docs-canonical/REQUIREMENTS.md` | Spec-kit aligned requirements |
| `CHANGELOG.md` | Change tracking |
| `DRIFT-LOG.md` | Documented deviations |

## Commands

`docguard --help` is the authoritative list (counts intentionally not hardcoded
here — they drift). The surface, grouped as `--help` shows it:

**The Daily 5** — `init` (bootstrap + scan), `guard` (CI gate, all validators),
`diff` (doc↔code gaps; `--since <ref>` for changed-file impact), `sync` (refresh
code-truth sections), `score` (CDD maturity 0-100).

**Tools** — `demo` (zero-install tour), `diagnose` (guard → AI fix prompts),
`fix` (AI fix instructions; `--doc <name>`), `generate` (reverse-engineer docs;
`--plan`), `agent` (task graph; `--task <text>` for bounded current evidence),
`retire` (remove reviewed docs from active context),
`specs` (check/refresh/preflight/complete the spec lifecycle registry),
`reconcile` (classify code/spec changes since a Git ref without rewriting intent),
`explain` (explain a validator/warning), `memory` (what DocGuard
remembers), `trace` (requirements traceability; `--reverse`), `upgrade` (migrate
config/CLI), `watch` (live re-guard).

**`init --with <name>`** scaffolders — `agents`, `hooks`, `ci`, `badge`, `llms`,
`publish` (also reachable as standalone deprecation aliases).

**Deprecation aliases** — `setup` → `init --wizard`; `audit` → `guard`
(permanent); `impact` → `diff --since`.

## Consuming Guard Output (agents)

Prefer the machine contract over parsing prose: `docguard guard --format json`
returns `status` (PASS/WARN/FAIL, matches exit code 0/2/1 — but FAIL exits `3`,
not `1`, when the project has no `.docguard.json`, so branch on `status` rather
than assuming `1`), `findings[]`
(`{code, severity, confidence, disposition, evidence, parserTier, message, location, suggestion}`),
`nextStep`, `reportable[]` (findings whose code is unmeasured or whose
confidence is low — verify before acting), `coverage`
(Markdown tier map incl. `unclassified[]`), `evidence`, and `semanticClaims.count`
(documented numbers not yet verified against code).

When a command is launched from an implicitly selected nested package, inspect
stderr for repository-root guidance. Human output supplies an exact rerun;
machine modes emit a `docguard.repository-root-guidance` JSON diagnostic there
so stdout remains a valid JSON/SARIF/JUnit artifact. The current command still
checks only the selected package unless it is explicitly rerun with `--dir`.

- Every structured finding has a stable code (`STR001`, `ENV003`, `XRF002`, …).
  `docguard explain <CODE>` gives the contract and fix.
- Triage on `disposition`, not on severity alone. `act` means DocGuard asserts a
  defect and names the correction — apply it. `escalate` means DocGuard observed
  a signal and the judgement is yours; read the source before changing anything.
  A high-confidence finding can still be an escalation: FRS002 counts commits
  exactly and still does not establish that the document is stale.
- Read `evidence.status` before trusting a confidence label. `measured` quotes
  the reviewed corpus with `n` and a Wilson interval; `not-measured` means the
  label is a maintainer's prior that has never been checked against labelled
  cases. Most codes are unmeasured — that does not make their findings wrong,
  only unverified.
- Read `parserTier` when a finding concerns source code. `regex-fallback` or
  `fallback-language` means an AST was unavailable for that file, so absence of
  a finding is weak evidence; the owning validator also reports `partial`.
- When `evidence.configured` is true, inspect `docguard verify --evidence
  --format json` first. A `verified-within-scope` result covers only its selected
  statement. Contradictions can indicate code regressions from approved intent;
  stale reports must be regenerated from their declared inputs.
- Mechanical fixes go through `docguard fix --write` (provenance-checked,
  fail-closed) — never hand-apply what the tool fixes deterministically.
- Genuine false positives: suppress at the site with `// docguard:ignore <CODE>`
  (reason required) or `<!-- docguard:validator <key> n/a — reason -->`, and
  report them via `docguard feedback`.
- Doc≠code does not mean the doc is wrong — canonical docs are the spec. If the
  code regressed from a documented decision, fix the code or log a
  `// DRIFT: reason` + DRIFT-LOG.md entry instead of rewriting the doc.
- Treat `specs/` and planning docs as active intent only. Review candidates with
  `docguard retire --plan`; retire only explicit, clean tracked documents after
  their shipped outcomes are represented in current docs and `CHANGELOG.md`.
- Run `docguard specs preflight` before drafting and `docguard specs preflight
  --path <spec>` before planning. Refresh `.docguard-specs.json` with `specs
  --write`; never edit generated intent/evidence fields or treat bare requirement
  IDs as completion proof.
- Run `docguard reconcile --since <ref> --format json` before completing a
  changed feature. Only its mechanical write plan may run automatically;
  unsupported changes and possible regressions require review. `docguard specs
  complete` records that review and regenerates the active context projection.
- For a concrete implementation task, prefer `docguard agent --task <text>
  --format json`. Follow only selected current evidence, retain its
  retrieval-only assurance, inspect additional repository facts as needed, and
  fall back to normal discovery when `selection.status` is `abstained`.

## AI Skills

DocGuard provides enterprise-grade AI behavior protocols via the Spec Kit extension:

| Skill | Purpose |
|-------|---------|
| `docguard-guard` | 6-step quality gate with severity triage and structured reporting |
| `docguard-fix` | 7-step research workflow with validation loops (max 3 iterations) |
| `docguard-review` | Read-only semantic cross-document consistency analysis |
| `docguard-score` | CDD maturity assessment with ROI-based improvement roadmap |
| `docguard-sync` | Mechanical code-truth refresh with explicit prose review boundaries |

Skills are located at `extensions/spec-kit-docguard/skills/*/SKILL.md`. They tell agents **how to think**, not just what to run.

## Spec Kit Hooks

DocGuard integrates into the spec-kit workflow:

| Hook | When | Required? |
|------|------|-----------|
| `after_implement` | After `/speckit.implement` | Mandatory |
| `before_tasks` | Before `/speckit.tasks` | Optional |
| `after_tasks` | After `/speckit.tasks` | Optional |

## Extension Structure

```
extensions/spec-kit-docguard/
├── skills/                    # AI behavior protocols
│   ├── docguard-guard/SKILL.md
│   ├── docguard-fix/SKILL.md
│   ├── docguard-review/SKILL.md
│   └── docguard-score/SKILL.md
├── scripts/bash/              # Orchestration scripts (--json output)
├── commands/                  # Spec Kit slash commands
├── templates/                 # Hook registration templates
└── extension.yml              # Skills, scripts, hooks declaration
```

## Rules

- **PR-first workflow — no direct-to-main commits.** Create a branch (`git checkout -b <type>/<slug>`), push, `gh pr create`, let CI run, self-review, squash-merge. Tag releases only after merge on `main`. The only acceptable direct-to-main: typo fixes in comments or README badge URLs.
- Never commit without updating CHANGELOG.md
- If code deviates from docs, add `// DRIFT: reason`
- Security rules in SECURITY.md are mandatory
- Test requirements in TEST-SPEC.md must be met
- Run `docguard guard` before pushing — all checks must pass
- Standalone file writes use `safeWrite()` with backups before overwrite.
  Lifecycle operations spanning multiple files use `commitFileTransaction()` so
  preparation, rollback, and post-write validation cover the complete set.


## Agent Rules

### Automated agents / bots (Jules "Sentinel", "Bolt", "Palette", and any auto-PR agent)
- **Never open a duplicate PR.** Before opening ANY PR, search existing **open
  AND closed** PRs and issues for the same topic/title. If it exists, STOP — do
  not open another. (Dozens of duplicate command-injection and diff-optimization
  PRs were closed as noise.)
- **Do not re-open resolved work.** See `.jules/sentinel.md` (execSync/command
  injection — RESOLVED in v0.21.1 + #296) and `.jules/bolt.md` (diff/scan
  micro-optimizations — already applied; code refactored since). These are
  historical learnings, **not** standing mandates to re-scan every run.
- **Bar for a new PR:** a genuinely new, unaddressed finding, with evidence — a
  concrete exploit path / failing test (security) or a benchmark showing >20%
  real-workload improvement (performance). A Big-O note alone is insufficient.
- This repo has **no web UI and no VS Code extension** — skip all UX tasks.

### Dependencies
- Never add a package without first verifying it exists on the official registry (npm/PyPI).
- Always pin to exact versions in `package.json` and `requirements.txt`. No ^, ~, or >= ranges.
- Prefer packages with >10k weekly downloads and >1 maintainer.
- If you suggest a package, confirm its first-publish date is older than 30 days.
- Never modify .npmrc, pnpm-workspace.yaml, or dependabot.yml without explicit user confirmation.

### CI/CD
- Never write a workflow using `pull_request_target` with checkout of PR-controlled refs.
- Always pin third-party GitHub Actions to commit SHA, not @v1 or @main.

## Claim probing (TestGuard)

`testguard.claims.json` states what this codebase guarantees, as claims with
mechanical faults. `testguard probe` injects each fault and reports the ones the
suite fails to detect — a test that pins a *defect* stays green under coverage,
so this is the check that catches it.

This suite runs on `node --test`, which ships no `json` reporter, while TestGuard
reads Jest-shape JSON. `tools/node-test-json-reporter.mjs` translates between
them:

```bash
npx testguard-cli probe --confirm 3 --serial \
  --node-modules "$PWD/node_modules" \
  --runner-cmd "node --test --test-reporter=$PWD/tools/node-test-json-reporter.mjs --test-reporter-destination={out} {files}"
```

Pass an absolute reporter path: the probe runs in a scratch worktree built from
a commit, so a relative path resolves there and untracked files do not exist.

`testguard gate --changed origin/main` reports changed source files that carry no
claim. It does not find bugs; it refuses to let a change land without stating
what must be true, which is the step that surfaces them.

## Evidence and contributions

A structural score is a maturity proxy. Preserve `assurance` and nullable factual accuracy in automation; a clean guard does not establish arbitrary prose correctness. Review human intent separately from generated code facts. To challenge any finding, run `docguard feedback --code <CODE> --preview`, inspect the metadata-only public draft, and check the supplied search link for existing open and closed work. Contribute a synthetic failing example paired with a neighboring valid case. Submission remains opt-in.
