---
name: docguard-guard
description: Run DocGuard guard validation against Canonical-Driven Development standards.
  Parses output, triages severity, suggests targeted fixes, and optionally chains to
  docguard-fix for automated remediation. Use as a quality gate before commits or after
  implementation phases.
compatibility: Requires DocGuard CLI installed (npm i -g docguard-cli or npx docguard-cli)
metadata:
  author: docguard
  version: 0.9.9
  source: extensions/spec-kit-docguard/skills/docguard-guard
---
<!-- docguard:version: 0.9.9 -->

# DocGuard Guard Skill

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Execute DocGuard's 19-validator guard suite against the current project, parse structured results, triage findings by severity and impact, and produce an actionable remediation plan. This skill transforms raw CLI output into an AI-digestible quality assessment.

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
npx docguard-cli guard 2>&1
```

If in a DocGuard development environment (cli/docguard.mjs exists), use:
```bash
node cli/docguard.mjs guard 2>&1
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

**HIGH (fix before commit)**:
- Doc Sections failures (missing required sections)
- Drift detection (undocumented code deviations)
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

### Summary by Priority

| Priority | Count | Validators Affected |
|----------|-------|-------------------|
| CRITICAL | N | [list] |
| HIGH | N | [list] |
| MEDIUM | N | [list] |
| LOW | N | [list] |

### Findings

#### CRITICAL
1. [Validator]: [Specific issue] → **Fix**: [Exact action to take]

#### HIGH
1. [Validator]: [Specific issue] → **Fix**: [Exact action to take]

[... continue for MEDIUM/LOW only if user requests or total findings < 10]
```

### Step 5: Remediation Recommendations

For each finding, provide a **specific, actionable fix** — not "fix the issue" but the exact file, section, and content to change:

- **Missing file**: "Create `docs-canonical/SECURITY.md` with metadata header and these sections: [list]"
- **Missing section**: "Add `## Threat Model` section to `docs-canonical/SECURITY.md` after line N"
- **Stale doc**: "Update `<!-- docguard:last-reviewed YYYY-MM-DD -->` in [file] to today's date"
- **Negation language**: "Replace 'Never store secrets in...' with 'Store secrets exclusively in...'"
- **Undocumented config**: "Add `.venv` documentation to `docs-canonical/ARCHITECTURE.md` under Developer Tools"

### Step 6: Offer Next Actions

Based on the triage results:

- **If all PASS**: "All 19 validators passed. Project is CDD-compliant. Ready to commit."
- **If only MEDIUM/LOW warnings**: "Non-blocking warnings found. Safe to commit, but consider running `/docguard.fix` for automated remediation."
- **If HIGH or CRITICAL failures**: "Blocking issues found. Fix these before committing. Suggest running `/docguard.fix --doc [most impactful doc]` next."

Present the user with options:
1. "Fix all automatically" → Suggest: `/docguard.fix`
2. "Fix specific doc" → Suggest: `/docguard.fix --doc [name]`
3. "Ignore warnings and proceed" → Warn about CDD compliance gap

## Behavior Rules

- **ALWAYS run the actual CLI** — never simulate or guess guard results
- **Parse real output** — don't hallucinate check counts or validator names
- **Be specific** — every fix recommendation must reference an actual file path
- **Respect severity** — don't escalate LOW to CRITICAL or vice versa
- **Track progress** — if user runs guard multiple times, compare before/after
- If user provides `$ARGUMENTS` like "just structure" or "only security", filter report to those validators

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
