---
name: docguard-guard
description: Run DocGuard guard validation against Canonical-Driven Development standards.
  Parses output, triages severity, suggests targeted fixes, and optionally chains to
  docguard-fix for automated remediation. Use as a quality gate before commits or after
  implementation phases.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.42.0
  source: extensions/spec-kit-docguard/skills/docguard-guard
---
<!-- docguard:version: 0.42.0 -->

# DocGuard Guard Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Execute DocGuard's full guard validator suite against the current project, parse structured results, triage findings by **disposition and severity**, and produce an actionable remediation plan. This skill transforms raw CLI output into an AI-digestible quality assessment.

### Triage on `disposition` first, severity second

Every finding answers three independent questions. Reading only `severity` conflates them and leads to auto-fixing judgement calls.

| Field | Question | Values |
|-------|----------|--------|
| `disposition` | Who decides — the tool or a human? | `act`, `escalate` |
| `severity` / `effectiveSeverity` | Does CI block? | `error`, `warn`, `info` |
| `confidence` | How sure is the detector of its **observation**? | `high`, `low` |
| `evidence.status` | Has the reviewed corpus ever measured this code? | `measured`, `not-measured` |
| `parserTier` | Which analyzer produced it? | `js-ast`, `py-ast`, `regex-fallback`, `fallback-language`, `mixed`, `not-applicable` |

- **`act`** — DocGuard asserts a defect and names the correction. Safe to apply, including through `/docguard.fix`.
- **`escalate`** — DocGuard observed a signal; the judgement belongs to the reader. **Never auto-fix these.** Read the source, decide which side is wrong, and say so. FRS002 is the canonical example: the commit count is exact and the finding is `confidence: high`, yet it establishes only that a review is DUE, never that the document is stale.

These axes vary independently. A blocking `error` can be an `escalate`; a `high`-confidence finding can still need a human.

- Read `evidence.status` before trusting a confidence label. `measured` quotes the reviewed corpus with `n` and a Wilson interval; `not-measured` means the label is a maintainer's prior. Most codes are unmeasured — that does not make their findings wrong, only unverified. Report it rather than inflating or discounting the finding.
- Read `parserTier` when a finding concerns source code. `regex-fallback` or `fallback-language` means no syntax tree was available for that file, so **absence** of a finding there is weak evidence; the owning validator also reports `partial`.
- Read `checkCoverage` before writing any "all clear". `passed/total` counts checks and its denominator excludes every validator that could not run.

## Pre-Execution Checks

1. **Verify DocGuard is available**:
   - Check if `npx docguard-cli --version` succeeds
   - If not available, check if `node cli/docguard.mjs --help` exists (local dev mode)
   - If neither works: ERROR "DocGuard CLI not found. Install with: npm i -g docguard-cli"

2. **Detect project root**:
   - Look for `.docguard.json`, `docs-canonical/`, or `CHANGELOG.md` as project markers
   - If none found: ERROR "No CDD project detected. Run `docguard init` first."

## Execution Flow

### Step 1: Run Guard with Machine-Readable Output

Execute the guard command and capture full output:

```bash
npx docguard-cli guard --format json
```

If in a DocGuard development environment (cli/docguard.mjs exists), use:
```bash
node cli/docguard.mjs guard --format json
```

### Step 2: Parse Validator Results

Extract from guard output each validator's status. Build an internal results table:

| Validator | Priority | Checks Passed | Total Checks | Status |
|-----------|----------|---------------|--------------|--------|
| Structure | HIGH | N | M | ✅/⚠️/❌ |
| Doc Sections | HIGH | N | M | ✅/⚠️/❌ |
| ... | ... | ... | ... | ... |

**Status mapping**:
- `✅` = All checks passed
- `⚠️` = Warning (non-blocking, but should fix)
- `❌` = Failure (blocking — must fix before commit)

### Step 3: Severity Triage

Classify every non-passing check using this priority matrix:

