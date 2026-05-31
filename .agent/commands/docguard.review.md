---
description: Cross-document consistency analysis — semantic review of documentation health, accuracy, and alignment with codebase
handoffs:
  - label: Fix Issues Found
    agent: docguard.fix
    prompt: Fix the documentation issues identified in the review
  - label: Run Guard
    agent: docguard.guard
    prompt: Validate all documentation passes CDD standards
---

# DocGuard Review — Documentation Quality Analysis

Perform comprehensive, read-only analysis of documentation health with semantic cross-document consistency checking.

## What to do

1. **Run the full diagnostic**:
```bash
npx docguard-cli diagnose
npx docguard-cli score
```

2. **Perform semantic analysis** (beyond what CLI can check):

   | Analysis Pass | What to Check |
   |--------------|--------------|
   | Terminology | Same concepts named consistently across docs |
   | Architecture ↔ Code | Components listed in ARCHITECTURE.md exist in codebase |
   | Data Model ↔ Code | Schemas in DATA-MODEL.md match actual implementations |
   | Test Coverage | Critical flows in TEST-SPEC.md have actual test files |
   | Security Claims | Auth mechanisms in SECURITY.md match actual code |
   | Cross-References | Internal doc links resolve to valid targets |

3. **Score each document** on 5 dimensions:

   | Criterion | Weight | What to Evaluate |
   |-----------|:------:|-----------------|
   | Completeness | 30% | All mandatory sections present |
   | Accuracy | 30% | Content matches actual codebase |
   | Clarity | 20% | Readable, specific, no unexplained jargon |
   | Currency | 10% | Up-to-date with latest code changes |
   | Cross-refs | 10% | References are valid and bidirectional |

4. **Classify findings by severity**:
   - 🔴 **CRITICAL**: Security claim mismatch, missing mandatory doc, broken architecture reference
   - 🟠 **HIGH**: Undocumented component, stale content (>5 commits behind), terminology conflict
   - 🟡 **MEDIUM**: Missing cross-reference, minor coverage gap, readability issue
   - 🟢 **LOW**: Minor formatting, optional section missing, style inconsistency

5. **Output a structured report** with findings table, per-document health scores, and priority-ordered recommendations.

6. **Do NOT modify files** — this is read-only analysis. Suggest fixes for user approval.