**CRITICAL (fix immediately)**:
- Structure failures (missing canonical docs)
- Security failures (hardcoded secrets, missing SECURITY.md)
- Test-Spec failures (tests don't match spec)
- Evidence contradictions or an invalid evidence manifest

**HIGH (fix before commit)**:
- Doc Sections failures (missing required sections)
- Drift-Comments (a `// DRIFT:` comment without a DRIFT-LOG.md entry)
- API-Surface (API-REFERENCE.md documents an endpoint that no longer exists in code)
- Changelog gaps
- Traceability breaks

**MEDIUM (fix this sprint)**:
- Freshness warnings (stale docs)
- Docs-Coverage gaps (undocumented config files)
- Doc-Quality issues (readability, negation language)
- Metrics-Consistency mismatches

**LOW (fix when convenient)**:
- TODO-Tracking items
- Schema-Sync gaps
- Metadata-Sync minor mismatches
- Spec-Kit warnings (spec structure gaps)

### Step 4: Generate Triage Report

Output a structured markdown report:

```markdown
## DocGuard Guard Report

**Score**: [X]/[Y] checks passed ([percentage]%)
**Overall Status**: ✅ PASS | ⚠️ WARN | ❌ FAIL

**Work**: [N] to fix · [M] to review
**Coverage**: [C] of [V] validators checked[, D partial/missing-prerequisite]

### Summary by Priority

| Priority | Count | To fix | To review | Validators Affected |
|----------|-------|--------|-----------|-------------------|
| CRITICAL | N | n | m | [list] |
| HIGH | N | n | m | [list] |
| MEDIUM | N | n | m | [list] |
| LOW | N | n | m | [list] |

### Findings to fix (`disposition: act`)

#### CRITICAL
1. [Validator]: [Specific issue] → **Fix**: [Exact action to take]

#### HIGH
1. [Validator]: [Specific issue] → **Fix**: [Exact action to take]

### Findings to review (`disposition: escalate`)

These need a human judgement; do NOT apply a fix to them.

1. [Validator]: [What DocGuard observed] → **Decide**: [what the reader must determine, and from which source]

[... continue for MEDIUM/LOW only if user requests or total findings < 10]
```

When a finding's code is `not-measured`, say so once in the report rather than per finding — it is a fact about DocGuard's benchmark coverage, not about that finding's correctness.

### Step 5: Remediation Recommendations

For each finding, provide a **specific, actionable fix** — not "fix the issue" but the exact file, section, and content to change:

- **Missing file**: "Create `docs-canonical/SECURITY.md` with metadata header and these sections: [list]"
- **Missing section**: "Add `## Threat Model` section to `docs-canonical/SECURITY.md` after line N"
- **Stale doc**: "Update `<!-- docguard:last-reviewed YYYY-MM-DD -->` in [file] to today's date"
- **Negation language**: "Replace 'Never store secrets in...' with 'Store secrets exclusively in...'"
- **Undocumented config**: "Add `.venv` documentation to `docs-canonical/ARCHITECTURE.md` under Developer Tools"

### Step 6: Offer Next Actions

Based on the triage results:

- **If all PASS**: "All configured validators passed. [C] of [V] validators were able to check; report declared evidence coverage and any remaining heuristic claims. Uncaptured prose is still unverified."
- **If only `act` warnings**: "Non-blocking warnings found, all of them things DocGuard can name a correction for. Safe to commit; `/docguard.fix` can remediate them."
- **If any `escalate` findings**: "[M] finding(s) need a human judgement — DocGuard observed a signal, it did not establish a defect. Review these against the source before changing anything; `/docguard.fix` will NOT resolve them."
- **If HIGH or CRITICAL failures**: "Blocking issues found. Fix these before committing. Suggest running `/docguard.fix --doc [most impactful doc]` next — for the `act` findings only."

Present the user with options:
1. "Fix all automatically" → Suggest: `/docguard.fix`
2. "Fix specific doc" → Suggest: `/docguard.fix --doc [name]`
3. "Ignore warnings and proceed" → Warn about CDD compliance gap

## Behavior Rules

- **ALWAYS run the actual CLI** — never simulate or guess guard results
- **Parse real output** — don't hallucinate check counts or validator names
- **Be specific** — every fix recommendation must reference an actual file path
- **Respect severity** — don't escalate LOW to CRITICAL or vice versa
- **Respect disposition** — never apply an automated fix to an `escalate` finding, and never present one as a defect DocGuard established. Severity says whether CI blocks; disposition says whether a human decides.
- **Never read absence as proof** — a `no-matches` validator found nothing applicable, a `partial` one could not check everything it was asked to, and a `regex-fallback` tier could not see the whole syntax. Report the gap rather than summarizing it as clean.
- **Track progress** — if user runs guard multiple times, compare before/after
- If user provides `$ARGUMENTS` like "just structure" or "only security", filter report to those validators

## Evidence State Rules

When the JSON payload contains `evidence`, preserve its state names exactly.
Treat `verified-within-scope` as a pass only for that declaration. Treat
`contradicted` as a high-confidence failure. For `stale`, regenerate the saved
upstream report and hashes before reviewing prose. For `inconclusive`, restore
or narrow the missing/ambiguous input. For `unsupported`, keep the finding
visible and request a paired synthetic fixture before expanding support. Never
rewrite approved intent from current code automatically.

## Integration with Spec Kit (Extension-First)

DocGuard is a spec-kit extension. When this project has a `.specify/` directory:
- Read `.specify/memory/constitution.md` for project principles that constrain documentation
- Include Spec-Kit validator results in the triage
- Cross-reference spec quality issues with `specs/*/spec.md` file paths
- When specification issues found → suggest `/speckit.specify` or `/speckit.clarify`
- When architecture gaps found → suggest `/speckit.plan`
- When cross-artifact inconsistencies exceed 3 → suggest `/speckit.analyze`
- When no constitution exists → suggest `/speckit.constitution` as first step

## Context

$ARGUMENTS
